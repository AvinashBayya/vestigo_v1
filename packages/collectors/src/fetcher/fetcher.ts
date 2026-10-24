import { lookup } from "node:dns/promises";
import http, { type IncomingHttpHeaders } from "node:http";
import https from "node:https";
import { connect as connectTcp } from "node:net";
import type { Duplex } from "node:stream";
import { setTimeout as sleep } from "node:timers/promises";
import { connect as connectTls } from "node:tls";
import { promisify } from "node:util";
import { brotliDecompress, gunzip, inflate } from "node:zlib";
import { PRODUCT_NAME } from "@repo/config";
import {
  DestinationRefusedError,
  FetchOptionsError,
  RateLimiterUnavailableError,
  ResponseTooLargeError,
  UpstreamRateLimitedError,
  UpstreamResponseError,
  UpstreamTimeoutError,
  UpstreamUnreachableError,
} from "../errors.ts";
import type { SourceDeclaration, SourceNetwork } from "../source.ts";
import { isPublicAddress } from "./address.ts";
import { captureResponse, type CapturedResponse } from "./capture.ts";
import { checkDestination } from "./destination.ts";

/** The one user agent every collector request declares. Collectors cannot set their own. */
export const COLLECTOR_USER_AGENT = `${PRODUCT_NAME}-collector/1.0`;

export const MAX_FETCH_TIMEOUT_MS = 60_000;
export const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
export const MAX_BYTES_LIMIT = 50 * 1024 * 1024;
export const MAX_REDIRECTS = 5;

export interface FetchRequest {
  /** Stated on every call; there is no default. */
  readonly method: "GET" | "HEAD" | "POST";
  readonly headers?: Readonly<Record<string, string>>;
  /** POST only. */
  readonly body?: string | Uint8Array;
  /**
   * Mandatory, up to 60 s: the whole call, including waiting for a shared
   * rate-limit slot, DNS, every redirect and the full body.
   */
  readonly timeoutMs: number;
  /** Largest body accepted, after decoding. Default 5 MiB, at most 50 MiB. */
  readonly maxBytes?: number;
}

/** A collector's only way out: bound to its source's hosts, limits and user agent. */
export type UpstreamFetch = (url: string, request: FetchRequest) => Promise<CapturedResponse>;

export type RateLimitAnswer =
  { readonly allowed: true } | { readonly allowed: false; readonly retryAfterMs: number };

/** Shared across every process and every collector using a source. */
export interface UpstreamRateLimiter {
  acquire(
    sourceId: string,
    policy: { readonly limit: number; readonly intervalMs: number },
  ): Promise<RateLimitAnswer>;
}

export interface ResolvedAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

export type Resolver = (host: string) => Promise<readonly ResolvedAddress[]>;

/** A connection the fetcher has already checked: this host, at this public address. */
export interface PinnedDestination {
  readonly protocol: "http" | "https";
  readonly host: string;
  readonly port: number;
  readonly address: string;
  readonly family: 4 | 6;
}

/**
 * Tests only: where the bytes of an already-checked connection go. It runs
 * after every check, so it cannot widen which hosts or addresses are allowed.
 * The production composition never sets it.
 */
export type SocketFactory = (destination: PinnedDestination) => Duplex;

export interface NetworkRuntime {
  readonly rateLimiter: UpstreamRateLimiter;
  /** DNS. Defaults to the system resolver; every answer is checked either way. */
  readonly resolver?: Resolver;
  readonly socketFactory?: SocketFactory;
}

const METHODS = new Set(["GET", "HEAD", "POST"]);
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const FORBIDDEN_HEADERS = new Set([
  "host",
  "user-agent",
  "connection",
  "content-length",
  "transfer-encoding",
  "te",
  "trailer",
  "upgrade",
  "keep-alive",
  "accept-encoding",
  "cookie",
  "expect",
]);
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const REDACTED = "[redacted]";

const gunzipAsync = promisify(gunzip);
const inflateAsync = promisify(inflate);
const brotliAsync = promisify(brotliDecompress);

interface ValidRequest {
  readonly method: "GET" | "HEAD" | "POST";
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | Uint8Array | undefined;
  readonly timeoutMs: number;
  readonly maxBytes: number;
}

function validateRequest(request: FetchRequest): ValidRequest {
  const { timeoutMs } = request;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_FETCH_TIMEOUT_MS) {
    throw new FetchOptionsError(
      `timeoutMs is required, an integer from 1 to ${String(MAX_FETCH_TIMEOUT_MS)}`,
    );
  }
  const maxBytes = request.maxBytes ?? DEFAULT_MAX_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_BYTES_LIMIT) {
    throw new FetchOptionsError(`maxBytes must be an integer from 1 to ${String(MAX_BYTES_LIMIT)}`);
  }
  const { method } = request;
  if (!METHODS.has(method)) throw new FetchOptionsError("method must be GET, HEAD or POST");
  if (request.body !== undefined && method !== "POST") {
    throw new FetchOptionsError("only a POST may carry a body");
  }
  const headers: Record<string, string> = {};
  for (const [rawName, value] of Object.entries(request.headers ?? {})) {
    const name = rawName.toLowerCase();
    if (!HEADER_NAME.test(name)) throw new FetchOptionsError(`"${rawName}" is not a header name`);
    if (FORBIDDEN_HEADERS.has(name) || name.startsWith("proxy-")) {
      throw new FetchOptionsError(`the ${name} header is set by the fetcher, not a collector`);
    }
    if (/[\r\n\0]/.test(value))
      throw new FetchOptionsError(`the ${name} header has a control character`);
    headers[name] = value;
  }
  return { method, headers, body: request.body, timeoutMs, maxBytes };
}

const systemResolver: Resolver = async (host) => {
  const answers = await lookup(host, { all: true, verbatim: true });
  return answers.map((answer) => ({
    address: answer.address,
    family: answer.family === 6 ? 6 : 4,
  }));
};

/**
 * Opens the connection to exactly the address that was checked, with no DNS
 * lookup of its own, so nothing can swap the address between the check and
 * the connect. TLS still verifies the certificate against the declared host.
 * This is the only place a socket is opened.
 */
const connectPinned: SocketFactory = (destination) =>
  destination.protocol === "https"
    ? connectTls({
        host: destination.address,
        port: destination.port,
        servername: destination.host,
        ALPNProtocols: ["http/1.1"],
      })
    : connectTcp({ host: destination.address, port: destination.port });

function flattenHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || name === "set-cookie") continue;
    flat[name] = Array.isArray(value) ? value.join(", ") : value;
  }
  return flat;
}

function errorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}

interface RawResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: Buffer;
  readonly receivedAt: Date;
}

async function decode(host: string, raw: RawResponse, maxBytes: number): Promise<Buffer> {
  const encoding = (raw.headers["content-encoding"] ?? "identity").trim().toLowerCase();
  const options = { maxOutputLength: maxBytes };
  try {
    switch (encoding) {
      case "identity":
      case "":
        return raw.body;
      case "gzip":
      case "x-gzip":
        return await gunzipAsync(raw.body, options);
      case "deflate":
        return await inflateAsync(raw.body, options);
      case "br":
        return await brotliAsync(raw.body, options);
      default:
        throw new UpstreamResponseError("the response uses an unsupported content encoding");
    }
  } catch (error) {
    if (error instanceof UpstreamResponseError) throw error;
    if (errorCode(error) === "ERR_BUFFER_TOO_LARGE")
      throw new ResponseTooLargeError(host, maxBytes);
    throw new UpstreamResponseError("the compressed body could not be decoded");
  }
}

/**
 * Builds the fetch a collector gets for one run. It is bound to the
 * collector's source: only its declared hosts, its shared rate limit, the
 * platform user agent, a mandatory timeout, a size limit, and SSRF checks on
 * every hop.
 */
export function createUpstreamFetch(options: {
  readonly source: SourceDeclaration;
  readonly network: NetworkRuntime;
  /** Marks every response this run captures, so evidence can only cite them. */
  readonly run: symbol;
  /** The run's budget; aborting it ends any fetch in flight. */
  readonly signal: AbortSignal;
  /** Credential values, redacted from any recorded URL. */
  readonly secrets: readonly string[];
  /**
   * Called once for every request actually sent to the upstream, redirect
   * hops included, whatever its answer. A request the rate limiter or an
   * address check stops before sending is not called for: it consumed
   * nothing upstream.
   */
  readonly onRequestSent?: (host: string) => void;
  /**
   * The hosts this run may contact. Defaults to the source's static declared
   * hosts. An open-host source passes the one authorised host (the target's),
   * so the request and every redirect are confined to it under the same SSRF
   * checks; it never widens what a static source may reach.
   */
  readonly allowedHosts?: readonly string[];
}): UpstreamFetch {
  const { source, network, run, signal: runSignal } = options;
  const resolver = network.resolver ?? systemResolver;
  const secrets = options.secrets.filter((secret) => secret.length >= 4);

  const scrub = (href: string): string => {
    let scrubbed = href;
    for (const secret of secrets) {
      scrubbed = scrubbed
        .replaceAll(secret, REDACTED)
        .replaceAll(encodeURIComponent(secret), REDACTED);
    }
    return scrubbed;
  };

  return async (rawUrl, request) => {
    const valid = validateRequest(request);
    const declared: SourceNetwork | null = source.network;
    if (declared === null) {
      throw new DestinationRefusedError(
        "HOST_NOT_ALLOWED",
        `source "${source.id}" is not reached over the network`,
      );
    }
    const allowedHosts = options.allowedHosts ?? declared.hosts;
    const deadline = performance.now() + valid.timeoutMs;
    const remaining = () => deadline - performance.now();
    const timedOut = (host: string) => new UpstreamTimeoutError(host, valid.timeoutMs);

    const takeSlot = async (host: string): Promise<void> => {
      const policy = {
        limit: declared.rateLimit.requests,
        intervalMs: declared.rateLimit.intervalSeconds * 1000,
      };
      for (;;) {
        let answer: RateLimitAnswer;
        try {
          answer = await network.rateLimiter.acquire(source.id, policy);
        } catch (error) {
          throw new RateLimiterUnavailableError({ cause: error });
        }
        if (answer.allowed) return;
        const wait = answer.retryAfterMs;
        if (!Number.isFinite(wait) || wait < 1) throw new RateLimiterUnavailableError();
        if (wait >= remaining()) throw new UpstreamRateLimitedError(source.id, wait);
        try {
          await sleep(wait, undefined, { signal: runSignal });
        } catch {
          throw timedOut(host);
        }
      }
    };

    const resolveChecked = async (host: string): Promise<ResolvedAddress> => {
      let answers: readonly ResolvedAddress[];
      try {
        answers = await Promise.race([
          resolver(host),
          sleep(Math.max(1, remaining()), undefined, { ref: false }).then(() => {
            throw timedOut(host);
          }),
        ]);
      } catch (error) {
        if (error instanceof UpstreamTimeoutError) throw error;
        throw new UpstreamUnreachableError(host, { cause: error });
      }
      const [first] = answers;
      if (first === undefined)
        throw new DestinationRefusedError("NO_ADDRESS", `${host} has no address`);
      // Any non-public answer refuses the host outright: the connection could
      // otherwise land on it, and a mixed answer is how DNS rebinding looks.
      if (answers.some((answer) => !isPublicAddress(answer.address))) {
        throw new DestinationRefusedError(
          "ADDRESS_NOT_PUBLIC",
          `${host} resolves to a private, loopback, link-local or reserved address`,
        );
      }
      return first;
    };

    const send = (
      url: URL,
      method: string,
      body: string | Uint8Array | undefined,
      at: ResolvedAddress,
    ) =>
      new Promise<RawResponse>((resolve, reject) => {
        const protocol = declared.protocol;
        const port = protocol === "https" ? 443 : 80;
        const pinned: PinnedDestination = {
          protocol,
          host: url.hostname,
          port,
          address: at.address,
          family: at.family,
        };
        const timeout = AbortSignal.timeout(Math.max(1, Math.floor(remaining())));
        const signal = AbortSignal.any([timeout, runSignal]);
        const openSocket = network.socketFactory ?? connectPinned;
        const requestOptions: https.RequestOptions = {
          host: url.hostname,
          port,
          path: `${url.pathname}${url.search}`,
          method,
          headers: {
            ...valid.headers,
            host: url.host,
            "user-agent": COLLECTOR_USER_AGENT,
            "accept-encoding": "identity",
          },
          signal,
          // No agent: every request gets its own socket, opened by openSocket
          // to the checked address. Node uses createConnection only when no
          // agent is set, so there is no second path that could connect.
          agent: undefined,
          createConnection: () => openSocket(pinned),
        };
        const onResponse = (res: http.IncomingMessage) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > valid.maxBytes) {
              res.destroy(new ResponseTooLargeError(url.hostname, valid.maxBytes));
              return;
            }
            chunks.push(chunk);
          });
          res.on("error", reject);
          res.on("end", () => {
            if (res.statusCode === undefined) {
              reject(new UpstreamResponseError("the response had no status"));
              return;
            }
            resolve({
              status: res.statusCode,
              headers: flattenHeaders(res.headers),
              body: Buffer.concat(chunks),
              receivedAt: new Date(),
            });
          });
        };
        const req =
          protocol === "https"
            ? https.request(requestOptions, onResponse)
            : http.request(requestOptions, onResponse);
        req.on("error", reject);
        req.end(body);
      }).catch((error: unknown) => {
        if (error instanceof ResponseTooLargeError || error instanceof UpstreamResponseError) {
          throw error;
        }
        const code = errorCode(error);
        if ((error instanceof Error && error.name === "AbortError") || code === "ABORT_ERR") {
          throw timedOut(url.hostname);
        }
        if (code !== null && code.startsWith("HPE_")) {
          throw new UpstreamResponseError("the response was not valid HTTP");
        }
        // Refused, reset, unreachable, DNS: the upstream could not be reached.
        throw new UpstreamUnreachableError(url.hostname, { cause: error });
      });

    let url = checkDestination(rawUrl, declared, allowedHosts);
    let method: string = valid.method;
    for (let hop = 0; ; hop++) {
      if (runSignal.aborted || remaining() <= 0) throw timedOut(url.hostname);
      await takeSlot(url.hostname);
      const address = await resolveChecked(url.hostname);
      options.onRequestSent?.(url.hostname);
      const raw = await send(url, method, hop === 0 ? valid.body : undefined, address);
      const location = raw.headers.location;
      if (
        REDIRECTS.has(raw.status) &&
        location !== undefined &&
        (method === "GET" || method === "HEAD")
      ) {
        if (hop >= MAX_REDIRECTS) {
          throw new DestinationRefusedError(
            "TOO_MANY_REDIRECTS",
            `more than ${String(MAX_REDIRECTS)} redirects`,
          );
        }
        if (!URL.canParse(location, url.href)) {
          throw new DestinationRefusedError("MALFORMED_URL", "a redirect's location is not a URL");
        }
        url = checkDestination(new URL(location, url).href, declared, allowedHosts);
        method = method === "HEAD" ? "HEAD" : "GET";
        continue;
      }
      const body = await decode(url.hostname, raw, valid.maxBytes);
      return captureResponse(run, {
        url: scrub(url.href),
        status: raw.status,
        headers: raw.headers,
        body,
        receivedAt: raw.receivedAt,
      });
    }
  };
}

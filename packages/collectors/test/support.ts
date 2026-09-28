import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { connect, type AddressInfo } from "node:net";
import { z } from "zod";
import type {
  NetworkRuntime,
  RateLimitAnswer,
  ResolvedAddress,
  SourceDeclaration,
  UpstreamRateLimiter,
} from "../src/index.ts";

/**
 * Any public address will do: it is only ever checked, never contacted. The
 * socket factory sends the bytes to the local test server instead, after the
 * fetcher has run every check it runs in production.
 */
export const PUBLIC_TEST_ADDRESS = "1.1.1.1";

export interface RecordedRequest {
  readonly host: string;
  readonly method: string;
  readonly path: string;
  readonly headers: IncomingMessage["headers"];
}

export interface TestUpstream {
  readonly port: number;
  readonly requests: RecordedRequest[];
  close(): Promise<void>;
}

/** A real HTTP server on loopback, recording every request that reaches it. */
export async function startUpstream(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<TestUpstream> {
  const requests: RecordedRequest[] = [];
  const server = createServer((request, response) => {
    requests.push({
      host: request.headers.host ?? "",
      method: request.method ?? "",
      path: request.url ?? "",
      headers: request.headers,
    });
    handler(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    port,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}

/** Resolves only the names given; anything else has no address. */
export function resolverFor(answers: Readonly<Record<string, readonly string[]>>) {
  return (host: string): Promise<readonly ResolvedAddress[]> =>
    Promise.resolve(
      (answers[host] ?? []).map((address) => ({
        address,
        family: address.includes(":") ? (6 as const) : (4 as const),
      })),
    );
}

/** A limiter that always allows, for tests about something else. */
export const ALWAYS_ALLOW: UpstreamRateLimiter = {
  acquire: () => Promise.resolve({ allowed: true }),
};

/** An in-process sliding log with the same semantics as the shared Redis one. */
export class MemoryRateLimiter implements UpstreamRateLimiter {
  readonly #log = new Map<string, number[]>();

  acquire(
    sourceId: string,
    policy: { limit: number; intervalMs: number },
  ): Promise<RateLimitAnswer> {
    const now = performance.now();
    const recent = (this.#log.get(sourceId) ?? []).filter((at) => at > now - policy.intervalMs);
    if (recent.length < policy.limit) {
      recent.push(now);
      this.#log.set(sourceId, recent);
      return Promise.resolve({ allowed: true });
    }
    const oldest = recent[0] ?? now;
    this.#log.set(sourceId, recent);
    return Promise.resolve({
      allowed: false,
      retryAfterMs: Math.max(1, Math.ceil(oldest + policy.intervalMs - now)),
    });
  }
}

/** Network wiring that sends every checked connection to the local test server. */
export function testNetwork(
  upstream: TestUpstream,
  options: {
    readonly answers?: Readonly<Record<string, readonly string[]>>;
    readonly rateLimiter?: UpstreamRateLimiter;
  } = {},
): NetworkRuntime {
  return {
    rateLimiter: options.rateLimiter ?? ALWAYS_ALLOW,
    resolver: resolverFor(
      options.answers ?? {
        "one.test": [PUBLIC_TEST_ADDRESS],
        "two.test": [PUBLIC_TEST_ADDRESS],
        "mirror.one.test": [PUBLIC_TEST_ADDRESS],
      },
    ),
    socketFactory: () => connect(upstream.port, "127.0.0.1"),
  };
}

/** A source over plain http, so tests need no certificates. Platform sources are all https. */
export function testSource(
  id: string,
  overrides: Partial<SourceDeclaration> = {},
): SourceDeclaration {
  return {
    id,
    name: `[Test source ${id}]`,
    licence: {
      commercialUse: "PERMITTED",
      reason: "[test source]",
      check: {
        checkedOn: "2026-09-28",
        sourceUrl: "https://example.com/terms",
        recordedIn: "[test]",
      },
    },
    network: {
      protocol: "http",
      hosts: [`${id}.test`],
      rateLimit: { requests: 100, intervalSeconds: 1, basis: "SELF_IMPOSED", note: "[test]" },
    },
    attribution: null,
    ...overrides,
  };
}

export const NAMES_SCHEMA = z.object({ names: z.array(z.string()).min(1) });

export const ENTITLED = { plan: "TECHINT_AND_PERSON", vettingStatus: "APPROVED" } as const;

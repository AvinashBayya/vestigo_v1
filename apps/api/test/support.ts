import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { envSchema, type Env } from "@repo/config";
import { parseTenantId, type TenantId } from "@repo/core";
import {
  createAuthStore,
  createDatabase,
  FileSystemContentStore,
  type AuthStore,
  type Database,
} from "@repo/db";
import {
  ApiKeyService,
  CredentialVault,
  createRedisClient,
  waitForRedisReady,
  FixedWindowRateLimiter,
  MasterKey,
  SlidingLogRateLimiter,
} from "@repo/integrations";
import { CollectorRuntime, createPlatformRegistry, type CollectorRegistry } from "@repo/collectors";
import {
  InvestigationQueue,
  ReportQueue,
  ReportRenderQueue,
  JobReplayer,
  redisUpstreamRateLimiter,
  type QueueConnection,
  type RetryPolicy,
} from "@repo/osint-engine";
import pg from "pg";
import { buildApp } from "../src/app.ts";
import { RunStreamEvent } from "../src/routes/runs.ts";
import { createAuth, ENROLMENT_TOKEN_HEADER, type Auth } from "../src/auth/better-auth.ts";
import { provisionTenant } from "../src/auth/provisioning.ts";
import type { Services } from "../src/services.ts";
import { TEST_API } from "./config.ts";

export const WEB_ORIGIN = "http://localhost:5173";
export const BASE_URL = "http://localhost";

/** LOG_LEVEL when none is set: what a deployment gets unless it chooses otherwise. */
export const DEFAULT_LOG_LEVEL: Env["LOG_LEVEL"] = envSchema.shape.LOG_LEVEL.parse(undefined);

export interface TestApi {
  readonly app: Awaited<ReturnType<typeof buildApp>>;
  readonly services: Services;
  readonly auth: Auth;
  readonly db: Database;
  readonly authStore: AuthStore;
  /** This test API's own job queues: a test starts worker pools on the same ones. */
  readonly queue: QueueConnection;
  /** Where this API instance's content store keeps payloads, so a test can tamper with one. */
  readonly contentDir: string;
  readonly retry: RetryPolicy;
  close(): Promise<void>;
}

/** Fast retries, so a test sees a failing job dead-letter in well under a second. */
export const TEST_RETRY: RetryPolicy = { maxAttempts: 3, baseDelayMs: 20, maxDelayMs: 100 };

/** The real app over the test database and Redis, with a random vault key. */
export async function createTestApi(
  options: {
    readonly apiKeyLimit?: number;
    readonly authRateLimit?: boolean;
    readonly redisUrl?: string;
    /** False for a deliberately unreachable Redis. */
    readonly waitForRedis?: boolean;
    /** The application's LOG_LEVEL. Defaults to the configuration's own default. */
    readonly logLevel?: Env["LOG_LEVEL"];
    /** The registry the run routes label jobs from. Defaults to the platform's. */
    readonly registry?: CollectorRegistry;
    /** Why synthesis is unavailable; null (the default) offers it. */
    readonly synthesisUnavailable?: string | null;
  } = {},
): Promise<TestApi> {
  const quiet = () => undefined;
  const db = createDatabase({ connectionString: TEST_API.runtimeUrl, onConnectionError: quiet });
  const authStore = createAuthStore({
    connectionString: TEST_API.authUrl,
    onConnectionError: quiet,
  });
  const redis = createRedisClient({
    url: options.redisUrl ?? TEST_API.redisUrl,
    commandTimeoutMs: 500,
    connectTimeoutMs: 500,
  });
  if (options.waitForRedis !== false) await waitForRedisReady(redis, { timeoutMs: 2_000 });
  const auth = createAuth({
    authStore,
    db,
    secret: randomBytes(32).toString("base64url"),
    baseUrl: BASE_URL,
    trustedOrigins: [WEB_ORIGIN],
    rateLimit: { enabled: options.authRateLimit ?? false },
    logLevel: options.logLevel ?? DEFAULT_LOG_LEVEL,
  });
  const queue: QueueConnection = {
    url: options.redisUrl ?? TEST_API.redisUrl,
    prefix: `api-${randomUUID().slice(0, 8)}`,
  };
  const registry = options.registry ?? createPlatformRegistry();
  const investigations = new InvestigationQueue(queue, TEST_RETRY);
  const replayer = new JobReplayer({ db, registry, connection: queue, retry: TEST_RETRY });
  const reports = new ReportQueue(queue, TEST_RETRY);
  const renders = new ReportRenderQueue(queue, TEST_RETRY);
  const contentDir = await mkdtemp(join(tmpdir(), "api-content-"));
  const services: Services = {
    db,
    authStore,
    auth,
    vault: new CredentialVault(
      new MasterKey({ keyId: "test-1", keyBase64: randomBytes(32).toString("base64") }),
    ),
    apiKeys: new ApiKeyService(),
    rateLimiter: new FixedWindowRateLimiter({ redis, keyPrefix: `test:${randomUUID()}:` }),
    apiKeyRateLimit: { limit: options.apiKeyLimit ?? 1000, windowSeconds: 60 },
    trustedOrigins: new Set([WEB_ORIGIN, BASE_URL]),
    runs: {
      investigations,
      replayer,
      registry,
      planner: new CollectorRuntime({
        registry,
        // Admission only; most platform sources are UNVERIFIED, and an estimate that excludes them all shows nothing.
        allowUnverifiedSources: true,
        network: {
          rateLimiter: redisUpstreamRateLimiter(
            new SlidingLogRateLimiter({ redis, keyPrefix: `test:${randomUUID()}:upstream` }),
          ),
        },
      }),
      eventsPollMs: 100,
      reports,
      renders,
      contentStore: new FileSystemContentStore(contentDir),
      synthesisUnavailable: options.synthesisUnavailable ?? null,
    },
  };
  const app = await buildApp({ logger: false, services });
  await app.ready();
  return {
    app,
    services,
    auth,
    db,
    authStore,
    queue,
    contentDir,
    retry: TEST_RETRY,
    async close() {
      await app.close();
      await Promise.all([
        investigations.close().catch(quiet),
        replayer.close().catch(quiet),
        reports.close().catch(quiet),
        renders.close().catch(quiet),
      ]);
      await rm(contentDir, { recursive: true, force: true });
      await Promise.all([db.close(), authStore.close(), redis.quit().catch(quiet)]);
    },
  };
}

/** RFC 6238 TOTP (SHA-1, 30 s, 6 digits), as an authenticator app computes it. */
export function totpCode(otpauthUri: string, at: number = Date.now()): string {
  const secret = new URL(otpauthUri).searchParams.get("secret");
  if (secret === null) throw new TypeError("the otpauth URI has no secret");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of secret.replace(/=+$/, "").toUpperCase()) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new TypeError("the TOTP secret is not base32");
    bits += index.toString(2).padStart(5, "0");
  }
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((byte) => Number.parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const digest = createHmac("sha1", key).update(counter).digest();
  const last = digest.at(-1);
  if (last === undefined) throw new TypeError("HMAC produced no digest");
  const offset = last & 0x0f;
  const value = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(value % 1_000_000).padStart(6, "0");
}

type InjectResponse = Awaited<ReturnType<TestApi["app"]["inject"]>>;

interface Reply {
  readonly status: number;
  readonly body: string;
  /** The response bytes as sent: for binary bodies, which `body` decodes lossily. */
  readonly raw: Buffer;
  readonly headers: InjectResponse["headers"];
  /** The HTTP library's own typed JSON accessor. */
  readonly json: InjectResponse["json"];
}

/** A browser-like client: keeps cookies, sends the web origin. */
export class Browser {
  readonly cookies = new Map<string, string>();
  /** Every response body this client has seen, for leak checks. */
  readonly seen: string[] = [];

  readonly #api: TestApi;

  constructor(api: TestApi) {
    this.#api = api;
  }

  async request(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    url: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<Reply> {
    const cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    const response = await this.#api.app.inject({
      method,
      url,
      headers: {
        origin: WEB_ORIGIN,
        ...(cookie === "" ? {} : { cookie }),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...headers,
      },
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    });
    // An invitation's enrolment token travels in the hand-shared link; here
    // it is recorded for the invitee, as the link would deliver it.
    if (url === "/api/v1/members/invitations" && method === "POST" && response.statusCode === 201) {
      const sent = body as { email?: unknown };
      const token = response.json<{ enrolmentToken?: unknown }>().enrolmentToken;
      if (typeof sent.email === "string" && typeof token === "string") {
        rememberEnrolmentToken(sent.email, token);
      }
    }
    const setCookie = response.headers["set-cookie"];
    for (const line of setCookie === undefined
      ? []
      : Array.isArray(setCookie)
        ? setCookie
        : [setCookie]) {
      const [pair = "", ...attributes] = line.split(";");
      const separator = pair.indexOf("=");
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      const expired = attributes.some((attribute) => /max-age=0\b/i.test(attribute.trim()));
      if (expired || value === "") this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    this.seen.push(response.body);
    return {
      status: response.statusCode,
      body: response.body,
      raw: response.rawPayload,
      headers: response.headers,
      json: response.json.bind(response),
    };
  }
}

export interface Account {
  readonly email: string;
  readonly password: string;
  readonly name: string;
}

export function newAccount(tag: string): Account {
  return {
    email: `${tag}-${randomUUID().slice(0, 8)}@example.com`,
    password: `pw-${randomBytes(12).toString("base64url")}`,
    name: `[${tag}]`,
  };
}

export async function provisionTestTenant(
  api: TestApi,
  tag: string,
): Promise<{ tenantId: TenantId; owner: Account; ownerUserId: string }> {
  const owner = newAccount(`${tag}-owner`);
  const provisioned = await provisionTenant(api.auth, api.authStore, {
    name: `[Tenant ${tag}]`,
    slug: `${tag}-${randomUUID().slice(0, 8)}`,
    region: "IN",
    owner,
    operator: "[test suite]",
  });
  rememberEnrolmentToken(owner.email, provisioned.enrolmentToken);
  return { tenantId: provisioned.tenantId, owner, ownerUserId: provisioned.ownerUserId };
}

/** Enrolment tokens handed to accounts in this test process, by email. */
const enrolmentTokens = new Map<string, string>();

export function rememberEnrolmentToken(email: string, token: string): void {
  enrolmentTokens.set(email.toLowerCase(), token);
}

/** The header an enrolment step carries: the account's token, if it was given one. */
export function enrolmentHeaders(email: string): Record<string, string> {
  const token = enrolmentTokens.get(email.toLowerCase());
  return token === undefined ? {} : { [ENROLMENT_TOKEN_HEADER]: token };
}

/** The account's enrolment token, as its link would carry it; throws when none was issued. */
export function enrolmentTokenOf(email: string): string {
  const token = enrolmentTokens.get(email.toLowerCase());
  if (token === undefined) throw new TypeError(`no enrolment token was issued to ${email}`);
  return token;
}

/** TOTP secrets of accounts enrolled in this test process, by email. */
const enrolled = new Map<string, string>();

/** Records an enrolment made by hand, so later sign-ins can answer the challenge. */
export function rememberEnrolment(email: string, totpURI: string): void {
  enrolled.set(email, totpURI);
}

/**
 * Signs in with MFA through the documented session routes, as the web app
 * does: enrols TOTP on first use (with the account's enrolment token), and on
 * later sign-ins answers the second-factor challenge. Returns the otpauth URI.
 */
export async function signInAndEnrol(browser: Browser, account: Account): Promise<string> {
  const signIn = await browser.request("POST", "/api/v1/session/sign-in", {
    email: account.email,
    password: account.password,
  });
  if (signIn.status !== 200) {
    throw new TypeError(`sign-in failed: ${String(signIn.status)} ${signIn.body}`);
  }
  const known = enrolled.get(account.email);
  if (known !== undefined) {
    const second = await browser.request("POST", "/api/v1/session/mfa/verify", {
      method: "TOTP",
      code: totpCode(known),
    });
    if (second.status !== 200) throw new TypeError(`second factor failed: ${second.body}`);
    return known;
  }
  const enrolmentToken = enrolmentHeaders(account.email)[ENROLMENT_TOKEN_HEADER];
  if (enrolmentToken === undefined) {
    throw new TypeError(`no enrolment token was issued to ${account.email}`);
  }
  const enable = await browser.request("POST", "/api/v1/session/mfa/enrolment", {
    password: account.password,
    enrolmentToken,
  });
  if (enable.status !== 200) throw new TypeError(`2FA enrolment failed: ${enable.body}`);
  const { totpUri } = enable.json<{ totpUri: string }>();
  const verify = await browser.request("POST", "/api/v1/session/mfa/enrolment/confirm", {
    code: totpCode(totpUri),
    enrolmentToken,
  });
  if (verify.status !== 200) throw new TypeError(`TOTP verification failed: ${verify.body}`);
  enrolled.set(account.email, totpUri);
  return totpUri;
}

/** Chooses the session's tenant through the documented route. */
export async function setActiveTenant(browser: Browser, tenantId: string): Promise<Reply> {
  return browser.request("POST", "/api/v1/session/tenant", { tenantId });
}

/** Invites a person through the documented members route; the enrolment token is remembered. */
export async function invite(
  inviter: Browser,
  email: string,
  role: "owner" | "admin" | "analyst" | "viewer",
): Promise<Reply> {
  return inviter.request("POST", "/api/v1/members/invitations", { email, role });
}

/**
 * Calls an identity-provider endpoint in-process, with a browser's cookies.
 * No HTTP route reaches most of the provider any more; its own guards (MFA,
 * enrolment tokens, the endpoint allowlist) still protect the calls the API
 * makes to it, and are tested through this. It is never something a client
 * can do.
 */
export async function callProvider(
  api: TestApi,
  browser: Browser | null,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ readonly status: number; readonly body: string; readonly setCookies: string[] }> {
  const cookie =
    browser === null
      ? ""
      : [...browser.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  const response = await api.auth.handler(
    new Request(`${BASE_URL}/api/auth${path}`, {
      method,
      headers: {
        origin: WEB_ORIGIN,
        ...(cookie === "" ? {} : { cookie }),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
  return {
    status: response.status,
    body: await response.text(),
    setCookies: response.headers.getSetCookie(),
  };
}

/** A browser signed in with MFA enrolled and the tenant selected. */
export async function readyBrowser(
  api: TestApi,
  account: Account,
  tenantId: string,
): Promise<Browser> {
  const browser = new Browser(api);
  await signInAndEnrol(browser, account);
  const active = await setActiveTenant(browser, tenantId);
  if (active.status !== 200) throw new TypeError(`set-active failed: ${active.body}`);
  return browser;
}

/**
 * Changes a tenant's plan or vetting status as an operator would, through the
 * schema owner with the tenant context set. The application cannot do this.
 */
export async function setEntitlement(
  tenantId: string,
  change: { readonly plan?: string; readonly vettingStatus?: string },
): Promise<void> {
  const client = new pg.Client({ connectionString: TEST_API.ownerUrl });
  await client.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.tenant_id', $1, true)", [parseTenantId(tenantId)]);
    if (change.plan !== undefined) {
      await client.query("update public.tenants set plan = $1", [change.plan]);
    }
    if (change.vettingStatus !== undefined) {
      await client.query("update public.tenants set vetting_status = $1", [change.vettingStatus]);
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

/** Which of these ids belong to a real account, read as the identity role. */
export async function existingUserIds(ids: readonly string[]): Promise<string[]> {
  const client = new pg.Client({ connectionString: TEST_API.authUrl });
  await client.connect();
  try {
    const result = await client.query<{ id: string }>(
      `select id::text as id from auth."user" where id::text = any($1::text[])`,
      [ids],
    );
    return result.rows.map((row) => row.id);
  } finally {
    await client.end();
  }
}

/** Audit rows of a tenant, newest first, read through the repositories. */
export async function auditRows(api: TestApi, tenantId: TenantId) {
  return api.db.withTenant(tenantId, ({ repos }) => repos.auditLog.recent({ limit: 500 }));
}

/**
 * The events of a closed server-sent event stream, in order. Each is checked
 * against the documented event schema, so every stream test also proves the
 * wire matches the contract the client is generated from.
 */
export function sseEvents(body: string): { event: string; data: Record<string, unknown> }[] {
  return body
    .split("\n\n")
    .filter((block) => block.startsWith("event: "))
    .map((block) => {
      const [eventLine = "", dataLine = ""] = block.split("\n");
      const event = {
        event: eventLine.slice("event: ".length),
        data: JSON.parse(dataLine.slice("data: ".length)) as Record<string, unknown>,
      };
      RunStreamEvent.parse(event);
      return event;
    });
}

/** `promise`, or a failure after `ms`: a stream that never closes must fail the test, not hang it. */
export async function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new TypeError(`${what} did not happen within ${String(ms)} ms`));
        }, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** How many progress streams of this run have been opened (audited ALLOWED). */
export async function runWatches(api: TestApi, tenantId: TenantId, runId: string): Promise<number> {
  const rows = await auditRows(api, tenantId);
  return rows.filter(
    (row) => row.action === "run.watch" && row.targetId === runId && row.outcome === "ALLOWED",
  ).length;
}

/**
 * Starts a request for a run's progress stream and resolves once the stream is
 * open (its access check and audit row have committed), with the response
 * still pending. The stream's first events are written before the audit row
 * commits.
 */
export async function openRunStream<T>(
  api: TestApi,
  tenantId: TenantId,
  runId: string,
  request: () => Promise<T>,
): Promise<{ readonly response: Promise<T> }> {
  const before = await runWatches(api, tenantId, runId);
  const response = request();
  await within(
    (async () => {
      while ((await runWatches(api, tenantId, runId)) === before) {
        await new Promise((done) => setTimeout(done, 25));
      }
    })(),
    10_000,
    "the stream opening",
  );
  // Wrapped: an async function returning the promise itself would wait for it.
  return { response };
}

/**
 * A new member of the tenant with `role`, signed in with MFA enrolled and
 * the tenant selected: invited by `inviter`, signed up, enrolled, joined.
 */
export async function joinAs(
  api: TestApi,
  inviter: Browser,
  tenantId: string,
  role: "owner" | "admin" | "analyst" | "viewer",
  tag: string,
): Promise<Browser> {
  const account = newAccount(tag);
  const invited = await invite(inviter, account.email, role);
  if (invited.status !== 201) throw new TypeError(`invite failed: ${invited.body}`);
  const joiner = new Browser(api);
  await joiner.request("POST", "/api/auth/sign-up/email", account);
  await signInAndEnrol(joiner, account);
  const accept = await joiner.request("POST", "/api/auth/organization/accept-invitation", {
    invitationId: invited.json<{ invitationId: string }>().invitationId,
  });
  if (accept.status !== 200) throw new TypeError(`accept failed: ${accept.body}`);
  const active = await setActiveTenant(joiner, tenantId);
  if (active.status !== 200) throw new TypeError(`set-active failed: ${active.body}`);
  return joiner;
}

/** Runs SQL as the schema owner, in the tenant's context, as an operator would. */
export async function asOwner(tenantId: string, sql: string, params: unknown[]): Promise<void> {
  const client = new pg.Client({ connectionString: TEST_API.ownerUrl });
  await client.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    await client.query(sql, params);
    await client.query("commit");
  } finally {
    await client.end();
  }
}

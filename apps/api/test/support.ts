import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { envSchema, type Env } from "@repo/config";
import { parseTenantId, type TenantId } from "@repo/core";
import { createAuthStore, createDatabase, type AuthStore, type Database } from "@repo/db";
import {
  ApiKeyService,
  CredentialVault,
  createRedisClient,
  waitForRedisReady,
  FixedWindowRateLimiter,
  MasterKey,
} from "@repo/integrations";
import pg from "pg";
import { buildApp } from "../src/app.ts";
import { createAuth, type Auth } from "../src/auth/better-auth.ts";
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
  close(): Promise<void>;
}

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
  } = {},
): Promise<TestApi> {
  const quiet = () => undefined;
  const db = createDatabase({ connectionString: TEST_API.runtimeUrl, onIdleClientError: quiet });
  const authStore = createAuthStore({
    connectionString: TEST_API.authUrl,
    onIdleClientError: quiet,
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
  };
  const app = await buildApp({ logger: false, services });
  await app.ready();
  return {
    app,
    services,
    auth,
    db,
    authStore,
    async close() {
      await app.close();
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
    method: "GET" | "POST",
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
  const provisioned = await provisionTenant(api.auth, {
    name: `[Tenant ${tag}]`,
    slug: `${tag}-${randomUUID().slice(0, 8)}`,
    region: "IN",
    owner,
    operator: "[test suite]",
  });
  return { tenantId: provisioned.tenantId, owner, ownerUserId: provisioned.ownerUserId };
}

/** TOTP secrets of accounts enrolled in this test process, by email. */
const enrolled = new Map<string, string>();

/** Records an enrolment made by hand, so later sign-ins can answer the challenge. */
export function rememberEnrolment(email: string, totpURI: string): void {
  enrolled.set(email, totpURI);
}

/**
 * Signs in with MFA: enrols TOTP on first use, and on later sign-ins answers
 * the second-factor challenge. Returns the otpauth URI.
 */
export async function signInAndEnrol(browser: Browser, account: Account): Promise<string> {
  const signIn = await browser.request("POST", "/api/auth/sign-in/email", {
    email: account.email,
    password: account.password,
  });
  if (signIn.status !== 200) {
    throw new TypeError(`sign-in failed: ${String(signIn.status)} ${signIn.body}`);
  }
  const known = enrolled.get(account.email);
  if (known !== undefined) {
    const second = await browser.request("POST", "/api/auth/two-factor/verify-totp", {
      code: totpCode(known),
    });
    if (second.status !== 200) throw new TypeError(`second factor failed: ${second.body}`);
    return known;
  }
  const enable = await browser.request("POST", "/api/auth/two-factor/enable", {
    password: account.password,
  });
  if (enable.status !== 200) throw new TypeError(`2FA enable failed: ${enable.body}`);
  const { totpURI } = enable.json<{ totpURI: string }>();
  const verify = await browser.request("POST", "/api/auth/two-factor/verify-totp", {
    code: totpCode(totpURI),
  });
  if (verify.status !== 200) throw new TypeError(`TOTP verification failed: ${verify.body}`);
  enrolled.set(account.email, totpURI);
  return totpURI;
}

export async function setActiveTenant(browser: Browser, tenantId: string): Promise<Reply> {
  return browser.request("POST", "/api/auth/organization/set-active", { organizationId: tenantId });
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

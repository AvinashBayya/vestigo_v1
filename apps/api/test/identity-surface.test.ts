/**
 * RELEASE-BLOCKING. No session token can be obtained through the identity
 * provider's HTTP surface.
 *
 * Every endpoint the provider defines (read from the provider itself, so an
 * endpoint a library upgrade adds is covered too) is tried over HTTP, signed in
 * and signed out. Only the endpoints OPEN_IDENTITY_ENDPOINTS lists answer;
 * every other is 404. No response body anywhere carries the session token,
 * and no session is created through it. Sign-in and the session go through
 * /api/v1/session/* (test/session.test.ts).
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OPEN_IDENTITY_ENDPOINTS } from "../src/routes/auth.ts";
import { TEST_API } from "./config.ts";
import {
  Browser,
  callProvider,
  createTestApi,
  invite,
  newAccount,
  provisionTestTenant,
  readyBrowser,
  signInAndEnrol,
  totpCode,
  type Account,
  type TestApi,
} from "./support.ts";

let api: TestApi;
let owner: Account;
let ownerUserId: string;
let ownerBrowser: Browser;
let totpUri: string;

const OPEN = new Set<string>(OPEN_IDENTITY_ENDPOINTS.map((endpoint) => endpoint.path));

beforeAll(async () => {
  api = await createTestApi();
  const provisioned = await provisionTestTenant(api, "surface");
  owner = provisioned.owner;
  ownerUserId = provisioned.ownerUserId;
  ownerBrowser = new Browser(api);
  totpUri = await signInAndEnrol(ownerBrowser, owner);
  ownerBrowser = await readyBrowser(api, owner, provisioned.tenantId);
});

afterAll(async () => {
  await api.close();
});

/** Every endpoint the identity provider defines, with each method it answers to. */
function providerEndpoints(): { method: "GET" | "POST"; path: string }[] {
  const endpoints: { method: "GET" | "POST"; path: string }[] = [];
  for (const candidate of Object.values(api.auth.api as Record<string, unknown>)) {
    const endpoint = candidate as { path?: unknown; options?: { method?: unknown } };
    if (typeof endpoint.path !== "string" || !endpoint.path.startsWith("/")) continue;
    const declared = endpoint.options?.method;
    const declaredList: unknown[] = Array.isArray(declared) ? (declared as unknown[]) : [declared];
    const methods = declaredList.flatMap((method): ("GET" | "POST")[] =>
      method === "*" ? ["GET", "POST"] : method === "GET" || method === "POST" ? [method] : [],
    );
    // A path parameter gets a value of the right shape; a closed path is closed whatever it is.
    const path = endpoint.path.replace(/:[A-Za-z]+/g, "00000000-0000-4000-8000-000000000000");
    for (const method of methods) endpoints.push({ method, path });
  }
  return endpoints;
}

/** The session token a browser holds: its session cookie's value before the signature. */
function tokenOf(browser: Browser): string {
  const cookie = [...browser.cookies].find(([name]) => name.endsWith("session_token"));
  if (cookie === undefined) throw new TypeError("the browser holds no session cookie");
  const token = decodeURIComponent(cookie[1]).split(".")[0] ?? "";
  expect(token.length).toBeGreaterThan(16);
  return token;
}

/** How many sessions the account has, read as the identity role. */
async function sessionCount(userId: string): Promise<number> {
  const client = new pg.Client({ connectionString: TEST_API.authUrl });
  await client.connect();
  try {
    const result = await client.query<{ count: number }>(
      `select count(*)::int as count from auth.session where user_id = $1`,
      [userId],
    );
    return result.rows[0]?.count ?? Number.NaN;
  } finally {
    await client.end();
  }
}

const sessionCookiesIn = (headers: Record<string, unknown>): string[] =>
  [headers["set-cookie"] ?? []]
    .flat()
    .map(String)
    .filter((line) => /session_token=/.test(line));

describe("no session token through the identity provider's HTTP surface (RELEASE-BLOCKING)", () => {
  it("knows the provider's endpoints, including every one whose body carries a session token", () => {
    const paths = providerEndpoints().map((endpoint) => endpoint.path);
    expect(paths.length).toBeGreaterThan(50);
    for (const tokenBearing of [
      "/sign-in/email",
      "/two-factor/verify-totp",
      "/two-factor/verify-backup-code",
      "/get-session",
      "/list-sessions",
      "/change-password",
    ]) {
      expect(paths).toContain(tokenBearing);
    }
    // Each endpoint left open is one the provider really defines.
    for (const open of OPEN) expect(paths).toContain(open.replace(/^\/api\/auth/, ""));
  });

  it("answers over HTTP only on the listed endpoints, signed in or out, and never with the token", async () => {
    const token = tokenOf(ownerBrowser);
    const sessionsBefore = await sessionCount(ownerUserId);
    const signedOut = new Browser(api);
    for (const client of [ownerBrowser, signedOut]) {
      for (const { method, path } of providerEndpoints()) {
        const url = `/api/auth${path}`;
        const label = `${method} ${url} (${client === signedOut ? "signed out" : "signed in"})`;
        const reply = await client.request(method, url, method === "POST" ? {} : undefined);
        if (!(method === "POST" && OPEN.has(url))) expect(reply.status, label).toBe(404);
        expect(reply.body, label).not.toContain(token);
        // No session is handed out: none to a signed-out client, no new one to a signed-in one.
        for (const line of sessionCookiesIn(reply.headers)) {
          expect(client, label).toBe(ownerBrowser);
          expect(line, label).toContain(token);
        }
      }
    }
    expect([...signedOut.cookies.keys()].some((name) => name.endsWith("session_token"))).toBe(
      false,
    );
    expect(await sessionCount(ownerUserId)).toBe(sessionsBefore);
  });

  it("refuses the provider's sign-in and second factor even with valid credentials: no body, no cookie, no session", async () => {
    const sessionsBefore = await sessionCount(ownerUserId);
    const direct = new Browser(api);
    const signIn = await direct.request("POST", "/api/auth/sign-in/email", {
      email: owner.email,
      password: owner.password,
    });
    expect(signIn.status).toBe(404);
    expect(sessionCookiesIn(signIn.headers)).toEqual([]);

    // A live challenge (from the documented sign-in), answered at the provider's own path.
    const challenged = new Browser(api);
    const started = await challenged.request("POST", "/api/v1/session/sign-in", {
      email: owner.email,
      password: owner.password,
    });
    expect(started.json()).toEqual({ next: "MFA_CHALLENGE" });
    const verify = await challenged.request("POST", "/api/auth/two-factor/verify-totp", {
      code: totpCode(totpUri),
    });
    expect(verify.status).toBe(404);
    expect(sessionCookiesIn(verify.headers)).toEqual([]);
    expect([...challenged.cookies.keys()].some((name) => name.endsWith("session_token"))).toBe(
      false,
    );
    expect(await sessionCount(ownerUserId)).toBe(sessionsBefore);
  });

  it("the open endpoints work, and hand out no session token: sign-up and accepting an invitation", async () => {
    const invitee = newAccount("surface-invitee");
    const invited = await invite(ownerBrowser, invitee.email, "viewer");
    expect(invited.status).toBe(201);
    const browser = new Browser(api);

    const signUp = await browser.request("POST", "/api/auth/sign-up/email", invitee);
    expect(signUp.status).toBe(200);
    expect(signUp.json<{ token: unknown }>().token).toBeNull();
    expect(sessionCookiesIn(signUp.headers)).toEqual([]);

    // Signed in and enrolled through the documented routes, the invitee accepts.
    await signInAndEnrol(browser, invitee);
    const token = tokenOf(browser);
    const accepted = await browser.request("POST", "/api/auth/organization/accept-invitation", {
      invitationId: invited.json<{ invitationId: string }>().invitationId,
    });
    expect(accepted.status).toBe(200);
    expect(accepted.body).not.toContain(token);
    // Still the same session: accepting minted no new one.
    expect(tokenOf(browser)).toBe(token);
  });

  it("control: the provider's own answer to a closed endpoint does carry the token, so the checks above can see one", async () => {
    const inProcess = await callProvider(api, ownerBrowser, "GET", "/get-session");
    expect(inProcess.status).toBe(200);
    expect(inProcess.body).toContain(tokenOf(ownerBrowser));
  });
});

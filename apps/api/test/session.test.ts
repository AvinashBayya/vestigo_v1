/**
 * RELEASE-BLOCKING. The web app's sign-in and session routes: each step leads
 * where it should, the identity provider's rules all still apply, a refused
 * step says why, and no response body ever carries a session token.
 */
import type { TenantId } from "@repo/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ENROLMENT_TOKEN_HEADER } from "../src/auth/better-auth.ts";
import {
  Browser,
  callProvider,
  createTestApi,
  enrolmentHeaders,
  provisionTestTenant,
  totpCode,
  type Account,
  type TestApi,
} from "./support.ts";

let api: TestApi;
let tenantId: TenantId;
let otherTenantId: TenantId;
let owner: Account;
let browser: Browser;
let totpUri: string;
let backupCodes: string[];

beforeAll(async () => {
  api = await createTestApi();
  ({ tenantId, owner } = await provisionTestTenant(api, "session"));
  ({ tenantId: otherTenantId } = await provisionTestTenant(api, "session-other"));
  browser = new Browser(api);
});

afterAll(async () => {
  await api.close();
});

const enrolmentToken = (email: string): string => {
  const token = enrolmentHeaders(email)[ENROLMENT_TOKEN_HEADER];
  if (token === undefined) throw new TypeError(`no enrolment token was issued to ${email}`);
  return token;
};

type State =
  | { state: "SIGNED_OUT" }
  | { state: "MFA_ENROLMENT_REQUIRED"; user: { email: string } }
  | {
      state: "SIGNED_IN";
      user: { id: string; email: string; name: string };
      activeTenantId: string | null;
      tenants: { id: string; name: string }[];
    };

const sessionState = async (client: Browser = browser) => {
  const response = await client.request("GET", "/api/v1/session");
  expect(response.status).toBe(200);
  return response.json<State>();
};

describe("first sign-in: enrolment with the provisioning token (RELEASE-BLOCKING)", () => {
  it("starts signed out", async () => {
    expect(await sessionState()).toEqual({ state: "SIGNED_OUT" });
  });

  it("refuses a wrong password with the provider's code, the same for an unknown address", async () => {
    for (const email of [owner.email, "nobody@example.com"]) {
      const refused = await browser.request("POST", "/api/v1/session/sign-in", {
        email,
        password: "[not the password]",
      });
      expect(refused.status).toBe(401);
      expect(refused.json<{ code: string }>().code).toBe("INVALID_EMAIL_OR_PASSWORD");
    }
  });

  it("refuses a sign-in from an untrusted origin", async () => {
    const refused = await browser.request(
      "POST",
      "/api/v1/session/sign-in",
      { email: owner.email, password: owner.password },
      { origin: "https://elsewhere.example" },
    );
    expect(refused.status).toBe(403);
    expect(refused.json<{ code: string }>().code).toBe("ORIGIN_NOT_ALLOWED");
  });

  it("an account without MFA must enrol, and can do nothing else", async () => {
    const signIn = await browser.request("POST", "/api/v1/session/sign-in", {
      email: owner.email,
      password: owner.password,
    });
    expect(signIn.status).toBe(200);
    expect(signIn.json()).toEqual({ next: "MFA_ENROLMENT" });
    expect(await sessionState()).toMatchObject({
      state: "MFA_ENROLMENT_REQUIRED",
      user: { email: owner.email },
    });
    const blocked = await browser.request("GET", "/api/v1/cases");
    expect(blocked.status).toBe(403);
    expect(blocked.json<{ code: string }>().code).toBe("MFA_ENROLLMENT_REQUIRED");
  });

  it("refuses enrolment without the right token or password", async () => {
    const wrongToken = await browser.request("POST", "/api/v1/session/mfa/enrolment", {
      password: owner.password,
      enrolmentToken: "mfa_[not the token]",
    });
    expect(wrongToken.status).toBe(403);
    expect(wrongToken.json<{ code: string }>().code).toBe("MFA_ENROLMENT_TOKEN_INVALID");
    const wrongPassword = await browser.request("POST", "/api/v1/session/mfa/enrolment", {
      password: "[not the password]",
      enrolmentToken: enrolmentToken(owner.email),
    });
    expect(wrongPassword.status).toBeGreaterThanOrEqual(400);
    expect(wrongPassword.status).toBeLessThan(500);
  });

  it("enrols: the secret, as a URI and as text, and backup codes shown once", async () => {
    const started = await browser.request("POST", "/api/v1/session/mfa/enrolment", {
      password: owner.password,
      enrolmentToken: enrolmentToken(owner.email),
    });
    expect(started.status).toBe(200);
    const enrolment = started.json<{ totpUri: string; secret: string; backupCodes: string[] }>();
    expect(enrolment.totpUri).toMatch(/^otpauth:\/\/totp\//);
    expect(new URL(enrolment.totpUri).searchParams.get("secret")).toBe(enrolment.secret);
    expect(enrolment.backupCodes.length).toBeGreaterThan(0);
    totpUri = enrolment.totpUri;
    backupCodes = enrolment.backupCodes;

    const wrongCode = await browser.request("POST", "/api/v1/session/mfa/enrolment/confirm", {
      code: "000000" === totpCode(totpUri) ? "111111" : "000000",
      enrolmentToken: enrolmentToken(owner.email),
    });
    expect(wrongCode.status).toBeGreaterThanOrEqual(400);

    const confirmed = await browser.request("POST", "/api/v1/session/mfa/enrolment/confirm", {
      code: totpCode(totpUri),
      enrolmentToken: enrolmentToken(owner.email),
    });
    expect(confirmed.status).toBe(200);
    expect(confirmed.json<State>()).toMatchObject({
      state: "SIGNED_IN",
      user: { email: owner.email },
      tenants: [{ id: tenantId }],
    });
  });

  it("chooses only a tenant the person belongs to, then the API serves that tenant", async () => {
    const refused = await browser.request("POST", "/api/v1/session/tenant", {
      tenantId: otherTenantId,
    });
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect(refused.status).toBeLessThan(500);

    const chosen = await browser.request("POST", "/api/v1/session/tenant", { tenantId });
    expect(chosen.status).toBe(200);
    expect(chosen.json<State>()).toMatchObject({ state: "SIGNED_IN", activeTenantId: tenantId });
    expect((await browser.request("GET", "/api/v1/cases")).status).toBe(200);
  });

  it("signs out: the session ends, and the API refuses it", async () => {
    const out = await browser.request("POST", "/api/v1/session/sign-out");
    expect(out.status).toBe(200);
    expect(out.json()).toEqual({ state: "SIGNED_OUT" });
    expect(await sessionState()).toEqual({ state: "SIGNED_OUT" });
    expect((await browser.request("GET", "/api/v1/cases")).status).toBe(401);
  });
});

describe("later sign-ins: the MFA challenge (RELEASE-BLOCKING)", () => {
  it("challenges, refuses a wrong code, and signs in with the right one", async () => {
    const signIn = await browser.request("POST", "/api/v1/session/sign-in", {
      email: owner.email,
      password: owner.password,
    });
    expect(signIn.json()).toEqual({ next: "MFA_CHALLENGE" });
    // No session exists until the challenge is answered.
    expect(await sessionState()).toEqual({ state: "SIGNED_OUT" });

    const wrong = await browser.request("POST", "/api/v1/session/mfa/verify", {
      method: "TOTP",
      code: "000000" === totpCode(totpUri) ? "111111" : "000000",
    });
    expect(wrong.status).toBeGreaterThanOrEqual(400);
    expect(wrong.status).toBeLessThan(500);
    expect(wrong.json<{ code: string }>().code.length).toBeGreaterThan(0);

    const verified = await browser.request("POST", "/api/v1/session/mfa/verify", {
      method: "TOTP",
      code: totpCode(totpUri),
    });
    expect(verified.status).toBe(200);
    expect(verified.json<State>()).toMatchObject({
      state: "SIGNED_IN",
      tenants: [{ id: tenantId }],
    });
    await browser.request("POST", "/api/v1/session/sign-out");
  });

  it("accepts a backup code once", async () => {
    const [code] = backupCodes;
    if (code === undefined) throw new TypeError("enrolment returned no backup codes");
    for (const attempt of [0, 1]) {
      const signIn = await browser.request("POST", "/api/v1/session/sign-in", {
        email: owner.email,
        password: owner.password,
      });
      expect(signIn.json()).toEqual({ next: "MFA_CHALLENGE" });
      const verified = await browser.request("POST", "/api/v1/session/mfa/verify", {
        method: "BACKUP_CODE",
        code,
      });
      if (attempt === 0) {
        expect(verified.status).toBe(200);
        expect(verified.json<State>()).toMatchObject({ state: "SIGNED_IN" });
        await browser.request("POST", "/api/v1/session/sign-out");
      } else {
        expect(verified.status).toBeGreaterThanOrEqual(400);
        expect(verified.status).toBeLessThan(500);
      }
    }
  });
});

describe("no session token in any response body (RELEASE-BLOCKING)", () => {
  it("the session cookie's token appears in no body any session route returned", async () => {
    const client = new Browser(api);
    await client.request("POST", "/api/v1/session/sign-in", {
      email: owner.email,
      password: owner.password,
    });
    await client.request("POST", "/api/v1/session/mfa/verify", {
      method: "TOTP",
      code: totpCode(totpUri),
    });
    await client.request("POST", "/api/v1/session/tenant", { tenantId });
    await sessionState(client);
    const cookie = [...client.cookies].find(([name]) => name.endsWith("session_token"));
    if (cookie === undefined) throw new TypeError("no session cookie was set");
    const token = decodeURIComponent(cookie[1]).split(".")[0] ?? "";
    expect(token.length).toBeGreaterThan(16);
    for (const body of client.seen) expect(body).not.toContain(token);
    // And none of this browser's earlier bodies either.
    for (const body of browser.seen) expect(body).not.toContain(token);
  });

  it("control: the provider's own verify response does carry it, so the check above can see one", async () => {
    const raw = new Browser(api);
    await raw.request("POST", "/api/v1/session/sign-in", {
      email: owner.email,
      password: owner.password,
    });
    // Over HTTP the provider's endpoint is closed: no body, no session cookie.
    const overHttp = await raw.request("POST", "/api/auth/two-factor/verify-totp", {
      code: totpCode(totpUri),
    });
    expect(overHttp.status).toBe(404);
    expect([...raw.cookies.keys()].some((name) => name.endsWith("session_token"))).toBe(false);
    // In-process, the provider's own answer carries the session token in its body.
    const inProcess = await callProvider(api, raw, "POST", "/two-factor/verify-totp", {
      code: totpCode(totpUri),
    });
    expect(inProcess.status).toBe(200);
    const sessionCookie = inProcess.setCookies.find((line) => line.includes("session_token="));
    if (sessionCookie === undefined) throw new TypeError("the provider set no session cookie");
    const value = sessionCookie.split(";")[0]?.split("=")[1] ?? "";
    const token = decodeURIComponent(value).split(".")[0] ?? "";
    expect(token.length).toBeGreaterThan(16);
    expect(inProcess.body).toContain(token);
  });
});

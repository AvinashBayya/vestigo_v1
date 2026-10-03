/**
 * RELEASE-BLOCKING. MFA enrolment is bound to a one-time token issued with
 * the invitation (Phase 2B open item "enrol-on-first-login gap", built in
 * Phase 4). A password stolen before its owner enrols cannot enrol the
 * thief's device: every step that could create, reveal or confirm the new
 * secret needs the token, which travels only in the hand-shared invitation
 * link. The token is stored hashed, is the invitee's alone, expires with the
 * invitation, and is spent once enrolment succeeds.
 *
 * Browsers enrol through the documented session routes; the identity
 * provider's own MFA endpoints are not reachable over HTTP. Each guard is
 * checked where a browser meets it (the documented routes) and where the
 * provider itself enforces it (in-process, as the API's own calls run).
 */
import { createHash } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { ENROLMENT_TOKEN_HEADER } from "../src/auth/better-auth.ts";
import { TEST_API } from "./config.ts";
import {
  Browser,
  callProvider,
  createTestApi,
  enrolmentTokenOf,
  invite,
  newAccount,
  provisionTestTenant,
  readyBrowser,
  rememberEnrolment,
  signInAndEnrol,
  totpCode,
  type Account,
  type TestApi,
} from "./support.ts";
import type { TenantId } from "@repo/core";

let api: TestApi;
let owner: Browser;
let tenantId: TenantId;

beforeAll(async () => {
  api = await createTestApi();
  const provisioned = await provisionTestTenant(api, "mfa");
  tenantId = provisioned.tenantId;
  owner = await readyBrowser(api, provisioned.owner, tenantId);
});

afterAll(async () => {
  await api.close();
});

/** Invites and signs up a new account, which is then signed in with its password only. */
async function invitedAndSignedIn(tag: string): Promise<{
  account: Account;
  token: string;
  invitationId: string;
  browser: Browser;
}> {
  const account = newAccount(tag);
  const invited = await invite(owner, account.email, "analyst");
  expect(invited.status).toBe(201);
  const { invitationId, enrolmentToken } = invited.json<{
    invitationId: string;
    enrolmentToken: string;
  }>();
  expect(enrolmentToken).toMatch(/^mfa_[A-Za-z0-9_-]{43}$/);
  const browser = new Browser(api);
  expect((await browser.request("POST", "/api/auth/sign-up/email", account)).status).toBe(200);
  const signIn = await browser.request("POST", "/api/v1/session/sign-in", {
    email: account.email,
    password: account.password,
  });
  expect(signIn.status).toBe(200);
  expect(signIn.json()).toEqual({ next: "MFA_ENROLMENT" });
  return { account, token: enrolmentToken, invitationId, browser };
}

/** Starts enrolment through the documented route. */
const enrol = (browser: Browser, password: string, enrolmentToken: string) =>
  browser.request("POST", "/api/v1/session/mfa/enrolment", { password, enrolmentToken });

/** Confirms enrolment through the documented route. */
const confirm = (browser: Browser, code: string, enrolmentToken: string) =>
  browser.request("POST", "/api/v1/session/mfa/enrolment/confirm", { code, enrolmentToken });

/** The problem code a refusal carries. */
const codeOf = (reply: { json: () => unknown }) =>
  z.object({ code: z.string() }).parse(reply.json()).code;

async function authQuery<T extends pg.QueryResultRow>(sql: string, params: unknown[]) {
  const client = new pg.Client({ connectionString: TEST_API.authUrl });
  await client.connect();
  try {
    return (await client.query<T>(sql, params)).rows;
  } finally {
    await client.end();
  }
}

describe("MFA enrolment needs the invitation's one-time token (RELEASE-BLOCKING)", () => {
  it("regression (the enrol-on-first-login gap): a stolen password alone cannot enrol a device", async () => {
    const { account } = await invitedAndSignedIn("mfa-thief");
    // The thief has the password and a session, but not the link.
    const thief = new Browser(api);
    await thief.request("POST", "/api/v1/session/sign-in", {
      email: account.email,
      password: account.password,
    });
    // Where a browser meets it: no token, or a guessed one, gets nothing.
    expect((await enrol(thief, account.password, "")).status).toBe(400);
    const guessed = await enrol(thief, account.password, "mfa_[a guess]");
    expect(guessed.status).toBe(403);
    expect(codeOf(guessed)).toBe("MFA_ENROLMENT_TOKEN_INVALID");
    // The provider's own enrolment endpoint is not reachable over HTTP…
    expect(
      (
        await thief.request("POST", "/api/auth/two-factor/enable", {
          password: account.password,
        })
      ).status,
    ).toBe(404);
    // …and refuses a call without the token wherever it is made.
    const inProcess = await callProvider(api, thief, "POST", "/two-factor/enable", {
      password: account.password,
    });
    expect(inProcess.status).toBe(403);
    expect(inProcess.body).toContain("MFA_ENROLMENT_TOKEN_REQUIRED");
    // And everything else stays closed until enrolment.
    expect((await thief.request("GET", "/api/v1/me")).json()).toMatchObject({
      code: "MFA_ENROLLMENT_REQUIRED",
    });
  });

  it("refuses a wrong token, and another invitee's token", async () => {
    const first = await invitedAndSignedIn("mfa-first");
    const second = await invitedAndSignedIn("mfa-second");
    const wrong = await enrol(
      first.browser,
      first.account.password,
      "mfa_not-the-right-token-at-all-000000000000000",
    );
    expect(wrong.status).toBe(403);
    expect(codeOf(wrong)).toBe("MFA_ENROLMENT_TOKEN_INVALID");
    const borrowed = await enrol(first.browser, first.account.password, second.token);
    expect(borrowed.status).toBe(403);
    expect(codeOf(borrowed)).toBe("MFA_ENROLMENT_TOKEN_INVALID");
  });

  it("guards every step that could reveal or confirm the pending secret, not only the first", async () => {
    const { account, token, browser } = await invitedAndSignedIn("mfa-steps");
    const started = await enrol(browser, account.password, token);
    expect(started.status).toBe(200);
    const { totpUri } = started.json<{ totpUri: string }>();
    // A thief signed in with the password, after the owner started enrolment,
    // can neither read the pending secret nor confirm it.
    const thief = new Browser(api);
    await thief.request("POST", "/api/v1/session/sign-in", {
      email: account.email,
      password: account.password,
    });
    const thiefConfirm = await confirm(thief, totpCode(totpUri), "mfa_[a guess]");
    expect(thiefConfirm.status).toBe(403);
    expect(codeOf(thiefConfirm)).toBe("MFA_ENROLMENT_TOKEN_INVALID");
    // The provider's own steps refuse it too, wherever they are called.
    const uri = await callProvider(api, thief, "POST", "/two-factor/get-totp-uri", {
      password: account.password,
    });
    expect(uri.status).toBe(403);
    expect(uri.body).toContain("MFA_ENROLMENT_TOKEN_REQUIRED");
    const verify = await callProvider(api, thief, "POST", "/two-factor/verify-totp", {
      code: totpCode(totpUri),
    });
    expect(verify.status).toBe(403);
    // The owner, with the token, completes enrolment.
    const confirmed = await confirm(browser, totpCode(totpUri), token);
    expect(confirmed.status).toBe(200);
    rememberEnrolment(account.email, totpUri);
  });

  it("is spent once enrolment succeeds, and an enrolled account signs in without it", async () => {
    const { account, token, browser } = await invitedAndSignedIn("mfa-spent");
    const started = await enrol(browser, account.password, token);
    const { totpUri } = started.json<{ totpUri: string }>();
    expect((await confirm(browser, totpCode(totpUri), token)).status).toBe(200);
    rememberEnrolment(account.email, totpUri);
    const rows = await authQuery<{ hash: string | null }>(
      `select mfa_enrolment_token_hash as hash from auth."user" where email = $1`,
      [account.email],
    );
    expect(rows).toEqual([{ hash: null }]);
    // The second factor at sign-in needs no token: it proves the enrolled device.
    const later = new Browser(api);
    await signInAndEnrol(later, account);
    const session = await later.request("GET", "/api/v1/session");
    expect(session.json()).toMatchObject({ state: "SIGNED_IN" });
  });

  it("stores only the token's hash, and never returns it after the invitation", async () => {
    const { account, token, invitationId, browser } = await invitedAndSignedIn("mfa-hash");
    const hash = `sha256:${createHash("sha256").update(token).digest("hex")}`;
    const invitation = await authQuery<{ hash: string }>(
      `select enrolment_token_hash as hash from auth.invitation where id = $1`,
      [invitationId],
    );
    expect(invitation).toEqual([{ hash }]);
    const user = await authQuery<{ hash: string }>(
      `select mfa_enrolment_token_hash as hash from auth."user" where email = $1`,
      [account.email],
    );
    expect(user).toEqual([{ hash }]);
    // Neither what a browser can read, nor what the provider itself answers.
    const bodies = [
      (await browser.request("GET", "/api/v1/session")).body,
      (await owner.request("GET", "/api/v1/members/invitations")).body,
      (await callProvider(api, browser, "GET", "/get-session")).body,
      (
        await callProvider(
          api,
          owner,
          "GET",
          `/organization/list-invitations?organizationId=${tenantId}`,
        )
      ).body,
    ];
    for (const body of bodies) {
      expect(body).not.toContain(token);
      expect(body).not.toContain(hash);
      expect(body).not.toMatch(/enrolment_token|enrolmentTokenHash|mfaEnrolment/i);
    }
  });

  it("expires with the invitation", async () => {
    const { account, token, browser } = await invitedAndSignedIn("mfa-expired");
    await authQuery(
      `update auth."user" set mfa_enrolment_token_expires_at = now() - interval '1 minute' where email = $1`,
      [account.email],
    );
    const expired = await enrol(browser, account.password, token);
    expect(expired.status).toBe(403);
    expect(codeOf(expired)).toBe("MFA_ENROLMENT_TOKEN_INVALID");
  });

  it("re-inviting someone who never enrolled issues a fresh token, and the old one stops working", async () => {
    const { account, token, browser } = await invitedAndSignedIn("mfa-reinvite");
    const again = await invite(owner, account.email, "analyst");
    expect(again.status).toBe(201);
    const fresh = again.json<{ enrolmentToken: string }>().enrolmentToken;
    expect(fresh).not.toBe(token);
    expect((await enrol(browser, account.password, token)).status).toBe(403);
    expect((await enrol(browser, account.password, fresh)).status).toBe(200);
  });

  it("a provisioned owner enrols only with the token the operator was given", async () => {
    const provisioned = await provisionTestTenant(api, "mfa-provisioned");
    const browser = new Browser(api);
    const signIn = await browser.request("POST", "/api/v1/session/sign-in", {
      email: provisioned.owner.email,
      password: provisioned.owner.password,
    });
    expect(signIn.json()).toEqual({ next: "MFA_ENROLMENT" });
    expect((await enrol(browser, provisioned.owner.password, "mfa_[a guess]")).status).toBe(403);
    const without = await callProvider(api, browser, "POST", "/two-factor/enable", {
      password: provisioned.owner.password,
    });
    expect(without.status).toBe(403);
    const withIt = await enrol(
      browser,
      provisioned.owner.password,
      enrolmentTokenOf(provisioned.owner.email),
    );
    expect(withIt.status).toBe(200);
    // The header the provider reads is the one the documented route sets.
    expect(ENROLMENT_TOKEN_HEADER).toBe("x-mfa-enrolment-token");
  });
});

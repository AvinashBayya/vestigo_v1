/**
 * RELEASE-BLOCKING. MFA enrolment is bound to a one-time token issued with
 * the invitation (Phase 2B open item "enrol-on-first-login gap", built in
 * Phase 4). A password stolen before its owner enrols cannot enrol the
 * thief's device: every step that could create, reveal or confirm the new
 * secret needs the token, which travels only in the hand-shared invitation
 * link. The token is stored hashed, is the invitee's alone, expires with the
 * invitation, and is spent once enrolment succeeds.
 */
import { createHash } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ENROLMENT_TOKEN_HEADER } from "../src/auth/better-auth.ts";
import { TEST_API } from "./config.ts";
import {
  Browser,
  createTestApi,
  enrolmentHeaders,
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
  const invite = await owner.request("POST", "/api/auth/organization/invite-member", {
    email: account.email,
    role: "analyst",
    organizationId: tenantId,
  });
  expect(invite.status).toBe(200);
  const { id, enrolmentToken } = invite.json<{ id: string; enrolmentToken: string }>();
  expect(enrolmentToken).toMatch(/^mfa_[A-Za-z0-9_-]{43}$/);
  const browser = new Browser(api);
  expect((await browser.request("POST", "/api/auth/sign-up/email", account)).status).toBe(200);
  const signIn = await browser.request("POST", "/api/auth/sign-in/email", {
    email: account.email,
    password: account.password,
  });
  expect(signIn.status).toBe(200);
  return { account, token: enrolmentToken, invitationId: id, browser };
}

const withToken = (token: string) => ({ [ENROLMENT_TOKEN_HEADER]: token });

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
    await thief.request("POST", "/api/auth/sign-in/email", {
      email: account.email,
      password: account.password,
    });
    const enable = await thief.request("POST", "/api/auth/two-factor/enable", {
      password: account.password,
    });
    expect(enable.status).toBe(403);
    expect(enable.body).toContain("MFA_ENROLMENT_TOKEN_REQUIRED");
    // And everything else stays closed until enrolment.
    expect((await thief.request("GET", "/api/v1/me")).json()).toMatchObject({
      code: "MFA_ENROLLMENT_REQUIRED",
    });
  });

  it("refuses a wrong token, and another invitee's token", async () => {
    const first = await invitedAndSignedIn("mfa-first");
    const second = await invitedAndSignedIn("mfa-second");
    const wrong = await first.browser.request(
      "POST",
      "/api/auth/two-factor/enable",
      { password: first.account.password },
      withToken("mfa_not-the-right-token-at-all-000000000000000"),
    );
    expect(wrong.status).toBe(403);
    expect(wrong.body).toContain("MFA_ENROLMENT_TOKEN_INVALID");
    const borrowed = await first.browser.request(
      "POST",
      "/api/auth/two-factor/enable",
      { password: first.account.password },
      withToken(second.token),
    );
    expect(borrowed.status).toBe(403);
    expect(borrowed.body).toContain("MFA_ENROLMENT_TOKEN_INVALID");
  });

  it("guards every step that could reveal or confirm the pending secret, not only the first", async () => {
    const { account, token, browser } = await invitedAndSignedIn("mfa-steps");
    const enable = await browser.request(
      "POST",
      "/api/auth/two-factor/enable",
      { password: account.password },
      withToken(token),
    );
    expect(enable.status).toBe(200);
    const { totpURI } = enable.json<{ totpURI: string }>();
    // A thief signed in with the password, after the owner's enable, can
    // neither read the pending secret nor confirm it.
    const thief = new Browser(api);
    await thief.request("POST", "/api/auth/sign-in/email", {
      email: account.email,
      password: account.password,
    });
    const uri = await thief.request("POST", "/api/auth/two-factor/get-totp-uri", {
      password: account.password,
    });
    expect(uri.status).toBe(403);
    expect(uri.body).toContain("MFA_ENROLMENT_TOKEN_REQUIRED");
    const confirm = await thief.request("POST", "/api/auth/two-factor/verify-totp", {
      code: totpCode(totpURI),
    });
    expect(confirm.status).toBe(403);
    // The owner, with the token, completes enrolment.
    const verify = await browser.request(
      "POST",
      "/api/auth/two-factor/verify-totp",
      { code: totpCode(totpURI) },
      withToken(token),
    );
    expect(verify.status).toBe(200);
    rememberEnrolment(account.email, totpURI);
  });

  it("is spent once enrolment succeeds, and an enrolled account signs in without it", async () => {
    const { account, token, browser } = await invitedAndSignedIn("mfa-spent");
    const enable = await browser.request(
      "POST",
      "/api/auth/two-factor/enable",
      { password: account.password },
      withToken(token),
    );
    const { totpURI } = enable.json<{ totpURI: string }>();
    await browser.request(
      "POST",
      "/api/auth/two-factor/verify-totp",
      { code: totpCode(totpURI) },
      withToken(token),
    );
    rememberEnrolment(account.email, totpURI);
    const rows = await authQuery<{ hash: string | null }>(
      `select mfa_enrolment_token_hash as hash from auth."user" where email = $1`,
      [account.email],
    );
    expect(rows).toEqual([{ hash: null }]);
    // The second factor at sign-in needs no token: it proves the enrolled device.
    const later = new Browser(api);
    await signInAndEnrol(later, account);
    expect((await later.request("GET", "/api/auth/get-session")).status).toBe(200);
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
    const session = await browser.request("GET", "/api/auth/get-session");
    const invitations = await owner.request(
      "GET",
      `/api/auth/organization/list-invitations?organizationId=${tenantId}`,
    );
    for (const body of [session.body, invitations.body]) {
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
    const enable = await browser.request(
      "POST",
      "/api/auth/two-factor/enable",
      { password: account.password },
      withToken(token),
    );
    expect(enable.status).toBe(403);
    expect(enable.body).toContain("MFA_ENROLMENT_TOKEN_INVALID");
  });

  it("re-inviting someone who never enrolled issues a fresh token, and the old one stops working", async () => {
    const { account, token, browser } = await invitedAndSignedIn("mfa-reinvite");
    const again = await owner.request("POST", "/api/auth/organization/invite-member", {
      email: account.email,
      role: "analyst",
      organizationId: tenantId,
    });
    expect(again.status).toBe(200);
    const fresh = again.json<{ enrolmentToken: string }>().enrolmentToken;
    expect(fresh).not.toBe(token);
    const stale = await browser.request(
      "POST",
      "/api/auth/two-factor/enable",
      { password: account.password },
      withToken(token),
    );
    expect(stale.status).toBe(403);
    const current = await browser.request(
      "POST",
      "/api/auth/two-factor/enable",
      { password: account.password },
      withToken(fresh),
    );
    expect(current.status).toBe(200);
  });

  it("a provisioned owner enrols only with the token the operator was given", async () => {
    const provisioned = await provisionTestTenant(api, "mfa-provisioned");
    const browser = new Browser(api);
    await browser.request("POST", "/api/auth/sign-in/email", {
      email: provisioned.owner.email,
      password: provisioned.owner.password,
    });
    const without = await browser.request("POST", "/api/auth/two-factor/enable", {
      password: provisioned.owner.password,
    });
    expect(without.status).toBe(403);
    const withIt = await browser.request(
      "POST",
      "/api/auth/two-factor/enable",
      { password: provisioned.owner.password },
      enrolmentHeaders(provisioned.owner.email),
    );
    expect(withIt.status).toBe(200);
  });
});

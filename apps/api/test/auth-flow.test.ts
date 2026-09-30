/**
 * RELEASE-BLOCKING. The sign-in flow: password, then TOTP, then a tenant, and
 * only then any action; and every action lands in the tenant's audit log with
 * who, what, when and under what authorisation.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditRows,
  Browser,
  createTestApi,
  existingUserIds,
  newAccount,
  provisionTestTenant,
  rememberEnrolment,
  setActiveTenant,
  signInAndEnrol,
  totpCode,
  type Account,
  type TestApi,
  enrolmentHeaders,
} from "./support.ts";
import type { TenantId } from "@repo/core";

let api: TestApi;
let tenantId: TenantId;
let owner: Account;
let ownerUserId: string;

beforeAll(async () => {
  api = await createTestApi();
  ({ tenantId, owner, ownerUserId } = await provisionTestTenant(api, "flow"));
});

afterAll(async () => {
  await api.close();
});

describe("sign-in, MFA and the first action (RELEASE-BLOCKING)", () => {
  it("runs login → MFA → authenticated request → audit row", async () => {
    const browser = new Browser(api);

    // 1. Password only: signed in, but nothing works until TOTP is enrolled.
    const signIn = await browser.request("POST", "/api/auth/sign-in/email", {
      email: owner.email,
      password: owner.password,
    });
    expect(signIn.status).toBe(200);
    expect((await browser.request("GET", "/api/v1/me")).json()).toMatchObject({
      code: "MFA_ENROLLMENT_REQUIRED",
    });
    const blockedOrg = await browser.request("POST", "/api/auth/organization/set-active", {
      organizationId: tenantId,
    });
    expect(blockedOrg.status).toBe(403);
    expect(blockedOrg.body).toContain("MFA_ENROLLMENT_REQUIRED");

    // 2. Enrol TOTP, with the enrolment token handed over at provisioning.
    const enable = await browser.request(
      "POST",
      "/api/auth/two-factor/enable",
      { password: owner.password },
      enrolmentHeaders(owner.email),
    );
    expect(enable.status).toBe(200);
    const { totpURI } = enable.json<{ totpURI: string }>();
    expect(totpURI).toMatch(/^otpauth:\/\/totp\//);
    const enrolled = await browser.request(
      "POST",
      "/api/auth/two-factor/verify-totp",
      { code: totpCode(totpURI) },
      enrolmentHeaders(owner.email),
    );
    expect(enrolled.status).toBe(200);
    rememberEnrolment(owner.email, totpURI);

    // 3. A fresh sign-in now stops at the second factor: no session yet.
    await browser.request("POST", "/api/auth/sign-out", {});
    const fresh = new Browser(api);
    const password = await fresh.request("POST", "/api/auth/sign-in/email", {
      email: owner.email,
      password: owner.password,
    });
    expect(password.json()).toMatchObject({ twoFactorRedirect: true });
    expect((await fresh.request("GET", "/api/v1/me")).status).toBe(401);

    const secondFactor = await fresh.request("POST", "/api/auth/two-factor/verify-totp", {
      code: totpCode(totpURI),
    });
    expect(secondFactor.status).toBe(200);

    // 4. Choose the tenant, then act.
    expect((await fresh.request("GET", "/api/v1/me")).json()).toMatchObject({
      code: "NO_ACTIVE_TENANT",
    });
    expect((await setActiveTenant(fresh, tenantId)).status).toBe(200);

    const me = await fresh.request("GET", "/api/v1/me");
    expect(me.status).toBe(200);
    expect(me.json()).toMatchObject({
      authMethod: "SESSION",
      user: { id: ownerUserId, email: owner.email },
      tenant: { id: tenantId, plan: "TECHINT", vettingStatus: "NOT_SUBMITTED" },
    });

    const created = await fresh.request("POST", "/api/v1/investigations", {
      title: "[Flow investigation]",
      target: "example.com",
    });
    expect(created.status).toBe(201);
    const investigation = created.json<{ id: string }>();

    // 5. The audit row: who, what, when, which tenant, under what authorisation.
    const rows = await auditRows(api, tenantId);
    const row = rows.find((entry) => entry.action === "investigation.create");
    expect(row).toMatchObject({
      tenantId,
      actorKind: "USER",
      actorUserId: ownerUserId,
      targetType: "investigation",
      targetId: investigation.id,
      outcome: "ALLOWED",
      authMethod: "SESSION",
      permission: "investigation:create",
    });
    expect(row?.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(row?.recordedAt).toBeInstanceOf(Date);
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    expect(row?.requestId).toMatch(UUID);

    // Switching tenant is itself audited, tied to its request, which the
    // client cannot choose.
    const switched = rows.find((entry) => entry.action === "tenant.set_active");
    expect(switched?.requestId).toMatch(UUID);
    const spoofed = await fresh.request(
      "POST",
      "/api/auth/organization/set-active",
      { organizationId: tenantId },
      { "x-request-id": "chosen-by-the-client" },
    );
    expect(spoofed.status).toBe(200);
    const latest = (await auditRows(api, tenantId)).find(
      (entry) => entry.action === "tenant.set_active",
    );
    expect(latest?.requestId).toMatch(UUID);
  });

  it("refuses a wrong TOTP code", async () => {
    const { owner: freshOwner } = await provisionTestTenant(api, "wrong-code");
    const browser = new Browser(api);
    const totpURI = await signInAndEnrol(browser, freshOwner);
    await browser.request("POST", "/api/auth/sign-out", {});
    const again = new Browser(api);
    await again.request("POST", "/api/auth/sign-in/email", {
      email: freshOwner.email,
      password: freshOwner.password,
    });
    const good = totpCode(totpURI);
    const wrong = String((Number(good) + 1) % 1_000_000).padStart(6, "0");
    const refused = await again.request("POST", "/api/auth/two-factor/verify-totp", {
      code: wrong,
    });
    expect(refused.status).toBe(401);
    expect((await again.request("GET", "/api/v1/me")).status).toBe(401);
  });

  it("MFA can never be switched off", async () => {
    const browser = new Browser(api);
    await signInAndEnrol(browser, (await provisionTestTenant(api, "no-disable")).owner);
    const disable = await browser.request("POST", "/api/auth/two-factor/disable", {
      password: "irrelevant-password",
    });
    expect(disable.status).toBe(403);
    expect(disable.body).toContain("MFA_REQUIRED");
  });

  it("sign-up needs an invitation, and a refusal does not reveal whether the email exists", async () => {
    const outsider = newAccount("outsider");
    const browser = new Browser(api);
    // The identity provider answers a refused sign-up exactly like an accepted
    // one (anti-enumeration), so the proof is that no account was created.
    await browser.request("POST", "/api/auth/sign-up/email", outsider);
    const signIn = await browser.request("POST", "/api/auth/sign-in/email", {
      email: outsider.email,
      password: outsider.password,
    });
    expect(signIn.status).toBe(401);
    expect(await api.authStore.hasPendingInvitation(outsider.email)).toBe(false);
  });

  // CLAUDE.md §1, "The one exception: sign-up refusal responses". This pins
  // exactly what the exception allows, so a change in the identity provider's
  // behaviour fails here and the rule is revisited, not silently widened.
  it("a refused sign-up, for either reason, gets the documented decoy: 200 and a user that does not exist", async () => {
    const browser = new Browser(api);
    const noInvitation = newAccount("decoy");
    const existing = { ...newAccount("decoy-existing"), email: owner.email };
    const replies = [
      await browser.request("POST", "/api/auth/sign-up/email", noInvitation),
      await browser.request("POST", "/api/auth/sign-up/email", existing),
    ];

    const users = replies.map((reply) => {
      expect(reply.status).toBe(200);
      const body = reply.json<{ token: unknown; user: Record<string, unknown> }>();
      expect(body.token).toBeNull();
      expect(body.user).toMatchObject({ emailVerified: false });
      return body.user;
    });
    const [refused, duplicate] = users;
    if (refused === undefined || duplicate === undefined) return expect.fail("two replies");
    // Both refusals look the same, and each echoes only what was submitted.
    expect(Object.keys(refused).sort()).toEqual(Object.keys(duplicate).sort());
    expect(refused).toMatchObject({ email: noInvitation.email, name: noInvitation.name });
    expect(duplicate).toMatchObject({ email: owner.email, name: existing.name });

    // The decoy ids name no account, and the real account's id is never revealed.
    const ids = users.map((user) => String(user.id));
    expect(ids).not.toContain(ownerUserId);
    expect(await existingUserIds(ids)).toEqual([]);
    // The existing account is untouched: its own password still signs in.
    const ownerSignIn = await new Browser(api).request("POST", "/api/auth/sign-in/email", {
      email: owner.email,
      password: owner.password,
    });
    expect(ownerSignIn.status).toBe(200);
  });

  it("a cookie-authenticated change from an untrusted origin is refused", async () => {
    const browser = new Browser(api);
    await signInAndEnrol(browser, owner);
    await setActiveTenant(browser, tenantId);
    const forged = await browser.request(
      "POST",
      "/api/v1/investigations",
      { title: "[forged]", target: "example.com" },
      { origin: "https://attacker.example" },
    );
    expect(forged.status).toBe(403);
    expect(forged.json()).toMatchObject({ code: "ORIGIN_NOT_ALLOWED" });
  });

  it("an organisation endpoint that has not been reviewed is not exposed", async () => {
    const browser = new Browser(api);
    await signInAndEnrol(browser, owner);
    const response = await browser.request("POST", "/api/auth/organization/check-slug", {
      slug: "anything",
    });
    expect(response.status).toBe(404);
  });

  it("nobody can create a tenant through the API", async () => {
    const browser = new Browser(api);
    await signInAndEnrol(browser, owner);
    const response = await browser.request("POST", "/api/auth/organization/create", {
      name: "[Self-made tenant]",
      slug: "self-made",
    });
    expect(response.status).toBe(403);
  });

  it("an invited analyst can join, enrol, act, and is limited to the analyst's permissions", async () => {
    const admin = new Browser(api);
    await signInAndEnrol(admin, owner);
    await setActiveTenant(admin, tenantId);
    const analyst = newAccount("analyst");
    const invite = await admin.request("POST", "/api/auth/organization/invite-member", {
      email: analyst.email,
      role: "analyst",
      organizationId: tenantId,
    });
    expect(invite.status).toBe(200);
    const invitationId = invite.json<{ id: string }>().id;

    const joiner = new Browser(api);
    expect((await joiner.request("POST", "/api/auth/sign-up/email", analyst)).status).toBe(200);
    await signInAndEnrol(joiner, analyst);
    const accept = await joiner.request("POST", "/api/auth/organization/accept-invitation", {
      invitationId,
    });
    expect(accept.status).toBe(200);
    expect((await setActiveTenant(joiner, tenantId)).status).toBe(200);

    expect(
      (
        await joiner.request("POST", "/api/v1/investigations", {
          title: "[Analyst investigation]",
          target: "example.org",
        })
      ).status,
    ).toBe(201);
    const denied = await joiner.request("GET", "/api/v1/audit-log");
    expect(denied.status).toBe(403);
    expect(denied.json()).toMatchObject({ code: "PERMISSION_DENIED" });

    const rows = await auditRows(api, tenantId);
    expect(rows.find((row) => row.action === "invitation.create")).toMatchObject({
      outcome: "ALLOWED",
      permission: "invitation:create",
      targetId: invitationId,
    });
    expect(rows.find((row) => row.action === "invitation.accept")).toMatchObject({
      outcome: "ALLOWED",
    });
    expect(
      rows.find((row) => row.action === "audit_log.read" && row.outcome === "DENIED"),
    ).toMatchObject({
      permission: "audit:read",
      authMethod: "SESSION",
    });
  });
});

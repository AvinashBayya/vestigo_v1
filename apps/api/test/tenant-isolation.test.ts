/**
 * RELEASE-BLOCKING. A session from tenant A cannot act on tenant B's data:
 * not by id, not by switching to B, not by anything else in the request.
 */
import type { TenantId } from "@repo/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditRows,
  Browser,
  createTestApi,
  newAccount,
  provisionTestTenant,
  readyBrowser,
  setActiveTenant,
  signInAndEnrol,
  type Account,
  type TestApi,
} from "./support.ts";

let api: TestApi;
let tenantA: TenantId;
let tenantB: TenantId;
let ownerA: Account;
let ownerB: Account;
let browserA: Browser;
let browserB: Browser;
let investigationB: string;

beforeAll(async () => {
  api = await createTestApi();
  ({ tenantId: tenantA, owner: ownerA } = await provisionTestTenant(api, "iso-a"));
  ({ tenantId: tenantB, owner: ownerB } = await provisionTestTenant(api, "iso-b"));
  browserA = await readyBrowser(api, ownerA, tenantA);
  browserB = await readyBrowser(api, ownerB, tenantB);
  const created = await browserB.request("POST", "/api/v1/investigations", {
    title: "[B's investigation]",
    target: "example.org",
  });
  investigationB = created.json<{ id: string }>().id;
});

afterAll(async () => {
  await api.close();
});

describe("a session is confined to its tenant (RELEASE-BLOCKING)", () => {
  it("cannot read another tenant's record by id", async () => {
    const response = await browserA.request("GET", `/api/v1/investigations/${investigationB}`);
    expect(response.status).toBe(404);
  });

  it("does not see another tenant's records in lists", async () => {
    const list = await browserA.request("GET", "/api/v1/investigations");
    expect(list.status).toBe(200);
    expect(list.json<{ items: { id: string }[] }>().items.map((item) => item.id)).not.toContain(
      investigationB,
    );
  });

  it("cannot switch to a tenant it is not a member of", async () => {
    const attempt = await setActiveTenant(browserA, tenantB);
    expect(attempt.status).toBe(403);
    // The identity provider fails closed: the refused switch clears the
    // session's tenant rather than leaving it anywhere. Nothing works until a
    // tenant the identity belongs to is chosen again.
    const after = await browserA.request("GET", "/api/v1/me");
    expect(after.status).toBe(403);
    expect(after.json()).toMatchObject({ code: "NO_ACTIVE_TENANT" });
    expect((await browserA.request("GET", `/api/v1/investigations/${investigationB}`)).status).toBe(
      403,
    );
    expect((await setActiveTenant(browserA, tenantA)).status).toBe(200);
    expect((await browserA.request("GET", "/api/v1/me")).json()).toMatchObject({
      tenant: { id: tenantA },
    });
  });

  it("ignores any tenant the request itself names", async () => {
    const response = await browserA.request(
      "GET",
      `/api/v1/investigations/${investigationB}`,
      undefined,
      { "x-tenant-id": tenantB, "x-organization-id": tenantB },
    );
    expect(response.status).toBe(404);
    expect((await browserA.request("GET", "/api/v1/me")).json()).toMatchObject({
      tenant: { id: tenantA },
    });
  });

  it("writes land in the session's tenant, never the other", async () => {
    await browserA.request("POST", "/api/v1/investigations", {
      title: "[A's investigation]",
      target: "example.com",
    });
    const bList = await browserB.request("GET", "/api/v1/investigations");
    expect(
      bList.json<{ items: { title: string }[] }>().items.map((item) => item.title),
    ).not.toContain("[A's investigation]");
  });

  it("a member of both tenants sees only the active tenant's data, and can switch", async () => {
    // Owner B invites owner A's identity into B as a viewer.
    const invite = await browserB.request("POST", "/api/auth/organization/invite-member", {
      email: ownerA.email,
      role: "viewer",
      organizationId: tenantB,
    });
    expect(invite.status).toBe(200);
    const accepted = await browserA.request("POST", "/api/auth/organization/accept-invitation", {
      invitationId: invite.json<{ id: string }>().id,
    });
    expect(accepted.status).toBe(200);

    expect((await setActiveTenant(browserA, tenantA)).status).toBe(200);
    expect((await browserA.request("GET", `/api/v1/investigations/${investigationB}`)).status).toBe(
      404,
    );

    expect((await setActiveTenant(browserA, tenantB)).status).toBe(200);
    expect((await browserA.request("GET", `/api/v1/investigations/${investigationB}`)).status).toBe(
      200,
    );
    // In B the identity is a viewer: it cannot create, whatever it is in A.
    const create = await browserA.request("POST", "/api/v1/investigations", {
      title: "[viewer write]",
      target: "example.org",
    });
    expect(create.status).toBe(403);
    expect(create.json()).toMatchObject({ code: "PERMISSION_DENIED" });
    // And that denial is recorded in B, not A.
    expect(
      (await auditRows(api, tenantB)).some(
        (row) => row.action === "investigation.create" && row.outcome === "DENIED",
      ),
    ).toBe(true);
    expect(
      (await auditRows(api, tenantA)).some(
        (row) => row.action === "investigation.create" && row.outcome === "DENIED",
      ),
    ).toBe(false);
  });

  it("a removed member loses access immediately", async () => {
    const viewer = newAccount("removed");
    const invite = await browserB.request("POST", "/api/auth/organization/invite-member", {
      email: viewer.email,
      role: "viewer",
      organizationId: tenantB,
    });
    const joiner = new Browser(api);
    await joiner.request("POST", "/api/auth/sign-up/email", viewer);
    const ready = await readyBrowserAfterInvite(joiner, viewer, invite.json<{ id: string }>().id);
    expect((await ready.request("GET", "/api/v1/investigations")).status).toBe(200);

    const members = await browserB.request(
      "GET",
      `/api/auth/organization/list-members?organizationId=${tenantB}`,
    );
    const member = members
      .json<{ members: { id: string; user: { email: string } }[] }>()
      .members.find((entry) => entry.user.email === viewer.email);
    const removal = await browserB.request("POST", "/api/auth/organization/remove-member", {
      memberIdOrEmail: member?.id,
      organizationId: tenantB,
    });
    expect(removal.status).toBe(200);
    expect((await ready.request("GET", "/api/v1/investigations")).status).toBe(403);
  });
});

async function readyBrowserAfterInvite(browser: Browser, account: Account, invitationId: string) {
  await signInAndEnrol(browser, account);
  await browser.request("POST", "/api/auth/organization/accept-invitation", { invitationId });
  await setActiveTenant(browser, tenantB);
  return browser;
}

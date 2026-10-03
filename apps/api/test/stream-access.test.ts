/**
 * RELEASE-BLOCKING. An open run progress stream never outlives the access that
 * opened it. Every read re-checks the credential, the membership and the
 * permission as connect did; on a refusal the stream closes with a `locked`
 * event whose `reason` says which, and whose `code` is what a fresh request
 * now gets. (Plan and vetting, through the person-data gate, are in
 * person-gate.test.ts.)
 */
import type { Permission } from "@repo/access";
import { permissionsForRoles } from "@repo/access";
import type { TenantId } from "@repo/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Principal } from "../src/http/principal.ts";
import { identityStanding, recheckAccess } from "../src/http/recheck.ts";
import {
  createTestApi,
  joinAs,
  openRunStream,
  provisionTestTenant,
  readyBrowser,
  sseEvents,
  within,
  type Browser,
  type TestApi,
} from "./support.ts";

let api: TestApi;
let tenantId: TenantId;
let owner: Browser;
let runId: string;
let investigationId: string;

beforeAll(async () => {
  api = await createTestApi();
  const tenant = await provisionTestTenant(api, "stream");
  tenantId = tenant.tenantId;
  owner = await readyBrowser(api, tenant.owner, tenantId);
  // An unsettled run with one technical job: no person data, so only the
  // credential, membership and permission can close its stream.
  ({ runId, investigationId } = await api.db.withTenant(tenantId, async ({ repos }) => {
    await repos.collectorsRegistry.register({
      collectorId: "fixture",
      sourceLabel: "[Fixture collector]",
      discipline: "TECHINT",
      collectionMode: "LOCAL_ANALYSIS",
      dataLicence: "[not applicable: test fixture]",
      commercialUse: "UNVERIFIED",
      enabled: true,
      disabledReason: null,
    });
    const investigation = await repos.investigations.create({
      title: "[streamed investigation]",
      target: "example.com",
      createdByUserId: tenant.ownerUserId,
    });
    const run = await repos.runs.create({
      investigationId: investigation.id,
      status: "QUEUED",
      requestedByUserId: tenant.ownerUserId,
    });
    await repos.jobs.create({
      runId: run.id,
      collectorId: "fixture",
      idempotencyKey: `stream:${run.id}`,
      status: "QUEUED",
    });
    return { runId: run.id, investigationId: investigation.id };
  }));
});

afterAll(async () => {
  await api.close();
});

const eventsPath = () => `/api/v1/runs/${runId}/events`;

/** A member's user id, by the tag their account was created with. */
async function memberId(tag: string): Promise<string> {
  const list = (await owner.request("GET", "/api/v1/members")).json<{
    items: { userId: string; email: string }[];
  }>();
  const member = list.items.find((item) => item.email.startsWith(`${tag}-`));
  if (member === undefined) throw new TypeError(`no member tagged ${tag}`);
  return member.userId;
}

async function issueKey(
  issuer: Browser,
  permissions: readonly Permission[],
): Promise<{ id: string; plaintext: string }> {
  const issued = await issuer.request("POST", "/api/v1/api-keys", {
    name: "[stream key]",
    permissions,
    expiresAt: null,
  });
  expect(issued.status).toBe(201);
  const body = issued.json<{ key: { id: string }; plaintext: string }>();
  return { id: body.key.id, plaintext: body.plaintext };
}

const withKey = (key: string, url: string) =>
  api.app.inject({ method: "GET", url, headers: { authorization: `Bearer ${key}` } });

/** The stream's events once it has closed after `change`. */
async function closeThrough<T extends { body: string }>(
  open: () => Promise<T>,
  change: () => Promise<unknown>,
) {
  const stream = await openRunStream(api, tenantId, runId, open);
  await change();
  const response = await within(stream.response, 10_000, "the stream closing after the change");
  return sseEvents(response.body);
}

function expectClosedBy(
  events: ReturnType<typeof sseEvents>,
  expected: { reason: string; code: string },
) {
  // It streamed while allowed, then said why it closed: never an end, never a drop.
  expect(events[0]?.event).toBe("run");
  const last = events.at(-1);
  expect(last?.event).toBe("locked");
  expect(events.some((event) => event.event === "end")).toBe(false);
  expect(last?.data).toMatchObject({ ...expected, locked: null, recheckIntervalMs: 100 });
  expect(String(last?.data["detail"])).toMatch(/policy decision, not a dropped connection/);
}

describe("an open stream closes when the reader's access ends (RELEASE-BLOCKING)", () => {
  it("a member removed mid-stream: MEMBERSHIP_REVOKED, the code a fresh request now gets", async () => {
    const analyst = await joinAs(api, owner, tenantId, "analyst", "x-removed");
    const userId = await memberId("x-removed");
    const events = await closeThrough(
      () => analyst.request("GET", eventsPath()),
      async () => {
        expect((await owner.request("DELETE", `/api/v1/members/${userId}`)).status).toBe(204);
      },
    );
    expectClosedBy(events, { reason: "MEMBERSHIP_REVOKED", code: "NOT_A_MEMBER" });
    const fresh = await analyst.request("GET", `/api/v1/runs/${runId}`);
    expect(fresh.status).toBe(403);
    expect(fresh.json<{ code: string }>().code).toBe("NOT_A_MEMBER");
  });

  it("a session signed out mid-stream: CREDENTIAL_REVOKED", async () => {
    const viewer = await joinAs(api, owner, tenantId, "viewer", "x-signout");
    const events = await closeThrough(
      () => viewer.request("GET", eventsPath()),
      async () => {
        expect((await viewer.request("POST", "/api/v1/session/sign-out")).status).toBe(200);
      },
    );
    expectClosedBy(events, { reason: "CREDENTIAL_REVOKED", code: "UNAUTHENTICATED" });
    const fresh = await viewer.request("GET", `/api/v1/runs/${runId}`);
    expect(fresh.status).toBe(401);
    expect(fresh.json<{ code: string }>().code).toBe("UNAUTHENTICATED");
  });

  it("an API key revoked mid-stream: CREDENTIAL_REVOKED", async () => {
    const key = await issueKey(owner, ["run:read"]);
    const events = await closeThrough(
      () => withKey(key.plaintext, eventsPath()),
      async () => {
        const revoked = await owner.request("POST", `/api/v1/api-keys/${key.id}/revoke`, {});
        expect(revoked.status).toBe(200);
      },
    );
    expectClosedBy(events, { reason: "CREDENTIAL_REVOKED", code: "API_KEY_INVALID" });
    const fresh = await withKey(key.plaintext, `/api/v1/runs/${runId}`);
    expect(fresh.statusCode).toBe(401);
    expect(fresh.json<{ code: string }>().code).toBe("API_KEY_INVALID");
  });

  it("an API key whose issuer is removed mid-stream: MEMBERSHIP_REVOKED", async () => {
    const admin = await joinAs(api, owner, tenantId, "admin", "x-issuer");
    const adminId = await memberId("x-issuer");
    const key = await issueKey(admin, ["run:read"]);
    const events = await closeThrough(
      () => withKey(key.plaintext, eventsPath()),
      async () => {
        expect((await owner.request("DELETE", `/api/v1/members/${adminId}`)).status).toBe(204);
      },
    );
    expectClosedBy(events, { reason: "MEMBERSHIP_REVOKED", code: "API_KEY_INVALID" });
    const fresh = await withKey(key.plaintext, `/api/v1/runs/${runId}`);
    expect(fresh.statusCode).toBe(401);
    expect(fresh.json<{ code: string }>().code).toBe("API_KEY_INVALID");
  });

  it("a role lowered mid-stream keeps the stream exactly while the new role still grants run:read", async () => {
    const analyst = await joinAs(api, owner, tenantId, "analyst", "x-lowered");
    const userId = await memberId("x-lowered");
    const stream = await openRunStream(api, tenantId, runId, () =>
      analyst.request("GET", eventsPath()),
    );
    const state = { closed: false };
    void stream.response.then(() => {
      state.closed = true;
    });
    expect(
      (await owner.request("PATCH", `/api/v1/members/${userId}`, { role: "viewer" })).status,
    ).toBe(200);
    // Eight re-checks at 100 ms, each against the new role.
    await new Promise((done) => setTimeout(done, 800));
    // Every role grants run:read today, so the stream stays open; were that to
    // change, it would close with PERMISSION_LOST (the next describe).
    expect(state.closed).toBe(!permissionsForRoles("viewer").has("run:read"));
    // Removing the member then closes it.
    expect((await owner.request("DELETE", `/api/v1/members/${userId}`)).status).toBe(204);
    const response = await within(stream.response, 10_000, "the stream closing after removal");
    expect(sseEvents(response.body).at(-1)?.data).toMatchObject({ reason: "MEMBERSHIP_REVOKED" });
  });
});

describe("lost permission: the re-check derives permissions from the current role (RELEASE-BLOCKING)", () => {
  // Every role holds run:read, so no role change can remove the stream's own
  // permission today. The stream calls recheckAccess with run:read; these
  // tests call the same function with a permission a lowered role does lose.
  async function recheck(principal: Principal, permission: Permission) {
    const identity = await identityStanding(principal, api.authStore);
    return api.db.withTenant(tenantId, async (context) => {
      const tenant = await context.repos.tenants.current();
      if (tenant === null) throw new TypeError("the test tenant has no row");
      return recheckAccess({ principal, identity, context, tenant, permission });
    });
  }

  it("for a session: PERMISSION_LOST once the role no longer grants it", async () => {
    const analyst = await joinAs(api, owner, tenantId, "analyst", "x-perm-session");
    const userId = await memberId("x-perm-session");
    const cookie = [...analyst.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    const session = await api.auth.api.getSession({ headers: new Headers({ cookie }) });
    if (session === null) throw new TypeError("the analyst has no session");
    const principal: Principal = {
      kind: "session",
      tenantId,
      userId,
      sessionId: session.session.id,
      // Ignored by the re-check, which derives permissions from the current role.
      permissions: new Set(),
    };
    expect(await recheck(principal, "run:start")).toBeNull();

    expect(
      (await owner.request("PATCH", `/api/v1/members/${userId}`, { role: "viewer" })).status,
    ).toBe(200);
    expect(await recheck(principal, "run:start")).toEqual({
      reason: "PERMISSION_LOST",
      code: "PERMISSION_DENIED",
      message: "This action requires the run:start permission.",
      locked: null,
    });
    // The stream's own permission is still granted to a viewer.
    expect(await recheck(principal, "run:read")).toBeNull();
    // A fresh request agrees.
    const fresh = await analyst.request(
      "POST",
      `/api/v1/investigations/${investigationId}/runs`,
      {},
    );
    expect(fresh.status).toBe(403);
    expect(fresh.json<{ code: string }>().code).toBe("PERMISSION_DENIED");
  });

  it("for an API key: PERMISSION_LOST once its issuer's role no longer grants it", async () => {
    const admin = await joinAs(api, owner, tenantId, "admin", "x-perm-key");
    const adminId = await memberId("x-perm-key");
    const key = await issueKey(admin, ["run:read", "run:start"]);
    const principal: Principal = {
      kind: "api_key",
      tenantId,
      apiKeyId: key.id,
      issuerUserId: adminId,
      permissions: new Set(),
    };
    expect(await recheck(principal, "run:start")).toBeNull();

    expect(
      (await owner.request("PATCH", `/api/v1/members/${adminId}`, { role: "viewer" })).status,
    ).toBe(200);
    // A key never does more than its issuer can do today.
    expect(await recheck(principal, "run:start")).toMatchObject({
      reason: "PERMISSION_LOST",
      code: "PERMISSION_DENIED",
    });
    expect(await recheck(principal, "run:read")).toBeNull();
  });
});

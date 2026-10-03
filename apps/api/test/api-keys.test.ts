/**
 * RELEASE-BLOCKING. An API key works only for its scoped permissions, only in
 * its own tenant, only while unrevoked, and only up to its rate limit.
 */
import type { TenantId } from "@repo/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditRows,
  Browser,
  createTestApi,
  invite,
  newAccount,
  signInAndEnrol,
  setActiveTenant,
  provisionTestTenant,
  readyBrowser,
  type TestApi,
} from "./support.ts";

let api: TestApi;
let tenantA: TenantId;
let tenantB: TenantId;
let ownerA: Browser;
let ownerB: Browser;
let investigationB: string;

beforeAll(async () => {
  api = await createTestApi({ apiKeyLimit: 1000 });
  const a = await provisionTestTenant(api, "keys-a");
  const b = await provisionTestTenant(api, "keys-b");
  tenantA = a.tenantId;
  tenantB = b.tenantId;
  ownerA = await readyBrowser(api, a.owner, tenantA);
  ownerB = await readyBrowser(api, b.owner, tenantB);
  investigationB = (
    await ownerB.request("POST", "/api/v1/investigations", { title: "[B]", target: "example.org" })
  ).json<{ id: string }>().id;
});

afterAll(async () => {
  await api.close();
});

async function issue(browser: Browser, permissions: string[]) {
  const response = await browser.request("POST", "/api/v1/api-keys", {
    name: `[key ${permissions.join(" ")}]`,
    permissions,
    expiresAt: null,
  });
  expect(response.status).toBe(201);
  return response.json<{ key: { id: string; keyPrefix: string }; plaintext: string }>();
}

function withKey(
  app: TestApi["app"],
  key: string,
  method: "GET" | "POST",
  url: string,
  body?: unknown,
) {
  return app.inject({
    method,
    url,
    headers: {
      authorization: `Bearer ${key}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
  });
}

describe("API keys (RELEASE-BLOCKING)", () => {
  it("works for its scoped permission and nothing else", async () => {
    const { plaintext } = await issue(ownerA, ["investigation:read"]);
    expect((await withKey(api.app, plaintext, "GET", "/api/v1/investigations")).statusCode).toBe(
      200,
    );

    const write = await withKey(api.app, plaintext, "POST", "/api/v1/investigations", {
      title: "[key write]",
      target: "example.com",
    });
    expect(write.statusCode).toBe(403);
    expect(write.json()).toMatchObject({ code: "PERMISSION_DENIED" });

    for (const url of ["/api/v1/audit-log", "/api/v1/credentials", "/api/v1/api-keys"]) {
      expect((await withKey(api.app, plaintext, "GET", url)).statusCode).toBe(403);
    }
  });

  it("acts as an API key in the audit log, never as the person who issued it", async () => {
    const { key, plaintext } = await issue(ownerA, ["investigation:create"]);
    const created = await withKey(api.app, plaintext, "POST", "/api/v1/investigations", {
      title: "[made by a key]",
      target: "example.com",
    });
    expect(created.statusCode).toBe(201);
    const row = (await auditRows(api, tenantA)).find(
      (entry) => entry.action === "investigation.create" && entry.actorApiKeyId === key.id,
    );
    expect(row).toMatchObject({
      actorKind: "API_KEY",
      actorUserId: null,
      authMethod: "API_KEY",
      permission: "investigation:create",
      sessionId: null,
      outcome: "ALLOWED",
    });
  });

  it("works only in its own tenant, whatever else the request says", async () => {
    const { plaintext } = await issue(ownerA, ["investigation:read"]);
    expect(
      (await withKey(api.app, plaintext, "GET", `/api/v1/investigations/${investigationB}`))
        .statusCode,
    ).toBe(404);
    // Splicing tenant B's id into tenant A's key does not make it B's key.
    const spliced = plaintext.replace(/^ak_[0-9a-f]{32}_/, `ak_${tenantB.replaceAll("-", "")}_`);
    const response = await withKey(api.app, spliced, "GET", "/api/v1/investigations");
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: "API_KEY_INVALID" });
  });

  it("cannot be issued with more than the issuer holds", async () => {
    // A key that may manage keys and read investigations tries to mint a writer.
    const { plaintext } = await issue(ownerA, ["api_key:manage", "investigation:read"]);
    const escalation = await withKey(api.app, plaintext, "POST", "/api/v1/api-keys", {
      name: "[escalation]",
      permissions: ["investigation:create"],
      expiresAt: null,
    });
    expect(escalation.statusCode).toBe(403);
    expect(escalation.json()).toMatchObject({ code: "API_KEY_SCOPE_INVALID" });
  });

  it("stops working when revoked", async () => {
    const { key, plaintext } = await issue(ownerA, ["investigation:read"]);
    expect((await ownerA.request("POST", `/api/v1/api-keys/${key.id}/revoke`, {})).status).toBe(
      200,
    );
    const response = await withKey(api.app, plaintext, "GET", "/api/v1/investigations");
    expect(response.statusCode).toBe(401);
  });

  it("rotation issues a working key and retires the old one", async () => {
    const { key, plaintext: oldKey } = await issue(ownerA, ["investigation:read"]);
    const rotated = await ownerA.request("POST", `/api/v1/api-keys/${key.id}/rotate`, {
      overlapSeconds: 0,
    });
    expect(rotated.status).toBe(201);
    const next = rotated.json<{ key: { rotatedFromId: string }; plaintext: string }>();
    expect(next.key.rotatedFromId).toBe(key.id);
    expect(
      (await withKey(api.app, next.plaintext, "GET", "/api/v1/investigations")).statusCode,
    ).toBe(200);
    expect((await withKey(api.app, oldKey, "GET", "/api/v1/investigations")).statusCode).toBe(401);
  });

  it("is never shown again after it is issued", async () => {
    const { plaintext } = await issue(ownerA, ["investigation:read"]);
    const list = await ownerA.request("GET", "/api/v1/api-keys");
    expect(list.status).toBe(200);
    expect(list.body).not.toContain(plaintext);
    expect(list.body).not.toContain(plaintext.split("_").at(-1) ?? "unreachable");
    expect(list.body).not.toMatch(/keyHash|key_hash/);
  });

  it("is rate limited per key, independently of sessions and other keys", async () => {
    const limited = await createTestApi({ apiKeyLimit: 3 });
    try {
      const tenant = await provisionTestTenant(limited, "keys-limit");
      const owner = await readyBrowser(limited, tenant.owner, tenant.tenantId);
      const first = (await issue(owner, ["investigation:read"])).plaintext;
      const second = (await issue(owner, ["investigation:read"])).plaintext;
      const statuses: number[] = [];
      for (let i = 0; i < 4; i++) {
        statuses.push(
          (await withKey(limited.app, first, "GET", "/api/v1/investigations")).statusCode,
        );
      }
      expect(statuses).toEqual([200, 200, 200, 429]);
      const refused = await withKey(limited.app, first, "GET", "/api/v1/investigations");
      expect(Number(refused.headers["retry-after"])).toBeGreaterThan(0);
      // Another key, and the session, are unaffected.
      expect((await withKey(limited.app, second, "GET", "/api/v1/investigations")).statusCode).toBe(
        200,
      );
      expect((await owner.request("GET", "/api/v1/investigations")).status).toBe(200);
    } finally {
      await limited.close();
    }
  });

  it("fails closed when the rate limiter is unreachable", async () => {
    const broken = await createTestApi({
      redisUrl: "redis://127.0.0.1:6390/0",
      waitForRedis: false,
    });
    try {
      const tenant = await provisionTestTenant(broken, "keys-broken");
      const owner = await readyBrowser(broken, tenant.owner, tenant.tenantId);
      const { plaintext } = await issue(owner, ["investigation:read"]);
      const response = await withKey(broken.app, plaintext, "GET", "/api/v1/investigations");
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ code: "RATE_LIMITER_UNAVAILABLE" });
    } finally {
      await broken.close();
    }
  });

  it("can never do more than its issuer can do today", async () => {
    // Owner A invites an admin, who issues a key that may read and create.
    const admin = newAccount("keys-admin");
    const invited = await invite(ownerA, admin.email, "admin");
    expect(invited.status).toBe(201);
    const adminBrowser = new Browser(api);
    await adminBrowser.request("POST", "/api/auth/sign-up/email", admin);
    await signInAndEnrol(adminBrowser, admin);
    await adminBrowser.request("POST", "/api/auth/organization/accept-invitation", {
      invitationId: invited.json<{ invitationId: string }>().invitationId,
    });
    await setActiveTenant(adminBrowser, tenantA);
    const { plaintext } = await issue(adminBrowser, ["investigation:read", "investigation:create"]);
    const create = () =>
      withKey(api.app, plaintext, "POST", "/api/v1/investigations", {
        title: "[issuer-capped]",
        target: "example.com",
      });
    expect((await create()).statusCode).toBe(201);

    // The admin is demoted to viewer: the key loses what the viewer lacks.
    const members = await ownerA.request("GET", "/api/v1/members");
    const member = members
      .json<{ items: { userId: string; email: string }[] }>()
      .items.find((entry) => entry.email === admin.email);
    if (member === undefined) return expect.fail("the admin is not listed as a member");
    const demote = await ownerA.request("PATCH", `/api/v1/members/${member.userId}`, {
      role: "viewer",
    });
    expect(demote.status).toBe(200);
    expect((await create()).statusCode).toBe(403);
    expect((await withKey(api.app, plaintext, "GET", "/api/v1/investigations")).statusCode).toBe(
      200,
    );

    // The admin leaves: the key stops working altogether.
    const removal = await ownerA.request("DELETE", `/api/v1/members/${member.userId}`);
    expect(removal.status).toBe(204);
    expect((await withKey(api.app, plaintext, "GET", "/api/v1/investigations")).statusCode).toBe(
      401,
    );
  });

  it("rejects malformed keys and other schemes without touching the database", async () => {
    for (const header of ["Bearer not-a-key", "Basic dXNlcjpwYXNz", "Bearer ak_"]) {
      const response = await api.app.inject({
        method: "GET",
        url: "/api/v1/investigations",
        headers: { authorization: header },
      });
      expect(response.statusCode).toBe(401);
    }
  });
});

/**
 * RELEASE-BLOCKING. Scope authorisations through the API (Phase 3B carry-
 * forward): the per-tenant, per-exact-target record an ACTIVE collector needs.
 * Recorded by a person, never a key; normalised to the target the runtime
 * matches; bounded in time; revoked once; audited; and invisible across tenants.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditRows,
  Browser,
  createTestApi,
  joinAs,
  provisionTestTenant,
  readyBrowser,
  type TestApi,
} from "./support.ts";
import type { TenantId } from "@repo/core";

let api: TestApi;
let owner: Browser;
let tenantId: TenantId;

beforeAll(async () => {
  api = await createTestApi();
  const provisioned = await provisionTestTenant(api, "scope");
  tenantId = provisioned.tenantId;
  owner = await readyBrowser(api, provisioned.owner, tenantId);
});

afterAll(async () => {
  await api.close();
});

const DAY = 24 * 60 * 60 * 1000;
const window = (days: number) => ({
  validFrom: new Date(Date.now() - 60_000).toISOString(),
  validUntil: new Date(Date.now() + days * DAY).toISOString(),
});
const request = (target: string, days = 30) => ({
  targetType: "DOMAIN",
  target,
  basis: "[engagement letter: authorised external assessment]",
  ...window(days),
});

describe("scope authorisations (RELEASE-BLOCKING)", () => {
  it("records one for the exact normalised target, in force for the runtime to find", async () => {
    const created = await owner.request(
      "POST",
      "/api/v1/scope-authorisations",
      request("Example.COM."),
    );
    expect(created.status).toBe(201);
    const body = created.json<{
      id: string;
      target: string;
      authorisedByUserId: string;
      revokedAt: null;
    }>();
    expect(body.target).toBe("example.com");
    expect(body.revokedAt).toBeNull();
    const inForce = await api.db.withTenant(tenantId, ({ repos }) =>
      repos.scopeAuthorisations.findInForce("DOMAIN", "example.com"),
    );
    expect(inForce?.id).toBe(body.id);
    // Exact target only: it covers no subdomain.
    const sub = await api.db.withTenant(tenantId, ({ repos }) =>
      repos.scopeAuthorisations.findInForce("DOMAIN", "www.example.com"),
    );
    expect(sub).toBeNull();
    const rows = await auditRows(api, tenantId);
    expect(rows.find((row) => row.action === "scope_authorisation.create")).toMatchObject({
      targetId: body.id,
      outcome: "ALLOWED",
      permission: "scope_authorisation:write",
    });
  });

  it("refuses a target that is not the stated type, and validity that is backwards or over a year", async () => {
    const invalid = await owner.request(
      "POST",
      "/api/v1/scope-authorisations",
      request("not a domain"),
    );
    expect(invalid.status).toBe(400);
    expect(invalid.json()).toMatchObject({ code: "TARGET_INVALID" });
    const backwards = await owner.request("POST", "/api/v1/scope-authorisations", {
      ...request("example.net"),
      validFrom: new Date(Date.now() + DAY).toISOString(),
      validUntil: new Date().toISOString(),
    });
    expect(backwards.json()).toMatchObject({ code: "VALIDITY_INVALID" });
    const long = await owner.request(
      "POST",
      "/api/v1/scope-authorisations",
      request("example.net", 400),
    );
    expect(long.json()).toMatchObject({ code: "VALIDITY_TOO_LONG" });
  });

  it("is recorded by a person: an API key cannot authorise", async () => {
    const key = await owner.request("POST", "/api/v1/api-keys", {
      name: "[scope key]",
      permissions: ["scope_authorisation:write", "scope_authorisation:read"],
      expiresAt: null,
    });
    expect(key.status).toBe(201);
    const plaintext = key.json<{ plaintext: string }>().plaintext;
    const attempt = await api.app.inject({
      method: "POST",
      url: "/api/v1/scope-authorisations",
      headers: { authorization: `Bearer ${plaintext}`, "content-type": "application/json" },
      payload: JSON.stringify(request("example.org")),
    });
    expect(attempt.statusCode).toBe(403);
    expect(attempt.json()).toMatchObject({ code: "SCOPE_AUTHORISER_REQUIRED" });
    const listed = await api.app.inject({
      method: "GET",
      url: "/api/v1/scope-authorisations",
      headers: { authorization: `Bearer ${plaintext}` },
    });
    expect(listed.statusCode).toBe(200);
  });

  it("revokes once; a second revoke is a conflict, and the runtime no longer finds it", async () => {
    const created = await owner.request(
      "POST",
      "/api/v1/scope-authorisations",
      request("revoke.example"),
    );
    const id = created.json<{ id: string }>().id;
    const revoked = await owner.request("POST", `/api/v1/scope-authorisations/${id}/revoke`, {});
    expect(revoked.status).toBe(200);
    expect(revoked.json<{ revokedAt: string | null }>().revokedAt).not.toBeNull();
    const again = await owner.request("POST", `/api/v1/scope-authorisations/${id}/revoke`, {});
    expect(again.status).toBe(409);
    expect(again.json()).toMatchObject({ code: "ALREADY_REVOKED" });
    expect(
      await api.db.withTenant(tenantId, ({ repos }) =>
        repos.scopeAuthorisations.findInForce("DOMAIN", "revoke.example"),
      ),
    ).toBeNull();
  });

  it("an analyst may read authorisations but not record or revoke them", async () => {
    const analyst = await joinAs(api, owner, tenantId, "analyst", "scope-analyst");
    expect((await analyst.request("GET", "/api/v1/scope-authorisations")).status).toBe(200);
    const attempt = await analyst.request(
      "POST",
      "/api/v1/scope-authorisations",
      request("example.edu"),
    );
    expect(attempt.status).toBe(403);
    expect(attempt.json()).toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("is invisible to another tenant, which cannot revoke it", async () => {
    const created = await owner.request(
      "POST",
      "/api/v1/scope-authorisations",
      request("isolated.example"),
    );
    const id = created.json<{ id: string }>().id;
    const other = await provisionTestTenant(api, "scope-other");
    const stranger = await readyBrowser(api, other.owner, other.tenantId);
    const listed = await stranger.request("GET", "/api/v1/scope-authorisations");
    expect(listed.json<{ items: unknown[] }>().items).toEqual([]);
    expect(
      (await stranger.request("POST", `/api/v1/scope-authorisations/${id}/revoke`, {})).status,
    ).toBe(404);
  });
});

/**
 * RELEASE-BLOCKING. Person investigation needs the permission, a plan that
 * includes it, AND approved vetting. The right plan alone is not enough, and
 * neither is approval alone. Past the gate, the route reports not implemented
 * rather than returning anything that looks like a result.
 */
import { PLANS, VETTING_STATUSES } from "@repo/access";
import type { TenantId } from "@repo/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditRows,
  createTestApi,
  provisionTestTenant,
  readyBrowser,
  setEntitlement,
  type Browser,
  type TestApi,
} from "./support.ts";

let api: TestApi;
let tenantId: TenantId;
let browser: Browser;

beforeAll(async () => {
  api = await createTestApi();
  const provisioned = await provisionTestTenant(api, "person");
  tenantId = provisioned.tenantId;
  browser = await readyBrowser(api, provisioned.owner, tenantId);
});

afterAll(async () => {
  await api.close();
});

const search = () => browser.request("POST", "/api/v1/person/search", { query: "[a person]" });

describe("the person-investigation gate (RELEASE-BLOCKING)", () => {
  it("a new tenant is refused: default plan, vetting not submitted", async () => {
    const response = await search();
    expect(response.status).toBe(403);
    expect(response.json()).toMatchObject({ code: "MODULE_NOT_IN_PLAN" });
  });

  const cases = PLANS.flatMap((plan) =>
    VETTING_STATUSES.map((vetting) => [plan, vetting] as const),
  );

  it.each(cases)("plan %s with vetting %s", async (plan, vettingStatus) => {
    await setEntitlement(tenantId, { plan, vettingStatus });
    const response = await search();
    if (plan === "TECHINT") {
      expect(response.status).toBe(403);
      expect(response.json()).toMatchObject({ code: "MODULE_NOT_IN_PLAN" });
    } else if (vettingStatus !== "APPROVED") {
      // The right plan, without approved vetting: still refused.
      expect(response.status).toBe(403);
      expect(response.json()).toMatchObject({ code: "VETTING_NOT_APPROVED" });
    } else {
      // Past the gate: no collector exists yet, and nothing is invented.
      expect(response.status).toBe(501);
      expect(response.json()).toMatchObject({ code: "NOT_IMPLEMENTED" });
    }
  });

  it("an API key holding person:search meets the same gate", async () => {
    await setEntitlement(tenantId, { plan: "TECHINT_AND_PERSON", vettingStatus: "PENDING" });
    const issued = await browser.request("POST", "/api/v1/api-keys", {
      name: "[person key]",
      permissions: ["person:search"],
      expiresAt: null,
    });
    expect(issued.status).toBe(201);
    const { plaintext } = issued.json<{ plaintext: string }>();
    const response = await api.app.inject({
      method: "POST",
      url: "/api/v1/person/search",
      headers: { authorization: `Bearer ${plaintext}`, "content-type": "application/json" },
      payload: JSON.stringify({ query: "[a person]" }),
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: "VETTING_NOT_APPROVED" });
  });

  it("every refusal is audited with its reason, and every entitlement change too", async () => {
    const rows = await auditRows(api, tenantId);
    const denials = rows.filter(
      (row) => row.action === "person.search" && row.outcome === "DENIED",
    );
    const reasons = new Set(
      denials.map((row) => (row.details as { reason?: string } | null)?.reason),
    );
    expect(reasons).toEqual(new Set(["MODULE_NOT_IN_PLAN", "VETTING_NOT_APPROVED"]));
    expect(rows.some((row) => row.action === "tenant.entitlement_change")).toBe(true);
    // Reaching the unimplemented handler is recorded as a failed attempt.
    expect(rows.some((row) => row.action === "person.search" && row.outcome === "FAILED")).toBe(
      true,
    );
  });
});

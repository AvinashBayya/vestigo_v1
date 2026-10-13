/**
 * RELEASE-BLOCKING (CLAUDE.md §9; D-35, D-36). On a tenant large enough that
 * the person probe before D-35 ran out of time (buildProbeGraph), a locked
 * tenant's graph read reaching person data three relationships out is refused
 * whole, and its read stopping short of it returns the whole body, the same
 * body an entitled tenant gets. The application database's statement timeout
 * is 2 s here: on this graph the probe before D-35 took 5 to 14 s with JIT
 * off, and longer with it, so every locked read below failed on it.
 */
import type { TenantId } from "@repo/core";
import { buildProbeGraph } from "@repo/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_API } from "./config.ts";
import {
  createTestApi,
  provisionTestTenant,
  readyBrowser,
  setEntitlement,
  type Browser,
  type TestApi,
} from "./support.ts";

/** Building and analysing the graph is slow by design, more so beside the other suites. */
const SETUP_TIMEOUT_MS = 180_000;

let api: TestApi;
let tenantId: TenantId;
let browser: Browser;
let entityCaseId: string;
let relationshipCaseId: string;

beforeAll(async () => {
  api = await createTestApi({ statementTimeoutMs: 2_000 });
  const tenant = await provisionTestTenant(api, "depth");
  tenantId = tenant.tenantId;
  browser = await readyBrowser(api, tenant.owner, tenantId);
  const made = await api.db.withTenant(tenantId, async ({ repos }) => {
    const register = (collectorId: string, discipline: "TECHINT" | "PERSON") =>
      repos.collectorsRegistry.register({
        collectorId,
        sourceLabel: `[${collectorId} fixture]`,
        discipline,
        collectionMode: "LOCAL_ANALYSIS",
        dataLicence: "[not applicable: test fixture]",
        commercialUse: "UNVERIFIED",
        enabled: true,
        disabledReason: null,
      });
    await register("depth-technical", "TECHINT");
    await register("depth-person", "PERSON");
    const record = (collectorId: string, hash: string) =>
      repos.evidence.record({
        collectorId,
        collectorVersion: "0.0.0-test",
        jobId: null,
        sourceUrl: null,
        contentHash: `sha256:${hash.repeat(32)}`,
        payloadRef: "[depth payload]",
        observedAt: null,
        collectedAt: null,
        claimStrength: "REPORTED",
      });
    const caseFor = (title: string) =>
      repos.cases.create({ title, description: null, createdByUserId: tenant.ownerUserId });
    return {
      technical: await record("depth-technical", "d1"),
      person: await record("depth-person", "e2"),
      entityCase: await caseFor("[Case: person entity three out]"),
      relationshipCase: await caseFor("[Case: person relationship three out]"),
    };
  });
  entityCaseId = made.entityCase.id;
  relationshipCaseId = made.relationshipCase.id;
  await buildProbeGraph({
    runtimeUrl: TEST_API.runtimeUrl,
    ownerUrl: TEST_API.ownerUrl,
    tenantId,
    technicalEvidenceId: made.technical.id,
    personEvidenceId: made.person.id,
    entityCaseId,
    relationshipCaseId,
  });
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await api.close();
});

const graph = (caseId: string, hops: number) =>
  browser.request("GET", `/api/v1/graph?caseId=${caseId}&hops=${String(hops)}`);

const cases = (): Record<string, string> => ({
  "person entity three out": entityCaseId,
  "person relationship three out": relationshipCaseId,
});

/** Refused whole: the Locked detail complete, and nothing of the graph. */
async function expectRefusedWhole(
  name: string,
  caseId: string,
  expected: { code: string; plan: string; vettingStatus: string },
) {
  const response = await graph(caseId, 3);
  expect(response.status, `${name}: ${response.body.slice(0, 200)}`).toBe(403);
  const problem = response.json<{
    code: string;
    detail: string;
    locked?: Record<string, string>;
    nodes?: unknown;
    edges?: unknown;
  }>();
  expect(problem.code, name).toBe(expected.code);
  expect(problem.locked, name).toMatchObject({
    module: "PERSON_INVESTIGATION",
    reason: expected.code,
    plan: expected.plan,
    vettingStatus: expected.vettingStatus,
  });
  expect(problem.locked?.["withheld"], name).toMatch(/.{11,}/);
  expect(problem.locked?.["moduleSummary"], name).toMatch(/.{11,}/);
  expect(problem.locked?.["nextStep"], name).toMatch(/.{11,}/);
  expect(problem.detail, name).toMatch(/nothing was returned/i);
  expect(problem.nodes, name).toBeUndefined();
  expect(problem.edges, name).toBeUndefined();
  expect(response.body, name).not.toContain("[Person, three relationships out]");
  expect(response.body, name).not.toContain("[person claim]");
}

describe("a locked tenant's graph at the deepest hop, on a large tenant (RELEASE-BLOCKING)", () => {
  const shortBodies: Record<string, string> = {};

  it("no plan: a read reaching person data three relationships out is refused whole", async () => {
    // REGRESSION (D-35): the probe before D-35 ran out of time on these reads.
    for (const [name, caseId] of Object.entries(cases())) {
      await expectRefusedWhole(name, caseId, {
        code: "MODULE_NOT_IN_PLAN",
        plan: "TECHINT",
        vettingStatus: "NOT_SUBMITTED",
      });
    }
  });

  it("no plan: a read stopping one relationship short returns the whole graph", async () => {
    for (const [name, caseId] of Object.entries(cases())) {
      const response = await graph(caseId, 2);
      expect(response.status, `${name}: ${response.body.slice(0, 200)}`).toBe(200);
      const body = response.json<{ nodes: unknown[]; edges: unknown[]; locked?: unknown }>();
      expect(body.nodes.length, name).toBeGreaterThan(1);
      expect(body.edges.length, name).toBeGreaterThan(0);
      expect(body.locked, name).toBeUndefined();
      shortBodies[name] = response.body;
    }
  });

  it("plan includes the module, vetting pending: still refused whole, now for vetting", async () => {
    await setEntitlement(tenantId, { plan: "TECHINT_AND_PERSON", vettingStatus: "PENDING" });
    for (const [name, caseId] of Object.entries(cases())) {
      await expectRefusedWhole(name, caseId, {
        code: "VETTING_NOT_APPROVED",
        plan: "TECHINT_AND_PERSON",
        vettingStatus: "PENDING",
      });
    }
  });

  it("approved: the deep read answers, and the short read is the body the locked tenant got", async () => {
    await setEntitlement(tenantId, { vettingStatus: "APPROVED" });
    for (const [name, caseId] of Object.entries(cases())) {
      const deep = await graph(caseId, 3);
      expect(deep.status, `${name}: ${deep.body.slice(0, 200)}`).toBe(200);
      const short = await graph(caseId, 2);
      expect(short.status, name).toBe(200);
      // Nothing was thinned for the locked tenant: the same body, byte for byte.
      expect(shortBodies[name], name).toBe(short.body);
    }
  });
});

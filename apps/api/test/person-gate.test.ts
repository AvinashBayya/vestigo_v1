/**
 * RELEASE-BLOCKING (CLAUDE.md §9). A read that holds person data is refused
 * whole, with the Locked detail, whenever the tenant's plan or vetting does
 * not allow person investigation. It is never thinned: no rows dropped, no
 * count lowered. Walked through the whole lifecycle: no plan, vetting
 * pending, approved, suspended.
 */
import { contentRef, hashContent } from "@repo/db";
import type { TenantId } from "@repo/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
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

interface Ids {
  personRun: string;
  mixedRun: string;
  cleanRun: string;
  mixedCase: string;
  cleanCase: string;
  pinCase: string;
  personEntity: string;
  personTwin: string;
  mixedEntity: string;
  cleanEntity: string;
  cleanOther: string;
  personEvidence: string;
  personClaim: string;
}
let ids: Ids;

async function seed(tenant: TenantId, userId: string): Promise<Ids> {
  return api.db.withTenant(tenant, async ({ repos }) => {
    for (const [collectorId, discipline] of [
      ["fixture", "TECHINT"],
      ["fixture-person", "PERSON"],
    ] as const) {
      await repos.collectorsRegistry.register({
        collectorId,
        sourceLabel: `[${collectorId}]`,
        discipline,
        collectionMode: "LOCAL_ANALYSIS",
        dataLicence: "[not applicable: test fixture]",
        commercialUse: "UNVERIFIED",
        enabled: true,
        disabledReason: null,
      });
    }
    const makeRun = async (collectorId: string, tag: string) => {
      const investigation = await repos.investigations.create({
        title: `[${tag}]`,
        target: "example.com",
        createdByUserId: userId,
      });
      const run = await repos.runs.create({
        investigationId: investigation.id,
        status: "QUEUED",
        requestedByUserId: userId,
      });
      const job = await repos.jobs.create({
        runId: run.id,
        collectorId,
        idempotencyKey: `gate:${tag}:${run.id}`,
        status: "QUEUED",
      });
      const hash = hashContent(new TextEncoder().encode(`[payload ${tag} ${run.id}]`));
      const evidence = await repos.evidence.record({
        collectorId,
        collectorVersion: "0.0.0-test",
        jobId: job.id,
        sourceUrl: null,
        contentHash: hash,
        payloadRef: contentRef(tenant, hash),
        observedAt: null,
        collectedAt: new Date("2026-05-01T00:00:00Z"),
        claimStrength: "REPORTED",
      });
      return { runId: run.id, evidenceId: evidence.id };
    };
    const person = await makeRun("fixture-person", "person");
    const mixed = await makeRun("fixture", "mixed");
    const clean = await makeRun("fixture", "clean");

    // Person data: two entities with the same name, each claimed from person evidence.
    const personEntity = await repos.entities.create({ kind: "PERSON", displayName: "[Person A]" });
    const personTwin = await repos.entities.create({ kind: "PERSON", displayName: "[person a]" });
    const personClaim = await repos.claims.create({
      evidenceId: person.evidenceId,
      subject: { entityId: personEntity.id },
      attribute: "note",
      value: "[person claim]",
      strength: "REPORTED",
    });
    await repos.claims.create({
      evidenceId: person.evidenceId,
      subject: { entityId: personTwin.id },
      attribute: "note",
      value: "[person claim]",
      strength: "REPORTED",
    });

    // Mixed: collected by a non-person run, but also claimed from person evidence.
    const mixedEntity = await repos.entities.create({
      kind: "DOMAIN",
      displayName: "mixed.example.com",
    });
    await repos.claims.create({
      evidenceId: mixed.evidenceId,
      subject: { entityId: mixedEntity.id },
      attribute: "registrar",
      value: "[registrar]",
      strength: "REPORTED",
    });
    await repos.claims.create({
      evidenceId: person.evidenceId,
      subject: { entityId: mixedEntity.id },
      attribute: "note",
      value: "[from person evidence]",
      strength: "REPORTED",
    });

    // Clean: nothing here rests on person evidence.
    const cleanEntity = await repos.entities.create({
      kind: "DOMAIN",
      displayName: "clean.example.com",
    });
    const cleanOther = await repos.entities.create({
      kind: "DOMAIN",
      displayName: "www.clean.example.com",
    });
    const relationship = await repos.entityRelationships.create({
      sourceEntityId: cleanOther.id,
      targetEntityId: cleanEntity.id,
      kind: "subdomain_of",
    });
    await repos.claims.create({
      evidenceId: clean.evidenceId,
      subject: { entityId: cleanEntity.id },
      attribute: "registrar",
      value: "[registrar]",
      strength: "REPORTED",
    });
    await repos.claims.create({
      evidenceId: clean.evidenceId,
      subject: { relationshipId: relationship.id },
      attribute: "observed_in",
      value: "[dns]",
      strength: "REPORTED",
    });

    // A case that mixes person and non-person pins, and a case that is clean.
    const mixedCase = await repos.cases.create({
      title: "[mixed case]",
      description: null,
      createdByUserId: userId,
    });
    for (const target of [{ evidenceId: person.evidenceId }, { evidenceId: clean.evidenceId }]) {
      await repos.casePins.pin({
        caseId: mixedCase.id,
        target,
        pinnedByUserId: userId,
        note: null,
      });
    }
    const cleanCase = await repos.cases.create({
      title: "[clean case]",
      description: null,
      createdByUserId: userId,
    });
    for (const target of [{ evidenceId: clean.evidenceId }, { entityId: cleanEntity.id }]) {
      await repos.casePins.pin({
        caseId: cleanCase.id,
        target,
        pinnedByUserId: userId,
        note: null,
      });
    }
    // Where pin attempts are aimed, so a pin that succeeds never pollutes the clean case.
    const pinCase = await repos.cases.create({
      title: "[pin attempts]",
      description: null,
      createdByUserId: userId,
    });
    return {
      pinCase: pinCase.id,
      personRun: person.runId,
      mixedRun: mixed.runId,
      cleanRun: clean.runId,
      mixedCase: mixedCase.id,
      cleanCase: cleanCase.id,
      personEntity: personEntity.id,
      personTwin: personTwin.id,
      mixedEntity: mixedEntity.id,
      cleanEntity: cleanEntity.id,
      cleanOther: cleanOther.id,
      personEvidence: person.evidenceId,
      personClaim: personClaim.id,
    };
  });
}

beforeAll(async () => {
  api = await createTestApi();
  const tenant = await provisionTestTenant(api, "gate");
  tenantId = tenant.tenantId;
  browser = await readyBrowser(api, tenant.owner, tenantId);
  ids = await seed(tenantId, tenant.ownerUserId);
});

afterAll(async () => {
  await api.close();
});

type Call = readonly [method: "GET" | "POST", path: () => string, body?: () => unknown];

/** Every gated read, aimed at something that rests on person data. */
const LOCKED_CALLS: Record<string, Call> = {
  "entities of a person run": ["GET", () => `/api/v1/entities?runId=${ids.personRun}`],
  "entities of a run whose entity also has person claims": [
    "GET",
    () => `/api/v1/entities?runId=${ids.mixedRun}`,
  ],
  "entities of a case mixing person and other pins": [
    "GET",
    () => `/api/v1/entities?caseId=${ids.mixedCase}`,
  ],
  "entity detail": ["GET", () => `/api/v1/entities/${ids.personEntity}`],
  "entity detail where only some claims are person": [
    "GET",
    () => `/api/v1/entities/${ids.mixedEntity}`,
  ],
  "merge candidates": ["GET", () => `/api/v1/entities/merge-candidates?runId=${ids.personRun}`],
  graph: ["GET", () => `/api/v1/graph?runId=${ids.personRun}`],
  "graph of a run whose entities have person claims": [
    "GET",
    () => `/api/v1/graph?runId=${ids.mixedRun}`,
  ],
  timeline: ["GET", () => `/api/v1/timeline?runId=${ids.personRun}`],
  "timeline of a case mixing person and other evidence": [
    "GET",
    () => `/api/v1/timeline?caseId=${ids.mixedCase}`,
  ],
  "pins of a case mixing person and other pins": [
    "GET",
    () => `/api/v1/cases/${ids.mixedCase}/pins`,
  ],
  "pinning person evidence": [
    "POST",
    () => `/api/v1/cases/${ids.pinCase}/pins`,
    () => ({ target: { type: "evidence", id: ids.personEvidence } }),
  ],
  "pinning a person claim": [
    "POST",
    () => `/api/v1/cases/${ids.pinCase}/pins`,
    () => ({ target: { type: "claim", id: ids.personClaim } }),
  ],
  "pinning a person entity": [
    "POST",
    () => `/api/v1/cases/${ids.pinCase}/pins`,
    () => ({ target: { type: "entity", id: ids.personEntity } }),
  ],
};

/** Reads that rest on nothing but non-person evidence: never refused, never thinner. */
const CLEAN_CALLS: Record<string, Call> = {
  "entities of a clean run": ["GET", () => `/api/v1/entities?runId=${ids.cleanRun}`],
  "entities of a clean case": ["GET", () => `/api/v1/entities?caseId=${ids.cleanCase}`],
  "clean entity detail": ["GET", () => `/api/v1/entities/${ids.cleanEntity}`],
  "clean graph": ["GET", () => `/api/v1/graph?runId=${ids.cleanRun}&hops=1`],
  "clean timeline": ["GET", () => `/api/v1/timeline?runId=${ids.cleanRun}`],
  "clean merge candidates": [
    "GET",
    () => `/api/v1/entities/merge-candidates?runId=${ids.cleanRun}`,
  ],
  "pins of a clean case": ["GET", () => `/api/v1/cases/${ids.cleanCase}/pins`],
};

const run = (call: Call) => browser.request(call[0], call[1](), call[2]?.());

/** What a clean read returns, to compare the same read in every state. */
async function cleanSnapshot(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [name, call] of Object.entries(CLEAN_CALLS)) {
    const response = await run(call);
    expect(response.status, name).toBe(200);
    out[name] = response.body;
  }
  return out;
}

/** How many pins the pin-attempt case holds: refused attempts must add none. */
async function pinAttempts(): Promise<number> {
  const pins = await api.db.withTenant(tenantId, ({ repos }) =>
    repos.casePins.listForCase(ids.pinCase),
  );
  return pins.length;
}

function expectLocked(
  name: string,
  response: Awaited<ReturnType<typeof run>>,
  expected: { code: string; vettingStatus: string; plan: string },
) {
  expect(response.status, name).toBe(403);
  const problem = response.json<{
    code: string;
    detail: string;
    locked?: {
      module: string;
      moduleSummary: string;
      withheld: string;
      reason: string;
      plan: string;
      vettingStatus: string;
      nextStep: string;
    };
    items?: unknown;
    nodes?: unknown;
    entity?: unknown;
  }>();
  expect(problem.code, name).toBe(expected.code);
  expect(problem.locked, name).toMatchObject({
    module: "PERSON_INVESTIGATION",
    reason: expected.code,
    plan: expected.plan,
    vettingStatus: expected.vettingStatus,
  });
  // What is withheld, why, and the next step: each says something.
  expect(problem.locked?.withheld, name).toMatch(/.{11,}/);
  expect(problem.locked?.moduleSummary, name).toMatch(/.{11,}/);
  expect(problem.locked?.nextStep, name).toMatch(/.{11,}/);
  expect(problem.detail, name).toMatch(/nothing was returned/i);
  // Refused, not thinner: no result shape at all.
  expect(problem.items, name).toBeUndefined();
  expect(problem.nodes, name).toBeUndefined();
  expect(problem.entity, name).toBeUndefined();
  // And none of the person data leaks into the refusal.
  expect(response.body, name).not.toContain("[Person A]");
  expect(response.body, name).not.toContain("[person claim]");
}

describe("the person-data gate across the lifecycle (RELEASE-BLOCKING)", () => {
  let approved: Record<string, string>;
  let approvedFull: Record<string, string>;
  let pinsWhenApproved = -1;

  it("no plan: every read that rests on person data is refused, Locked", async () => {
    // The tenant starts on the technical plan with vetting not submitted.
    for (const [name, call] of Object.entries(LOCKED_CALLS)) {
      expectLocked(name, await run(call), {
        code: "MODULE_NOT_IN_PLAN",
        vettingStatus: "NOT_SUBMITTED",
        plan: "TECHINT",
      });
    }
    expect(await pinAttempts()).toBe(0);
    approved = await cleanSnapshot();
  });

  it("plan includes the module, vetting pending: still refused, now for vetting", async () => {
    await setEntitlement(tenantId, { plan: "TECHINT_AND_PERSON", vettingStatus: "PENDING" });
    for (const [name, call] of Object.entries(LOCKED_CALLS)) {
      expectLocked(name, await run(call), {
        code: "VETTING_NOT_APPROVED",
        vettingStatus: "PENDING",
        plan: "TECHINT_AND_PERSON",
      });
    }
    expect(await pinAttempts()).toBe(0);
    expect(await cleanSnapshot()).toEqual(approved);
  });

  it("approved: the same reads return the whole result, person data included", async () => {
    await setEntitlement(tenantId, { vettingStatus: "APPROVED" });
    for (const [name, call] of Object.entries(LOCKED_CALLS)) {
      const response = await run(call);
      expect([200, 201], `${name}: ${response.body.slice(0, 200)}`).toContain(response.status);
    }
    const detail = await browser.request("GET", `/api/v1/entities/${ids.mixedEntity}`);
    expect(detail.json<{ entity: { claimCount: number } }>().entity.claimCount).toBe(2);
    const graph = await browser.request("GET", `/api/v1/graph?runId=${ids.personRun}&hops=0`);
    expect(graph.json<{ nodes: unknown[] }>().nodes).toHaveLength(3);
    expect(await cleanSnapshot()).toEqual(approved);
    approvedFull = {
      list: (await browser.request("GET", `/api/v1/entities?runId=${ids.mixedRun}`)).body,
      pins: (await browser.request("GET", `/api/v1/cases/${ids.mixedCase}/pins`)).body,
    };
    expect(approvedFull["pins"]).toContain('"type":"evidence"');
    pinsWhenApproved = await pinAttempts();
    expect(pinsWhenApproved).toBe(3);
  });

  it("suspended: the same reads are refused, never a thinner result", async () => {
    await setEntitlement(tenantId, { vettingStatus: "SUSPENDED" });
    for (const [name, call] of Object.entries(LOCKED_CALLS)) {
      expectLocked(name, await run(call), {
        code: "VETTING_NOT_APPROVED",
        vettingStatus: "SUSPENDED",
        plan: "TECHINT_AND_PERSON",
      });
    }
    // The refused pin attempts changed nothing.
    expect(await pinAttempts()).toBe(pinsWhenApproved);
  });

  it("suspended: reads that rest on no person data are unchanged, byte for byte", async () => {
    expect(await cleanSnapshot()).toEqual(approved);
  });

  it("suspended: nothing from the approved result is returned in part", async () => {
    // The mixed run held 2 claims about one entity; a suspended tenant gets a refusal,
    // not a list with a lower count or without the entity.
    const response = await browser.request("GET", `/api/v1/entities?runId=${ids.mixedRun}`);
    expect(response.status).toBe(403);
    expect(response.body).not.toContain("mixed.example.com");
    expect(response.body).not.toContain('"claimCount"');
    expect(approvedFull["list"]).toContain('"claimCount":2');
  });

  it("the refusals are audited as ALLOWED handler runs that failed, and name no data", async () => {
    const rows = await api.db.withTenant(tenantId, ({ repos }) =>
      repos.auditLog.recent({ limit: 500 }),
    );
    expect(rows.some((row) => row.action === "graph.read" && row.outcome === "FAILED")).toBe(true);
  });
});

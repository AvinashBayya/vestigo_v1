/**
 * RELEASE-BLOCKING. The case analysis endpoints (R1-b):
 *   POST /api/v1/cases/:id/analyses   request one (202), or get the existing one (200)
 *   GET  /api/v1/cases/:id/analyses   where the case's analysis stands, and if it is current
 *   GET  /api/v1/case-analyses/:id    one analysis, and if it is current
 *
 * Covered here:
 *   - the lifecycle: NONE_YET, PENDING, COMPLETE, FAILED with its code, STALE;
 *     each with its reason, none with progress that was not measured;
 *   - idempotency: the same input is one analysis, enqueued once its request
 *     has committed; a failed one gets a new attempt; changed records get a
 *     new analysis;
 *   - the person gate on every route, refused whole with no status in the
 *     refusal: a pinned person record, and a run whose person collector found
 *     nothing (D-19); an analysis is refused by the records it read, after
 *     they are unpinned;
 *   - one snapshot for each read and its probes (D-32);
 *   - no credit estimate (null, with the reason) and no usage event.
 * Analyses are made by the real processor, called directly.
 */
import { randomUUID } from "node:crypto";
import type { TenantId } from "@repo/core";
import {
  CaseScopeRepository,
  contentRef,
  ExplorationRepository,
  hashContent,
  type PersonProbe,
} from "@repo/db";
import {
  CASE_ANALYSIS_STATE_REASONS,
  CaseAnalysisDocumentSchema,
  CaseAnalysisProcessor,
} from "@repo/osint-engine";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createTestApi,
  provisionTestTenant,
  readyBrowser,
  setEntitlement,
  type Browser,
  type TestApi,
} from "./support.ts";

let api: TestApi;

beforeAll(async () => {
  api = await createTestApi();
});

afterAll(async () => {
  await api.close();
});

const TECH = "fixture-dns";
const PERSON = "fixture-person";
const AT = new Date(Date.parse("2026-10-09T09:00:00.000Z"));

const LOCKED = { plan: "TECHINT_AND_PERSON", vettingStatus: "SUSPENDED" } as const;
const ENTITLED = { plan: "TECHINT_AND_PERSON", vettingStatus: "APPROVED" } as const;

interface Tenant {
  readonly tenantId: TenantId;
  readonly userId: string;
  readonly browser: Browser;
}

async function newTenant(tag: string): Promise<Tenant> {
  const provisioned = await provisionTestTenant(api, tag);
  const browser = await readyBrowser(api, provisioned.owner, provisioned.tenantId);
  await api.db.withTenant(provisioned.tenantId, async ({ repos }) => {
    for (const [collectorId, discipline] of [
      [TECH, "TECHINT"],
      [PERSON, "PERSON"],
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
  });
  return { tenantId: provisioned.tenantId, userId: provisioned.ownerUserId, browser };
}

interface Seeded {
  readonly runId: string;
  readonly techEvidenceId: string;
  readonly techEntityId: string;
  /** The person collector's evidence, when it found something. */
  readonly personEvidenceId: string | null;
  readonly personEntityId: string | null;
}

/**
 * One run as the platform writes it: a TECHINT job that found and recorded one
 * evidence item, fused into an entity with a claim; and, when asked, a PERSON
 * job that found nothing (no evidence, still person data) or found one item,
 * fused into a PERSON entity.
 */
async function seedRun(tenant: Tenant, person: "NONE" | "NOT_FOUND" | "FOUND"): Promise<Seeded> {
  return api.db.withTenant(tenant.tenantId, async ({ repos }) => {
    const investigation = await repos.investigations.create({
      title: "[Investigation]",
      target: "example.com",
      createdByUserId: tenant.userId,
    });
    const run = await repos.runs.create({
      investigationId: investigation.id,
      status: "QUEUED",
      requestedByUserId: tenant.userId,
    });
    const found = async (collectorId: string, tag: string): Promise<string> => {
      const job = await repos.jobs.create({
        runId: run.id,
        collectorId,
        idempotencyKey: `${tag}:${run.id}`,
        status: "QUEUED",
        targetType: "DOMAIN",
        target: "example.com",
      });
      const hash = hashContent(new TextEncoder().encode(`[payload ${tag} ${run.id}]`));
      const evidence = await repos.evidence.record({
        collectorId,
        collectorVersion: "1.0.0",
        jobId: job.id,
        sourceUrl: null,
        contentHash: hash,
        payloadRef: contentRef(tenant.tenantId, hash),
        observedAt: null,
        collectedAt: AT,
        claimStrength: "REPORTED",
      });
      await repos.jobs.transition(job.id, {
        status: "SUCCEEDED",
        attempts: 1,
        outcome: "FOUND",
        result: { names: [] },
        evidenceIds: [evidence.id],
        finishedAt: AT,
      });
      return evidence.id;
    };
    const techEvidenceId = await found(TECH, "tech");
    const techEntity = await repos.entities.create({ kind: "DOMAIN", displayName: "example.com" });
    await repos.claims.create({
      evidenceId: techEvidenceId,
      subject: { entityId: techEntity.id },
      attribute: "registrar",
      value: "[registrar]",
      strength: "REPORTED",
    });
    let personEvidenceId: string | null = null;
    let personEntityId: string | null = null;
    if (person === "NOT_FOUND") {
      const job = await repos.jobs.create({
        runId: run.id,
        collectorId: PERSON,
        idempotencyKey: `person:${run.id}`,
        status: "QUEUED",
        targetType: "DOMAIN",
        target: "example.com",
      });
      await repos.jobs.transition(job.id, {
        status: "SUCCEEDED",
        attempts: 1,
        outcome: "NOT_FOUND",
        outcomeDetail: "[nothing found]",
        finishedAt: AT,
      });
    } else if (person === "FOUND") {
      personEvidenceId = await found(PERSON, "person");
      const entity = await repos.entities.create({ kind: "PERSON", displayName: "[Person P]" });
      personEntityId = entity.id;
      await repos.claims.create({
        evidenceId: personEvidenceId,
        subject: { entityId: entity.id },
        attribute: "note",
        value: "[person note]",
        strength: "REPORTED",
      });
    }
    await repos.runs.transition(run.id, { status: "SUCCEEDED", startedAt: AT, finishedAt: AT });
    return {
      runId: run.id,
      techEvidenceId,
      techEntityId: techEntity.id,
      personEvidenceId,
      personEntityId,
    };
  });
}

/** A case pinning these entities; the pins' ids, in order. */
async function caseOf(
  tenant: Tenant,
  entityIds: readonly string[],
): Promise<{ readonly caseId: string; readonly pins: readonly string[] }> {
  return api.db.withTenant(tenant.tenantId, async ({ repos }) => {
    const created = await repos.cases.create({
      title: "[Case]",
      description: null,
      createdByUserId: tenant.userId,
    });
    const pins: string[] = [];
    for (const entityId of entityIds) {
      const pin = await repos.casePins.pin({
        caseId: created.id,
        target: { entityId },
        pinnedByUserId: tenant.userId,
        note: null,
      });
      pins.push(pin.id);
    }
    return { caseId: created.id, pins };
  });
}

interface Read {
  readonly state: string;
  readonly reason: string;
  readonly caseId: string;
  readonly currentInputHash: string;
  readonly analysis: {
    readonly id: string;
    readonly inputHash: string;
    readonly attempt: number;
    readonly status: string;
    readonly finishedAt: string | null;
    readonly error: { readonly code: string; readonly message: string } | null;
    readonly document: unknown;
    readonly wording: unknown;
  } | null;
  readonly estimatedCredits?: number | null;
  readonly estimatedCreditsReason?: string | null;
}

const processor = () =>
  new CaseAnalysisProcessor({
    db: api.db,
    collectors: api.services.runs.caseAnalysisCollectors,
    timeoutMs: 10_000,
  });

/** Every enqueue the API makes, with whether its request had committed by then. */
function watchEnqueues(tenantId: TenantId) {
  const calls: { analysisId: string; attempt: number; committed: boolean }[] = [];
  const queue = api.services.runs.caseAnalyses;
  const original = queue.enqueueAnalysis.bind(queue);
  const spy = vi
    .spyOn(queue, "enqueueAnalysis")
    .mockImplementation(async (tenant, analysisId, attempt) => {
      // Read from a transaction of its own: only a committed request is visible.
      const visible = await api.db.withTenant(tenantId, ({ repos }) =>
        repos.caseAnalyses.findById(analysisId),
      );
      calls.push({ analysisId, attempt, committed: visible !== null });
      return original(tenant, analysisId, attempt);
    });
  return { calls, spy };
}

const post = (tenant: Tenant, caseId: string) =>
  tenant.browser.request("POST", `/api/v1/cases/${caseId}/analyses`);
const latest = (tenant: Tenant, caseId: string) =>
  tenant.browser.request("GET", `/api/v1/cases/${caseId}/analyses`);
const one = (tenant: Tenant, analysisId: string) =>
  tenant.browser.request("GET", `/api/v1/case-analyses/${analysisId}`);

describe("requesting and reading a case analysis (RELEASE-BLOCKING)", () => {
  let tenant: Tenant;
  let seeded: Seeded;
  let caseId: string;
  let analysisId: string;

  beforeAll(async () => {
    tenant = await newTenant("analyses");
    seeded = await seedRun(tenant, "NONE");
    caseId = (await caseOf(tenant, [seeded.techEntityId])).caseId;
  });

  it("says NONE_YET before anything is requested", async () => {
    const response = await latest(tenant, caseId);
    expect(response.status).toBe(200);
    expect(response.json<Read>()).toMatchObject({
      state: "NONE_YET",
      reason: CASE_ANALYSIS_STATE_REASONS.NONE_YET,
      caseId,
      analysis: null,
    });
  });

  it("requests one (202), enqueued once committed, with no credit estimate and no usage", async () => {
    const { calls, spy } = watchEnqueues(tenant.tenantId);
    try {
      const response = await post(tenant, caseId);
      expect(response.status).toBe(202);
      const body = response.json<Read>();
      expect(body).toMatchObject({
        state: "PENDING",
        reason: CASE_ANALYSIS_STATE_REASONS.PENDING,
        estimatedCredits: null,
        estimatedCreditsReason: expect.stringContaining("No credit cost") as unknown,
        analysis: { attempt: 1, status: "PENDING", document: null, finishedAt: null, error: null },
      });
      expect(body.analysis?.inputHash).toBe(body.currentInputHash);
      analysisId = body.analysis?.id ?? "";
      expect(calls).toEqual([{ analysisId, attempt: 1, committed: true }]);
    } finally {
      spy.mockRestore();
    }
  });

  it("returns the same analysis (200) for the same input, and enqueues only a pending one again", async () => {
    const { calls, spy } = watchEnqueues(tenant.tenantId);
    try {
      const again = await post(tenant, caseId);
      expect(again.status).toBe(200);
      expect(again.json<Read>()).toMatchObject({ state: "PENDING", analysis: { id: analysisId } });
      // A pending analysis whose enqueue was lost resumes; the job id is the same.
      expect(calls).toEqual([{ analysisId, attempt: 1, committed: true }]);
    } finally {
      spy.mockRestore();
    }
    const pending = await latest(tenant, caseId);
    expect(pending.json<Read>()).toMatchObject({ state: "PENDING", analysis: { id: analysisId } });
  });

  it("reads COMPLETE with the validated documents once the job has run", async () => {
    await processor().process(tenant.tenantId, analysisId, 1);
    for (const response of [await latest(tenant, caseId), await one(tenant, analysisId)]) {
      expect(response.status).toBe(200);
      const body = response.json<Read>();
      expect(body).toMatchObject({
        state: "COMPLETE",
        reason: CASE_ANALYSIS_STATE_REASONS.COMPLETE,
        analysis: { id: analysisId, status: "COMPLETE", error: null },
      });
      expect(body.analysis?.finishedAt).not.toBeNull();
      expect(CaseAnalysisDocumentSchema.safeParse(body.analysis?.document).success).toBe(true);
      expect(body.analysis?.wording).not.toBeNull();
    }
    const { calls, spy } = watchEnqueues(tenant.tenantId);
    try {
      const complete = await post(tenant, caseId);
      expect(complete.status).toBe(200);
      expect(complete.json<Read>()).toMatchObject({ state: "COMPLETE" });
      expect(calls).toEqual([]);
    } finally {
      spy.mockRestore();
    }
    const usage = await api.db.withTenant(tenant.tenantId, ({ repos }) =>
      repos.usageEvents.list({ limit: 100 }),
    );
    expect(usage).toEqual([]);
  });

  it("reads STALE once the case's records change, and a new request is a new analysis", async () => {
    await api.db.withTenant(tenant.tenantId, ({ repos }) =>
      repos.claims.create({
        evidenceId: seeded.techEvidenceId,
        subject: { entityId: seeded.techEntityId },
        attribute: "registrant",
        value: "[late claim]",
        strength: "REPORTED",
      }),
    );
    for (const response of [await latest(tenant, caseId), await one(tenant, analysisId)]) {
      const body = response.json<Read>();
      expect(body).toMatchObject({
        state: "STALE",
        reason: CASE_ANALYSIS_STATE_REASONS.STALE,
        analysis: { id: analysisId, status: "COMPLETE" },
      });
      expect(body.currentInputHash).not.toBe(body.analysis?.inputHash);
    }
    const fresh = await post(tenant, caseId);
    expect(fresh.status).toBe(202);
    const next = fresh.json<Read>().analysis?.id;
    expect(next).not.toBe(analysisId);
    // The case's read now shows the analysis of the case as it is.
    expect((await latest(tenant, caseId)).json<Read>()).toMatchObject({
      state: "PENDING",
      analysis: { id: next },
    });
    // The earlier one still reads, as of then.
    expect((await one(tenant, analysisId)).json<Read>()).toMatchObject({ state: "STALE" });
  });

  it("reads FAILED with its code, and a new request makes a new attempt (202)", async () => {
    const pending = (await latest(tenant, caseId)).json<Read>().analysis;
    if (pending === null) return expect.fail("[test] a pending analysis");
    await api.db.withTenant(tenant.tenantId, ({ repos }) =>
      repos.caseAnalysisEvents.fail({
        analysisId: pending.id,
        attempt: 1,
        error: { code: "CASE_ANALYSIS_TIMEOUT", message: "[timed out]" },
        at: AT,
      }),
    );
    const failed = (await latest(tenant, caseId)).json<Read>();
    expect(failed).toMatchObject({
      state: "FAILED",
      reason: CASE_ANALYSIS_STATE_REASONS.FAILED.replace("{code}", "CASE_ANALYSIS_TIMEOUT"),
      analysis: { id: pending.id, attempt: 1, error: { code: "CASE_ANALYSIS_TIMEOUT" } },
    });
    const { calls, spy } = watchEnqueues(tenant.tenantId);
    try {
      const retried = await post(tenant, caseId);
      expect(retried.status).toBe(202);
      expect(retried.json<Read>()).toMatchObject({
        state: "PENDING",
        analysis: { id: pending.id, attempt: 2, error: null },
      });
      expect(calls).toEqual([{ analysisId: pending.id, attempt: 2, committed: true }]);
    } finally {
      spy.mockRestore();
    }
    expect((await processor().process(tenant.tenantId, pending.id, 2)).kind).toBe("COMPLETED");
    expect((await one(tenant, pending.id)).json<Read>()).toMatchObject({
      state: "COMPLETE",
      analysis: { attempt: 2 },
    });
  });

  it("two requests at once for a new input make one analysis", async () => {
    await api.db.withTenant(tenant.tenantId, ({ repos }) =>
      repos.claims.create({
        evidenceId: seeded.techEvidenceId,
        subject: { entityId: seeded.techEntityId },
        attribute: "status",
        value: "[another late claim]",
        strength: "REPORTED",
      }),
    );
    const both = await Promise.all([post(tenant, caseId), post(tenant, caseId)]);
    const statuses = both.map((r) => r.status).sort();
    // One records it (202); the other returns it (200) or was told to send again (409).
    expect(statuses[1]).toBe(202);
    expect([200, 409]).toContain(statuses[0]);
    const ids = new Set(
      both.filter((r) => r.status !== 409).map((r) => r.json<Read>().analysis?.id),
    );
    expect(ids.size).toBe(1);
  });

  it("an empty case completes honestly as EMPTY_CASE", async () => {
    const empty = (await caseOf(tenant, [])).caseId;
    const requested = await post(tenant, empty);
    expect(requested.status).toBe(202);
    const id = requested.json<Read>().analysis?.id ?? "";
    await processor().process(tenant.tenantId, id, 1);
    expect((await latest(tenant, empty)).json<Read>()).toMatchObject({
      state: "COMPLETE",
      analysis: {
        document: {
          coverage: { kind: "EMPTY_CASE" },
          collectors: { kind: "EMPTY_CASE" },
          breakdown: { kind: "EMPTY_CASE" },
          basis: { evidenceIds: [], runIds: [] },
        },
      },
    });
  });

  it("answers 404 for an unknown case or analysis, and for another tenant's", async () => {
    expect((await post(tenant, randomUUID())).status).toBe(404);
    expect((await latest(tenant, randomUUID())).status).toBe(404);
    expect((await one(tenant, randomUUID())).status).toBe(404);
    const other = await newTenant("analyses-other");
    expect((await one(other, analysisId)).status).toBe(404);
    expect((await latest(other, caseId)).status).toBe(404);
    expect((await post(other, caseId)).status).toBe(404);
  });
});

describe("who may request and read a case analysis (RELEASE-BLOCKING)", () => {
  it("an API key scoped to case:analyse and case:read may; case:read alone may only read", async () => {
    const tenant = await newTenant("analyses-keys");
    const seeded = await seedRun(tenant, "NONE");
    const { caseId } = await caseOf(tenant, [seeded.techEntityId]);
    const issue = async (permissions: string[]) => {
      const response = await tenant.browser.request("POST", "/api/v1/api-keys", {
        name: `[key ${permissions.join(" ")}]`,
        permissions,
        expiresAt: null,
      });
      expect(response.status).toBe(201);
      return response.json<{ plaintext: string }>().plaintext;
    };
    const withKey = (key: string, method: "GET" | "POST", url: string) =>
      api.app.inject({ method, url, headers: { authorization: `Bearer ${key}` } });
    const full = await issue(["case:analyse", "case:read"]);
    const reader = await issue(["case:read"]);
    const requested = await withKey(full, "POST", `/api/v1/cases/${caseId}/analyses`);
    expect(requested.statusCode).toBe(202);
    expect((await withKey(reader, "GET", `/api/v1/cases/${caseId}/analyses`)).statusCode).toBe(200);
    const refused = await withKey(reader, "POST", `/api/v1/cases/${caseId}/analyses`);
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ code: "PERMISSION_DENIED" });
  });
});

describe("the person gate over a case and its runs, on every route (RELEASE-BLOCKING)", () => {
  /** A refusal says why and what to do, and nothing about any analysis. */
  function expectRefusedWhole(response: { status: number; body: string }, ids: readonly string[]) {
    expect(response.status).toBe(403);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body).toMatchObject({
      code: "VETTING_NOT_APPROVED",
      locked: { reason: "VETTING_NOT_APPROVED" },
    });
    for (const key of ["state", "analysis", "currentInputHash", "reason"]) {
      expect(body).not.toHaveProperty(key);
    }
    for (const word of ["PENDING", "COMPLETE", "STALE", "NONE_YET", ...ids]) {
      expect(response.body).not.toContain(word);
    }
  }

  for (const [person, what] of [
    ["FOUND", "a pinned person record"],
    ["NOT_FOUND", "a run whose person collector found nothing (D-19)"],
  ] as const) {
    it(`refuses all three routes whole for ${what}`, async () => {
      const tenant = await newTenant(`analyses-gate-${person.toLowerCase()}`);
      const seeded = await seedRun(tenant, person);
      const pinned = [
        seeded.techEntityId,
        ...(seeded.personEntityId === null ? [] : [seeded.personEntityId]),
      ];
      const { caseId } = await caseOf(tenant, pinned);
      // Requested and made while entitled, so there is an analysis to withhold.
      await setEntitlement(tenant.tenantId, ENTITLED);
      const requested = await post(tenant, caseId);
      expect(requested.status).toBe(202);
      const analysisId = requested.json<Read>().analysis?.id ?? "";
      await processor().process(tenant.tenantId, analysisId, 1);
      expect((await one(tenant, analysisId)).json<Read>()).toMatchObject({ state: "COMPLETE" });

      await setEntitlement(tenant.tenantId, LOCKED);
      expectRefusedWhole(await post(tenant, caseId), [analysisId]);
      expectRefusedWhole(await latest(tenant, caseId), [analysisId]);
      expectRefusedWhole(await one(tenant, analysisId), [analysisId]);
      // A refused request recorded nothing.
      const analyses = await api.db.withTenant(tenant.tenantId, ({ repos }) =>
        repos.caseAnalyses.listForCase(caseId, { limit: 10 }),
      );
      expect(analyses.map((a) => a.id)).toEqual([analysisId]);
    });
  }

  it("refuses an analysis by the records it read, after they are unpinned", async () => {
    const tenant = await newTenant("analyses-gate-unpinned");
    // The technical record and the person record come from runs of their own.
    const seeded = await seedRun(tenant, "NONE");
    const person = await seedRun(tenant, "FOUND");
    if (person.personEntityId === null) return expect.fail("[test] a person entity");
    const { caseId, pins } = await caseOf(tenant, [seeded.techEntityId, person.personEntityId]);
    await setEntitlement(tenant.tenantId, ENTITLED);
    const analysisId = (await post(tenant, caseId)).json<Read>().analysis?.id ?? "";
    await processor().process(tenant.tenantId, analysisId, 1);

    // The person record leaves the case, and its run with it: the case now rests on none.
    const personPin = pins[1];
    if (personPin === undefined) return expect.fail("[test] the person pin");
    await api.db.withTenant(tenant.tenantId, ({ repos }) => repos.casePins.unpin(personPin));
    await setEntitlement(tenant.tenantId, LOCKED);
    // The stored analysis read person data: refused, however old.
    expectRefusedWhole(await one(tenant, analysisId), [analysisId]);
    // The case's read would show that analysis (the latest, now STALE): refused too.
    expectRefusedWhole(await latest(tenant, caseId), [analysisId]);
    // A new request is of the case as it is now, which rests on no person data.
    const fresh = await post(tenant, caseId);
    expect(fresh.status).toBe(202);
    expect(fresh.json<Read>().analysis?.id).not.toBe(analysisId);
  });

  it("answers a locked organisation in full for a case resting on no person data", async () => {
    const tenant = await newTenant("analyses-gate-clean");
    await setEntitlement(tenant.tenantId, LOCKED);
    const seeded = await seedRun(tenant, "NONE");
    const { caseId } = await caseOf(tenant, [seeded.techEntityId]);
    const requested = await post(tenant, caseId);
    expect(requested.status).toBe(202);
    const analysisId = requested.json<Read>().analysis?.id ?? "";
    await processor().process(tenant.tenantId, analysisId, 1);
    expect((await latest(tenant, caseId)).json<Read>()).toMatchObject({ state: "COMPLETE" });
    expect((await one(tenant, analysisId)).json<Read>()).toMatchObject({ state: "COMPLETE" });
  });
});

describe("each case-analysis request and its probes share one snapshot (D-32, RELEASE-BLOCKING)", () => {
  /** Commits `commit` before the `nth` probe of the case's scope runs. */
  function commitBeforeProbe(caseId: string, nth: number, commit: () => Promise<unknown>) {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- called below with each instance as `this`
    const original = ExplorationRepository.prototype.touchesPersonData;
    const state = { probes: 0, committed: false };
    const ofCase = (probe: PersonProbe): boolean =>
      probe.scope !== undefined && "caseId" in probe.scope && probe.scope.caseId === caseId;
    const spy = vi
      .spyOn(ExplorationRepository.prototype, "touchesPersonData")
      .mockImplementation(async function (this: ExplorationRepository, probe) {
        if (ofCase(probe)) {
          state.probes += 1;
          if (state.probes === nth && !state.committed) {
            state.committed = true;
            await commit();
          }
        }
        return original.call(this, probe);
      });
    return { state, spy };
  }

  it("a fusion between the read and its probe never refuses a read that held no person data", async () => {
    const tenant = await newTenant("analyses-snapshot-read");
    const seeded = await seedRun(tenant, "NONE");
    const person = await seedRun(tenant, "FOUND");
    if (person.personEvidenceId === null) return expect.fail("[test] person evidence");
    const personEvidenceId = person.personEvidenceId;
    const { caseId } = await caseOf(tenant, [seeded.techEntityId]);
    const analysisId = (await post(tenant, caseId)).json<Read>().analysis?.id ?? "";
    await processor().process(tenant.tenantId, analysisId, 1);
    await setEntitlement(tenant.tenantId, LOCKED);

    // After the case is read and hashed, before the probe that covers the
    // analysis, a person claim lands on the pinned entity.
    const { state, spy } = commitBeforeProbe(caseId, 2, () =>
      api.db.withTenant(tenant.tenantId, ({ repos }) =>
        repos.claims.create({
          evidenceId: personEvidenceId,
          subject: { entityId: seeded.techEntityId },
          attribute: "note",
          value: "[late person claim]",
          strength: "REPORTED",
        }),
      ),
    );
    try {
      const response = await one(tenant, analysisId);
      expect(state.committed).toBe(true);
      // The probe saw what the read saw: no person data, and the case unchanged.
      expect(response.status).toBe(200);
      expect(response.json<Read>()).toMatchObject({ state: "COMPLETE" });
      expect(response.body).not.toContain("[late person claim]");
    } finally {
      spy.mockRestore();
    }
    // Committed: the case now rests on person data, and the next read is refused.
    expect((await one(tenant, analysisId)).status).toBe(403);
  });

  it("a fusion between the gate and the read is not in the input the request hashes", async () => {
    const tenant = await newTenant("analyses-snapshot-request");
    const seeded = await seedRun(tenant, "NONE");
    const person = await seedRun(tenant, "FOUND");
    if (person.personEvidenceId === null) return expect.fail("[test] person evidence");
    const personEvidenceId = person.personEvidenceId;
    const { caseId } = await caseOf(tenant, [seeded.techEntityId]);
    await setEntitlement(tenant.tenantId, LOCKED);
    const before = (await latest(tenant, caseId)).json<Read>().currentInputHash;

    // After the gate passed the case, before its records are read for the hash.
    // eslint-disable-next-line @typescript-eslint/unbound-method -- called below with each instance as `this`
    const original = CaseScopeRepository.prototype.records;
    const state = { committed: false };
    const spy = vi
      .spyOn(CaseScopeRepository.prototype, "records")
      .mockImplementation(async function (this: CaseScopeRepository, id) {
        if (!state.committed && id === caseId) {
          state.committed = true;
          await api.db.withTenant(tenant.tenantId, ({ repos }) =>
            repos.claims.create({
              evidenceId: personEvidenceId,
              subject: { entityId: seeded.techEntityId },
              attribute: "note",
              value: "[late person claim]",
              strength: "REPORTED",
            }),
          );
        }
        return original.call(this, id);
      });
    try {
      const response = await post(tenant, caseId);
      expect(state.committed).toBe(true);
      // The analysis is of the input the gate passed, nothing committed after.
      expect(response.status).toBe(202);
      expect(response.json<Read>().analysis?.inputHash).toBe(before);
    } finally {
      spy.mockRestore();
    }
  });
});

/**
 * RELEASE-BLOCKING (CLAUDE.md §9; Track M D-M1, Day 1). A TOPIC is free text
 * that may name a person, and no rule can tell a name from any other words, so
 * a run on a TOPIC is person data whatever collects it. Fail closed on the
 * target type:
 *   - starting one, for an organisation whose plan or vetting does not allow
 *     person investigation, is refused whole with the Locked detail: no run is
 *     created and nothing is queued, so nothing is collected;
 *   - an entitled organisation may start one, recorded as person-bearing;
 *   - a TOPIC run that used only a news collector is still refused whole on
 *     every read of it, as a person collector's run is, while the same
 *     collector's run on a domain is not.
 */
import { contentRef, hashContent } from "@repo/db";
import type { TenantId } from "@repo/core";
import { InvestigationQueue } from "@repo/osint-engine";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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
let ownerUserId: string;
let browser: Browser;

beforeAll(async () => {
  api = await createTestApi();
  const provisioned = await provisionTestTenant(api, "topic");
  tenantId = provisioned.tenantId;
  ownerUserId = provisioned.ownerUserId;
  browser = await readyBrowser(api, provisioned.owner, tenantId);
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await api.close();
});

interface LockedBody {
  code: string;
  locked: { module: string; reason: string; withheld: string; nextStep: string };
}

async function investigation(target: string): Promise<string> {
  const response = await browser.request("POST", "/api/v1/investigations", {
    title: "[topic investigation]",
    target,
  });
  expect(response.status).toBe(201);
  return response.json<{ id: string }>().id;
}

const startRun = (investigationId: string, targetType?: string) =>
  browser.request(
    "POST",
    `/api/v1/investigations/${investigationId}/runs`,
    targetType === undefined ? {} : { targetType },
  );

async function runsOf(investigationId: string): Promise<unknown[]> {
  const response = await browser.request("GET", `/api/v1/investigations/${investigationId}/runs`);
  expect(response.status).toBe(200);
  return response.json<{ items: unknown[] }>().items;
}

describe("starting a TOPIC run (RELEASE-BLOCKING)", () => {
  it("is refused whole without the person module: 403, the Locked detail, no run, nothing queued", async () => {
    await setEntitlement(tenantId, { plan: "TECHINT", vettingStatus: "APPROVED" });
    const enqueued = vi.spyOn(InvestigationQueue.prototype, "enqueueRun");
    // Chosen as a topic, and detected first as one (a hashtag, a quoted phrase).
    for (const [target, targetType] of [
      ["[a subject]", "TOPIC"],
      ["#elections", undefined],
      ['"a quoted phrase"', undefined],
    ] as const) {
      const id = await investigation(target);
      const response = await startRun(id, targetType);
      expect(response.status, target).toBe(403);
      const body = response.json<LockedBody>();
      expect(body.code).toBe("MODULE_NOT_IN_PLAN");
      expect(body.locked).toMatchObject({
        module: "PERSON_INVESTIGATION",
        reason: "MODULE_NOT_IN_PLAN",
      });
      expect(body.locked.withheld).toMatch(/TOPIC target is person data whatever collects it/);
      expect(body.locked.nextStep).toMatch(/.{11,}/);
      expect(await runsOf(id)).toEqual([]);
    }
    expect(enqueued).not.toHaveBeenCalled();
    // The gate is the target's, not a blanket refusal: a domain still starts.
    const domain = await startRun(await investigation("example.com"));
    expect(domain.status).toBe(202);
    expect(enqueued).toHaveBeenCalledTimes(1);
  });

  it("is refused whole with the module but without approved vetting: 403 VETTING_NOT_APPROVED", async () => {
    const enqueued = vi.spyOn(InvestigationQueue.prototype, "enqueueRun");
    for (const vettingStatus of ["NOT_SUBMITTED", "PENDING", "REJECTED", "SUSPENDED"]) {
      await setEntitlement(tenantId, { plan: "TECHINT_AND_PERSON", vettingStatus });
      const id = await investigation("[a subject]");
      const response = await startRun(id, "TOPIC");
      expect(response.status, vettingStatus).toBe(403);
      expect(response.json<LockedBody>()).toMatchObject({
        code: "VETTING_NOT_APPROVED",
        locked: { reason: "VETTING_NOT_APPROVED" },
      });
      expect(await runsOf(id)).toEqual([]);
    }
    expect(enqueued).not.toHaveBeenCalled();
  });

  it("is allowed with the plan and approved vetting, and the run is recorded as person-bearing", async () => {
    await setEntitlement(tenantId, { plan: "TECHINT_AND_PERSON", vettingStatus: "APPROVED" });
    const enqueued = vi.spyOn(InvestigationQueue.prototype, "enqueueRun");
    const id = await investigation("[a subject]");
    const response = await startRun(id, "TOPIC");
    expect(response.status).toBe(202);
    const run = response.json<{ id: string; status: string }>();
    expect(run.status).toBe("QUEUED");
    expect(enqueued).toHaveBeenCalledTimes(1);
    const stored = await api.db.withTenant(tenantId, ({ repos }) => repos.runs.findById(run.id));
    expect(stored).toMatchObject({ requestedTargetType: "TOPIC", personBearing: true });
  });

  it("audits each refusal as a failed start that names no run, since none was created", async () => {
    const refusals = (await auditRows(api, tenantId)).filter(
      (row) => row.action === "run.start" && row.outcome === "FAILED",
    );
    const codes = refusals.map((row) => (row.details as { error?: string } | null)?.error);
    expect(new Set(codes)).toEqual(new Set(["MODULE_NOT_IN_PLAN", "VETTING_NOT_APPROVED"]));
    expect(refusals.every((row) => row.targetType === null && row.targetId === null)).toBe(true);
  });
});

describe("a TOPIC run that used only a news collector is person data (RELEASE-BLOCKING)", () => {
  interface Seeded {
    readonly run: string;
    readonly evidence: string;
    readonly entity: string;
    readonly caseId: string;
  }

  /** The news collector, registered once: a MEDIAINT source, not a person one. */
  async function registerNewsCollector(): Promise<void> {
    await api.db.withTenant(tenantId, async ({ repos }) => {
      await repos.collectorsRegistry.register({
        collectorId: "fixture-news",
        sourceLabel: "[fixture-news]",
        discipline: "MEDIAINT",
        collectionMode: "PASSIVE_API",
        dataLicence: "[not applicable: test fixture]",
        commercialUse: "UNVERIFIED",
        enabled: true,
        disabledReason: null,
      });
    });
  }

  /** A run of the news collector on this target, with one finding pinned to a case. */
  async function seed(target: string, topic: boolean): Promise<Seeded> {
    return api.db.withTenant(tenantId, async ({ repos }) => {
      const created = await repos.investigations.create({
        title: "[news run]",
        target,
        createdByUserId: ownerUserId,
      });
      const run = await repos.runs.create({
        investigationId: created.id,
        status: "QUEUED",
        requestedByUserId: ownerUserId,
        requestedTargetType: topic ? "TOPIC" : "DOMAIN",
      });
      const job = await repos.jobs.create({
        runId: run.id,
        collectorId: "fixture-news",
        idempotencyKey: `topic-runs:${run.id}`,
        status: "QUEUED",
        targetType: topic ? "TOPIC" : "DOMAIN",
        target,
      });
      const hash = hashContent(new TextEncoder().encode(`[news payload ${run.id}]`));
      const evidence = await repos.evidence.record({
        collectorId: "fixture-news",
        collectorVersion: "0.0.0-test",
        jobId: job.id,
        sourceUrl: null,
        contentHash: hash,
        payloadRef: contentRef(tenantId, hash),
        observedAt: null,
        collectedAt: new Date("2026-05-01T00:00:00Z"),
        claimStrength: "REPORTED",
      });
      const entity = await repos.entities.create({ kind: "URL", displayName: "[an article]" });
      await repos.claims.create({
        evidenceId: evidence.id,
        subject: { entityId: entity.id },
        attribute: "headline",
        value: "[a headline]",
        strength: "REPORTED",
      });
      const caseRow = await repos.cases.create({
        title: "[news case]",
        description: null,
        createdByUserId: ownerUserId,
      });
      await repos.casePins.pin({
        caseId: caseRow.id,
        target: { evidenceId: evidence.id },
        pinnedByUserId: ownerUserId,
        note: null,
      });
      return { run: run.id, evidence: evidence.id, entity: entity.id, caseId: caseRow.id };
    });
  }

  const reads = (seeded: Seeded) => [
    `/api/v1/runs/${seeded.run}`,
    `/api/v1/evidence/${seeded.evidence}`,
    `/api/v1/entities/${seeded.entity}`,
    `/api/v1/cases/${seeded.caseId}/pins`,
  ];

  it("is refused whole on every read without the plan or vetting, and read in full with both", async () => {
    await setEntitlement(tenantId, { plan: "TECHINT_AND_PERSON", vettingStatus: "APPROVED" });
    await registerNewsCollector();
    const topic = await seed("[a subject]", true);
    const domain = await seed("news.example.com", false);
    for (const [entitlement, code] of [
      [{ plan: "TECHINT", vettingStatus: "APPROVED" }, "MODULE_NOT_IN_PLAN"],
      [{ plan: "TECHINT_AND_PERSON", vettingStatus: "SUSPENDED" }, "VETTING_NOT_APPROVED"],
    ] as const) {
      await setEntitlement(tenantId, entitlement);
      for (const path of reads(topic)) {
        const response = await browser.request("GET", path);
        expect(response.status, `${code} ${path}`).toBe(403);
        expect(response.json<LockedBody>(), path).toMatchObject({ code, locked: { reason: code } });
      }
      // The same collector's run on a domain is not person data.
      for (const path of reads(domain)) {
        expect((await browser.request("GET", path)).status, `${code} ${path}`).toBe(200);
      }
    }
    await setEntitlement(tenantId, { plan: "TECHINT_AND_PERSON", vettingStatus: "APPROVED" });
    for (const path of reads(topic)) {
      expect((await browser.request("GET", path)).status, path).toBe(200);
    }
  });
});

describe("an estimate says which reading it would not plan, and why (Day 1)", () => {
  interface EstimateBody {
    detectedType: string;
    alternateTypes: string[];
    targets: { type: string }[];
    notPlanned: { type: string; reason: string; message: string }[];
  }

  it("names a TOPIC that is only an alternate as not planned unless chosen", async () => {
    const response = await browser.request("POST", "/api/v1/estimates", { target: "[two words]" });
    expect(response.status).toBe(200);
    const estimate = response.json<EstimateBody>();
    expect(estimate.detectedType).toBe("ORGANIZATION");
    expect(estimate.alternateTypes).toEqual(["TOPIC"]);
    expect(estimate.targets.map((target) => target.type)).toEqual(["ORGANIZATION"]);
    expect(estimate.notPlanned).toEqual([
      {
        type: "TOPIC",
        reason: "NOT_PLANNED_UNLESS_CHOSEN",
        message: expect.stringMatching(/^Not planned unless chosen: /) as string,
      },
    ]);
  });

  it("leaves nothing out when the topic is chosen or detected first", async () => {
    for (const body of [{ target: "[two words]", targetType: "TOPIC" }, { target: "#elections" }]) {
      const response = await browser.request("POST", "/api/v1/estimates", body);
      expect(response.status).toBe(200);
      expect(response.json<EstimateBody>().notPlanned).toEqual([]);
    }
  });
});

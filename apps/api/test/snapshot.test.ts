/**
 * RELEASE-BLOCKING. D-32: a gated case-scope read and its person probe run on
 * one snapshot, so a scope that shrinks (an unpin) or grows (a fusion) between
 * the read and the probe cannot make them disagree. Each test commits the
 * change from another transaction after the read and before the probe runs:
 *   - an unpin of a person record: on a snapshot the probe still sees what the
 *     read returned, and the read is refused whole; without one the probe
 *     misses it and the person data is returned (a leak);
 *   - a fusion adding a person claim to a pinned entity: on a snapshot the
 *     probe sees what the read returned, none of it person data, and the read
 *     is answered without the new claim; without one the probe sees the claim
 *     the body never held, and refuses a body that rests on no person data.
 * Removing `snapshot: true` from the route fails both.
 */
import type { TenantId } from "@repo/core";
import { contentRef, ExplorationRepository, hashContent, type PersonProbe } from "@repo/db";
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
let browser: Browser;
let tenantId: TenantId;
let userId: string;

interface Seeded {
  readonly techEvidenceId: string;
  readonly personEvidenceId: string;
  readonly techEntityId: string;
  readonly personEntityId: string;
}
let seeded: Seeded;

beforeAll(async () => {
  api = await createTestApi();
  const tenant = await provisionTestTenant(api, "snapshot");
  tenantId = tenant.tenantId;
  userId = tenant.ownerUserId;
  browser = await readyBrowser(api, tenant.owner, tenantId);
  seeded = await api.db.withTenant(tenantId, async ({ repos }) => {
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
    const evidenceFor = async (collectorId: string, tag: string) => {
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
        idempotencyKey: `snapshot:${tag}:${run.id}`,
        status: "QUEUED",
      });
      const hash = hashContent(new TextEncoder().encode(`[payload ${tag} ${run.id}]`));
      const evidence = await repos.evidence.record({
        collectorId,
        collectorVersion: "0.0.0-test",
        jobId: job.id,
        sourceUrl: null,
        contentHash: hash,
        payloadRef: contentRef(tenantId, hash),
        observedAt: null,
        collectedAt: new Date(Date.parse("2026-05-01T00:00:00Z")),
        claimStrength: "REPORTED",
      });
      return evidence.id;
    };
    const techEvidenceId = await evidenceFor("fixture", "tech");
    const personEvidenceId = await evidenceFor("fixture-person", "person");
    const techEntity = await repos.entities.create({ kind: "DOMAIN", displayName: "example.com" });
    const personEntity = await repos.entities.create({ kind: "PERSON", displayName: "[Person P]" });
    await repos.claims.create({
      evidenceId: techEvidenceId,
      subject: { entityId: techEntity.id },
      attribute: "registrar",
      value: "[registrar]",
      strength: "REPORTED",
    });
    await repos.claims.create({
      evidenceId: personEvidenceId,
      subject: { entityId: personEntity.id },
      attribute: "note",
      value: "[person note]",
      strength: "REPORTED",
    });
    return {
      techEvidenceId,
      personEvidenceId,
      techEntityId: techEntity.id,
      personEntityId: personEntity.id,
    };
  });
  // Locked: the plan has the module, vetting is suspended.
  await setEntitlement(tenantId, { plan: "TECHINT_AND_PERSON", vettingStatus: "SUSPENDED" });
});

afterAll(async () => {
  await api.close();
});

async function caseWith(entityIds: readonly string[]): Promise<{ caseId: string; pins: string[] }> {
  return api.db.withTenant(tenantId, async ({ repos }) => {
    const created = await repos.cases.create({
      title: "[Snapshot case]",
      description: null,
      createdByUserId: userId,
    });
    const pins: string[] = [];
    for (const entityId of entityIds) {
      const pin = await repos.casePins.pin({
        caseId: created.id,
        target: { entityId },
        pinnedByUserId: userId,
        note: null,
      });
      pins.push(pin.id);
    }
    return { caseId: created.id, pins };
  });
}

/**
 * Spies on the probe: before the first probe of `caseId`'s scope runs, `commit`
 * commits from a transaction of its own, so the change lands after the read.
 */
function commitBeforeProbe(caseId: string, commit: () => Promise<unknown>) {
  // eslint-disable-next-line @typescript-eslint/unbound-method -- called below with each instance as `this`
  const original = ExplorationRepository.prototype.touchesPersonData;
  const state = { committed: false };
  const ofCase = (probe: PersonProbe): boolean =>
    probe.scope !== undefined && "caseId" in probe.scope && probe.scope.caseId === caseId;
  const spy = vi
    .spyOn(ExplorationRepository.prototype, "touchesPersonData")
    .mockImplementation(async function (this: ExplorationRepository, probe) {
      if (!state.committed && ofCase(probe)) {
        state.committed = true;
        await commit();
      }
      return original.call(this, probe);
    });
  return { state, spy };
}

describe("a gated case-scope read and its probe share one snapshot (RELEASE-BLOCKING)", () => {
  it("an unpin between the read and the probe never lets the read's person data out", async () => {
    const { caseId, pins } = await caseWith([seeded.techEntityId, seeded.personEntityId]);
    const personPin = pins[1];
    if (personPin === undefined) return expect.fail("[test] the person pin");
    const { state, spy } = commitBeforeProbe(caseId, () =>
      api.db.withTenant(tenantId, ({ repos }) => repos.casePins.unpin(personPin)),
    );
    try {
      const response = await browser.request("GET", `/api/v1/entities?caseId=${caseId}`);
      expect(state.committed).toBe(true);
      // The probe sees the scope the read saw, person pin included: refused whole.
      expect(response.status).toBe(403);
      expect(response.body).not.toContain("[Person P]");
    } finally {
      spy.mockRestore();
    }
    // Unpinned and committed: the case now rests on no person data.
    const next = await browser.request("GET", `/api/v1/entities?caseId=${caseId}`);
    expect(next.status).toBe(200);
    expect(next.body).not.toContain("[Person P]");
  });

  it("a fusion between the read and the probe never refuses a read that held no person data", async () => {
    const { caseId } = await caseWith([seeded.techEntityId]);
    const { state, spy } = commitBeforeProbe(caseId, () =>
      api.db.withTenant(tenantId, ({ repos }) =>
        repos.claims.create({
          evidenceId: seeded.personEvidenceId,
          subject: { entityId: seeded.techEntityId },
          attribute: "note",
          value: "[late fusion claim]",
          strength: "REPORTED",
        }),
      ),
    );
    try {
      const response = await browser.request("GET", `/api/v1/entities?caseId=${caseId}`);
      expect(state.committed).toBe(true);
      // The probe sees the scope the read saw, with no person data: answered,
      // and the claim committed after the read is not in it.
      expect(response.status).toBe(200);
      expect(response.body).not.toContain("[late fusion claim]");
    } finally {
      spy.mockRestore();
    }
    // Committed: the pinned entity now carries person data, and the next read is refused.
    const next = await browser.request("GET", `/api/v1/entities?caseId=${caseId}`);
    expect(next.status).toBe(403);
  });
});

/**
 * RELEASE-BLOCKING (isolation cases). The read models behind the analyst's
 * screens (what a case or run holds, the graph, the timeline, merge
 * candidates) report measured values only, keep unknown timestamps null, and
 * never reach another tenant's rows.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../src/database.ts";
import {
  asTenant,
  createTenantFixture,
  openDatabase,
  rawClient,
  sqlStateOf,
  type TenantFixture,
} from "./support.ts";

let db: Database;
let tenant: TenantFixture;
let other: TenantFixture;

beforeAll(async () => {
  db = openDatabase();
  tenant = await createTenantFixture(db, "explore-a");
  other = await createTenantFixture(db, "explore-b");
});

afterAll(async () => {
  await db.close();
});

const read = <T>(
  fixture: TenantFixture,
  work: (reads: Parameters<Parameters<Database["withTenant"]>[1]>[0]) => Promise<T>,
) => db.withTenant(fixture.tenantId, work);

describe("entities in a scope", () => {
  it("a run holds the entities its evidence's claims are about, with measured counts", async () => {
    const rows = await read(tenant, ({ reads }) =>
      reads.exploration.entitiesInScope({ runId: tenant.runId }, { limit: 50 }),
    );
    expect(rows.map((row) => row.id)).toEqual([tenant.entityId]);
    const [row] = rows;
    expect(row).toMatchObject({
      claimCount: 1,
      evidenceCount: 1,
      relationshipCount: 1,
      strengths: ["HYPOTHESIS"],
      mergedIntoEntityId: null,
      mergedEntityCount: 1,
    });
  });

  it("a case holds what its pins stand on", async () => {
    const rows = await read(tenant, ({ reads }) =>
      reads.exploration.entitiesInScope({ caseId: tenant.caseId }, { limit: 50 }),
    );
    expect(rows.map((row) => row.id)).toEqual([tenant.entityId]);
  });

  it("a pinned entity is in its case even with no claims of its own in scope", async () => {
    const pinned = await read(tenant, async ({ repos, reads }) => {
      const lonely = await repos.entities.create({ kind: "DOMAIN", displayName: "[pinned alone]" });
      const caseRow = await repos.cases.create({
        title: "[case with a lone entity]",
        description: null,
        createdByUserId: tenant.userId,
      });
      await repos.casePins.pin({
        caseId: caseRow.id,
        target: { entityId: lonely.id },
        pinnedByUserId: tenant.userId,
        note: null,
      });
      const rows = await reads.exploration.entitiesInScope({ caseId: caseRow.id }, { limit: 5 });
      return { lonelyId: lonely.id, rows };
    });
    expect(pinned.rows.map((row) => row.id)).toEqual([pinned.lonelyId]);
    // Measured, so zero means none were recorded.
    expect(pinned.rows[0]).toMatchObject({ claimCount: 0, evidenceCount: 0, strengths: [] });
  });

  it("another tenant's run, case and entity are empty or absent", async () => {
    await read(other, async ({ reads }) => {
      expect(
        await reads.exploration.entitiesInScope({ runId: tenant.runId }, { limit: 5 }),
      ).toEqual([]);
      expect(
        await reads.exploration.entitiesInScope({ caseId: tenant.caseId }, { limit: 5 }),
      ).toEqual([]);
      expect(await reads.exploration.entityDetail(tenant.entityId)).toBeNull();
      expect(
        await reads.exploration.mergeCandidates({ runId: tenant.runId }, { limit: 5 }),
      ).toEqual([]);
    });
  });
});

describe("an entity in detail", () => {
  it("carries its relationships, direction and merged entities", async () => {
    const detail = await read(tenant, ({ reads }) =>
      reads.exploration.entityDetail(tenant.entityId),
    );
    expect(detail?.entity.id).toBe(tenant.entityId);
    expect(detail?.mergedEntityIds).toEqual([tenant.mergedEntityId]);
    expect(detail?.relationships).toEqual([
      {
        id: tenant.relationshipId,
        kind: "subdomain_of",
        direction: "INCOMING",
        otherEntity: { id: tenant.otherEntityId, kind: "DOMAIN", displayName: "www.example.com" },
        claimCount: 0,
        strengths: [],
      },
    ]);
  });
});

describe("the timeline", () => {
  it("keeps unknown timestamps null and counts them, never filling one from the other", async () => {
    const result = await read(tenant, ({ reads }) =>
      reads.exploration.timeline({ runId: tenant.runId }, "observedAt", { limit: 10 }),
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      evidenceId: tenant.evidenceId,
      observedAt: null,
      collectedAt: null,
      strength: "HYPOTHESIS",
      claimCount: 1,
    });
    expect(result.totals).toEqual({ total: 1, withoutObservedAt: 1, withoutCollectedAt: 1 });
  });

  it("puts undated evidence after dated, and sorts dated newest first", async () => {
    const ids = await read(tenant, async ({ repos, reads }) => {
      const caseRow = await repos.cases.create({
        title: "[timeline case]",
        description: null,
        createdByUserId: tenant.userId,
      });
      const base = await repos.evidence.findById(tenant.evidenceId);
      if (base === null) throw new TypeError("fixture evidence missing");
      const make = async (observedAt: Date | null, tag: string) => {
        const created = await repos.evidence.record({
          collectorId: base.collectorId,
          collectorVersion: "0.0.0-test",
          jobId: null,
          sourceUrl: null,
          contentHash: `sha256:${tag.repeat(64)}`,
          payloadRef: `[payload ${tag}]`,
          observedAt,
          collectedAt: new Date("2026-01-01T00:00:00Z"),
          claimStrength: "OBSERVED",
        });
        await repos.casePins.pin({
          caseId: caseRow.id,
          target: { evidenceId: created.id },
          pinnedByUserId: tenant.userId,
          note: null,
        });
        return created.id;
      };
      const older = await make(new Date("2026-02-01T00:00:00Z"), "a");
      const undated = await make(null, "b");
      const newer = await make(new Date("2026-03-01T00:00:00Z"), "c");
      const result = await reads.exploration.timeline({ caseId: caseRow.id }, "observedAt", {
        limit: 10,
      });
      return { older, undated, newer, result };
    });
    expect(ids.result.rows.map((row) => row.evidenceId)).toEqual([
      ids.newer,
      ids.older,
      ids.undated,
    ]);
    expect(ids.result.rows[2]?.observedAt).toBeNull();
    expect(ids.result.totals).toEqual({ total: 3, withoutObservedAt: 1, withoutCollectedAt: 0 });
  });

  it("is empty for another tenant's run and case, with measured zero totals", async () => {
    await read(other, async ({ reads }) => {
      for (const scope of [{ runId: tenant.runId }, { caseId: tenant.caseId }]) {
        const result = await reads.exploration.timeline(scope, "collectedAt", { limit: 5 });
        expect(result.rows).toEqual([]);
        expect(result.totals).toEqual({ total: 0, withoutObservedAt: 0, withoutCollectedAt: 0 });
      }
    });
  });
});

describe("the graph store", () => {
  it("returns only the seeds at zero hops, and their neighbours at one", async () => {
    const [zero, one] = await read(tenant, async ({ reads }) => [
      await reads.graph.neighbourhood({
        seedEntityIds: [tenant.entityId],
        maxHops: 0,
        maxNodes: 50,
      }),
      await reads.graph.neighbourhood({
        seedEntityIds: [tenant.entityId],
        maxHops: 1,
        maxNodes: 50,
      }),
    ]);
    expect(zero.nodes.map((node) => node.id)).toEqual([tenant.entityId]);
    expect(zero.edges).toEqual([]);
    expect(one.nodes.map((node) => [node.id, node.hop])).toEqual([
      [tenant.entityId, 0],
      [tenant.otherEntityId, 1],
    ]);
    expect(one.edges.map((edge) => edge.id)).toEqual([tenant.relationshipId]);
    expect(one.edges[0]).toMatchObject({ claimCount: 0, strengths: [] });
    expect(one.truncated).toBe(false);
  });

  it("says when it cut the slice, and reports seeds that name nothing", async () => {
    const slice = await read(tenant, ({ reads }) =>
      reads.graph.neighbourhood({
        seedEntityIds: [tenant.entityId, other.entityId],
        maxHops: 1,
        maxNodes: 1,
      }),
    );
    expect(slice.truncated).toBe(true);
    expect(slice.nodes).toHaveLength(1);
    // The other tenant's entity is not this tenant's: it is simply not there.
    expect(slice.unknownSeedIds).toContain(other.entityId);
  });

  it("marks a merged entity with its survivor", async () => {
    const slice = await read(tenant, ({ reads }) =>
      reads.graph.neighbourhood({
        seedEntityIds: [tenant.mergedEntityId],
        maxHops: 0,
        maxNodes: 5,
      }),
    );
    expect(slice.nodes[0]?.mergedIntoEntityId).toBe(tenant.entityId);
  });

  it("refuses a hop limit or node cap beyond its bounds", async () => {
    await read(tenant, async ({ reads }) => {
      await expect(
        reads.graph.neighbourhood({ seedEntityIds: [tenant.entityId], maxHops: 4, maxNodes: 5 }),
      ).rejects.toThrow(RangeError);
      await expect(
        reads.graph.neighbourhood({ seedEntityIds: [tenant.entityId], maxHops: 1, maxNodes: 501 }),
      ).rejects.toThrow(RangeError);
    });
  });
});

describe("merge candidates", () => {
  it("pairs same-kind entities with the same name, until a merge is on record", async () => {
    const result = await read(tenant, async ({ repos, reads }) => {
      const caseRow = await repos.cases.create({
        title: "[candidates case]",
        description: null,
        createdByUserId: tenant.userId,
      });
      const first = await repos.entities.create({ kind: "PERSON", displayName: "[Common Name]" });
      const second = await repos.entities.create({
        kind: "PERSON",
        displayName: " [common name] ",
      });
      const differentKind = await repos.entities.create({
        kind: "ORGANIZATION",
        displayName: "[Common Name]",
      });
      for (const entity of [first, second, differentKind]) {
        await repos.casePins.pin({
          caseId: caseRow.id,
          target: { entityId: entity.id },
          pinnedByUserId: tenant.userId,
          note: null,
        });
      }
      const before = await reads.exploration.mergeCandidates({ caseId: caseRow.id }, { limit: 10 });
      const merge = await repos.entityMerges.merge({
        survivingEntityId: first.id,
        mergedEntityId: second.id,
        reason: "[analyst judged these the same person]",
        confidence: 0.6,
        matchSignals: ["ANALYST_REVIEW"],
        decidedBy: { kind: "USER", userId: tenant.userId },
      });
      const merged = await reads.exploration.mergeCandidates({ caseId: caseRow.id }, { limit: 10 });
      await repos.entityMerges.undo(merge.id, {
        decidedBy: { kind: "USER", userId: tenant.userId },
        reason: "[analyst changed their mind]",
      });
      const reverted = await reads.exploration.mergeCandidates(
        { caseId: caseRow.id },
        { limit: 10 },
      );
      return { first, second, before, merged, reverted };
    });
    expect(result.before).toHaveLength(1);
    expect(result.before[0]?.kind).toBe("PERSON");
    expect(new Set([result.before[0]?.first.id, result.before[0]?.second.id])).toEqual(
      new Set([result.first.id, result.second.id]),
    );
    expect(result.merged).toEqual([]);
    // An undone merge is a decision the analyst made: it is not suggested again.
    expect(result.reverted).toEqual([]);
  });
});

describe("pins", () => {
  it("finds a pin by its target and counts pins per case, measured", async () => {
    await read(tenant, async ({ repos }) => {
      const found = await repos.casePins.findByTarget(tenant.caseId, {
        evidenceId: tenant.evidenceId,
      });
      expect(found?.id).toBe(tenant.casePinId);
      expect(
        await repos.casePins.findByTarget(tenant.caseId, { entityId: tenant.entityId }),
      ).toBeNull();
      const counts = await repos.casePins.countsForCases([tenant.caseId, other.caseId]);
      expect(counts.get(tenant.caseId)).toBe(1);
      // Not this tenant's case: zero pins visible, never another tenant's count.
      expect(counts.get(other.caseId)).toBe(0);
    });
  });
});

describe("the retention window", () => {
  it("is null until the tenant sets one, and can be set and cleared", async () => {
    const fresh = await read(other, ({ repos }) => repos.tenants.current());
    expect(fresh?.retentionDays).toBeNull();
    const set = await read(other, ({ repos }) => repos.tenants.setRetentionDays(90));
    expect(set?.retentionDays).toBe(90);
    const cleared = await read(other, ({ repos }) => repos.tenants.setRetentionDays(null));
    expect(cleared?.retentionDays).toBeNull();
  });

  it("is bounded by the database, not only by the API", async () => {
    const client = await rawClient();
    try {
      for (const days of [0, -1, 3651]) {
        const state = await sqlStateOf(() =>
          asTenant(client, tenant.tenantId, () =>
            client.query("update public.tenants set retention_days = $1", [days]),
          ),
        );
        expect(state, `${String(days)} days`).toBe("23514");
      }
    } finally {
      await client.end();
    }
  });

  it("one tenant's setting never changes another's", async () => {
    await read(tenant, ({ repos }) => repos.tenants.setRetentionDays(30));
    const seen = await read(other, ({ repos }) => repos.tenants.current());
    expect(seen?.retentionDays).toBeNull();
    await read(tenant, ({ repos }) => repos.tenants.setRetentionDays(null));
  });
});

describe("the person-data probe", () => {
  it("finds person evidence through every route a read can reach it by, and only in its own tenant", async () => {
    const found = await read(tenant, async ({ repos, reads }) => {
      await repos.collectorsRegistry.register({
        collectorId: "probe-person",
        sourceLabel: "[Person probe fixture]",
        discipline: "PERSON",
        collectionMode: "LOCAL_ANALYSIS",
        dataLicence: "[not applicable: test fixture]",
        commercialUse: "UNVERIFIED",
        enabled: true,
        disabledReason: null,
      });
      const person = await repos.evidence.record({
        collectorId: "probe-person",
        collectorVersion: "0.0.0-test",
        jobId: null,
        sourceUrl: null,
        contentHash: `sha256:${"e".repeat(64)}`,
        payloadRef: "[person payload]",
        observedAt: null,
        collectedAt: null,
        claimStrength: "REPORTED",
      });
      const subject = await repos.entities.create({
        kind: "PERSON",
        displayName: "[probe subject]",
      });
      const neighbour = await repos.entities.create({
        kind: "DOMAIN",
        displayName: "probe.example.com",
      });
      const relationship = await repos.entityRelationships.create({
        sourceEntityId: subject.id,
        targetEntityId: neighbour.id,
        kind: "associated_with",
      });
      const claim = await repos.claims.create({
        evidenceId: person.id,
        subject: { relationshipId: relationship.id },
        attribute: "note",
        value: "[claim]",
        strength: "REPORTED",
      });
      const caseRow = await repos.cases.create({
        title: "[probe case]",
        description: null,
        createdByUserId: tenant.userId,
      });
      await repos.casePins.pin({
        caseId: caseRow.id,
        target: { claimId: claim.id },
        pinnedByUserId: tenant.userId,
        note: null,
      });
      const probe = (input: Parameters<typeof reads.exploration.touchesPersonData>[0]) =>
        reads.exploration.touchesPersonData(input);
      return {
        ids: { evidence: person.id, claim: claim.id, subject: subject.id, neighbour: neighbour.id },
        byEvidence: await probe({ evidenceIds: [person.id] }),
        byClaim: await probe({ claimIds: [claim.id] }),
        // A claim on a relationship reaches both of its ends.
        bySubject: await probe({ entityIds: [subject.id] }),
        byNeighbour: await probe({ entityIds: [neighbour.id] }),
        byCase: await probe({ scope: { caseId: caseRow.id } }),
        // Nothing to look at is not person data.
        byNothing: await probe({}),
        byFixtureEvidence: await probe({ evidenceIds: [tenant.evidenceId] }),
        byFixtureEntity: await probe({ entityIds: [tenant.otherEntityId] }),
      };
    });
    expect(found).toMatchObject({
      byEvidence: true,
      byClaim: true,
      bySubject: true,
      byNeighbour: true,
      byCase: true,
      byNothing: false,
      byFixtureEvidence: false,
      byFixtureEntity: false,
    });
    // Another tenant asking about these ids learns nothing: they are not there for it.
    const foreign = await read(other, ({ reads }) =>
      Promise.all([
        reads.exploration.touchesPersonData({ evidenceIds: [found.ids.evidence] }),
        reads.exploration.touchesPersonData({ claimIds: [found.ids.claim] }),
        reads.exploration.touchesPersonData({
          entityIds: [found.ids.subject, found.ids.neighbour],
        }),
      ]),
    );
    expect(foreign).toEqual([false, false, false]);
  });
});

describe("the person-data probe on a run's jobs", () => {
  it("finds a person job whatever its outcome, through runJobs or a run scope, only in its own tenant", async () => {
    const result = await read(tenant, async ({ repos, reads }) => {
      await repos.collectorsRegistry.register({
        collectorId: "probe-person-run",
        sourceLabel: "[Person run fixture]",
        discipline: "PERSON",
        collectionMode: "LOCAL_ANALYSIS",
        dataLicence: "[not applicable: test fixture]",
        commercialUse: "UNVERIFIED",
        enabled: true,
        disabledReason: null,
      });
      const run = await repos.runs.create({
        investigationId: tenant.investigationId,
        status: "QUEUED",
        requestedByUserId: tenant.userId,
      });
      const job = await repos.jobs.create({
        runId: run.id,
        collectorId: "probe-person-run",
        idempotencyKey: `probe-person-run:${run.id}`,
        status: "QUEUED",
      });
      // Found nothing: no evidence is recorded, and the run is still person data.
      await repos.jobs.transition(job.id, {
        status: "SUCCEEDED",
        outcome: "NOT_FOUND",
        outcomeDetail: "[nothing found]",
      });
      return {
        runId: run.id,
        byRunJobs: await reads.exploration.touchesPersonData({ runJobs: run.id }),
        byRunScope: await reads.exploration.touchesPersonData({ scope: { runId: run.id } }),
        // The fixture's run has only a technical collector's job.
        cleanRunJobs: await reads.exploration.touchesPersonData({ runJobs: tenant.runId }),
        cleanRunScope: await reads.exploration.touchesPersonData({
          scope: { runId: tenant.runId },
        }),
      };
    });
    expect(result).toMatchObject({
      byRunJobs: true,
      byRunScope: true,
      cleanRunJobs: false,
      cleanRunScope: false,
    });
    const foreign = await read(other, ({ reads }) =>
      Promise.all([
        reads.exploration.touchesPersonData({ runJobs: result.runId }),
        reads.exploration.touchesPersonData({ scope: { runId: result.runId } }),
      ]),
    );
    expect(foreign).toEqual([false, false]);
  });
});

/**
 * RELEASE-BLOCKING. Cross-tenant reads and writes through every repository.
 * Tenant A attacks tenant B's rows by id, by list, by every write method each
 * repository has, and by inserting rows that reference B's rows. Every attempt
 * must see nothing, change nothing, or be refused, and B's rows must be
 * unchanged afterwards. If any attempt succeeds, the build fails.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../src/database.ts";
import { ReferenceNotFoundError } from "../src/errors.ts";
import { REPOSITORY_TABLES, type Repositories } from "../src/repositories/index.ts";
import { createTenantFixture, openDatabase, type TenantFixture } from "./support.ts";

let db: Database;
let attacker: TenantFixture;
let victim: TenantFixture;

beforeAll(async () => {
  db = openDatabase();
  attacker = await createTenantFixture(db, "a");
  victim = await createTenantFixture(db, "b");
});

afterAll(async () => {
  await db.close();
});

type Probe = (
  repos: Repositories,
  victim: TenantFixture,
  attacker: TenantFixture,
) => Promise<unknown>;

interface Attack {
  /** Reads aimed at the victim's rows. Each must find nothing. */
  readonly reads: readonly Probe[];
  /** Every write path, aimed at the victim's rows. Each must change nothing. */
  readonly writes: readonly Probe[];
  /** Inserts that reference the victim's rows. Each must be refused. */
  readonly references: readonly Probe[];
  /** The repository's list; every row returned must belong to the attacker. */
  readonly list: (repos: Repositories) => Promise<readonly { readonly tenantId: string }[]>;
}

const page = { limit: 1000 } as const;

const ATTACKS: Record<keyof Repositories, Attack> = {
  tenants: {
    reads: [(r, v) => r.tenants.findById(v.tenantId)],
    // rename() is bound to the current tenant; B is checked unchanged below.
    writes: [(r) => r.tenants.rename("[renamed by A]").then(() => null)],
    references: [],
    list: async (r) => {
      const current = await r.tenants.current();
      return current === null ? [] : [current];
    },
  },
  users: {
    reads: [
      (r, v) => r.users.findById(v.userId),
      (r) => r.users.findByEmail("analyst-b@example.com"),
    ],
    writes: [(r, v) => r.users.update(v.userId, { displayName: "[hijacked]" })],
    references: [],
    list: (r) => r.users.list(page),
  },
  apiKeys: {
    reads: [(r, v) => r.apiKeys.findById(v.apiKeyId)],
    writes: [
      (r, v) => r.apiKeys.rename(v.apiKeyId, "[hijacked]"),
      (r, v) => r.apiKeys.recordUse(v.apiKeyId),
      (r, v) => r.apiKeys.revoke(v.apiKeyId),
    ],
    references: [
      (r, v) =>
        r.apiKeys.create({
          id: "00000000-0000-4000-8000-0000000000c1",
          name: "[cross-tenant]",
          keyPrefix: "fx_cross_1",
          keyHash: "0".repeat(64),
          createdByUserId: v.userId,
          expiresAt: null,
          permissions: [],
          rotatedFromId: null,
        }),
    ],
    list: (r) => r.apiKeys.list(page),
  },
  auditLog: {
    reads: [(r, v) => r.auditLog.findById(v.auditEntryId)],
    writes: [], // append-only: the repository has no write path to aim
    references: [],
    list: (r) => r.auditLog.list(page),
  },
  collectorsRegistry: {
    // Both tenants register a collector with the same id; A must only ever get its own.
    reads: [
      (r, _v, a) =>
        r.collectorsRegistry
          .find(a.collectorId)
          .then((row) => (row?.tenantId === a.tenantId ? null : row)),
    ],
    writes: [
      (r, v) =>
        r.collectorsRegistry
          .setEnabled(v.collectorId, { enabled: false, reason: "[A disabling its own]" })
          .then(() => null),
      // An upsert on the shared id: it may only ever reach A's own row.
      (r, v) =>
        r.collectorsRegistry
          .sync({
            collectorId: v.collectorId,
            sourceLabel: "[relabelled by A]",
            discipline: "TECHINT",
            collectionMode: "LOCAL_ANALYSIS",
            dataLicence: "[A's licence text]",
            commercialUse: "BLOCKED",
            enabled: false,
            disabledReason: "[A blocking its own]",
          })
          .then(() => null),
    ],
    references: [],
    list: (r) => r.collectorsRegistry.list(page),
  },
  scopeAuthorisations: {
    reads: [
      (r, v) => r.scopeAuthorisations.findById(v.scopeAuthorisationId),
      // Both tenants authorised the same target; A must only ever get its own.
      (r, _v, a) =>
        r.scopeAuthorisations
          .findInForce("DOMAIN", "example.com")
          .then((row) => (row?.tenantId === a.tenantId ? null : row)),
    ],
    writes: [(r, v) => r.scopeAuthorisations.revoke(v.scopeAuthorisationId)],
    references: [
      (r, v) =>
        r.scopeAuthorisations.create({
          targetType: "DOMAIN",
          target: "example.org",
          authorisedByUserId: v.userId,
          basis: "[cross-tenant authoriser]",
          validFrom: new Date(Date.parse("2026-01-01T00:00:00Z")),
          validUntil: new Date(Date.parse("2030-01-01T00:00:00Z")),
        }),
    ],
    list: (r) => r.scopeAuthorisations.list(page),
  },
  investigations: {
    reads: [(r, v) => r.investigations.findById(v.investigationId)],
    writes: [
      (r, v) => r.investigations.rename(v.investigationId, "[hijacked]"),
      (r, v) => r.investigations.archive(v.investigationId),
    ],
    references: [
      (r, v) =>
        r.investigations.create({ title: "[x]", target: "example.com", createdByUserId: v.userId }),
    ],
    list: (r) => r.investigations.list(page),
  },
  runs: {
    reads: [(r, v) => r.runs.findById(v.runId)],
    writes: [(r, v) => r.runs.transition(v.runId, { status: "CANCELLED" })],
    references: [
      (r, v) =>
        r.runs.create({
          investigationId: v.investigationId,
          status: "QUEUED",
          requestedByUserId: null,
        }),
    ],
    list: (r) => r.runs.list(page),
  },
  jobs: {
    reads: [(r, v) => r.jobs.findById(v.jobId), (r) => r.jobs.findByIdempotencyKey("fixture:b")],
    writes: [(r, v) => r.jobs.transition(v.jobId, { status: "FAILED", attempts: 99 })],
    references: [
      (r, v, a) =>
        r.jobs.create({
          runId: v.runId,
          collectorId: a.collectorId,
          idempotencyKey: "cross-tenant",
          status: "QUEUED",
        }),
    ],
    list: (r) => r.jobs.list(page),
  },
  evidence: {
    reads: [
      (r, v) => r.evidence.findById(v.evidenceId),
      (r, v) => r.evidence.findByContentHash(v.contentHash).then((rows) => rows[0] ?? null),
    ],
    writes: [], // append-only
    references: [
      (r, v, a) =>
        r.evidence.record({
          collectorId: a.collectorId,
          collectorVersion: "0.0.0-test",
          jobId: v.jobId,
          sourceUrl: null,
          contentHash: v.contentHash,
          payloadRef: "[cross-tenant]",
          observedAt: null,
          collectedAt: null,
          claimStrength: "HYPOTHESIS",
        }),
    ],
    list: (r) => r.evidence.list(page),
  },
  entities: {
    reads: [(r, v) => r.entities.findById(v.entityId)],
    writes: [(r, v) => r.entities.rename(v.entityId, "[hijacked]")],
    references: [],
    list: (r) => r.entities.list(page),
  },
  entityRelationships: {
    reads: [(r, v) => r.entityRelationships.findById(v.relationshipId)],
    writes: [], // append-only
    references: [
      (r, v, a) =>
        r.entityRelationships.create({
          sourceEntityId: v.entityId,
          targetEntityId: a.entityId,
          kind: "cross_tenant",
        }),
    ],
    list: (r) => r.entityRelationships.list(page),
  },
  entityMerges: {
    reads: [
      (r, v) => r.entityMerges.findById(v.mergeId),
      // B's merge is invisible to A: B's merged entity resolves to itself...
      (r, v) =>
        r.entityMerges
          .resolve(v.mergedEntityId)
          .then((id) => (id === v.mergedEntityId ? null : id)),
      // ...and B's survivor has no visible members.
      (r, v) =>
        r.entityMerges
          .members(v.entityId)
          .then((ids) => (ids.length === 1 && ids[0] === v.entityId ? null : ids)),
    ],
    writes: [
      (r, v, a) =>
        r.entityMerges.undo(v.mergeId, {
          decidedBy: { kind: "USER", userId: a.userId },
          reason: "[cross-tenant undo]",
        }),
    ],
    references: [
      (r, v, a) =>
        r.entityMerges.merge({
          survivingEntityId: a.entityId,
          mergedEntityId: v.otherEntityId,
          reason: "[cross-tenant merge]",
          confidence: 1,
          matchSignals: ["DOMAIN"],
          decidedBy: { kind: "USER", userId: a.userId },
        }),
    ],
    list: (r) => r.entityMerges.list(page),
  },
  claims: {
    reads: [
      (r, v) => r.claims.findById(v.claimId),
      (r, v) => r.claims.listForEntities([v.entityId]).then((rows) => rows[0] ?? null),
    ],
    writes: [], // append-only
    references: [
      (r, v, a) =>
        r.claims.create({
          evidenceId: v.evidenceId,
          subject: { entityId: a.entityId },
          attribute: "cross_tenant",
          value: null,
          strength: "HYPOTHESIS",
        }),
      (r, v, a) =>
        r.claims.create({
          evidenceId: a.evidenceId,
          subject: { entityId: v.entityId },
          attribute: "cross_tenant",
          value: null,
          strength: "HYPOTHESIS",
        }),
      (r, v, a) =>
        r.claims.create({
          evidenceId: a.evidenceId,
          subject: { relationshipId: v.relationshipId },
          attribute: "cross_tenant",
          value: null,
          strength: "HYPOTHESIS",
        }),
    ],
    list: (r) => r.claims.list(page),
  },
  cases: {
    reads: [(r, v) => r.cases.findById(v.caseId)],
    writes: [
      (r, v) => r.cases.update(v.caseId, { title: "[hijacked]" }),
      (r, v) => r.cases.archive(v.caseId),
    ],
    references: [
      (r, v) => r.cases.create({ title: "[x]", description: null, createdByUserId: v.userId }),
    ],
    list: (r) => r.cases.list(page),
  },
  casePins: {
    reads: [
      (r, v) => r.casePins.findById(v.casePinId),
      (r, v) => r.casePins.listForCase(v.caseId).then((rows) => rows[0] ?? null),
    ],
    writes: [(r, v) => r.casePins.unpin(v.casePinId).then((done) => (done ? "unpinned" : null))],
    references: [
      (r, v, a) =>
        r.casePins.pin({
          caseId: a.caseId,
          target: { evidenceId: v.evidenceId },
          pinnedByUserId: null,
          note: null,
        }),
      (r, v, a) =>
        r.casePins.pin({
          caseId: a.caseId,
          target: { entityId: v.entityId },
          pinnedByUserId: null,
          note: null,
        }),
      (r, v, a) =>
        r.casePins.pin({
          caseId: a.caseId,
          target: { claimId: v.claimId },
          pinnedByUserId: null,
          note: null,
        }),
      (r, v, a) =>
        r.casePins.pin({
          caseId: v.caseId,
          target: { evidenceId: a.evidenceId },
          pinnedByUserId: null,
          note: null,
        }),
    ],
    list: (r) => r.casePins.list(page),
  },
  monitors: {
    reads: [(r, v) => r.monitors.findById(v.monitorId)],
    writes: [(r, v) => r.monitors.update(v.monitorId, { enabled: true })],
    references: [
      (r, v) =>
        r.monitors.create({
          name: "[x]",
          target: "example.com",
          scheduleCron: "0 * * * *",
          enabled: false,
          createdByUserId: v.userId,
        }),
    ],
    list: (r) => r.monitors.list(page),
  },
  alerts: {
    reads: [(r, v) => r.alerts.findById(v.alertId)],
    writes: [(r, v, a) => r.alerts.acknowledge(v.alertId, a.userId)],
    references: [
      (r, v) => r.alerts.create({ monitorId: v.monitorId, title: "[x]", evidenceId: null }),
      (r, v, a) =>
        r.alerts.create({ monitorId: a.monitorId, title: "[x]", evidenceId: v.evidenceId }),
      (r, v, a) => r.alerts.acknowledge(a.alertId, v.userId),
    ],
    list: (r) => r.alerts.list(page),
  },
  credentials: {
    reads: [(r, v) => r.credentials.findById(v.credentialId)],
    writes: [
      (r, v) => r.credentials.relabel(v.credentialId, "[hijacked]"),
      (r, v) => r.credentials.revoke(v.credentialId),
      (r, v) => r.credentials.delete(v.credentialId).then((done) => (done ? "deleted" : null)),
    ],
    references: [],
    list: (r) => r.credentials.list(page),
  },
  usageEvents: {
    reads: [(r, v) => r.usageEvents.findById(v.usageEventId)],
    writes: [], // append-only
    references: [
      (r, v) =>
        r.usageEvents.record({
          unit: "API_CREDIT",
          quantity: 1,
          collectorId: null,
          jobId: v.jobId,
        }),
    ],
    list: (r) => r.usageEvents.list(page),
  },
};

/** Every row of the victim's fixture, read in the victim's own context. */
async function victimSnapshot(): Promise<unknown> {
  return db.withTenant(victim.tenantId, async ({ repos }) => ({
    tenant: await repos.tenants.current(),
    user: await repos.users.findById(victim.userId),
    apiKey: await repos.apiKeys.findById(victim.apiKeyId),
    audit: await repos.auditLog.findById(victim.auditEntryId),
    collector: await repos.collectorsRegistry.find(victim.collectorId),
    investigation: await repos.investigations.findById(victim.investigationId),
    run: await repos.runs.findById(victim.runId),
    job: await repos.jobs.findById(victim.jobId),
    evidence: await repos.evidence.findById(victim.evidenceId),
    entity: await repos.entities.findById(victim.entityId),
    relationship: await repos.entityRelationships.findById(victim.relationshipId),
    merge: await repos.entityMerges.findById(victim.mergeId),
    claim: await repos.claims.findById(victim.claimId),
    case: await repos.cases.findById(victim.caseId),
    pin: await repos.casePins.findById(victim.casePinId),
    monitor: await repos.monitors.findById(victim.monitorId),
    alert: await repos.alerts.findById(victim.alertId),
    credential: await repos.credentials.findById(victim.credentialId),
    usage: await repos.usageEvents.findById(victim.usageEventId),
  }));
}

describe("cross-tenant access through repositories (RELEASE-BLOCKING)", () => {
  it("has an attack entry for every repository", () => {
    expect(Object.keys(ATTACKS).sort()).toEqual(Object.keys(REPOSITORY_TABLES).sort());
  });

  it("the victim's rows are visible to the victim (the fixture is real)", async () => {
    const snapshot = (await victimSnapshot()) as Record<string, unknown>;
    for (const [name, row] of Object.entries(snapshot)) {
      expect(row, `victim ${name}`).not.toBeNull();
      if (Array.isArray(row)) expect(row.length, `victim ${name}`).toBeGreaterThan(0);
    }
  });

  describe.each(Object.entries(ATTACKS))("%s", (_name, attack) => {
    it("finds none of the other tenant's rows", async () => {
      await db.withTenant(attacker.tenantId, async ({ repos }) => {
        for (const read of attack.reads) expect(await read(repos, victim, attacker)).toBeNull();
      });
    });

    it("lists only its own tenant's rows", async () => {
      await db.withTenant(attacker.tenantId, async ({ repos }) => {
        const rows = await attack.list(repos);
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) expect(row.tenantId).toBe(attacker.tenantId);
      });
    });

    it("changes none of the other tenant's rows", async () => {
      for (const write of attack.writes) {
        await db.withTenant(attacker.tenantId, async ({ repos }) => {
          expect(await write(repos, victim, attacker)).toBeNull();
        });
      }
    });

    it("cannot reference the other tenant's rows", async () => {
      for (const reference of attack.references) {
        await expect(
          db.withTenant(attacker.tenantId, ({ repos }) => reference(repos, victim, attacker)),
        ).rejects.toBeInstanceOf(ReferenceNotFoundError);
      }
    });
  });

  it("leaves every one of the victim's rows exactly as it was", async () => {
    const before = await victimSnapshot();
    for (const attack of Object.values(ATTACKS)) {
      for (const probe of [...attack.reads, ...attack.writes]) {
        await db.withTenant(attacker.tenantId, async ({ repos }) => {
          await probe(repos, victim, attacker);
        });
      }
      for (const reference of attack.references) {
        await db
          .withTenant(attacker.tenantId, ({ repos }) => reference(repos, victim, attacker))
          .catch(() => undefined);
      }
    }
    expect(await victimSnapshot()).toEqual(before);
  });
});

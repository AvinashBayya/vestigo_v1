/**
 * A case built from rows the way the platform writes them (R1-b tests): a run
 * that recorded its plan, a TECHINT job that FOUND one evidence item and
 * recorded it, and a PERSON job that found nothing; entities, a relationship
 * and claims fused from that evidence; and a case pinning one entity. Values
 * are bracketed placeholders or reserved example.com names (CLAUDE.md §1).
 */
import { randomUUID } from "node:crypto";
import { parseTenantId, type TenantId } from "@repo/core";
import { contentRef, hashContent, type Database } from "@repo/db";
import type { CaseAnalysisCollectors } from "../src/index.ts";

export const TECH_COLLECTOR = "fixture-dns";
export const PERSON_COLLECTOR = "fixture-person";

/** The registry as an analysis reads it: the two fixture collectors, nothing held. */
export const FIXTURE_COLLECTORS: CaseAnalysisCollectors = {
  registry: [
    {
      id: TECH_COLLECTOR,
      label: "[fixture dns]",
      collectionMode: "PASSIVE_API",
      discipline: "TECHINT",
    },
    {
      id: PERSON_COLLECTOR,
      label: "[fixture person]",
      collectionMode: "LOCAL_ANALYSIS",
      discipline: "PERSON",
    },
  ],
  held: [],
};

export interface CaseFixture {
  readonly tenantId: TenantId;
  readonly userId: string;
  readonly caseId: string;
  readonly runId: string;
  readonly techJobId: string;
  readonly personJobId: string;
  readonly evidenceId: string;
  readonly entityId: string;
  readonly otherEntityId: string;
  readonly relationshipId: string;
  readonly claimId: string;
  readonly relationshipClaimId: string;
  readonly entityPinId: string;
}

const AT = new Date(Date.parse("2026-10-09T09:00:00.000Z"));

export async function provisionTenant(
  db: Database,
  tag: string,
): Promise<{ readonly tenantId: TenantId; readonly userId: string }> {
  const tenantId = parseTenantId(randomUUID());
  await db.provisionTenant({ tenantId, name: `[Tenant ${tag}]`, region: "IN" });
  const user = await db.withTenant(tenantId, ({ repos }) =>
    repos.users.create({
      email: `analyst-${tag}@example.com`,
      displayName: null,
      status: "ACTIVE",
    }),
  );
  return { tenantId, userId: user.id };
}

/** Evidence one job found and recorded, as the job processor writes it. */
export async function recordFound(
  db: Database,
  tenantId: TenantId,
  jobId: string,
  collectorId: string,
  tag: string,
): Promise<string> {
  return db.withTenant(tenantId, async ({ repos }) => {
    const hash = hashContent(new TextEncoder().encode(`[payload ${tag}]`));
    const evidence = await repos.evidence.record({
      collectorId,
      collectorVersion: "1.0.0",
      jobId,
      sourceUrl: "https://example.com/",
      contentHash: hash,
      payloadRef: contentRef(tenantId, hash),
      observedAt: null,
      collectedAt: AT,
      claimStrength: "REPORTED",
    });
    await repos.jobs.transition(jobId, {
      status: "SUCCEEDED",
      attempts: 1,
      outcome: "FOUND",
      result: { names: [] },
      evidenceIds: [evidence.id],
      finishedAt: AT,
    });
    return evidence.id;
  });
}

export async function createCaseFixture(db: Database, tag: string): Promise<CaseFixture> {
  const { tenantId, userId } = await provisionTenant(db, tag);
  const base = await db.withTenant(tenantId, async ({ repos }) => {
    for (const [collectorId, discipline] of [
      [TECH_COLLECTOR, "TECHINT"],
      [PERSON_COLLECTOR, "PERSON"],
    ] as const) {
      await repos.collectorsRegistry.register({
        collectorId,
        sourceLabel: `[fixture ${collectorId}]`,
        discipline,
        collectionMode: "LOCAL_ANALYSIS",
        dataLicence: "[not applicable: test fixture]",
        commercialUse: "UNVERIFIED",
        enabled: true,
        disabledReason: null,
      });
    }
    const investigation = await repos.investigations.create({
      title: `[Investigation ${tag}]`,
      target: "example.com",
      createdByUserId: userId,
    });
    const run = await repos.runs.create({
      investigationId: investigation.id,
      status: "QUEUED",
      requestedByUserId: userId,
    });
    await repos.runs.setPlan(run.id, {
      input: "example.com",
      requestedType: null,
      detected: { primaryType: "DOMAIN", alternateTypes: [] },
      targets: [{ type: "DOMAIN", value: "example.com" }],
      jobs: [],
      excluded: [],
    });
    const techJob = await repos.jobs.create({
      runId: run.id,
      collectorId: TECH_COLLECTOR,
      idempotencyKey: `${tag}:tech`,
      status: "QUEUED",
      targetType: "DOMAIN",
      target: "example.com",
    });
    const personJob = await repos.jobs.create({
      runId: run.id,
      collectorId: PERSON_COLLECTOR,
      idempotencyKey: `${tag}:person`,
      status: "QUEUED",
      targetType: "DOMAIN",
      target: "example.com",
    });
    // The person collector found nothing: no evidence, and still person data.
    await repos.jobs.transition(personJob.id, {
      status: "SUCCEEDED",
      attempts: 1,
      outcome: "NOT_FOUND",
      outcomeDetail: "[nothing found]",
      finishedAt: AT,
    });
    await repos.runs.transition(run.id, { status: "SUCCEEDED", startedAt: AT, finishedAt: AT });
    return { runId: run.id, techJobId: techJob.id, personJobId: personJob.id };
  });
  const evidenceId = await recordFound(db, tenantId, base.techJobId, TECH_COLLECTOR, `${tag}:tech`);
  const rest = await db.withTenant(tenantId, async ({ repos }) => {
    const entity = await repos.entities.create({ kind: "DOMAIN", displayName: "example.com" });
    const other = await repos.entities.create({ kind: "DOMAIN", displayName: "www.example.com" });
    const relationship = await repos.entityRelationships.create({
      sourceEntityId: other.id,
      targetEntityId: entity.id,
      kind: "subdomain_of",
    });
    const claim = await repos.claims.create({
      evidenceId,
      subject: { entityId: entity.id },
      attribute: "registrar",
      value: "[registrar]",
      strength: "REPORTED",
    });
    const relationshipClaim = await repos.claims.create({
      evidenceId,
      subject: { relationshipId: relationship.id },
      attribute: "subdomain_of",
      value: null,
      strength: "REPORTED",
    });
    const caseRow = await repos.cases.create({
      title: `[Case ${tag}]`,
      description: null,
      createdByUserId: userId,
    });
    const pin = await repos.casePins.pin({
      caseId: caseRow.id,
      target: { entityId: entity.id },
      pinnedByUserId: userId,
      note: null,
    });
    return {
      caseId: caseRow.id,
      entityId: entity.id,
      otherEntityId: other.id,
      relationshipId: relationship.id,
      claimId: claim.id,
      relationshipClaimId: relationshipClaim.id,
      entityPinId: pin.id,
    };
  });
  return { tenantId, userId, ...base, evidenceId, ...rest };
}

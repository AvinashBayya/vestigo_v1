import type { ClaimStrength, JobOutcome, JobStatus, RunStatus, TargetType } from "@repo/core";
import { and, asc, eq, sql, type SQL } from "drizzle-orm";
import {
  casePins,
  claims,
  entityMerges,
  entityRelationships,
  evidence,
  investigations,
  jobs,
  runs,
} from "../schema/index.ts";
import { requireUuid, TenantRepository } from "./base.ts";

/**
 * Everything a case's analysis reads, as stored (R1-b). A case is its pins
 * (owner ruling D-4); what they bring in:
 *   - claims: the pinned claims, the claims citing pinned evidence, and every
 *     claim about a pinned entity or a pinned relationship;
 *   - evidence: the pinned evidence and every claim's evidence (the same set
 *     the person probe and the timeline read, `exploration.ts` scopeEvidence);
 *   - relationships: the pinned ones and every claim's subject relationship;
 *   - entities: the pinned ones, every claim's subject entity, and both ends of
 *     every relationship, so every claim's subject is in the case;
 *   - runs: the run of every job any of that evidence names, and every job of
 *     those runs, with their recorded plan, status and outcomes;
 *   - merges: every active analyst merge reachable from the case's entities.
 * Each list is read with its own statement, so the caller reads them in one
 * repeatable-read transaction (D-32) when they must agree.
 */
export interface CaseScopeRecords {
  readonly evidence: readonly {
    readonly id: string;
    readonly collectorId: string;
    readonly jobId: string | null;
    readonly collectedAt: Date | null;
    readonly observedAt: Date | null;
    readonly claimStrength: ClaimStrength;
  }[];
  readonly claims: readonly {
    readonly id: string;
    readonly evidenceId: string;
    readonly entityId: string | null;
    readonly relationshipId: string | null;
    readonly strength: ClaimStrength;
  }[];
  readonly entityIds: readonly string[];
  readonly relationshipIds: readonly string[];
  readonly runs: readonly {
    readonly id: string;
    readonly investigationId: string;
    readonly investigationTitle: string;
    readonly status: RunStatus;
    /** The plan the run recorded, as stored. */
    readonly plan: unknown;
    readonly startedAt: Date | null;
    readonly finishedAt: Date | null;
  }[];
  readonly jobs: readonly {
    readonly id: string;
    readonly runId: string;
    readonly collectorId: string;
    readonly status: JobStatus;
    readonly outcome: JobOutcome | null;
    readonly outcomeDetail: string | null;
    readonly targetType: TargetType | null;
    readonly attempts: number;
    readonly evidenceIds: readonly string[] | null;
    readonly lastErrorCode: string | null;
    readonly lastErrorMessage: string | null;
  }[];
  /** Active analyst merges reachable from the case's entities, by id. */
  readonly activeMergeIds: readonly string[];
}

export class CaseScopeRepository extends TenantRepository {
  /**
   * The runs the case's evidence came from, by id: what a person probe of the
   * case passes as runIds (D-19), read without the records themselves.
   */
  async runIds(caseId: string): Promise<string[]> {
    const { runIds } = this.#queries(caseId);
    return this.run(async (tx) => {
      const result = await tx.execute<{ id: string }>(
        sql`select run_id as id from (${runIds}) as r(run_id) order by run_id`,
      );
      return result.rows.map((row) => row.id);
    });
  }

  /**
   * How many records the case's analysis reads: its evidence, claims, entities
   * and relationships, and every job of its runs, exactly as `records` returns
   * them, counted in one statement without reading any of them. The size bound
   * is checked with this before anything is loaded (R1-b review).
   */
  async count(caseId: string): Promise<number> {
    const tenantId = this.tenantId;
    const { claimIds, evidenceIds, relationshipIds, entityIds, runIds } = this.#queries(caseId);
    return this.run(async (tx) => {
      const result = await tx.execute<{ total: string }>(sql`
        select (
          (select count(*) from (${evidenceIds}) as e(id))
          + (select count(*) from (${claimIds}) as c(id))
          + (select count(*) from (${entityIds}) as n(id))
          + (select count(*) from (${relationshipIds}) as r(id))
          + (select count(*) from ${jobs} j where j.tenant_id = ${tenantId} and j.run_id in (${runIds}))
        )::text as total`);
      const [row] = result.rows;
      if (row === undefined) throw new RangeError("a count returned no row");
      return Number(row.total);
    });
  }

  async records(caseId: string): Promise<CaseScopeRecords> {
    const tenantId = this.tenantId;
    const { claimIds, evidenceIds, relationshipIds, entityIds, runIds } = this.#queries(caseId);
    return this.run(async (tx) => {
      const claimRows = await tx
        .select({
          id: claims.id,
          evidenceId: claims.evidenceId,
          entityId: claims.entityId,
          relationshipId: claims.relationshipId,
          strength: claims.strength,
        })
        .from(claims)
        .where(and(eq(claims.tenantId, tenantId), sql`${claims.id} in (${claimIds})`))
        .orderBy(asc(claims.id));
      const evidenceRows = await tx
        .select({
          id: evidence.id,
          collectorId: evidence.collectorId,
          jobId: evidence.jobId,
          collectedAt: evidence.collectedAt,
          observedAt: evidence.observedAt,
          claimStrength: evidence.claimStrength,
        })
        .from(evidence)
        .where(and(eq(evidence.tenantId, tenantId), sql`${evidence.id} in (${evidenceIds})`))
        .orderBy(asc(evidence.id));
      const relationships = await tx.execute<{ id: string }>(
        sql`select id from (${relationshipIds}) as r(id) order by id`,
      );
      const entities = await tx.execute<{ id: string }>(
        sql`select id from (${entityIds}) as e(id) order by id`,
      );
      const runRows = await tx
        .select({
          id: runs.id,
          investigationId: runs.investigationId,
          investigationTitle: investigations.title,
          status: runs.status,
          plan: runs.plan,
          startedAt: runs.startedAt,
          finishedAt: runs.finishedAt,
        })
        .from(runs)
        .innerJoin(
          investigations,
          and(
            eq(investigations.tenantId, runs.tenantId),
            eq(investigations.id, runs.investigationId),
          ),
        )
        .where(and(eq(runs.tenantId, tenantId), sql`${runs.id} in (${runIds})`))
        .orderBy(asc(runs.id));
      const jobRows = await tx
        .select({
          id: jobs.id,
          runId: jobs.runId,
          collectorId: jobs.collectorId,
          status: jobs.status,
          outcome: jobs.outcome,
          outcomeDetail: jobs.outcomeDetail,
          targetType: jobs.targetType,
          attempts: jobs.attempts,
          evidenceIds: jobs.evidenceIds,
          lastErrorCode: jobs.lastErrorCode,
          lastErrorMessage: jobs.lastErrorMessage,
        })
        .from(jobs)
        .where(and(eq(jobs.tenantId, tenantId), sql`${jobs.runId} in (${runIds})`))
        .orderBy(asc(jobs.id));
      // Every active merge reachable from the case's entities, through chains:
      // an undone merge joins nothing (the probe's `linked` walk, exploration.ts).
      const merges = await tx.execute<{ id: string }>(sql`
        with recursive linked(id) as (
          select id from (${entityIds}) as seed(id)
          union
          select case when m.surviving_entity_id = l.id
                      then m.merged_entity_id else m.surviving_entity_id end
          from linked l
          join ${entityMerges} m on m.tenant_id = ${tenantId} and m.reverted_at is null
            and (m.surviving_entity_id = l.id or m.merged_entity_id = l.id)
        )
        select distinct m.id from ${entityMerges} m
        where m.tenant_id = ${tenantId} and m.reverted_at is null
          and (m.surviving_entity_id in (select id from linked)
            or m.merged_entity_id in (select id from linked))
        order by m.id`);
      return {
        evidence: evidenceRows,
        claims: claimRows,
        entityIds: entities.rows.map((row) => row.id),
        relationshipIds: relationships.rows.map((row) => row.id),
        runs: runRows,
        jobs: jobRows,
        activeMergeIds: merges.rows.map((row) => row.id),
      };
    });
  }

  /** The case's lists as SQL, each derived from the case id. */
  #queries(caseId: string): {
    readonly claimIds: SQL;
    readonly evidenceIds: SQL;
    readonly relationshipIds: SQL;
    readonly entityIds: SQL;
    readonly runIds: SQL;
  } {
    const tenantId = this.tenantId;
    const id = requireUuid(caseId);
    const pins = sql`select * from ${casePins} where tenant_id = ${tenantId} and case_id = ${id}`;
    // The case's claims, by id.
    const claimIds: SQL = sql`
      select c.id from ${claims} c join (${pins}) p on p.claim_id = c.id where c.tenant_id = ${tenantId}
      union select c.id from ${claims} c join (${pins}) p on p.evidence_id = c.evidence_id where c.tenant_id = ${tenantId}
      union select c.id from ${claims} c join (${pins}) p on p.entity_id = c.entity_id where c.tenant_id = ${tenantId}
      union select c.id from ${claims} c join (${pins}) p on p.relationship_id = c.relationship_id where c.tenant_id = ${tenantId}`;
    const evidenceIds: SQL = sql`
      select p.evidence_id from (${pins}) p where p.evidence_id is not null
      union select c.evidence_id from ${claims} c where c.tenant_id = ${tenantId} and c.id in (${claimIds})`;
    const relationshipIds: SQL = sql`
      select p.relationship_id from (${pins}) p where p.relationship_id is not null
      union select c.relationship_id from ${claims} c
        where c.tenant_id = ${tenantId} and c.id in (${claimIds}) and c.relationship_id is not null`;
    const entityIds: SQL = sql`
      select p.entity_id from (${pins}) p where p.entity_id is not null
      union select c.entity_id from ${claims} c
        where c.tenant_id = ${tenantId} and c.id in (${claimIds}) and c.entity_id is not null
      union select r.source_entity_id from ${entityRelationships} r
        where r.tenant_id = ${tenantId} and r.id in (${relationshipIds})
      union select r.target_entity_id from ${entityRelationships} r
        where r.tenant_id = ${tenantId} and r.id in (${relationshipIds})`;
    const runIds: SQL = sql`
      select distinct j.run_id from ${jobs} j
      join ${evidence} ev on ev.tenant_id = j.tenant_id and ev.job_id = j.id
      where j.tenant_id = ${tenantId} and ev.id in (${evidenceIds})`;

    return { claimIds, evidenceIds, relationshipIds, entityIds, runIds };
  }
}

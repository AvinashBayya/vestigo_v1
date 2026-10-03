import { CLAIM_STRENGTHS, type ClaimStrength, type EntityKind } from "@repo/core";
import { sql, type SQL } from "drizzle-orm";
import { entities, entityMerges, entityRelationships } from "../schema/index.ts";
import { casePins, claims, collectorsRegistry, evidence, jobs } from "../schema/index.ts";
import { firstRow, limitOf, requireUuid, TenantRepository, type ListOptions } from "./base.ts";

/**
 * What a read is about: everything pinned to a case, or everything one run
 * collected. A case has no other link to the data (Phase 6a decision: pins
 * only), so a case's content is exactly its pins and what they stand on.
 */
export type ReadScope = { readonly caseId: string } | { readonly runId: string };

const strengthRank = (strength: ClaimStrength): number => CLAIM_STRENGTHS.indexOf(strength);

/** Strongest first, as CLAIM_STRENGTHS lists them. */
export function sortStrengths(strengths: readonly string[]): ClaimStrength[] {
  return CLAIM_STRENGTHS.filter((strength) => strengths.includes(strength)).sort(
    (a, b) => strengthRank(a) - strengthRank(b),
  );
}

function toDate(value: Date | string | null): Date | null {
  return value === null ? null : value instanceof Date ? value : new Date(value);
}

/** Evidence the scope is made of. */
function scopeEvidence(tenantId: string, scope: ReadScope): SQL {
  if ("runId" in scope) {
    return sql`select ev.id from ${evidence} ev
      join ${jobs} j on j.tenant_id = ev.tenant_id and j.id = ev.job_id
      where ev.tenant_id = ${tenantId} and j.run_id = ${requireUuid(scope.runId)}`;
  }
  const caseId = requireUuid(scope.caseId);
  // Pinned evidence, the evidence behind pinned claims, and the evidence
  // behind the claims about pinned entities.
  return sql`select p.evidence_id as id from ${casePins} p
      where p.tenant_id = ${tenantId} and p.case_id = ${caseId} and p.evidence_id is not null
    union
    select c.evidence_id from ${claims} c
      join ${casePins} p on p.tenant_id = c.tenant_id and p.claim_id = c.id
      where p.tenant_id = ${tenantId} and p.case_id = ${caseId}
    union
    select c.evidence_id from ${claims} c
      join ${casePins} p on p.tenant_id = c.tenant_id and p.entity_id = c.entity_id
      where p.tenant_id = ${tenantId} and p.case_id = ${caseId}`;
}

/** Entities the scope is made of. */
function scopeEntities(tenantId: string, scope: ReadScope): SQL {
  // Claims that put an entity in scope: a run's claims, or a case's pinned
  // claims and the claims citing its pinned evidence.
  const scopeClaims =
    "runId" in scope
      ? sql`select c.id, c.entity_id, c.relationship_id from ${claims} c
          where c.tenant_id = ${tenantId} and c.evidence_id in (${scopeEvidence(tenantId, scope)})`
      : sql`select c.id, c.entity_id, c.relationship_id from ${claims} c
          where c.tenant_id = ${tenantId} and (
            c.id in (select p.claim_id from ${casePins} p
              where p.tenant_id = ${tenantId} and p.case_id = ${requireUuid(scope.caseId)} and p.claim_id is not null)
            or c.evidence_id in (select p.evidence_id from ${casePins} p
              where p.tenant_id = ${tenantId} and p.case_id = ${requireUuid(scope.caseId)} and p.evidence_id is not null))`;
  const pinnedEntities =
    "caseId" in scope
      ? sql`select p.entity_id as id from ${casePins} p
          where p.tenant_id = ${tenantId} and p.case_id = ${requireUuid(scope.caseId)} and p.entity_id is not null
        union`
      : sql``;
  return sql`${pinnedEntities}
    select sc.entity_id as id from (${scopeClaims}) sc where sc.entity_id is not null
    union
    select r.source_entity_id from (${scopeClaims}) sc
      join ${entityRelationships} r on r.tenant_id = ${tenantId} and r.id = sc.relationship_id
    union
    select r.target_entity_id from (${scopeClaims}) sc
      join ${entityRelationships} r on r.tenant_id = ${tenantId} and r.id = sc.relationship_id`;
}

/**
 * What a read is about to return, for asking whether any of it rests on
 * person-discipline evidence. Everything a read shows is covered: the scope's
 * own evidence, the evidence behind given claims, and the evidence behind
 * every claim about the given entities or about relationships touching them
 * (counts span all of an entity's claims, not just the scope's share).
 */
export interface PersonProbe {
  readonly scope?: ReadScope;
  readonly evidenceIds?: readonly string[];
  readonly claimIds?: readonly string[];
  readonly entityIds?: readonly string[];
}

const uuidList = (ids: readonly string[]): SQL => {
  if (ids.length > 1000) throw new RangeError("at most 1000 ids per kind in a probe");
  return sql.join(
    ids.map((id) => sql`${requireUuid(id)}::uuid`),
    sql`, `,
  );
};

export interface ScopedEntity {
  readonly id: string;
  readonly kind: EntityKind;
  readonly displayName: string;
  readonly identifier: string | null;
  readonly createdAt: Date;
  /** Everything recorded about the entity, not only what this scope holds. All measured. */
  readonly claimCount: number;
  readonly evidenceCount: number;
  readonly relationshipCount: number;
  readonly strengths: readonly ClaimStrength[];
  readonly mergedIntoEntityId: string | null;
  /** Entities currently merged into this one. */
  readonly mergedEntityCount: number;
}

interface EntityRow extends Record<string, unknown> {
  id: string;
  kind: EntityKind;
  display_name: string;
  identifier: string | null;
  created_at: Date | string;
  claim_count: string;
  evidence_count: string;
  relationship_count: string;
  strengths: string[];
  merged_into: string | null;
  merged_count: string;
}

function entityRow(row: EntityRow): ScopedEntity {
  return {
    id: row.id,
    kind: row.kind,
    displayName: row.display_name,
    identifier: row.identifier,
    createdAt: toDate(row.created_at) ?? new Date(Number.NaN),
    claimCount: Number(row.claim_count),
    evidenceCount: Number(row.evidence_count),
    relationshipCount: Number(row.relationship_count),
    strengths: sortStrengths(row.strengths),
    mergedIntoEntityId: row.merged_into,
    mergedEntityCount: Number(row.merged_count),
  };
}

/** The columns of an entity with its measured counts; `e` is the entities row. */
const ENTITY_COLUMNS = sql`
  e.id, e.kind, e.display_name, e.identifier, e.created_at,
  (select count(*) from ${claims} c where c.tenant_id = e.tenant_id and c.entity_id = e.id) as claim_count,
  (select count(distinct c.evidence_id) from ${claims} c
     where c.tenant_id = e.tenant_id and c.entity_id = e.id) as evidence_count,
  (select count(*) from ${entityRelationships} r
     where r.tenant_id = e.tenant_id and (r.source_entity_id = e.id or r.target_entity_id = e.id)) as relationship_count,
  (select coalesce(array_agg(distinct c.strength::text), '{}') from ${claims} c
     where c.tenant_id = e.tenant_id and c.entity_id = e.id) as strengths,
  (select m.surviving_entity_id from ${entityMerges} m
     where m.tenant_id = e.tenant_id and m.merged_entity_id = e.id and m.reverted_at is null) as merged_into,
  (select count(*) from ${entityMerges} m
     where m.tenant_id = e.tenant_id and m.surviving_entity_id = e.id and m.reverted_at is null) as merged_count`;

export interface EntityRelationshipView {
  readonly id: string;
  readonly kind: string;
  /** Which way the relationship runs from the entity being read. */
  readonly direction: "OUTGOING" | "INCOMING";
  readonly otherEntity: {
    readonly id: string;
    readonly kind: EntityKind;
    readonly displayName: string;
  };
  readonly claimCount: number;
  readonly strengths: readonly ClaimStrength[];
}

export interface EntityDetail {
  readonly entity: ScopedEntity;
  readonly relationships: readonly EntityRelationshipView[];
  /** Ids of the entities currently merged into this one. */
  readonly mergedEntityIds: readonly string[];
}

export interface TimelineRow {
  readonly evidenceId: string;
  readonly collectorId: string;
  readonly sourceUrl: string | null;
  /** When the source says it happened; null when it does not say. Never filled from collectedAt. */
  readonly observedAt: Date | null;
  /** When it was fetched; null when not recorded. */
  readonly collectedAt: Date | null;
  readonly strength: ClaimStrength;
  readonly claimCount: number;
}

export interface TimelineTotals {
  /** All evidence in the scope (measured). */
  readonly total: number;
  readonly withoutObservedAt: number;
  readonly withoutCollectedAt: number;
}

export interface MergeCandidate {
  readonly kind: EntityKind;
  readonly first: { readonly id: string; readonly displayName: string };
  readonly second: { readonly id: string; readonly displayName: string };
}

/**
 * Read models for the analyst's screens: what a case or run holds, with
 * measured counts. Reads only; every query names the tenant explicitly as
 * well as running under row-level security.
 */
export class ExplorationRepository extends TenantRepository {
  /**
   * Whether anything the probe covers rests on evidence from a
   * person-discipline collector. The discipline is read from the tenant's own
   * registry row, which every piece of evidence references; evidence with no
   * row is treated as person data. Reads only: the caller decides what to do.
   */
  async touchesPersonData(probe: PersonProbe): Promise<boolean> {
    const tenantId = this.tenantId;
    const parts: SQL[] = [];
    if (probe.scope !== undefined) parts.push(scopeEvidence(tenantId, probe.scope));
    const evidenceIds = probe.evidenceIds ?? [];
    if (evidenceIds.length > 0) {
      parts.push(sql`select ev.id from ${evidence} ev
        where ev.tenant_id = ${tenantId} and ev.id in (${uuidList(evidenceIds)})`);
    }
    const claimIds = probe.claimIds ?? [];
    if (claimIds.length > 0) {
      parts.push(sql`select c.evidence_id as id from ${claims} c
        where c.tenant_id = ${tenantId} and c.id in (${uuidList(claimIds)})`);
    }
    const entityIds = probe.entityIds ?? [];
    if (entityIds.length > 0) {
      const list = uuidList(entityIds);
      parts.push(
        sql`select c.evidence_id as id from ${claims} c
          where c.tenant_id = ${tenantId} and c.entity_id in (${list})`,
        sql`select c.evidence_id as id from ${claims} c
          join ${entityRelationships} r on r.tenant_id = c.tenant_id and r.id = c.relationship_id
          where c.tenant_id = ${tenantId}
            and (r.source_entity_id in (${list}) or r.target_entity_id in (${list}))`,
      );
    }
    if (parts.length === 0) return false;
    const covered = sql.join(parts, sql` union `);
    return this.run(async (tx) => {
      const result = await tx.execute<{ held: boolean }>(sql`
        select exists (
          select 1 from ${evidence} ev
          left join ${collectorsRegistry} cr
            on cr.tenant_id = ev.tenant_id and cr.collector_id = ev.collector_id
          where ev.tenant_id = ${tenantId}
            and ev.id in (${covered})
            and (cr.collector_id is null or cr.discipline = 'PERSON')
        ) as held`);
      const row = firstRow(result.rows);
      return row !== null && row.held;
    });
  }

  /** Entities in scope, oldest first, with their measured counts. */
  async entitiesInScope(scope: ReadScope, options: ListOptions): Promise<ScopedEntity[]> {
    const limit = limitOf(options);
    return this.run(async (tx) => {
      const result = await tx.execute<EntityRow>(sql`
        select ${ENTITY_COLUMNS}
        from ${entities} e
        where e.tenant_id = ${this.tenantId}
          and e.id in (${scopeEntities(this.tenantId, scope)})
        order by e.created_at, e.id
        limit ${limit}`);
      return result.rows.map(entityRow);
    });
  }

  /** The ids of the entities in scope, for seeding a graph. Capped; `truncated` says so. */
  async entityIdsInScope(
    scope: ReadScope,
    cap: number,
  ): Promise<{ readonly ids: string[]; readonly truncated: boolean }> {
    return this.run(async (tx) => {
      const result = await tx.execute<{ id: string }>(sql`
        select e.id from ${entities} e
        where e.tenant_id = ${this.tenantId}
          and e.id in (${scopeEntities(this.tenantId, scope)})
        order by e.created_at, e.id
        limit ${cap + 1}`);
      const ids = result.rows.map((row) => row.id);
      return { ids: ids.slice(0, cap), truncated: ids.length > cap };
    });
  }

  /** One entity with its relationships, or null when it is not in this tenant. */
  async entityDetail(id: string): Promise<EntityDetail | null> {
    const entityId = requireUuid(id);
    return this.run(async (tx) => {
      const found = await tx.execute<EntityRow>(sql`
        select ${ENTITY_COLUMNS} from ${entities} e
        where e.tenant_id = ${this.tenantId} and e.id = ${entityId}`);
      const row = firstRow(found.rows);
      if (row === null) return null;

      const related = await tx.execute<{
        id: string;
        kind: string;
        direction: "OUTGOING" | "INCOMING";
        other_id: string;
        other_kind: EntityKind;
        other_name: string;
        claim_count: string;
        strengths: string[];
      }>(sql`
        select r.id, r.kind,
          case when r.source_entity_id = ${entityId} then 'OUTGOING' else 'INCOMING' end as direction,
          o.id as other_id, o.kind as other_kind, o.display_name as other_name,
          (select count(*) from ${claims} c where c.tenant_id = r.tenant_id and c.relationship_id = r.id) as claim_count,
          (select coalesce(array_agg(distinct c.strength::text), '{}') from ${claims} c
             where c.tenant_id = r.tenant_id and c.relationship_id = r.id) as strengths
        from ${entityRelationships} r
        join ${entities} o on o.tenant_id = r.tenant_id
          and o.id = case when r.source_entity_id = ${entityId} then r.target_entity_id else r.source_entity_id end
        where r.tenant_id = ${this.tenantId}
          and (r.source_entity_id = ${entityId} or r.target_entity_id = ${entityId})
        order by r.created_at, r.id`);

      const merged = await tx.execute<{ merged_entity_id: string }>(sql`
        select m.merged_entity_id from ${entityMerges} m
        where m.tenant_id = ${this.tenantId} and m.surviving_entity_id = ${entityId} and m.reverted_at is null
        order by m.created_at, m.id`);

      return {
        entity: entityRow(row),
        relationships: related.rows.map((r) => ({
          id: r.id,
          kind: r.kind,
          direction: r.direction,
          otherEntity: { id: r.other_id, kind: r.other_kind, displayName: r.other_name },
          claimCount: Number(r.claim_count),
          strengths: sortStrengths(r.strengths),
        })),
        mergedEntityIds: merged.rows.map((m) => m.merged_entity_id),
      };
    });
  }

  /**
   * The scope's evidence as timeline events, newest first by the chosen
   * timestamp. Rows without that timestamp come last: they are undated, not
   * dated at some other moment.
   */
  async timeline(
    scope: ReadScope,
    sortBy: "observedAt" | "collectedAt",
    options: ListOptions,
  ): Promise<{ readonly rows: TimelineRow[]; readonly totals: TimelineTotals }> {
    const limit = limitOf(options);
    const order = sortBy === "observedAt" ? sql`ev.observed_at` : sql`ev.collected_at`;
    return this.run(async (tx) => {
      const rows = await tx.execute<{
        id: string;
        collector_id: string;
        source_url: string | null;
        observed_at: Date | string | null;
        collected_at: Date | string | null;
        claim_strength: ClaimStrength;
        claim_count: string;
      }>(sql`
        select ev.id, ev.collector_id, ev.source_url, ev.observed_at, ev.collected_at, ev.claim_strength,
          (select count(*) from ${claims} c where c.tenant_id = ev.tenant_id and c.evidence_id = ev.id) as claim_count
        from ${evidence} ev
        where ev.tenant_id = ${this.tenantId}
          and ev.id in (${scopeEvidence(this.tenantId, scope)})
        order by ${order} desc nulls last, ev.id desc
        limit ${limit}`);
      const totals = await tx.execute<{
        total: string;
        no_observed: string;
        no_collected: string;
      }>(sql`
        select count(*) as total,
          count(*) filter (where ev.observed_at is null) as no_observed,
          count(*) filter (where ev.collected_at is null) as no_collected
        from ${evidence} ev
        where ev.tenant_id = ${this.tenantId}
          and ev.id in (${scopeEvidence(this.tenantId, scope)})`);
      const t = firstRow(totals.rows);
      return {
        rows: rows.rows.map((r) => ({
          evidenceId: r.id,
          collectorId: r.collector_id,
          sourceUrl: r.source_url,
          observedAt: toDate(r.observed_at),
          collectedAt: toDate(r.collected_at),
          strength: r.claim_strength,
          claimCount: Number(r.claim_count),
        })),
        totals: {
          total: t === null ? 0 : Number(t.total),
          withoutObservedAt: t === null ? 0 : Number(t.no_observed),
          withoutCollectedAt: t === null ? 0 : Number(t.no_collected),
        },
      };
    });
  }

  /**
   * Pairs of entities in scope that may be the same thing: same kind, same
   * name once case and padding are ignored. A name match is the only signal
   * computed (identifiers are unique per kind, so two entities never share
   * one). Pairs that already have a merge on record, active or undone, and
   * entities already merged into another are left out.
   */
  async mergeCandidates(scope: ReadScope, options: ListOptions): Promise<MergeCandidate[]> {
    const limit = limitOf(options);
    return this.run(async (tx) => {
      const result = await tx.execute<{
        kind: EntityKind;
        a_id: string;
        a_name: string;
        b_id: string;
        b_name: string;
      }>(sql`
        with in_scope as (${scopeEntities(this.tenantId, scope)})
        select a.kind, a.id as a_id, a.display_name as a_name, b.id as b_id, b.display_name as b_name
        from ${entities} a
        join ${entities} b on b.tenant_id = a.tenant_id and b.kind = a.kind and b.id > a.id
          and lower(btrim(b.display_name)) = lower(btrim(a.display_name))
        where a.tenant_id = ${this.tenantId}
          and a.id in (select id from in_scope) and b.id in (select id from in_scope)
          and not exists (select 1 from ${entityMerges} m where m.tenant_id = a.tenant_id and (
                (m.surviving_entity_id = a.id and m.merged_entity_id = b.id)
             or (m.surviving_entity_id = b.id and m.merged_entity_id = a.id)))
          and not exists (select 1 from ${entityMerges} m where m.tenant_id = a.tenant_id
                and m.reverted_at is null and m.merged_entity_id in (a.id, b.id))
        order by a.created_at, a.id, b.id
        limit ${limit}`);
      return result.rows.map((r) => ({
        kind: r.kind,
        first: { id: r.a_id, displayName: r.a_name },
        second: { id: r.b_id, displayName: r.b_name },
      }));
    });
  }
}

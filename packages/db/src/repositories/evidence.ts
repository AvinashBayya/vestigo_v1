import type { ClaimStrength } from "@repo/core";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { claims, evidence } from "../schema/index.ts";
import {
  firstRow,
  limitOf,
  onlyRow,
  requireUuid,
  TenantRepository,
  type ListOptions,
} from "./base.ts";

export type Evidence = typeof evidence.$inferSelect;
export type Claim = typeof claims.$inferSelect;

/**
 * A new evidence record. Every field is required, including the nullable ones,
 * so a caller must state "not known" (null) explicitly. Nothing here is ever
 * defaulted: observedAt is not filled from collectedAt, and neither from the
 * clock (CLAUDE.md §1).
 */
export interface NewEvidence {
  readonly collectorId: string;
  readonly collectorVersion: string;
  readonly jobId: string | null;
  readonly sourceUrl: string | null;
  /** `sha256:<64 hex>` of the raw payload, as returned by the content store. */
  readonly contentHash: string;
  /** Key of the raw payload in the content store. */
  readonly payloadRef: string;
  /** When the source says it happened. Null means not known. */
  readonly observedAt: Date | null;
  /** When it was fetched. Null means not known. */
  readonly collectedAt: Date | null;
  readonly claimStrength: ClaimStrength;
}

/** Append-only: record and read. There is no update or delete. */
export class EvidenceRepository extends TenantRepository {
  async record(input: NewEvidence): Promise<Evidence> {
    return this.run(async (tx) =>
      onlyRow(
        await tx
          .insert(evidence)
          .values({
            tenantId: this.tenantId,
            collectorId: input.collectorId,
            collectorVersion: input.collectorVersion,
            jobId: input.jobId === null ? null : requireUuid(input.jobId),
            sourceUrl: input.sourceUrl,
            contentHash: input.contentHash,
            payloadRef: input.payloadRef,
            observedAt: input.observedAt,
            collectedAt: input.collectedAt,
            claimStrength: input.claimStrength,
          })
          .returning(),
      ),
    );
  }

  async findById(id: string): Promise<Evidence | null> {
    return this.run(async (tx) =>
      firstRow(await tx.select().from(evidence).where(this.owned(evidence, id))),
    );
  }

  async findByContentHash(contentHash: string): Promise<Evidence[]> {
    return this.run((tx) =>
      tx
        .select()
        .from(evidence)
        .where(and(this.inTenant(evidence), eq(evidence.contentHash, contentHash)))
        .orderBy(asc(evidence.id)),
    );
  }

  /** The evidence rows with these ids, in id order. Unknown ids are simply absent. */
  async findByIds(ids: readonly string[]): Promise<Evidence[]> {
    if (ids.length === 0) return [];
    if (ids.length > 1000) throw new RangeError("at most 1000 evidence ids at once");
    return this.run((tx) =>
      tx
        .select()
        .from(evidence)
        .where(and(this.inTenant(evidence), inArray(evidence.id, ids.map(requireUuid))))
        .orderBy(asc(evidence.id)),
    );
  }

  async list(options: ListOptions): Promise<Evidence[]> {
    return this.run((tx) =>
      tx
        .select()
        .from(evidence)
        .where(this.inTenant(evidence))
        .orderBy(asc(evidence.id))
        .limit(limitOf(options)),
    );
  }
}

export interface NewClaim {
  readonly evidenceId: string;
  /** Exactly one of subject.entityId / subject.relationshipId. */
  readonly subject:
    | { readonly entityId: string; readonly relationshipId?: never }
    | { readonly relationshipId: string; readonly entityId?: never };
  readonly attribute: string;
  readonly value: unknown;
  readonly strength: ClaimStrength;
}

/** Append-only claims, each citing the evidence it rests on. */
export class ClaimsRepository extends TenantRepository {
  async create(input: NewClaim): Promise<Claim> {
    const entityId = "entityId" in input.subject ? input.subject.entityId : undefined;
    const relationshipId =
      "relationshipId" in input.subject ? input.subject.relationshipId : undefined;
    return this.run(async (tx) =>
      onlyRow(
        await tx
          .insert(claims)
          .values({
            tenantId: this.tenantId,
            evidenceId: requireUuid(input.evidenceId),
            entityId: entityId === undefined ? null : requireUuid(entityId),
            relationshipId: relationshipId === undefined ? null : requireUuid(relationshipId),
            attribute: input.attribute,
            value: input.value,
            strength: input.strength,
          })
          .returning(),
      ),
    );
  }

  /**
   * Inserts the claim, or does nothing if one already exists for this evidence
   * and attribute, returning whether it was written. This is the durable guard
   * for the article prose extraction (M4-4B): it inserts against the partial
   * unique index `claims_one_article_statements_per_evidence`, so two concurrent
   * workers, or a redelivery, can never write a second `article_statements`
   * claim for the same evidence — the loser's insert no-ops.
   *
   * It is valid only for an attribute backed by that partial unique index
   * (currently `article_statements`): used for any other attribute, Postgres
   * has no matching index for the ON CONFLICT and rejects the insert.
   */
  async createOnce(
    input: NewClaim,
  ): Promise<{ readonly claim: Claim | null; readonly created: boolean }> {
    const entityId = "entityId" in input.subject ? input.subject.entityId : undefined;
    const relationshipId =
      "relationshipId" in input.subject ? input.subject.relationshipId : undefined;
    return this.run(async (tx) => {
      const claim = firstRow(
        await tx
          .insert(claims)
          .values({
            tenantId: this.tenantId,
            evidenceId: requireUuid(input.evidenceId),
            entityId: entityId === undefined ? null : requireUuid(entityId),
            relationshipId: relationshipId === undefined ? null : requireUuid(relationshipId),
            attribute: input.attribute,
            value: input.value,
            strength: input.strength,
          })
          .onConflictDoNothing({
            target: [claims.tenantId, claims.evidenceId, claims.attribute],
            where: sql`${claims.attribute} = 'article_statements'`,
          })
          .returning(),
      );
      return { claim, created: claim !== null };
    });
  }

  async findById(id: string): Promise<Claim | null> {
    return this.run(async (tx) =>
      firstRow(await tx.select().from(claims).where(this.owned(claims, id))),
    );
  }

  /** The claims with these ids. Unknown ids are simply absent. */
  async findByIds(ids: readonly string[]): Promise<Claim[]> {
    if (ids.length === 0) return [];
    if (ids.length > 1000) throw new RangeError("at most 1000 claim ids at once");
    return this.run((tx) =>
      tx
        .select()
        .from(claims)
        .where(and(this.inTenant(claims), inArray(claims.id, ids.map(requireUuid))))
        .orderBy(asc(claims.createdAt), asc(claims.id)),
    );
  }

  /** Claims about one entity, oldest first; the limit is required so truncation is never silent. */
  async listForEntity(entityId: string, options: ListOptions): Promise<Claim[]> {
    return this.run((tx) =>
      tx
        .select()
        .from(claims)
        .where(and(this.inTenant(claims), eq(claims.entityId, requireUuid(entityId))))
        .orderBy(asc(claims.createdAt), asc(claims.id))
        .limit(limitOf(options)),
    );
  }

  /** Claims about one relationship, oldest first; the limit is required so truncation is never silent. */
  async listForRelationship(relationshipId: string, options: ListOptions): Promise<Claim[]> {
    return this.run((tx) =>
      tx
        .select()
        .from(claims)
        .where(and(this.inTenant(claims), eq(claims.relationshipId, requireUuid(relationshipId))))
        .orderBy(asc(claims.createdAt), asc(claims.id))
        .limit(limitOf(options)),
    );
  }

  async list(options: ListOptions): Promise<Claim[]> {
    return this.run((tx) =>
      tx
        .select()
        .from(claims)
        .where(this.inTenant(claims))
        .orderBy(asc(claims.createdAt))
        .limit(limitOf(options)),
    );
  }

  /**
   * Claims citing any of the given evidence, oldest first. The limit is
   * required, so a caller always knows when it did not receive them all.
   */
  async listForEvidence(evidenceIds: readonly string[], options: ListOptions): Promise<Claim[]> {
    if (evidenceIds.length === 0) return [];
    if (evidenceIds.length > 1000) throw new RangeError("at most 1000 evidence ids at once");
    return this.run((tx) =>
      tx
        .select()
        .from(claims)
        .where(and(this.inTenant(claims), inArray(claims.evidenceId, evidenceIds.map(requireUuid))))
        .orderBy(asc(claims.createdAt), asc(claims.id))
        .limit(limitOf(options)),
    );
  }

  /** How many claims cite any of the given evidence: measured, so zero means none. */
  async countForEvidence(evidenceIds: readonly string[]): Promise<number> {
    if (evidenceIds.length === 0) return 0;
    if (evidenceIds.length > 1000) throw new RangeError("at most 1000 evidence ids at once");
    return this.run(async (tx) => {
      const [row] = await tx
        .select({ total: sql<string>`count(*)` })
        .from(claims)
        .where(
          and(this.inTenant(claims), inArray(claims.evidenceId, evidenceIds.map(requireUuid))),
        );
      return Number(row?.total);
    });
  }

  /** Claims about any of the given entities, oldest first. */
  async listForEntities(entityIds: readonly string[]): Promise<Claim[]> {
    if (entityIds.length === 0) return [];
    return this.run((tx) =>
      tx
        .select()
        .from(claims)
        .where(and(this.inTenant(claims), inArray(claims.entityId, entityIds.map(requireUuid))))
        .orderBy(asc(claims.createdAt), asc(claims.id)),
    );
  }
}

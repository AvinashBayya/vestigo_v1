import {
  NAME_ONLY_AUTOMERGE_FORBIDDEN,
  type DecisionActorKind,
  type EntityKind,
  type MergeSignal,
} from "@repo/core";
import { and, asc, eq, sql } from "drizzle-orm";
import { MergeRuleViolationError, ReferenceNotFoundError } from "../errors.ts";
import { entities, entityMerges, entityRelationships } from "../schema/index.ts";
import {
  firstRow,
  limitOf,
  onlyRow,
  requireUuid,
  TenantRepository,
  type ListOptions,
} from "./base.ts";

export type Entity = typeof entities.$inferSelect;
export type EntityRelationship = typeof entityRelationships.$inferSelect;
export type EntityMerge = typeof entityMerges.$inferSelect;

export class EntitiesRepository extends TenantRepository {
  async create(input: {
    readonly kind: EntityKind;
    readonly displayName: string;
  }): Promise<Entity> {
    return this.run(async (tx) =>
      onlyRow(
        await tx
          .insert(entities)
          .values({ tenantId: this.tenantId, ...input })
          .returning(),
      ),
    );
  }

  /**
   * The one entity of this kind with this normalised identifier, created if
   * there is none yet. Concurrent callers land on the same row. The display
   * name is set only when the entity is created.
   */
  async resolveByIdentifier(input: {
    readonly kind: EntityKind;
    readonly identifier: string;
    readonly displayName: string;
  }): Promise<{ readonly entity: Entity; readonly created: boolean }> {
    return this.run(async (tx) => {
      const inserted = firstRow(
        await tx
          .insert(entities)
          .values({ tenantId: this.tenantId, ...input })
          .onConflictDoNothing({
            target: [entities.tenantId, entities.kind, entities.identifier],
            where: sql`${entities.identifier} is not null`,
          })
          .returning(),
      );
      if (inserted !== null) return { entity: inserted, created: true };
      const existing = onlyRow(
        await tx
          .select()
          .from(entities)
          .where(
            and(
              this.inTenant(entities),
              eq(entities.kind, input.kind),
              eq(entities.identifier, input.identifier),
            ),
          ),
      );
      return { entity: existing, created: false };
    });
  }

  async findById(id: string): Promise<Entity | null> {
    return this.run(async (tx) =>
      firstRow(await tx.select().from(entities).where(this.owned(entities, id))),
    );
  }

  async list(options: ListOptions): Promise<Entity[]> {
    return this.run((tx) =>
      tx
        .select()
        .from(entities)
        .where(this.inTenant(entities))
        .orderBy(asc(entities.createdAt))
        .limit(limitOf(options)),
    );
  }

  async rename(id: string, displayName: string): Promise<Entity | null> {
    return this.run(async (tx) =>
      firstRow(
        await tx.update(entities).set({ displayName }).where(this.owned(entities, id)).returning(),
      ),
    );
  }
}

export class EntityRelationshipsRepository extends TenantRepository {
  async create(input: {
    readonly sourceEntityId: string;
    readonly targetEntityId: string;
    readonly kind: string;
  }): Promise<EntityRelationship> {
    return this.run(async (tx) =>
      onlyRow(
        await tx
          .insert(entityRelationships)
          .values({
            tenantId: this.tenantId,
            sourceEntityId: requireUuid(input.sourceEntityId),
            targetEntityId: requireUuid(input.targetEntityId),
            kind: input.kind,
          })
          .returning(),
      ),
    );
  }

  /**
   * The one relationship of this kind between these entities, created if
   * there is none yet. Concurrent callers land on the same row.
   */
  async resolve(input: {
    readonly sourceEntityId: string;
    readonly targetEntityId: string;
    readonly kind: string;
  }): Promise<{ readonly relationship: EntityRelationship; readonly created: boolean }> {
    const values = {
      tenantId: this.tenantId,
      sourceEntityId: requireUuid(input.sourceEntityId),
      targetEntityId: requireUuid(input.targetEntityId),
      kind: input.kind,
    };
    return this.run(async (tx) => {
      const inserted = firstRow(
        await tx.insert(entityRelationships).values(values).onConflictDoNothing().returning(),
      );
      if (inserted !== null) return { relationship: inserted, created: true };
      const existing = onlyRow(
        await tx
          .select()
          .from(entityRelationships)
          .where(
            and(
              this.inTenant(entityRelationships),
              eq(entityRelationships.sourceEntityId, values.sourceEntityId),
              eq(entityRelationships.targetEntityId, values.targetEntityId),
              eq(entityRelationships.kind, values.kind),
            ),
          ),
      );
      return { relationship: existing, created: false };
    });
  }

  async findById(id: string): Promise<EntityRelationship | null> {
    return this.run(async (tx) =>
      firstRow(
        await tx.select().from(entityRelationships).where(this.owned(entityRelationships, id)),
      ),
    );
  }

  async list(options: ListOptions): Promise<EntityRelationship[]> {
    return this.run((tx) =>
      tx
        .select()
        .from(entityRelationships)
        .where(this.inTenant(entityRelationships))
        .orderBy(asc(entityRelationships.createdAt))
        .limit(limitOf(options)),
    );
  }
}

/** Who made a merge or revert decision. */
export type Decider =
  | { readonly kind: Extract<DecisionActorKind, "USER">; readonly userId: string }
  | { readonly kind: Extract<DecisionActorKind, "RULE">; readonly rule: string };

export interface MergeDecision {
  readonly survivingEntityId: string;
  readonly mergedEntityId: string;
  readonly reason: string;
  /** 0 to 1. */
  readonly confidence: number;
  readonly matchSignals: readonly MergeSignal[];
  readonly decidedBy: Decider;
}

/** Longest merge chain followed when resolving; merges cannot cycle, this is a backstop. */
const MAX_CHAIN = 1000;

/**
 * Reversible entity merges. A merge is a record; it never rewrites or deletes
 * the merged entity, its claims or its evidence. While a merge is active the
 * merged entity resolves to the survivor; undoing it restores the previous
 * resolution with nothing lost.
 */
export class EntityMergesRepository extends TenantRepository {
  async merge(decision: MergeDecision): Promise<EntityMerge> {
    const survivingId = requireUuid(decision.survivingEntityId);
    const mergedId = requireUuid(decision.mergedEntityId);
    if (
      !Number.isFinite(decision.confidence) ||
      decision.confidence < 0 ||
      decision.confidence > 1
    ) {
      throw new RangeError("merge confidence must be between 0 and 1");
    }

    return this.run(async (tx) => {
      const pair = await tx
        .select({ id: entities.id, kind: entities.kind })
        .from(entities)
        .where(and(this.inTenant(entities), sql`${entities.id} in (${survivingId}, ${mergedId})`));
      const surviving = pair.find((row) => row.id === survivingId);
      const merged = pair.find((row) => row.id === mergedId);
      if (surviving === undefined || merged === undefined) {
        throw new ReferenceNotFoundError("entity_merges_entities");
      }
      if (surviving.kind !== merged.kind) {
        throw new MergeRuleViolationError(
          "KIND_MISMATCH",
          `Cannot merge a ${merged.kind} into a ${surviving.kind}.`,
        );
      }
      // Also enforced by a CHECK constraint; checked here first for a clear error.
      const nameOnly = decision.matchSignals.every((signal) => signal === "NAME");
      if (
        decision.decidedBy.kind === "RULE" &&
        nameOnly &&
        NAME_ONLY_AUTOMERGE_FORBIDDEN.includes(surviving.kind)
      ) {
        throw new MergeRuleViolationError(
          "NAME_ONLY_AUTOMERGE",
          "People and organisations are never merged automatically on a name match alone.",
        );
      }

      const decider = decision.decidedBy;
      return onlyRow(
        await tx
          .insert(entityMerges)
          .values({
            tenantId: this.tenantId,
            entityKind: surviving.kind,
            survivingEntityId: survivingId,
            mergedEntityId: mergedId,
            reason: decision.reason,
            confidence: decision.confidence.toFixed(3),
            matchSignals: [...decision.matchSignals],
            mergedByKind: decider.kind,
            mergedByUserId: decider.kind === "USER" ? requireUuid(decider.userId) : null,
            mergedByRule: decider.kind === "RULE" ? decider.rule : null,
          })
          .returning(),
      );
    });
  }

  /**
   * Reverts an active merge. Returns null when no merge with that id exists in
   * this tenant; throws when it exists but was already reverted.
   */
  async undo(
    mergeId: string,
    revert: { readonly decidedBy: Decider; readonly reason: string },
  ): Promise<EntityMerge | null> {
    const decider = revert.decidedBy;
    return this.run(async (tx) => {
      const reverted = firstRow(
        await tx
          .update(entityMerges)
          .set({
            revertedAt: sql`now()`,
            revertedByKind: decider.kind,
            revertedByUserId: decider.kind === "USER" ? requireUuid(decider.userId) : null,
            revertedByRule: decider.kind === "RULE" ? decider.rule : null,
            revertReason: revert.reason,
          })
          .where(and(this.owned(entityMerges, mergeId), sql`${entityMerges.revertedAt} is null`))
          .returning(),
      );
      if (reverted !== null) return reverted;
      const existing = firstRow(
        await tx
          .select({ id: entityMerges.id })
          .from(entityMerges)
          .where(this.owned(entityMerges, mergeId)),
      );
      if (existing === null) return null;
      throw new MergeRuleViolationError(
        "ALREADY_REVERTED",
        "This merge has already been reverted.",
      );
    });
  }

  async findById(id: string): Promise<EntityMerge | null> {
    return this.run(async (tx) =>
      firstRow(await tx.select().from(entityMerges).where(this.owned(entityMerges, id))),
    );
  }

  async list(options: ListOptions): Promise<EntityMerge[]> {
    return this.run((tx) =>
      tx
        .select()
        .from(entityMerges)
        .where(this.inTenant(entityMerges))
        .orderBy(asc(entityMerges.createdAt))
        .limit(limitOf(options)),
    );
  }

  /** The canonical entity `entityId` currently resolves to (itself if not merged). */
  async resolve(entityId: string): Promise<string> {
    const start = requireUuid(entityId);
    return this.run(async (tx) => {
      const result = await tx.execute<{ entity_id: string }>(sql`
        with recursive chain(entity_id, depth) as (
          select ${start}::uuid, 0
          union all
          select m.surviving_entity_id, c.depth + 1
          from chain c
          join ${entityMerges} m
            on m.tenant_id = ${this.tenantId}
           and m.merged_entity_id = c.entity_id
           and m.reverted_at is null
          where c.depth < ${MAX_CHAIN}
        )
        select entity_id from chain order by depth desc limit 1`);
      return onlyRow(result.rows).entity_id;
    });
  }

  /** The entity and every entity currently merged into it, directly or by chain. */
  async members(entityId: string): Promise<string[]> {
    const root = requireUuid(entityId);
    return this.run(async (tx) => {
      const result = await tx.execute<{ entity_id: string }>(sql`
        with recursive tree(entity_id, depth) as (
          select ${root}::uuid, 0
          union all
          select m.merged_entity_id, t.depth + 1
          from tree t
          join ${entityMerges} m
            on m.tenant_id = ${this.tenantId}
           and m.surviving_entity_id = t.entity_id
           and m.reverted_at is null
          where t.depth < ${MAX_CHAIN}
        )
        select entity_id from tree order by depth, entity_id`);
      return result.rows.map((row) => row.entity_id);
    });
  }
}

import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  numeric,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAtColumn, idColumn, optionalTimestamp, tenantIdColumn } from "./columns.ts";
import { decisionActorKind, entityKind, mergeSignal } from "./enums.ts";
import { tenants, users } from "./tenancy.ts";

export const entities = pgTable(
  "entities",
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    kind: entityKind("kind").notNull(),
    displayName: text("display_name").notNull(),
    createdAt: createdAtColumn(),
    /**
     * The entity's normalised identifier (a domain, an address, platform:handle),
     * when it has one. Unique per kind, so fusion resolves an identifier to one
     * entity. Null for kinds identified by name alone (a person, an
     * organisation), which are never resolved by value (Phase 4).
     */
    identifier: text("identifier"),
  },
  (t) => [
    primaryKey({ name: "entities_pk", columns: [t.tenantId, t.id] }),
    foreignKey({
      name: "entities_tenant_fk",
      columns: [t.tenantId],
      foreignColumns: [tenants.tenantId],
    }),
    // Lets entity_merges prove both sides of a merge are the same kind.
    unique("entities_id_kind_key").on(t.tenantId, t.id, t.kind),
    check("entities_display_name_not_blank", sql`length(btrim(${t.displayName})) > 0`),
    uniqueIndex("entities_one_per_identifier")
      .on(t.tenantId, t.kind, t.identifier)
      .where(sql`${t.identifier} is not null`),
    check(
      "entities_identifier_not_blank",
      sql`${t.identifier} is null or length(btrim(${t.identifier})) > 0`,
    ),
    // A person or organisation is never identified by its name: only by a
    // namespaced external identifier (wikidata:Q42), never a bare value.
    check(
      "entities_named_kinds_external_identifier_only",
      sql`${t.identifier} is null or ${t.kind} not in ('PERSON', 'ORGANIZATION') or ${t.identifier} ~ '^[a-z][a-z0-9_.-]*:[^ ]+$'`,
    ),
  ],
);

export const entityRelationships = pgTable(
  "entity_relationships",
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    sourceEntityId: uuid("source_entity_id").notNull(),
    targetEntityId: uuid("target_entity_id").notNull(),
    kind: text("kind").notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    primaryKey({ name: "entity_relationships_pk", columns: [t.tenantId, t.id] }),
    foreignKey({
      name: "entity_relationships_tenant_fk",
      columns: [t.tenantId],
      foreignColumns: [tenants.tenantId],
    }),
    foreignKey({
      name: "entity_relationships_source_fk",
      columns: [t.tenantId, t.sourceEntityId],
      foreignColumns: [entities.tenantId, entities.id],
    }),
    foreignKey({
      name: "entity_relationships_target_fk",
      columns: [t.tenantId, t.targetEntityId],
      foreignColumns: [entities.tenantId, entities.id],
    }),
    check("entity_relationships_not_self", sql`${t.sourceEntityId} <> ${t.targetEntityId}`),
    // One row per relationship: fusion asserting it again adds a claim, not a duplicate edge.
    unique("entity_relationships_one_per_kind").on(
      t.tenantId,
      t.sourceEntityId,
      t.targetEntityId,
      t.kind,
    ),
    // The walk steps from a target as often as from a source (D-33); the
    // unique key above serves the source side.
    index("entity_relationships_target_idx").on(t.tenantId, t.targetEntityId),
    check("entity_relationships_kind_format", sql`${t.kind} ~ '^[a-z][a-z_]*$'`),
  ],
);

/**
 * A reversible merge decision. Merging never rewrites or deletes the merged
 * entity, its claims or its evidence: the merged entity stays in place and is
 * resolved to the surviving one while the merge is active. Undoing it sets the
 * revert columns and nothing is lost.
 *
 * Database-enforced rules:
 *   - both sides exist and are the same kind (composite foreign keys);
 *   - an automatic (RULE) merge of a person or organisation needs a signal
 *     other than NAME (entity_merges_no_name_only_automerge);
 *   - an entity is merged into at most one survivor at a time (partial unique);
 *   - the survivor must not itself be merged away, so no cycles (trigger);
 *   - a revert is final and is the only permitted update (trigger + column grants).
 */
export const entityMerges = pgTable(
  "entity_merges",
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    entityKind: entityKind("entity_kind").notNull(),
    survivingEntityId: uuid("surviving_entity_id").notNull(),
    mergedEntityId: uuid("merged_entity_id").notNull(),
    reason: text("reason").notNull(),
    /** 0 to 1, as assessed by whoever made the decision. */
    confidence: numeric("confidence", { precision: 4, scale: 3 }).notNull(),
    matchSignals: mergeSignal("match_signals").array().notNull(),
    mergedByKind: decisionActorKind("merged_by_kind").notNull(),
    mergedByUserId: uuid("merged_by_user_id"),
    mergedByRule: text("merged_by_rule"),
    createdAt: createdAtColumn(),
    revertedAt: optionalTimestamp("reverted_at"),
    revertedByKind: decisionActorKind("reverted_by_kind"),
    revertedByUserId: uuid("reverted_by_user_id"),
    revertedByRule: text("reverted_by_rule"),
    revertReason: text("revert_reason"),
  },
  (t) => [
    primaryKey({ name: "entity_merges_pk", columns: [t.tenantId, t.id] }),
    foreignKey({
      name: "entity_merges_tenant_fk",
      columns: [t.tenantId],
      foreignColumns: [tenants.tenantId],
    }),
    foreignKey({
      name: "entity_merges_surviving_fk",
      columns: [t.tenantId, t.survivingEntityId, t.entityKind],
      foreignColumns: [entities.tenantId, entities.id, entities.kind],
    }),
    foreignKey({
      name: "entity_merges_merged_fk",
      columns: [t.tenantId, t.mergedEntityId, t.entityKind],
      foreignColumns: [entities.tenantId, entities.id, entities.kind],
    }),
    foreignKey({
      name: "entity_merges_merged_by_user_fk",
      columns: [t.tenantId, t.mergedByUserId],
      foreignColumns: [users.tenantId, users.id],
    }),
    foreignKey({
      name: "entity_merges_reverted_by_user_fk",
      columns: [t.tenantId, t.revertedByUserId],
      foreignColumns: [users.tenantId, users.id],
    }),
    uniqueIndex("entity_merges_one_active_per_merged")
      .on(t.tenantId, t.mergedEntityId)
      .where(sql`${t.revertedAt} is null`),
    index("entity_merges_surviving_idx").on(t.tenantId, t.survivingEntityId),
    check("entity_merges_not_self", sql`${t.survivingEntityId} <> ${t.mergedEntityId}`),
    check("entity_merges_confidence_range", sql`${t.confidence} >= 0 and ${t.confidence} <= 1`),
    check("entity_merges_reason_not_blank", sql`length(btrim(${t.reason})) > 0`),
    check("entity_merges_has_signals", sql`cardinality(${t.matchSignals}) > 0`),
    check(
      "entity_merges_no_name_only_automerge",
      sql`not (${t.mergedByKind} = 'RULE'
        and ${t.entityKind} in ('PERSON', 'ORGANIZATION')
        and ${t.matchSignals} <@ array['NAME']::merge_signal[])`,
    ),
    check(
      "entity_merges_merged_by_consistent",
      sql`(${t.mergedByKind} = 'USER' and ${t.mergedByUserId} is not null and ${t.mergedByRule} is null)
        or (${t.mergedByKind} = 'RULE' and ${t.mergedByRule} is not null and ${t.mergedByUserId} is null)`,
    ),
    check(
      "entity_merges_revert_consistent",
      sql`(${t.revertedAt} is null and ${t.revertedByKind} is null and ${t.revertedByUserId} is null
          and ${t.revertedByRule} is null and ${t.revertReason} is null)
        or (${t.revertedAt} is not null and length(btrim(coalesce(${t.revertReason}, ''))) > 0 and (
          (${t.revertedByKind} = 'USER' and ${t.revertedByUserId} is not null and ${t.revertedByRule} is null)
          or (${t.revertedByKind} = 'RULE' and ${t.revertedByRule} is not null and ${t.revertedByUserId} is null)))`,
    ),
  ],
);

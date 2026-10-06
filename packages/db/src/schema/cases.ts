import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAtColumn, idColumn, optionalTimestamp, tenantIdColumn } from "./columns.ts";
import { entities, entityRelationships } from "./entities.ts";
import { claims, evidence } from "./evidence.ts";
import { tenants, users } from "./tenancy.ts";

export const cases = pgTable(
  "cases",
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    title: text("title").notNull(),
    description: text("description"),
    createdByUserId: uuid("created_by_user_id"),
    createdAt: createdAtColumn(),
    archivedAt: optionalTimestamp("archived_at"),
  },
  (t) => [
    primaryKey({ name: "cases_pk", columns: [t.tenantId, t.id] }),
    foreignKey({
      name: "cases_tenant_fk",
      columns: [t.tenantId],
      foreignColumns: [tenants.tenantId],
    }),
    foreignKey({
      name: "cases_created_by_fk",
      columns: [t.tenantId, t.createdByUserId],
      foreignColumns: [users.tenantId, users.id],
    }),
    check("cases_title_not_blank", sql`length(btrim(${t.title})) > 0`),
  ],
);

/** A piece of evidence, an entity, a claim or a relationship pinned to a case: exactly one. */
export const casePins = pgTable(
  "case_pins",
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    caseId: uuid("case_id").notNull(),
    evidenceId: uuid("evidence_id"),
    entityId: uuid("entity_id"),
    claimId: uuid("claim_id"),
    relationshipId: uuid("relationship_id"),
    pinnedByUserId: uuid("pinned_by_user_id"),
    note: text("note"),
    createdAt: createdAtColumn(),
  },
  (t) => [
    primaryKey({ name: "case_pins_pk", columns: [t.tenantId, t.id] }),
    foreignKey({
      name: "case_pins_tenant_fk",
      columns: [t.tenantId],
      foreignColumns: [tenants.tenantId],
    }),
    foreignKey({
      name: "case_pins_case_fk",
      columns: [t.tenantId, t.caseId],
      foreignColumns: [cases.tenantId, cases.id],
    }),
    foreignKey({
      name: "case_pins_evidence_fk",
      columns: [t.tenantId, t.evidenceId],
      foreignColumns: [evidence.tenantId, evidence.id],
    }),
    foreignKey({
      name: "case_pins_entity_fk",
      columns: [t.tenantId, t.entityId],
      foreignColumns: [entities.tenantId, entities.id],
    }),
    foreignKey({
      name: "case_pins_claim_fk",
      columns: [t.tenantId, t.claimId],
      foreignColumns: [claims.tenantId, claims.id],
    }),
    foreignKey({
      name: "case_pins_relationship_fk",
      columns: [t.tenantId, t.relationshipId],
      foreignColumns: [entityRelationships.tenantId, entityRelationships.id],
    }),
    foreignKey({
      name: "case_pins_pinned_by_fk",
      columns: [t.tenantId, t.pinnedByUserId],
      foreignColumns: [users.tenantId, users.id],
    }),
    check(
      "case_pins_one_target",
      sql`num_nonnulls(${t.evidenceId}, ${t.entityId}, ${t.claimId}, ${t.relationshipId}) = 1`,
    ),
    uniqueIndex("case_pins_evidence_key")
      .on(t.tenantId, t.caseId, t.evidenceId)
      .where(sql`${t.evidenceId} is not null`),
    uniqueIndex("case_pins_entity_key")
      .on(t.tenantId, t.caseId, t.entityId)
      .where(sql`${t.entityId} is not null`),
    uniqueIndex("case_pins_claim_key")
      .on(t.tenantId, t.caseId, t.claimId)
      .where(sql`${t.claimId} is not null`),
    uniqueIndex("case_pins_relationship_key")
      .on(t.tenantId, t.caseId, t.relationshipId)
      .where(sql`${t.relationshipId} is not null`),
  ],
);

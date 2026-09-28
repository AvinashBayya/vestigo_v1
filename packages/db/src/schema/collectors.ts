import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAtColumn, idColumn, optionalTimestamp, tenantIdColumn } from "./columns.ts";
import { collectionMode, collectorDiscipline, commercialUseVerdict, targetType } from "./enums.ts";
import { tenants, users } from "./tenancy.ts";

/**
 * A tenant's copy of a collector's platform registry entry. The platform
 * catalogue in @repo/collectors is the source of truth; this row is written
 * from it whenever the collector is dispatched, and exists so evidence can
 * reference its collector. Evidence takes its source label from here, never
 * from a string the collector supplies (CLAUDE.md, "Source labelling"),
 * because evidence.collector_id is a foreign key to this row and evidence has
 * no label column of its own.
 *
 * Every entry states its data licence and commercial-use verdict. A BLOCKED
 * collector can never be enabled, a disabled collector must say why, and a
 * trigger refuses evidence from any collector that is not enabled.
 */
export const collectorsRegistry = pgTable(
  "collectors_registry",
  {
    tenantId: tenantIdColumn(),
    collectorId: text("collector_id").notNull(),
    sourceLabel: text("source_label").notNull(),
    discipline: collectorDiscipline("discipline").notNull(),
    collectionMode: collectionMode("collection_mode").notNull(),
    dataLicence: text("data_licence").notNull(),
    commercialUse: commercialUseVerdict("commercial_use").notNull(),
    enabled: boolean("enabled").notNull(),
    disabledReason: text("disabled_reason"),
    createdAt: createdAtColumn(),
  },
  (t) => [
    primaryKey({ name: "collectors_registry_pk", columns: [t.tenantId, t.collectorId] }),
    foreignKey({
      name: "collectors_registry_tenant_fk",
      columns: [t.tenantId],
      foreignColumns: [tenants.tenantId],
    }),
    check("collectors_registry_id_format", sql`${t.collectorId} ~ '^[a-z0-9][a-z0-9._-]*$'`),
    check("collectors_registry_label_not_blank", sql`length(btrim(${t.sourceLabel})) > 0`),
    check("collectors_registry_licence_not_blank", sql`length(btrim(${t.dataLicence})) > 0`),
    check(
      "collectors_registry_blocked_never_enabled",
      sql`not ${t.enabled} or ${t.commercialUse} <> 'BLOCKED'`,
    ),
    check(
      "collectors_registry_disabled_has_reason",
      sql`${t.enabled} or length(btrim(coalesce(${t.disabledReason}, ''))) > 0`,
    ),
  ],
);

/**
 * A recorded authorisation to collect ACTIVELY against one target for one
 * tenant: who authorised it, on what basis, and for how long (CLAUDE.md §3).
 * An ACTIVE collector is refused unless one is in force for its exact target
 * when it is dispatched. Authorisations always expire; revoking one ends it
 * early. Nothing else about a row can change.
 */
export const scopeAuthorisations = pgTable(
  "scope_authorisations",
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    targetType: targetType("target_type").notNull(),
    /** The target in its normalised form, compared exactly. */
    target: text("target").notNull(),
    /** The tenant member who authorised it. */
    authorisedByUserId: uuid("authorised_by_user_id").notNull(),
    /** The authority relied on: the engagement, contract or owner's consent. */
    basis: text("basis").notNull(),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull(),
    validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
    revokedAt: optionalTimestamp("revoked_at"),
    createdAt: createdAtColumn(),
  },
  (t) => [
    primaryKey({ name: "scope_authorisations_pk", columns: [t.tenantId, t.id] }),
    foreignKey({
      name: "scope_authorisations_tenant_fk",
      columns: [t.tenantId],
      foreignColumns: [tenants.tenantId],
    }),
    foreignKey({
      name: "scope_authorisations_authoriser_fk",
      columns: [t.tenantId, t.authorisedByUserId],
      foreignColumns: [users.tenantId, users.id],
    }),
    index("scope_authorisations_target_idx").on(t.tenantId, t.targetType, t.target),
    check("scope_authorisations_target_not_blank", sql`length(btrim(${t.target})) > 0`),
    check("scope_authorisations_basis_not_blank", sql`length(btrim(${t.basis})) > 0`),
    check("scope_authorisations_period", sql`${t.validUntil} > ${t.validFrom}`),
  ],
);

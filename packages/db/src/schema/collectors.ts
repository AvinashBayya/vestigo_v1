import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { createdAtColumn, tenantIdColumn } from "./columns.ts";
import { collectionMode, collectorDiscipline, commercialUseVerdict } from "./enums.ts";
import { tenants } from "./tenancy.ts";

/**
 * A tenant's registry entry for a collector. Evidence takes its source label
 * from here, never from a string the collector supplies (CLAUDE.md, "Source
 * labelling"), because evidence.collector_id is a foreign key to this row.
 *
 * Every entry states its data licence and commercial-use verdict. A collector
 * can only be enabled when commercial use is PERMITTED, and a disabled
 * collector must say why (CLAUDE.md §3).
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
      "collectors_registry_enabled_requires_permitted",
      sql`not ${t.enabled} or ${t.commercialUse} = 'PERMITTED'`,
    ),
    check(
      "collectors_registry_disabled_has_reason",
      sql`${t.enabled} or length(btrim(coalesce(${t.disabledReason}, ''))) > 0`,
    ),
  ],
);

import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  foreignKey,
  pgTable,
  primaryKey,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { collectorsRegistry } from "./collectors.ts";
import { createdAtColumn, idColumn, optionalTimestamp, tenantIdColumn } from "./columns.ts";
import { usageUnit } from "./enums.ts";
import { evidence } from "./evidence.ts";
import { tenants, users } from "./tenancy.ts";
import { jobs } from "./work.ts";

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => "bytea",
});

/** A scheduled re-run of a target. Schedules live here, not only in Redis. */
export const monitors = pgTable(
  "monitors",
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    name: text("name").notNull(),
    target: text("target").notNull(),
    scheduleCron: text("schedule_cron").notNull(),
    enabled: boolean("enabled").notNull(),
    createdByUserId: uuid("created_by_user_id"),
    createdAt: createdAtColumn(),
  },
  (t) => [
    primaryKey({ name: "monitors_pk", columns: [t.tenantId, t.id] }),
    foreignKey({
      name: "monitors_tenant_fk",
      columns: [t.tenantId],
      foreignColumns: [tenants.tenantId],
    }),
    foreignKey({
      name: "monitors_created_by_fk",
      columns: [t.tenantId, t.createdByUserId],
      foreignColumns: [users.tenantId, users.id],
    }),
    check("monitors_name_not_blank", sql`length(btrim(${t.name})) > 0`),
    check("monitors_target_not_blank", sql`length(btrim(${t.target})) > 0`),
    check("monitors_schedule_not_blank", sql`length(btrim(${t.scheduleCron})) > 0`),
  ],
);

export const alerts = pgTable(
  "alerts",
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    monitorId: uuid("monitor_id").notNull(),
    title: text("title").notNull(),
    evidenceId: uuid("evidence_id"),
    createdAt: createdAtColumn(),
    acknowledgedAt: optionalTimestamp("acknowledged_at"),
    acknowledgedByUserId: uuid("acknowledged_by_user_id"),
  },
  (t) => [
    primaryKey({ name: "alerts_pk", columns: [t.tenantId, t.id] }),
    foreignKey({
      name: "alerts_tenant_fk",
      columns: [t.tenantId],
      foreignColumns: [tenants.tenantId],
    }),
    foreignKey({
      name: "alerts_monitor_fk",
      columns: [t.tenantId, t.monitorId],
      foreignColumns: [monitors.tenantId, monitors.id],
    }),
    foreignKey({
      name: "alerts_evidence_fk",
      columns: [t.tenantId, t.evidenceId],
      foreignColumns: [evidence.tenantId, evidence.id],
    }),
    foreignKey({
      name: "alerts_acknowledged_by_fk",
      columns: [t.tenantId, t.acknowledgedByUserId],
      foreignColumns: [users.tenantId, users.id],
    }),
    check("alerts_title_not_blank", sql`length(btrim(${t.title})) > 0`),
    check(
      "alerts_acknowledgement_consistent",
      sql`(${t.acknowledgedAt} is null) = (${t.acknowledgedByUserId} is null)`,
    ),
  ],
);

/**
 * A tenant's provider credential, envelope-encrypted: the secret is encrypted
 * with a per-credential data key, and the data key is encrypted with the master
 * key. No plaintext column exists (CLAUDE.md §9).
 */
export const credentials = pgTable(
  "credentials",
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    provider: text("provider").notNull(),
    label: text("label").notNull(),
    ciphertext: bytea("ciphertext").notNull(),
    encryptedDataKey: bytea("encrypted_data_key").notNull(),
    masterKeyVersion: text("master_key_version").notNull(),
    createdAt: createdAtColumn(),
    lastUsedAt: optionalTimestamp("last_used_at"),
    revokedAt: optionalTimestamp("revoked_at"),
  },
  (t) => [
    primaryKey({ name: "credentials_pk", columns: [t.tenantId, t.id] }),
    foreignKey({
      name: "credentials_tenant_fk",
      columns: [t.tenantId],
      foreignColumns: [tenants.tenantId],
    }),
    check("credentials_provider_format", sql`${t.provider} ~ '^[a-z0-9][a-z0-9._-]*$'`),
    check("credentials_label_not_blank", sql`length(btrim(${t.label})) > 0`),
    check("credentials_ciphertext_present", sql`octet_length(${t.ciphertext}) > 0`),
    check("credentials_data_key_present", sql`octet_length(${t.encryptedDataKey}) > 0`),
  ],
);

/** Units consumed against a tenant by one external call. Append-only. */
export const usageEvents = pgTable(
  "usage_events",
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    unit: usageUnit("unit").notNull(),
    quantity: bigint("quantity", { mode: "number" }).notNull(),
    collectorId: text("collector_id"),
    jobId: uuid("job_id"),
    createdAt: createdAtColumn(),
  },
  (t) => [
    primaryKey({ name: "usage_events_pk", columns: [t.tenantId, t.id] }),
    foreignKey({
      name: "usage_events_tenant_fk",
      columns: [t.tenantId],
      foreignColumns: [tenants.tenantId],
    }),
    foreignKey({
      name: "usage_events_collector_fk",
      columns: [t.tenantId, t.collectorId],
      foreignColumns: [collectorsRegistry.tenantId, collectorsRegistry.collectorId],
    }),
    foreignKey({
      name: "usage_events_job_fk",
      columns: [t.tenantId, t.jobId],
      foreignColumns: [jobs.tenantId, jobs.id],
    }),
    check("usage_events_quantity_non_negative", sql`${t.quantity} >= 0`),
  ],
);

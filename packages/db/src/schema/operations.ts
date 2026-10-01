import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { collectorsRegistry } from "./collectors.ts";
import { createdAtColumn, idColumn, optionalTimestamp, tenantIdColumn } from "./columns.ts";
import { quotaPeriod, usageUnit } from "./enums.ts";
import { evidence } from "./evidence.ts";
import { reports } from "./reports.ts";
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
/** One model call's share of a usage event (usage_events.model_calls). */
export interface ModelCallUsage {
  readonly modelId: string;
  /** The host of the configured endpoint the call was sent to. */
  readonly endpointHost: string;
  /** The upstream provider the endpoint named; null when it named none. */
  readonly servedBy: string | null;
  /** Every region header the response carried, raw: what the endpoint said, never a guarantee. */
  readonly regionHeaders: readonly { readonly name: string; readonly value: string }[];
  readonly quantity: number;
}

export const usageEvents = pgTable(
  "usage_events",
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    unit: usageUnit("unit").notNull(),
    quantity: bigint("quantity", { mode: "number" }).notNull(),
    collectorId: text("collector_id"),
    jobId: uuid("job_id"),
    /**
     * Which attempt of the job consumed these units (the job's own attempt
     * count). With the job and unit, unique: an attempt is recorded once, so a
     * replay never charges twice (Phase 4).
     */
    attempt: integer("attempt"),
    /**
     * The report whose generation consumed these units (model tokens, Phase 5).
     * With the attempt and unit, unique: a generation attempt is charged once.
     */
    reportId: uuid("report_id"),
    /**
     * For a report attempt's model tokens: each model call the attempt made,
     * in order, with the upstream provider that served it and its share of
     * `quantity`. A rejected answer's call is listed too: a provider still
     * processed the material. Null on every other row. Validated on write
     * (UsageEventsRepository.recordReportAttempt).
     */
    modelCalls: jsonb("model_calls").$type<ModelCallUsage[]>(),
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
    check("usage_events_attempt_positive", sql`${t.attempt} is null or ${t.attempt} >= 1`),
    foreignKey({
      name: "usage_events_report_fk",
      columns: [t.tenantId, t.reportId],
      foreignColumns: [reports.tenantId, reports.id],
    }),
    check(
      "usage_events_attempt_with_work",
      sql`${t.attempt} is null or ${t.jobId} is not null or ${t.reportId} is not null`,
    ),
    check("usage_events_one_work_item", sql`num_nonnulls(${t.jobId}, ${t.reportId}) <= 1`),
    check(
      "usage_events_model_calls_with_report",
      sql`${t.modelCalls} is null or (${t.reportId} is not null and jsonb_typeof(${t.modelCalls}) = 'array' and jsonb_array_length(${t.modelCalls}) >= 1)`,
    ),
    uniqueIndex("usage_events_one_per_attempt")
      .on(t.tenantId, t.jobId, t.attempt, t.unit)
      .where(sql`${t.jobId} is not null`),
    uniqueIndex("usage_events_one_per_report_attempt")
      .on(t.tenantId, t.reportId, t.attempt, t.unit)
      .where(sql`${t.reportId} is not null`),
  ],
);

/**
 * The most of a unit a tenant may consume in a calendar period (UTC), checked
 * before a job is dispatched. Set by an operator; the application only reads
 * it. A tenant with no row for a unit and period has no limit on it until
 * plans set quotas (Phase 7).
 */
export const tenantQuotas = pgTable(
  "tenant_quotas",
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    unit: usageUnit("unit").notNull(),
    period: quotaPeriod("period").notNull(),
    /** Zero is a real limit: nothing of this unit may be consumed. */
    maxQuantity: bigint("max_quantity", { mode: "number" }).notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    primaryKey({ name: "tenant_quotas_pk", columns: [t.tenantId, t.id] }),
    foreignKey({
      name: "tenant_quotas_tenant_fk",
      columns: [t.tenantId],
      foreignColumns: [tenants.tenantId],
    }),
    unique("tenant_quotas_one_per_unit_period").on(t.tenantId, t.unit, t.period),
    check("tenant_quotas_max_quantity_non_negative", sql`${t.maxQuantity} >= 0`),
  ],
);

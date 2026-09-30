import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { collectorsRegistry } from "./collectors.ts";
import { createdAtColumn, idColumn, optionalTimestamp, tenantIdColumn } from "./columns.ts";
import { jobOutcome, jobStatus, runStatus, targetType } from "./enums.ts";
import { tenants, users } from "./tenancy.ts";

export const investigations = pgTable(
  "investigations",
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    title: text("title").notNull(),
    /** The target exactly as the analyst entered it. */
    target: text("target").notNull(),
    createdByUserId: uuid("created_by_user_id"),
    createdAt: createdAtColumn(),
    archivedAt: optionalTimestamp("archived_at"),
  },
  (t) => [
    primaryKey({ name: "investigations_pk", columns: [t.tenantId, t.id] }),
    foreignKey({
      name: "investigations_tenant_fk",
      columns: [t.tenantId],
      foreignColumns: [tenants.tenantId],
    }),
    foreignKey({
      name: "investigations_created_by_fk",
      columns: [t.tenantId, t.createdByUserId],
      foreignColumns: [users.tenantId, users.id],
    }),
    check("investigations_title_not_blank", sql`length(btrim(${t.title})) > 0`),
    check("investigations_target_not_blank", sql`length(btrim(${t.target})) > 0`),
  ],
);

export const runs = pgTable(
  "runs",
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    investigationId: uuid("investigation_id").notNull(),
    status: runStatus("status").notNull(),
    requestedByUserId: uuid("requested_by_user_id"),
    createdAt: createdAtColumn(),
    startedAt: optionalTimestamp("started_at"),
    finishedAt: optionalTimestamp("finished_at"),
    /**
     * The target type the analyst chose for this run, or null when it was
     * left to detection (Phase 4). Set at creation.
     */
    requestedTargetType: targetType("requested_target_type"),
    /**
     * What the planner decided: the detected types and the collectors
     * planned or excluded, each with its reason. Null until planned.
     */
    plan: jsonb("plan"),
  },
  (t) => [
    primaryKey({ name: "runs_pk", columns: [t.tenantId, t.id] }),
    foreignKey({
      name: "runs_tenant_fk",
      columns: [t.tenantId],
      foreignColumns: [tenants.tenantId],
    }),
    foreignKey({
      name: "runs_investigation_fk",
      columns: [t.tenantId, t.investigationId],
      foreignColumns: [investigations.tenantId, investigations.id],
    }),
    foreignKey({
      name: "runs_requested_by_fk",
      columns: [t.tenantId, t.requestedByUserId],
      foreignColumns: [users.tenantId, users.id],
    }),
    check(
      "runs_finished_after_started",
      sql`${t.finishedAt} is null or ${t.startedAt} is null or ${t.finishedAt} >= ${t.startedAt}`,
    ),
  ],
);

/**
 * One collector's work within a run. The idempotency key (tenant, target,
 * collector, parameters) makes a retried job land on the same row instead of
 * duplicating work (CLAUDE.md §5).
 */
export const jobs = pgTable(
  "jobs",
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    runId: uuid("run_id").notNull(),
    collectorId: text("collector_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    status: jobStatus("status").notNull(),
    /** Attempts actually made. Zero at creation is a count, not a placeholder. */
    attempts: integer("attempts").notNull().default(0),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    createdAt: createdAtColumn(),
    startedAt: optionalTimestamp("started_at"),
    finishedAt: optionalTimestamp("finished_at"),
    /** The target this job collects, as its type and normalised value (Phase 4). */
    targetType: targetType("target_type"),
    target: text("target"),
    /** The collector's parameters; part of the idempotency key. */
    params: jsonb("params").notNull().default({}),
    /** The last attempt's collection outcome; null until one finished. */
    outcome: jobOutcome("outcome"),
    /** What a NOT_FOUND said was not found, as the collector stated it. Only with NOT_FOUND. */
    outcomeDetail: text("outcome_detail"),
    /** The FOUND result, exactly as the runtime validated it. Only with FOUND. */
    result: jsonb("result"),
    /** The evidence rows the FOUND result cites, in the result's order. Only with FOUND. */
    evidenceIds: uuid("evidence_ids").array(),
    /** When the next attempt is due, for a job waiting to retry. */
    nextAttemptAt: optionalTimestamp("next_attempt_at"),
    /** When retries ran out and the job went to the dead-letter queue. */
    deadLetteredAt: optionalTimestamp("dead_lettered_at"),
    /** When fusion turned this job's result into entities and claims. Only with FOUND. */
    fusedAt: optionalTimestamp("fused_at"),
  },
  (t) => [
    primaryKey({ name: "jobs_pk", columns: [t.tenantId, t.id] }),
    foreignKey({
      name: "jobs_tenant_fk",
      columns: [t.tenantId],
      foreignColumns: [tenants.tenantId],
    }),
    foreignKey({
      name: "jobs_run_fk",
      columns: [t.tenantId, t.runId],
      foreignColumns: [runs.tenantId, runs.id],
    }),
    foreignKey({
      name: "jobs_collector_fk",
      columns: [t.tenantId, t.collectorId],
      foreignColumns: [collectorsRegistry.tenantId, collectorsRegistry.collectorId],
    }),
    unique("jobs_idempotency_key").on(t.tenantId, t.idempotencyKey),
    check("jobs_attempts_non_negative", sql`${t.attempts} >= 0`),
    check("jobs_idempotency_key_not_blank", sql`length(btrim(${t.idempotencyKey})) > 0`),
    check(
      "jobs_error_consistent",
      sql`(${t.lastErrorCode} is null) = (${t.lastErrorMessage} is null)`,
    ),
    check(
      "jobs_finished_after_started",
      sql`${t.finishedAt} is null or ${t.startedAt} is null or ${t.finishedAt} >= ${t.startedAt}`,
    ),
    check("jobs_result_only_found", sql`${t.result} is null or ${t.outcome} = 'FOUND'`),
    check("jobs_evidence_only_found", sql`${t.evidenceIds} is null or ${t.outcome} = 'FOUND'`),
    check("jobs_fused_only_found", sql`${t.fusedAt} is null or ${t.outcome} = 'FOUND'`),
    check(
      "jobs_detail_only_not_found",
      sql`${t.outcomeDetail} is null or ${t.outcome} = 'NOT_FOUND'`,
    ),
    check("jobs_target_complete", sql`(${t.targetType} is null) = (${t.target} is null)`),
  ],
);

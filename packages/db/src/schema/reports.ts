import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAtColumn, idColumn, optionalTimestamp, tenantIdColumn } from "./columns.ts";
import { reportStatus } from "./enums.ts";
import { tenants, users } from "./tenancy.ts";
import { runs } from "./work.ts";

/**
 * A report generated from one run (Phase 5). Generation happens in a
 * background job; the row records its state, and on success the report
 * document, which is written once. A PDF is rendered from the stored document
 * on request, so the same report always renders the same content.
 */
export const reports = pgTable(
  "reports",
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    runId: uuid("run_id").notNull(),
    status: reportStatus("status").notNull(),
    /** Whether a model-written synthesis was requested. The rest never depends on a model. */
    includeSynthesis: boolean("include_synthesis").notNull(),
    requestedByUserId: uuid("requested_by_user_id"),
    /** Generation attempts made. Zero at creation is a count, not a placeholder. */
    attempts: integer("attempts").notNull().default(0),
    /** The report document (ReportDocument in @repo/core). Only with SUCCEEDED; written once. */
    document: jsonb("document"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: createdAtColumn(),
    startedAt: optionalTimestamp("started_at"),
    finishedAt: optionalTimestamp("finished_at"),
  },
  (t) => [
    primaryKey({ name: "reports_pk", columns: [t.tenantId, t.id] }),
    foreignKey({
      name: "reports_tenant_fk",
      columns: [t.tenantId],
      foreignColumns: [tenants.tenantId],
    }),
    foreignKey({
      name: "reports_run_fk",
      columns: [t.tenantId, t.runId],
      foreignColumns: [runs.tenantId, runs.id],
    }),
    foreignKey({
      name: "reports_requested_by_fk",
      columns: [t.tenantId, t.requestedByUserId],
      foreignColumns: [users.tenantId, users.id],
    }),
    index("reports_run_idx").on(t.tenantId, t.runId),
    check("reports_attempts_non_negative", sql`${t.attempts} >= 0`),
    check(
      "reports_document_only_succeeded",
      sql`(${t.document} is not null) = (${t.status} = 'SUCCEEDED')`,
    ),
    check("reports_error_consistent", sql`(${t.errorCode} is null) = (${t.errorMessage} is null)`),
    check(
      "reports_finished_after_started",
      sql`${t.finishedAt} is null or ${t.startedAt} is null or ${t.finishedAt} >= ${t.startedAt}`,
    ),
  ],
);

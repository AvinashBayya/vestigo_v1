import { sql } from "drizzle-orm";
import {
  bigint,
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
import { reportPdfStatus, reportStatus } from "./enums.ts";
import { tenants, users } from "./tenancy.ts";
import { runs } from "./work.ts";

/**
 * A report generated from one run (Phase 5). Generation happens in a
 * background job; the row records its state, and on success the report
 * document, which is written once. Its PDF is rendered once from that
 * document, in the background, and stored (report_pdfs).
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

/**
 * A generated report's PDF (Phase 5 follow-up): rendered once in the worker
 * from the stored document, and stored in the content store, so every
 * download is the same file. One row per report, created PENDING when the
 * report succeeds. READY records the stored file's hash and size, written
 * once; FAILED records why it could not be rendered.
 */
export const reportPdfs = pgTable(
  "report_pdfs",
  {
    tenantId: tenantIdColumn(),
    reportId: uuid("report_id").notNull(),
    status: reportPdfStatus("status").notNull(),
    /** Render attempts made. Zero at creation is a count, not a placeholder. */
    attempts: integer("attempts").notNull().default(0),
    /** The stored PDF's hash (`sha256:<hex>`), its content-store key. Only with READY. */
    contentHash: text("content_hash"),
    /** The stored PDF's size in bytes. Only with READY. */
    byteLength: bigint("byte_length", { mode: "number" }),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: createdAtColumn(),
    startedAt: optionalTimestamp("started_at"),
    finishedAt: optionalTimestamp("finished_at"),
  },
  (t) => [
    primaryKey({ name: "report_pdfs_pk", columns: [t.tenantId, t.reportId] }),
    foreignKey({
      name: "report_pdfs_tenant_fk",
      columns: [t.tenantId],
      foreignColumns: [tenants.tenantId],
    }),
    foreignKey({
      name: "report_pdfs_report_fk",
      columns: [t.tenantId, t.reportId],
      foreignColumns: [reports.tenantId, reports.id],
    }),
    check("report_pdfs_attempts_non_negative", sql`${t.attempts} >= 0`),
    check(
      "report_pdfs_file_only_ready",
      sql`(${t.contentHash} is not null) = (${t.status} = 'READY') and (${t.byteLength} is not null) = (${t.status} = 'READY')`,
    ),
    check(
      "report_pdfs_content_hash_format",
      sql`${t.contentHash} is null or ${t.contentHash} ~ '^sha256:[0-9a-f]{64}$'`,
    ),
    check("report_pdfs_byte_length_positive", sql`${t.byteLength} is null or ${t.byteLength} > 0`),
    check(
      "report_pdfs_error_only_failed",
      sql`(${t.errorCode} is not null) = (${t.status} = 'FAILED') and (${t.errorMessage} is not null) = (${t.status} = 'FAILED')`,
    ),
    check(
      "report_pdfs_finished_after_started",
      sql`${t.finishedAt} is null or ${t.startedAt} is null or ${t.finishedAt} >= ${t.startedAt}`,
    ),
  ],
);

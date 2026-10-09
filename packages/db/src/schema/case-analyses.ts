import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { cases } from "./cases.ts";
import { idColumn, tenantIdColumn } from "./columns.ts";
import { caseAnalysisStatus } from "./enums.ts";
import { tenants, users } from "./tenancy.ts";

/**
 * A case's analysis (R1-b): case-engine's documents for one case, computed from
 * exactly the input its hash names (owner ruling D-3). One row per case and
 * input: the same input never makes a second analysis. The row is written once
 * and never changed; where the analysis stands is recorded as rows of
 * case_analysis_events, so no stored status is ever rewritten.
 */
export const caseAnalyses = pgTable(
  "case_analyses",
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    caseId: uuid("case_id").notNull(),
    /**
     * `sha256:<64 hex>` of the canonical input the analysis reads: the case's
     * records, its runs and jobs, the registry and held collectors, the active
     * merges, the engine version and the wording (osint-engine's case input hash).
     */
    inputHash: text("input_hash").notNull(),
    /** case-engine's ENGINE_VERSION when the analysis was requested; part of the hash. */
    engineVersion: integer("engine_version").notNull(),
    /** The person who asked: the signed-in user, or an API key's issuer. */
    requestedByUserId: uuid("requested_by_user_id"),
    /** When it was first requested, as the requester's clock recorded it. Never defaulted. */
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(),
    /**
     * What the analysis rests on, recorded with the request (R1-b): the evidence
     * and the runs of the input its hash names. Every attempt reads exactly
     * that input, so every read of the analysis, whatever its status, probes
     * these for person data as well as the case as it is now (CLAUDE.md §9).
     * Null only on a row written before 0023, which a read refuses as not
     * recorded whole; the repository always writes both.
     */
    basisEvidenceIds: uuid("basis_evidence_ids").array(),
    basisRunIds: uuid("basis_run_ids").array(),
  },
  (t) => [
    primaryKey({ name: "case_analyses_pk", columns: [t.tenantId, t.id] }),
    foreignKey({
      name: "case_analyses_tenant_fk",
      columns: [t.tenantId],
      foreignColumns: [tenants.tenantId],
    }),
    foreignKey({
      name: "case_analyses_case_fk",
      columns: [t.tenantId, t.caseId],
      foreignColumns: [cases.tenantId, cases.id],
    }),
    foreignKey({
      name: "case_analyses_requested_by_fk",
      columns: [t.tenantId, t.requestedByUserId],
      foreignColumns: [users.tenantId, users.id],
    }),
    unique("case_analyses_input_key").on(t.tenantId, t.caseId, t.inputHash),
    index("case_analyses_case_idx").on(t.tenantId, t.caseId, t.requestedAt),
    check("case_analyses_input_hash_format", sql`${t.inputHash} ~ '^sha256:[0-9a-f]{64}$'`),
    check("case_analyses_engine_version_positive", sql`${t.engineVersion} >= 1`),
    check(
      "case_analyses_basis_whole",
      sql`(${t.basisEvidenceIds} is null) = (${t.basisRunIds} is null)`,
    ),
  ],
);

/**
 * Where a case analysis stands, one row per change, never rewritten. Each
 * attempt is requested once (PENDING) and finishes at most once: COMPLETE with
 * the document and the wording it was produced under, or FAILED with a coded
 * reason. A failed analysis can be attempted again; a complete one never is.
 * The database refuses an event out of that order (migration 0022).
 */
export const caseAnalysisEvents = pgTable(
  "case_analysis_events",
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    analysisId: uuid("analysis_id").notNull(),
    /** Which attempt this event belongs to: 1 for the first request, then one more per retry. */
    attempt: integer("attempt").notNull(),
    status: caseAnalysisStatus("status").notNull(),
    /** case-engine's documents for the case. Only with COMPLETE. */
    document: jsonb("document"),
    /** The wording the document was produced under (CASE_WORDING), copied in. Only with COMPLETE. */
    wording: jsonb("wording"),
    /** Why the attempt failed: a code, and a message with no person data. Only with FAILED. */
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    /** Who requested the attempt. Only with PENDING; the user, or an API key's issuer. */
    requestedByUserId: uuid("requested_by_user_id"),
    /**
     * When it happened, as the writer's clock recorded it: the request for
     * PENDING, the finish for COMPLETE and FAILED. Never defaulted.
     */
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ name: "case_analysis_events_pk", columns: [t.tenantId, t.id] }),
    foreignKey({
      name: "case_analysis_events_tenant_fk",
      columns: [t.tenantId],
      foreignColumns: [tenants.tenantId],
    }),
    foreignKey({
      name: "case_analysis_events_analysis_fk",
      columns: [t.tenantId, t.analysisId],
      foreignColumns: [caseAnalyses.tenantId, caseAnalyses.id],
    }),
    foreignKey({
      name: "case_analysis_events_requested_by_fk",
      columns: [t.tenantId, t.requestedByUserId],
      foreignColumns: [users.tenantId, users.id],
    }),
    index("case_analysis_events_analysis_idx").on(t.tenantId, t.analysisId, t.attempt),
    // One request and at most one finish per attempt, and at most one document ever.
    uniqueIndex("case_analysis_events_one_request")
      .on(t.tenantId, t.analysisId, t.attempt)
      .where(sql`${t.status} = 'PENDING'`),
    uniqueIndex("case_analysis_events_one_finish")
      .on(t.tenantId, t.analysisId, t.attempt)
      .where(sql`${t.status} <> 'PENDING'`),
    uniqueIndex("case_analysis_events_one_document")
      .on(t.tenantId, t.analysisId)
      .where(sql`${t.status} = 'COMPLETE'`),
    check("case_analysis_events_attempt_positive", sql`${t.attempt} >= 1`),
    check(
      "case_analysis_events_document_only_complete",
      sql`(${t.document} is not null) = (${t.status} = 'COMPLETE') and (${t.wording} is not null) = (${t.status} = 'COMPLETE')`,
    ),
    check(
      "case_analysis_events_error_only_failed",
      sql`(${t.errorCode} is not null) = (${t.status} = 'FAILED') and (${t.errorMessage} is not null) = (${t.status} = 'FAILED')`,
    ),
    check(
      "case_analysis_events_error_code_not_blank",
      sql`${t.errorCode} is null or length(btrim(${t.errorCode})) > 0`,
    ),
    check(
      "case_analysis_events_requester_only_pending",
      sql`${t.requestedByUserId} is null or ${t.status} = 'PENDING'`,
    ),
  ],
);

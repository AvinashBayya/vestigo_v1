import { AppError } from "@repo/core";

/**
 * Typed database errors. Messages never include row values or Postgres
 * `detail` text, which can carry personal data (CLAUDE.md §8).
 */

export class TenantContextError extends AppError {
  readonly code = "TENANT_CONTEXT_MISSING";

  constructor(reason: string) {
    super(`No tenant context: ${reason}. Tenant data is reachable only inside withTenant().`);
    this.name = "TenantContextError";
  }
}

/** Row-level security refused a write: the row belongs to another tenant. */
export class TenantIsolationViolationError extends AppError {
  readonly code = "TENANT_ISOLATION_VIOLATION";
  readonly table: string | null;

  constructor(table: string | null) {
    super(
      `Row-level security refused a write to ${table ?? "a table"} outside the current tenant.`,
    );
    this.name = "TenantIsolationViolationError";
    this.table = table;
  }
}

/** The application role lacks the privilege, e.g. UPDATE on an append-only table. */
export class DatabasePermissionError extends AppError {
  readonly code = "DB_PERMISSION_DENIED";

  constructor(message: string) {
    super(message);
    this.name = "DatabasePermissionError";
  }
}

/** A referenced row does not exist in this tenant. Says nothing about other tenants. */
export class ReferenceNotFoundError extends AppError {
  readonly code = "REFERENCE_NOT_FOUND";
  readonly constraint: string | null;

  constructor(constraint: string | null) {
    super(`A referenced row does not exist in this tenant (${constraint ?? "foreign key"}).`);
    this.name = "ReferenceNotFoundError";
    this.constraint = constraint;
  }
}

/** The row is still referenced by another row and cannot be deleted. */
export class ReferenceInUseError extends AppError {
  readonly code = "REFERENCE_IN_USE";
  readonly constraint: string | null;

  constructor(constraint: string | null) {
    super(`The row is still referenced (${constraint ?? "foreign key"}).`);
    this.name = "ReferenceInUseError";
    this.constraint = constraint;
  }
}

export class UniqueConflictError extends AppError {
  readonly code = "UNIQUE_CONFLICT";
  readonly constraint: string | null;

  constructor(constraint: string | null) {
    super(`A row with the same unique key already exists (${constraint ?? "unique constraint"}).`);
    this.name = "UniqueConflictError";
    this.constraint = constraint;
  }
}

/** A CHECK or NOT NULL constraint rejected the row. */
export class ConstraintViolationError extends AppError {
  readonly code = "CONSTRAINT_VIOLATION";
  readonly constraint: string | null;

  constructor(constraint: string | null, message: string) {
    super(message);
    this.name = "ConstraintViolationError";
    this.constraint = constraint;
  }
}

export class AppendOnlyViolationError extends AppError {
  readonly code = "APPEND_ONLY";

  constructor(message: string) {
    super(message);
    this.name = "AppendOnlyViolationError";
  }
}

export type MergeRule =
  | "SURVIVOR_ALREADY_MERGED"
  | "ALREADY_REVERTED"
  | "REVERT_ONLY"
  | "ALREADY_MERGED"
  | "NAME_ONLY_AUTOMERGE"
  | "KIND_MISMATCH";

export class MergeRuleViolationError extends AppError {
  readonly code = "MERGE_RULE_VIOLATION";
  readonly rule: MergeRule;

  constructor(rule: MergeRule, message: string) {
    super(message);
    this.name = "MergeRuleViolationError";
    this.rule = rule;
  }
}

/**
 * The database refused evidence because its collector is not enabled for the
 * tenant (a BLOCKED collector never is).
 */
export class CollectorNotEnabledError extends AppError {
  readonly code = "COLLECTOR_NOT_ENABLED";

  constructor() {
    super("Evidence was refused: its collector is not enabled for this tenant.");
    this.name = "CollectorNotEnabledError";
  }
}

/**
 * The database refused to change what a job already recorded: its result,
 * its evidence, its fusion, or a FOUND outcome (migration 0010).
 */
export class JobRecordedOnceError extends AppError {
  readonly code = "JOB_RECORDED_ONCE";

  constructor(message: string) {
    super(message);
    this.name = "JobRecordedOnceError";
  }
}

/**
 * The database refused to change a report's document once written, or the
 * status of a finished report (migration 0014).
 */
export class ReportRecordedOnceError extends AppError {
  readonly code = "REPORT_RECORDED_ONCE";

  constructor(message: string) {
    super(message);
    this.name = "ReportRecordedOnceError";
  }
}

/**
 * The database refused to change a stored case analysis or any record of where
 * it stands: both are written once, even by the schema owner (migration 0022).
 */
export class CaseAnalysisRecordedOnceError extends AppError {
  readonly code = "CASE_ANALYSIS_RECORDED_ONCE";

  constructor(message: string) {
    super(message);
    this.name = "CaseAnalysisRecordedOnceError";
  }
}

/**
 * The database refused a case analysis event out of order: a finish with no
 * request, a retry before a failure, or anything after a document
 * (migration 0022).
 */
export class CaseAnalysisOutOfOrderError extends AppError {
  readonly code = "CASE_ANALYSIS_OUT_OF_ORDER";

  constructor(message: string) {
    super(message);
    this.name = "CaseAnalysisOutOfOrderError";
  }
}

/**
 * A write in a snapshot transaction (REPEATABLE READ) conflicted with a
 * concurrent commit (SQLSTATE 40001). Nothing was written; the whole
 * transaction can be run again from the start.
 */
export class SnapshotConflictError extends AppError {
  readonly code = "SNAPSHOT_CONFLICT";

  constructor() {
    super("A concurrent change conflicted with this transaction's snapshot; nothing was written.");
    this.name = "SnapshotConflictError";
  }
}

export class InvalidIdentifierError extends AppError {
  readonly code = "INVALID_IDENTIFIER";

  constructor() {
    super("An identifier was not a valid UUID.");
    this.name = "InvalidIdentifierError";
  }
}

/**
 * The connection was lost mid-work: the server ended it (an idle transaction
 * past its timeout, an operator terminating the backend, a restart) or the
 * network dropped. Only the work on that connection fails; the pool discards
 * the connection and serves the next work on a new one. Retryable.
 */
export class DatabaseConnectionLostError extends AppError {
  readonly code = "DB_CONNECTION_LOST";
  /** The SQLSTATE the server ended the connection with, when it sent one. */
  readonly sqlState: string | null;

  constructor(sqlState: string | null) {
    super(
      sqlState === null
        ? "The database connection was lost before the work completed."
        : `The database connection was lost before the work completed (SQLSTATE ${sqlState}).`,
    );
    this.name = "DatabaseConnectionLostError";
    this.sqlState = sqlState;
  }
}

/**
 * Server-side reasons a connection ends: connection exceptions (class 08),
 * operator intervention (an administrator or crash shutdown, a terminated
 * backend, an idle-session timeout) and the idle-in-transaction timeout.
 */
const CONNECTION_LOST_SQLSTATES = new Set(["57P01", "57P02", "57P03", "57P05", "25P03"]);

/** node-postgres's own errors for a connection that is gone; they carry no SQLSTATE. */
const CONNECTION_LOST_MESSAGES = new Set([
  "Connection terminated unexpectedly",
  "Connection terminated",
  "Client has encountered a connection error and is not queryable",
  "Client was closed and is not queryable",
]);

/** The SQLSTATE (or null) of a lost connection anywhere in an error's cause chain; undefined if none was lost. */
function connectionLostSqlState(error: unknown): string | null | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth++) {
    const candidate = current as PgErrorShape;
    const code = text(candidate.code);
    if (code !== null && (code.startsWith("08") || CONNECTION_LOST_SQLSTATES.has(code))) {
      return code;
    }
    const message = text(candidate.message);
    if (message !== null && CONNECTION_LOST_MESSAGES.has(message)) return null;
    current = candidate.cause;
  }
  return undefined;
}

/**
 * A lost connection as a typed error, or the error unchanged. Used where an
 * error can come from the driver directly, outside a repository's
 * translation (a transaction's commit or rollback).
 */
export function connectionLostAsTyped(error: unknown): unknown {
  if (error instanceof AppError) return error;
  const sqlState = connectionLostSqlState(error);
  return sqlState === undefined ? error : new DatabaseConnectionLostError(sqlState);
}

/** Any other database failure. Carries the SQLSTATE for diagnosis. */
export class DatabaseError extends AppError {
  readonly code = "DATABASE_ERROR";
  readonly sqlState: string | null;

  constructor(sqlState: string | null, message: string) {
    super(message);
    this.name = "DatabaseError";
    this.sqlState = sqlState;
  }
}

interface PgErrorShape {
  readonly code?: unknown;
  readonly constraint?: unknown;
  readonly table?: unknown;
  readonly message?: unknown;
  readonly cause?: unknown;
}

function pgErrorOf(error: unknown): PgErrorShape | null {
  // Drizzle wraps driver errors; the Postgres error is the innermost cause
  // that carries a five-character SQLSTATE.
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth++) {
    const candidate = current as PgErrorShape;
    if (typeof candidate.code === "string" && /^[0-9A-Z]{5}$/.test(candidate.code))
      return candidate;
    current = candidate.cause;
  }
  return null;
}

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

const MERGE_UNIQUE = "entity_merges_one_active_per_merged";

/** Maps a driver error to a typed error. Errors that are already typed pass through. */
export function translateDatabaseError(error: unknown): Error {
  if (error instanceof AppError) return error;
  const lost = connectionLostSqlState(error);
  if (lost !== undefined) return new DatabaseConnectionLostError(lost);
  const pg = pgErrorOf(error);
  if (pg === null) {
    // Drizzle's own query errors put the bound parameter values in the message,
    // and those can be personal data; replace them wholesale.
    if (typeof error === "object" && error !== null && "query" in error) {
      return new DatabaseError(null, "a database query failed without a Postgres error code");
    }
    return error instanceof Error ? error : new DatabaseError(null, "unknown database failure");
  }

  const sqlState = text(pg.code);
  const constraint = text(pg.constraint);
  const message = text(pg.message) ?? "database error";

  switch (sqlState) {
    case "TNT01":
      return new TenantContextError("the transaction has no tenant set");
    case "42501":
      return message.includes("row-level security")
        ? new TenantIsolationViolationError(text(pg.table))
        : new DatabasePermissionError(message);
    case "23503":
      return message.includes("is still referenced") || message.includes("update or delete")
        ? new ReferenceInUseError(constraint)
        : new ReferenceNotFoundError(constraint);
    case "23505":
      return constraint === MERGE_UNIQUE
        ? new MergeRuleViolationError(
            "ALREADY_MERGED",
            "The entity is already merged into another entity; revert that merge first.",
          )
        : new UniqueConflictError(constraint);
    case "23514":
      if (constraint === "entity_merges_no_name_only_automerge") {
        return new MergeRuleViolationError(
          "NAME_ONLY_AUTOMERGE",
          "People and organisations are never merged automatically on a name match alone.",
        );
      }
      return new ConstraintViolationError(constraint, message);
    case "23502":
      return new ConstraintViolationError(constraint, message);
    case "22P02":
      return new InvalidIdentifierError();
    case "APP01":
      return new AppendOnlyViolationError(message);
    case "MRG01":
      return new MergeRuleViolationError("SURVIVOR_ALREADY_MERGED", message);
    case "MRG02":
      return new MergeRuleViolationError("ALREADY_REVERTED", message);
    case "MRG03":
      return new MergeRuleViolationError("REVERT_ONLY", message);
    case "COL01":
      return new CollectorNotEnabledError();
    case "JOB01":
      return new JobRecordedOnceError(message);
    case "REP01":
      return new ReportRecordedOnceError(message);
    case "40001":
      return new SnapshotConflictError();
    case "CAN01":
      return new CaseAnalysisRecordedOnceError(message);
    case "CAN02":
      return new CaseAnalysisOutOfOrderError(message);
    default:
      // Data exceptions (class 22) can echo the offending input value.
      return sqlState?.startsWith("22")
        ? new DatabaseError(sqlState, "a value was invalid for its column type")
        : new DatabaseError(sqlState, message);
  }
}

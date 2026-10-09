/**
 * Requesting a case analysis, and reading where one stands (R1-b), for the
 * API's three routes. The routes hold the HTTP and the person gate; what is
 * requested, which analysis a read shows and what its state says live here.
 *
 * A request reads the case as it is now, hashes it, and finds or creates the
 * analysis for that hash: the same input is one analysis. A FAILED analysis
 * gets a new attempt; a PENDING or COMPLETE one is returned as it is.
 *
 * A read answers with one of five states, each with a reason, and never with
 * progress it did not measure:
 *   NONE_YET  no analysis of this case was ever requested;
 *   PENDING   requested, not finished;
 *   COMPLETE  finished, for the case's records as they are now;
 *   FAILED    the latest attempt failed, with its code;
 *   STALE     the analysis is of an input the case no longer has (its records,
 *             or the analysis code or wording, changed since). Its own status
 *             and document are still shown, as of then.
 * A read of a case shows the analysis of the case as it is now when there is
 * one, else the most recently requested one, as STALE.
 */
import { ENGINE_VERSION } from "@repo/case-engine";
import { AppError, type CaseAnalysisStatus } from "@repo/core";
import type { CaseAnalysis, PersonProbe, TenantContext } from "@repo/db";
import type { CaseAnalysisCollectors } from "./collectors.ts";
import type { z } from "zod";
import { CaseAnalysisDocumentSchema, CaseWordingSchema } from "./document.ts";
import { caseInputHash, readCaseAnalysisInput, type CaseAnalysisInput } from "./input.ts";

export const CASE_ANALYSIS_READ_STATES = [
  "NONE_YET",
  "PENDING",
  "COMPLETE",
  "FAILED",
  "STALE",
] as const;
export type CaseAnalysisReadState = (typeof CASE_ANALYSIS_READ_STATES)[number];

/** Why a read is in its state, in words. None of them claims progress. */
export const CASE_ANALYSIS_STATE_REASONS = {
  NONE_YET: "No analysis of this case has been requested.",
  PENDING:
    "The analysis has been requested and has not finished. How far it has got is not measured.",
  COMPLETE: "The analysis finished, and the case's records are as they were when it was requested.",
  FAILED:
    "The latest attempt at the analysis failed ({code}), and no document was stored from it. Requesting the analysis again makes a new attempt.",
  STALE:
    "The case's records, or the analysis code or its wording, have changed since this analysis was requested. It describes the case as it was then; request a new analysis for the case as it is now.",
} as const satisfies Readonly<Record<CaseAnalysisReadState, string>>;

/** The most records one analysis reads, unless the caller sets another bound. */
export const DEFAULT_MAX_CASE_RECORDS = 50_000;

/** One stored analysis, where its latest attempt stands. */
export interface CaseAnalysisRecord {
  readonly analysis: CaseAnalysis;
  readonly attempt: number;
  readonly status: CaseAnalysisStatus;
  /** When the latest attempt was requested. */
  readonly attemptRequestedAt: Date;
  /** When the latest attempt finished; null while it has not. */
  readonly finishedAt: Date | null;
  /** Why the latest attempt failed; null unless it did. */
  readonly error: { readonly code: string; readonly message: string } | null;
  /** The documents, as validated on the way out; only when COMPLETE. */
  readonly document: z.output<typeof CaseAnalysisDocumentSchema> | null;
  readonly wording: z.output<typeof CaseWordingSchema> | null;
}

export interface CaseAnalysisReadView {
  readonly state: CaseAnalysisReadState;
  readonly reason: string;
  readonly caseId: string;
  /** The hash of the case's input as it is now. */
  readonly currentInputHash: string;
  readonly analysis: CaseAnalysisRecord | null;
}

/** The case holds more records than one analysis reads. */
export class CaseTooLargeError extends AppError {
  readonly code = "CASE_TOO_LARGE";

  constructor(records: number, maxRecords: number) {
    super(
      `The case holds ${String(records)} records; one analysis reads at most ${String(maxRecords)}.`,
    );
    this.name = "CaseTooLargeError";
  }
}

/** Another request recorded this analysis's attempt first. Nothing was written. */
export class CaseAnalysisRequestConflictError extends AppError {
  readonly code = "CASE_ANALYSIS_REQUEST_CONFLICT";

  constructor() {
    super(
      "Another request for this analysis was recorded at the same moment. Nothing was written; send the request again.",
    );
    this.name = "CaseAnalysisRequestConflictError";
  }
}

/**
 * A stored analysis whose attempt is not recorded whole (no request, or a
 * failure with no code). The database writes them together, so a defect.
 */
export class CaseAnalysisUnrecordedError extends AppError {
  readonly code = "CASE_ANALYSIS_UNRECORDED";

  constructor() {
    super("A case analysis's latest attempt is not recorded whole.");
    this.name = "CaseAnalysisUnrecordedError";
  }
}

/** The evidence, claims, entities, relationships and jobs one analysis reads. */
export function recordCount(read: CaseAnalysisInput): number {
  const { input } = read;
  return (
    input.evidence.length +
    input.claims.length +
    input.entities.length +
    input.relationships.length +
    input.jobs.length
  );
}

/**
 * What a read of the case rests on as it is now: its scope, every entity in
 * it with their merge partners, and every run its evidence came from, a
 * PERSON job that found nothing included (D-19). Probed before anything is
 * read into an answer.
 */
export function caseProbe(caseId: string, runIds: readonly string[]): PersonProbe {
  const scope = { caseId };
  return { scope, scopeEntities: { scope, hops: 0 }, runIds };
}

/**
 * The case as it is now and a stored analysis together: the case's probe,
 * and the evidence and runs the analysis's document read when it ran (its
 * basis), however long ago that was (CLAUDE.md §9).
 */
export function analysisProbe(
  caseId: string,
  runIds: readonly string[],
  record: CaseAnalysisRecord | null,
): PersonProbe {
  const basis = record?.document?.basis;
  if (basis === undefined) return caseProbe(caseId, runIds);
  return {
    ...caseProbe(caseId, [...new Set([...runIds, ...basis.runIds])]),
    evidenceIds: basis.evidenceIds,
  };
}

type Context = Pick<TenantContext, "repos" | "reads">;

/** Where a stored analysis stands, from its events. */
export async function analysisRecord(
  context: Context,
  analysis: CaseAnalysis,
): Promise<CaseAnalysisRecord> {
  const events = await context.repos.caseAnalysisEvents.listForAnalysis(analysis.id);
  const latest = events.at(-1);
  if (latest === undefined) throw new CaseAnalysisUnrecordedError();
  const requested = events.find((e) => e.attempt === latest.attempt && e.status === "PENDING");
  if (requested === undefined) throw new CaseAnalysisUnrecordedError();
  const finished = latest.status === "PENDING" ? null : latest;
  return {
    analysis,
    attempt: latest.attempt,
    status: latest.status,
    attemptRequestedAt: requested.occurredAt,
    finishedAt: finished === null ? null : finished.occurredAt,
    error:
      latest.errorCode === null || latest.errorMessage === null
        ? null
        : { code: latest.errorCode, message: latest.errorMessage },
    // Validated on the way out, as on the way in (CLAUDE.md §7).
    document: latest.document === null ? null : CaseAnalysisDocumentSchema.parse(latest.document),
    wording: latest.wording === null ? null : CaseWordingSchema.parse(latest.wording),
  };
}

/** The read state of one analysis against the case's input now. */
export function readView(
  caseId: string,
  currentInputHash: string,
  record: CaseAnalysisRecord | null,
): CaseAnalysisReadView {
  if (record === null) {
    return {
      state: "NONE_YET",
      reason: CASE_ANALYSIS_STATE_REASONS.NONE_YET,
      caseId,
      currentInputHash,
      analysis: null,
    };
  }
  if (record.analysis.inputHash !== currentInputHash) {
    return {
      state: "STALE",
      reason: CASE_ANALYSIS_STATE_REASONS.STALE,
      caseId,
      currentInputHash,
      analysis: record,
    };
  }
  let reason: string;
  if (record.status === "FAILED") {
    if (record.error === null) throw new CaseAnalysisUnrecordedError();
    reason = CASE_ANALYSIS_STATE_REASONS.FAILED.replace("{code}", record.error.code);
  } else {
    reason = CASE_ANALYSIS_STATE_REASONS[record.status];
  }
  return { state: record.status, reason, caseId, currentInputHash, analysis: record };
}

/** The case's input now, its hash, and the runs it rests on. */
export async function currentInput(
  context: Context,
  caseId: string,
  collectors: CaseAnalysisCollectors,
): Promise<{
  readonly read: CaseAnalysisInput;
  readonly inputHash: string;
  readonly runIds: string[];
}> {
  const read = await readCaseAnalysisInput(context.reads, caseId, collectors);
  return {
    read,
    inputHash: caseInputHash(read),
    runIds: read.input.runs.map((run) => run.id),
  };
}

/**
 * The analysis a read of the case shows: the one of the case's input now, else
 * the most recently requested one; null when none was ever requested.
 */
export async function latestAnalysis(
  context: Context,
  caseId: string,
  currentInputHash: string,
): Promise<CaseAnalysis | null> {
  const fresh = await context.repos.caseAnalyses.findForInput(caseId, currentInputHash);
  if (fresh !== null) return fresh;
  const [latest] = await context.repos.caseAnalyses.listForCase(caseId, { limit: 1 });
  return latest ?? null;
}

export interface CaseAnalysisRequest {
  /**
   * CREATED: a new analysis, attempt 1. RETRIED: the analysis had failed; a new
   * attempt. EXISTING: it is pending or complete, returned as it is.
   */
  readonly kind: "CREATED" | "RETRIED" | "EXISTING";
  readonly record: CaseAnalysisRecord;
  readonly currentInputHash: string;
  /** Whether the attempt goes on the queue: a new one, or a pending one whose enqueue may have been lost. */
  readonly enqueue: boolean;
}

/**
 * Requests the analysis of the case as it is now. The caller has already
 * passed the person gate for the case (caseProbe), on the same snapshot.
 */
export async function requestCaseAnalysis(
  context: Context,
  input: {
    readonly caseId: string;
    readonly collectors: CaseAnalysisCollectors;
    readonly requestedByUserId: string | null;
    readonly at: Date;
    readonly maxRecords?: number;
  },
): Promise<CaseAnalysisRequest> {
  const { read, inputHash } = await currentInput(context, input.caseId, input.collectors);
  const maxRecords = input.maxRecords ?? DEFAULT_MAX_CASE_RECORDS;
  const records = recordCount(read);
  if (records > maxRecords) throw new CaseTooLargeError(records, maxRecords);

  const { repos } = context;
  const { analysis, created } = await repos.caseAnalyses.findOrCreate({
    caseId: input.caseId,
    inputHash,
    engineVersion: ENGINE_VERSION,
    requestedByUserId: input.requestedByUserId,
    requestedAt: input.at,
  });
  const requestAttempt = async (attempt: number): Promise<void> => {
    try {
      await repos.caseAnalysisEvents.request({
        analysisId: analysis.id,
        attempt,
        requestedByUserId: input.requestedByUserId,
        at: input.at,
      });
    } catch (error) {
      if (
        error instanceof AppError &&
        (error.code === "UNIQUE_CONFLICT" || error.code === "CASE_ANALYSIS_OUT_OF_ORDER")
      ) {
        throw new CaseAnalysisRequestConflictError();
      }
      throw error;
    }
  };

  if (created) {
    await requestAttempt(1);
    return {
      kind: "CREATED",
      record: await analysisRecord(context, analysis),
      currentInputHash: inputHash,
      enqueue: true,
    };
  }
  const existing = await analysisRecord(context, analysis);
  if (existing.status === "FAILED") {
    await requestAttempt(existing.attempt + 1);
    return {
      kind: "RETRIED",
      record: await analysisRecord(context, analysis),
      currentInputHash: inputHash,
      enqueue: true,
    };
  }
  return {
    kind: "EXISTING",
    record: existing,
    currentInputHash: inputHash,
    enqueue: existing.status === "PENDING",
  };
}

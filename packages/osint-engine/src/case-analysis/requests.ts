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
 *             and document, if it has one, are still shown, as of then.
 * A read of a case shows the analysis of the case as it is now when there is
 * one, else the most recently requested one, as STALE.
 *
 * What an analysis rests on (its basis: the evidence and runs of its input) is
 * recorded with the request, so every read of it, whatever its status, is
 * probed for person data by what it read as well as by the case as it is now
 * (CLAUDE.md section 9: the gate applies however old the data is).
 */
import { byCodeUnit, ENGINE_VERSION } from "@repo/case-engine";
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
  /** STALE, for an analysis whose latest attempt holds no document (PENDING or FAILED). */
  STALE_WITHOUT_DOCUMENT:
    "The case's records, or the analysis code or its wording, have changed since this analysis was requested, and it holds no document. Request a new analysis for the case as it is now.",
} as const satisfies Readonly<Record<CaseAnalysisReadState | "STALE_WITHOUT_DOCUMENT", string>>;

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
 * A stored analysis not recorded whole: an attempt with no request, a failure
 * with no code, or no record of what it rests on (a row written before
 * migration 0023). The application writes them together, so a defect.
 */
export class CaseAnalysisUnrecordedError extends AppError {
  readonly code = "CASE_ANALYSIS_UNRECORDED";

  constructor() {
    super("A case analysis is not recorded whole, so it cannot be read.");
    this.name = "CaseAnalysisUnrecordedError";
  }
}

/**
 * Refuses a case past the size bound, counted in the database before anything
 * is read: the evidence, claims, entities, relationships and jobs an analysis
 * of it would read. Neither a request, a read nor the job loads a case it
 * would refuse.
 */
export async function requireCaseWithinBound(
  context: Pick<TenantContext, "reads">,
  caseId: string,
  maxRecords: number = DEFAULT_MAX_CASE_RECORDS,
): Promise<void> {
  const records = await context.reads.caseScope.count(caseId);
  if (records > maxRecords) throw new CaseTooLargeError(records, maxRecords);
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
 * and the evidence and runs the analysis's input held when it was requested
 * (its basis), whatever its status and however long ago (CLAUDE.md §9). An
 * analysis with no recorded basis is refused as not recorded whole: what it
 * rests on cannot be known, so it is never answered.
 */
export function analysisProbe(
  caseId: string,
  runIds: readonly string[],
  analysis: CaseAnalysis | null,
): PersonProbe {
  if (analysis === null) return caseProbe(caseId, runIds);
  const { basisEvidenceIds, basisRunIds } = analysis;
  if (basisEvidenceIds === null || basisRunIds === null) throw new CaseAnalysisUnrecordedError();
  return {
    ...caseProbe(caseId, [...new Set([...runIds, ...basisRunIds])]),
    evidenceIds: basisEvidenceIds,
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
      reason:
        record.document === null
          ? CASE_ANALYSIS_STATE_REASONS.STALE_WITHOUT_DOCUMENT
          : CASE_ANALYSIS_STATE_REASONS.STALE,
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

/**
 * The case's input now, its hash, and what it rests on (its basis). A case past
 * the size bound is refused (CASE_TOO_LARGE) before anything is read: without
 * its hash, whether an analysis is still current cannot be said.
 */
export async function currentInput(
  context: Context,
  caseId: string,
  collectors: CaseAnalysisCollectors,
  maxRecords: number = DEFAULT_MAX_CASE_RECORDS,
): Promise<{
  readonly read: CaseAnalysisInput;
  readonly inputHash: string;
  readonly runIds: string[];
  readonly basis: { readonly evidenceIds: string[]; readonly runIds: string[] };
}> {
  await requireCaseWithinBound(context, caseId, maxRecords);
  const read = await readCaseAnalysisInput(context.reads, caseId, collectors);
  const runIds = read.input.runs.map((run) => run.id).sort(byCodeUnit);
  return {
    read,
    inputHash: caseInputHash(read),
    runIds,
    basis: {
      evidenceIds: read.input.evidence.map((evidence) => evidence.id).sort(byCodeUnit),
      runIds,
    },
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
 * What a request answers: the analysis of the case as it is now, PENDING or
 * COMPLETE (a failed one was given a new attempt), without its document. The
 * document is read with case:read, never through a request.
 */
export interface CaseAnalysisRequestedView {
  readonly state: "PENDING" | "COMPLETE";
  readonly reason: string;
  readonly caseId: string;
  readonly currentInputHash: string;
  readonly analysis: CaseAnalysisRecord;
}

export function requestedView(requested: CaseAnalysisRequest): CaseAnalysisRequestedView {
  const { record } = requested;
  if (record.status === "FAILED") throw new CaseAnalysisUnrecordedError();
  return {
    state: record.status,
    reason: CASE_ANALYSIS_STATE_REASONS[record.status],
    caseId: record.analysis.caseId,
    currentInputHash: requested.currentInputHash,
    analysis: record,
  };
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
  const { inputHash, basis } = await currentInput(
    context,
    input.caseId,
    input.collectors,
    input.maxRecords,
  );

  const { repos } = context;
  const { analysis, created } = await repos.caseAnalyses.findOrCreate({
    caseId: input.caseId,
    inputHash,
    engineVersion: ENGINE_VERSION,
    requestedByUserId: input.requestedByUserId,
    requestedAt: input.at,
    basis,
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

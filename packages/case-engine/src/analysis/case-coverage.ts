/**
 * A case's coverage: the runs its pinned records came from (owner ruling
 * D-4), each with its coverage recomputed by the run report's own function
 * from what the run recorded (see CaseRunCoverage for how it can differ from a
 * report stored earlier), what of each job's evidence is in the case, the
 * evidence with no recorded collection job, and when the case's evidence was
 * collected and observed.
 *
 * The previous codebase's completeness model (cases/case-report.ts) covered
 * one stored run, recomputed its plan, took a "needs credentials" reason from
 * each collector's declaration and could not tell "found nothing" from
 * "failed". Here every state comes from a recorded outcome, every plan is the
 * one its run recorded, and a case spans as many runs as its evidence came
 * from.
 *
 * Its caveats are codes. Their approved wording is core's CASE_WORDING, which a
 * stored analysis copies (R1-b).
 */
import { ENGINE_VERSION } from "../version.ts";
import { byCodeUnit, type CaseEvidence, type CaseInput } from "./case-input.ts";
import {
  caseView,
  counted,
  type CaseRunCoverage,
  type Counted,
  type EmptyCase,
} from "./case-view.ts";

/** Why a case's coverage is partial. */
export const CASE_PARTIAL_REASONS = [
  /** A run the case's evidence came from did not cover every planned collector, or recorded no plan. */
  "RUN_PARTIAL",
  /** Some of the case's evidence has no recorded collection job, so what else ran beside it is not known. */
  "EVIDENCE_WITH_NO_RECORDED_JOB",
  /** The case holds records but no evidence, so no collection can be named for it. */
  "NO_EVIDENCE_IN_CASE",
] as const;
export type CasePartialReason = (typeof CASE_PARTIAL_REASONS)[number];

/** Standing limits of a case's coverage, stated every time. */
export const CASE_COVERAGE_CAVEATS = [
  /** The coverage reports only what earlier runs collected. Nothing was collected to produce it. */
  "NO_NEW_COLLECTION",
] as const;
export type CaseCoverageCaveat = (typeof CASE_COVERAGE_CAVEATS)[number];

/** When the case's evidence was collected, or observed: never one standing in for the other. */
export interface TimeSpan {
  /** The earliest and latest recorded time; null when no evidence in the case records one. */
  readonly earliest: string | null;
  readonly latest: string | null;
  /** Why earliest and latest are null; null when they are not. */
  readonly reason: "NOT_RECORDED_ON_ANY_EVIDENCE" | "NO_EVIDENCE_IN_CASE" | null;
  /** The evidence that records this time, and the evidence that does not. */
  readonly recorded: Counted;
  readonly notRecorded: Counted;
}

export interface CaseCoverage {
  readonly kind: "CASE_COVERAGE";
  readonly engineVersion: number;
  readonly caseId: string;
  /** True unless every run covered every planned collector and every evidence item has its job. */
  readonly partial: boolean;
  /** Why it is partial, in CASE_PARTIAL_REASONS order; empty when it is not. */
  readonly partialBecause: readonly CasePartialReason[];
  /** The runs whose own coverage is partial. */
  readonly partialRuns: Counted;
  /** The runs the case's evidence came from, by when they started. */
  readonly runs: readonly CaseRunCoverage[];
  /** All evidence in the case. */
  readonly evidence: Counted;
  /** Evidence with no recorded collection job (D-4): counted, never dropped, by collector. */
  readonly evidenceWithNoRecordedJob: {
    readonly evidence: Counted;
    readonly byCollector: readonly {
      readonly collectorId: string;
      readonly sourceLabel: string;
      readonly evidence: Counted;
    }[];
  };
  readonly collectedAt: TimeSpan;
  readonly observedAt: TimeSpan;
  readonly caveats: readonly CaseCoverageCaveat[];
}

function timeSpan(
  evidence: readonly CaseEvidence[],
  timeOf: (evidence: CaseEvidence) => string | null,
): TimeSpan {
  const recorded = evidence.filter((record) => timeOf(record) !== null);
  const times = recorded.flatMap((record) => {
    const time = timeOf(record);
    return time === null ? [] : [time];
  });
  times.sort(byCodeUnit);
  const notRecorded = counted(
    evidence.filter((record) => timeOf(record) === null).map((record) => record.id),
  );
  const earliest = times.at(0);
  const latest = times.at(-1);
  if (earliest === undefined || latest === undefined) {
    return {
      earliest: null,
      latest: null,
      reason: evidence.length === 0 ? "NO_EVIDENCE_IN_CASE" : "NOT_RECORDED_ON_ANY_EVIDENCE",
      recorded: counted([]),
      notRecorded,
    };
  }
  // ISO 8601 instants as `toISOString` writes them (checked on input) order as text.
  return {
    earliest,
    latest,
    reason: null,
    recorded: counted(recorded.map((record) => record.id)),
    notRecorded,
  };
}

/** A case's coverage, or EmptyCase when it holds nothing. */
export function caseCoverage(input: CaseInput): CaseCoverage | EmptyCase {
  const view = caseView(input);
  if ("kind" in view) return view;

  const noJob = input.evidence.filter((evidence) => evidence.jobId === null);
  const byCollector = view.collectors
    .filter((collector) => collector.evidenceWithNoRecordedJob.count > 0)
    .map((collector) => ({
      collectorId: collector.collectorId,
      sourceLabel: collector.sourceLabel,
      evidence: collector.evidenceWithNoRecordedJob,
    }));
  const partialRuns = counted(
    view.runs.filter((run) => run.coverage.partial).map((run) => run.runId),
  );
  const partialBecause = CASE_PARTIAL_REASONS.filter((reason) => {
    switch (reason) {
      case "RUN_PARTIAL":
        return partialRuns.count > 0;
      case "EVIDENCE_WITH_NO_RECORDED_JOB":
        return noJob.length > 0;
      case "NO_EVIDENCE_IN_CASE":
        return input.evidence.length === 0;
    }
  });

  return {
    kind: "CASE_COVERAGE",
    engineVersion: ENGINE_VERSION,
    caseId: view.caseId,
    partial: partialBecause.length > 0,
    partialBecause,
    partialRuns,
    runs: view.runs,
    evidence: counted(input.evidence.map((evidence) => evidence.id)),
    evidenceWithNoRecordedJob: {
      evidence: counted(noJob.map((evidence) => evidence.id)),
      byCollector,
    },
    collectedAt: timeSpan(input.evidence, (evidence) => evidence.collectedAt),
    observedAt: timeSpan(input.evidence, (evidence) => evidence.observedAt),
    caveats: [...CASE_COVERAGE_CAVEATS],
  };
}

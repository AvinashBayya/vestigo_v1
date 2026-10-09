/**
 * A run's coverage, as its report states it: every planned collector's
 * recorded outcome, every exclusion with its reason, every held collector that
 * would have applied, and the standing caveats.
 *
 * Moved unchanged from packages/osint-engine/src/reports/assemble.ts (owner
 * ruling D-1), over plain data instead of the collector registry and database
 * rows, so this package depends only on @repo/core. The golden files in
 * packages/osint-engine/test/golden proved the output identical, byte for
 * byte. Changed once since, as a behaviour change (R1-a rulings, 2026-10-09):
 * a run in which no collector was planned no longer reads "all 0 planned
 * collectors finished".
 *
 * Nothing here is estimated. Coverage is named facts, never a percentage
 * (there is no honest denominator for "every source that exists"). This is
 * the previous codebase's completeness model (cases/case-report.ts), with the
 * two gaps its own caveats admitted closed:
 *   - it could not tell "ran and found nothing" from "failed": it read stored
 *     evidence only. Here each collector's recorded outcome decides its state;
 *   - it recomputed the plan at report time, so the plan could differ from the
 *     run. Here the run's own recorded plan is used.
 * A collector that needed credentials is reported from its recorded outcome,
 * not guessed from whether it declares any.
 */
import type {
  CollectionMode,
  CoverageEntry,
  JobOutcome,
  JobStatus,
  ReportCoverage,
  RunStatus,
  TargetType,
} from "@repo/core";

/** The fixed caveats every report states. */
export const COVERAGE_CAVEATS: readonly string[] = [
  "This is not an exhaustive survey. It covers only the collectors named here, as they answered at the times shown.",
  "Nothing found means the source answered and held nothing for this target when asked. It is not evidence that nothing exists.",
  "A collector that was not run, failed, or was excluded contributed nothing. The absence of a finding from it means nothing.",
  "REPORTED claims are what the cited source stated; DERIVED claims were computed by the platform from recorded values. None has been independently verified.",
  "Sources can change after collection. Each source shows when it was collected.",
];

const PASSIVE_CAVEAT =
  "Collection was passive: every collector read a third party's record or analysed the input, and none contacted the target.";
const ACTIVE_CAVEAT =
  "At least one collector contacted the target directly under a recorded scope authorisation; see the coverage entries.";

/** A registered collector, as coverage reads it: from the registry, never from the collector. */
export interface CoverageCollector {
  readonly id: string;
  /** The registry's label: the only source label coverage ever shows for it. */
  readonly label: string;
  readonly collectionMode: CollectionMode;
}

/** A collector built but held off the platform: it never runs, and coverage says why. */
export interface CoverageHeldCollector {
  readonly id: string;
  readonly displayName: string;
  readonly targetTypes: readonly TargetType[];
  readonly reason: string;
}

/** A collector job, as coverage reads it: what was recorded on it. */
export interface CoverageJob {
  readonly collectorId: string;
  readonly status: JobStatus;
  /** The last attempt's outcome; null until one finished. */
  readonly outcome: JobOutcome | null;
  /** What a NOT_FOUND said was not found. */
  readonly outcomeDetail: string | null;
  readonly targetType: TargetType | null;
  /** Attempts actually made. */
  readonly attempts: number;
  /** The evidence a FOUND result cites; null when none was recorded. */
  readonly evidenceIds: readonly string[] | null;
  readonly lastErrorCode: string | null;
  readonly lastErrorMessage: string | null;
}

/** A collector the run's plan left out, with the reason it recorded. */
export interface CoverageExclusion {
  readonly collectorId: string;
  readonly targetType: TargetType | null;
  readonly reason: string;
  readonly message: string;
}

/** A run's plan, as it was recorded: the plan, the error it recorded instead, or nothing. */
export type CoveragePlan =
  | {
      readonly kind: "PLANNED";
      /** The type of each target the plan accepted as valid, in the plan's order. */
      readonly targetTypes: readonly TargetType[];
      readonly excluded: readonly CoverageExclusion[];
    }
  | { readonly kind: "PLAN_FAILED"; readonly message: string }
  | { readonly kind: "NOT_RECORDED" };

export interface RunCoverageInput {
  readonly registry: readonly CoverageCollector[];
  readonly status: RunStatus;
  readonly plan: CoveragePlan;
  readonly jobs: readonly CoverageJob[];
  readonly held: readonly CoverageHeldCollector[];
}

/**
 * A collector's source label. Labels come only from the registry. A collector
 * no longer registered is named by its id, and says so: nothing stands in for
 * a label.
 */
export function sourceLabelOf(registry: readonly CoverageCollector[], collectorId: string): string {
  const entry = registry.find((candidate) => candidate.id === collectorId);
  return entry !== undefined ? entry.label : `${collectorId} (not in the current registry)`;
}

/** One job's coverage entry, from its recorded status and outcome. */
export function coverageFromJob(job: CoverageJob, label: string): CoverageEntry {
  const base = {
    collectorId: job.collectorId,
    sourceLabel: label,
    targetType: job.targetType,
    attempts: job.attempts,
    // A job that found nothing recorded no evidence: a measured zero.
    evidenceCount: job.evidenceIds === null ? 0 : job.evidenceIds.length,
  };
  const error = { reasonCode: job.lastErrorCode, detail: job.lastErrorMessage };
  switch (job.status) {
    case "SUCCEEDED":
      return job.outcome === "FOUND"
        ? { ...base, state: "COLLECTED", reasonCode: null, detail: null }
        : { ...base, state: "NOTHING_FOUND", reasonCode: null, detail: job.outcomeDetail };
    case "FAILED":
      return {
        ...base,
        state:
          job.outcome === "NEEDS_CREDENTIALS"
            ? "NEEDS_CREDENTIALS"
            : job.outcome === "REFUSED"
              ? "REFUSED"
              : "FAILED",
        ...error,
      };
    case "DEAD_LETTERED":
      return { ...base, state: "FAILED", ...error };
    case "CANCELLED":
      return {
        ...base,
        state: "NOT_FINISHED",
        reasonCode: "CANCELLED",
        detail: "The job was cancelled.",
      };
    case "QUEUED":
    case "RUNNING":
      return { ...base, state: "NOT_FINISHED", reasonCode: job.status, detail: null };
  }
}

/** One sentence stating what the run covered. */
export function coverageHeadline(
  status: RunStatus,
  entries: readonly CoverageEntry[],
  planError: string | null,
): string {
  if (planError !== null) return `FAILED RUN: the run could not be planned (${planError}).`;
  const ran = entries.filter((e) => e.attempts !== null);
  const completed = ran.filter((e) => e.state === "COLLECTED" || e.state === "NOTHING_FOUND");
  const found = ran.filter((e) => e.state === "COLLECTED").length;
  const notRun = entries.filter((e) => e.attempts === null).length;
  const notRunNote =
    notRun === 0
      ? ""
      : ` ${String(notRun)} further collector(s) were excluded or held and did not run.`;
  const counts = `${String(found)} found something, ${String(completed.length - found)} found nothing`;
  switch (status) {
    case "SUCCEEDED":
      // No collector ran: "all 0 planned collectors finished" said nothing true.
      return ran.length === 0
        ? `COMPLETE RUN: no collector was planned to run.${notRunNote}`
        : `COMPLETE RUN: all ${String(ran.length)} planned collectors finished (${counts}).${notRunNote}`;
    case "PARTIAL":
      return `PARTIAL RUN: ${String(ran.length - completed.length)} of ${String(ran.length)} planned collectors did not complete, so this report does not cover what they would have collected (${counts}).${notRunNote}`;
    case "FAILED":
      return `FAILED RUN: none of the ${String(ran.length)} planned collectors completed.${notRunNote}`;
    default:
      return `The run's status is ${status}.`;
  }
}

/**
 * A run's coverage. Its entries are one per job, in the jobs' order, then one
 * per exclusion, in the plan's order, then one per held collector that applies
 * to a valid target type, in the held list's order.
 */
export function runCoverage(input: RunCoverageInput): ReportCoverage {
  const { registry, status, plan, jobs, held } = input;
  const entries: CoverageEntry[] = jobs.map((job) =>
    coverageFromJob(job, sourceLabelOf(registry, job.collectorId)),
  );
  const notApplicable: { collectorId: string; sourceLabel: string }[] = [];
  let planError: string | null = null;
  let validTypes: readonly TargetType[] = [];

  if (plan.kind === "PLAN_FAILED") {
    planError = plan.message;
  } else if (plan.kind === "NOT_RECORDED") {
    planError = "its plan was not recorded";
  } else {
    validTypes = plan.targetTypes;
    for (const excluded of plan.excluded) {
      const label = sourceLabelOf(registry, excluded.collectorId);
      if (excluded.reason === "TARGET_TYPE_NOT_ACCEPTED") {
        notApplicable.push({ collectorId: excluded.collectorId, sourceLabel: label });
        continue;
      }
      entries.push({
        collectorId: excluded.collectorId,
        sourceLabel: label,
        state: "EXCLUDED",
        targetType: excluded.targetType,
        reasonCode: excluded.reason,
        detail: excluded.message,
        evidenceCount: 0,
        attempts: null,
      });
    }
  }
  for (const entry of held) {
    const applies = entry.targetTypes.find((type) => validTypes.includes(type));
    if (applies === undefined) continue;
    entries.push({
      collectorId: entry.id,
      sourceLabel: entry.displayName,
      state: "HELD",
      targetType: applies,
      reasonCode: "COLLECTOR_HELD",
      detail: entry.reason,
      evidenceCount: 0,
      attempts: null,
    });
  }

  const active = jobs.some(
    (job) =>
      registry.find((candidate) => candidate.id === job.collectorId)?.collectionMode === "ACTIVE",
  );
  return {
    runStatus: status,
    partial: status !== "SUCCEEDED" || planError !== null,
    headline: coverageHeadline(status, entries, planError),
    entries,
    notApplicable,
    caveats: [active ? ACTIVE_CAVEAT : PASSIVE_CAVEAT, ...COVERAGE_CAVEATS],
  };
}

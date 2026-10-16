/**
 * A run's progress as the API reports it: the run's state and every job's,
 * read in one tenant transaction. Used by the run endpoint and the progress
 * stream alike, so both tell the same story.
 */
import type { JobOutcome, JobStatus, QuotaPeriod, RunStatus, UsageUnit } from "@repo/core";
import type { Repositories } from "@repo/db";
import { exceededQuota, periodStart } from "./jobs/policy.ts";

export interface JobProgress {
  readonly id: string;
  readonly collectorId: string;
  readonly status: JobStatus;
  readonly outcome: JobOutcome | null;
  /** What a NOT_FOUND said, or what an EMPTY_UNCONFIRMED said came back empty; null otherwise. */
  readonly outcomeDetail: string | null;
  /** Why the last attempt failed; null when it did not. */
  readonly error: { readonly code: string; readonly message: string } | null;
  readonly attempts: number;
  readonly nextAttemptAt: Date | null;
  readonly deadLetteredAt: Date | null;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly fusedAt: Date | null;
  readonly evidenceIds: readonly string[];
}

export interface RunProgress {
  readonly id: string;
  readonly investigationId: string;
  readonly status: RunStatus;
  readonly plan: unknown;
  readonly createdAt: Date;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly jobs: readonly JobProgress[];
  /** Counts by job status: measured, never estimated. */
  readonly counts: Readonly<Record<JobStatus, number>>;
  /** The run has finished and every found result is fused: nothing more will change. */
  readonly settled: boolean;
}

const MAX_JOBS = 1000;
const TERMINAL_RUN: ReadonlySet<RunStatus> = new Set([
  "SUCCEEDED",
  "PARTIAL",
  "FAILED",
  "CANCELLED",
]);

/** The run's progress, or null when the run does not exist in this tenant. */
export async function readRunProgress(
  repos: Repositories,
  runId: string,
): Promise<RunProgress | null> {
  const run = await repos.runs.findById(runId);
  if (run === null) return null;
  const rows = await repos.jobs.listForRun(runId, { limit: MAX_JOBS });
  const counts: Record<JobStatus, number> = {
    QUEUED: 0,
    RUNNING: 0,
    SUCCEEDED: 0,
    FAILED: 0,
    DEAD_LETTERED: 0,
    CANCELLED: 0,
  };
  const jobs = rows.map((job): JobProgress => {
    counts[job.status] += 1;
    return {
      id: job.id,
      collectorId: job.collectorId,
      status: job.status,
      outcome: job.outcome,
      outcomeDetail: job.outcomeDetail,
      error:
        job.lastErrorCode === null || job.lastErrorMessage === null
          ? null
          : { code: job.lastErrorCode, message: job.lastErrorMessage },
      attempts: job.attempts,
      nextAttemptAt: job.nextAttemptAt,
      deadLetteredAt: job.deadLetteredAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      fusedAt: job.fusedAt,
      evidenceIds: job.evidenceIds ?? [],
    };
  });
  return {
    id: run.id,
    investigationId: run.investigationId,
    status: run.status,
    plan: run.plan,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    jobs,
    counts,
    settled:
      TERMINAL_RUN.has(run.status) &&
      jobs.every((job) => job.outcome !== "FOUND" || job.fusedAt !== null),
  };
}

export interface UsageLine {
  readonly unit: UsageUnit;
  readonly period: QuotaPeriod;
  readonly periodStart: Date;
  /** Units recorded since the period began. */
  readonly used: number;
  /** The tenant's limit, or null when it has none for this unit and period. */
  readonly maxQuantity: number | null;
}

/** The tenant's usage of a unit this day and month, beside its quotas. */
export async function usageSummary(
  repos: Repositories,
  unit: UsageUnit,
  now: Date,
): Promise<{ readonly lines: readonly UsageLine[]; readonly exceeded: boolean }> {
  const lines: UsageLine[] = [];
  for (const period of ["DAY", "MONTH"] as const) {
    const start = periodStart(period, now);
    const quota = await repos.tenantQuotas.find(unit, period);
    lines.push({
      unit,
      period,
      periodStart: start,
      used: await repos.usageEvents.totalSince(unit, start),
      maxQuantity: quota === null ? null : quota.maxQuantity,
    });
  }
  return { lines, exceeded: (await exceededQuota(repos, unit, now)) !== null };
}

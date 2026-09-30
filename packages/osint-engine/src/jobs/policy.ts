/**
 * The rules a collector job runs under: its idempotency key, when a quota
 * refuses it, which failures are retried and how long to wait, and which
 * failures count against a source's circuit (CLAUDE.md §5).
 */
import { createHash } from "node:crypto";
import type { CollectionOutcome } from "@repo/collectors";
import type { QuotaPeriod, TargetType, UsageUnit } from "@repo/core";
import type { Repositories } from "@repo/db";

// ── Idempotency ───────────────────────────────────────────────────────────

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, inner]) => [key, canonical(inner)]),
    );
  }
  return value;
}

/**
 * The job's idempotency key: tenant, run, collector, target and parameters,
 * hashed. Everything that makes two jobs the same work is in it, so an
 * enqueue retried or replayed lands on the same row and never runs twice.
 *
 * The run is part of the key. A later run of the same investigation is a
 * deliberate new collection (the data changes; a monitor re-runs a target on
 * purpose), not a retry of the earlier one.
 */
export function jobIdempotencyKey(input: {
  readonly tenantId: string;
  readonly runId: string;
  readonly collectorId: string;
  readonly target: { readonly type: TargetType; readonly value: string };
  readonly params: Readonly<Record<string, unknown>>;
}): string {
  const json = JSON.stringify(
    canonical({
      tenant: input.tenantId,
      run: input.runId,
      collector: input.collectorId,
      target: { type: input.target.type, value: input.target.value },
      params: input.params,
    }),
  );
  return `sha256:${createHash("sha256").update(json).digest("hex")}`;
}

// ── Quotas ────────────────────────────────────────────────────────────────

export interface QuotaExceeded {
  readonly unit: UsageUnit;
  readonly period: QuotaPeriod;
  readonly maxQuantity: number;
  readonly used: number;
}

/** The start of the calendar period containing `now`, in UTC. */
export function periodStart(period: QuotaPeriod, now: Date): Date {
  return period === "DAY"
    ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

const PERIODS: readonly QuotaPeriod[] = ["DAY", "MONTH"];

/**
 * The first quota on `unit` the tenant has used up, or null. Checked before a
 * job is dispatched, so nothing is sent once a quota is spent. A tenant with
 * no quota row for a unit and period has no limit on it until plans set
 * quotas (Phase 7). A job in flight when the limit is reached finishes, so a
 * period can overshoot by at most the requests of the jobs already running.
 */
export async function exceededQuota(
  repos: Repositories,
  unit: UsageUnit,
  now: Date,
): Promise<QuotaExceeded | null> {
  for (const period of PERIODS) {
    const quota = await repos.tenantQuotas.find(unit, period);
    if (quota === null) continue;
    const used = await repos.usageEvents.totalSince(unit, periodStart(period, now));
    if (used >= quota.maxQuantity) {
      return { unit, period, maxQuantity: quota.maxQuantity, used };
    }
  }
  return null;
}

// ── Retries ───────────────────────────────────────────────────────────────

export interface RetryPolicy {
  /** Attempts in all, the first included. The last UNAVAILABLE one dead-letters the job. */
  readonly maxAttempts: number;
  /** The wait before the second attempt; it doubles for each attempt after. */
  readonly baseDelayMs: number;
  /** The longest the backoff alone waits. An upstream's own Retry-After can be longer. */
  readonly maxDelayMs: number;
}

/**
 * Only UNAVAILABLE is retried: a rate limit, a timeout, a 5xx, an unreachable
 * upstream, an open circuit. FAILED, REFUSED and NEEDS_CREDENTIALS are
 * permanent for this job (an auth failure, an invalid target) and fail at once.
 */
export function isRetryable(outcome: CollectionOutcome): boolean {
  return outcome.status === "UNAVAILABLE";
}

/**
 * How long to wait before the next attempt: exponential backoff from the
 * attempt number, but never sooner than the upstream (or the shared limit,
 * or an open circuit) asked. Up to a fifth more is added at random, so jobs
 * that failed together do not all retry in the same instant.
 */
export function retryDelayMs(
  policy: RetryPolicy,
  attempt: number,
  retryAfterMs: number | null,
  random: () => number = Math.random,
): number {
  const exponential = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
  const jittered = Math.round(exponential * (1 + 0.2 * random()));
  // No stated wait: the backoff alone decides.
  return retryAfterMs === null ? jittered : Math.max(jittered, retryAfterMs);
}

// ── Circuits ──────────────────────────────────────────────────────────────

/**
 * Failures that say the source itself is unhealthy. A rate limit is the
 * source working as designed; a refusal, a missing credential or an invalid
 * target says nothing about the source; none of those count.
 */
const SOURCE_FAULTS = new Set([
  "UPSTREAM_UNAVAILABLE",
  "UPSTREAM_TIMEOUT",
  "UPSTREAM_UNREACHABLE",
  "UPSTREAM_RESPONSE_INVALID",
  "COLLECTOR_TIMEOUT",
]);

export type CircuitVerdict = "SUCCESS" | "FAILURE" | "NEUTRAL";

/** What an outcome says about its source's health. */
export function circuitVerdict(outcome: CollectionOutcome): CircuitVerdict {
  if (outcome.status === "FOUND" || outcome.status === "NOT_FOUND") return "SUCCESS";
  if (
    (outcome.status === "UNAVAILABLE" || outcome.status === "FAILED") &&
    SOURCE_FAULTS.has(outcome.error.code)
  ) {
    return "FAILURE";
  }
  return "NEUTRAL";
}

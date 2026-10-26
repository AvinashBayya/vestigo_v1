/**
 * One collector job, start to finish: the unit of work a per-source queue
 * delivers. Queue-agnostic: the BullMQ layer (./queues.ts) calls process()
 * and acts on the disposition it returns.
 *
 * A job runs in three steps, so no transaction is open while a collector
 * waits on the network:
 *   1. Claim, in a tenant transaction with the job row locked. A job already
 *      finished is skipped, so a replayed delivery does nothing. The tenant's
 *      quota is checked here, before anything is sent. The attempt is counted.
 *   2. Outside any transaction: ask the source's circuit, then run the
 *      collector through the executor (licence, plan and vetting, scope and
 *      credentials, all checked again), counting every request it sends.
 *   3. Record, in one tenant transaction with the job row locked again: the
 *      evidence (FOUND only), the attempt's usage, and the job's new state.
 *      They commit together or not at all. A job some other delivery finished
 *      in the meantime is left as it is: nothing is written twice.
 *
 * Retries are by cause (CLAUDE.md §5): only UNAVAILABLE is retried, with
 * backoff; every other outcome is final at once. The last UNAVAILABLE attempt
 * dead-letters the job, where it stays inspectable and replayable.
 */
import type { CollectionOutcome, CollectorRuntime, UsageMeter } from "@repo/collectors";
import { AppError, type JobOutcome, type JobStatus, type TenantId } from "@repo/core";
import type { Database, Job, JobTransition } from "@repo/db";
import type { CollectionExecutor } from "../executor.ts";
import { circuitVerdict, exceededQuota, retryDelayMs, type RetryPolicy } from "./policy.ts";

/** Per-source circuit breaking; RedisCircuitBreaker from @repo/integrations implements it. */
export interface CircuitGate {
  admit(circuit: string): Promise<
    | { readonly allowed: true; readonly probe: boolean }
    | {
        readonly allowed: false;
        readonly status: "OPEN" | "HALF_OPEN";
        readonly retryAfterMs: number;
      }
  >;
  recordSuccess(circuit: string): Promise<void>;
  recordFailure(circuit: string): Promise<unknown>;
}

export type JobDisposition =
  /** The job had already finished (or was cancelled): this delivery did nothing. */
  | { readonly kind: "SKIPPED"; readonly status: JobStatus }
  /** A final outcome was recorded. */
  | {
      readonly kind: "COMPLETED";
      readonly status: "SUCCEEDED" | "FAILED";
      readonly outcome: JobOutcome;
    }
  /** UNAVAILABLE, with attempts left: deliver again after the delay. */
  | { readonly kind: "RETRY"; readonly delayMs: number; readonly errorCode: string }
  /** UNAVAILABLE on the last attempt: recorded as dead-lettered. */
  | { readonly kind: "DEAD_LETTERED"; readonly errorCode: string };

export class JobNotFoundError extends AppError {
  readonly code = "JOB_NOT_FOUND";

  constructor() {
    super("The job does not exist in this tenant.");
    this.name = "JobNotFoundError";
  }
}

export interface ProcessOptions {
  /** This is the queue's last delivery for this enqueue: an UNAVAILABLE outcome dead-letters. */
  readonly finalAttempt: boolean;
}

/** Things worth logging that do not change the job's outcome. */
export interface JobObserver {
  /** The circuit could not record an outcome; the job's own outcome stands. */
  circuitRecordFailed?(sourceId: string, error: unknown): void;
}

const QUOTA_UNIT = "UPSTREAM_REQUEST";

export class CollectorJobProcessor {
  readonly #db: Database;
  readonly #executor: CollectionExecutor;
  readonly #runtime: CollectorRuntime;
  readonly #circuit: CircuitGate | null;
  readonly #retry: RetryPolicy;
  readonly #clock: () => Date;
  readonly #observer: JobObserver;

  constructor(options: {
    readonly db: Database;
    readonly executor: CollectionExecutor;
    readonly runtime: CollectorRuntime;
    /** Null only where no Redis is wired (a unit test); production always passes one. */
    readonly circuit: CircuitGate | null;
    readonly retry: RetryPolicy;
    readonly clock?: () => Date;
    readonly observer?: JobObserver;
  }) {
    this.#db = options.db;
    this.#executor = options.executor;
    this.#runtime = options.runtime;
    this.#circuit = options.circuit;
    this.#retry = options.retry;
    this.#clock = options.clock ?? (() => new Date());
    this.#observer = options.observer ?? {};
  }

  async process(
    tenantId: TenantId,
    jobId: string,
    options: ProcessOptions,
  ): Promise<JobDisposition> {
    const claimed = await this.#claim(tenantId, jobId);
    if ("disposition" in claimed) return claimed.disposition;
    const { job, attempt, target } = claimed;

    const sent = { count: 0 };
    const meter: UsageMeter = {
      requestSent: () => {
        sent.count += 1;
      },
    };
    const outcome = await this.#collect(tenantId, job, target, meter);
    const disposition = this.#decide(outcome, attempt, options);
    return this.#record(tenantId, job, attempt, outcome, disposition, sent.count);
  }

  /**
   * A delivery failed on its last attempt without recording an outcome: the
   * worker crashed, or the database or Redis failed mid-way. The job is
   * dead-lettered, so it is never left looking queued or running. Returns
   * false (and changes nothing) when the job already has a final state.
   */
  async deadLetterUnrecorded(
    tenantId: TenantId,
    jobId: string,
    error: { readonly code: string; readonly message: string },
  ): Promise<boolean> {
    return this.#db.withTenant(tenantId, async ({ repos }) => {
      const job = await repos.jobs.lock(jobId);
      if (job === null) throw new JobNotFoundError();
      if (job.status !== "QUEUED" && job.status !== "RUNNING") return false;
      const now = this.#clock();
      await repos.jobs.transition(job.id, {
        status: "DEAD_LETTERED",
        lastError: error,
        deadLetteredAt: now,
        finishedAt: now,
        nextAttemptAt: null,
        ...(job.startedAt === null ? { startedAt: now } : {}),
      });
      return true;
    });
  }

  async #claim(
    tenantId: TenantId,
    jobId: string,
  ): Promise<
    | { readonly disposition: JobDisposition }
    | {
        readonly job: Job;
        readonly attempt: number;
        readonly target: { readonly type: NonNullable<Job["targetType"]>; readonly value: string };
      }
  > {
    return this.#db.withTenant(tenantId, async ({ repos }) => {
      const job = await repos.jobs.lock(jobId);
      if (job === null) throw new JobNotFoundError();
      if (job.status !== "QUEUED" && job.status !== "RUNNING") {
        return { disposition: { kind: "SKIPPED", status: job.status } };
      }
      const now = this.#clock();
      if (job.targetType === null || job.target === null) {
        await repos.jobs.transition(job.id, {
          status: "FAILED",
          outcome: "FAILED",
          lastError: { code: "JOB_MALFORMED", message: "The job names no target." },
          finishedAt: now,
        });
        return { disposition: { kind: "COMPLETED", status: "FAILED", outcome: "FAILED" } };
      }
      const exceeded = await exceededQuota(repos, QUOTA_UNIT, now);
      if (exceeded !== null) {
        // Refused before dispatch: nothing is sent once a quota is spent.
        await repos.jobs.transition(job.id, {
          status: "FAILED",
          outcome: "REFUSED",
          lastError: {
            code: "QUOTA_EXCEEDED",
            message: `The tenant's ${exceeded.period === "DAY" ? "daily" : "monthly"} quota of ${String(
              exceeded.maxQuantity,
            )} upstream requests is used up (${String(exceeded.used)} used).`,
          },
          finishedAt: now,
          nextAttemptAt: null,
        });
        return { disposition: { kind: "COMPLETED", status: "FAILED", outcome: "REFUSED" } };
      }
      const attempt = job.attempts + 1;
      await repos.jobs.transition(job.id, {
        status: "RUNNING",
        attempts: attempt,
        ...(job.startedAt === null ? { startedAt: now } : {}),
        nextAttemptAt: null,
      });
      return { job, attempt, target: { type: job.targetType, value: job.target } };
    });
  }

  async #collect(
    tenantId: TenantId,
    job: Job,
    target: { readonly type: NonNullable<Job["targetType"]>; readonly value: string },
    meter: UsageMeter,
  ): Promise<CollectionOutcome> {
    const entry = this.#runtime.registry.entry(job.collectorId);
    const sourceId = entry.source.id;
    if (this.#circuit !== null) {
      let admission;
      try {
        admission = await this.#circuit.admit(sourceId);
      } catch (error) {
        // Fails closed: without the breaker's answer, the source is not called.
        return {
          status: "UNAVAILABLE",
          collectorId: entry.id,
          error: {
            code: error instanceof AppError ? error.code : "CIRCUIT_BREAKER_UNAVAILABLE",
            message: "The circuit breaker could not be consulted, so the source was not called.",
          },
          retryAfterMs: null,
        };
      }
      if (!admission.allowed) {
        return {
          status: "UNAVAILABLE",
          collectorId: entry.id,
          error: {
            code: "CIRCUIT_OPEN",
            message: `${entry.source.name} failed repeatedly; calls to it are paused while its circuit is ${
              admission.status === "OPEN" ? "open" : "testing recovery"
            }.`,
          },
          retryAfterMs: admission.retryAfterMs,
        };
      }
    }

    const outcome = await this.#executor.run(tenantId, {
      collectorId: job.collectorId,
      target,
      jobId: job.id,
      requestId: null,
      meter,
    });

    if (this.#circuit !== null) {
      const verdict = circuitVerdict(outcome);
      try {
        if (verdict === "SUCCESS") await this.#circuit.recordSuccess(sourceId);
        if (verdict === "FAILURE") await this.#circuit.recordFailure(sourceId);
      } catch (error) {
        this.#observer.circuitRecordFailed?.(sourceId, error);
      }
    }
    return outcome;
  }

  #decide(outcome: CollectionOutcome, attempt: number, options: ProcessOptions): JobDisposition {
    switch (outcome.status) {
      // The source answered. An unconfirmed empty answer is final too: asking
      // again would not confirm it.
      case "FOUND":
      case "NOT_FOUND":
      case "EMPTY_UNCONFIRMED":
        return { kind: "COMPLETED", status: "SUCCEEDED", outcome: outcome.status };
      case "FAILED":
      case "REFUSED":
      case "NEEDS_CREDENTIALS":
        return { kind: "COMPLETED", status: "FAILED", outcome: outcome.status };
      case "UNAVAILABLE":
        // The only retried outcome (policy.ts isRetryable).
        if (options.finalAttempt) {
          return { kind: "DEAD_LETTERED", errorCode: outcome.error.code };
        }
        return {
          kind: "RETRY",
          delayMs: retryDelayMs(this.#retry, attempt, outcome.retryAfterMs),
          errorCode: outcome.error.code,
        };
    }
  }

  async #record(
    tenantId: TenantId,
    job: Job,
    attempt: number,
    outcome: CollectionOutcome,
    disposition: JobDisposition,
    requestsSent: number,
  ): Promise<JobDisposition> {
    return this.#db.withTenant(tenantId, async (ctx) => {
      const current = await ctx.repos.jobs.lock(job.id);
      if (current === null) throw new JobNotFoundError();
      // Another delivery of this job finished first: write nothing twice.
      if (current.status !== "RUNNING") return { kind: "SKIPPED", status: current.status };

      const now = this.#clock();
      let transition: JobTransition;
      if (outcome.status === "FOUND") {
        const evidenceIds = await this.#executor.persistEvidence(ctx, tenantId, outcome, job.id);
        transition = {
          status: "SUCCEEDED",
          outcome: "FOUND",
          result: outcome.result,
          evidenceIds,
          lastError: null,
          finishedAt: now,
        };
      } else if (outcome.status === "NOT_FOUND" || outcome.status === "EMPTY_UNCONFIRMED") {
        // No evidence either way: absence is not recorded, and an unconfirmed
        // empty answer is not even absence. The detail says which it was.
        transition = {
          status: "SUCCEEDED",
          outcome: outcome.status,
          outcomeDetail: outcome.detail,
          lastError: null,
          finishedAt: now,
        };
      } else {
        const error =
          outcome.status === "REFUSED"
            ? { code: outcome.reason, message: outcome.message }
            : outcome.status === "NEEDS_CREDENTIALS"
              ? {
                  code: "NEEDS_CREDENTIALS",
                  message: `The tenant has no credential for: ${outcome.missing.join(", ")}.`,
                }
              : outcome.error;
        if (disposition.kind === "RETRY") {
          transition = {
            status: "QUEUED",
            outcome: outcome.status,
            lastError: error,
            nextAttemptAt: new Date(now.getTime() + disposition.delayMs),
          };
        } else if (disposition.kind === "DEAD_LETTERED") {
          transition = {
            status: "DEAD_LETTERED",
            outcome: outcome.status,
            lastError: error,
            deadLetteredAt: now,
            finishedAt: now,
          };
        } else {
          transition = {
            status: "FAILED",
            outcome: outcome.status,
            lastError: error,
            finishedAt: now,
          };
        }
      }

      // What this attempt consumed upstream, recorded once for the attempt.
      if (requestsSent > 0) {
        await ctx.repos.usageEvents.recordAttempt({
          unit: QUOTA_UNIT,
          quantity: requestsSent,
          collectorId: job.collectorId,
          jobId: job.id,
          attempt,
        });
      }
      await ctx.repos.jobs.transition(job.id, transition);
      return disposition;
    });
  }
}

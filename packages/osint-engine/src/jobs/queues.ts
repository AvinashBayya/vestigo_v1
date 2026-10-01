/**
 * The BullMQ layer: queues, the flow that fans a run out to per-source
 * collector queues and back in to fusion, the worker pools, retries by
 * cause, and the dead-letter queue (ARCHITECTURE-DECISIONS §6).
 *
 *   investigations    one planning job per run (RunCoordinator.plan). It adds
 *                     the run's flow:
 *   fusion            the flow's parent, one per run. BullMQ holds it until
 *                     every child has finished, succeeded or failed, then it
 *                     fuses what was found (RunFusion.fuseRun).
 *   collect.<source>  one queue per upstream source, holding that source's
 *                     collector jobs (CollectorJobProcessor.process). A slow
 *                     or failing source fills only its own queue: its fixed
 *                     concurrency (the bulkhead) is the most of any worker's
 *                     slots it can ever hold.
 *   reports           one job per requested report (ReportGenerator, Phase 5):
 *                     assembly from a settled run, and a model-written
 *                     synthesis when asked for. Its own bulkhead.
 *   dead-letter       every job that ran out of attempts, as a record to
 *                     inspect and replay. Nothing consumes it.
 *
 * Postgres is the truth for every job's state; BullMQ only delivers work.
 * Messages carry ids, never target values, and are validated on receipt.
 */
import { FlowProducer, Queue, UnrecoverableError, Worker, type Job as BullJob } from "bullmq";
import { AppError, parseTenantId, type TenantId } from "@repo/core";
import type { CollectorRegistry } from "@repo/collectors";
import type { Database } from "@repo/db";
import { z } from "zod";
import type { RunFusion } from "../fusion/fuse.ts";
import { RunNotReadyError, type RunCoordinator } from "../runs.ts";
import type { ReportGenerator } from "../reports/generator.ts";
import type { CollectorJobProcessor } from "./collector-job.ts";
import { retryDelayMs, type RetryPolicy } from "./policy.ts";

// ── Names and messages ────────────────────────────────────────────────────

export const INVESTIGATIONS_QUEUE = "investigations";
export const FUSION_QUEUE = "fusion";
export const DEAD_LETTER_QUEUE = "dead-letter";
export const REPORTS_QUEUE = "reports";

/** The queue for one upstream source's collector jobs. */
export function collectQueueName(sourceId: string): string {
  return `collect.${sourceId}`;
}

const RUN_MESSAGE = z.strictObject({ tenantId: z.uuid(), runId: z.uuid() });
const COLLECT_MESSAGE = z.strictObject({ tenantId: z.uuid(), runId: z.uuid(), jobId: z.uuid() });
const REPORT_MESSAGE = z.strictObject({ tenantId: z.uuid(), reportId: z.uuid() });

export const DEAD_LETTER_MESSAGE = z.strictObject({
  kind: z.enum(["INVESTIGATION", "COLLECT", "FUSION", "REPORT"]),
  tenantId: z.uuid(),
  /** The run, for every kind but REPORT. */
  runId: z.uuid().nullable(),
  /** The collector job, for kind COLLECT. */
  jobId: z.uuid().nullable(),
  /** The report, for kind REPORT. */
  reportId: z.uuid().nullable(),
  queue: z.string(),
  errorCode: z.string(),
});
export type DeadLetter = z.infer<typeof DEAD_LETTER_MESSAGE>;

/** Where the queues live. The prefix separates deployments (and test runs) sharing one Redis. */
export interface QueueConnection {
  readonly url: string;
  readonly prefix: string;
}

function bullConnection(connection: QueueConnection) {
  // BullMQ opens its own connections from these options; a worker's blocking
  // connection needs maxRetriesPerRequest null.
  return { url: connection.url, maxRetriesPerRequest: null, enableOfflineQueue: true };
}

/** Thrown by a processor to have BullMQ deliver the job again after `delayMs`. */
export class JobRetryError extends AppError {
  readonly code = "JOB_RETRY";
  readonly delayMs: number;

  constructor(delayMs: number, cause: string) {
    super(`The job will be retried in ${String(delayMs)} ms (${cause}).`);
    this.name = "JobRetryError";
    this.delayMs = delayMs;
  }
}

/** How BullMQ backs off: the processor's own delay, or exponential backoff for an unexpected error. */
function backoffStrategy(policy: RetryPolicy) {
  return (attemptsMade: number, _type?: string, error?: Error): number =>
    error instanceof JobRetryError ? error.delayMs : retryDelayMs(policy, attemptsMade, null);
}

function deliveryOptions(policy: RetryPolicy) {
  return {
    attempts: policy.maxAttempts,
    backoff: { type: "cause" },
    // Completed deliveries are dropped after a day; failed ones are kept for
    // inspection, alongside their dead-letter record.
    removeOnComplete: { age: 24 * 60 * 60, count: 10_000 },
    removeOnFail: false,
  } as const;
}

// ── Producing ─────────────────────────────────────────────────────────────

/** What the API uses: start a run. It never waits on any collection work. */
export class InvestigationQueue {
  readonly #queue: Queue;
  readonly #retry: RetryPolicy;

  constructor(connection: QueueConnection, retry: RetryPolicy) {
    this.#queue = new Queue(INVESTIGATIONS_QUEUE, {
      connection: bullConnection(connection),
      prefix: connection.prefix,
    });
    this.#retry = retry;
  }

  /** Enqueues the run's planning job; enqueueing the same run twice adds it once. */
  async enqueueRun(tenantId: TenantId, runId: string): Promise<void> {
    await this.#queue.add("plan", RUN_MESSAGE.parse({ tenantId, runId }), {
      ...deliveryOptions(this.#retry),
      jobId: `plan-${runId}`,
    });
  }

  async close(): Promise<void> {
    await this.#queue.close();
  }
}

/** What the API uses to request a report. It never waits on generation. */
export class ReportQueue {
  readonly #queue: Queue;
  readonly #retry: RetryPolicy;

  constructor(connection: QueueConnection, retry: RetryPolicy) {
    this.#queue = new Queue(REPORTS_QUEUE, {
      connection: bullConnection(connection),
      prefix: connection.prefix,
    });
    this.#retry = retry;
  }

  /** Enqueues the report's generation; enqueueing the same report twice adds it once. */
  async enqueueReport(tenantId: TenantId, reportId: string): Promise<void> {
    await this.#queue.add("generate", REPORT_MESSAGE.parse({ tenantId, reportId }), {
      ...deliveryOptions(this.#retry),
      jobId: `report-${reportId}`,
    });
  }

  async close(): Promise<void> {
    await this.#queue.close();
  }
}

/** Adds a run's flow: its collector jobs on their source queues, under one fusion parent. */
async function addRunFlow(
  flows: FlowProducer,
  retry: RetryPolicy,
  input: {
    readonly tenantId: TenantId;
    readonly runId: string;
    readonly jobs: readonly { readonly jobId: string; readonly sourceId: string }[];
    /** Distinguishes a replay's flow from the run's first one; empty for the first. */
    readonly suffix: string;
  },
): Promise<void> {
  const delivery = deliveryOptions(retry);
  await flows.add({
    name: "fuse",
    queueName: FUSION_QUEUE,
    data: RUN_MESSAGE.parse({ tenantId: input.tenantId, runId: input.runId }),
    opts: { ...delivery, jobId: `fuse-${input.runId}${input.suffix}` },
    children: input.jobs.map((job) => ({
      name: "collect",
      queueName: collectQueueName(job.sourceId),
      data: COLLECT_MESSAGE.parse({
        tenantId: input.tenantId,
        runId: input.runId,
        jobId: job.jobId,
      }),
      opts: {
        ...delivery,
        jobId: `job-${job.jobId}${input.suffix}`,
        // A failed collector job never fails the run: fusion still runs, and
        // the run reports it as partial, with the failure shown.
        ignoreDependencyOnFailure: true,
      },
    })),
  });
}

export class JobNotReplayableError extends AppError {
  readonly code = "JOB_NOT_REPLAYABLE";

  constructor(status: string) {
    super(`Only a failed or dead-lettered job can be replayed; this one is ${status}.`);
    this.name = "JobNotReplayableError";
  }
}

/**
 * Replays a failed or dead-lettered job: the same job row, under the same
 * idempotency key, delivered again with a fresh attempt budget, followed by
 * fusion. What the job already recorded is never replaced (the database
 * refuses it), and its usage is recorded per attempt, so a replay never
 * double-charges or duplicates evidence.
 */
export class JobReplayer {
  readonly #db: Database;
  readonly #registry: CollectorRegistry;
  readonly #flows: FlowProducer;
  readonly #retry: RetryPolicy;

  constructor(options: {
    readonly db: Database;
    readonly registry: CollectorRegistry;
    readonly connection: QueueConnection;
    readonly retry: RetryPolicy;
  }) {
    this.#db = options.db;
    this.#registry = options.registry;
    this.#flows = new FlowProducer({
      connection: bullConnection(options.connection),
      prefix: options.connection.prefix,
    });
    this.#retry = options.retry;
  }

  async replay(tenantId: TenantId, jobId: string): Promise<{ readonly runId: string }> {
    const job = await this.#db.withTenant(tenantId, async ({ repos }) => {
      const row = await repos.jobs.lock(jobId);
      if (row === null) return null;
      if (row.status !== "FAILED" && row.status !== "DEAD_LETTERED") {
        throw new JobNotReplayableError(row.status);
      }
      await repos.jobs.transition(row.id, {
        status: "QUEUED",
        finishedAt: null,
        deadLetteredAt: null,
        nextAttemptAt: null,
      });
      const run = await repos.runs.lock(row.runId);
      if (run !== null && run.status !== "RUNNING") {
        await repos.runs.transition(row.runId, { status: "RUNNING", finishedAt: null });
      }
      return row;
    });
    if (job === null) throw new ReplayTargetNotFoundError();
    await addRunFlow(this.#flows, this.#retry, {
      tenantId,
      runId: job.runId,
      jobs: [{ jobId: job.id, sourceId: this.#registry.entry(job.collectorId).source.id }],
      // The attempt count is monotonic, so each replay gets new delivery ids.
      suffix: `-replay-${String(job.attempts)}`,
    });
    return { runId: job.runId };
  }

  async close(): Promise<void> {
    await this.#flows.close();
  }
}

export class ReplayTargetNotFoundError extends AppError {
  readonly code = "JOB_NOT_FOUND";

  constructor() {
    super("The job does not exist in this tenant.");
    this.name = "ReplayTargetNotFoundError";
  }
}

// ── Consuming ─────────────────────────────────────────────────────────────

/**
 * Which queues a pool consumes, from configuration: exact names, "collect.*"
 * for every source queue, or "*" for all. One codebase, deployed as pools.
 */
export function selectQueues(patterns: readonly string[], available: readonly string[]): string[] {
  return available.filter((name) =>
    patterns.some((pattern) =>
      pattern === "*"
        ? true
        : pattern.endsWith(".*")
          ? name.startsWith(pattern.slice(0, -1))
          : pattern === name,
    ),
  );
}

export interface WorkerPoolObserver {
  /** A delivery failed; `final` when BullMQ will not deliver it again. */
  deliveryFailed?(queue: string, final: boolean, error: Error): void;
  /** The pool could not write a dead-letter record or dead-letter a crashed job. */
  deadLetterFailed?(queue: string, error: unknown): void;
}

export interface WorkerPoolOptions {
  readonly connection: QueueConnection;
  /** Queue name patterns this pool consumes (selectQueues). */
  readonly queues: readonly string[];
  /** Every source a registered collector reads: the collect queues that exist. */
  readonly sourceIds: readonly string[];
  readonly coordinator: RunCoordinator;
  readonly processor: CollectorJobProcessor;
  readonly fusion: RunFusion;
  readonly retry: RetryPolicy;
  /** The bulkhead: at most this many of a source's jobs run at once, across every worker. */
  readonly collectConcurrency: (sourceId: string) => number;
  readonly investigationConcurrency: number;
  readonly fusionConcurrency: number;
  /** Report generation; the reports queue is consumed only when this is given. */
  readonly reports?: { readonly generator: ReportGenerator; readonly concurrency: number };
  readonly observer?: WorkerPoolObserver;
}

export interface WorkerPool {
  /** The queues this pool consumes. */
  readonly queues: readonly string[];
  /** Stops taking work, lets running jobs finish, and closes every connection. */
  close(): Promise<void>;
}

/** Starts the workers for the selected queues. */
export async function startWorkerPool(options: WorkerPoolOptions): Promise<WorkerPool> {
  const connection = bullConnection(options.connection);
  const { prefix } = options.connection;
  const collectQueues = new Map(
    options.sourceIds.map((sourceId) => [collectQueueName(sourceId), sourceId]),
  );
  const selected = selectQueues(options.queues, [
    INVESTIGATIONS_QUEUE,
    FUSION_QUEUE,
    ...(options.reports === undefined ? [] : [REPORTS_QUEUE]),
    ...collectQueues.keys(),
  ]);
  const flows = new FlowProducer({ connection, prefix });
  const deadLetters = new Queue(DEAD_LETTER_QUEUE, { connection, prefix });
  const settings = { backoffStrategy: backoffStrategy(options.retry) };
  const observer = options.observer ?? {};

  const recordDeadLetter = async (letter: DeadLetter, deliveryId: string): Promise<void> => {
    await deadLetters.add("dead-letter", DEAD_LETTER_MESSAGE.parse(letter), {
      jobId: `dlq-${deliveryId}`,
      removeOnComplete: false,
      removeOnFail: false,
    });
  };

  const errorCode = (error: Error): string =>
    error instanceof AppError
      ? error.code
      : error instanceof UnrecoverableError
        ? error.message
        : "WORKER_ERROR";

  const onFailed =
    (queue: string, kind: DeadLetter["kind"]) =>
    async (delivery: BullJob | undefined, error: Error): Promise<void> => {
      if (delivery === undefined) return;
      const final = (await delivery.getState()) === "failed";
      observer.deliveryFailed?.(queue, final, error);
      if (!final) return;
      try {
        const code = errorCode(error);
        if (kind === "REPORT") {
          const report = REPORT_MESSAGE.parse(delivery.data);
          // A crash on the last attempt: the report is failed here, never left RUNNING.
          await options.reports?.generator.failUnrecorded(
            parseTenantId(report.tenantId),
            report.reportId,
            { code, message: "The report's last attempt failed without recording an outcome." },
          );
          await recordDeadLetter(
            {
              kind,
              tenantId: report.tenantId,
              runId: null,
              jobId: null,
              reportId: report.reportId,
              queue,
              errorCode: code,
            },
            delivery.id ?? `${queue}-${String(Date.now())}`,
          );
          return;
        }
        const message =
          kind === "COLLECT"
            ? COLLECT_MESSAGE.parse(delivery.data)
            : { ...RUN_MESSAGE.parse(delivery.data), jobId: null };
        if (kind === "COLLECT" && message.jobId !== null) {
          // A crash or an infrastructure failure on the last attempt: the job
          // has no outcome recorded, so it is dead-lettered here.
          await options.processor.deadLetterUnrecorded(
            parseTenantId(message.tenantId),
            message.jobId,
            {
              code,
              message: "The job's last attempt failed without recording an outcome.",
            },
          );
        }
        await recordDeadLetter(
          {
            kind,
            tenantId: message.tenantId,
            runId: message.runId,
            jobId: message.jobId,
            reportId: null,
            queue,
            errorCode: code,
          },
          delivery.id ?? `${queue}-${String(Date.now())}`,
        );
      } catch (deadLetterError) {
        observer.deadLetterFailed?.(queue, deadLetterError);
      }
    };

  const workers: Worker[] = [];
  const start = (
    queue: string,
    kind: DeadLetter["kind"],
    concurrency: number,
    process: (delivery: BullJob) => Promise<unknown>,
  ) => {
    const worker = new Worker(queue, process, { connection, prefix, concurrency, settings });
    worker.on("failed", (delivery, error) => {
      void onFailed(queue, kind)(delivery, error);
    });
    // Connection and processing errors are reported, never thrown out of the pool.
    worker.on("error", (error) => {
      observer.deliveryFailed?.(queue, false, error);
    });
    workers.push(worker);
  };

  for (const queue of selected) {
    if (queue === INVESTIGATIONS_QUEUE) {
      start(queue, "INVESTIGATION", options.investigationConcurrency, async (delivery) => {
        const message = RUN_MESSAGE.safeParse(delivery.data);
        if (!message.success) throw new UnrecoverableError("MESSAGE_INVALID");
        const tenantId = parseTenantId(message.data.tenantId);
        let planned;
        try {
          planned = await options.coordinator.plan(tenantId, message.data.runId);
        } catch (error) {
          // The API enqueues the run in the transaction that creates it, so
          // the planning job can arrive first: retry soon, until it commits.
          if (error instanceof RunNotReadyError) throw new JobRetryError(250, error.code);
          throw error;
        }
        if (planned.jobs.length > 0) {
          await addRunFlow(flows, options.retry, {
            tenantId,
            runId: planned.runId,
            jobs: planned.jobs,
            suffix: "",
          });
        }
        return { jobs: planned.jobs.length };
      });
    } else if (queue === REPORTS_QUEUE && options.reports !== undefined) {
      const { generator, concurrency } = options.reports;
      // Model calls are expensive: the bulkhead holds across every worker.
      const handle = new Queue(queue, { connection, prefix });
      await handle.setGlobalConcurrency(concurrency);
      await handle.close();
      start(queue, "REPORT", concurrency, async (delivery) => {
        const message = REPORT_MESSAGE.safeParse(delivery.data);
        if (!message.success) throw new UnrecoverableError("MESSAGE_INVALID");
        const finalAttempt = delivery.attemptsMade + 1 >= (delivery.opts.attempts ?? 1);
        const disposition = await generator.process(
          parseTenantId(message.data.tenantId),
          message.data.reportId,
          { finalAttempt },
        );
        if (disposition.kind === "RETRY") {
          throw new JobRetryError(disposition.delayMs, disposition.errorCode);
        }
        return { disposition: disposition.kind };
      });
    } else if (queue === FUSION_QUEUE) {
      start(queue, "FUSION", options.fusionConcurrency, async (delivery) => {
        const message = RUN_MESSAGE.safeParse(delivery.data);
        if (!message.success) throw new UnrecoverableError("MESSAGE_INVALID");
        const report = await options.fusion.fuseRun(
          parseTenantId(message.data.tenantId),
          message.data.runId,
        );
        return { status: report.status, fused: report.fusedJobIds.length };
      });
    } else {
      const sourceId = collectQueues.get(queue);
      if (sourceId === undefined) continue;
      const concurrency = options.collectConcurrency(sourceId);
      // The bulkhead holds across every worker process, not just this one.
      const handle = new Queue(queue, { connection, prefix });
      await handle.setGlobalConcurrency(concurrency);
      await handle.close();
      start(queue, "COLLECT", concurrency, async (delivery) => {
        const message = COLLECT_MESSAGE.safeParse(delivery.data);
        if (!message.success) throw new UnrecoverableError("MESSAGE_INVALID");
        const finalAttempt = delivery.attemptsMade + 1 >= (delivery.opts.attempts ?? 1);
        const disposition = await options.processor.process(
          parseTenantId(message.data.tenantId),
          message.data.jobId,
          { finalAttempt },
        );
        if (disposition.kind === "RETRY") {
          throw new JobRetryError(disposition.delayMs, disposition.errorCode);
        }
        if (disposition.kind === "DEAD_LETTERED") {
          // Recorded as dead-lettered already; failing the delivery writes the
          // dead-letter record and lets fusion proceed without it.
          throw new UnrecoverableError(disposition.errorCode);
        }
        return { disposition: disposition.kind };
      });
    }
  }

  return {
    queues: selected,
    async close() {
      await Promise.all(workers.map((worker) => worker.close()));
      await flows.close();
      await deadLetters.close();
    },
  };
}

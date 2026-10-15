/**
 * The investigation step of a run: plan it, and create its collector jobs.
 * Queue-agnostic; the BullMQ layer (./jobs/queues.ts) turns the jobs this
 * returns into per-source queue work and a fusion step that waits for them.
 */
import { tenantRegistration, type CollectorRuntime } from "@repo/collectors";
import { AppError, EmptyTargetError, type TenantId } from "@repo/core";
import { jobIdempotencyKey } from "./jobs/policy.ts";
import { planRun, type RunPlan } from "./planner.ts";
import { PersonTargetOutsidePersonRunError, type Database } from "@repo/db";

export class RunNotReadyError extends AppError {
  readonly code = "RUN_NOT_READY";

  constructor() {
    // Also raised when the run's own transaction has not committed yet; the
    // planning job is retried until it has (or dead-letters if it never does).
    super("The run does not exist in this tenant yet.");
    this.name = "RunNotReadyError";
  }
}

export interface PlannedRun {
  readonly runId: string;
  /** The jobs to dispatch, each with the source whose queue it belongs on. */
  readonly jobs: readonly {
    readonly jobId: string;
    readonly collectorId: string;
    readonly sourceId: string;
  }[];
}

const MAX_JOBS_PER_RUN = 1000;

export class RunCoordinator {
  readonly #db: Database;
  readonly #runtime: CollectorRuntime;
  readonly #clock: () => Date;

  constructor(options: {
    readonly db: Database;
    readonly runtime: CollectorRuntime;
    readonly clock?: () => Date;
  }) {
    this.#db = options.db;
    this.#runtime = options.runtime;
    this.#clock = options.clock ?? (() => new Date());
  }

  /**
   * Plans the run once. A replayed planning step finds the plan recorded and
   * returns the same jobs; nothing is planned or created twice. A run with
   * nothing to dispatch is FAILED at once, with the plan saying why. So is a
   * run whose job the database refuses as a person target outside a
   * person-bearing run, and that refusal is thrown on.
   */
  async plan(tenantId: TenantId, runId: string): Promise<PlannedRun> {
    try {
      return await this.#plan(tenantId, runId);
    } catch (error) {
      if (!(error instanceof PersonTargetOutsidePersonRunError)) throw error;
      // The database refused a job on a person target type (a TOPIC) because
      // the run was not recorded as person-bearing when it was created: a run
      // queued before that record existed. Nothing was created or collected.
      // The run is failed with the reason, in a transaction of its own (the
      // planning one rolled back), and the error goes on: retrying changes
      // nothing, so the planning job is dead-lettered with its code.
      await this.#db.withTenant(tenantId, async ({ repos }) => {
        const run = await repos.runs.lock(runId);
        if (run === null || run.plan !== null) return;
        const now = this.#clock();
        await repos.runs.setPlan(runId, {
          error: {
            code: error.code,
            message:
              "The run plans a job on a target that is person data whatever collects it, but it was not recorded as resting on person data when it was created, so the job was refused and nothing was collected. Start a new run.",
          },
        });
        await repos.runs.transition(runId, { status: "FAILED", startedAt: now, finishedAt: now });
      });
      throw error;
    }
  }

  async #plan(tenantId: TenantId, runId: string): Promise<PlannedRun> {
    return this.#db.withTenant(tenantId, async ({ repos }) => {
      const run = await repos.runs.lock(runId);
      if (run === null) throw new RunNotReadyError();
      const sourceOf = (collectorId: string) => this.#runtime.registry.entry(collectorId).source.id;

      if (run.plan !== null) {
        const existing = await repos.jobs.listForRun(runId, { limit: MAX_JOBS_PER_RUN });
        return {
          runId,
          jobs: existing.map((job) => ({
            jobId: job.id,
            collectorId: job.collectorId,
            sourceId: sourceOf(job.collectorId),
          })),
        };
      }

      const investigation = await repos.investigations.findById(run.investigationId);
      const tenant = await repos.tenants.current();
      if (investigation === null || tenant === null) throw new RunNotReadyError();

      let plan: RunPlan;
      try {
        plan = await planRun(this.#runtime, {
          input: investigation.target,
          requestedType: run.requestedTargetType,
          entitlement: { plan: tenant.plan, vettingStatus: tenant.vettingStatus },
          scopeFor: async (target) => {
            const row = await repos.scopeAuthorisations.findInForce(target.type, target.value);
            return row === null
              ? null
              : { id: row.id, targetType: row.targetType, target: row.target };
          },
        });
      } catch (error) {
        if (!(error instanceof EmptyTargetError)) throw error;
        const now = this.#clock();
        await repos.runs.setPlan(runId, { error: { code: error.code, message: error.message } });
        await repos.runs.transition(runId, { status: "FAILED", startedAt: now, finishedAt: now });
        return { runId, jobs: [] };
      }

      const jobs: PlannedRun["jobs"][number][] = [];
      for (const planned of plan.jobs) {
        // The tenant's copy of the registry row: jobs, evidence and usage reference it.
        await repos.collectorsRegistry.sync(
          tenantRegistration(this.#runtime.registry.entry(planned.collectorId)),
        );
        const params = {};
        const { job } = await repos.jobs.createOrFind({
          runId,
          collectorId: planned.collectorId,
          idempotencyKey: jobIdempotencyKey({
            tenantId,
            runId,
            collectorId: planned.collectorId,
            target: planned.target,
            params,
          }),
          status: "QUEUED",
          targetType: planned.target.type,
          target: planned.target.value,
          params,
        });
        jobs.push({
          jobId: job.id,
          collectorId: job.collectorId,
          sourceId: sourceOf(job.collectorId),
        });
      }

      const now = this.#clock();
      await repos.runs.setPlan(runId, plan);
      await repos.runs.transition(
        runId,
        jobs.length === 0
          ? { status: "FAILED", startedAt: now, finishedAt: now }
          : { status: "RUNNING", startedAt: now },
      );
      return { runId, jobs };
    });
  }
}

/**
 * Fusion: the fan-in step of a run. Turns every FOUND job's recorded result
 * into entities, relationships and claims, and settles the run's status.
 *
 * Idempotent per job. Each job is fused in its own tenant transaction with
 * its row locked, and marked fused in that same transaction (jobs.fused_at,
 * written once), so a replayed fusion fuses nothing twice. A job replayed out
 * of the dead-letter queue later is fused when it succeeds, and the run's
 * status is settled again.
 *
 * Entity resolution happens as entities are written: one entity per kind and
 * normalised identifier, found or created (./identifiers.ts). A person or an
 * organisation without an external identifier is always a new entity.
 *
 * The run's status tells the truth about partial completion: SUCCEEDED only
 * when every job succeeded (FOUND or NOT_FOUND), PARTIAL when some did and
 * some failed, FAILED when none did. A failed job is never smoothed away.
 */
import type { CollectorRegistry } from "@repo/collectors";
import { AppError, type JobStatus, type RunStatus, type TenantId } from "@repo/core";
import type { Database, Job } from "@repo/db";
import { EXTRACTORS, resolveClaims, type Extractor } from "./extractors.ts";

export class FusionError extends AppError {
  readonly code = "FUSION_FAILED";

  constructor(message: string) {
    super(message);
    this.name = "FusionError";
  }
}

export class RunNotFoundError extends AppError {
  readonly code = "RUN_NOT_FOUND";

  constructor() {
    super("The run does not exist in this tenant.");
    this.name = "RunNotFoundError";
  }
}

export interface FusionReport {
  readonly fusedJobIds: readonly string[];
  readonly status: RunStatus;
}

const TERMINAL: ReadonlySet<JobStatus> = new Set([
  "SUCCEEDED",
  "FAILED",
  "DEAD_LETTERED",
  "CANCELLED",
]);

const MAX_JOBS_PER_RUN = 1000;

/** The run's status from its jobs' statuses. */
export function runStatusOf(jobs: readonly Pick<Job, "status">[]): RunStatus {
  if (jobs.some((job) => !TERMINAL.has(job.status))) return "RUNNING";
  const succeeded = jobs.filter((job) => job.status === "SUCCEEDED").length;
  if (jobs.length > 0 && succeeded === jobs.length) return "SUCCEEDED";
  if (succeeded > 0) return "PARTIAL";
  return "FAILED";
}

export class RunFusion {
  readonly #db: Database;
  readonly #registry: CollectorRegistry;
  readonly #extractors: Readonly<Record<string, Extractor>>;
  readonly #clock: () => Date;

  constructor(options: {
    readonly db: Database;
    readonly registry: CollectorRegistry;
    /** Defaults to the platform collectors' extractors. */
    readonly extractors?: Readonly<Record<string, Extractor>>;
    readonly clock?: () => Date;
  }) {
    this.#db = options.db;
    this.#registry = options.registry;
    this.#extractors = options.extractors ?? EXTRACTORS;
    this.#clock = options.clock ?? (() => new Date());
  }

  async fuseRun(tenantId: TenantId, runId: string): Promise<FusionReport> {
    const jobs = await this.#db.withTenant(tenantId, async ({ repos }) => {
      if ((await repos.runs.findById(runId)) === null) throw new RunNotFoundError();
      return repos.jobs.listForRun(runId, { limit: MAX_JOBS_PER_RUN });
    });

    const fusedJobIds: string[] = [];
    for (const job of jobs) {
      if (job.outcome !== "FOUND" || job.fusedAt !== null) continue;
      if (await this.#fuseJob(tenantId, job.id)) fusedJobIds.push(job.id);
    }

    const status = await this.#db.withTenant(tenantId, async ({ repos }) => {
      const run = await repos.runs.lock(runId);
      if (run === null) throw new RunNotFoundError();
      const current = await repos.jobs.listForRun(runId, { limit: MAX_JOBS_PER_RUN });
      const next = runStatusOf(current);
      if (next !== run.status || (next !== "RUNNING" && run.finishedAt === null)) {
        await repos.runs.transition(runId, {
          status: next,
          ...(next === "RUNNING" ? {} : { finishedAt: this.#clock() }),
        });
      }
      return next;
    });
    return { fusedJobIds, status };
  }

  /** Fuses one job, or does nothing if another fusion got there first. */
  async #fuseJob(tenantId: TenantId, jobId: string): Promise<boolean> {
    return this.#db.withTenant(tenantId, async ({ repos }) => {
      const job = await repos.jobs.lock(jobId);
      if (job === null || job.outcome !== "FOUND" || job.fusedAt !== null) return false;
      if (job.targetType === null || job.target === null || job.evidenceIds === null) {
        throw new FusionError("A FOUND job has no target or no evidence to fuse.");
      }
      const extract = this.#extractors[job.collectorId];
      if (extract === undefined) {
        throw new FusionError(`No extractor is registered for collector "${job.collectorId}".`);
      }
      const evidenceStrength = this.#registry.entry(job.collectorId).claimStrength;
      const extraction = extract({
        target: { type: job.targetType, value: job.target },
        result: job.result,
      });

      const entityIds = new Map<string, string>();
      for (const draft of extraction.entities) {
        const entity =
          draft.identifier === null
            ? await repos.entities.create({ kind: draft.kind, displayName: draft.displayName })
            : (
                await repos.entities.resolveByIdentifier({
                  kind: draft.kind,
                  identifier: draft.identifier,
                  displayName: draft.displayName,
                })
              ).entity;
        entityIds.set(draft.key, entity.id);
      }
      const idOf = (key: string): string => {
        const id = entityIds.get(key);
        if (id === undefined) throw new FusionError(`An extraction referred to an unknown entity.`);
        return id;
      };
      const relationshipIds = new Map<string, string>();
      for (const draft of extraction.relationships) {
        const { relationship } = await repos.entityRelationships.resolve({
          sourceEntityId: idOf(draft.from),
          targetEntityId: idOf(draft.to),
          kind: draft.kind,
        });
        relationshipIds.set(draft.key, relationship.id);
      }
      // Values and strengths are read from the result here, never taken from
      // the extractor: a path through `derived` is DERIVED, whatever it says.
      for (const claim of resolveClaims(extraction.claims, job.result, evidenceStrength)) {
        const evidenceId = job.evidenceIds[claim.evidence];
        if (evidenceId === undefined) {
          throw new FusionError("A claim cited evidence the job does not have.");
        }
        let subject: { readonly entityId: string } | { readonly relationshipId: string };
        if ("entity" in claim.subject) {
          subject = { entityId: idOf(claim.subject.entity) };
        } else {
          const relationshipId = relationshipIds.get(claim.subject.relationship);
          if (relationshipId === undefined) {
            throw new FusionError("A claim referred to an unknown relationship.");
          }
          subject = { relationshipId };
        }
        await repos.claims.create({
          evidenceId,
          subject,
          attribute: claim.attribute,
          value: claim.value,
          strength: claim.strength,
        });
      }
      await repos.jobs.transition(job.id, { status: job.status, fusedAt: this.#clock() });
      return true;
    });
  }
}

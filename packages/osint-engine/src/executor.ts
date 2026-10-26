import {
  evidenceDrafts,
  InvalidTargetError,
  parseTarget,
  tenantRegistration,
  type Admission,
  type CollectionOutcome,
  type CollectorRuntime,
  type CollectorSecret,
  type FoundOutcome,
  type UsageMeter,
} from "@repo/collectors";
import { AppError, type TargetType, type TenantId } from "@repo/core";
import type { ContentStore, Database, TenantContext } from "@repo/db";
import type { CredentialSource } from "./credentials.ts";
import { resolveScopeClearance } from "./scope.ts";

export interface CollectionRequest {
  readonly collectorId: string;
  readonly target: { readonly type: TargetType; readonly value: string };
  /** The job this collection belongs to, recorded on its evidence. Null outside a job. */
  readonly jobId: string | null;
  /** The request that caused it, for the audit entries credential reads write. */
  readonly requestId: string | null;
  /** Told of every request the collector sends upstream, for metering. */
  readonly meter?: UsageMeter;
}

/**
 * A collection outside any job: what `collect` takes. A job's collection goes
 * through CollectorJobProcessor, which records the job's result together with
 * the evidence it found, in one transaction.
 */
export type StandaloneCollectionRequest = Omit<CollectionRequest, "jobId"> & {
  readonly jobId: null;
};

/** What a collection did. Evidence ids are present only for FOUND. */
export interface CollectionReport {
  readonly collectorId: string;
  readonly outcome: CollectionOutcome;
  readonly evidenceIds: readonly string[];
}

/**
 * `collect` was given a job. Evidence it wrote would name the job while the
 * job's recorded result did not list it, which case analysis refuses
 * (EVIDENCE_NOT_IN_JOB_RESULT); so it refuses first, before anything runs.
 */
export class CollectionInJobError extends AppError {
  readonly code = "COLLECTION_IN_JOB";

  constructor() {
    super(
      "A collection that belongs to a job runs through the job processor, which records the job's result with its evidence.",
    );
    this.name = "CollectionInJobError";
  }
}

/** The tenant has no row: it was never provisioned. */
export class TenantNotProvisionedError extends AppError {
  readonly code = "TENANT_NOT_PROVISIONED";

  constructor() {
    super("This tenant has not been provisioned.");
    this.name = "TenantNotProvisionedError";
  }
}

type Admitted =
  | { readonly rejected: CollectionOutcome }
  | {
      readonly rejected: null;
      readonly admission: Admission;
      readonly credentials: ReadonlyMap<string, CollectorSecret>;
    };

/**
 * The one path from a collection request to evidence rows. Three short steps,
 * so no database transaction stays open while a collector waits on the network:
 *
 *   1. In a tenant transaction: bring the tenant's registry row up to date
 *      from the platform catalogue, read the tenant's plan and vetting and,
 *      for an ACTIVE collector, the scope authorisation in force for the
 *      exact target; run every admission check; only then read credentials.
 *   2. Outside any transaction: run the collector through the runtime.
 *   3. For FOUND only, in a tenant transaction: store each raw payload by its
 *      hash and write one evidence row per payload, carrying the collector's
 *      id and version, the payload's own URL, observed_at as the upstream gave
 *      it (null when it gave none) and collected_at as the fetcher measured it.
 *
 * No other outcome writes evidence, and the database independently refuses
 * evidence from any collector whose tenant registry row is not enabled.
 */
export class CollectionExecutor {
  readonly #db: Database;
  readonly #runtime: CollectorRuntime;
  readonly #contentStore: ContentStore;
  readonly #credentials: CredentialSource;

  constructor(options: {
    readonly db: Database;
    readonly runtime: CollectorRuntime;
    readonly contentStore: ContentStore;
    readonly credentials: CredentialSource;
  }) {
    this.#db = options.db;
    this.#runtime = options.runtime;
    this.#contentStore = options.contentStore;
    this.#credentials = options.credentials;
  }

  /** Admits, then runs, a collector; writes nothing. The first two of the three steps. */
  async run(tenantId: TenantId, request: CollectionRequest): Promise<CollectionOutcome> {
    const entry = this.#runtime.registry.entry(request.collectorId);
    const admitted = await this.#db.withTenant(tenantId, async (ctx): Promise<Admitted> => {
      await ctx.repos.collectorsRegistry.sync(tenantRegistration(entry));
      const tenant = await ctx.repos.tenants.current();
      if (tenant === null) throw new TenantNotProvisionedError();
      let target;
      try {
        target = parseTarget(request.target.type, request.target.value);
      } catch (error) {
        if (!(error instanceof InvalidTargetError)) throw error;
        return {
          rejected: {
            status: "FAILED",
            collectorId: entry.id,
            error: { code: error.code, message: error.message },
          },
        };
      }
      const scopeAuthorisation =
        entry.collectionMode === "ACTIVE"
          ? await resolveScopeClearance(ctx.repos.scopeAuthorisations, target)
          : null;
      const admission: Admission = {
        target,
        entitlement: { plan: tenant.plan, vettingStatus: tenant.vettingStatus },
        scopeAuthorisation,
      };
      const rejection = this.#runtime.admit(entry.id, admission);
      if (rejection !== null) return { rejected: rejection };
      // Only a keyed access method enabled here reads the vault: a credential
      // for a method that is not is never revealed, nor audited as read.
      const credentials = await this.#credentials.resolve(
        ctx,
        this.#runtime.access(entry.id).vaultIds,
        {
          collectorId: entry.id,
          requestId: request.requestId,
        },
      );
      return { rejected: null, admission, credentials };
    });
    if (admitted.rejected !== null) return admitted.rejected;

    return this.#runtime.execute(entry.id, {
      ...admitted.admission,
      credentials: admitted.credentials,
      ...(request.meter === undefined ? {} : { meter: request.meter }),
    });
  }

  /**
   * The third step: stores each raw payload of a FOUND outcome by its hash and
   * writes one evidence row per payload, inside the caller's tenant
   * transaction, so the evidence commits (or not) with whatever else the
   * caller records there. Returns the evidence ids in the outcome's order.
   */
  async persistEvidence(
    ctx: TenantContext,
    tenantId: TenantId,
    outcome: FoundOutcome,
    jobId: string | null,
  ): Promise<string[]> {
    const entry = this.#runtime.registry.entry(outcome.collectorId);
    const ids: string[] = [];
    for (const draft of evidenceDrafts(entry, outcome)) {
      const stored = await this.#contentStore.put(tenantId, draft.payload);
      const row = await ctx.repos.evidence.record({
        collectorId: draft.collectorId,
        collectorVersion: draft.collectorVersion,
        jobId,
        sourceUrl: draft.sourceUrl,
        contentHash: stored.contentHash,
        payloadRef: stored.ref,
        observedAt: draft.observedAt,
        collectedAt: draft.collectedAt,
        claimStrength: draft.claimStrength,
      });
      ids.push(row.id);
    }
    return ids;
  }

  /**
   * All three steps, for a collection outside any job: admit, run, and for
   * FOUND write the evidence in its own transaction. The evidence names no job,
   * so it is "evidence with no recorded collection job" wherever it is read. A
   * request that names a job is refused before anything runs.
   */
  async collect(
    tenantId: TenantId,
    request: StandaloneCollectionRequest,
  ): Promise<CollectionReport> {
    // The type forbids a job; this holds for a caller that bypassed it.
    if ((request as CollectionRequest).jobId !== null) throw new CollectionInJobError();
    const outcome = await this.run(tenantId, request);
    if (outcome.status !== "FOUND") {
      return { collectorId: outcome.collectorId, outcome, evidenceIds: [] };
    }
    const evidenceIds = await this.#db.withTenant(tenantId, (ctx) =>
      this.persistEvidence(ctx, tenantId, outcome, null),
    );
    return { collectorId: outcome.collectorId, outcome, evidenceIds };
  }
}

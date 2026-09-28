import {
  evidenceDrafts,
  InvalidTargetError,
  parseTarget,
  tenantRegistration,
  type Admission,
  type CollectionOutcome,
  type CollectorRuntime,
  type CollectorSecret,
  type ScopeClearance,
} from "@repo/collectors";
import { AppError, type TargetType, type TenantId } from "@repo/core";
import type { ContentStore, Database } from "@repo/db";
import type { CredentialSource } from "./credentials.ts";

export interface CollectionRequest {
  readonly collectorId: string;
  readonly target: { readonly type: TargetType; readonly value: string };
  /** The job this collection belongs to, recorded on its evidence. Null outside a job. */
  readonly jobId: string | null;
  /** The request that caused it, for the audit entries credential reads write. */
  readonly requestId: string | null;
}

/** What a collection did. Evidence ids are present only for FOUND. */
export interface CollectionReport {
  readonly collectorId: string;
  readonly outcome: CollectionOutcome;
  readonly evidenceIds: readonly string[];
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

  async collect(tenantId: TenantId, request: CollectionRequest): Promise<CollectionReport> {
    const entry = this.#runtime.registry.entry(request.collectorId);
    const report = (outcome: CollectionOutcome, evidenceIds: readonly string[] = []) => ({
      collectorId: entry.id,
      outcome,
      evidenceIds,
    });

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
      let scopeAuthorisation: ScopeClearance | null = null;
      if (entry.collectionMode === "ACTIVE") {
        const row = await ctx.repos.scopeAuthorisations.findInForce(target.type, target.value);
        scopeAuthorisation =
          row === null ? null : { id: row.id, targetType: row.targetType, target: row.target };
      }
      const admission: Admission = {
        target,
        entitlement: { plan: tenant.plan, vettingStatus: tenant.vettingStatus },
        scopeAuthorisation,
      };
      const rejection = this.#runtime.admit(entry.id, admission);
      if (rejection !== null) return { rejected: rejection };
      const credentials = await this.#credentials.resolve(ctx, entry.credentials.vaultIds, {
        collectorId: entry.id,
        requestId: request.requestId,
      });
      return { rejected: null, admission, credentials };
    });
    if (admitted.rejected !== null) return report(admitted.rejected);

    const outcome = await this.#runtime.execute(entry.id, {
      ...admitted.admission,
      credentials: admitted.credentials,
    });
    if (outcome.status !== "FOUND") return report(outcome);

    const drafts = evidenceDrafts(entry, outcome);
    const evidenceIds = await this.#db.withTenant(tenantId, async (ctx) => {
      const ids: string[] = [];
      for (const draft of drafts) {
        const stored = await this.#contentStore.put(tenantId, draft.payload);
        const row = await ctx.repos.evidence.record({
          collectorId: draft.collectorId,
          collectorVersion: draft.collectorVersion,
          jobId: request.jobId,
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
    });
    return report(outcome, evidenceIds);
  }
}

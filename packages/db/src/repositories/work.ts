import type {
  AuditActorKind,
  CollectionMode,
  CollectorDiscipline,
  CommercialUseVerdict,
  JobStatus,
  RunStatus,
} from "@repo/core";
import { and, asc, eq, sql } from "drizzle-orm";
import { auditLog, collectorsRegistry, investigations, jobs, runs } from "../schema/index.ts";
import {
  firstRow,
  limitOf,
  onlyRow,
  requireUuid,
  TenantRepository,
  type ListOptions,
} from "./base.ts";

export type AuditEntry = typeof auditLog.$inferSelect;
export type CollectorRegistration = typeof collectorsRegistry.$inferSelect;
export type Investigation = typeof investigations.$inferSelect;
export type Run = typeof runs.$inferSelect;
export type Job = typeof jobs.$inferSelect;

export type AuditActor =
  | { readonly kind: Extract<AuditActorKind, "USER">; readonly userId: string }
  | { readonly kind: Extract<AuditActorKind, "API_KEY">; readonly apiKeyId: string }
  | { readonly kind: Extract<AuditActorKind, "SYSTEM"> };

export interface NewAuditEntry {
  readonly actor: AuditActor;
  /** Dotted verb, e.g. `investigation.create`. */
  readonly action: string;
  readonly target: { readonly type: string; readonly id: string } | null;
  readonly details: Record<string, unknown> | null;
}

/**
 * Append-only. There is deliberately no update or delete method, and the
 * database refuses both even if one were written (CLAUDE.md §9).
 */
export class AuditLogRepository extends TenantRepository {
  async append(entry: NewAuditEntry): Promise<AuditEntry> {
    const actor = entry.actor;
    return this.run(async (tx) =>
      onlyRow(
        await tx
          .insert(auditLog)
          .values({
            tenantId: this.tenantId,
            actorKind: actor.kind,
            actorUserId: actor.kind === "USER" ? requireUuid(actor.userId) : null,
            actorApiKeyId: actor.kind === "API_KEY" ? requireUuid(actor.apiKeyId) : null,
            action: entry.action,
            targetType: entry.target === null ? null : entry.target.type,
            targetId: entry.target === null ? null : entry.target.id,
            details: entry.details,
          })
          .returning(),
      ),
    );
  }

  async findById(id: string): Promise<AuditEntry | null> {
    return this.run(async (tx) =>
      firstRow(await tx.select().from(auditLog).where(this.owned(auditLog, id))),
    );
  }

  async list(options: ListOptions): Promise<AuditEntry[]> {
    return this.run((tx) =>
      tx
        .select()
        .from(auditLog)
        .where(this.inTenant(auditLog))
        .orderBy(asc(auditLog.recordedAt))
        .limit(limitOf(options)),
    );
  }
}

export interface NewCollectorRegistration {
  readonly collectorId: string;
  readonly sourceLabel: string;
  readonly discipline: CollectorDiscipline;
  readonly collectionMode: CollectionMode;
  readonly dataLicence: string;
  readonly commercialUse: CommercialUseVerdict;
  readonly enabled: boolean;
  /** Required when the collector is disabled. */
  readonly disabledReason: string | null;
}

export class CollectorsRegistryRepository extends TenantRepository {
  async register(input: NewCollectorRegistration): Promise<CollectorRegistration> {
    return this.run(async (tx) =>
      onlyRow(
        await tx
          .insert(collectorsRegistry)
          .values({ tenantId: this.tenantId, ...input })
          .returning(),
      ),
    );
  }

  async find(collectorId: string): Promise<CollectorRegistration | null> {
    return this.run(async (tx) =>
      firstRow(
        await tx
          .select()
          .from(collectorsRegistry)
          .where(
            and(this.inTenant(collectorsRegistry), eq(collectorsRegistry.collectorId, collectorId)),
          ),
      ),
    );
  }

  async list(options: ListOptions): Promise<CollectorRegistration[]> {
    return this.run((tx) =>
      tx
        .select()
        .from(collectorsRegistry)
        .where(this.inTenant(collectorsRegistry))
        .orderBy(asc(collectorsRegistry.collectorId))
        .limit(limitOf(options)),
    );
  }

  /**
   * Enables or disables a collector. The database refuses to enable one whose
   * commercial use is not PERMITTED, and requires a reason to disable.
   */
  async setEnabled(
    collectorId: string,
    state: { readonly enabled: true } | { readonly enabled: false; readonly reason: string },
  ): Promise<CollectorRegistration | null> {
    return this.run(async (tx) =>
      firstRow(
        await tx
          .update(collectorsRegistry)
          .set({ enabled: state.enabled, disabledReason: state.enabled ? null : state.reason })
          .where(
            and(this.inTenant(collectorsRegistry), eq(collectorsRegistry.collectorId, collectorId)),
          )
          .returning(),
      ),
    );
  }
}

export class InvestigationsRepository extends TenantRepository {
  async create(input: {
    readonly title: string;
    readonly target: string;
    readonly createdByUserId: string | null;
  }): Promise<Investigation> {
    return this.run(async (tx) =>
      onlyRow(
        await tx
          .insert(investigations)
          .values({ tenantId: this.tenantId, ...input })
          .returning(),
      ),
    );
  }

  async findById(id: string): Promise<Investigation | null> {
    return this.run(async (tx) =>
      firstRow(await tx.select().from(investigations).where(this.owned(investigations, id))),
    );
  }

  async list(options: ListOptions): Promise<Investigation[]> {
    return this.run((tx) =>
      tx
        .select()
        .from(investigations)
        .where(this.inTenant(investigations))
        .orderBy(asc(investigations.createdAt))
        .limit(limitOf(options)),
    );
  }

  async rename(id: string, title: string): Promise<Investigation | null> {
    return this.run(async (tx) =>
      firstRow(
        await tx
          .update(investigations)
          .set({ title })
          .where(this.owned(investigations, id))
          .returning(),
      ),
    );
  }

  async archive(id: string): Promise<Investigation | null> {
    return this.run(async (tx) =>
      firstRow(
        await tx
          .update(investigations)
          .set({ archivedAt: sql`now()` })
          .where(and(this.owned(investigations, id), sql`${investigations.archivedAt} is null`))
          .returning(),
      ),
    );
  }
}

export interface RunTransition {
  readonly status: RunStatus;
  readonly startedAt?: Date;
  readonly finishedAt?: Date;
}

export class RunsRepository extends TenantRepository {
  async create(input: {
    readonly investigationId: string;
    readonly status: RunStatus;
    readonly requestedByUserId: string | null;
  }): Promise<Run> {
    return this.run(async (tx) =>
      onlyRow(
        await tx
          .insert(runs)
          .values({
            tenantId: this.tenantId,
            investigationId: requireUuid(input.investigationId),
            status: input.status,
            requestedByUserId: input.requestedByUserId,
          })
          .returning(),
      ),
    );
  }

  async findById(id: string): Promise<Run | null> {
    return this.run(async (tx) =>
      firstRow(await tx.select().from(runs).where(this.owned(runs, id))),
    );
  }

  async list(options: ListOptions): Promise<Run[]> {
    return this.run((tx) =>
      tx
        .select()
        .from(runs)
        .where(this.inTenant(runs))
        .orderBy(asc(runs.createdAt))
        .limit(limitOf(options)),
    );
  }

  async transition(id: string, change: RunTransition): Promise<Run | null> {
    return this.run(async (tx) =>
      firstRow(await tx.update(runs).set(change).where(this.owned(runs, id)).returning()),
    );
  }
}

export interface NewJob {
  readonly runId: string;
  readonly collectorId: string;
  /** Derived from tenant, target, collector and parameters (CLAUDE.md §5). */
  readonly idempotencyKey: string;
  readonly status: JobStatus;
}

export interface JobTransition {
  readonly status: JobStatus;
  readonly attempts?: number;
  readonly lastError?: { readonly code: string; readonly message: string } | null;
  readonly startedAt?: Date;
  readonly finishedAt?: Date;
}

export class JobsRepository extends TenantRepository {
  async create(input: NewJob): Promise<Job> {
    return this.run(async (tx) =>
      onlyRow(
        await tx
          .insert(jobs)
          .values({ tenantId: this.tenantId, ...input, runId: requireUuid(input.runId) })
          .returning(),
      ),
    );
  }

  async findById(id: string): Promise<Job | null> {
    return this.run(async (tx) =>
      firstRow(await tx.select().from(jobs).where(this.owned(jobs, id))),
    );
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<Job | null> {
    return this.run(async (tx) =>
      firstRow(
        await tx
          .select()
          .from(jobs)
          .where(and(this.inTenant(jobs), eq(jobs.idempotencyKey, idempotencyKey))),
      ),
    );
  }

  async list(options: ListOptions): Promise<Job[]> {
    return this.run((tx) =>
      tx
        .select()
        .from(jobs)
        .where(this.inTenant(jobs))
        .orderBy(asc(jobs.createdAt))
        .limit(limitOf(options)),
    );
  }

  async transition(id: string, change: JobTransition): Promise<Job | null> {
    const { lastError, ...rest } = change;
    const errorColumns =
      lastError === undefined
        ? {}
        : lastError === null
          ? { lastErrorCode: null, lastErrorMessage: null }
          : { lastErrorCode: lastError.code, lastErrorMessage: lastError.message };
    return this.run(async (tx) =>
      firstRow(
        await tx
          .update(jobs)
          .set({ ...rest, ...errorColumns })
          .where(this.owned(jobs, id))
          .returning(),
      ),
    );
  }
}

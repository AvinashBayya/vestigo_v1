import type { QuotaPeriod, UsageUnit } from "@repo/core";
import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import {
  alerts,
  casePins,
  cases,
  credentials,
  monitors,
  tenantQuotas,
  usageEvents,
  type ModelCallUsage,
} from "../schema/index.ts";
import {
  firstRow,
  limitOf,
  onlyRow,
  requireUuid,
  TenantRepository,
  type ListOptions,
} from "./base.ts";

export type Case = typeof cases.$inferSelect;
export type CasePin = typeof casePins.$inferSelect;
export type Monitor = typeof monitors.$inferSelect;
export type Alert = typeof alerts.$inferSelect;
export type Credential = typeof credentials.$inferSelect;
export type UsageEvent = typeof usageEvents.$inferSelect;
export type { ModelCallUsage };
export type TenantQuota = typeof tenantQuotas.$inferSelect;

export class CasesRepository extends TenantRepository {
  async create(input: {
    readonly title: string;
    readonly description: string | null;
    readonly createdByUserId: string | null;
  }): Promise<Case> {
    return this.run(async (tx) =>
      onlyRow(
        await tx
          .insert(cases)
          .values({ tenantId: this.tenantId, ...input })
          .returning(),
      ),
    );
  }

  async findById(id: string): Promise<Case | null> {
    return this.run(async (tx) =>
      firstRow(await tx.select().from(cases).where(this.owned(cases, id))),
    );
  }

  async list(options: ListOptions): Promise<Case[]> {
    return this.run((tx) =>
      tx
        .select()
        .from(cases)
        .where(this.inTenant(cases))
        .orderBy(asc(cases.createdAt))
        .limit(limitOf(options)),
    );
  }

  async update(
    id: string,
    patch: { readonly title?: string; readonly description?: string | null },
  ): Promise<Case | null> {
    return this.run(async (tx) =>
      firstRow(await tx.update(cases).set(patch).where(this.owned(cases, id)).returning()),
    );
  }

  async archive(id: string): Promise<Case | null> {
    return this.run(async (tx) =>
      firstRow(
        await tx
          .update(cases)
          .set({ archivedAt: sql`now()` })
          .where(and(this.owned(cases, id), sql`${cases.archivedAt} is null`))
          .returning(),
      ),
    );
  }
}

export type PinTarget =
  | { readonly evidenceId: string }
  | { readonly entityId: string }
  | { readonly claimId: string }
  | { readonly relationshipId: string };

/** The column a pin target is stored in, and the id it holds. */
function pinColumn(target: PinTarget) {
  if ("evidenceId" in target) return { column: casePins.evidenceId, id: target.evidenceId };
  if ("entityId" in target) return { column: casePins.entityId, id: target.entityId };
  if ("claimId" in target) return { column: casePins.claimId, id: target.claimId };
  return { column: casePins.relationshipId, id: target.relationshipId };
}

export class CasePinsRepository extends TenantRepository {
  async pin(input: {
    readonly caseId: string;
    readonly target: PinTarget;
    readonly pinnedByUserId: string | null;
    readonly note: string | null;
  }): Promise<CasePin> {
    const target = input.target;
    return this.run(async (tx) =>
      onlyRow(
        await tx
          .insert(casePins)
          .values({
            tenantId: this.tenantId,
            caseId: requireUuid(input.caseId),
            evidenceId: "evidenceId" in target ? requireUuid(target.evidenceId) : null,
            entityId: "entityId" in target ? requireUuid(target.entityId) : null,
            claimId: "claimId" in target ? requireUuid(target.claimId) : null,
            relationshipId: "relationshipId" in target ? requireUuid(target.relationshipId) : null,
            pinnedByUserId: input.pinnedByUserId,
            note: input.note,
          })
          .returning(),
      ),
    );
  }

  async findById(id: string): Promise<CasePin | null> {
    return this.run(async (tx) =>
      firstRow(await tx.select().from(casePins).where(this.owned(casePins, id))),
    );
  }

  /** The pin of exactly this target on this case, or null. */
  async findByTarget(caseId: string, target: PinTarget): Promise<CasePin | null> {
    const { column, id } = pinColumn(target);
    return this.run(async (tx) =>
      firstRow(
        await tx
          .select()
          .from(casePins)
          .where(
            and(
              this.inTenant(casePins),
              eq(casePins.caseId, requireUuid(caseId)),
              eq(column, requireUuid(id)),
            ),
          ),
      ),
    );
  }

  /** How many pins each of these cases has (measured: a case with none is 0). */
  async countsForCases(caseIds: readonly string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>(caseIds.map((id) => [id, 0]));
    if (caseIds.length === 0) return counts;
    if (caseIds.length > 1000) throw new RangeError("at most 1000 case ids at once");
    const rows = await this.run((tx) =>
      tx
        .select({ caseId: casePins.caseId, total: sql<string>`count(*)` })
        .from(casePins)
        .where(and(this.inTenant(casePins), inArray(casePins.caseId, caseIds.map(requireUuid))))
        .groupBy(casePins.caseId),
    );
    for (const row of rows) counts.set(row.caseId, Number(row.total));
    return counts;
  }

  async listForCase(caseId: string): Promise<CasePin[]> {
    return this.run((tx) =>
      tx
        .select()
        .from(casePins)
        .where(and(this.inTenant(casePins), eq(casePins.caseId, requireUuid(caseId))))
        .orderBy(asc(casePins.createdAt)),
    );
  }

  async list(options: ListOptions): Promise<CasePin[]> {
    return this.run((tx) =>
      tx
        .select()
        .from(casePins)
        .where(this.inTenant(casePins))
        .orderBy(asc(casePins.createdAt))
        .limit(limitOf(options)),
    );
  }

  async unpin(id: string): Promise<boolean> {
    return this.run(async (tx) => {
      const rows = await tx
        .delete(casePins)
        .where(this.owned(casePins, id))
        .returning({ id: casePins.id });
      return rows.length === 1;
    });
  }
}

export interface NewMonitor {
  readonly name: string;
  readonly target: string;
  readonly scheduleCron: string;
  readonly enabled: boolean;
  readonly createdByUserId: string | null;
}

export class MonitorsRepository extends TenantRepository {
  async create(input: NewMonitor): Promise<Monitor> {
    return this.run(async (tx) =>
      onlyRow(
        await tx
          .insert(monitors)
          .values({ tenantId: this.tenantId, ...input })
          .returning(),
      ),
    );
  }

  async findById(id: string): Promise<Monitor | null> {
    return this.run(async (tx) =>
      firstRow(await tx.select().from(monitors).where(this.owned(monitors, id))),
    );
  }

  async list(options: ListOptions): Promise<Monitor[]> {
    return this.run((tx) =>
      tx
        .select()
        .from(monitors)
        .where(this.inTenant(monitors))
        .orderBy(asc(monitors.createdAt))
        .limit(limitOf(options)),
    );
  }

  async update(
    id: string,
    patch: Partial<Pick<NewMonitor, "name" | "target" | "scheduleCron" | "enabled">>,
  ): Promise<Monitor | null> {
    return this.run(async (tx) =>
      firstRow(await tx.update(monitors).set(patch).where(this.owned(monitors, id)).returning()),
    );
  }
}

export class AlertsRepository extends TenantRepository {
  async create(input: {
    readonly monitorId: string;
    readonly title: string;
    readonly evidenceId: string | null;
  }): Promise<Alert> {
    return this.run(async (tx) =>
      onlyRow(
        await tx
          .insert(alerts)
          .values({
            tenantId: this.tenantId,
            monitorId: requireUuid(input.monitorId),
            title: input.title,
            evidenceId: input.evidenceId === null ? null : requireUuid(input.evidenceId),
          })
          .returning(),
      ),
    );
  }

  async findById(id: string): Promise<Alert | null> {
    return this.run(async (tx) =>
      firstRow(await tx.select().from(alerts).where(this.owned(alerts, id))),
    );
  }

  async list(options: ListOptions): Promise<Alert[]> {
    return this.run((tx) =>
      tx
        .select()
        .from(alerts)
        .where(this.inTenant(alerts))
        .orderBy(asc(alerts.createdAt))
        .limit(limitOf(options)),
    );
  }

  async acknowledge(id: string, userId: string): Promise<Alert | null> {
    return this.run(async (tx) =>
      firstRow(
        await tx
          .update(alerts)
          .set({ acknowledgedAt: sql`now()`, acknowledgedByUserId: requireUuid(userId) })
          .where(and(this.owned(alerts, id), sql`${alerts.acknowledgedAt} is null`))
          .returning(),
      ),
    );
  }
}

/** Already-encrypted material. This package never sees a plaintext secret. */
export interface NewCredential {
  /** Chosen by the caller: the vault binds the ciphertext to this id. */
  readonly id: string;
  readonly provider: string;
  readonly label: string;
  readonly ciphertext: Uint8Array;
  readonly encryptedDataKey: Uint8Array;
  readonly masterKeyVersion: string;
}

export class CredentialsRepository extends TenantRepository {
  async create(input: NewCredential): Promise<Credential> {
    return this.run(async (tx) =>
      onlyRow(
        await tx
          .insert(credentials)
          .values({ ...input, tenantId: this.tenantId, id: requireUuid(input.id) })
          .returning(),
      ),
    );
  }

  async findById(id: string): Promise<Credential | null> {
    return this.run(async (tx) =>
      firstRow(await tx.select().from(credentials).where(this.owned(credentials, id))),
    );
  }

  async list(options: ListOptions): Promise<Credential[]> {
    return this.run((tx) =>
      tx
        .select()
        .from(credentials)
        .where(this.inTenant(credentials))
        .orderBy(asc(credentials.createdAt))
        .limit(limitOf(options)),
    );
  }

  async relabel(id: string, label: string): Promise<Credential | null> {
    return this.run(async (tx) =>
      firstRow(
        await tx.update(credentials).set({ label }).where(this.owned(credentials, id)).returning(),
      ),
    );
  }

  async revoke(id: string): Promise<Credential | null> {
    return this.run(async (tx) =>
      firstRow(
        await tx
          .update(credentials)
          .set({ revokedAt: sql`now()` })
          .where(and(this.owned(credentials, id), sql`${credentials.revokedAt} is null`))
          .returning(),
      ),
    );
  }

  /** Genuinely removes the credential (CLAUDE.md §9). */
  async delete(id: string): Promise<boolean> {
    return this.run(async (tx) => {
      const rows = await tx
        .delete(credentials)
        .where(this.owned(credentials, id))
        .returning({ id: credentials.id });
      return rows.length === 1;
    });
  }
}

/** Append-only metering. */
export class UsageEventsRepository extends TenantRepository {
  async record(input: {
    readonly unit: UsageUnit;
    readonly quantity: number;
    readonly collectorId: string | null;
    readonly jobId: string | null;
  }): Promise<UsageEvent> {
    if (!Number.isSafeInteger(input.quantity) || input.quantity < 0) {
      throw new RangeError("usage quantity must be a non-negative integer");
    }
    return this.run(async (tx) =>
      onlyRow(
        await tx
          .insert(usageEvents)
          .values({
            tenantId: this.tenantId,
            unit: input.unit,
            quantity: input.quantity,
            collectorId: input.collectorId,
            jobId: input.jobId === null ? null : requireUuid(input.jobId),
          })
          .returning(),
      ),
    );
  }

  /**
   * Records what one attempt of a job consumed, once: a second call for the
   * same job, attempt and unit records nothing and returns false, so a
   * replayed job never charges twice (CLAUDE.md §5).
   */
  async recordAttempt(input: {
    readonly unit: UsageUnit;
    readonly quantity: number;
    readonly collectorId: string;
    readonly jobId: string;
    readonly attempt: number;
  }): Promise<boolean> {
    if (!Number.isSafeInteger(input.quantity) || input.quantity < 0) {
      throw new RangeError("usage quantity must be a non-negative integer");
    }
    if (!Number.isSafeInteger(input.attempt) || input.attempt < 1) {
      throw new RangeError("usage attempt must be a positive integer");
    }
    return this.run(async (tx) => {
      const rows = await tx
        .insert(usageEvents)
        .values({
          tenantId: this.tenantId,
          unit: input.unit,
          quantity: input.quantity,
          collectorId: input.collectorId,
          jobId: requireUuid(input.jobId),
          attempt: input.attempt,
        })
        .onConflictDoNothing({
          target: [usageEvents.tenantId, usageEvents.jobId, usageEvents.attempt, usageEvents.unit],
          where: sql`${usageEvents.jobId} is not null`,
        })
        .returning({ id: usageEvents.id });
      return rows.length === 1;
    });
  }

  /**
   * Records what one attempt at generating a report consumed (model tokens),
   * once: a second call for the same report, attempt and unit records nothing
   * and returns false, so a retried generation never charges twice.
   *
   * `modelCalls` is every model call the attempt made, with the upstream
   * provider that served it (residency: who processed the material) and its
   * share of `quantity`. The shares must add up to the quantity exactly.
   */
  async recordReportAttempt(input: {
    readonly unit: UsageUnit;
    readonly quantity: number;
    readonly reportId: string;
    readonly attempt: number;
    readonly modelCalls: readonly ModelCallUsage[];
  }): Promise<boolean> {
    if (!Number.isSafeInteger(input.quantity) || input.quantity < 0) {
      throw new RangeError("usage quantity must be a non-negative integer");
    }
    if (!Number.isSafeInteger(input.attempt) || input.attempt < 1) {
      throw new RangeError("usage attempt must be a positive integer");
    }
    if (input.modelCalls.length === 0) {
      throw new RangeError("a report attempt's usage must list the model calls it came from");
    }
    let share = 0;
    for (const call of input.modelCalls) {
      if (!Number.isSafeInteger(call.quantity) || call.quantity < 0) {
        throw new RangeError("a model call's quantity must be a non-negative integer");
      }
      if (call.modelId.length === 0 || call.endpointHost.length === 0 || call.servedBy === "") {
        throw new RangeError(
          "a model call names its model and endpoint host, and its provider or null",
        );
      }
      if (call.regionHeaders.some((header) => header.name.length === 0)) {
        throw new RangeError("a model call's region headers are named");
      }
      share += call.quantity;
    }
    if (share !== input.quantity) {
      throw new RangeError("the model calls' quantities must add up to the usage quantity");
    }
    return this.run(async (tx) => {
      const rows = await tx
        .insert(usageEvents)
        .values({
          tenantId: this.tenantId,
          unit: input.unit,
          quantity: input.quantity,
          reportId: requireUuid(input.reportId),
          attempt: input.attempt,
          modelCalls: input.modelCalls.map(
            ({ modelId, endpointHost, servedBy, regionHeaders, quantity }) => ({
              modelId,
              endpointHost,
              servedBy,
              regionHeaders: regionHeaders.map(({ name, value }) => ({ name, value })),
              quantity,
            }),
          ),
        })
        .onConflictDoNothing({
          target: [
            usageEvents.tenantId,
            usageEvents.reportId,
            usageEvents.attempt,
            usageEvents.unit,
          ],
          where: sql`${usageEvents.reportId} is not null`,
        })
        .returning({ id: usageEvents.id });
      return rows.length === 1;
    });
  }

  /** The units of one kind consumed since a moment, by the database's record. */
  async totalSince(unit: UsageUnit, since: Date): Promise<number> {
    return this.run(async (tx) => {
      const [row] = await tx
        .select({ total: sql<string>`coalesce(sum(${usageEvents.quantity}), 0)` })
        .from(usageEvents)
        .where(
          and(
            this.inTenant(usageEvents),
            eq(usageEvents.unit, unit),
            gte(usageEvents.createdAt, since),
          ),
        );
      // A sum over no rows is a measured zero: nothing was consumed.
      return Number(row?.total);
    });
  }

  async findById(id: string): Promise<UsageEvent | null> {
    return this.run(async (tx) =>
      firstRow(await tx.select().from(usageEvents).where(this.owned(usageEvents, id))),
    );
  }

  async list(options: ListOptions): Promise<UsageEvent[]> {
    return this.run((tx) =>
      tx
        .select()
        .from(usageEvents)
        .where(this.inTenant(usageEvents))
        .orderBy(asc(usageEvents.createdAt))
        .limit(limitOf(options)),
    );
  }
}

/** Quotas are set by an operator; the application only reads them. */
export class TenantQuotasRepository extends TenantRepository {
  /** The tenant's limit on a unit over a period, or null when it has none. */
  async find(unit: UsageUnit, period: QuotaPeriod): Promise<TenantQuota | null> {
    return this.run(async (tx) =>
      firstRow(
        await tx
          .select()
          .from(tenantQuotas)
          .where(
            and(
              this.inTenant(tenantQuotas),
              eq(tenantQuotas.unit, unit),
              eq(tenantQuotas.period, period),
            ),
          ),
      ),
    );
  }

  async list(options: ListOptions): Promise<TenantQuota[]> {
    return this.run((tx) =>
      tx
        .select()
        .from(tenantQuotas)
        .where(this.inTenant(tenantQuotas))
        .orderBy(asc(tenantQuotas.unit), asc(tenantQuotas.period))
        .limit(limitOf(options)),
    );
  }
}

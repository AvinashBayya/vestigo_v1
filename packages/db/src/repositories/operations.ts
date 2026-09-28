import type { UsageUnit } from "@repo/core";
import { and, asc, eq, sql } from "drizzle-orm";
import { alerts, casePins, cases, credentials, monitors, usageEvents } from "../schema/index.ts";
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
  { readonly evidenceId: string } | { readonly entityId: string } | { readonly claimId: string };

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

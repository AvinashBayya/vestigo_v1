import type { ReportStatus } from "@repo/core";
import { and, asc, eq } from "drizzle-orm";
import { reports } from "../schema/index.ts";
import {
  firstRow,
  limitOf,
  onlyRow,
  requireUuid,
  TenantRepository,
  type ListOptions,
} from "./base.ts";

export type Report = typeof reports.$inferSelect;

export interface NewReport {
  readonly runId: string;
  readonly includeSynthesis: boolean;
  readonly requestedByUserId: string | null;
}

/**
 * A change to a report's generation state. Only the lifecycle columns can be
 * written; the database refuses to change a document once written, or the
 * status of a finished report (REP01).
 */
export interface ReportTransition {
  readonly status?: ReportStatus;
  readonly attempts?: number;
  readonly document?: unknown;
  readonly error?: { readonly code: string; readonly message: string } | null;
  readonly startedAt?: Date | null;
  readonly finishedAt?: Date | null;
}

export class ReportsRepository extends TenantRepository {
  /** A new report, QUEUED, with no attempts made. */
  async create(input: NewReport): Promise<Report> {
    return this.run(async (tx) =>
      onlyRow(
        await tx
          .insert(reports)
          .values({
            tenantId: this.tenantId,
            runId: requireUuid(input.runId),
            status: "QUEUED",
            includeSynthesis: input.includeSynthesis,
            requestedByUserId:
              input.requestedByUserId === null ? null : requireUuid(input.requestedByUserId),
          })
          .returning(),
      ),
    );
  }

  async findById(id: string): Promise<Report | null> {
    return this.run(async (tx) =>
      firstRow(await tx.select().from(reports).where(this.owned(reports, id))),
    );
  }

  /** The report, locked for update until the transaction ends. Null if it does not exist here. */
  async lock(id: string): Promise<Report | null> {
    return this.run(async (tx) =>
      firstRow(await tx.select().from(reports).where(this.owned(reports, id)).for("update")),
    );
  }

  /** A run's reports, oldest first. */
  async listForRun(runId: string, options: ListOptions): Promise<Report[]> {
    return this.run((tx) =>
      tx
        .select()
        .from(reports)
        .where(and(this.inTenant(reports), eq(reports.runId, requireUuid(runId))))
        .orderBy(asc(reports.createdAt), asc(reports.id))
        .limit(limitOf(options)),
    );
  }

  async list(options: ListOptions): Promise<Report[]> {
    return this.run((tx) =>
      tx
        .select()
        .from(reports)
        .where(this.inTenant(reports))
        .orderBy(asc(reports.createdAt), asc(reports.id))
        .limit(limitOf(options)),
    );
  }

  async transition(id: string, change: ReportTransition): Promise<Report | null> {
    const { error, ...rest } = change;
    const errorColumns =
      error === undefined
        ? {}
        : error === null
          ? { errorCode: null, errorMessage: null }
          : { errorCode: error.code, errorMessage: error.message };
    return this.run(async (tx) =>
      firstRow(
        await tx
          .update(reports)
          .set({ ...rest, ...errorColumns })
          .where(this.owned(reports, id))
          .returning(),
      ),
    );
  }
}

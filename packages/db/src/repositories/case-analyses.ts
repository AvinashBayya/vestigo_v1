import type { CaseAnalysisStatus } from "@repo/core";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { caseAnalyses, caseAnalysisEvents } from "../schema/index.ts";
import {
  firstRow,
  limitOf,
  onlyRow,
  requireUuid,
  TenantRepository,
  type ListOptions,
} from "./base.ts";

export type CaseAnalysis = typeof caseAnalyses.$inferSelect;
export type CaseAnalysisEvent = typeof caseAnalysisEvents.$inferSelect;

export interface NewCaseAnalysis {
  readonly caseId: string;
  readonly inputHash: string;
  readonly engineVersion: number;
  readonly requestedByUserId: string | null;
  readonly requestedAt: Date;
  /** The evidence and runs of the input the hash names: what the analysis rests on. */
  readonly basis: {
    readonly evidenceIds: readonly string[];
    readonly runIds: readonly string[];
  };
}

/**
 * Case analyses (R1-b). One row per case and input hash, written once: the
 * database refuses any change to it, even the schema owner's (CAN01).
 */
export class CaseAnalysesRepository extends TenantRepository {
  /**
   * The analysis of this case for this input, created if there is none: the
   * same input never makes a second analysis, and a concurrent request for it
   * lands on the same row.
   */
  async findOrCreate(
    input: NewCaseAnalysis,
  ): Promise<{ readonly analysis: CaseAnalysis; readonly created: boolean }> {
    return this.run(async (tx) => {
      const caseId = requireUuid(input.caseId);
      const inserted = firstRow(
        await tx
          .insert(caseAnalyses)
          .values({
            tenantId: this.tenantId,
            caseId,
            inputHash: input.inputHash,
            engineVersion: input.engineVersion,
            requestedByUserId:
              input.requestedByUserId === null ? null : requireUuid(input.requestedByUserId),
            requestedAt: input.requestedAt,
            basisEvidenceIds: input.basis.evidenceIds.map(requireUuid),
            basisRunIds: input.basis.runIds.map(requireUuid),
          })
          .onConflictDoNothing({
            target: [caseAnalyses.tenantId, caseAnalyses.caseId, caseAnalyses.inputHash],
          })
          .returning(),
      );
      if (inserted !== null) return { analysis: inserted, created: true };
      const existing = onlyRow(
        await tx
          .select()
          .from(caseAnalyses)
          .where(
            and(
              this.inTenant(caseAnalyses),
              eq(caseAnalyses.caseId, caseId),
              eq(caseAnalyses.inputHash, input.inputHash),
            ),
          ),
      );
      return { analysis: existing, created: false };
    });
  }

  async findById(id: string): Promise<CaseAnalysis | null> {
    return this.run(async (tx) =>
      firstRow(await tx.select().from(caseAnalyses).where(this.owned(caseAnalyses, id))),
    );
  }

  /** The analysis of this case for exactly this input, or null if none was requested. */
  async findForInput(caseId: string, inputHash: string): Promise<CaseAnalysis | null> {
    return this.run(async (tx) =>
      firstRow(
        await tx
          .select()
          .from(caseAnalyses)
          .where(
            and(
              this.inTenant(caseAnalyses),
              eq(caseAnalyses.caseId, requireUuid(caseId)),
              eq(caseAnalyses.inputHash, inputHash),
            ),
          ),
      ),
    );
  }

  /** A case's analyses, most recently requested first. */
  async listForCase(caseId: string, options: ListOptions): Promise<CaseAnalysis[]> {
    return this.run((tx) =>
      tx
        .select()
        .from(caseAnalyses)
        .where(and(this.inTenant(caseAnalyses), eq(caseAnalyses.caseId, requireUuid(caseId))))
        .orderBy(desc(caseAnalyses.requestedAt), desc(caseAnalyses.id))
        .limit(limitOf(options)),
    );
  }

  async list(options: ListOptions): Promise<CaseAnalysis[]> {
    return this.run((tx) =>
      tx
        .select()
        .from(caseAnalyses)
        .where(this.inTenant(caseAnalyses))
        .orderBy(asc(caseAnalyses.requestedAt), asc(caseAnalyses.id))
        .limit(limitOf(options)),
    );
  }
}

/** Where an analysis stands: its latest attempt, and that attempt's latest event. */
export interface CaseAnalysisStanding {
  readonly attempt: number;
  readonly status: CaseAnalysisStatus;
  /** The event that says so: the finish when there is one, else the request. */
  readonly event: CaseAnalysisEvent;
}

/**
 * Where each case analysis stands, as rows added and never rewritten (CAN01).
 * The database also refuses an event out of order (CAN02): a finish with no
 * request, a retry before a failure, or anything after a document.
 */
export class CaseAnalysisEventsRepository extends TenantRepository {
  /** An attempt requested: PENDING until it finishes. */
  async request(input: {
    readonly analysisId: string;
    readonly attempt: number;
    readonly requestedByUserId: string | null;
    readonly at: Date;
  }): Promise<CaseAnalysisEvent> {
    return this.insert({
      analysisId: input.analysisId,
      attempt: input.attempt,
      status: "PENDING",
      requestedByUserId:
        input.requestedByUserId === null ? null : requireUuid(input.requestedByUserId),
      occurredAt: input.at,
    });
  }

  /** An attempt finished with its document and the wording it was produced under. */
  async complete(input: {
    readonly analysisId: string;
    readonly attempt: number;
    readonly document: unknown;
    readonly wording: unknown;
    readonly at: Date;
  }): Promise<CaseAnalysisEvent> {
    return this.insert({
      analysisId: input.analysisId,
      attempt: input.attempt,
      status: "COMPLETE",
      document: input.document,
      wording: input.wording,
      occurredAt: input.at,
    });
  }

  /** An attempt finished without a document, for a coded reason. */
  async fail(input: {
    readonly analysisId: string;
    readonly attempt: number;
    readonly error: { readonly code: string; readonly message: string };
    readonly at: Date;
  }): Promise<CaseAnalysisEvent> {
    return this.insert({
      analysisId: input.analysisId,
      attempt: input.attempt,
      status: "FAILED",
      errorCode: input.error.code,
      errorMessage: input.error.message,
      occurredAt: input.at,
    });
  }

  /** An analysis's events, in order: by attempt, each request before its finish. */
  async listForAnalysis(analysisId: string): Promise<CaseAnalysisEvent[]> {
    return this.run((tx) =>
      tx
        .select()
        .from(caseAnalysisEvents)
        .where(
          and(
            this.inTenant(caseAnalysisEvents),
            eq(caseAnalysisEvents.analysisId, requireUuid(analysisId)),
          ),
        )
        .orderBy(
          asc(caseAnalysisEvents.attempt),
          asc(sql`${caseAnalysisEvents.status} <> 'PENDING'`),
          asc(caseAnalysisEvents.id),
        ),
    );
  }

  /** Where an analysis stands now; null when it has no event (which a request never leaves). */
  async standing(analysisId: string): Promise<CaseAnalysisStanding | null> {
    const events = await this.listForAnalysis(analysisId);
    const event = events.at(-1);
    return event === undefined ? null : { attempt: event.attempt, status: event.status, event };
  }

  async list(options: ListOptions): Promise<CaseAnalysisEvent[]> {
    return this.run((tx) =>
      tx
        .select()
        .from(caseAnalysisEvents)
        .where(this.inTenant(caseAnalysisEvents))
        .orderBy(asc(caseAnalysisEvents.occurredAt), asc(caseAnalysisEvents.id))
        .limit(limitOf(options)),
    );
  }

  private async insert(
    values: Omit<typeof caseAnalysisEvents.$inferInsert, "tenantId">,
  ): Promise<CaseAnalysisEvent> {
    return this.run(async (tx) =>
      onlyRow(
        await tx
          .insert(caseAnalysisEvents)
          .values({
            ...values,
            tenantId: this.tenantId,
            analysisId: requireUuid(values.analysisId),
          })
          .returning(),
      ),
    );
  }
}

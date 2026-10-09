/**
 * The case analysis job (R1-b): one attempt at one case analysis, from the
 * request recorded by the API to one finishing event, COMPLETE with the
 * documents or FAILED with a coded reason. Never a partial document.
 *
 * Passive only (standing rule 9): it reads stored records and computes; it
 * sends nothing to a target or a source. Its module graph reaches no network
 * client (test/case-analysis-graph.test.ts): the database is passed in, and
 * the registry and the held collectors reach it as plain data.
 *
 * One attempt:
 *   1. claim: the analysis and its attempt exist, and the attempt has not
 *      finished (a replayed or duplicate delivery is SKIPPED, never a second
 *      write);
 *   2. on one snapshot (D-32): the person gate re-checked before anything is
 *      read into the analysis (D-28, the shared personGate), then the case's
 *      input read and hashed. A refusal fails the attempt with the gate's code;
 *      input that is not the input this analysis was requested for fails it as
 *      CASE_INPUT_CHANGED, so a stored document always matches its hash;
 *   3. outside any transaction: case-engine computes the documents. Input
 *      that contradicts itself is refused whole (CASE_INPUT_INVALID, every
 *      problem named); a case past the size bound is refused (CASE_TOO_LARGE);
 *   4. record: the finishing event, written once; a delivery that loses the
 *      race to another records nothing.
 * Steps 1 to 3 run under the per-job timeout (CASE_ANALYSIS_TIMEOUT). The
 * engine is synchronous, so the size bound is what keeps step 3 short.
 */
import { personGate } from "@repo/access";
import {
  caseBreakdown,
  caseCollectors,
  caseCoverage,
  CaseInputError,
  ENGINE_VERSION,
  type CaseBreakdown,
  type CaseCollectors,
  type CaseCoverage,
  type EmptyCase,
} from "@repo/case-engine";
import { AppError, CASE_WORDING, type CaseAnalysisStatus, type TenantId } from "@repo/core";
import type { CaseAnalysis, Database, TenantContext } from "@repo/db";
import type { CaseAnalysisCollectors } from "../case-analysis/collectors.ts";
import {
  caseInputHash,
  readCaseAnalysisInput,
  type CaseAnalysisInput,
} from "../case-analysis/input.ts";

/** What a stored case analysis holds: case-engine's three documents for one input. */
export interface CaseAnalysisDocument {
  readonly formatVersion: 1;
  readonly engineVersion: number;
  readonly caseId: string;
  readonly inputHash: string;
  readonly coverage: CaseCoverage | EmptyCase;
  readonly collectors: CaseCollectors | EmptyCase;
  readonly breakdown: CaseBreakdown | EmptyCase;
}

export type CaseAnalysisDisposition =
  | {
      /** Nothing done: the attempt had already finished, or was superseded. */
      readonly kind: "SKIPPED";
      readonly status: CaseAnalysisStatus | null;
    }
  | { readonly kind: "COMPLETED"; readonly status: "COMPLETE"; readonly errorCode: null }
  | {
      readonly kind: "COMPLETED";
      readonly status: "FAILED";
      /** The coded reason the attempt failed for. */
      readonly errorCode: string;
    };

/** The analysis, or its attempt, is not recorded in this tenant (yet). Retried. */
export class CaseAnalysisNotFoundError extends AppError {
  readonly code = "CASE_ANALYSIS_NOT_FOUND";

  constructor() {
    super("The case analysis, or this attempt at it, is not recorded in this tenant.");
    this.name = "CaseAnalysisNotFoundError";
  }
}

/** The most records one analysis reads by default: a bound on synchronous work. */
export const DEFAULT_MAX_CASE_RECORDS = 50_000;

export interface CaseAnalysisProcessorOptions {
  readonly db: Database;
  /** The registry and the held collectors, as plain data (caseAnalysisCollectors). */
  readonly collectors: CaseAnalysisCollectors;
  /**
   * How long steps 1 to 3 may wait before the attempt fails as
   * CASE_ANALYSIS_TIMEOUT. It cuts off a read that hangs; the synchronous
   * computation cannot be interrupted, which maxRecords bounds instead.
   */
  readonly timeoutMs: number;
  /** The most evidence, claims, entities, relationships and jobs one analysis reads. */
  readonly maxRecords?: number;
  /** The clock finishing events are stamped with. */
  readonly now?: () => Date;
  /** How the input is read; the stored rows, unless a test reads otherwise. */
  readonly readInput?: (
    reads: TenantContext["reads"],
    caseId: string,
    collectors: CaseAnalysisCollectors,
  ) => Promise<CaseAnalysisInput>;
}

type Outcome =
  | { readonly document: CaseAnalysisDocument }
  | { readonly failure: { readonly code: string; readonly message: string } };

const failed = (code: string, message: string): Outcome => ({ failure: { code, message } });

/** The per-job timeout ran out first. */
class Timeout {
  readonly ms: number;

  constructor(ms: number) {
    this.ms = ms;
  }
}

export class CaseAnalysisProcessor {
  readonly #options: CaseAnalysisProcessorOptions;

  constructor(options: CaseAnalysisProcessorOptions) {
    this.#options = options;
  }

  /** One attempt at one analysis. Never throws for a coded failure: it records it. */
  async process(
    tenantId: TenantId,
    analysisId: string,
    attempt: number,
  ): Promise<CaseAnalysisDisposition> {
    const { db } = this.#options;
    const claimed = await db.withTenant(tenantId, async ({ repos }) => {
      const analysis = await repos.caseAnalyses.findById(analysisId);
      if (analysis === null) throw new CaseAnalysisNotFoundError();
      const events = await repos.caseAnalysisEvents.listForAnalysis(analysisId);
      const requested = events.some((e) => e.attempt === attempt && e.status === "PENDING");
      if (!requested) throw new CaseAnalysisNotFoundError();
      const finish = events.find((e) => e.attempt === attempt && e.status !== "PENDING");
      if (finish !== undefined) return { skipped: finish.status } as const;
      // A later attempt was requested: this one is no longer the analysis's.
      if (events.some((e) => e.attempt > attempt)) return { skipped: null } as const;
      return { analysis } as const;
    });
    if ("skipped" in claimed) return { kind: "SKIPPED", status: claimed.skipped };

    const outcome = await this.#withinTimeout(() => this.#analyse(tenantId, claimed.analysis));
    return this.#record(tenantId, analysisId, attempt, outcome);
  }

  /**
   * Fails an attempt that crashed without recording an outcome, as the
   * dead-letter queue's last step; leaves a finished attempt alone.
   */
  async failUnrecorded(
    tenantId: TenantId,
    analysisId: string,
    attempt: number,
    error: { readonly code: string; readonly message: string },
  ): Promise<void> {
    try {
      await this.#record(tenantId, analysisId, attempt, { failure: error });
    } catch (recordError) {
      // An analysis that was never recorded has no attempt to fail.
      if (recordError instanceof AppError && recordError.code === "REFERENCE_NOT_FOUND") return;
      throw recordError;
    }
  }

  async #withinTimeout(work: () => Promise<Outcome>): Promise<Outcome> {
    const { timeoutMs } = this.#options;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<Timeout>((resolve) => {
      timer = setTimeout(() => {
        resolve(new Timeout(timeoutMs));
      }, timeoutMs);
    });
    try {
      const result = await Promise.race([work(), expired]);
      return result instanceof Timeout
        ? failed(
            "CASE_ANALYSIS_TIMEOUT",
            `The analysis did not finish within ${String(result.ms)} ms.`,
          )
        : result;
    } finally {
      clearTimeout(timer);
    }
  }

  async #analyse(tenantId: TenantId, analysis: CaseAnalysis): Promise<Outcome> {
    const { db, collectors } = this.#options;
    const readInput = this.#options.readInput ?? readCaseAnalysisInput;
    const maxRecords = this.#options.maxRecords ?? DEFAULT_MAX_CASE_RECORDS;
    // The gate and the read on one snapshot (D-32), the gate first (D-28).
    const gated = await db.withTenant(
      tenantId,
      async ({ repos, reads }) => {
        const tenant = await repos.tenants.current();
        if (tenant === null)
          return { refused: failed("TENANT_NOT_PROVISIONED", "The tenant has no row.") };
        const scope = { caseId: analysis.caseId };
        // The case's scope, its entities with their merge partners, and every run
        // its evidence came from, a PERSON job that found nothing included (D-19).
        const lock = await personGate(tenant, async () =>
          reads.exploration.restsOnPersonData({
            scope,
            scopeEntities: { scope, hops: 0 },
            runIds: await reads.caseScope.runIds(analysis.caseId),
          }),
        );
        if (lock !== null) {
          return {
            refused: failed(
              lock.reason,
              "The case rests on person-investigation data this organisation cannot currently access; nothing was read into the analysis.",
            ),
          };
        }
        return { read: await readInput(reads, analysis.caseId, collectors) };
      },
      { snapshot: true },
    );
    if ("refused" in gated) return gated.refused;
    const { read } = gated;

    if (caseInputHash(read) !== analysis.inputHash) {
      return failed(
        "CASE_INPUT_CHANGED",
        "The records behind the case changed after the analysis was requested; request it again for the case as it is now.",
      );
    }
    const records =
      read.input.evidence.length +
      read.input.claims.length +
      read.input.entities.length +
      read.input.relationships.length +
      read.input.jobs.length;
    if (records > maxRecords) {
      return failed(
        "CASE_TOO_LARGE",
        `The case holds ${String(records)} records; one analysis reads at most ${String(maxRecords)}.`,
      );
    }
    try {
      return {
        document: {
          formatVersion: 1,
          engineVersion: ENGINE_VERSION,
          caseId: analysis.caseId,
          inputHash: analysis.inputHash,
          coverage: caseCoverage(read.input),
          collectors: caseCollectors(read.input),
          breakdown: caseBreakdown(read.input),
        },
      };
    } catch (error) {
      if (!(error instanceof CaseInputError)) throw error;
      return failed(error.code, error.message);
    }
  }

  async #record(
    tenantId: TenantId,
    analysisId: string,
    attempt: number,
    outcome: Outcome,
  ): Promise<CaseAnalysisDisposition> {
    const now = this.#options.now ?? (() => new Date());
    try {
      await this.#options.db.withTenant(tenantId, async ({ repos }) => {
        if ("document" in outcome) {
          await repos.caseAnalysisEvents.complete({
            analysisId,
            attempt,
            document: outcome.document,
            wording: CASE_WORDING,
            at: now(),
          });
        } else {
          await repos.caseAnalysisEvents.fail({
            analysisId,
            attempt,
            error: outcome.failure,
            at: now(),
          });
        }
      });
    } catch (error) {
      // Another delivery finished this attempt first (a second finish, or one
      // after a newer attempt): nothing is written twice.
      if (
        error instanceof AppError &&
        (error.code === "UNIQUE_CONFLICT" || error.code === "CASE_ANALYSIS_OUT_OF_ORDER")
      ) {
        return { kind: "SKIPPED", status: null };
      }
      throw error;
    }
    return "document" in outcome
      ? { kind: "COMPLETED", status: "COMPLETE", errorCode: null }
      : { kind: "COMPLETED", status: "FAILED", errorCode: outcome.failure.code };
  }
}

/**
 * One report, start to finish: the unit of work the reports queue delivers.
 * Queue-agnostic, like the collector job processor: the BullMQ layer calls
 * process() and acts on the disposition.
 *
 * Three steps, so no transaction is open while a model is called:
 *   1. Claim, with the report row locked. A finished report is skipped, so a
 *      replayed delivery does nothing. The token quota is checked before any
 *      model is called. The attempt is counted.
 *   2. Outside any transaction's lock: assemble the report from the settled
 *      run, and, if asked for, write the synthesis (metering every call).
 *   3. Record, with the row locked again: the attempt's token usage (once per
 *      attempt, so a retry never charges twice), with every model call and
 *      the upstream provider that served it, and the report's new state,
 *      together or not at all. A generated report's PDF is recorded PENDING
 *      in the same transaction; the report-renders queue renders and stores it.
 *
 * Retries are by cause, as for collectors: an unavailable model endpoint is
 * retried with backoff; a rejected answer, a refused request, a run that is
 * not settled or a spent quota fail the report at once, with the reason.
 */
import type { CollectorRegistry } from "@repo/collectors";
import { AppError, type ReportDocument, type ReportSynthesis, type TenantId } from "@repo/core";
import type { Database, Report } from "@repo/db";
import {
  AccumulatingMeter,
  LlmNotConfiguredError,
  LlmOutputRejectedError,
  LlmRequestRejectedError,
  LlmResponseInvalidError,
  LlmUnavailableError,
  type LlmClient,
} from "@repo/llm";
import { exceededQuota, retryDelayMs, type RetryPolicy } from "../jobs/policy.ts";
import {
  assembleReport,
  DEFAULT_ASSEMBLY_LIMITS,
  ReportRunNotFoundError,
  ReportRunNotSettledError,
  type AssembledReport,
  type AssemblyLimits,
} from "./assemble.ts";
import { synthesise, SynthesisReferenceError } from "./synthesis.ts";

export type ReportDisposition =
  /** The report had already finished: this delivery did nothing. */
  | { readonly kind: "SKIPPED"; readonly status: Report["status"] }
  | {
      readonly kind: "COMPLETED";
      readonly status: "SUCCEEDED" | "FAILED";
      readonly errorCode: string | null;
    }
  /** The model endpoint was unavailable, with attempts left: deliver again after the delay. */
  | { readonly kind: "RETRY"; readonly delayMs: number; readonly errorCode: string };

export class ReportNotFoundError extends AppError {
  readonly code = "REPORT_NOT_FOUND";

  constructor() {
    super("The report does not exist in this tenant.");
    this.name = "ReportNotFoundError";
  }
}

export interface ReportGeneratorOptions {
  readonly db: Database;
  readonly registry: CollectorRegistry;
  /**
   * The model client, or why there is none (no provider configured): a report
   * asking for synthesis then fails, giving that reason.
   */
  readonly llm: LlmClient | { readonly unavailable: string };
  /** The platform's handling marking, used when a tenant has not set one. */
  readonly defaultHandlingMarking: string | null;
  /** The product name (PRODUCT_NAME), stored in each report as its producer. */
  readonly producedBy: string;
  readonly retry: RetryPolicy;
  readonly limits?: AssemblyLimits;
  readonly clock?: () => Date;
}

type Failure = { readonly code: string; readonly message: string };

export class ReportGenerator {
  readonly #options: ReportGeneratorOptions;
  readonly #clock: () => Date;

  constructor(options: ReportGeneratorOptions) {
    this.#options = options;
    this.#clock = options.clock ?? (() => new Date());
  }

  async process(
    tenantId: TenantId,
    reportId: string,
    delivery: { readonly finalAttempt: boolean },
  ): Promise<ReportDisposition> {
    const { db } = this.#options;

    // 1. Claim.
    const claimed = await db.withTenant(tenantId, async ({ repos }) => {
      const report = await repos.reports.lock(reportId);
      if (report === null) throw new ReportNotFoundError();
      if (report.status === "SUCCEEDED" || report.status === "FAILED") {
        return { skipped: report.status } as const;
      }
      const attempt = report.attempts + 1;
      await repos.reports.transition(report.id, {
        status: "RUNNING",
        attempts: attempt,
        ...(report.startedAt === null ? { startedAt: this.#clock() } : {}),
      });
      const tenant = await repos.tenants.current();
      const quota = report.includeSynthesis
        ? ((await exceededQuota(repos, "LLM_INPUT_TOKEN", this.#clock())) ??
          (await exceededQuota(repos, "LLM_OUTPUT_TOKEN", this.#clock())))
        : null;
      return {
        report,
        attempt,
        marking: tenant?.reportHandlingMarking ?? this.#options.defaultHandlingMarking,
        quota,
      } as const;
    });
    if ("skipped" in claimed) return { kind: "SKIPPED", status: claimed.skipped };
    const { report, attempt } = claimed;

    // 2. Assemble and synthesise, outside the lock.
    const meter = new AccumulatingMeter();
    const generatedAt = this.#clock();
    let outcome: { readonly document: ReportDocument } | { readonly failure: Failure };
    let retryMs: number | null = null;
    try {
      if (claimed.quota !== null) {
        throw new ReportQuotaError(claimed.quota.unit, claimed.quota.period);
      }
      const assembled = await db.withTenant(tenantId, ({ repos }) =>
        assembleReport(
          repos,
          this.#options.registry,
          {
            reportId,
            runId: report.runId,
            generatedAt,
            handlingMarking: claimed.marking,
            producedBy: this.#options.producedBy,
          },
          this.#options.limits ?? DEFAULT_ASSEMBLY_LIMITS,
        ),
      );
      const synthesis = await this.#synthesis(tenantId, report, assembled, meter, generatedAt);
      outcome = { document: { ...assembled.document, synthesis } };
    } catch (error) {
      // Anything but a known report-level failure is an infrastructure fault:
      // it crashes the delivery, which BullMQ retries or dead-letters.
      if (!REPORT_FAILURES.some((kind) => error instanceof kind)) throw error;
      if (error instanceof LlmUnavailableError && !delivery.finalAttempt) {
        retryMs = retryDelayMs(this.#options.retry, attempt, error.retryAfterMs);
      }
      outcome = { failure: failureOf(error) };
    }

    // 3. Record usage and state together.
    return db.withTenant(tenantId, async ({ repos }) => {
      const current = await repos.reports.lock(reportId);
      if (current === null) throw new ReportNotFoundError();
      if (current.status === "SUCCEEDED" || current.status === "FAILED") {
        // Another delivery finished it meanwhile: this duplicate is the
        // platform's, and is not charged to the tenant (as for collector jobs).
        return { kind: "SKIPPED", status: current.status };
      }
      const totals = meter.totals();
      if (meter.calls.length > 0) {
        for (const [unit, quantity, share] of [
          ["LLM_INPUT_TOKEN", totals.inputTokens, "inputTokens"],
          ["LLM_OUTPUT_TOKEN", totals.outputTokens, "outputTokens"],
        ] as const) {
          await repos.usageEvents.recordReportAttempt({
            unit,
            quantity,
            reportId,
            attempt,
            modelCalls: meter.calls.map((call) => ({
              modelId: call.modelId,
              endpointHost: call.provenance.endpointHost,
              servedBy: call.provenance.servedBy,
              regionHeaders: call.provenance.regionHeaders,
              quantity: call.usage[share],
            })),
          });
        }
      }
      if ("document" in outcome) {
        await repos.reports.transition(reportId, {
          status: "SUCCEEDED",
          document: outcome.document,
          error: null,
          finishedAt: this.#clock(),
        });
        // Its PDF, to be rendered from the stored document (ReportRenderer):
        // recorded with the success, so a generated report always has one.
        await repos.reportPdfs.ensure(reportId);
        return { kind: "COMPLETED", status: "SUCCEEDED", errorCode: null };
      }
      if (retryMs !== null) {
        await repos.reports.transition(reportId, { status: "QUEUED", error: outcome.failure });
        return { kind: "RETRY", delayMs: retryMs, errorCode: outcome.failure.code };
      }
      await repos.reports.transition(reportId, {
        status: "FAILED",
        error: outcome.failure,
        finishedAt: this.#clock(),
      });
      return { kind: "COMPLETED", status: "FAILED", errorCode: outcome.failure.code };
    });
  }

  /**
   * Fails a report whose last delivery crashed without recording anything,
   * so it never sits RUNNING forever. A finished report is left alone.
   */
  async failUnrecorded(tenantId: TenantId, reportId: string, failure: Failure): Promise<void> {
    await this.#options.db.withTenant(tenantId, async ({ repos }) => {
      const report = await repos.reports.lock(reportId);
      if (report === null || report.status === "SUCCEEDED" || report.status === "FAILED") return;
      await repos.reports.transition(reportId, {
        status: "FAILED",
        error: failure,
        finishedAt: this.#clock(),
      });
    });
  }

  async #synthesis(
    tenantId: TenantId,
    report: Report,
    assembled: AssembledReport,
    meter: AccumulatingMeter,
    generatedAt: Date,
  ): Promise<ReportSynthesis> {
    if (!report.includeSynthesis) return { status: "NOT_REQUESTED" };
    const { llm } = this.#options;
    if ("unavailable" in llm) throw new LlmNotConfiguredError(llm.unavailable);
    return synthesise(llm, tenantId, meter, assembled, generatedAt);
  }
}

export class ReportQuotaError extends AppError {
  readonly code = "QUOTA_EXCEEDED";

  constructor(unit: string, period: string) {
    super(`The tenant's ${period.toLowerCase()} quota of ${unit} is spent; no model was called.`);
    this.name = "ReportQuotaError";
  }
}

/** Failures that end, or retry, a report rather than crash its delivery. */
const REPORT_FAILURES = [
  LlmNotConfiguredError,
  LlmUnavailableError,
  LlmRequestRejectedError,
  LlmResponseInvalidError,
  LlmOutputRejectedError,
  ReportRunNotSettledError,
  ReportRunNotFoundError,
  ReportQuotaError,
  SynthesisReferenceError,
] as const;

function failureOf(error: unknown): Failure {
  if (error instanceof LlmOutputRejectedError) {
    // The problem codes only: never the model's rejected words.
    return { code: error.code, message: error.message };
  }
  if (error instanceof AppError) return { code: error.code, message: error.message };
  return { code: "REPORT_GENERATION_ERROR", message: "Report generation failed unexpectedly." };
}

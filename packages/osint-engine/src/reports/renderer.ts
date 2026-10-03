/**
 * A report's PDF, rendered once in the background from the stored document,
 * and stored (Phase 5 follow-up): the unit of work the report-renders queue
 * delivers. Queue-agnostic, like the report generator: the BullMQ layer calls
 * process() and acts on the disposition.
 *
 * Rendering lives here, not in the API: it inherits the worker's timeouts,
 * retries and dead-lettering, it keeps slow work off the request path (the
 * Phase 5 live checkpoint's export rendered for 150 s inside a request and
 * took the API down), and a stored PDF is the same file on every download.
 *
 * Three steps, so no transaction is open while it renders:
 *   1. Claim, with the PDF row locked. A finished render (READY or FAILED) is
 *      skipped, so a replayed delivery does nothing. The attempt is counted
 *      and the stored document read.
 *   2. Outside any transaction: render, then store the file in the tenant's
 *      content store (content-addressed, so storing it again adds nothing).
 *   3. Record, with the row locked again: READY with the file's hash and size.
 *
 * Retries are by cause, as for collectors and reports: a storage failure is
 * retried with backoff; a render that fails is not (the same document renders
 * the same way every time), so it fails at once, with the reason. Anything
 * else is an infrastructure fault: it crashes the delivery, which BullMQ
 * retries, then dead-letters (failUnrecorded).
 */
import {
  AppError,
  REPORT_FORMAT_VERSION,
  type ReportDocument,
  type ReportPdfStatus,
  type TenantId,
} from "@repo/core";
import type { ContentStore, Database } from "@repo/db";
import { renderReportPdf } from "@repo/integrations";
import { retryDelayMs, type RetryPolicy } from "../jobs/policy.ts";
import { ReportNotFoundError } from "./generator.ts";

export type ReportRenderDisposition =
  /** The render had already finished: this delivery did nothing. */
  | { readonly kind: "SKIPPED"; readonly status: Extract<ReportPdfStatus, "READY" | "FAILED"> }
  | {
      readonly kind: "COMPLETED";
      readonly status: "READY" | "FAILED";
      readonly errorCode: string | null;
    }
  /** Storage was unavailable, with attempts left: deliver again after the delay. */
  | { readonly kind: "RETRY"; readonly delayMs: number; readonly errorCode: string };

/** A render was asked for a report that has no document to render. */
export class ReportNotRenderableError extends AppError {
  readonly code = "REPORT_NOT_RENDERABLE";

  constructor(status: string) {
    super(`The report is ${status}; only a generated report has a PDF.`);
    this.name = "ReportNotRenderableError";
  }
}

/** The stored document could not be rendered. Rendering it again would fail the same way. */
export class ReportRenderFailedError extends AppError {
  readonly code = "REPORT_RENDER_FAILED";

  constructor(reason: string) {
    super(`The PDF could not be rendered from the stored report: ${reason}.`);
    this.name = "ReportRenderFailedError";
  }
}

/** The rendered PDF could not be stored. Retryable. */
export class ReportPdfStorageError extends AppError {
  readonly code = "REPORT_PDF_STORAGE_UNAVAILABLE";

  constructor(reason: string) {
    super(`The rendered PDF could not be stored: ${reason}.`);
    this.name = "ReportPdfStorageError";
  }
}

export interface ReportRendererOptions {
  readonly db: Database;
  readonly contentStore: ContentStore;
  readonly retry: RetryPolicy;
  /** The renderer; @repo/integrations' PDF unless a test gives another. */
  readonly render?: (document: ReportDocument) => Promise<Uint8Array>;
  readonly clock?: () => Date;
}

type Failure = { readonly code: string; readonly message: string };

/** What a failed step says about itself: its class and code, never the content it was rendering. */
const reasonOf = (error: unknown): string =>
  error instanceof AppError
    ? error.code
    : error instanceof Error
      ? error.name
      : "an unknown failure";

/** The stored document, if it is one this renderer can lay out. */
function documentOf(stored: unknown): ReportDocument {
  const version =
    typeof stored === "object" && stored !== null && "formatVersion" in stored
      ? stored.formatVersion
      : null;
  if (version !== REPORT_FORMAT_VERSION) {
    throw new ReportRenderFailedError(
      `its format version is ${String(version)}, and this renderer lays out version ${String(REPORT_FORMAT_VERSION)}`,
    );
  }
  // Written by this platform's own assembly, in this format version.
  return stored as ReportDocument;
}

export class ReportRenderer {
  readonly #options: ReportRendererOptions;
  readonly #render: (document: ReportDocument) => Promise<Uint8Array>;
  readonly #clock: () => Date;

  constructor(options: ReportRendererOptions) {
    this.#options = options;
    this.#render = options.render ?? renderReportPdf;
    this.#clock = options.clock ?? (() => new Date());
  }

  async process(
    tenantId: TenantId,
    reportId: string,
    delivery: { readonly finalAttempt: boolean },
  ): Promise<ReportRenderDisposition> {
    const { db, contentStore } = this.#options;

    // 1. Claim.
    const claimed = await db.withTenant(tenantId, async ({ repos }) => {
      const report = await repos.reports.findById(reportId);
      if (report === null) throw new ReportNotFoundError();
      if (report.status !== "SUCCEEDED" || report.document === null) {
        throw new ReportNotRenderableError(report.status);
      }
      await repos.reportPdfs.ensure(reportId);
      const pdf = await repos.reportPdfs.lock(reportId);
      if (pdf === null) throw new ReportNotFoundError();
      if (pdf.status === "READY" || pdf.status === "FAILED")
        return { skipped: pdf.status } as const;
      const attempt = pdf.attempts + 1;
      await repos.reportPdfs.transition(reportId, {
        status: "RENDERING",
        attempts: attempt,
        ...(pdf.startedAt === null ? { startedAt: this.#clock() } : {}),
      });
      return { attempt, document: report.document } as const;
    });
    if ("skipped" in claimed) return { kind: "SKIPPED", status: claimed.skipped };

    // 2. Render and store, outside any transaction.
    let outcome:
      | { readonly file: { readonly contentHash: string; readonly byteLength: number } }
      | { readonly failure: Failure };
    let retryMs: number | null = null;
    try {
      let bytes: Uint8Array;
      try {
        bytes = await this.#render(documentOf(claimed.document));
      } catch (error) {
        throw error instanceof ReportRenderFailedError
          ? error
          : new ReportRenderFailedError(reasonOf(error));
      }
      try {
        const stored = await contentStore.put(tenantId, bytes);
        outcome = { file: { contentHash: stored.contentHash, byteLength: stored.byteLength } };
      } catch (error) {
        throw new ReportPdfStorageError(reasonOf(error));
      }
    } catch (error) {
      if (!(error instanceof ReportRenderFailedError || error instanceof ReportPdfStorageError)) {
        throw error;
      }
      if (error instanceof ReportPdfStorageError && !delivery.finalAttempt) {
        retryMs = retryDelayMs(this.#options.retry, claimed.attempt, null);
      }
      outcome = { failure: { code: error.code, message: error.message } };
    }

    // 3. Record.
    return db.withTenant(tenantId, async ({ repos }) => {
      const current = await repos.reportPdfs.lock(reportId);
      if (current === null) throw new ReportNotFoundError();
      if (current.status === "READY" || current.status === "FAILED") {
        // Another delivery finished it meanwhile.
        return { kind: "SKIPPED", status: current.status };
      }
      if ("file" in outcome) {
        await repos.reportPdfs.transition(reportId, {
          status: "READY",
          file: outcome.file,
          finishedAt: this.#clock(),
        });
        return { kind: "COMPLETED", status: "READY", errorCode: null };
      }
      if (retryMs !== null) {
        await repos.reportPdfs.transition(reportId, { status: "PENDING" });
        return { kind: "RETRY", delayMs: retryMs, errorCode: outcome.failure.code };
      }
      await repos.reportPdfs.transition(reportId, {
        status: "FAILED",
        error: outcome.failure,
        finishedAt: this.#clock(),
      });
      return { kind: "COMPLETED", status: "FAILED", errorCode: outcome.failure.code };
    });
  }

  /**
   * Fails a render whose last delivery crashed without recording anything,
   * so it never sits RENDERING forever. A finished render is left alone.
   */
  async failUnrecorded(tenantId: TenantId, reportId: string, failure: Failure): Promise<void> {
    await this.#options.db.withTenant(tenantId, async ({ repos }) => {
      const pdf = await repos.reportPdfs.lock(reportId);
      if (pdf === null || pdf.status === "READY" || pdf.status === "FAILED") return;
      await repos.reportPdfs.transition(reportId, {
        status: "FAILED",
        error: failure,
        finishedAt: this.#clock(),
        ...(pdf.startedAt === null ? { startedAt: this.#clock() } : {}),
      });
    });
  }
}

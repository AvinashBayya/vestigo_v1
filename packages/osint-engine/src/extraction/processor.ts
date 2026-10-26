/**
 * The queue unit of work for article prose extraction (M4-4B): the extractions
 * queue delivers one of these per FOUND article job after the run is fused.
 * Queue-agnostic, like the collector job and report processors — the BullMQ
 * layer calls process() and acts on the disposition.
 *
 * It is a thin adapter over runArticleExtraction, which does the extraction,
 * the durable-once claim write, and the token metering. The processor only
 * classifies the outcome for the queue: an unavailable model endpoint is
 * retried with backoff (like a collector or a report); a rejected or invalid
 * answer, or no model configured, is terminal for this delivery. There is no
 * extraction state row to leave RUNNING, so a crashed delivery simply wrote no
 * claim, and a later delivery re-extracts — nothing is lost, and the partial
 * unique index keeps a duplicate from ever being written.
 */
import type { TenantId } from "@repo/core";
import type { Database } from "@repo/db";
import type { LlmClient } from "@repo/llm";
import { retryDelayMs, type RetryPolicy } from "../jobs/policy.ts";
import { runArticleExtraction } from "./run.ts";

const ARTICLE_COLLECTOR_ID = "article";

/** The one extraction failure worth another delivery: the model endpoint was down. */
const RETRYABLE_CODES = new Set(["LLM_UNAVAILABLE"]);

const MAX_JOBS_PER_RUN = 1000;

export type ExtractionDisposition =
  /** Nothing to do (not an article/FOUND job, already extracted, or no model configured). */
  | { readonly kind: "SKIPPED"; readonly reason: string }
  /** The extraction ran to a terminal outcome. */
  | {
      readonly kind: "COMPLETED";
      readonly status: "SUCCEEDED" | "FAILED";
      readonly errorCode: string | null;
    }
  /** The model endpoint was unavailable, with attempts left: deliver again after the delay. */
  | { readonly kind: "RETRY"; readonly delayMs: number; readonly errorCode: string };

export interface ArticleExtractionProcessorOptions {
  readonly db: Database;
  /** The configured model client, or why there is none; extraction is SKIPPED when absent. */
  readonly llm: LlmClient | { readonly unavailable: string };
  readonly retry: RetryPolicy;
  /** The article collector id; overridable for tests. */
  readonly articleCollectorId?: string;
}

export class ArticleExtractionProcessor {
  readonly #options: ArticleExtractionProcessorOptions;
  readonly #articleCollectorId: string;

  constructor(options: ArticleExtractionProcessorOptions) {
    this.#options = options;
    this.#articleCollectorId = options.articleCollectorId ?? ARTICLE_COLLECTOR_ID;
  }

  /**
   * Extracts one article job. `attempt` is this delivery's attempt (1-based),
   * used only for the retry backoff; the extraction itself is keyed to the job,
   * not the attempt, so a redelivery never duplicates a claim or a charge.
   */
  async process(
    tenantId: TenantId,
    jobId: string,
    delivery: { readonly attempt: number; readonly finalAttempt: boolean },
  ): Promise<ExtractionDisposition> {
    const disposition = await runArticleExtraction(
      {
        db: this.#options.db,
        llm: this.#options.llm,
        articleCollectorId: this.#articleCollectorId,
      },
      tenantId,
      jobId,
    );
    if (disposition.kind === "SKIPPED") {
      return { kind: "SKIPPED", reason: disposition.reason };
    }
    if (disposition.kind === "EXTRACTED") {
      return { kind: "COMPLETED", status: "SUCCEEDED", errorCode: null };
    }
    // FAILED: retry only a transient model-endpoint outage, with attempts left.
    if (RETRYABLE_CODES.has(disposition.code) && !delivery.finalAttempt) {
      return {
        kind: "RETRY",
        delayMs: retryDelayMs(this.#options.retry, delivery.attempt, null),
        errorCode: disposition.code,
      };
    }
    return { kind: "COMPLETED", status: "FAILED", errorCode: disposition.code };
  }

  /**
   * The article jobs of a run eligible for extraction: FOUND and already fused,
   * so the article evidence is persisted (the extraction reads it). The fusion
   * worker calls this to fan out one extraction per article job. Enqueuing is
   * idempotent and the extraction re-checks everything, so returning a job that
   * was already extracted is harmless — it is SKIPPED on delivery.
   */
  async pendingForRun(tenantId: TenantId, runId: string): Promise<string[]> {
    const jobs = await this.#options.db.withTenant(tenantId, ({ repos }) =>
      repos.jobs.listForRun(runId, { limit: MAX_JOBS_PER_RUN }),
    );
    return jobs
      .filter(
        (job) =>
          job.collectorId === this.#articleCollectorId &&
          job.outcome === "FOUND" &&
          job.fusedAt !== null,
      )
      .map((job) => job.id);
  }
}

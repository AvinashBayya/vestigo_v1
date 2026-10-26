/**
 * Running the article prose extraction against a stored FOUND article job, and
 * persisting its result as ONE grounded, DERIVED claim on the article's URL
 * entity (M4-4).
 *
 * It mirrors how report synthesis is driven (read → model call outside any
 * transaction → record), and it is deliberately narrow and safe:
 *   - It only ever touches a FOUND job of the article collector; anything else
 *     is SKIPPED, so it can never disturb another collector or the deterministic
 *     collect → fuse flow.
 *   - The model call carries a token meter and happens outside any database
 *     transaction; the collected evidence is already committed and is never
 *     changed here, whatever the extraction does.
 *   - It is idempotent: it SKIPS when the article evidence already carries an
 *     `article_statements` claim, and re-checks inside the write transaction, so
 *     a repeated delivery writes nothing twice.
 *   - It is fail-closed and off by default: no configured LLM → SKIPPED; a
 *     rejected answer or provider error → FAILED; neither throws away or alters
 *     the evidence.
 *
 * The extracted statements are stored as the VALUE of one DERIVED claim, not as
 * entities: a person or organisation is never resolved from a name
 * (NEVER_RESOLVED_BY_VALUE), so the subjects are kept, for a reviewer, inside the
 * claim rather than promoted into the graph. See docs/M4_4_PROSE_INTELLIGENCE_REPORT.md
 * for the contradiction-integration gap this leaves open.
 */
import { ARTICLE_RESULT } from "@repo/collectors";
import type { TenantId, UsageUnit } from "@repo/core";
import type { Database } from "@repo/db";
import { AccumulatingMeter, type LlmClient } from "@repo/llm";
import { normaliseUrl } from "../fusion/identifiers.ts";
import { extractArticleStatements, type ArticleStatement } from "./article-extraction.ts";

/** The claim attribute that holds an article's extracted statements. */
export const ARTICLE_STATEMENTS_ATTRIBUTE = "article_statements";

/** The article collector whose FOUND results carry body text to extract. */
const ARTICLE_COLLECTOR_ID = "article";

/**
 * The attempt number every extraction's token usage is recorded under. An
 * article job has exactly one logical extraction, so its model-token usage
 * lives at a fixed attempt. With the job and unit it is unique
 * (usage_events_one_per_attempt), so a redelivery, a retry, or a concurrent
 * worker records each unit at most once — never double-charged. The article
 * collector itself calls no model, so it never writes an LLM-token row for
 * this job, and nothing collides here.
 */
const EXTRACTION_USAGE_ATTEMPT = 1;

export interface ArticleExtractionDeps {
  readonly db: Database;
  /** The configured LLM, or `{ unavailable }` when none is; off by default. */
  readonly llm: LlmClient | { readonly unavailable: string };
  /** A fresh accumulating meter per run; defaults to a new one. */
  readonly meter?: () => AccumulatingMeter;
  /** The article collector id; overridable for tests. */
  readonly articleCollectorId?: string;
}

/**
 * What one run did. SKIPPED carries why (not an article/FOUND job, already
 * extracted, no LLM, no body text, or an unresolvable URL); FAILED carries the
 * extraction's code. `usageRecorded` is true when the model was called and its
 * token usage was charged to the tenant (once). Nothing here ever means the
 * collected evidence was changed.
 */
export type ArticleExtractionDisposition =
  | {
      readonly kind: "EXTRACTED";
      readonly claimWritten: boolean;
      readonly statementCount: number;
      readonly usageRecorded: boolean;
    }
  | { readonly kind: "SKIPPED"; readonly reason: string }
  | { readonly kind: "FAILED"; readonly code: string; readonly usageRecorded: boolean };

interface Prepared {
  readonly evidenceId: string;
  readonly url: string;
  readonly bodyText: string;
  readonly sourceLabel: string;
}

const CLAIM_SCAN_LIMIT = 500;

/**
 * Extracts and persists an article job's prose intelligence. Safe to call on any
 * job id: a non-article or non-FOUND job is SKIPPED.
 */
export async function runArticleExtraction(
  deps: ArticleExtractionDeps,
  tenantId: TenantId,
  jobId: string,
): Promise<ArticleExtractionDisposition> {
  const collectorId = deps.articleCollectorId ?? ARTICLE_COLLECTOR_ID;

  // 1. Read the job, its body text and evidence, on one snapshot; and the
  //    idempotency check, before any model call is made.
  const prepared = await deps.db.withTenant(
    tenantId,
    async ({ repos }): Promise<Prepared | { readonly skip: string }> => {
      const job = await repos.jobs.findById(jobId);
      if (job === null) return { skip: "the job does not exist" };
      if (job.collectorId !== collectorId) return { skip: "not an article job" };
      if (job.status !== "SUCCEEDED" || job.outcome !== "FOUND" || job.result === null) {
        return { skip: "the article job did not find an article" };
      }
      const evidenceId = (job.evidenceIds ?? [])[0];
      if (evidenceId === undefined) return { skip: "the article job recorded no evidence" };
      if (job.target === null) return { skip: "the article job recorded no target" };
      const claims = await repos.claims.listForEvidence([evidenceId], { limit: CLAIM_SCAN_LIMIT });
      if (claims.some((claim) => claim.attribute === ARTICLE_STATEMENTS_ATTRIBUTE)) {
        return { skip: "already extracted" };
      }
      const parsed = ARTICLE_RESULT.safeParse(job.result);
      if (!parsed.success) return { skip: "the stored result is not an article result" };
      return {
        evidenceId,
        url: job.target,
        bodyText: parsed.data.derived.bodyText,
        sourceLabel: job.collectorId,
      };
    },
    { snapshot: true },
  );
  if ("skip" in prepared) return { kind: "SKIPPED", reason: prepared.skip };

  // The URL entity is identified exactly as fusion identifies it; if it does not
  // normalise, there is no entity to attach to — skip rather than guess.
  const identifier = normaliseUrl(prepared.url);
  if (identifier === null) return { kind: "SKIPPED", reason: "the article URL does not normalise" };

  // 2. The model call, outside any transaction, with a token meter.
  const meter = (deps.meter ?? (() => new AccumulatingMeter()))();
  const extraction = await extractArticleStatements(deps.llm, tenantId, meter, {
    sourceLabel: prepared.sourceLabel,
    bodyText: prepared.bodyText,
  });
  // The usage events this run's model calls earned, if any. A call that
  // consumed no tokens (unavailable, before the provider reported usage) earns
  // nothing (CLAUDE.md §4); every call that did is charged, including one whose
  // output was then rejected — the tokens were spent either way.
  const usage = usageEvents(meter, collectorId, jobId);

  if (extraction.status === "SKIPPED") {
    // No model was called; nothing to charge.
    return { kind: "SKIPPED", reason: extraction.reason };
  }
  if (extraction.status === "FAILED") {
    // The provider processed the article but its answer was rejected (or the
    // call failed): no claim is written, and its tokens — if any — are charged
    // once, in their own transaction, so the collected evidence is untouched.
    const usageRecorded = await recordUsage(deps.db, tenantId, usage);
    return { kind: "FAILED", code: extraction.code, usageRecorded };
  }
  if (extraction.statements.length === 0) {
    // A truthful empty extraction: no claim, but the model call (if any) is charged.
    const usageRecorded = await recordUsage(deps.db, tenantId, usage);
    return { kind: "EXTRACTED", claimWritten: false, statementCount: 0, usageRecorded };
  }

  // 3. Persist: one DERIVED claim on the article's URL entity, grounded to the
  //    article evidence, and its token usage, together in one tenant
  //    transaction. The partial unique index backing createOnce makes a second
  //    `article_statements` claim for this evidence impossible, so a concurrent
  //    worker or a redelivery writes nothing twice; the usage is charged only
  //    when this delivery is the one that wrote the claim, never for a duplicate.
  const statements: readonly ArticleStatement[] = extraction.statements;
  const written = await deps.db.withTenant(
    tenantId,
    async ({
      repos,
    }): Promise<{ readonly claimWritten: boolean; readonly usageRecorded: boolean }> => {
      const resolved = await repos.entities.resolveByIdentifier({
        kind: "URL",
        identifier,
        displayName: prepared.url,
      });
      const { created } = await repos.claims.createOnce({
        evidenceId: prepared.evidenceId,
        subject: { entityId: resolved.entity.id },
        attribute: ARTICLE_STATEMENTS_ATTRIBUTE,
        value: statements,
        strength: "DERIVED",
      });
      if (!created) return { claimWritten: false, usageRecorded: false };
      let usageRecorded = false;
      for (const row of usage)
        usageRecorded = (await repos.usageEvents.recordAttempt(row)) || usageRecorded;
      return { claimWritten: true, usageRecorded };
    },
  );
  return {
    kind: "EXTRACTED",
    claimWritten: written.claimWritten,
    statementCount: statements.length,
    usageRecorded: written.usageRecorded,
  };
}

interface UsageRow {
  readonly unit: UsageUnit;
  readonly quantity: number;
  readonly collectorId: string;
  readonly jobId: string;
  readonly attempt: number;
}

/**
 * The token-usage events to charge for a run's model calls: the input and the
 * output totals, against the article job at the fixed extraction attempt. Empty
 * when no model call consumed tokens, so nothing is ever charged for a cache
 * hit or a call that failed before the provider reported usage.
 */
function usageEvents(
  meter: AccumulatingMeter,
  collectorId: string,
  jobId: string,
): readonly UsageRow[] {
  if (meter.calls.length === 0) return [];
  const totals = meter.totals();
  return (
    [
      ["LLM_INPUT_TOKEN", totals.inputTokens],
      ["LLM_OUTPUT_TOKEN", totals.outputTokens],
    ] as const
  ).map(([unit, quantity]) => ({
    unit,
    quantity,
    collectorId,
    jobId,
    attempt: EXTRACTION_USAGE_ATTEMPT,
  }));
}

/** Records the usage rows in one tenant transaction; returns whether any was newly written. */
async function recordUsage(
  db: Database,
  tenantId: TenantId,
  rows: readonly UsageRow[],
): Promise<boolean> {
  if (rows.length === 0) return false;
  return db.withTenant(tenantId, async ({ repos }) => {
    let recorded = false;
    for (const row of rows) recorded = (await repos.usageEvents.recordAttempt(row)) || recorded;
    return recorded;
  });
}

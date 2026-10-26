# M4-4B — post-fusion extraction integration

Date: 2026-10-23. Branch `milestone/vestigo-days-1-3-osint-addendum`, HEAD `156952f` (unchanged). **Nothing committed, pushed, reset, or cleaned.** No live publisher request, no source-verdict change, no new provider dependency, no model enabled by default, no bypass of tenant scope, SSRF, or person gates.

This integrates the existing `runArticleExtraction` runner into the established BullMQ pipeline as an optional post-fusion task, with a durable concurrency-safe idempotency guarantee and per-tenant token metering. It is an integration, not a redesign of the extraction model.

## 1. Initial state and preserved changes

Inspected first: branch `milestone/vestigo-days-1-3-osint-addendum`, HEAD `156952f`, 82 uncommitted paths (48 modified, 34 untracked) — all M1–M4-4A work. Every pre-existing change is preserved; the test DB was already up from M4-4A (`docker compose` Postgres + Redis healthy). I read both prior reports before changing anything and traced the fusion flow, the BullMQ queue/pool layer, the report and case-analysis processor patterns, the `usage_events` metering contract, the claims schema, and the existing idempotency mechanisms.

### Files changed (all uncommitted)

| File | Change |
|---|---|
| `packages/db/src/schema/evidence.ts` | Partial unique index `claims_one_article_statements_per_evidence` on `claims(tenant_id, evidence_id, attribute) WHERE attribute = 'article_statements'`. |
| `packages/db/migrations/0028_m4_4b_article_extraction_dedup.sql` + `meta/_journal.json` | The forward-only migration that creates it. |
| `packages/db/src/repositories/evidence.ts` | `ClaimsRepository.createOnce()` — inserts against that index with `ON CONFLICT DO NOTHING`, returns `{claim, created}`. |
| `packages/osint-engine/src/extraction/run.ts` | Uses `createOnce`; records token usage (success bundled atomically with the claim; rejected/empty-with-tokens in its own transaction). Disposition now carries `usageRecorded`. |
| `packages/osint-engine/src/extraction/processor.ts` | **New.** `ArticleExtractionProcessor`: `process()` (queue adapter + retry classification) and `pendingForRun()` (FOUND+fused article jobs for fan-out). |
| `packages/osint-engine/src/jobs/queues.ts` | `EXTRACTIONS_QUEUE`, extraction message, `EXTRACTION` dead-letter kind, `enqueueExtraction`, the `extraction` pool option, the post-fusion fan-out, the extractions consumer with its bulkhead, and `EXTRACTION` dead-lettering. |
| `packages/osint-engine/src/index.ts` | Exports `EXTRACTIONS_QUEUE`, `ArticleExtractionProcessor`, its types. |
| `apps/worker/src/worker.ts` | Builds the processor, passes `extraction: { processor, concurrency, enabled: <model configured> }`. |
| `packages/config/src/env.ts` + `.env.example` | `EXTRACTION_CONCURRENCY` (default 2), regenerated example. |
| `packages/osint-engine/test/article-extraction-processor.test.ts`, `test/extraction-queue.test.ts` | **New.** DB-backed processor tests (incl. concurrency) and the Redis/BullMQ end-to-end fan-out test. |

## 2. Queue lifecycle and the exact integration point

A new `extractions` queue, one bulkhead like `reports`/`case-analyses` (no new worker service; one codebase, pools selected by `WORKER_QUEUES`, default `*`).

**Integration point:** the **fusion worker**, immediately after `RunFusion.fuseRun(tenantId, runId)` returns (so the run's article evidence and its claims are committed). When extraction is enabled, it calls `processor.pendingForRun(tenantId, runId)` — the run's article-collector jobs that are `FOUND` **and** already `fusedAt` — and enqueues one `extract-<jobId>` job per article job onto the extractions queue (bounded; a failed enqueue never fails fusion). The extractions worker then runs `processor.process` → `runArticleExtraction`, which reads the article job's retained `bodyText`, extracts through the hardened LLM path, and persists one DERIVED `article_statements` claim on the article's URL entity.

- **Only FOUND, fused article jobs** are ever enqueued (`pendingForRun`), so extraction never runs before the evidence/fusion it reads is persisted, and unrelated collectors are never touched. The runner independently re-checks collector id, status, outcome, and target and SKIPs anything else — a stray delivery is inert.
- **Off by default:** `enabled` is `llmConfiguration.status !== "NOT_CONFIGURED"`. With no model configured the fusion worker fans nothing out, and the runner SKIPs regardless, so collection and fusion stand untouched.
- **Context is trusted end-to-end:** the tenant and job ids ride the validated BullMQ message (`EXTRACTION_MESSAGE`, uuids) from the fusion worker; nothing is taken from article content or model output. The message carries no target value or body text.
- **Observability:** success/skip/failure flow through the same BullMQ conventions; a terminal failure is dead-lettered as kind `EXTRACTION` with the article job id and the error code. Logs carry ids and codes only (no secrets, no article content).

## 3. Idempotency guarantee and crash/retry semantics

**Stated precisely: this is idempotent persistence with exactly-once effect, not at-most-once execution.** The model may be called more than once (a duplicate delivery, a concurrent worker, a retry), but the durable effects — the claim and the token charge — happen at most once per (tenant, article evidence).

- **Durable guard:** the claim is written with `createOnce` against the partial unique index. Two concurrent workers, or a redelivery, can each run the model, but only one `INSERT` wins; the losers' inserts no-op. The in-process pre-check remains only as an optimisation to skip the model call for an already-extracted job — it is **not** relied on for correctness.
- **Crash/retry — no work is stranded:** there is deliberately no extraction state row, so there is no "marked complete before the result was persisted" hazard. A delivery that crashes before the claim commits leaves nothing, and a later delivery simply re-extracts. A crash *after* the claim commits is a no-op on redelivery (the unique index rejects the second claim; the charge is deduped — see §5).
- **SKIPPED vs FAILED vs retries:**
  - **SKIPPED** (not an article/FOUND job, already extracted, no model configured, empty/unnormalisable target): terminal, no dead-letter, no charge.
  - **RETRY**: only an unavailable model endpoint (`LLM_UNAVAILABLE`) with attempts left — redelivered with backoff, exactly as collectors and reports retry.
  - **FAILED** (a rejected or schema-invalid answer, or the endpoint still down on the final attempt): terminal for this delivery, dead-lettered with its code. Collected evidence is never altered.

Verified: `test/article-extraction-processor.test.ts` runs two `process()` calls concurrently against the real database and asserts exactly one claim and one usage row per unit survive.

## 4. Database constraints / migrations

One migration, `0028_m4_4b_article_extraction_dedup.sql` (forward-only, additive, in-transaction like every index migration here):

```sql
CREATE UNIQUE INDEX "claims_one_article_statements_per_evidence"
  ON "claims" USING btree ("tenant_id","evidence_id","attribute")
  WHERE "attribute" = 'article_statements';
```

It constrains only the one attribute the extraction writes — an attribute no existing row carries — so the build touches nothing stored, and every other claim is unaffected. It is mirrored in the Drizzle schema. No new table, no change to `usage_events`, no RLS/grant change. (Drizzle `meta/*_snapshot.json` for 0028 was not hand-authored — the runtime migrator reads only the journal + SQL, which the full db suite exercises; regenerate the snapshot with `drizzle-kit` before the next generated migration.)

## 5. Per-tenant token metering

Extraction's model tokens are recorded via the existing `UsageEventsRepository.recordAttempt`, keyed `(tenant_id, job_id, attempt, unit)` against the article job, at a **fixed `attempt = 1`**, for `LLM_INPUT_TOKEN` and `LLM_OUTPUT_TOKEN`.

- **No fabrication:** usage is recorded only when the provider actually reported tokens (`meter.calls` non-empty). A call that consumed nothing (unavailable, cache) records nothing — the repository's existing "measured, never estimated" behaviour.
- **Charged once, incl. the crash window:** on success the usage rows are written in the **same transaction** as the claim (recorded ⟺ claim persisted). For a rejected/empty answer that still consumed tokens, usage is written in its own transaction. Both paths go through the existing `usage_events_one_per_attempt` unique index with `ON CONFLICT DO NOTHING` at the fixed attempt, so a retry, a redelivery, or a concurrent worker can never double-count — the second write no-ops. The article collector calls no model, so it never writes an LLM-token row for the job; there is no collision.
- **Contract alignment:** a provider call whose answer is rejected is still charged (the tokens were spent), matching the report contract; a provider error and a SKIPPED extraction are not charged, as they consumed nothing.
- **Documented gap — residency:** the schema restricts `model_calls` (the per-call provider-residency breakdown) to `report`-keyed usage rows (`usage_events_model_calls_with_report`). Extraction tokens are therefore recorded against the job **without** that per-call residency detail. Closing it faithfully needs an `extraction`-keyed usage path mirroring `recordReportAttempt` (see §7); it is not done here to keep the migration minimal and avoid touching the shared accounting table.

Verified: the processor test asserts exact quantities — one success charges `{INPUT:100, OUTPUT:20}` once; a duplicate adds nothing; two concurrent deliveries still total one row per unit; a rejected answer (two provider calls) charges `{INPUT:200, OUTPUT:40}` once; no-model and provider-error charge nothing.

## 6. Test commands and actual results

Run against the real containerised Postgres + Redis (`docker compose up -d --wait`; both healthy). All green.

| Command | Result |
|---|---|
| `vitest run test/article-extraction-processor.test.ts` | **9 passed** — success+metering, duplicate, **concurrent duplicate**, rejected-terminal+charge-once, no-model SKIPPED, unavailable RETRY→terminal, foreign job SKIPPED, tenant isolation, `pendingForRun` eligibility |
| `vitest run test/extraction-queue.test.ts` | **2 passed** — fusion fans out → extraction claim written (real BullMQ); disabled → nothing fanned out or written |
| `vitest run test/article-extraction{,-run}.test.ts` | **14 passed** (M4-4/M4-4A, unchanged behaviour) |
| `vitest run test/pipeline.test.ts` (RELEASE-BLOCKING) | **38 passed** — no regression from the queue-layer changes |
| `@repo/worker` vitest | **5 passed** |
| `@repo/db` vitest | **305 passed** — migration 0028 applies; schema + `createOnce` sound |
| `@repo/config` vitest | **273 passed** — env + regenerated `.env.example` |
| `tsc --noEmit` (osint-engine src+test) · builds (db/config/worker/osint-engine) | clean |
| `eslint` (db, osint-engine, config, worker) · `prettier --check` | clean |

**Verified runtime behaviour vs implementation:** everything in §§2–5 is backed by the passing DB-backed and BullMQ tests above, except the two items explicitly marked as *not done* — the residency breakdown (§5) and the snapshot regeneration (§4). No live model or publisher was contacted; all tests use a deterministic scripted provider and offline fixtures.

## 7. Remaining risks and the next justified step

- **R1 — residency not recorded for extraction tokens (§5).** Next step: add an `extraction`-keyed usage path (an `extraction_id`/work-item column on `usage_events` + a `recordExtractionAttempt` carrying `model_calls`, mirroring reports), so extraction tokens carry the same per-call provider-residency detail. This is the one justified schema extension deferred here.
- **R2 — no live model exercised.** Verified only against a scripted provider; `createLlmClient` is `{unavailable}` by default. The first real run should be a bounded, metered canary (out of scope for this milestone, per the brief).
- **R3 — rare concurrent success+rejection accounting skew.** If one delivery succeeds and a *different* delivery is simultaneously rejected, the single charged row may reflect either call's token count (both at attempt 1, first-writer-wins). Still exactly-once and non-fabricated; only reachable under manual replay of a rejected job. R1's per-work-item keying removes it.
- **R4 — drizzle snapshot (§4)** should be regenerated before the next generated migration.

## Status

**IMPLEMENTED AND VERIFIED against real Postgres + Redis.** Article prose extraction is wired as an optional, off-by-default post-fusion queue task; duplicate and concurrent deliveries cannot create a duplicate claim or double-charge (durable unique index + fixed-attempt usage dedup); successful collection and fusion are preserved when extraction is skipped or fails. 25 extraction tests + the 38-test release-blocking pipeline + db/config/worker suites all pass; typecheck, lint, and format are clean. Deferred by design and documented: per-call token residency for extraction (R1). Repository left uncommitted with all pre-existing changes preserved.

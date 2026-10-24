# M4-4 — evidence-grounded prose intelligence

Date: 2026-10-23. Branch `milestone/vestigo-days-1-3-osint-addendum`; **nothing committed, pushed, reset, or cleaned**. No live publisher request, no source-verdict change, no new provider dependency, no model enabled by default, no bypass of tenant scope, SSRF, or person gates.

## 1. Verified initial state and preserved work

HEAD `156952f` (unchanged). `git status` carried the uncommitted M1–M4-3 work (the article collector and its M4-2 `bodyText`/`mentions`, the contradiction integration M4-1, the contradictions UI M4-3, and the reports), all preserved. I verified the actual tree against the prior reports before coding: the LLM path (`generateValidated`, provider + allowlist, injection/output/citation guards, metering, `frameUntrusted`), the one existing consumer (report synthesis), the article `ARTICLE_RESULT.derived.bodyText` and that it persists in `jobs.result`, the fusion/claim/entity write path, and the entity-resolution and contradiction contracts.

## 2. Files changed, and why

| File | Change |
|---|---|
| `packages/osint-engine/src/extraction/article-extraction.ts` | **New.** The capability: `extractArticleStatements(...)` — frames the body text as untrusted data, calls `generateValidated` (task `extraction`), validates grounding + safety, and returns a typed, fail-closed result. |
| `packages/osint-engine/src/extraction/run.ts` | **New.** The orchestration: `runArticleExtraction(deps, tenantId, jobId)` — reads a FOUND article job's body text, extracts, and persists one grounded DERIVED claim; idempotent, off by default, fail-closed. |
| `packages/osint-engine/src/index.ts` | Exports the extraction capability, the orchestration, and `ARTICLE_STATEMENTS_ATTRIBUTE`. |
| `packages/osint-engine/test/llm-fake.ts` | **New.** A scripted model stand-in (`ScriptedProvider`/`UnavailableProvider`/`clientWith`/`extractionAnswer`) built only from public `@repo/llm`/`@repo/config` types — no real provider. |
| `packages/osint-engine/test/article-extraction.test.ts` | **New.** Offline capability tests over the scripted model. |
| `packages/osint-engine/test/article-extraction-run.test.ts` | **New.** DB-backed persistence/idempotency/fail-closed/tenant tests. |

No new provider, no second evidence model, no migration, no change to the fusion extractors (which stay pure), no UI work.

## 3. End-to-end data flow

1. **Source → stored text (existing).** The article collector fetches over the SSRF-hardened path and records the raw bytes as content-hashed evidence; its validated result, including the bounded `derived.bodyText`, is stored in `jobs.result`.
2. **Read (new).** `runArticleExtraction` reads the FOUND article job on one snapshot: its `bodyText` (via `ARTICLE_RESULT.safeParse(job.result)`), its evidence id, and its target URL. It SKIPS anything that is not a FOUND article job, and SKIPS if the evidence already carries an `article_statements` claim (idempotency), before any model call.
3. **Extract (new), outside any transaction.** `extractArticleStatements` frames the body text as a single `UntrustedRecord` and calls `generateValidated` (task `extraction`, the SMALL model) with a bounded schema and a `validate` callback. The system message carries the task rules plus the shared `DATA_POLICY` and a canary; the body text goes in a hash-delimited `<untrusted_data>` block, never concatenated into the instructions.
4. **Validate (new).** Every statement's `quote` must be a verbatim substring of the stored `bodyText` (grounding); `checkOutput` rejects markup/canary leaks, echoed injection instructions, hallucinated identifiers, calls to action, and risk verdicts. A failure retries once with fixed-text corrections, then `generateValidated` throws `LlmOutputRejectedError` and nothing from the answer is used.
5. **Persist (new), in a tenant transaction.** The validated statements — each with the verified quote and its exact `{start, end}` span in `bodyText` — are written as **one DERIVED claim**, attribute `article_statements`, on the article's URL entity (resolved by its normalised identifier, exactly as fusion identifies it), citing the article evidence id. Idempotency is re-checked inside the transaction.

The model call happens between two short transactions (as report synthesis does), so no transaction is held open across it, and the already-collected evidence is never altered.

## 4. Schema and epistemic classification

Each extracted statement: `{ subjectType (PERSON|ORGANIZATION|PLACE|EVENT|OTHER), subject, attribute, value, quote, start, end }`. Persisted form: one claim whose `value` is the array of statements, `strength: "DERIVED"`, `evidenceId` the article evidence, subject the article's URL entity.

- **The article is the source; the model output is a DERIVED extraction of it, never evidence.** The claim strength is `DERIVED`, and it cites the real article evidence row. Article-stated facts remain attributed to the article (the quote is from it); the model's structuring of them is DERIVED.
- **No entity is promoted from a name.** A person or organisation is never resolved from a name (`NEVER_RESOLVED_BY_VALUE`, enforced in code and by the DB check), so the extracted subjects are kept inside the claim value for a reviewer, not created as graph entities. This is a deliberate limit, not an omission (see §8).
- **Grounding is a char span into the retained normalised body text.** Spans are computed only after the quote is verified verbatim in `bodyText`, so they are exact; an ungrounded quote is rejected, never given a fabricated offset.

## 5. Guarantees

- **Grounding:** every persisted statement quotes the article verbatim (re-checked against the stored body text here, independently of the model), with an exact span; nothing is invented.
- **Injection defense:** the body text is untrusted data, delimited by a hash boundary with a canary in the (trusted) system message; `checkOutput` rejects any answer that leaks the boundary/canary/markup, echoes an instruction-like span from the text, or emits an identifier, call to action, or risk verdict not grounded in the cited record. The text is never interpreted as instructions.
- **Provider/allowlist/metering:** reuses `generateValidated`, the open-weight model allowlist, the provider's refusal of unmetered/truncated/empty output, and a token meter (returned on the disposition for a caller to persist). No new provider; no model enabled by default.
- **Tenant isolation:** every read and write is inside a tenant transaction through the tenant-scoped repositories (Postgres RLS); the claim is written only in the collecting tenant.
- **Failure handling, fail-closed:** no configured LLM → SKIPPED; a rejected answer or provider error → FAILED; empty body text → an empty EXTRACTED result; none throws away or alters the collected evidence. The orchestration is idempotent: a repeated delivery SKIPS before any model call, and re-checks inside the write transaction, so nothing is written or charged twice.

## 6. Tests run, results, and environmental limitation

**Executed (no database needed), all clean:**

| Command | Result |
|---|---|
| `pnpm --filter @repo/osint-engine build` (tsc, src) | clean |
| `pnpm --filter @repo/osint-engine exec tsc --noEmit -p tsconfig.json` (src **and** test) | clean — the test files compile against the real repo/LLM/collector types |
| `pnpm --filter @repo/osint-engine lint` | ESLint clean |
| `pnpm exec prettier --check` (all six M4-4 files) | clean |

**Written but NOT executed — the test database was unavailable in this environment:**

The osint-engine suite's vitest `globalSetup` recreates the test database, so every osint-engine test requires Postgres. In this environment the Docker daemon was unresponsive for the whole session (probes hung; `docker desktop restart` returned success but the daemon never accepted connections; a wait loop ended `DOCKER_STILL_DOWN`), so the tests fail at setup with `TestDatabaseUnreachableError` (ECONNREFUSED at 127.0.0.1:5432) before any test body runs. **I therefore do not claim these pass.** They are written and type-check; they must be run once the database is up:

```
docker compose up -d --wait
pnpm --filter @repo/osint-engine exec vitest run test/article-extraction.test.ts
pnpm --filter @repo/osint-engine exec vitest run test/article-extraction-run.test.ts
```

What they assert (so a reviewer can judge coverage): **capability (offline, scripted model)** — a valid grounded answer yields statements with exact spans; an ungrounded quote, a hallucinated identifier in a value, an echoed injection instruction, malformed JSON, and more statements than the bound all FAIL closed; no configured LLM is SKIPPED; a provider error FAILS with its code; empty body text returns an empty result with no model call. **Orchestration (DB-backed)** — a FOUND article job persists exactly one DERIVED `article_statements` claim on the URL entity citing the evidence, with spans that resolve back to the body text; a second delivery is SKIPPED with no model call and no duplicate; no configured LLM and a rejected answer both write no claim and leave the evidence; a different tenant sees none of it, and a non-article job id is SKIPPED.

## 7. Implemented versus missing

- **Implemented and statically verified:** the grounded extraction capability and the extract→persist orchestration (`runArticleExtraction`), reusing the hardened LLM path; idempotent, fail-closed, off by default; exported from the package.
- **Not wired to a worker queue (the next step).** `runArticleExtraction` is invocable but is not yet auto-triggered after collection. The smallest justified wiring is a new optional processor on its own queue, mirroring `reports`/`case-analyses`: resolve the LLM once at worker startup, enqueue an article extraction per FOUND article job after fusion, and persist the returned meter's usage per tenant. I did not add it here to keep the slice focused and to avoid disturbing the deterministic collect→fuse flow; it needs its own DB-backed tests (the `runArticleExtraction` tests above are the processor's core logic).
- **Not persisted per-tenant yet:** the token meter is returned on the disposition but not recorded as a usage event (there is no generic per-task usage-event writer today, only the report-specific one); recording it is part of the queue wiring.

## 8. Can extracted claims safely reach contradiction analysis?

Partly, and safely — with a documented gap.

The `article_statements` claim is a well-formed entity claim (entity id, attribute, non-null value), so it **is** contradiction-review input, and it is safe: there is exactly one such claim per article (one value per `(URL entity, article_statements)`), so distinct subjects within one article never produce a false contradiction, and two different articles are different URL entities so they never spuriously conflict. It meaningfully contradicts only another extraction of the **same** URL (a re-fetch whose statements changed) — coarse, but honest.

What it does **not** yet support (rule 6, documented gap): fine-grained cross-source contradiction on a shared SUBJECT ("source A says X was founded in 1999, source B says 2001"). That needs the subject to be a resolvable entity, which the current model forbids for people and organisations by name and does not provide for places or events. Forcing it — by attaching subject-attribute-value claims to the article entity, or by creating entities from names — would either create false contradictions across subjects or violate `NEVER_RESOLVED_BY_VALUE`. So the extracted subjects are retained in the claim value for review, not promoted, and the richer integration waits on a grounded candidate-entity model.

## 9. Remaining risks and the smallest next step

- **Risk — no live provider was exercised.** The capability is verified only against a scripted model and static types; the first run against a real open-weight endpoint should be a bounded, metered canary. No endpoint is configured, so the step is inert by default.
- **Risk — test execution is outstanding.** The two test files must be run against the database (commands above) before this is relied on; I have not seen them pass.
- **Smallest next step:** run the two test suites against the database; then wire `runArticleExtraction` into a new optional post-fusion extraction queue (mirroring `reports`), recording the meter's usage per tenant. The subject-entity-resolution model that would let prose claims contradict across sources is a larger, separate milestone.

## Status

**OFFLINE/STATIC VERIFICATION ONLY.** The evidence-grounded prose-extraction capability and its extract→persist orchestration are implemented, reuse the hardened LLM path, and are fail-closed and off by default; they build, type-check (including the tests), lint, and format cleanly. The two new test suites are written and type-check but **were not executed** because the test database (Docker) was unavailable in this environment — run them with `docker compose up -d --wait` and the two commands in §6. The repository is left uncommitted with all pre-existing changes preserved. Nothing here enabled a model, contacted a publisher, changed a source verdict, or weakened a security control.

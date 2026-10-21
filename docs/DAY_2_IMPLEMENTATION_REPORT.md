# Day 2 implementation report

Date: 2026-10-21. Scope: the evidence-to-graph pipeline for GDELT news, verification of evidence-grounded AI synthesis, and closing the report-generation person-gate gap (D-34). Builds on the Day 1 audit and baseline fix.

Status legend used throughout:

- **Verified** — proven by a test that ran, or a command whose output I read.
- **Mock-tested** — proven against a scripted/recorded stand-in, never a live third party.
- **Needs config** — correct in code and tested with mocks; a real external provider/source is required to exercise it live, and was not.
- **Not done** — deliberately out of scope; recorded as a gap.

---

## 1. Executive summary

Day 2 turned collected GDELT news evidence into a real, provenance-bearing graph and closed a person-gate gap in report generation, reusing the existing fusion/extractor architecture with **no new dependencies and no schema migrations**.

- **Priority A (done, verified):** the `news` (GDELT) fusion extractor now produces entities, relationships and claims instead of checking the result and drawing nothing. Each article becomes a `URL` entity, its outlet a `DOMAIN` entity, the article `published_by` the outlet, and the article's own fields become claims (REPORTED for source values, DERIVED for the parsed seen-time). No headline or outlet country is turned into a named entity; no edge is drawn merely because two entities share an article; nothing is counted. An end-to-end DB-backed test collects a recorded GDELT answer through the offline fixture harness, persists evidence, fuses it, and reads the entities, relationships and claims back.
- **Priority B (verified built; one gap closed, verified):** evidence-grounded synthesis was already implemented and is sound (the model reads only the report's own claims as delimited untrusted input, every statement must cite a known evidence ref, strengths are limited to CORRELATED/INFERRED/HYPOTHESIS, injection guards run, and a failed answer fails the report). I added the **report-generation person-gate re-check (D-34)**: the report job now re-checks the shared `personGate` on the run's data before reading any claims, mirroring the case-analysis job and the SSE stream. Provider-not-configured produces an honest failure, never fabricated AI output. **No live model call was made; synthesis is mock-tested only.**
- **Baseline:** build, typecheck, lint (per-package ESLint) and the affected package test suites are green. The full `pnpm test` has one failing task, **`@repo/config#test`**, caused entirely by pre-existing untracked `.claude/worktrees/` debris (unchanged from Day 1, unrelated to Day 2 code). My changes are not implicated.

---

## 2. What was already implemented before Day 2

- The full collect → evidence → fusion pipeline, fault isolation, and the single evidence write path (`packages/osint-engine`).
- A rigorous extractor contract: extractors name a **path** into a collector's result; `resolveClaims` reads the value and decides strength (DERIVED iff the path passes through a `derived` block). Entities resolve only by a stated identifier; people/organisations never by name (`packages/osint-engine/src/fusion/identifiers.ts`, DB-enforced).
- Real extractors for `crtsh`, `dns`, `rdap`, `wayback`, `contact.phone`, `wikidata`, `github`, `hackernews`, `devto`, `commoncrawl`. The GDELT `news` extractor and the monitoring collectors (`bluesky.search`, `reddit.search`, `rss.*`) were "checked-only" (parsed the result, drew nothing).
- Evidence-grounded AI synthesis (`packages/osint-engine/src/reports/synthesis.ts` + `packages/llm`): a real configurable OpenAI-compatible provider, citation validation, token metering, prompt-injection framing/guards, and honest `{ unavailable }` when no provider is configured.
- The report generator (`generator.ts`): three-step claim/assemble/record, retries by cause, per-attempt metering, PDF/JSON/CSV/Maltego exports — but **without** a person-gate re-check at generation time (tracked as D-34).
- The API report routes were already person-gated at request time (`POST/GET /runs/:id/reports`, `GET /reports/:id`).

## 3. What was changed, and why

1. **`news` extractor rewritten to draw a graph (Priority A).** GDELT news was the one broadly-useful collector that ran by default (PERMITTED) yet produced evidence with no entities/claims, so investigations on a domain or topic showed an empty graph. The extractor now draws the honest, schema-supported shape. The design respects the collector's own documented constraints: GDELT's `seendate` is "seen by GDELT", not publication time (so the claim is named `news_seen_by_gdelt_at` and is DERIVED), and `outletCountry` is the publisher's country, never an event location (so it stays a claim, never a `LOCATION`). The articles-as-items model from the monitoring plan (`NARRATIVE`/`HASHTAG` kinds, an `items` table) is **not** built yet, so articles are modelled with the existing `URL`/`DOMAIN` entity kinds — no migration required.
2. **Report-generation person-gate re-check added (Priority B / D-34).** A report is a read of stored data; CLAUDE.md §9 requires the person gate to apply to reads, and the case-analysis job and SSE stream already re-check on each read. The report job did not. It now re-checks `personGate` over the run's data (`{ runJobs: runId }`) on the same snapshot as the assembly read, before any claim is read or sent to a model. A refusal fails the report with the gate's code (`MODULE_NOT_IN_PLAN` / `VETTING_NOT_APPROVED`), never a partial or ungated report.
3. **Tests** updated/added to prove both (Priority A/B and E).

No collector verdicts were changed; no collector was enabled; no scraping, proxy or restriction-evasion was added; no schema migration was written; no dependency was added.

## 4. Files changed

Source (2):

- `packages/osint-engine/src/fusion/extractors.ts` — real `news` extractor (replaces the checked-only stub). The monitoring collectors (`bluesky.search`, `reddit.search`, `rss.*`) remain checked-only (their item model is Track M, unbuilt).
- `packages/osint-engine/src/reports/generator.ts` — person-gate re-check before assembly (new `ReportAccessError` carrying the gate's code; added to `REPORT_FAILURES`; `personGate` imported from `@repo/access`).

Tests (3):

- `packages/osint-engine/test/units.test.ts` — moved the two `news` cases from "draws nothing" to the `FOUND_CASES` suite (so the existing rigorous generic validator exercises them), and added a focused deterministic news-extractor test (URL per article, one deduped outlet DOMAIN, no PERSON/ORG/LOCATION, `published_by` edges only, REPORTED vs DERIVED strengths, null fields drop, nothing counted).
- `packages/osint-engine/test/pipeline.test.ts` — the GDELT end-to-end test now asserts the articles are drawn into the graph (URL + DOMAIN entities, `published_by` relationships, every claim citing the one GDELT evidence row, strengths ⊆ {REPORTED, DERIVED}, no PERSON/ORG) instead of asserting an empty graph.
- `packages/osint-engine/test/reports.test.ts` — added a RELEASE-BLOCKING test that a report on a person-bearing run for an unentitled tenant is refused with the gate's code and reads nothing.
- `apps/api/test/gdelt-topic-runs.test.ts` — a RELEASE-BLOCKING cross-package test that ran a TOPIC GDELT run through the API and asserted the evidence had `claimCount: 0` ("nothing drawn yet"). Updated to keep every registry-labelling check exact (source label, GDELT attribution + link, REPORTED strength, run id) and assert `claimCount > 0` now that articles are drawn. (This is the one place the behaviour change rippled beyond `packages/osint-engine`; a repo-wide search confirmed no other test assumed news draws nothing — the remaining `claimCount: 0` matches are web UI fixtures unrelated to GDELT.)

Day 1 baseline files already in the working tree (unchanged by Day 2): `apps/web/src/test-setup.ts`, `apps/web/vite.config.ts`.

**Migrations changed: none.** The change uses existing tables (`entities`, `entity_relationships`, `claims`) and existing entity kinds (`URL`, `DOMAIN`).

## 5. Evidence-to-graph workflow and data provenance

For a run whose GDELT job is FOUND, fusion (`RunFusion.fuseRun`) calls the `news` extractor once, in the job's tenant transaction, and persists through the existing repositories:

- **Entities:** one `URL` per article (identifier = normalised article URL; an unparseable URL gets no identifier and is never merged), one `DOMAIN` per outlet (identifier = normalised domain; deduped across articles and case). No `PERSON`/`ORGANIZATION`/`LOCATION` is ever created from article text.
- **Relationships:** `URL --published_by--> DOMAIN`, and only that — the one edge the article record states. No article-to-article or co-mention edge.
- **Claims (each citing the single GDELT evidence row, index 0):** `news_title`, `news_language`, `news_outlet_country`, `news_seendate`, `news_mobile_url`, `news_social_image_url` at REPORTED (the collector's strength); `news_seen_by_gdelt_at` at DERIVED (the collector's parse of GDELT's compact date). A null field asserts nothing (dropped by `resolveClaims`).
- **Provenance:** every claim references the evidence row (GDELT's search response), whose raw payload is content-hashed in the store and whose `source_url` is the GDELT API URL. Each article's own link is preserved as the `URL` entity's identifier/display name. Nothing is invented; absent values are null, never a placeholder or zero; no figure counts coverage.
- **Timeline:** the timeline is evidence-granular (`evidence.observed_at` / `collected_at`). GDELT gives no single date for the list, so the one news evidence row carries `observed_at = null` and `collected_at` set — shown honestly. Per-article seen-times live as the DERIVED `news_seen_by_gdelt_at` claims. Per-article timeline rows would require a collector-level evidence-model change and are **not** faked (see gaps, P2).

## 6. AI-provider status and citation validation

- **Provider wiring (verified built, needs config to run live):** `packages/llm` has one real `OpenAiCompatibleProvider` doing HTTP to `${baseUrl}/chat/completions`, with timeout, truncation/empty-output refusal, and a refusal of any response lacking token usage (unmeterable). Endpoint, key and model come from `@repo/config`, never hard-coded. Model routing is task-based (small for extraction/classification, large for synthesis) against the licence allowlist in `packages/config/src/llm.ts`.
- **Evidence-first synthesis (verified built):** the model receives only the report's own claims as delimited untrusted records (`frameUntrusted`), never raw application data. Every statement must cite refs that exist in the supplied records; `validateCitations` rejects unknown/invalid refs, and the synthesis maps refs → evidence numbers and throws if any unknown ref survived. Strengths are limited to CORRELATED/INFERRED/HYPOTHESIS. Output guards reject instruction-echo, markup leaks, calls to action and risk verdicts. A rejected answer is retried once with a fixed-text correction (never the model's rejected words), then fails the report.
- **Failure handling (verified built + mock-tested):** provider-not-configured → `LlmNotConfiguredError` → report FAILS with that reason (deterministic, non-synthesis reports still succeed); unavailable → retry with backoff, then fail on the last attempt; rejected/invalid/quota → fail at once with the code. A provider failure never yields a report presented as AI-verified. Covered by existing tests in `reports.test.ts` and `packages/llm`.
- **D-34 (new, verified):** report generation now re-checks the person gate before reading the run's claims — the model cannot be fed person data the tenant may no longer access.
- **No live model call was made in Day 2.** To exercise live synthesis in an authorized environment, set (in the shell/secret manager, never a committed file): `LLM_HOSTED_BASE_URL`, `LLM_HOSTED_API_KEY`, optionally `LLM_PROFILE=hosted`, `LLM_SMALL_MODEL`/`LLM_LARGE_MODEL` (allowlisted), and `LLM_MODEL_NAMES`. The Phase 5 record used Groq with an allowlisted Qwen model.

## 7. Tests executed, and their actual results

All run on Windows, Node 24, pnpm 12, against the local Dockerised Postgres + Redis.

- `pnpm --filter @repo/osint-engine exec vitest run test/units.test.ts` → **54 passed** (includes the new focused news-extractor test).
- `pnpm --filter @repo/osint-engine exec vitest run test/reports.test.ts` → **27 passed** (includes the new D-34 refusal test; existing synthesis/unavailable/retry tests unchanged).
- `pnpm --filter @repo/osint-engine test` → **12 files, 188 tests, all passed** (the GDELT end-to-end integration test among them).
- `pnpm turbo typecheck` → **25/25 tasks green.**
- `pnpm --filter @repo/osint-engine lint` (ESLint, `--max-warnings 0`) → **clean.** `prettier --check` on all five changed files → **clean** (two were auto-formatted with `prettier --write`).
- `pnpm --filter @repo/config exec vitest run scripts/person-gate-guard.test.ts` → **90 passed, 1 failed.** The single failure is the `.claude/worktrees/` debris only; my `generator.ts` gate call is **not** flagged (it is a call site, not a copy — like `case-analysis.ts`).
- **A `pnpm turbo test --continue --force` run surfaced a cross-package RELEASE-BLOCKING failure I had missed:** `apps/api/test/gdelt-topic-runs.test.ts` pinned the old "news draws nothing" (`claimCount: 0`) at the API layer. I fixed it (above) and re-verified: `pnpm --filter @repo/api exec vitest run test/gdelt-topic-runs.test.ts` → **3 passed**.
- **Final authoritative `pnpm turbo test --continue --force` (0 cached, everything fresh under contention, 4m43s): 26 of 27 tasks green.** Every package test suite passes — access 6 files, **api 29**, case-engine 3, collectors 22, core 4, db 19, integrations 9, llm 6, **osint-engine 12**, ui 5, **web 23**, worker 1. The **only** failing task is `@repo/config#test` → `person-gate-guard.test.ts` "finds the gate's pieces only in their homes", caused solely by the untracked `.claude/worktrees/` debris (P1 below). No Day-2 code is implicated.

Deterministic fixtures only — no test depends on live GDELT or a live model. **No live collection and no live AI synthesis were performed or claimed.**

## 8. Security and tenant-isolation checks performed

- **Person gate (verified):** the new report-generation re-check uses the shared `personGate` + `restsOnPersonData` probe (no local copy); the RELEASE-BLOCKING `person-gate-guard.test.ts` passes on all tracked code (90/91; the one failure is unrelated debris). A person-bearing run is refused for an unentitled tenant with the gate's code, reading nothing (new test).
- **No fabrication (verified):** the fabrication gate was exercised by the full test run; the news extractor invents no names/dates/relationships, drops null fields, and counts nothing. Strengths are decided mechanically by `resolveClaims`, never by the extractor.
- **No name-based identity (verified):** the extractor creates no PERSON/ORGANIZATION/LOCATION; entity resolution for URL/DOMAIN is by normalised identifier (DB-enforced one-per-identifier). Reversible-merge and evidence-append-only invariants are untouched.
- **Tenant isolation (verified, unchanged):** all new reads/writes go through `withTenant`/RLS repositories; no new raw SQL in application code. The DB-backed tests run under tenant context; cross-tenant isolation tests in `@repo/db` still pass.
- **Untrusted content (verified built):** collected content remains untrusted — article fields are stored as claim values and, for synthesis, passed only via the delimited untrusted-data frame with injection guards.
- **No secrets** were added to source, fixtures, logs or reports. No provider credentials were introduced.

## 9. Remaining gaps (classified)

- **P0 — none introduced.** (The full-suite red is pre-existing debris, below.)
- **P1:**
  - *(now closed)* D-34 report-generation person-gate re-check.
  - **`.claude/worktrees/` debris blocks the full gate.** Untracked leftover workflow worktrees contain package copies that trip `person-gate-guard.test.ts` (and Prettier `format-check`). Not Day-2 code. Remedy (your call; a deletion/config change, so left untouched): remove `.claude/worktrees/` (keep `.claude/skills/`), or gitignore it, or run pipelines from a clean worktree as the plan author does.
- **P2 (Day 3):**
  - Monitoring extractors (`bluesky.search`, `reddit.search`, `rss.*`) still draw nothing; their item model (Track M `items`/`narratives` tables) is unbuilt. Not needed for the GDELT demo.
  - Per-article timeline would need the news collector to emit per-article evidence (a collector evidence-model change); deliberately not faked.
  - Live AI-synthesis checkpoint against a configured provider (needs config + authorization).
- **P3 (later):** `NARRATIVE`/`HASHTAG` entity kinds and the full items model; a dedicated API/graph assertion for news-shaped results (the generic graph/entity reads already surface them).

## 10. Environmental blockers

- The full `pnpm test` cannot be fully green while the untracked `.claude/worktrees/` debris exists (P1 above). Per-package and targeted runs are green.
- A live GDELT run and a live model call were not performed (no authorized provider configured; GDELT was also observed rate-limiting on 2026-10-15 per the plan). All Day-2 behaviour is proven with recorded fixtures and mocks.
- Local API default port 3000 is occupied by an unrelated container (noted Day 1); irrelevant to the tests, relevant to a live demo.

## 11. Commands to reproduce the key verifications

```sh
# From D:\vestigo, with Docker Postgres + Redis up (docker compose up -d).
# Two shell secrets (never committed):
export AUTH_SECRET=$(node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))")
export VAULT_MASTER_KEY=$(node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))")

pnpm --filter @repo/osint-engine test                 # evidence-to-graph + reports (188 tests)
pnpm turbo typecheck                                   # 25/25
pnpm --filter @repo/osint-engine lint                  # ESLint clean
pnpm --filter @repo/config exec vitest run scripts/person-gate-guard.test.ts   # 90/91; only .claude debris fails
pnpm test                                              # full; only @repo/config#test fails (debris)
```

## 12. Recommended Day 3 priorities

1. Resolve the `.claude/worktrees/` debris (one decision) so the full gate is green, then stand up the minimal CI from the Day-1 plan.
2. An authorized live checkpoint: configure a hosted open-weight provider and run one real GDELT investigation end to end (run → SSE → entities/graph/timeline/evidence → synthesised, cited report → PDF), confirming the citation validator against a real model.
3. If the owner records licence verdicts for the already-built open collectors (DNS/RDAP/crt.sh/Common Crawl/Hacker News/dev.to), a domain investigation gains a far richer graph with no new code.
4. Surface per-run cost/estimate (metering is recorded but not shown) and the credential UI, if the demo needs keyed sources.

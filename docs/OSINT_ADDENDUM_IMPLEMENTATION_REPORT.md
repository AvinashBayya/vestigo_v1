# OSINT Addendum — gap-closure implementation report

Date: 2026-10-21. Scope: implement the justified, missing requirements from the OSINT/UI Addendum, after Days 1–3. Approach per the Addendum's priority rules — P0 (security/integrity), P1 (misleading metadata / missing wiring / source-review gap / doc accuracy), P2 (one bounded analysis improvement), P3 (document). The completed, uncommitted Day-3 baseline is preserved; nothing was committed.

Status legend: **Verified** (a test/command I ran and read) · **Mock/fixture-tested** (recorded stand-in, no live third party) · **Requires configuration** (correct in code; needs an external provider/credential to run live) · **Documented next step** · **Not applicable / out of scope**.

---

## 1. Addendum requirements already satisfied (no change needed)

Verified against the current code (Days 1–3 + this session's reads):

- **§2 UI workflow** — the entry flow is exactly as the Addendum describes: `Search.tsx` (estimate → investigation → run) → `Run.tsx` as a progress view. `POST /estimates`, `POST /investigations`, `POST /investigations/{id}/runs` are the sequence; the read-only estimate preview (collectors that would run + exclusions with reasons) and the collector-health listing exist; there are no per-run collector toggles (planner-driven). **No defect found; no UI change made.** `Settings`, `MapTab`, `MediaTab` and the case Report tab remain explicitly labelled stubs (unchanged). **Verified** by the Day-1 web mapping and existing web tests (23 files, 192 tests).
- **§3 Worker architecture** — generic collector-dispatch with per-source queues, a thin `apps/worker` wrapper, all logic in `packages/osint-engine`. No per-tool worker process exists. All admission checks (plan, entitlement, vetting, scope, credential, quota, rate-limit, circuit-breaker) and evidence provenance are in place. **No microservice was added. Verified**, unchanged.
- **§8 Fixture-backed testing** — collector tests run the real runtime and production admission through an offline fetcher that serves recorded fixtures; unmatched requests fail (status 599, recorded) rather than hitting the internet; fixtures carry provenance and exact host/path matching. **Verified**, unchanged. The one collector added in Day 2 (the GDELT extractor) uses this harness.
- The Day-2 person-gate re-check (D-34) and the Day-3 source-scan fix remain in place.

## 2. Requirements that were missing (and addressed here)

- **§4 A current collector-review inventory did not exist.** `docs/audit/COLLECTORS.md` is the legacy V2 audit (a different repository), not the current catalogue. → Created `docs/audit/COLLECTOR-REVIEW.md` (below).
- **§5 Tool-entry classification** of catalogue-only / blocked entries was not written down for the current catalogue. → Included in `COLLECTOR-REVIEW.md` §C.
- **§6 A bounded external-tool adapter design** was not recorded. → §6 below (design only; nothing built).
- **§7 V2 contradiction analysis was not reclaimed.** The case-engine had coverage/collectors/breakdown but no contradiction review, and the web Overview already has a "Contradictions" NotBuilt stub awaiting a backend. → Implemented the pure capability (below).

## 3. Changes implemented

1. **P2 — Claim contradiction review, reclaimed as a pure case-engine capability.** `caseContradictions(input)` in `packages/case-engine` reports, for each attribute of each entity that two or more stored claims assert *different* values for, the conflicting positions side by side, each with the evidence ids and strengths behind it. It **resolves nothing** (no winner/correct/true field — a structural guarantee the tests pin), **infers nothing** (only compares stated values; nothing from source identity or affiliation), treats agreement as corroboration not conflict, and is deterministic. This reclaims the legacy contradiction engine (INVENTORY KEEP) and fills the capability behind the web's existing "Contradictions" stub.
   - It reads a new, **additive, optional** `attribute`/`value` on `CaseClaim`. Because the osint-engine input mapper does not yet populate those fields and the analysis job does not yet call the function, **`ENGINE_VERSION` is unchanged, the case-analysis input hash is unchanged, and every stored analysis stays valid** — the Day-3 baseline is untouched. The wiring that makes it analyst-visible (input mapper → stored document → job → API read → web stub) is the **documented next milestone** (§10); it is a contract change (document schema + regenerated API client) deliberately kept out of this bounded slice to protect the milestone.
2. **P1 — Collector-review inventory + tool classification** (`docs/audit/COLLECTOR-REVIEW.md`), grounded in the code with `file:line` references, with the §4 columns and the §5 classification. **No source verdict was changed.**
3. **P0** — none required: no confirmed security/integrity defect was found in the current code to fix in this workstream.

## 4. Files changed

- `packages/case-engine/src/analysis/case-input.ts` — `CaseClaim` gains optional `attribute`/`value` (additive).
- `packages/case-engine/src/analysis/case-contradictions.ts` — **new** pure contradiction module.
- `packages/case-engine/src/index.ts` — exports the new function and types.
- `packages/case-engine/test/case-contradictions.test.ts` — **new** unit tests (6).
- `docs/audit/COLLECTOR-REVIEW.md` — **new** inventory + classification.
- `docs/OSINT_ADDENDUM_IMPLEMENTATION_REPORT.md` — this report.

No migration, no new dependency, no change to `catalogue.ts`, the registry, the worker, the API contract, or the web. Nothing committed.

## 5. Source-policy reviews performed, verdicts changed

**None changed.** Recording a verdict is an owner decision made by reading a source's terms (`audited(row, url)` in `catalogue.ts`), and I did not do that. `COLLECTOR-REVIEW.md` lists, for each gated source, the terms an owner must read and the next action, and keeps every source fail-closed. The review's recommendation (lowest-risk first) is to record verdicts for the already-built, keyless open collectors (`crtsh`, `dns`, `rdap`, `wayback`, `commoncrawl`, `hacker-news`, `devto`, keyless `github`) — which would make fully-tested collectors run with real extractors and no further code — but that remains the owner's call.

## 6. External-tool adapter design (§6, design only — nothing built)

SpiderFoot, theHarvester, SearXNG and IVRE are **CATALOGUE-ONLY** entries with `network: null` ("Phase 4"); they need a separate executable/container. **No container was added.** If/when one is justified, the design reuses the existing collector runtime rather than a new microservice:

- A collector per tool, registered in the existing registry, declaring its source, discipline, target types, a strict Zod `resultSchema`, a run budget, and (where needed) vault credential ids.
- Dispatch through the existing per-source `collect.<source>` queue and the existing `CollectorJobProcessor` → `CollectionExecutor` → single evidence path, so provenance, content-hashing, idempotency, retry-by-cause, bulkhead and circuit-breaker all apply unchanged.
- The adapter calls the tool's own HTTP service over a bounded `fetch` (mandatory timeout, size cap), fails closed (`UNAVAILABLE`) when the service is absent, and exposes health as the collector's outcome.
- Source attribution and the licence verdict come from the catalogue entry; evidence is persisted canonically.
- Deterministic fixtures through the offline harness; the external service is never contacted in ordinary tests.
- **Licence/authorisation gates first:** theHarvester is GPL-2.0 and SearXNG AGPL-3.0 (a legal review precedes any shipping); IVRE and any active reconnaissance stay behind the scope-authorisation/collection-mode gate; **no proxy rotation or restriction evasion.** Choose **at most one** (theHarvester is the most contained: passive, HTTP worker) when a phase is approved; the others are documented for later.

## 7. Tests executed and actual results

- `pnpm --filter @repo/case-engine test` → **4 files, 87 tests pass**, including the 6 new contradiction tests (disagreement → reviewable positions; agreement → none; relationship/value-less/attribute-less claims ignored; evidence+strengths preserved and ordered; deterministic regardless of order; structurally-equal object values not treated as a conflict) and the RELEASE-BLOCKING `purity.test.ts` (the new module stays pure). **Verified.**
- `pnpm turbo typecheck` → **25/25 green** (the additive `CaseClaim` change compiles across every consumer). **Verified.**
- `pnpm --filter @repo/osint-engine test` → **12 files, 189 tests pass** — the case-analysis path (input hash, stored documents) is unchanged by the additive type. **Verified.**
- `pnpm --filter @repo/case-engine lint` → ESLint clean; the two new TS files are Prettier-clean. **Verified.**
- Full `pnpm test` (authoritative baseline, with the Day-3 `.claude` scan-scope fix): **27/27 turbo tasks green, exit 0, zero failures** (3m38s) — access 6, api 29, case-engine 4, collectors 22, config 12, core 4, db 19, integrations 9, llm 6, osint-engine 12, ui 5, web 23, worker 1. This is the first fully-green full-suite run of the delivery: the Day-1 web-lazy-route blocker, the Day-3 `.claude` person-gate-guard blocker, and this workstream are all resolved. The release-blocking gates (fabrication-check, check-exports, person-gate guard, cross-tenant isolation) pass. **Verified.**

All tests are deterministic and offline. **No live OSINT scan or external collection was run.**

## 8. Capabilities still absent, blocked, or unverified

- **Contradiction review is computed by a pure function but not yet analyst-visible** — the input mapper, stored document, API read and web stub wiring is the documented next milestone (§10). **Documented next step.**
- **Monitoring collectors** (`bluesky.search`, `reddit.search`, RSS) remain gated (UNVERIFIED) **and** have checked-only extractors — they add nothing to the graph until both a verdict and Track-M item extractors land. **Blocked / out of scope.**
- **Tool containers** (SpiderFoot/theHarvester/SearXNG/IVRE) — design only; need a container + licence review + verdict. **Documented next step.**
- **Keyed/licensed sources** (Brave, YouTube Data API, HIBP, Kpler) — need a collector + credential + verdict. **Requires configuration.**
- **Source credibility / cross-source comparison / competing hypotheses** (other §7 capabilities) — not reclaimed; each needs the same input extension + wiring as contradictions. **Documented next step.**
- No media forensics / OCR / transcription / vision service was built (correctly out of scope).

## 9. Remaining Day-3 / release-readiness issues (unchanged by this workstream)

- A live end-to-end **cited AI report** remains **Blocked** on an authorized LLM provider (Day-3 §10); no live GDELT or model call has been performed.
- The owner's untracked `Vestigo_Global_News_Providers_and_APIs.md` still trips local `format-check` (absent in a clean CI checkout).
- CI (`.github/workflows/ci.yml`) is authored but has not been observed running on GitHub.
- Days 1–3 and this workstream are **uncommitted** on `main`.

## 10. Recommended next milestone

1. **Surface contradictions to the analyst** (the wiring this slice scoped out), as a bounded vertical: extend the case-scope claims read with `attribute`/`value`; map them in `case-analysis/input.ts`; add an optional `contradictions` field to the stored `CaseAnalysisDocument` (kept optional so older stored documents still read); compute it in the case-analysis job; bump `ENGINE_VERSION` (stored analyses become STALE, the designed behaviour); add `contradictions` to the case-analysis read response schema and regenerate the API client; fill the web Overview "Contradictions" panel. Update the pinned version/document/API tests to the new-correct shapes (never weakened).
2. **Owner records verdicts** for the already-built open collectors (COLLECTOR-REVIEW §A/recommended order) to light up a rich live graph with no new code.
3. The authorized live checkpoint from Day-3 §11.
4. Then, if prioritised, one external-tool adapter (theHarvester) per §6, behind its licence review and a container.

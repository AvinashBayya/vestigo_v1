# M4-1 — deterministic contradiction analysis, integrated

Date: 2026-10-22. Branch `milestone/vestigo-days-1-3-osint-addendum`; **nothing committed, pushed, reset, or cleaned**. No source verdict changed, no authorization created, no live request, no LLM introduced. The work is deterministic and evidence-grounded throughout.

## Outcome

`caseContradictions` — the pure, tested contradiction-review function that had zero callers — now runs inside the real case-analysis pipeline. For every case analysis, the conflicting claims are **generated** (by the analysis job), **persisted** (in the stored analysis document), **reflected** in the discipline breakdown (the TECHINT `CONTRADICTIONS` metric, previously `CONTRADICTION_DETECTION_NOT_BUILT`, is now a measured count), and **retrievable** through the real tenant-scoped case-analysis API. Each surfaced conflict carries its supporting evidence ids and strengths, both positions are kept side by side, and nothing is resolved, merged, or inferred.

## Files changed

| File | Change |
|---|---|
| `packages/db/src/repositories/case-scope.ts` | The case-scope claims read now also selects `attribute` and `value` (so the analysis can see what each claim asserts). Added to the projection and the `CaseScopeRecords.claims` type. |
| `packages/osint-engine/src/case-analysis/input.ts` | `readCaseAnalysisInput` maps `attribute` and `value` onto each `CaseClaim`; the module doc notes the input hash now covers them. |
| `packages/case-engine/src/version.ts` | `ENGINE_VERSION` 7 → 8, with a version-8 note (contradiction review runs; the breakdown measures it; the document gains a `contradictions` field). |
| `packages/case-engine/src/analysis/case-breakdown.ts` | `caseBreakdown` computes `caseContradictions(input)` once and passes it to each discipline `section`; the `CONTRADICTIONS` metric is now a measured `counted(...)` of the discipline's contradicted entities, instead of `NOT_BUILT`. New helper `contradictedEntities`. |
| `packages/osint-engine/src/case-analysis/document.ts` | `CaseAnalysisDocument` gains an optional `contradictions?: CaseContradictions`; `CaseAnalysisDocumentSchema` gains `CaseContradictionsSchema.optional()` (mirrors the case-engine type exactly via `satisfies`). |
| `packages/osint-engine/src/jobs/case-analysis.ts` | The analysis job assembles `contradictions: caseContradictions(read.input)` beside coverage/collectors/breakdown. |
| `packages/case-engine/test/case-analysis.test.ts` | Updated the breakdown-metrics assertion (CONTRADICTIONS is now measured zero for the fixture); added a test proving per-discipline attribution (conflict counted under TECHINT; agreement and SOCMINT-only conflicts not counted under TECHINT). |
| `packages/osint-engine/test/case-analysis-job.test.ts` | Added a DB-backed test: conflicting stored claims → the stored document carries the contradiction (positions, evidence, strengths, caveat) and the TECHINT metric counts it. |
| `apps/api/test/case-analyses.test.ts` | The COMPLETE-read test now asserts the contradictions field (and its caveat) is served through the real API. |

No new routes, no migration (the `attribute` and `value` columns already exist on `claims`), no UI change (see gaps).

## How contradiction analysis now flows through the real pipeline

1. A case analysis is requested through `POST /api/v1/cases/:id/analyses` (unchanged). The job reads the case's stored records via `readCaseAnalysisInput`, which now includes each claim's `attribute` and `value`.
2. The job (`CaseAnalysisProcessor.#analyse`) assembles the document: `coverage`, `collectors`, `breakdown`, **and `contradictions: caseContradictions(read.input)`** — all pure, deterministic, passive (no network, no clock, no randomness, no LLM). The person gate is re-checked first on one snapshot (D-28), exactly as before; contradictions read only the already-gated claims, so no new gate is needed.
3. `caseContradictions` groups claims by `(entityId, attribute)` and reports each attribute two or more claims assert *different* values for, with each distinct value's evidence ids and strengths. It resolves nothing, infers nothing, and treats agreement (one value from many sources) as corroboration, not a contradiction.
4. `caseBreakdown` computes the same contradictions and, for each discipline, counts the contradicted entities whose conflict is supported by that discipline's evidence — the TECHINT `CONTRADICTIONS` metric. A contradiction counts under every discipline whose evidence backs it (the existing `ENTITY_AND_RELATIONSHIP_COUNTS_OVERLAP` caveat), and the complete, case-wide set is the document's own `contradictions` field.
5. The document is validated against `CaseAnalysisDocumentSchema` before it is recorded, and again when read (CLAUDE.md §7).
6. `GET /api/v1/cases/:id/analyses` and `GET /api/v1/case-analyses/:id` (permission `case:read`, tenant-scoped, person-gated) return the stored document, now including `contradictions`.

## API / document contract changes

- `CaseAnalysisDocument` (and its Zod schema, from which the OpenAPI spec and the web client are generated) gains **one optional field**: `contradictions`, a `CaseContradictions` = `{ items: Contradiction[]; caveat: string }`, where each `Contradiction` is `{ entityId, attribute, positions }` and each `ContradictionPosition` is `{ value, evidenceIds, strengths }`.
- The breakdown's TECHINT `CONTRADICTIONS` metric value changes from `{ count: null, ids: null, reason: "CONTRADICTION_DETECTION_NOT_BUILT" }` to a measured `{ count, ids }` (the contradicted entity ids; `count === ids.length`, following the breakdown's `counted(...)` convention). `MEDIA_CLAIMS`, `MEDIA_CONFLICTS` and `LOCATION_HYPOTHESES` remain `NOT_BUILT`.
- Both changes are **additive**: no field was removed or renamed, no route added, no permission changed. `CONTRADICTION_DETECTION_NOT_BUILT` stays a defined value so documents stored before version 8 still parse.

## Versioning and old-analysis behavior

- `ENGINE_VERSION` is bumped to **8**. It is part of every analysis's input hash, and the input now also carries each claim's attribute and value, so a case's current input hash differs from any analysis stored before this change.
- A stored pre-8 analysis therefore reads **STALE** — its document (without a `contradictions` field) still parses, is still shown as of when it ran, and is **never reinterpreted** as having run contradiction detection. Requesting the analysis again computes a fresh version-8 one. This is exactly the existing stale-analysis contract, and the existing regression test that stores an `engineVersion: 4` document and reads it STALE still passes (the new field is optional, so old documents parse unchanged).
- The stored-document `formatVersion` stays `1`: an optional additive field keeps every stored document parseable, so no format migration is needed.

## Tests executed and results (exact commands)

| Command | Result |
|---|---|
| `pnpm --filter @repo/case-engine test` | **4 files, 88 passed** (incl. the new per-discipline attribution test; updated metric assertion) |
| `pnpm --filter @repo/osint-engine exec vitest run test/case-analysis-job.test.ts` | **19 passed** (incl. the new DB-backed contradiction persistence test) |
| `pnpm --filter @repo/api exec vitest run test/case-analyses.test.ts` | **27 passed** (incl. the API retrievability assertion) |
| `pnpm --filter @repo/osint-engine test` | **13 files, 209 passed** (full suite: pipeline, all case-analysis, the new test) |
| `pnpm --filter @repo/db test` | **19 files, 305 passed** (case-scope projection change unregressed) |
| `pnpm --filter @repo/api exec vitest run test/route-access.test.ts test/credentials.test.ts` | **12 passed** (RELEASE-BLOCKING; the schema compiles into the OpenAPI spec cleanly) |
| builds (`@repo/case-engine`, `@repo/db`, `@repo/osint-engine`) + lint + prettier | typecheck exit 0; ESLint clean; prettier clean |

Real Postgres + Redis are provided by the suites' own test infrastructure (Docker Compose, `docker compose up -d --wait`).

What the new tests pin: two genuinely conflicting claims surface as a contradiction with traceable evidence and strengths; agreement (same value, many sources) and different-attribute/different-context claims are **not** reported (the function's existing rules); a contradiction's per-discipline attribution counts only where that discipline's evidence backs it; the stored document carries the contradiction and the breakdown metric; the API serves the field tenant-scoped; the person gate and citation (evidence-id) requirements are unchanged; a pre-version document reads STALE and still parses.

## Remaining UI and analysis gaps

- **UI:** the web workspace does not render case-analysis discipline metrics or a contradictions view today (it was not built while every metric was `NOT_BUILT`). The contradictions are now served through the existing API contract, so **no UI change was required for this task** (Step 10). Surfacing them to analysts — a "Contradictions" panel listing each entity/attribute's conflicting positions with their evidence — is a small, additive follow-up. When it is built, regenerate the web client types (`apps/web` generate-client step); the new `contradictions` field is additive, so existing web code is unaffected until then.
- **Analysis:** contradiction detection compares *stored claim values*. It is only as rich as the claims collectors produce — which today come from structured collector results, not from article body text (that is the separate M4-2 "persist and analyse article text" task). The other breakdown metrics (`MEDIA_CLAIMS`, `MEDIA_CONFLICTS`, `LOCATION_HYPOTHESES`) remain `NOT_BUILT` and are out of scope here.

## Conclusion

**Yes — contradictions are now generated, persisted, and retrievable through the real case-analysis workflow, not merely tested as a pure function.** The analysis job computes them from the case's stored claims, stores them in the validated document with their evidence and strengths, reflects them in the TECHINT breakdown metric (no longer `NOT_BUILT`), and serves them through the tenant-scoped, person-gated API. The work is deterministic, evidence-linked, additive, and fail-closed: old analyses read STALE rather than being reinterpreted, and nothing resolves, merges, or invents a conflict the evidence does not support.

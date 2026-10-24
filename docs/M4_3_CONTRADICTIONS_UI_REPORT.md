# M4-3 — contradictions in the analyst workspace

Date: 2026-10-23. Branch `milestone/vestigo-days-1-3-osint-addendum`; **nothing committed, pushed, reset, or cleaned**. No live publisher request, no source-verdict change, no new LLM dependency, no weakening of evidence, authorization or security controls. The work reuses the persisted contradiction results from M4-1 and the generated API contract.

## Outcome

An analyst can now **see persisted contradictions in the workspace and navigate back to the supporting evidence**. The Overview tab's "Contradictions" card — previously a "not built" placeholder — now reads the case analysis through the generated client and shows each conflicting claim: its attribute and entity, every stored position with its value, strength and a link that opens the supporting evidence in the provenance drawer, and the analysis's own neutral caveat. It renders the read's states honestly (none yet, running, failed, stale, complete, empty) and a person-gated refusal as the shared Locked state. It invents no severity, confidence, cause or resolution, and never merges conflicting claims.

## API-to-UI flow

1. **Engine → API (unchanged, M4-1).** `GET /api/v1/cases/{id}/analyses` returns `CaseAnalysisRead`, whose `analysis.document.contradictions` carries `{ items: [{ entityId, attribute, positions: [{ value, evidenceIds, strengths }] }], caveat }`. The endpoint is permission-gated (`case:read`), tenant-scoped, and person-gated — all enforced by the API, unchanged here.
2. **Spec → client (regenerated).** The generated client was stale: M4-1 added `contradictions` to the schema but never regenerated the client (noted in the M4-1 report). I rebuilt the spec and regenerated the client with the project's own commands — `pnpm --filter @repo/api build` (emits `apps/api/openapi.json`) then `pnpm --filter @repo/web run generate` (writes `apps/web/src/client/`). Both are gitignored build artifacts, never hand-edited. The client now types the analyses endpoints and the contradictions shape.
3. **Client → query.** `caseAnalysisQuery(id)` (`apps/web/src/workspace/queries.ts`) reads the endpoint through the generated client and the shared `unwrap`/`timed` helpers — the same path, timeout, and error handling as every other workspace read.
4. **Query → panel.** `Contradictions` (`apps/web/src/workspace/Contradictions.tsx`) renders it inside the Overview, using the existing design system (`Card`, `Notice`, `StrengthBadge`, `LoadingState`, `Skeleton`, `NotBuilt`) and the existing `Loaded` state wrapper. Each position's evidence id is a `ProvenanceLink` to `{ kind: "evidence", id }`, so clicking it opens the evidence in the workspace's provenance drawer — the existing navigation.

## Files changed

| File | Change |
|---|---|
| `apps/web/src/workspace/Contradictions.tsx` | **New.** The Contradictions panel: states (none/pending/failed/stale/complete/empty, absent-field), the conflict list, and evidence links. |
| `apps/web/src/workspace/OverviewTab.tsx` | Replaced the "Contradictions… the API does not have" placeholder with `<Contradictions scope={scope} />`. |
| `apps/web/src/workspace/queries.ts` | Added `caseAnalysisQuery` and the `CaseAnalysisRead` type (the named schema component the endpoint `$ref`s). |
| `apps/web/src/contradictions.test.tsx` | **New.** 10 tests over the real generated client and a fetch stub. |
| `apps/web/src/client/` + `apps/api/openapi.json` | Regenerated (gitignored build artifacts), so the client types the contradictions field. |

No new routes, no API source change, no migration, no hand-written duplicate of the API contract. The panel's small internal view type is only the fields it renders (the full generated read is assignable to it); it exists to sidestep a TypeScript limit (TS2719) on comparing the deep, union-heavy generated type at a prop boundary, not to restate the contract — the query and types still come from the generated client.

## Tenant access and person gates

Unchanged and intact: the analyses endpoint enforces `case:read`, tenant scoping, and the person-data gate server-side. When the API refuses with a `locked` block (person gate) the panel shows the shared **Locked** state (module summary and next step), not an error and not any contradiction content — proven by a test. A stale analysis is shown as of when it ran, marked stale, and never reinterpreted; an analysis stored before contradiction review existed (no `contradictions` field) is labelled as predating it rather than shown as "no contradictions".

## Tests and outcomes (exact commands)

| Command | Result |
|---|---|
| `pnpm --filter @repo/web exec vitest run src/contradictions.test.tsx` | **10 passed** |
| `pnpm --filter @repo/web test` | **24 files, 202 passed** (no regression) |
| `pnpm --filter @repo/web exec tsc -b` | clean (the panel compiles against the regenerated client) |
| `pnpm --filter @repo/web lint`; prettier on changed files | ESLint clean; prettier clean |
| `pnpm --filter @repo/api build` + `pnpm --filter @repo/web run generate` | spec emitted and client regenerated |
| `pnpm --filter @repo/api exec vitest run test/route-access.test.ts test/credentials.test.ts` | **12 passed** (the emitted spec is valid; contract consistent) |

The 10 panel tests cover: a real API-shaped result with multiple conflicting positions, their values, strengths and evidence links; navigating from a position to its supporting evidence (the provenance drawer opens on that evidence, read through the real client); empty (no contradictions); NONE_YET, PENDING and FAILED (with its code); a STALE analysis (marked, still shown); an analysis whose document predates the field; a person-gated 403 rendering as Locked (no contradiction leaked); and a run scope pointing to a case. Everything runs offline over a fetch stub, through the generated client (contract compatibility).

## Limitations

- **The panel reads; it does not request or re-run an analysis.** When none has run (NONE_YET), or the shown one is stale, it says so and tells the analyst to request an analysis, but the Overview has no "request analysis" button yet — requesting is a separate `case:analyse` action. A one-click request from the panel is a small, additive follow-up.
- **The entity is shown by name only when it is in the case's entity list** (read for the Overview anyway); past the list's 500-row cap it falls back to a short id. The positions always link to their evidence regardless.
- **Contradiction review is case-scoped**, so the run Overview points to a case rather than showing contradictions — matching the engine (M4-1 compares a case's pinned sources).
- Values are shown verbatim (string) or as JSON; there is no severity, confidence or ranking, by design — the API provides none and none is invented.

## Remaining intelligence-analysis gaps

- Surfacing the rest of the case-analysis document (coverage, collectors, the discipline breakdown including its measured metrics) in the workspace is not done here; only contradictions are.
- A "request analysis" / refresh action from the workspace (the panel currently reflects whatever analysis exists).
- The deeper analysis gaps remain as before: attribute-value claims and named entities/events from article prose are the LLM-assisted increment (M4-4), which would feed more substantive claims into the same contradiction review this panel now displays.

## Conclusion

**Yes — an analyst can view persisted contradictions in the workspace and navigate back to the supporting evidence.** The Overview's Contradictions card reads the case analysis through the (regenerated) generated client, renders each conflicting position with its value, strength and a link that opens the supporting evidence in the provenance drawer, and shows the analysis's own caveat that a contradiction is conflicting evidence, not a verdict on which source is true. Loading, empty, stale, failed and person-gated states are all handled honestly; nothing is invented, merged, or resolved; and no evidence, authorization or security control was weakened.

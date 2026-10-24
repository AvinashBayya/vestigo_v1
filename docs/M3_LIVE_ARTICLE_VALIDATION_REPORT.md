# M3 — controlled live-article validation and M4 readiness

Date: 2026-10-22. Branch `milestone/vestigo-days-1-3-osint-addendum`; **nothing committed, pushed, reset, or cleaned**. No source verdict changed, no authorization created, **no real publisher contacted**.

## Status: **BLOCKED ON HUMAN APPROVAL**

A controlled live request was **not** authorized and **not** made. The exact-article path is proven offline (M1/M2, re-confirmed here), but a live fetch of a real publisher requires three human approvals that are all absent (checklist below). Per the milestone's own rule — "If any approval is missing, STOP before making a live request" — I stopped, changed nothing, and continued with offline verification and the M4 readiness audit.

## Step 1 — current state (inspected, not assumed from reports)

- Git: branch `milestone/vestigo-days-1-3-osint-addendum`, HEAD `156952f` (unchanged). All M0–M2 work is present as uncommitted/untracked and was preserved; the only on-disk change to the article files since M2 is a prettier reformat I made in M1 (mtime 12:34), not an external edit.
- I read the four reports and then verified the **actual current code** rather than trusting them. Findings in Step 2 are from the code as it stands today.

## Step 2 — approval readiness (no source enabled, no authorization created)

**How approval, licensing, expiry and revocation actually work (verified in code):**

- **Source verdict = the collector's approval, and it is code.** `packages/collectors/src/catalogue.ts` declares the `direct-article` source with `commercialUse: "UNVERIFIED"`, `check: null`. The runtime refuses any UNVERIFIED source with `UNVERIFIED_SOURCE_NOT_ALLOWED` unless a test-only replay flag is set (`packages/collectors/src/runtime.ts:259,284`); only `PERMITTED` runs. Changing a verdict is a reviewed **code change** to the catalogue (the file's own comment: "never [automated]"), recorded via a `LicenceCheck` (`audited`/`checked`/`decided`: `checkedOn`, `sourceUrl`, `recordedIn`). There is **no environment flag** that can enable an UNVERIFIED source: `COLLECTORS_ALLOW_UNVERIFIED` was retired 2026-10-16 (`packages/config/src/env.ts:108`); `COLLECTORS_ACCESS_METHODS` only chooses methods and still runs only PERMITTED sources.
- **Tenant authorization = an in-force, exact-target `scope_authorisation`.** For a URL target, the shared gate (`packages/osint-engine/src/scope.ts`) clears it by an in-force **DOMAIN** authorisation for the URL's exact host (no subdomain/parent widening). An authorisation is created only through the authenticated API, `POST /api/v1/scope-authorisations` (`apps/api/src/routes/scope-authorisations.ts:54`): permission `scope_authorisation:write`, **the authoriser is the signed-in person (an API key cannot authorise)**, the target is normalised and matched exactly, a written `basis` (10–2000 chars) records the engagement/permission, and the window is ≤ 366 days. Every create and revoke is in the audit log.
- **Expiry/revocation** are enforced by `findInForce` (`packages/db/src/repositories/work.ts`): a row counts only when `revoked_at is null AND valid_from <= now() AND valid_until > now()`. Revocation sets `revoked_at` and takes effect everywhere at once (the same gate runs at planning and at collection, and on every open stream).
- **No bypass exists.** No dev seed, migration, or other code creates a `scope_authorisation` or flips the `direct-article` verdict (grep confirmed). The gate is not weakened anywhere.

**Checklist — exactly what is still needed before one live request (all three are missing):**

| # | Who | Action | State today |
|---|-----|--------|-------------|
| 1 | **Legal / reviewer (human)** | Review the specific publisher's robots, paywall and terms for a single direct fetch, and record the decision. | Not done — feeds #2. |
| 2 | **Owner (code change)** | In `catalogue.ts`, record a **PERMITTED** verdict for that publisher — a per-publisher source (preferred) or the `direct-article` source — with a `LicenceCheck` citing the review from #1; commit and deploy. | Not done — verdict is UNVERIFIED, `check: null`. |
| 3 | **Tenant member (signed-in, authenticated)** | `POST /api/v1/scope-authorisations` with `targetType: "DOMAIN"`, `target: <publisher host>`, a written `basis`, and a valid window. | Not done — no authorisation exists. |

Until **all three** are in place, the runtime refuses the collector (verdict) and/or admission refuses the target (authorisation). I did not perform any of them, and must not (they are owner/tenant/legal decisions).

## Step 3 — controlled live validation

**Not executed.** Because the approvals in Step 2 are absent, no publisher was contacted and no live request was made. No claim of live validation is made. The next time this milestone is attempted, it can proceed only after the three checklist items are satisfied; the engineering path itself is ready.

## Offline confirmation (what IS proven today)

Re-run on the current on-disk code:

| Command | Result |
|---|---|
| `pnpm --filter @repo/collectors exec vitest run test/platform/article.test.ts test/platform/article-extract.test.ts` | **16 passed** (secure fetch gate, extraction, fail-closed) |
| (M2, unchanged) `pnpm --filter @repo/osint-engine exec vitest run test/pipeline.test.ts` | **37 passed** (incl. the 8 DB persistence tests) |

So the collector → secure fetch → extraction → canonical evidence → tenant-scoped API/UI path is proven **offline against fixtures**. The only thing between it and a real article is the human approval above — not further engineering.

## Step 4 — M4 (intelligence analysis) readiness

Audited the current implementation. **The deterministic spine is solid, integrated and tested; the "analysis over article text" layer is net-new.** The decisive structural fact: **claims are produced only from a collector's parsed/structured result at fusion time — no code reads stored article/evidence body text to produce claims, and the article body text is extracted then discarded.**

| Capability | Status | Det. / LLM |
|---|---|---|
| Claim extraction from **structured** collector results (path → value, mechanical strength) | IMPLEMENTED + INTEGRATED + TESTED | Deterministic |
| Claim extraction from article **body text** | MISSING (text extracted by `extractArticle` but **not persisted** — `ARTICLE_RESULT` keeps only `extractionStatus`) | — |
| Entity creation + resolution by normalised identifier; people/orgs only by external id (never by name) | IMPLEMENTED + INTEGRATED | Deterministic |
| Named-entity recognition from text | MISSING (deliberate: a name never resolves a person/org) | — |
| Event / discrete-event extraction; EVENT entity kind | MISSING ("timeline" = evidence rows by observed/collected time, not extracted events) | — |
| **Contradiction analysis** (`caseContradictions`) | IMPLEMENTED (pure, tested) but **NOT INTEGRATED** — 0 callers; breakdown reports `CONTRADICTION_DETECTION_NOT_BUILT` | Deterministic |
| Evidence graph (entity/relationship/claim tables; graph API + GraphTab; article participates via URL+DOMAIN+`published_by`) | IMPLEMENTED + INTEGRATED | Deterministic |
| Cross-evidence correlation / graph analytics beyond per-run fusion | MISSING (only identifier-resolution + human reversible merges + name-only INFERRED candidates) | — |
| Cited **deterministic** report body (every claim → evidence citation) | IMPLEMENTED + INTEGRATED + TESTED | Deterministic |
| Optional **LLM synthesis** section (CORRELATED/INFERRED/HYPOTHESIS only; citation-validated; retry-once-then-fail; person-gated via D-34 re-check) | IMPLEMENTED + INTEGRATED, **off by default** (`{ unavailable }`) | LLM-assisted |
| LLM infra: open-weight allowlist, delimited untrusted data, schema+citation validation, prompt-injection guards | IMPLEMENTED (production-grade); the `extraction`/`classification` task routes exist but have **zero callers** | LLM-assisted |
| case-analysis job document (`coverage` + `collectors` + `breakdown`), pure, person-gated, validated | IMPLEMENTED + INTEGRATED + TESTED | Deterministic |

Biggest gaps between "stored article evidence" and "cited intelligence analysis": (a) article body text is thrown away, blocking every text-level feature; (b) no text→claim/entity/event extraction; (c) a built, pure, tested `caseContradictions` sits unwired; (d) no cross-evidence correlation; (e) LLM is off by default and only drives optional report synthesis.

## M4 plan — prioritized, incremental, deterministic-first

No broad rewrite. Each task is small, evidence-linked, and shippable on its own.

**M4-1 (recommended FIRST). Wire the existing pure `caseContradictions` into the analysis document, breakdown and API.** Deterministic, lowest cost, highest immediate value — it converts a built-and-tested building block into integrated intelligence with no new analysis logic and no LLM.
- Changes: add a `contradictions` field to `CaseAnalysisDocument` + its schema; call `caseContradictions(input)` in `CaseAnalysisProcessor.#analyse` beside coverage/collectors/breakdown; replace the TECHINT `CONTRADICTIONS` → `NOT_BUILT` metric in `case-breakdown.ts` with the real count/ids; bump `ENGINE_VERSION` (7 → 8); the existing case-analyses API serves the enlarged document unchanged.
- Tests: a case fixture with two claims asserting different values for one `(entity, attribute)` → the document lists the contradiction with both values, their evidence ids, and their strengths, plus the caveat; agreement (same value from many sources) produces none; the breakdown shows the measured count, not `NOT_BUILT`; the analysis stays pure and person-gated (inherits the job's D-28 gate); `ENGINE_VERSION` change forces re-analysis.
- Acceptance: deterministic; every reported contradiction carries its evidence ids and strengths; resolves/infers nothing; no LLM; person gate unchanged.

**M4-2. Persist the extracted article body text as analysable, provenance-preserving data.** Deterministic; unblocks all text-level analysis. Store a bounded, faithful `extractArticle` text as a DERIVED field/claim (never verbatim-as-source, never fabricated), re-derivable from the content-hashed bytes.
- Tests: a FULL_TEXT fixture persists the body text as DERIVED, bounded, and byte-faithful to the extraction; re-derivation from the stored payload is identical; METADATA_ONLY/NO_CONTENT persist no text; nothing is invented.
- Acceptance: text is marked DERIVED with provenance to the evidence; bounded size; deterministic; no change to the REPORTED headline anchor.

**M4-3. Deterministic cross-evidence surfacing in the case document.** With contradictions wired (M4-1), add a deterministic correlation view (e.g. which evidence/claims share an entity) as a pure case-engine module, served in the document. No inference, only stated co-occurrence with citations.
- Tests/acceptance: pure; every correlation cites the evidence that establishes it; no invented links; name-only links remain INFERRED and human-confirmed.

**M4-4 (optional, LLM-assisted, gated). Grounded claim extraction from article body text via the existing hardened LLM path.** Uses the already-built `extraction` task route, delimited untrusted data, schema+citation validation, injection guards, retry-once-then-fail. Every text-derived claim cites the article evidence id; people/orgs from text stay claims/HYPOTHESIS, never resolved entities. Must degrade: with the LLM `{ unavailable }` (the default), the deterministic metadata claims and the report still work.
- Tests: stub LLM returning grounded, cited output → claims cite the evidence; uncited output → retried then rejected, nothing persisted; injected instructions in the body → guarded, not followed; LLM unavailable → path is a no-op and the rest of analysis is unaffected.
- Acceptance: optional and off by default; every text-derived claim is evidence-cited; no fabrication; injection-safe.

**M4-5 (later, deterministic, careful). Event/timeline extraction.** Introduce an EVENT entity kind and extract events only from dates/fields the source states (never invented), with the same "no invented date" strictness as `extractArticle`. Lower priority; sequence after M4-2.

**Recommended first implementation task: M4-1** — wire `caseContradictions`. It is deterministic, evidence-linked, already built and unit-tested, carries real analytical value (surfaces conflicting claims across sources, including the `article_*` and `news_*` claims), and is the lowest-risk integration (a document field + a breakdown metric + an `ENGINE_VERSION` bump), with no LLM and no change to any security gate.

## Limitations and failures

- No live validation occurred; no real publisher was contacted. "Proven" refers to offline fixtures only.
- Article body text is not yet analysable (not persisted) — an M4-2 prerequisite for text-level analysis.
- LLM-assisted analysis is off by default; the deterministic path is the baseline, and M4 prioritises it.
- The M4 readiness audit was performed against the current code; it is a plan, not an implementation — no M4 code was written in M3.

## Final status and next step

**BLOCKED ON HUMAN APPROVAL.** Live validation cannot proceed until (1) legal review of the chosen publisher's terms, (2) an owner's committed per-publisher PERMITTED verdict in `catalogue.ts`, and (3) a signed-in tenant member's in-force DOMAIN scope authorisation for the publisher host. The engineering path is complete and proven offline; only these human decisions gate a real request.

**Next step:** obtain the three approvals above for a single chosen publisher and URL, then re-run Step 3 (one bounded request). In parallel, begin **M4-1** (wire `caseContradictions`), which needs no live data and no approvals and delivers deterministic, cited intelligence immediately.

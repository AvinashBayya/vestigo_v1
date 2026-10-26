# M4 exit review and next-milestone decision

Date: 2026-10-23. Branch `milestone/vestigo-days-1-3-osint-addendum`, HEAD `156952f`. Audit and planning only — **no production code, migration, commit, push, reset, clean, or revert.** No live publisher request; no source verdict changed.

**Written for: the Vestigo owner deciding whether to close M4 and what to build next.**

## 1. Repository state and preservation

Inspected first: branch `milestone/vestigo-days-1-3-osint-addendum`, HEAD `156952f`, 93 uncommitted paths (55 modified, 38 untracked) — all M1–M4-4B work, intact. Test services were already up (`vestigo-postgres-1`, `vestigo-redis-1`, healthy). Nothing was modified during this review; the only new file is this report.

I confirmed the M3 source gate's integrity by diffing `packages/collectors/src/catalogue.ts`: its 31 added lines **only introduce the `direct-article` source as `UNVERIFIED`** — no existing source's `commercialUse` verdict, access method, or gate was changed.

## 2. Evidence reviewed

Reports (treated as claims, then verified against code and tests): `M3_LIVE_ARTICLE_VALIDATION_REPORT`, `M4_1_CONTRADICTION_INTEGRATION_REPORT`, `M4_2_ARTICLE_INTELLIGENCE_REPORT`, `M4_3_CONTRADICTIONS_UI_REPORT`, `M4_4_PROSE_INTELLIGENCE_REPORT`, `M4_4A_RUNTIME_VERIFICATION_REPORT`, `M4_4B_WORKER_INTEGRATION_REPORT`. Roadmap: `docs/PLAN.md` phase tracker and `docs/BUILD-PHASES.md`.

Implementation inspected: the article collector and its gating (`platform/article.ts`, `catalogue.ts`, `runtime.ts`), fusion (`fusion/fuse.ts`, `extractors.ts`), extraction (`extraction/{article-extraction,run,processor}.ts`), the queue layer (`jobs/queues.ts`), the metering schema and repo (`schema/{operations,evidence}.ts`, `repositories/{operations,evidence}.ts`), migration `0028` + journal, contradiction analysis (`case-engine/.../case-contradictions.ts`), the case-analysis job and API route, and the web `Contradictions`/`EntityPanel`/`Provenance` components.

## 3. End-to-end workflow status

The implemented path is: **article collection → content-hashed evidence → fusion (URL entity + metadata claims) → optional prose extraction → one durable DERIVED `article_statements` claim + token metering → case-analysis contradiction review → API → workspace Contradictions panel + entity/provenance.**

| Segment | Status |
|---|---|
| Collection → evidence → fusion | Works; runtime-verified offline (the `article` source is `UNVERIFIED`, so it runs only against recorded fixtures — see §8). |
| Fusion → extraction fan-out (post-fusion, model-gated) | Works end-to-end over real Redis/BullMQ (`extraction-queue.test.ts`). |
| Extraction → durable claim + metering | Works; exactly-once claim and charge under duplicate/concurrent delivery, verified against real Postgres (`article-extraction-processor.test.ts`). |
| Extraction → contradiction analysis | **Not connected, by design.** The `article_statements` claim is structurally inert for contradiction (§3.2). |
| Extraction → analyst surface | **Only incidental.** No dedicated UI (§3.1). |
| Contradiction → API → workspace | Works; runtime-verified (`case-analyses.test.ts`, `case-analysis-job.test.ts`, `contradictions.test.tsx`). |

### 3.1 Is the extraction result useful to analysts? — Marginal today
The extracted statements persist correctly (grounded, DERIVED, cited, spanned), but **nothing surfaces them purpose-built.** No API route or component references `article_statements`; it appears only if an analyst opens that exact URL entity, where the generic `EntityPanel` renders it as a raw `JSON.stringify` blob under the literal label `article_statements`, and in the provenance dock. It is not in reports and not in contradictions. So M4-4's slice is a *correct, safe, dormant capability*, not yet analyst-facing intelligence. That was never in M4's scope (M4-3 built the contradictions UI, not an extraction UI), so it is a deferred enhancement, not an unmet M4 criterion.

### 3.2 Can extracted statements support cross-source, entity-specific contradiction? — No
`caseContradictions` groups claims by `(entityId, attribute)` and reports a group with ≥2 distinct whole-values. The extraction writes **one** claim per URL entity, attribute `article_statements`, value = the whole statements array, and the individual subjects (person/org/place) are deliberately **not** promoted to their own entity claims (`NEVER_RESOLVED_BY_VALUE`). So the group almost always has size 1 (never a contradiction); and even on the rare two-fetches-of-one-URL case it would compare two opaque arrays wholesale, not per-attribute. Cross-source, entity-specific contradiction therefore **cannot** be driven by extracted prose as built. (By contrast, structured article *metadata* claims like `article_title` do contradict meaningfully — proven by `case-analysis-job.test.ts`.) This is the documented candidate-entity gap and is the core of the recommended next milestone.

## 4. Verified tests and limitations

Run this review (and during the M4-4B work earlier this session) against the real containerised Postgres + Redis. All pass.

| Suite | Scope | Result |
|---|---|---|
| `@repo/collectors` (9 files incl. `article`, `article-extract`, `access-methods`) | M4-2 collection + gating, offline | **157 passed** |
| `@repo/case-engine` `case-contradictions` + `case-analysis` | M4-1 contradiction logic, pure | **71 passed** |
| `@repo/osint-engine` `case-analysis-job` | M4-1/M4-2 contradiction+article integration, **DB** | **20 passed** |
| `apps/api` `case-analyses` | M4-1/M4-3 API serving contradictions, **DB** | **27 passed** |
| `apps/web` `contradictions` | M4-3 UI states (empty/pending/stale/failed/locked), isolated | **10 passed** |
| `@repo/osint-engine` extraction (`article-extraction`, `-run`, `-processor`, `extraction-queue`) | M4-4/4A/4B, **DB + Redis/BullMQ** | **25 passed** |
| `@repo/osint-engine` `pipeline` (RELEASE-BLOCKING) | regression across the queue layer, **DB + Redis** | **38 passed** |
| `@repo/worker`; `@repo/db`; `@repo/config` | worker wiring; migration 0028 + schema; env + `.env.example` | **5 / 305 / 273 passed** |

**Genuinely runtime-verified against real services:** every segment above except the live-publisher fetch. **Tested only in isolation / offline:** the article collector's real-network behaviour (gated off — fixtures only), and there is **no** test connecting extraction to contradiction or to an analyst surface (because neither link exists). Static checks (typecheck incl. tests, build, eslint, prettier) are clean across the changed packages.

## 5. Unresolved risks — blockers vs deferrable

**No blockers.** Every implemented path is runtime-verified; the M3 gate is enforced in code; no required M4 acceptance criterion or critical integration path is unverified.

Deferrable items (none blocks M4):

- **D1 — Extraction output is not analyst-facing.** Raw JSON on the URL entity only; no report/contradiction/structured view. *→ recommended milestone.*
- **D2 — Extracted prose cannot drive cross-source/entity-specific contradiction** (§3.2). Needs grounded candidate entities. *→ recommended milestone.*
- **D3 — Model-residency not recorded for extraction tokens** (M4-4B R1). Metering is correct and deduped; only the per-call provider-residency breakdown (`model_calls`, schema-restricted to report rows) is absent for extraction tokens. A limitation, not a blocker — the next milestone's work can add an extraction-keyed usage path.
- **D4 — Drizzle snapshot drift.** `0028` has its SQL + journal entry but **no `meta/0028_snapshot.json`** (28 snapshots vs 29 migrations). The runtime migrator ignores snapshots, so apply and CI (`turbo build lint typecheck test`) are unaffected and all db tests pass; but the next `drizzle-kit generate` would diff against the 0027 snapshot and try to regenerate the index. Fix is mechanical: run `pnpm --filter @repo/db generate:migration` to reconcile the snapshot before the next migration. Deferrable, low-effort.
- **D5 — Extraction has no derivation-time person gate** (asymmetry vs report/case-analysis/API reads, which all call `personGate`/`requirePersonAccess`). Low risk today: extraction runs only on `article`/URL-target jobs, which are not person-bearing runs; the source is UNVERIFIED/dormant; and the derived claim is read back only through person-gated routes. It becomes material only if extraction ever processes person-bearing runs, so it should be closed as part of any candidate-entity work. Deferrable hardening.
- **D6 — Live article validation remains BLOCKED ON HUMAN APPROVAL** (M3). This is the intended gate, not a defect (§8).

## 6. Decision

**CLOSE M4 WITH EXPLICITLY DEFERRED ITEMS (D1–D6 above).**

Rationale: M4's stated scope — deterministic contradiction analysis integrated and surfaced (M4-1/M4-3); bounded article text retention and a safe, grounded, fail-closed prose-extraction slice wired into the worker pipeline with durable idempotency, per-tenant metering, tenant isolation, disabled-provider/retry/concurrency/failure correctness (M4-2/M4-4/4A/4B) — is implemented and runtime-verified against real Postgres and Redis. The M3 source gate is enforced in code and unchanged. The deferred items are enhancements (analyst surfacing, cross-source contradiction) and hardening (residency keying, snapshot regen, derivation-time gate), not failures of M4's acceptance criteria, and per the review brief "future enhancements are possible" is not grounds to block.

## 7. Recommended next major milestone

**Roadmap note:** `docs/PLAN.md` designates **Phase 7 — Commercial layer** (plans/entitlements, signup+vetting, onboarding, usage/billing, webhooks, data rights, legal) as the next un-started phase; Phases 8 (infra/observability/CI) and 9 (hardening/launch) follow. Phase 7 advances the *business*, not the analyst's investigative workflow. The review brief asks specifically for an analyst-workflow milestone, so I recommend the following, which is the natural continuation of the M1–M4 OSINT addendum and directly realises the value M4 only staged. **The choice between this and Phase 7 is the owner's** — this does not displace the roadmap.

### M5 — Evidence-grounded entities and cross-source contradiction

**User value.** Turn the grounded statements M4 extracts (and structured metadata claims) into analyst-usable intelligence: an analyst can see *what each source says about a given person/organisation/place*, review and confirm those subjects into grounded entities, and have the contradiction engine flag when two sources disagree about the same entity's attribute — the actual promise behind the contradictions feature. This closes D1 and D2 and makes extraction worth running.

**Scope.**
1. A **grounded candidate-entity model**: an extracted statement's subject may become a *candidate* entity, never auto-resolved by name (`NEVER_RESOLVED_BY_VALUE` preserved); person/organisation candidates require an analyst's confirmation before they resolve.
2. Promote confirmed statements into per-`(entity, attribute)` claims carrying the quote, span, evidence id, and DERIVED strength, so they feed `caseContradictions` and fire entity-specific, cross-source contradictions.
3. **Surface extraction in the workspace**: a statements view with spans + provenance on the entity/evidence panels (closes D1).
4. Apply the **person gate at derivation time** wherever candidate person entities can arise (closes D5), and add the extraction-keyed usage path that carries model-call residency (closes D3).

**Dependencies.** M4 closed; the entity/claim schema and `packages/access` person gate; the contradiction engine (already integrated); for *live* value, a per-publisher licence verdict approved behind the M3 gate (otherwise exercised offline).

**Acceptance criteria.**
- Extracted statements are visible in the workspace with their verbatim quote, character span, and evidence provenance.
- A reviewer can confirm a statement's subject into a candidate entity without any auto-resolution by name; unconfirmed candidates never silently become resolved entities.
- Two sources asserting different values for the same **confirmed** entity attribute produce a contradiction in the case-analysis document and the Contradictions panel; agreement does not.
- Candidate person entities and the reads that rest on them are person-gated at derivation and at read; tenant isolation and fail-closed behaviour are preserved; extraction remains off by default.
- Extraction token usage is recorded with per-call residency, deduped once per work item.
- All new DB-backed and Redis-backed tests pass; no regression in the release-blocking pipeline suite.

**Explicitly out of scope.** Enabling a live publisher (the M3 human/legal per-publisher approval is a separate gate, not engineering work); automatic entity merging or LLM-based entity resolution beyond grounded extraction; the commercial layer (Phase 7); billing/payment integration; infrastructure/observability (Phase 8).

## Status

**M4 CLOSED WITH EXPLICITLY DEFERRED ITEMS (D1–D6).** All implemented M4 paths are runtime-verified against real Postgres + Redis (totals in §4); the M3 source gate is enforced in code and unchanged; no blockers. Recommended next: **M5 — Evidence-grounded entities and cross-source contradiction** (analyst-workflow track), with Phase 7 (Commercial layer) as the roadmap's business-track alternative — the owner chooses. Repository left uncommitted with all pre-existing changes preserved; nothing was implemented.

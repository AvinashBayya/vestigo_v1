# 10 — Recommendations & Roadmap

## Keep (do not touch — these are the moat)

- The 3-layer tenant isolation (`packages/db`) and its catalog-driven release-blocking tests.
- The no-fabrication regime (CI regex + ESLint AST + `null`/em-dash discipline).
- The SSRF fetcher (`packages/collectors/src/fetcher`).
- The LLM safety envelope (`packages/llm`): open-weight allowlist, untrusted framing, citation validation, output guards.
- The shared `personGate` + its copy-paste guard.
- The envelope-encrypted vault, constant-time API-key verification, append-only audit log.

## Refactor / finish

- Wire the already-built **contradiction review** into the stored case-analysis document.
- Add the **S3 content-store backend** behind the existing `ContentStore` interface.
- Add a **`--region` flag** to `provision-tenant.ts`.
- Add a **caller-side contract test** (osint-engine) proving evidence text reaches the model only via the untrusted frame (closes the one residual LLM trust gap).

## Delete / reconcile

- Remove the unused **`zustand`** dependency.
- Use or drop the **`pgvector`** extension.
- Resolve the **doc drift** (CLAUDE.md §6 `services/vision`; §9 D-34; ADR §0 product name).
- Wire or drop the two unwired PERMITTED sources (`gdelt-events`, `safecast`).

## Secure

- **H-1:** move the personal `OPENAI_API_KEY`/`GEMINI_API_KEY` out of `.env`; rotate if ever shared.
- **H-2:** implement retention-deletion + verified tenant-deletion, or relabel the feature as unavailable; add a regression test.
- **M-1:** register explicit CORS + security headers (or document the required proxy).
- **M-2:** reject known dev `AUTH_SECRET`/`VAULT_MASTER_KEY` in production at boot.
- **L-1/L-2/L-3:** scheme-validate attribution URLs; redact short secrets in captured URLs; forbid `http`.

## Test / observe

- Stand up a **CI pipeline** that runs the DB isolation suite against live Postgres, names the prompt-injection corpus + golden-eval as steps, adds SCA (dependency scanning) and secret scanning, and adds image-build + migrate stages.
- Add **metrics/tracing/readiness** (queue depth, circuit state, collector latency, DLQ size; `/health` should optionally probe PG/Redis for readiness).
- Publish an **end-to-end green run** on a clean machine (current status UNKNOWN).

## Document

- Fix CLAUDE.md drift (above). Document the deployment contract (proxy, secrets, datastores). Add a one-command local run guide.

---

## Prioritised roadmap

### Week 1 — hygiene & truth-in-docs (low effort, high trust)
1. Move/rotate the personal API keys out of `.env`; regenerate `.env` from the schema (H-1, M-3).
2. Fix the three CLAUDE.md/ADR drift items so the "honest" invariant covers the docs (§6 `services/vision`, §9 D-34, product name).
3. Remove `zustand`; decide `pgvector`.
4. Add boot-time rejection of dev secrets in production (M-2).
5. Apply the three Low security fixes (attribution URL scheme check, short-secret redaction, forbid `http`).

### Month 1 — close the privacy & CI gaps (launch-blockers)
6. Implement retention-deletion + verified tenant-deletion with tests (H-2) — this is the clearest promise-vs-code gap.
7. Build the real CI pipeline (live-Postgres isolation tests, prompt-injection/eval steps, SCA, secret scan, image/migrate). Publish an end-to-end green run.
8. Add CORS + security headers at the app (M-1).
9. Add baseline observability (metrics, tracing, readiness health).
10. Record licence verdicts for the first batch of UNVERIFIED collectors so more than 3 sources can run — the product/legal work that unlocks the catalog.

### Quarter 1 — product depth
11. Build the first **person collector** and wire `person/search` end-to-end (or mark the person module unavailable in the UI until then).
12. Finish the **provisional UI** (Members, Settings) and the endpoint-less tabs (Media, Map, Monitor alerts, Contradictions, Merge candidates) as their backends land.
13. Implement the **monitors/alerts scheduler** (the table + cron column exist; nothing sweeps them).
14. Add the **S3 content store** and plan the deferred **graph store** (ADR Phase 2) if graph scale demands it.
15. Stand up the deferred **tool-container collectors** and (if pursued) the **Python vision service** — with the same SSRF/arg-not-shell discipline the ADRs require.

---

## Due-diligence verdict

A technically disciplined, security-first MVP whose foundations (multi-tenancy, data integrity, SSRF, LLM safety, identity) are genuinely production-grade and unusually well-tested for a solo, pre-launch project. The risk profile is dominated not by code vulnerabilities (none Critical) but by **unfinished promises** (retention/deletion), **operational hygiene** (keys in `.env`, dev secrets, minimal CI/observability), and the **gap between a large collector catalog and the 3 sources actually cleared to run**. None of these is structural; all are addressable on the roadmap above.

# 08 — Code Quality & Technical Debt

## 1. Overall engineering health

High. TypeScript strict everywhere (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`), type-aware ESLint (`strictTypeChecked`), Prettier enforced in CI, and a near-1:1 test-to-code ratio (~65k non-test LOC vs ~47k test LOC, ~156 test files). Grep across shipped `apps/`+`packages/src` found **no `any`, `@ts-ignore` without reason, `TODO`, `FIXME`, `HACK`, or fake-data stubs** in the areas each domain agent read. Unavailable features use an honest `NotImplementedError` or a self-labelling "Not built" UI state rather than placeholder data.

## 2. Separation of concerns

Clean. Business logic lives in `packages/`; `apps/api` is routes + guards + identity wiring only; `apps/worker` is "wiring; the logic lives in osint-engine." Package boundaries are **enforced in CI** (`boundaries.test.ts`): `core`→nothing, `access`→core, `case-engine`→core (and pure — AST purity test forbids clock/randomness), `collectors`→no db/redis/integrations. Cross-package imports go through entry points, not deep paths.

## 3. Error handling & validation

Typed errors with machine codes throughout (`AppError` subclasses; no bare `throw new Error("failed")`). Validation at every boundary (HTTP via Zod type-provider, collector output via result schemas, model output via Zod + guards, queue messages via Zod `strictObject`). RFC-9457 problem responses; unknown errors never leak messages.

## 4. Testing

| Package | ~test files |
|---|---|
| apps/api | 29 |
| apps/web | 23 |
| apps/worker | 1 |
| packages/collectors | 26 |
| packages/db | 19 |
| packages/osint-engine | 13 |
| packages/config | 11 |
| packages/integrations | 9 |
| packages/access | 6 |
| packages/llm | 6 |
| packages/core | 4 |
| packages/case-engine | 4 |
| packages/ui | 5 |
| packages/media-forensics | 0 (placeholder) |

Categories present: tenant-isolation/cross-tenant, fabrication, person-gate (+ depth + route-gating guard), citation, SSRF/fetcher, auth-flow anti-enumeration, purity, contract/OpenAPI validation, first-load/bundle budget. Many db/api tests require a live Postgres. **End-to-end green status is UNKNOWN — requires runtime access**; only a cached `@repo/config` run (12 files / 273 tests passed, 2026-10-21) is on disk. No coverage threshold is configured in the shared vitest config.

**Source guards (release-blocking, run inside `turbo test`):** `fabrication-check` (regex, fails on 0 files scanned), ESLint `fabrication` plugin (AST), `check-exports`, `person-gate-guard` (+ route-gating audit), `boundaries`, `gitignore.test`, `env-example.test`, `design-system-guard`, `no-raw-hex` (UI), contrast + serif-scope (UI).

## 5. Dead code / unused / cleanup backlog

| Item | Evidence | Action |
|---|---|---|
| `zustand` dependency unused | `apps/web/package.json:34`, no usage | remove |
| `pgvector` extension unused by code | `01-bootstrap.sql:37-41`; no vector columns | use for planned graph/embedding work or drop |
| `services/vision`, `infra/` tool containers, Dockerfiles absent | CLAUDE.md §6 lists them; not on disk | update docs or build |
| `packages/media-forensics` placeholder | manifest only, 0 tests | build or keep clearly flagged |
| `gdelt-events`, `safecast` PERMITTED sources with no collector | `catalogue.ts` | wire or drop |
| `declareCollector` / `HELD_PLATFORM_COLLECTORS` unused | `contract.ts:187`, `platform/index.ts:62` | keep (extension points) or prune |
| Contradiction review computed but not surfaced | `case-engine/src/analysis/case-contradictions.ts` not referenced by osint-engine | wire into the stored case-analysis document (R1-b) |
| `provision-tenant.ts` cannot set region | hard-codes `TENANT_REGIONS[0]` (`:73`) | add `--region` flag |

## 6. Documentation accuracy (doc ↔ code drift)

Material because the product's promise is honesty. Found:
1. **CLAUDE.md §6 layout lists `services/vision`** (Python FastAPI GPU) which does not exist; README's layout block is more accurate (omits it).
2. **CLAUDE.md §9 still describes D-34** (report-generation person-gate) as an open gap — code closed it at `packages/osint-engine/src/reports/generator.ts:148-163` ("closes D-34"), commit `4019ef9`. Update the prose.
3. **Product name "undecided"** in `docs/ARCHITECTURE-DECISIONS.md §0` and README's framing, while the product is "Vestigo" via `PRODUCT_NAME`. Doc lag, not a code violation.
4. **`docs/design/officer-mockups/*.html` hard-code the literal name** in `<title>` (e.g. `Vestigo Watch`) whereas older mockups use `[PRODUCT NAME]`. Read-only reference docs, never shipped — note only.
5. **ADR §10 describes a fuller CI/deploy pipeline** than the single `ci.yml` verify job that exists.

Otherwise README matches the code it describes (roles, RLS, append-only, auth, gating, generated OpenAPI→client, the two repo gates, env-schema validation).

## 7. Developer experience

Good: single `pnpm install` + `docker compose up -d --wait postgres redis` + turbo tasks; env validated against a Zod schema with clear `ConfigError`s; generated client/OpenAPI reduce drift. Friction: db/api tests need live datastores (documented in README); `.env` must be hand-maintained and is currently stale (M-3); no one-command "run the whole app" is documented beyond compose + turbo dev.

## 8. Observability

Structured pino logging with tenant/run/job ids; append-only audit log is a strong forensic trail. **Missing:** metrics/tracing (no Prometheus/OpenTelemetry/Sentry), health endpoint is liveness-only (does not probe PG/Redis), and there is no dashboarding. For a platform that runs background jobs against flaky upstreams, metrics on queue depth, circuit state, collector latency and DLQ size would be high-value.

## 9. Maintainability risks / tech-debt priorities

1. **Retention/deletion** (privacy promise unfulfilled) — see [07](07-security-privacy-audit.md) H-2.
2. **CI breadth** — isolation/prompt-injection/eval suites run only inside `turbo test`; no live-Postgres CI step, no SCA, no image/migrate/deploy stages.
3. **Observability** — add metrics/tracing/health-readiness before launch.
4. **Doc drift** — fix the CLAUDE.md items so the "honest" invariant holds for the docs too.
5. **The frozen-collector backlog** — 228 UNVERIFIED collectors need per-source licence verdicts recorded before they can earn their keep; this is product/legal work, not code debt, but it's the gap between "231 collectors" and "3 runnable."

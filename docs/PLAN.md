# Plan

Living tracker. Update it at the end of every phase so a fresh session can resume with context.
Phase prompts live in [BUILD-PHASES.md](BUILD-PHASES.md); rules in [CLAUDE.md](../CLAUDE.md).

**Near-term goal:** a working vertical slice in five days: a user signs in, runs an investigation
against a real target, and sees real evidence. That slice cuts across Phases 2, 3, 4 and 6.

## Phase tracker

| Phase | Scope                                   | Status                                                                                                                                                   |
| ----- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | Audit and migration map                 | Done. Findings in [audit/](audit/): REPORT, INVENTORY (per-module KEEP / REWRITE / DROP verdicts, used as the porting map), COLLECTORS, DEPENDENCIES, QUESTIONS. |
| 1     | Scaffold and toolchain                  | **Done, 2026-09-25.** See below.                                                                                                                         |
| 2     | Data foundation and tenancy             | Not started                                                                                                                                              |
| 3     | Collector SDK and migration             | Not started                                                                                                                                              |
| 4     | Jobs, orchestration and tool containers | Not started                                                                                                                                              |
| 5     | AI, fusion and reports                  | Not started                                                                                                                                              |
| 6     | Frontend                                | Not started                                                                                                                                              |
| 7     | Commercial layer                        | Not started                                                                                                                                              |
| 8     | Infrastructure, observability and CI    | Not started                                                                                                                                              |
| 9     | Hardening and launch readiness          | Not started                                                                                                                                              |

## Phase 1 record

**Built:** pnpm workspaces and Turborepo (`build`, `lint`, `typecheck`, `test`, plus `generate`
and `dev`); `packages/config` (strict tsconfig bases, ESLint flat config, Prettier,
`PRODUCT_NAME`, Zod env schema with generated `.env.example`); the fabrication gate and
export-integrity gate ported from `legacy/scripts`; `docker-compose.yml` (Postgres 17, Redis 8,
healthchecks, named volumes); `apps/api` (Fastify, Zod type provider, `GET /health`,
`GET /api/v1/openapi.json`); `apps/web` (Vite and React, health shown through the generated
client); `apps/worker` (validates config, then exits `NOT_IMPLEMENTED`); `packages/core` (typed
error base, `NotImplementedError`); toolchain-only `collectors`, `db`, `llm`; `package.json`-only
placeholders for `osint-engine`, `media-forensics`, `integrations`, `ui`.

**Verified at the checkpoint:** a clean `pnpm install --frozen-lockfile`; `pnpm turbo build lint
typecheck test --force` from a state with no build output or generated code (33 of 33 tasks, 43
tests); `docker compose up -d` with both services healthy; `/health` and `/api/v1/openapi.json`
answering 200 from the built server. Negative checks: a planted fabrication fails the pipeline
at the exact line, a removed export fails check-exports, and a `Bun` global fails lint.

**Not verified:** the health line rendering in a real browser. It is covered by jsdom component
tests, and the Vite dev server was confirmed to serve the page and proxy `/health`.

### Decisions taken in Phase 1

1. **TypeScript 6.0.x, not 7.** TypeScript 7 ships no classic compiler API, typescript-eslint
   requires `<6.1.0`, and the codegen and export gate use the compiler API. Revisit when
   typescript-eslint supports 7.
2. **Neutral names.** Packages are `@repo/*`; the database, user and volumes are `app`. The
   product name appears only in `packages/config/src/product.ts`. Page title and OpenAPI title
   read it.
3. **Node runs TypeScript directly** (type stripping) for scripts and `dev`; `tsc` compiles
   production output. Relative imports carry `.ts` extensions, rewritten on emit.
4. **API client: openapi-typescript and openapi-fetch.** `apps/web/src/client` is generated
   (`paths` types plus the client instance) and gitignored. hey-api was tried first and rejected:
   the fetch runtime it copies into the source tree failed the fabrication gate
   (`auth.name ?? 'Authorization'`) and did not compile under `exactOptionalPropertyTypes`.
   Known gap: openapi-typescript 7.13.0 declares a peer of `typescript ^5.x`; it is used with
   6.0.3 and its output typechecks and passes tests. Revisit when it declares TS 6 support.
5. **Fabrication gate deltas from legacy:** scans every workspace; each pattern also catches
   the `??` form (the audit found `?? "Seismic event"`-style fallbacks the original missed);
   scanning zero files fails; no allowlist. It runs after code generation so the generated
   client is scanned, and gates `test`. It is not a dependency of `build`, because the client is
   generated from the API's build output and gating that build on the scan would be a cycle. The
   CI command `pnpm turbo build lint typecheck test` fails on any match.
6. **check-exports** asks the TypeScript checker for each entry point's exports, because the
   legacy regex cannot follow re-exports.
7. **Supply-chain guard:** `minimumReleaseAgeStrict: true` in `pnpm-workspace.yaml`. turbo,
   vite and vitest are pinned one release back (`^2.11.3`, `^8.3.0`, `^5.0.1`); their newest
   releases were younger than pnpm's minimum release age.
8. **`packages/core` has no runtime dependency on the repo.** It uses `@repo/config` as a
   devDependency, for the shared tsconfig and ESLint config only.
9. **`/health` is liveness only** and says so; it does not check Postgres or Redis. Inbound
   request timeout is 30 s.
10. **Postgres image is `postgres:17` (Debian)**, not Alpine, for collation parity with managed
    Postgres.

### Open questions and carry-forwards

- **Phase 2:** the ADR requires pgvector; switch the compose image to a pgvector build of
  Postgres 17 when the schema needs it.
- **Production web-to-API origin.** The web app assumes same-origin; the ADR serves it from a
  CDN. Decide the API origin and CORS policy in Phase 6 or 8.
- **Legacy `no-fabricated-fallback` ESLint rule** (INVENTORY: KEEP) is not ported. This phase
  was limited to `legacy/scripts`.
- **No CI workflow file** exists yet; no CI provider has been chosen. The gate command is
  `pnpm turbo build lint typecheck test`.
- **Python code** (`services/vision`) is not covered by the fabrication gate; add its patterns
  when that service arrives.
- **Redis or Valkey in production** (ADR §5, §10): local dev uses `redis:8`.
- **Product-name uniqueness** is enforced by convention only; a test could enforce it.
- **Turborepo telemetry** is on by default (anonymous); `pnpm turbo telemetry disable` turns it
  off per machine.

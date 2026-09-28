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
| 2     | Data foundation and tenancy             | **Session A done, 2026-09-28:** data layer and tenant isolation. See below. Session B (Better Auth, MFA, API keys, permission guards, module gating, credential vault) not started. |
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

- ~~**Phase 2:** switch the compose image to a pgvector build of Postgres 17.~~ Done in Phase 2A.
- **Production web-to-API origin.** The web app assumes same-origin; the ADR serves it from a
  CDN. Decide the API origin and CORS policy in Phase 6 or 8.
- ~~**Legacy `no-fabricated-fallback` ESLint rule** is not ported.~~ Ported in Phase 2A.
- **No CI workflow file** exists yet; no CI provider has been chosen. The gate command is
  `pnpm turbo build lint typecheck test`.
- **Python code** (`services/vision`) is not covered by the fabrication gate; add its patterns
  when that service arrives.
- **Redis or Valkey in production** (ADR §5, §10): local dev uses `redis:8`.
- **Product-name uniqueness** is enforced by convention only; a test could enforce it.
- **Turborepo telemetry** is on by default (anonymous); `pnpm turbo telemetry disable` turns it
  off per machine.

## Phase 2, session A record: data layer and tenant isolation

**Built.**

- `packages/db`: Drizzle 0.45 on Postgres 17 with pgvector. 22 tables, all carrying `tenant_id`,
  from three forward-only migrations: `0000_foundation` (pgvector, the tenant-context function,
  UUIDv7 functions), `0001_tables` (generated from `src/schema`, with one marked hand edit to
  partition evidence) and `0002_security` (hand-written: RLS, grants, triggers, partitions).
- Tenant isolation in three independent layers: RLS enabled and forced on every table, with one
  policy each; composite `(tenant_id, …)` foreign keys and unique keys; and least-privilege grants,
  with column-level UPDATE grants so `tenant_id` and ids are immutable.
- Two roles, created by `infra/postgres/init/01-bootstrap.sql` on first compose start. `app_owner`
  owns the schema and runs migrations. `app_runtime` is the only application role and owns
  nothing. Neither is a superuser, and neither has `BYPASSRLS`.
- `db.withTenant(tenantId, work)` opens a transaction, sets the tenant transaction-locally and
  hands out the repositories. A repository cannot be constructed or called without a live scope
  issued by `withTenant()`. `createDatabase` refuses a superuser or `BYPASSRLS` role.
- 22 repositories, one per table.
- Evidence is append-only, with nullable `observed_at` and `collected_at` that have no defaults.
  It is range-partitioned by month on its UUIDv7 id.
- Entity merges are reversible records with reason, confidence, signals and decider. A rule-based
  name-only merge of a person or organisation is refused by the repository and by a CHECK
  constraint. Cycles are refused by a trigger under a per-tenant advisory lock.
- The audit log is insert-only by grant. Triggers refuse UPDATE, DELETE and TRUNCATE for every
  role, the owner included.
- Content-addressed payload store: a `ContentStore` interface and a filesystem backend. Keys are
  `sha256`, namespaced per tenant, and re-verified on every read.
- The legacy ESLint fabrication plugin, ported to `packages/config/eslint/fabrication-plugin.js` and
  enabled at error level in every package. 72 tests.
- Development seed (`pnpm db:seed`): two tenants with distinct TECHINT data and no person data. It
  is idempotent.
- `@repo/core` gained `TenantId` (a branded, validated UUID) and the shared vocabulary. The
  database enums are generated from it.

**Verified at the checkpoint.**

- Postgres started from a fresh volume. `pnpm db:migrate` ran clean as `app_owner`, and a second
  run was a no-op. The result: 22 of 22 tables with RLS enabled and forced, 22 tenant policies,
  28 evidence partitions (2026-09 to 2028-12), and pgvector 0.8.6.
- `pnpm turbo typecheck test --force`: 20 of 20 tasks, 287 tests (162 of them in db). The full
  `pnpm turbo build lint typecheck test --force` from a clean state: 34 of 34 tasks.
- The release-blocking suites: 149 of 149 tests.
  - 22 repositories attacked with cross-tenant reads, lists, every write method and every
    cross-tenant reference.
  - Raw-SQL RLS checks against every table, discovered from the catalog.
  - Catalog invariants.
  - Tenant context required.
  - Audit log insert-only.
  - `observed_at` stays null.
  - A merge undone with its evidence intact.
- Cross-tenant access demonstrated with raw SQL as `app_runtime` against seeded data:
  - As tenant A, B's case by exact id returns 0 rows, and an update of it changes 0 rows.
  - Inserting a row with B's `tenant_id` is refused by the row-level security policy.
  - With no tenant context, the query fails.
  - Deleting audit rows is refused with permission denied.
- Mutation testing: 14 deliberate breakages of the isolation and integrity guarantees. All 14
  now fail the suite. Three were missed on the first pass, and the suite was fixed for each:
  - A leaked repository was refused by the database rather than the repository layer. Now it
    must be refused before any query is sent.
  - Setting the tenant session-wide went undetected.
  - The concurrent merge-cycle test raced its own commit, so it passed without the lock. It now
    waits until the second transaction is provably blocked.
- `db` tests are never served from the Turborepo cache (`packages/db/turbo.json`), because they
  exercise a live database.

### Decisions taken in Phase 2A

1. **Composite keys everywhere.** Primary keys are `(tenant_id, id)`, and every foreign key and
   unique key leads with `tenant_id`. Referencing another tenant's row fails as "not found", and a
   unique conflict cannot reveal that another tenant's row exists.
2. **With no tenant context, queries fail rather than returning nothing.** `app.current_tenant_id()`
   raises `TNT01` when unset, so a missed `withTenant()` is loud.
3. **Evidence is partitioned on its UUIDv7 id, not on a timestamp.** The partition key must be in
   the primary key, and `observed_at` and `collected_at` must stay nullable. `created_at` is
   generated from the id, so it always agrees with the partition. Partitions from 2026-09 to
   2028-12 are created by the migration; every `db:migrate` adds the next 13 months.
4. **Append-only is enforced twice.** There is no grant for the application role, and triggers
   refuse changes even for the owner's own UPDATE and DELETE statements. The owner could still
   remove a trigger with DDL, and only a migration runs as the owner. A migration that did so
   fails the append-only tests (mutation M6 proves this).
5. **Merges never modify entities, claims or evidence.** A merged entity is resolved to its
   survivor through the active merge records, so undoing a merge is one UPDATE and loses nothing.
6. **The content store is namespaced per tenant; there is no cross-tenant deduplication.**
   Sharing blobs across tenants would reveal that another tenant holds the same content, and would
   stop a tenant's deletion from genuinely removing its payloads.
7. **pgvector is installed by the platform.** It is not a trusted extension, so the bootstrap
   installs it as superuser, and the migration's `CREATE EXTENSION IF NOT EXISTS` is a no-op. On
   managed Postgres, the provider's extension mechanism does the same.
8. **Drizzle 0.45.x (stable).** 1.0 is still a release candidate.
9. **Database errors are translated to typed errors that never echo values.** Drizzle query errors
   and data exceptions (SQLSTATE class 22) have their messages replaced, because both can carry
   bound parameters.
10. **esbuild's build script is explicitly denied** in `pnpm-workspace.yaml` (`allowBuilds`). pnpm
    12 requires a decision, and the platform binary installs without the script.
11. **Fabrication ESLint port.** The plugin is named `fabrication`, not the old product name. One
    legacy defect is fixed, with regression tests: a fallback to `Date.now()` was never detected.

### Open questions (need a human)

- **Tenant deletion versus the append-only audit log.** CLAUDE.md §9 requires deletion to remove a
  tenant's evidence and derived data genuinely, and also says the audit log is append-only, with
  no code that deletes entries. Today, triggers stop even the owner from deleting audit rows.
  Should a deleted tenant's audit trail be retained (for how long, and under what access), or
  removed as part of deletion? The evidence deletion path itself is not built; it will need a
  privileged, audited route, because the application role has no DELETE on evidence.
- **Collector registry scope.** `collectors_registry` is per tenant, because every table carries
  `tenant_id`. A collector's licence and commercial-use verdict is really a platform fact. Confirm
  before Phase 3: either keep per-tenant rows (seeded from a platform catalogue), or ask for a
  platform-level table exempt from the `tenant_id` rule.
- **Users are per tenant.** A person in two tenants has two `users` rows. Better Auth's model
  (session B) may want a global identity with per-tenant memberships; decide in session B.
- **No cross-tenant operator view.** RLS means no application path lists all tenants, which is
  what CLAUDE.md §2 requires. Platform administration (approvals, support) will need a separate,
  audited design that does not bypass RLS.
- **Partition maintenance in production.** Today it runs only with `db:migrate`. A scheduled job
  should call `app.ensure_evidence_partitions` (Phase 4 or 8). An insert past the last partition
  fails loudly; it is never mis-filed.

### Carry-forwards from Phase 2A

- **S3-compatible content store backend** is not built; only the filesystem backend exists.
- **The API and worker validate `DATABASE_URL` but do not connect yet.** Nothing is wired to
  routes.
- **Fabrication ESLint plugin, two legacy defects left as found:**
  - The `configCallees` option has no effect.
  - `require-fabrication-justification` does not check blanket `eslint-disable` comments, or
    disables of itself.
- **Scheduled monitors** exist as rows only; materialising them into jobs is Phase 4.

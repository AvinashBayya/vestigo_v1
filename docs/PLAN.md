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
| 2     | Data foundation and tenancy             | **Done, 2026-09-28.** Session A: data layer and tenant isolation. Session B: authentication, MFA, permissions, module gating, API keys, audit, credential vault. See both records below. |
| 3     | Collector SDK and migration             | **Done, 2026-09-30.** Session A: collector SDK, registry, licence gating, fetcher, evidence path. Session B: eleven collectors ported, ten registered (news held until Track M Day 2), the `derived` provenance rule. See both records below. |
| 4     | Jobs, orchestration and tool containers | **Done, 2026-09-30** (tool containers and monitors deferred). BullMQ per-source queues, fault isolation, metering and quotas, run API with SSE, fusion, scope-authorisation API, operator-named labels, MFA enrolment token. See the record below. |
| 5     | AI, fusion and reports                  | **Done, 2026-10-01; live checkpoint passed 2026-10-03** (Groq, development only — see the follow-up below). `packages/llm` with allowlist, profiles, cache, metering, injection defence and citation validator; path-decided claim strength; report pipeline with coverage and limitations; PDF, JSON, CSV and Maltego exports; evaluation harness. See the record below. |
| 6     | Frontend                                | **6a done, 2026-10-03.** **6b in progress:** prerequisite and step 1 (auth) done 2026-10-03, looked at by the owner 2026-10-05; step 2 (search dashboard) done and looked at 2026-10-05; step 3 (run view) done 2026-10-05. **Realigned with the screen designs** (docs/design/) on 2026-10-05, awaiting the owner's side-by-side review. Step 3's Locked state completed 2026-10-06. Step 4 (results and the case workspace) done 2026-10-06 and verified live the same day (two layout defects found and fixed); step 5 (report view) done 2026-10-06, verified live. **6b complete**, awaiting the owner's look. **UI foundation:** U1-a (design system from the mockups) done 2026-10-07; U1-b (component library and the dev gallery) done and approved 2026-10-07; U1-c (every screen rebuilt from the library) done 2026-10-07, awaiting the owner's review. See the Phase 6a and 6b records below. |
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
- ~~**Collector registry scope.**~~ Resolved in Phase 3A. The platform catalogue is code in
  `packages/collectors`, the truth for every verdict. The per-tenant `collectors_registry` rows are
  copies of it, written when a collector is dispatched, so evidence can reference them. No
  exemption from the `tenant_id` rule was needed.
- ~~**Users are per tenant.**~~ Resolved in Phase 2B: identity is global (`auth` schema), and
  `public.users` is each identity's profile within a tenant.
- **No cross-tenant operator view.** RLS means no application path lists all tenants, which is
  what CLAUDE.md §2 requires. Platform administration (approvals, support) will need a separate,
  audited design that does not bypass RLS.
- **Partition maintenance in production.** Today it runs only with `db:migrate`. A scheduled job
  should call `app.ensure_evidence_partitions` (Phase 4 or 8). An insert past the last partition
  fails loudly; it is never mis-filed.

### Carry-forwards from Phase 2A

- **S3-compatible content store backend** is not built; only the filesystem backend exists.
- ~~**The API and worker validate `DATABASE_URL` but do not connect yet.**~~ The API connects
  since Phase 2B; the worker since Phase 4.
- **Fabrication ESLint plugin, two legacy defects left as found:**
  - The `configCallees` option has no effect.
  - `require-fabrication-justification` does not check blanket `eslint-disable` comments, or
    disables of itself.
- **Scheduled monitors** exist as rows only. Materialising them into jobs was deferred out of
  Phase 4 (your decision); see the Phase 4 carry-forwards.

## Phase 2, session B record: authentication and access control

**Built.**

- **Identity:** Better Auth 1.7.6, self-hosted at `/api/auth`, with the organisation and two-factor
  plugins. Telemetry is off. Its tables live in a separate `auth` schema, reachable only by a new
  `app_auth` role that has no access to tenant data. CLAUDE.md §2 is amended to name exactly these
  tables as the one exception to `tenant_id`, and a test fails on any other table without it.
- **Tenants are organisations.** An organisation's id is its tenant id. An operator creates a
  tenant and its first owner (`provision-tenant`, password from the environment). Sign-up is
  invitation-only, and nobody can create or delete a tenant through the API.
- **MFA (TOTP) is required for every account.**
  - Enforced by the API's guard, and by a before-hook on every identity endpoint except sign-in,
    sign-up, sign-out, session lookup and TOTP enrolment and verification.
  - `/two-factor/disable` is refused. Backup codes are stored encrypted.
- **Permission-based authorisation:**
  - A catalogue of `resource:action` permissions in `@repo/core`, with roles (`owner`, `admin`,
    `analyst`, `viewer`) mapping to permission sets. The same map drives Better Auth's own endpoint
    checks.
  - Every route declares `config.access` (a permission and an audit action, or why it is public).
    An undeclared route stops the app from starting.
  - A test forbids comparing role names anywhere in source.
- **Plan and vetting gating:**
  - Plans (`TECHINT`, `TECHINT_AND_PERSON`, descriptive placeholders until Phase 7) and vetting
    statuses. Person investigation needs both the plan and `APPROVED` vetting.
  - The application role cannot write either column: column-level grants, and tenant creation
    names only name and region.
  - A trigger audits every change to them, whoever makes it.
- **The request pipeline:**
  - Authentication runs before validation.
  - One tenant transaction per request, with the tenant from the session's verified active
    membership or from the API key, never from the request.
  - Then the permission check, then the module gate.
  - Audit outcomes: ALLOWED is written in the same transaction as the action; DENIED is written
    and committed; FAILED is written in its own transaction when the handler throws.
  - Cookie-authenticated changes must come from a trusted Origin.
  - Errors are RFC 9457 problem details with machine-readable codes. Request ids are UUIDs.
- **API keys** (`@repo/integrations`):
  - Format `ak_<tenant>_<key>_<secret>`, with SHA-256 of a 256-bit secret stored.
  - Scoped to permissions the issuer holds, and capped at authentication time by the issuer's
    current role. A key stops working when its issuer leaves.
  - Shown once, rotatable with an optional overlap, and revocable.
  - Rate-limited per key with a Redis fixed window that fails closed (503).
- **Audit log** gained `auth_method`, `permission`, `outcome`, `session_id` and `request_id`.
  Identity-provider actions touching a tenant are audited in that tenant: invitations, joining,
  role changes, removal, switching tenant, and tenant provisioning.
- **Credential vault** (`@repo/integrations`):
  - AES-256-GCM envelope encryption per credential, with a random data key wrapped by the master
    key.
  - The binding data ties the ciphertext to its tenant, credential and provider.
  - Every `reveal` is audited. `SecretValue` and `MasterKey` redact themselves in logs, JSON and
    inspection. No API route returns a secret or ciphertext.
- **Endpoints:**
  - `/api/v1/me`
  - `/api/v1/investigations`: create, list, read.
  - `/api/v1/audit-log`
  - `/api/v1/api-keys`: create, list, rotate, revoke.
  - `/api/v1/credentials`: store, list, revoke; never reveal.
  - `/api/v1/person/search`: gated, then an honest 501 until Phase 3.
- **Migrations 0003–0006:**
  - 0003 drops the Phase 2A `roles`, `permissions` and `memberships` tables. They are superseded
    by `auth.member` and the core catalogue, and no deployed code read them.
  - 0004 adds the auth schema and the new columns.
  - 0005 adds the grants and the entitlement trigger.
  - 0006 adds database-generated auth ids.

**Verified at the checkpoint.**

- `pnpm turbo typecheck test --force`: 24 of 24 tasks, 465 tests. By package: core 25, config 108,
  db 169, integrations 99, api 58, web 4, worker 2. The full `build lint typecheck test --force`
  from a clean state: 38 of 38 tasks.
- The dev database, holding Phase 2A seed data, migrated forward from 0002 to 0006 cleanly. The
  seed tenants landed on the default plan with vetting `NOT_SUBMITTED`.
- Live flow against the built server with curl:
  - The operator provisions a tenant.
  - Password sign-in, then every request refused with `MFA_ENROLLMENT_REQUIRED`.
  - TOTP enrolled.
  - A fresh sign-in stops at `twoFactorRedirect`, with no session.
  - The TOTP code yields a session.
  - Set the active tenant, then `/me` and an investigation created.
  - Audit rows appear through the API and in Postgres, with actor, tenant, permission, method,
    session and request id.
  - The server log contained none of the three secrets.
- Mutation testing: 13 deliberate breakages of access control, all caught. They included:
  - Dropping MFA on either path.
  - Dropping the permission check or the module gate, or treating vetting as approved.
  - Allowing undeclared routes.
  - Uncapping API keys.
  - Dropping the Origin check.
  - Taking the tenant from a request header.
  - Skipping the rate limit.
  - Skipping any of the three audit writes.
- Added before commit: `packages/db/test/isolation.auth-schema.test.ts`, a release-blocking suite
  proving the application role cannot read or write the `auth` schema, enforced by grants. It uses
  raw SQL as `app_runtime`, with no application code involved:
  - Every auth table, and every column on its own, is refused with `42501`, with and without a
    tenant context. The same statement succeeds as `app_auth` against a seeded row, so the refusal
    is not vacuous.
  - Each layer is checked on its own:
    - no `USAGE` on the schema;
    - no table, column, sequence or function privilege for `app_runtime` or `PUBLIC`;
    - no role membership (including `pg_read_all_data`) and no superuser;
    - no default privilege that would hand over a future auth table;
    - no view or `SECURITY DEFINER` function reading auth with its owner's rights;
    - no `dblink` or foreign server.
  - The two runtime-to-auth tests in `identity.test.ts` moved into this suite, whose checks are
    strictly stronger.
  - Results: 17 tests. The db package now has 184 tests; the full `lint typecheck test --force`
    ran 34 of 34 tasks.
  - Mutation testing: 12 breakages, all caught by assertions. They were:
    - schema `USAGE` alone;
    - a table grant without `USAGE`;
    - `USAGE` plus a single-column grant;
    - auth opened to `PUBLIC`;
    - a write-only grant;
    - a default privilege;
    - a public view;
    - a definer-rights function;
    - membership of `pg_read_all_data`;
    - membership of `app_auth`;
    - a superuser `app_runtime`;
    - `dblink`.
- Review changes, before commit: `packages/access` extracted (decision 8), and the sign-up
  exception recorded in CLAUDE.md §1.
  - The full `build lint typecheck test --force`: 42 of 42 tasks and 491 tests. By package:
    access 54, core 7, config 108, db 184, integrations 73, api 59, web 4, worker 2.
  - Tests moved with their code: 18 from core and 26 from integrations. 11 are new:
    - the scope rules and the issuer cap;
    - the unknown-key comparison;
    - the sign-up decoy, pinned for both refusal causes.
  - Mutation testing: three breakages, all caught. They were:
    - sign-up refusals answered honestly (only the new test caught this);
    - the issuer cap removed (caught by both the unit and end-to-end tests);
    - an unknown key allowed to match.
- The identity provider's logging is clamped to `warn`, before commit. Better Auth logs email
  addresses at info level (`Sign-up attempt for existing email: …`), which CLAUDE.md §8 forbids.
  - `identityProviderLogger` in `apps/api/src/auth/better-auth.ts` follows `LOG_LEVEL` down to
    `error` and `silent`, never below `warn`.
  - `apps/api/test/identity-logging.test.ts` (release-blocking) builds the provider as the server
    does, once for every `LOG_LEVEL` the schema accepts, and records what its logger writes. It
    also runs a duplicate sign-up at the default level and checks the address appears in no
    output.
  - Mutation testing:
    - raising the provider's level directly: caught;
    - raising the clamp: caught;
    - deleting the config: caught, by the follows-down test only;
    - raising the app's default `LOG_LEVEL` to `debug`: passes, correctly, because the clamp
      holds.

### Decisions taken in Phase 2B

1. **Global identity in an `auth` schema** (your choice). Three database roles with disjoint reach.
2. **`public.users` stays as the per-tenant profile** of an identity. It is created when someone
   joins, disabled when they leave, and never deleted, so a tenant's records keep saying who did
   what.
3. **Static roles in code.** Per-tenant custom roles (Better Auth's dynamic access control) are
   deferred.
4. **The tenant row is created from whichever identity hook fires first.** Better Auth adds the
   creator as a member before `afterCreateOrganization`, so the step is idempotent.
5. **API keys are verified inside the key's own tenant.** The tenant id is part of the key, so no
   cross-tenant lookup exists.
6. **Better Auth's rate limits are stored in Postgres,** shared across replicas. The client IP it
   sees is set from the socket, never from the client.
7. **A refused sign-up is answered like an accepted one.** Better Auth does this for
   anti-enumeration when auto sign-in is off, and I kept it. The review approved it as the one
   exception to the never-fabricate rule, recorded in CLAUDE.md §1.
8. **`packages/access` holds every access decision** (review, before the Phase 2B commit). The
   API and the Phase 4 workers use the same rules through it. It contains:
   - the permission catalogue;
   - plan and vetting evaluation;
   - API key hashing, verification and scope rules, including the issuer cap.

   It is pure: no I/O, and it depends only on `packages/core`. The other code went elsewhere:
   - `packages/db` depends on it for the `Permission` type and the plan and vetting enums.
   - API key storage and lifecycle (`ApiKeyService`) stayed in `packages/integrations`, because
     it needs the database. Moving it would create a cycle: access to db to access.
   - `apps/api` keeps the Fastify guards, the principal resolution, the identity provider's
     wiring and the sign-in routes.

### Open questions (need a human)

- ~~**The anti-enumeration sign-up response is a decoy.**~~ Resolved in review: kept, and
  recorded in CLAUDE.md §1 as the one named exception to the never-fabricate rule, for sign-up
  refusal responses only. `auth-flow.test.ts` pins it: both refusal causes, no invitation and an
  existing account, get 200 and a user id that names no account.
- **Invitation email and email verification are not built** (no email provider).
  - Invitation ids must be shared out of band.
  - Emails are not verified, so whoever knows an email has a pending invitation can register it
    first. They still need the invitation id to join.
  - Verification belongs with signup vetting in Phase 7, and should land before launch.
- ~~**Enrol-on-first-login gap.**~~ Resolved in Phase 4: a first MFA enrolment needs a one-time
  token issued with the invitation (or at provisioning), carried in the hand-shared link. See the
  Phase 4 record.
- **Sign-in and MFA events are not in `audit_log`.** They are not tenant-scoped, so they only
  appear in logs. Decide whether to add a per-user security event log.
- ~~**`apps/api` now holds identity wiring and the access layer.**~~ Resolved in review: the
  decisions moved to `packages/access` (decision 8), which is now in CLAUDE.md §6. The HTTP and
  identity wiring stays in `apps/api`.
- **Better Auth's endpoints are not in the OpenAPI document.** Phase 6 must decide how the web app
  signs in: merge the provider's own OpenAPI schema into ours, or use its client library for
  `/api/auth` only.
- **Plan and vetting changes have no operator console.** Today they are made only as the database
  owner; the trigger audits them. An audited operator path is Phase 7.

### Carry-forwards from Phase 2B

- **Vault findings from its build:**
  - The `credential.read` audit row sits in the caller's transaction, so callers must reveal
    inside a short dedicated transaction.
  - `credentials.last_used_at` is never recorded.
  - Master-key rotation (a keyring and re-wrapping) is not built; it needs a Phase 8 runbook.
- **API key rate limiting is a fixed window,** so a caller can briefly burst up to twice the limit
  across a window boundary. There is no per-user rate limit beyond Better Auth's limits on its own
  endpoints.
- **A new vault master key each dev session** makes earlier local credentials unreadable. This is
  intended locally, but it is why the key must come from a secret manager in production.
- **`public.users.email` copies the identity's email** at join time; later email changes are not
  synchronised.

## Phase 3, session A record: collector SDK, registry and licence gating

No collector was ported; that is session B. Every collector in this session's tests is a fake,
defined in test code only.

**Built.**

- `packages/collectors`: the SDK, with no database or infrastructure dependency. Lint rules and a
  release-blocking dependency test enforce that.
  - **Contract.** A collector declares these fields, as data:
    - id, version, and a display name that becomes its evidence label;
    - discipline, accepted target types and collection mode;
    - its one catalogue source;
    - credential vault ids, and whether it runs without them;
    - the claim strength of its evidence, a run budget and a Zod result schema.

    A collector's implementation is held privately. The only values it can return are
    `found()` and `notFound()` from its own run: they are type-branded and registered at run time.
  - **Platform source catalogue** (`src/catalogue.ts`): 47 upstreams, from
    `docs/audit/COLLECTORS.md` and the Phase 3A decisions.
    - BLOCKED (13): Shodan InternetDB, C2IntelFeeds, InsightFace buffalo_l, YouTube InnerTube,
      YouTube via yt-dlp, the DuckDuckGo scrape, the local network scanner, Google News RSS,
      HackerTarget, AlienVault OTX, UCDP, ReliefWeb and OpenSky.
    - PERMITTED (3): GDELT DOC, GDELT Events and Safecast.
    - UNVERIFIED (31): the rest, including HIBP since the review (below).
    - Attribution is declared for GDELT, HIBP, Nominatim and Wikipedia.
  - **Registry.** It validates the whole catalogue and every collector at startup. It lists BLOCKED
    collectors with their reason and discards their implementations. It exposes attribution for
    reports and screens.
  - **Runtime.** The only way to run a collector. The gates run in this order:
    1. licence;
    2. implemented;
    3. target type and validity;
    4. plan and vetting;
    5. a scope authorisation, for ACTIVE collectors;
    6. credentials.

    Then it enforces the run budget and checks the outcome against the contract. The outcomes are
    FOUND, NOT_FOUND, FAILED, UNAVAILABLE, NEEDS_CREDENTIALS and REFUSED.
  - **Fetcher.** The only outbound path. Every request is held to:
    - the source's declared hosts, at public addresses, over a connection pinned to the checked
      address;
    - redirects only within the allowlist;
    - a mandatory timeout of at most 60 s, and a size cap that also stops decompression bombs;
    - the platform user agent;
    - credential values redacted from recorded URLs;
    - the source's rate limit, shared.
- `packages/osint-engine`: the one evidence path, `CollectionExecutor`, in three steps.
  1. A tenant transaction admits the collector. It syncs the tenant's registry row, reads plan
     and vetting and, for ACTIVE collectors, the scope authorisation in force. It reads
     credentials only once the collector is admitted.
  2. The collector runs outside any transaction.
  3. For FOUND only, a tenant transaction stores each raw payload by hash and writes one evidence
     row per payload.

  It also provides vault-backed credentials, whose reads are audited, and the Redis adapter for
  the upstream limiter.
- `packages/integrations`: `SlidingLogRateLimiter`, a Redis sliding log on Redis's own clock. It
  allows no burst at a window boundary, and fails closed.
- `packages/access`: `DISCIPLINE_MODULE` and `decideDisciplineAccess`.
- `packages/config`:
  - `COLLECTORS_ALLOW_UNVERIFIED` and `allowsUnverifiedSources` (unset: allowed in development
    and test, refused in production);
  - the package-boundaries test.
- `packages/core`:
  - collection modes `PASSIVE_API`, `PASSIVE_DATASET`, `PASSIVE_PUBLIC_WEB`, `LOCAL_ANALYSIS`
    and `ACTIVE`;
  - the verdict `BLOCKED`;
  - `TARGET_TYPES`.
- `packages/db`:
  - Migration 0007 adds:
    - the target-type enum and the new collection modes;
    - `NOT_PERMITTED` renamed to `BLOCKED` in place;
    - the registry rule changed from "enabled only if PERMITTED" to "BLOCKED is never enabled";
    - the `scope_authorisations` table.
  - Migration 0008 adds row-level security and grants for the new table: insert, then revoke
    only. It also adds an `AFTER INSERT` trigger that refuses evidence from any collector not
    enabled for the tenant (`COLLECTOR_NOT_ENABLED`).
  - New code: `ScopeAuthorisationsRepository`, the registry `sync`, and the error type.

**Verified at the checkpoint.**

- `pnpm turbo lint typecheck test --force`: 43 of 43 tasks, exit 0, 687 tests.
  - By package: core 7, access 55, config 118, db 195, integrations 78, collectors 141,
    osint-engine 13, api 74, web 4, worker 2.
  - The fabrication check passed on 189 files; the export check on 81 symbols across 7 entry
    points.
- The release-blocking tests, one per requirement:
  - **A BLOCKED collector cannot run, by any path:**
    - `collectors/test/runtime.test.ts`: the runtime, the registry's internals, the package's
      exports, and a forged outcome;
    - `osint-engine/test/collection.test.ts`: the engine, with no evidence, credential read or
      request;
    - `db/test/collectors.test.ts`: a direct database insert.
  - **UNVERIFIED is refused under the production flag:** the collectors runtime and the engine.
  - **A collector cannot set or alter its source label:** three compile-time `@ts-expect-error`
    proofs, and run-time smuggling and mutation attempts. Evidence from two upstreams is
    distinguishable in the database.
  - **The rate limit is shared across collectors on one upstream:** tested in memory, and with
    Redis across two separate runtimes standing in for two workers.
  - **SSRF:** `collectors/test/address.test.ts` (56 payloads) and `fetcher.test.ts` (URLs, DNS
    answers and redirects, each asserting nothing reached the server), plus the engine.
  - **ACTIVE needs a scope authorisation in the database:** none, another target, another
    tenant's, revoked and in force.
  - **PERSON needs plan and vetting:** each combination.
  - **A failure never produces evidence, a zero or an empty result.**
- The development database, holding Phase 2A seed data, migrated forward to 0008. Its legacy
  `PASSIVE` rows stayed valid, and the seed stayed idempotent.
- Demonstrated with the real catalogue: a fake collector bound to `shodan-internetdb` was refused
  at every layer.
  - Listed as BLOCKED with the recorded reason.
  - `LICENCE_BLOCKED` from the runtime, even fully entitled with unverified sources allowed.
  - `LICENCE_BLOCKED` from the engine, with 0 evidence rows, 0 credential reads and the tenant row
    `enabled: false`.
  - `COLLECTOR_NOT_ENABLED` from a direct database insert.
  - Its code ran 0 times.
- Found and fixed while building:
  - **Real traffic from a test run.** The fetcher's test seam was ignored: Node disregards
    `createConnection` when `agent: false`. So one test run sent a handful of GET requests,
    with made-up `Host` headers, to the placeholder address 1.1.1.1:80. The fetcher now opens
    every socket itself, through one function, to the checked address. A test asserts that
    every connection goes through it.
  - **A trigger that hid other layers.** The evidence trigger was first `BEFORE INSERT`, which
    masked the row-level security and foreign-key refusals the isolation suites prove on their
    own. It is now `AFTER INSERT`, and the isolation tests are unchanged.
  - **A public reach into implementations.** The registry briefly exposed implementations
    publicly. They moved to a module-private map, and BLOCKED ones are no longer stored at all.
  - **A timeout reported as permanent.** A run that overran its budget was reported FAILED; it
    is UNAVAILABLE (retryable), per CLAUDE.md §5.
  - **Three fabrication-gate matches (`?? 0`).** All were fixed in the code, and the fetch method
    default the gate flagged became a required field. The gate was not changed.
- Review changes after the Phase 3A commit:
  - **HIBP is UNVERIFIED**, with the unresolved acceptable-use question recorded as the reason.
  - **Collector credentials come only from the tenant vault.** The four collector variables were
    removed from the env schema. ESLint forbids `process.env` in collector and engine source.
  - **New release-blocking tests** show that no collector credential can be resolved from
    configuration, at every layer:
    - the schema, checked against the catalogue;
    - `loadEnv`, which drops collector credentials;
    - the runtime;
    - the engine, end to end.
  - **An adversarial review** found 24 candidate problems with 75 agents; 1 survived
    three-skeptic verification. The environment test never reached `ctx.credentials.get()`, so it
    could not catch a fallback there. The fix runs collectors that proceed without the key while
    every environment spelling is set. A planted `process.env` fallback in `credentials.get()`
    now fails both the runtime and the engine test.
  - **Results.** `pnpm turbo lint typecheck test --force`: 43 of 43 tasks, exit 0, 695 tests.
    By package: core 7, access 55, config 119, db 195, integrations 78, collectors 147,
    osint-engine 14, api 74, web 4, worker 2.

### Decisions taken in Phase 3A

1. **The code catalogue is the platform truth; tenant registry rows are copies** synced at
   dispatch. This resolves the Phase 2A question with no `tenant_id` exemption.
2. **A licence verdict belongs to the source, not the collector.** Each collector reads exactly
   one source, so a fallback is a separate collector with its own verdict. The fetcher reaching
   only the source's hosts makes an internal fallback impossible.
3. **Evidence has no label column.** It references its collector's registry row, whose label is
   the registry entry's display name. Display names must be unique.
4. **`collection_mode` keeps the Phase 2A value `PASSIVE`**, because Postgres cannot drop an enum
   value in place. Application code cannot write it, and a contract migration removes it once
   no row uses it.
5. **Upstream limits use a sliding log, global per source.** They are not per credential, for
   example per tenant's HIBP key.
6. **Fetches reach declared upstream hosts only.** Collectors that must contact the target
   itself (ACTIVE tools, user-supplied URLs) need a target-host mode, designed with the first
   such collector in session B under the same address checks.
7. **Running LOCAL_ANALYSIS collectors raises `NotImplementedError`** until session B designs
   their evidence basis: the analysed input.
8. **FOUND must carry something.** An empty list, blank text, zero or false alone is refused.
   NOT_FOUND writes no evidence and must cite the response that said so (2xx, 404 or 410).
9. **PERSON collectors map to the person-investigation module.** The other disciplines map to
   the base module until the Phase 7 plan catalogue.
10. **A scope authorisation matches the exact normalised target, per tenant.** It must expire and
    can be revoked. It is not tied to a particular collector.

### Open questions (need a human)

- **Licence URLs to confirm.** The audit quoted these terms pages without recording their
  addresses, so the catalogue's URLs were reconstructed from its descriptions:
  - GDELT: `https://www.gdeltproject.org/about.html`
  - HIBP: `https://haveibeenpwned.com/API/v3`
  - InsightFace: `https://github.com/deepinsight/insightface`
  - C2IntelFeeds: `https://github.com/drb-ra/C2IntelFeeds`
  - YouTube terms: `https://www.youtube.com/t/terms`
  - The OSMF Nominatim policy: `https://operations.osmfoundation.org/policies/nominatim/`
  - The theHarvester, SearXNG and IVRE GitHub pages.
- ~~**HIBP is PERMITTED.**~~ Resolved in review: HIBP is UNVERIFIED. The CC BY 4.0 licence is
  fine, but whether a commercial OSINT-on-persons product satisfies its acceptable-use policy
  (no queries intended to cause harm to the victims) is unresolved. The registry entry records
  that reason.
- ~~**Platform keys or tenant keys?**~~ Resolved in review: tenant keys only. Collector
  credentials come solely from the tenant's vault, with no platform-level fallback for any of
  them. `BRAVE_SEARCH_API_KEY`, `SHODAN_API_KEY`, `HIBP_API_KEY` and `GITHUB_TOKEN` were removed
  from the env schema. Platform-owned keys, such as a future LLM provider key, stay in
  configuration.
- **How far a scope authorisation reaches.** It covers the exact target only. Should it cover
  subdomains, CIDR ranges, or specific tools? The API to record one was built in Phase 4, with
  its own permission and an audit entry for each one created; it still covers the exact target
  only.
- **Tool containers are internal services.** theHarvester, SpiderFoot, SearXNG and IVRE run on
  private addresses, which the fetcher refuses by design. Phase 4 needs an explicit, separately
  audited path for them.

### Carry-forwards from Phase 3A

- **A language-neutral contract** (JSON Schema export, BUILD-PHASES Phase 3 item 2): session B.
- ~~**Metering usage events** per external call, and **circuit breakers and bulkheads**~~: built
  in Phase 4.
- **Code that overruns its budget.** A collector over budget is reported UNAVAILABLE, and its
  fetches are aborted, but CPU-bound code keeps running until the worker's own isolation
  (Phase 4) stops it.
- **Direct evidence writes.** `repos.evidence.record` is still callable directly: the seed and
  test fixtures use it. The database guarantees the collector is enabled, but only the engine
  guarantees the label comes from a real run. Consider restricting evidence recording to the
  engine.
- **Secrets in cited responses.** A collector that cited a token endpoint's response (OAuth) as
  evidence would store the token. Review for this when porting in session B.
- **Absence is not recorded.** NOT_FOUND is not written as evidence of absence.

## Phase 3, session B record: collector migration

Eleven collectors were ported onto the Phase 3A frame, credential-free, one at a time. Ten are
registered in `PLATFORM_COLLECTORS`. `news` is written and tested but held back (below).

**Built.**

| id | Verdict | Licence | Tests | Defect fixed (REWRITE) |
| --- | --- | --- | --- | --- |
| crtsh | REWRITE | UNVERIFIED | 52 | The HackerTarget and AlienVault OTX fallback is deleted. Legacy ran it on any failure and on a genuine zero result, and labelled the rows `crtsh`. A zero result is NOT_FOUND. |
| dns | KEEP (Cloudflare DoH) | UNVERIFIED | 32 | — |
| rdap | KEEP (adapter only) | UNVERIFIED | 23 | — |
| wayback | KEEP | UNVERIFIED | 50 | — |
| news (held) | REWRITE (GDELT DOC) | PERMITTED, attribution declared | 30 | GDELT named as the publisher, "Untitled report", "unknown" and `""` placeholders, the outlet's country turned into coordinates, dropped articles, the "conflict" query substitute, no shared limiter, unstated window and cap. |
| contact.phone | KEEP | PERMITTED (MIT) | 25 | — |
| wikidata | REWRITE (from the news route) | PERMITTED (CC0) | 21 | The QID as a registration number, an invented "Active" status, the "Undisclosed" address fallback, "Verified" matches, variation probing. |
| github | KEEP | UNVERIFIED | 20 | — (legacy name variations and swallowed failures not carried over) |
| hackernews | REWRITE | UNVERIFIED | 19 | Variation probing presented as "Nearest Match", "Verified Active Member", a missing karma defaulted to zero, a keyword search reported as mentions, swallowed failures. |
| devto | KEEP | UNVERIFIED | 17 | — (swallowed failures and handle rewriting not carried over) |
| commoncrawl | NEW | UNVERIFIED | 20 | — Every result, and the NOT_FOUND message, says the index is historical and lags by weeks. |

- **Every collector declares** its discipline, target types, mode, source, a Zod result schema
  and a run budget. Licence, rate limit and attribution live on its catalogue source.
- **Catalogue:** 50 sources, of which 13 are BLOCKED, 5 PERMITTED (GDELT DOC, GDELT Events,
  Safecast, Wikidata, libphonenumber-js) and 32 UNVERIFIED.
  - The rdap source's hosts are rdap.org plus the 376 registry hosts in the IANA bootstrap
    snapshot (`test/snapshots/iana-rdap-dns.json`, kept byte-exact and excluded from Prettier).
  - GDELT DOC declares its attribution. It is not used while news is held.
- **LOCAL_ANALYSIS evidence** (resolves Phase 3A decision 7): `ctx.record(output)` records the
  analysis, and it is the cited evidence, with no source URL and strength DERIVED.
- **Offline test harness** (`test/platform/harness.ts`): recorded fixtures on a local https
  server; exact host and path matching; anything unmatched is answered 599 and listed. Every
  fixture states its provenance: `recorded`, `recorded-redacted` or `synthetic`, with a source
  URL, a date and notes. No test reaches the network.
- **The `derived` rule** (review decision 2): a value the collector computed or stated itself
  belongs under a `derived` key, and the evidence row keeps its single strength.
  - The registry refuses a non-local collector whose result schema lacks a top-level `derived`
    object.
  - After every FOUND, the runtime checks that each string, number and boolean outside any
    `derived` key appears as a value in a cited response. Null (absence) is exempt. A breach is
    COLLECTOR_CONTRACT_VIOLATION, naming the field, never the value (`src/provenance.ts`).
  - Emptiness is judged without `derived`: a result of derived values only found nothing.
  - Moved under `derived`:
    - github: the repositories' partial flag, the requested counts, and whether a key was used;
    - hackernews: the submitted-item count, the ISO creation time, the item kind, the requested
      count and the partial flag;
    - commoncrawl: the query, `limitReached`, the note and the ISO capture time;
    - rdap: `respondingHost`;
    - wayback: the query, coverage, the replay URL and the ISO capture time;
    - news: the search, the counts and the ISO seen date;
    - wikidata: the search and the note;
    - crtsh: the per-certificate split names.
  - Reported as sent instead of converted: GitHub's full commit message, Hacker News's `created`
    Unix seconds, Common Crawl's status, offset and length strings, crt.sh's `name_value`.
- **Refused versus rejected** (review decision 4): a 401 or 403 is
  UPSTREAM_REJECTED_CREDENTIALS only when the run was handed a vault credential. Otherwise it is
  UPSTREAM_REFUSED. The runtime decides; collectors cannot.
- **libphonenumber-js pinned to 1.13.14** (review decision 3). A test pairs the installed
  version with contact.phone's version, so an upgrade fails CI until the collector's version is
  bumped too.

**Self-review (step 4) findings, fixed with a regression test each.**

- wayback stamped the newest first-capture over the first 200 URLs on its evidence as
  `observedAt`. That was a derived value, not the archive's date; `observedAt` is now null.
- github read GitHub's secondary rate limit (403 with Retry-After or the secondary-limit
  message) as rejected credentials, which are never retried. It is UNAVAILABLE now.
- dns reported a truncated answer with no A records as NOT_FOUND. It is FAILED now.
- hackernews used one label for two operators. It is "Hacker News account (HN API and Algolia
  HN Search)".
- commoncrawl called a reached cap `partial`; it is `limitReached` now. It also accepted
  impossible dates such as 31 February; a round-trip check rejects them.
- wayback's and wikidata's NOT_FOUND messages now state their scope: subdomains not searched,
  and the search language.
- Checked and disproved: crt.sh's `%.domain` search includes apex-only certificates (2 in the
  recording). GitHub's commit search answers an organisation login with 200 and 0, not 422.

**Held: news.** Its NOT_FOUND treats GDELT's `200 {}` as "no coverage". Live, `"ietf.org"`
answered `200 {}` twice (2026-09-30), and no control query for a domain that is certainly in the
news got through: GDELT answered 429, then refused connections. So `{}` may mean "query not
understood", and news's NOT_FOUND may be systematically false. Its found fixture is synthetic
for the same reason. **What resolves it:** one live, recorded FOUND for a quoted-domain query.
Then register news, replace the synthetic found fixture, and keep a recorded `{}` for a domain
with no coverage. *Resolved in Track M Day 2 (below), on the owner's instruction: news is
registered, an empty answer is never NOT_FOUND but unconfirmed, and the found fixture is a live
recording, of a topic; no live FOUND for a domain phrase could be recorded.*

**Verified at the checkpoint.**

- `pnpm turbo lint typecheck test --force`: 43 of 43 tasks, exit 0, 1,018 tests.
  - By package: core 7, access 55, config 119, db 195, integrations 78, collectors 470,
    osint-engine 14, api 74, web 4, worker 2.
  - The fabrication check passed on 218 files; the export check on 81 symbols across 7 entry
    points.
- The run before it failed one api test, "fails fast on invalid config". Its spawned server
  exceeded the test's 20 s limit under the parallel load. It passes alone (74 of 74) and in the
  rerun. That code was not changed in this phase; see carry-forwards.

### Decisions taken in Phase 3B

1. **news is held unregistered** until a live FOUND for a domain phrase is recorded. *Superseded in
   Track M Day 2: registered on the owner's instruction (below).*
2. **A mandatory `derived` block, not per-field strength.** It is enforced at registration and
   on every run.
3. **libphonenumber-js is pinned exactly.** Every upgrade bumps contact.phone's version.
4. **A refusal is a credentials failure only when a credential was sent.**
5. **A fixture that could not be recorded is synthetic and says why.** GDELT's found answer
   (429s) and Common Crawl's no-captures answer (repeated 504s) are the two that matter.
6. **Recorded fixtures of real accounts are redacted.** Handles and free text become
   placeholders; ids, dates and counts stay as recorded. The Hacker News fixtures are
   `recorded-redacted`, and so is any fixture whose headers were trimmed.

### Open questions and carry-forwards from Phase 3B

- ~~**The label is not checked against the hosts**~~: built in Phase 4. Every source names the
  operator of each of its hosts, and the registry refuses a collector whose label does not name
  them all.
- **GitHub's `derived.repositories.partial` can't be checked from its evidence.** It comes from
  the Link header, and evidence stores only the body.
- **rdap for a subdomain answers NOT_FOUND.** The registry's 404 is literal, but the wording
  could say that subdomains are not registered objects.
- **Common Crawl's no-captures answer is unrecorded.** If the real answer differs from pywb's
  documented 404 "No Captures found", absence surfaces as FAILED: never a false NOT_FOUND, but
  never NOT_FOUND either. Record it when the index server is healthy.
- **Handles Hacker News can't hold** (core accepts `.` and Unicode letters in usernames) fail
  as FAILED, not NOT_FOUND. This errs on the safe side.
- **The value-provenance check matches values, not paths.** It catches a computed value but
  cannot prove a value came from the right field; the per-collector tests do that.
- **The flaky api test.** `apps/api/src/server.test.ts`, "fails fast on invalid config", can
  exceed its 20 s spawn limit under full parallel load.
- **Still open from Phase 3A:**
  - the language-neutral contract (JSON Schema export);
  - metering, circuit breakers and bulkheads (Phase 4);
  - direct evidence writes;
  - absence not recorded as evidence.

  Resolved in 3B: LOCAL_ANALYSIS evidence. Secrets in cited responses were reviewed: no ported
  collector cites a token endpoint, and a test asserts GitHub's key never appears in an
  evidence URL.

## Phase 4 record: jobs, orchestration and fault isolation

An investigation now runs in the background. The API creates a QUEUED run and returns at once. A
planning job fans the run out to one collector job per planned collector, each on its source's
own queue, and fans back in to fusion. Postgres holds every job's state; BullMQ only delivers
ids. Out of scope by your decision: tool containers and Postgres-backed monitors (see
carry-forwards).

**Built.**

- **Job flow** (`packages/osint-engine`, BullMQ 6.3.10 on Redis):
  - `investigations`: one planning job per run (`RunCoordinator.plan`). It records the plan,
    creates each collector job under its idempotency key, and adds the run's flow.
  - `collect.<source>`: one queue per upstream source, holding that source's collector jobs
    (`CollectorJobProcessor`).
  - `fusion`: the flow's parent, released when every child has finished, succeeded or failed
    (`RunFusion`).
  - `dead-letter`: a record of every job that ran out of attempts. Nothing consumes it.
  - Messages carry ids only, never a target, and are validated on receipt.
- **One worker codebase** (`apps/worker`), deployed as pools. `WORKER_QUEUES` selects queues by
  name, by `collect.*`, or `*`. The worker connects to Postgres and Redis, reveals collector
  credentials from the tenant vault (audited), and shuts down gracefully.
- **Fault isolation**, each piece with its release-blocking test:

  | Requirement | Mechanism | Test |
  | --- | --- | --- |
  | Per-call timeouts | Fetcher timeout per request; the collector's run budget; Redis commands bounded; the planning retry for a run not yet committed is 250 ms | `pipeline.test.ts` hung collector |
  | Bulkheads | One queue per source; fixed concurrency per queue (`COLLECT_CONCURRENCY`), also set as BullMQ global concurrency so it holds across every worker | hung collector: 3 fast jobs finish while the hung source's jobs wait one at a time |
  | Circuit breakers | `RedisCircuitBreaker` (`packages/integrations`): per source, shared by every worker, Redis clock, one half-open probe with a lease, fails closed. Counts source faults only (5xx, timeouts, unreachable, invalid answers), never rate limits or refusals. A job refused by an open circuit waits for the cooling period, and nothing is sent | `circuit-breaker.test.ts` (10); pipeline "stops calling the archive" |
  | Dead-letter queue | The last UNAVAILABLE attempt, or a crash on the last attempt, marks the job DEAD_LETTERED and writes a dead-letter record. Replay: `POST /api/v1/jobs/{id}/replay` | pipeline and API checkpoint tests |
  | Idempotency | Key = sha256(tenant, run, collector, target, params). Enqueue lands on one row; evidence, usage and the job's state commit in one transaction; a finished job is skipped; result, evidence and fusion are write-once in the database (`JOB01`) | pipeline "replayed job" block (4 tests); `jobs.test.ts` |
  | Retries by cause | Only UNAVAILABLE is retried, with backoff at least the upstream's Retry-After; FAILED, REFUSED and NEEDS_CREDENTIALS end at once | pipeline "retries distinguish cause" |

- **Metering**: every request a collector sends (redirect hops included) is counted by the
  fetcher and recorded as `UPSTREAM_REQUEST` usage, once per job attempt (unique on job,
  attempt and unit). Quotas (`tenant_quotas`, operator-set, read-only to the application) are
  checked when a run starts (429 `QUOTA_EXCEEDED`) and again before each job is dispatched.
  `GET /api/v1/usage` shows the day's and month's use beside the quotas.
- **API** (the API never waits on collection):
  - `POST /api/v1/investigations/{id}/runs` returns 202 with the QUEUED run.
  - `GET /api/v1/investigations/{id}/runs` and `GET /api/v1/runs/{id}`.
  - `GET /api/v1/runs/{id}/events`: server-sent events (`run`, `job`, `end`), read from Postgres
    in short tenant transactions; no transaction is held open for the stream.
  - `POST /api/v1/jobs/{id}/replay`.
  - Scope authorisations (Phase 3B item): create, list and revoke. A signed-in person must be
    the authoriser, never an API key; the exact normalised target; at most 366 days; audited.
  - New permissions: `run:start`, `run:read`, `job:replay`, `scope_authorisation:read`,
    `scope_authorisation:write` (admins and owners) and `usage:read`.
- **Label names every operator** (Phase 3B item): each catalogue source now declares who
  operates each of its hosts, and the registry refuses a collector whose label does not name
  them all (whole-word match). The hackernews case is a regression test.
- **MFA enrolment token** (Phase 2B item): a first enrolment needs a one-time token.
  - It is issued with the invitation, returned once in the invite response for the hand-shared
    link, or issued at provisioning (printed once for the operator).
  - It is stored only as a SHA-256 (new columns on `auth.invitation` and `auth.user`; no new
    auth table).
  - `enable`, `get-totp-uri` and `verify-totp` all require it (header `x-mfa-enrolment-token`)
    until the user is enrolled; it is spent when verification succeeds.
  - Re-inviting someone who never enrolled issues a fresh token.
  - A mutation that removed the guard failed 6 of the 8 tests.
- **PERSON gating in the worker**: the planner and the job processor both admit through the
  runtime's `@repo/access` check, the same decision the API applies. A PERSON collector is
  excluded at planning for a tenant not entitled to it, and refused at dispatch if a job
  reaches the worker anyway.
- **Migrations 0009–0012**:
  - Job and run columns, and job outcomes.
  - `tenant_quotas`, with row-level security and select-only access for the application.
  - Per-attempt usage.
  - Entity identifiers, resolved uniquely; relationships unique.
  - The write-once trigger.
  - The auth enrolment-token columns.
- **`@repo/collectors/testing`**: the fixture harness, exported so the engine and API tests run
  the real registered collectors offline. A lint rule stops any collector source from importing
  it.

**Ported from `legacy/src/utils/osint/`.**

| Module | Verdict | Became | Defect fixed (regression test) |
| --- | --- | --- | --- |
| query-planner.ts | KEEP | `detectTargetType` (core) and `planRun` (engine) | An empty input was guessed to be a "person"; now `EmptyTargetError`. Exclusions are recorded with their reasons (legacy's list was always empty) |
| orchestrator.ts | ADAPT | `RunCoordinator`, the queue flow and `RunFusion` | No overall timeout: now per-collector budgets, retries and the dead-letter queue (hung-collector test). The global registry is now injected |
| jobs.ts | ADAPT | Replaced by BullMQ and the `jobs` table | Process memory: now durable, replayable jobs. No owner: now tenant-scoped rows (API isolation test). Cancellation: not built (carry-forward) |
| job-store.ts | KEEP | Superseded by the `jobs` table; not ported | — |
| job-store-sqlite.ts, index.ts | DROP | — | — |
| merge.ts | KEEP | Exact-key dedupe as database constraints | — |
| entity-resolution.ts | KEEP | `fusion/identifiers.ts`, resolution at write | Three fixes, each tested: no invented confidence score (legacy's 0.5 + 0.15 per source); usernames keep their case (Hacker News handles are case-sensitive); an unparseable URL gets no identifier |
| contradictions.ts, timeline.ts, gaps.ts, verification.ts, person-*.ts | various | Not ported this phase | Phase 5 or later |

- ADAPT was handled as you decided: keep the logic, fix the boundary defect INVENTORY names, and
  add a regression test for it.

**The checkpoint.** A run of `example.com` against four registered collectors (crtsh, dns, rdap,
wayback), with wayback deliberately failing (its synthetic 503 fixture), as the running API
reports it:

```
SSE run:QUEUED | run:RUNNING | job:crtsh=SUCCEEDED | job:wayback=QUEUED | job:rdap=SUCCEEDED |
    job:dns=SUCCEEDED | run:RUNNING | job:wayback=RUNNING | run:RUNNING | job:wayback=DEAD_LETTERED |
    job:crtsh=SUCCEEDED | job:rdap=SUCCEEDED | run:PARTIAL | job:dns=SUCCEEDED | end:PARTIAL
RUN status PARTIAL, settled; counts SUCCEEDED 3, DEAD_LETTERED 1
  crtsh    crt.sh Certificate Transparency        SUCCEEDED      FOUND        attempts 1, evidence 1
  wayback  Wayback Machine captures               DEAD_LETTERED  UNAVAILABLE  attempts 3, evidence 0
           UPSTREAM_UNAVAILABLE: "The upstream is unavailable: the Wayback CDX API answered HTTP 503."
  rdap     RDAP registration data                 SUCCEEDED      FOUND        attempts 1, evidence 1
  dns      DNS over HTTPS (Cloudflare resolver)   SUCCEEDED      FOUND        attempts 1, evidence 1
```

**Verified at the checkpoint.**

- `pnpm turbo lint typecheck test --force`: 44 of 44 tasks, exit 0, 1,156 tests.
  - By package: core 20, access 55, config 119, db 216, integrations 88, collectors 482,
    osint-engine 72, api 96, web 4, worker 4.
  - The fabrication check passed on 244 files; the export check on 102 symbols across 7 entry
    points.
- The run before it failed only `@repo/web`: its test worker did not start within 60 s under
  the parallel load ("Timeout waiting for worker to respond"). It passes alone (4 of 4) and in
  the rerun. The web code did not change this phase; only its generated client did.
- Found and fixed while building:
  - **A timeout reported as a permanent failure** (runtime). At the run budget the runtime
    aborted the collector before rejecting. A collector that stopped on the abort signal won
    the race with its own error: FAILED `COLLECTOR_ERROR` (never retried) instead of UNAVAILABLE
    `COLLECTOR_TIMEOUT`. It now rejects first. The regression test fails without the fix.
  - **Fusion refuses a collector it has no extractor for.** The run then stays unfinished and the
    fusion job dead-letters, rather than settling over unfused results. A test checks that every
    registered collector has one.
  - **A quota column named `limit`** (a reserved word) was renamed `max_quantity` before
    shipping.
  - **A read-only table in the RLS probe.** The release-blocking insert probe had assumed every
    table is insertable. For a read-only table it now names all columns and is still refused
    (42501). The check is not weakened.
  - **Five `?? 0` fallbacks** flagged by the fabrication gate (one in the retry policy, four in
    tests) were replaced with explicit null handling. The gate was not changed.

### Decisions taken in Phase 4

1. **ADAPT modules keep their logic and fix the named boundary defect** (your decision).
2. **A tenant with no quota row has no limit on that unit** until Phase 7 ties quotas to plans
   (your decision). Quotas are operator-set; the application cannot write them.
3. **Tool containers and monitors are deferred** (your decision).
4. **The idempotency key includes the run.** A retry or replay of a run's job never runs twice,
   but a new run of the same investigation (or a monitor's next run) collects again. Without the
   run in the key, a target could never be re-collected.
5. **Postgres is the truth for job state; BullMQ only delivers ids.** A replay reuses the job's
   row and key with a fresh attempt budget. Attempt numbers only ever grow, so usage per attempt
   is never overwritten.
6. **An open circuit makes a job wait, not fail.** The job is UNAVAILABLE and retried after the
   cooling period; the wait counts as an attempt and sends nothing.
7. **Fusion resolves by identifier as it writes.** One entity per kind and normalised
   identifier, so no after-the-fact merge needs a score. A person or organisation is resolved
   only by an external id (`wikidata:Q…`), which the database enforces. Values under `derived`
   become DERIVED claims. `entity_merges` stays for analysts' reversible merges.
8. **The worker holds the vault master key, never `AUTH_SECRET`.** It reveals a collector's
   tenant credential where the collector runs; every reveal is audited.
9. **The API enqueues in the run's own transaction.** The planner retries `RUN_NOT_READY`
   quickly until the transaction commits; if it rolled back, the planning job dead-letters,
   visibly.
10. **Progress streams by polling Postgres**, not Redis pub/sub, so row-level security isolates
    tenants. Polling uses short transactions every `RUN_EVENTS_POLL_MS`, and a stream lasts at
    most an hour.
11. **The enrolment token lives on existing auth tables.** No new auth-schema table, so the
    identity exception in CLAUDE.md §2 is unchanged.

### Open questions and carry-forwards from Phase 4

- **Deferred by decision:**
  - tool containers (SpiderFoot, theHarvester), with the separately audited private-address path
    from Phase 3A;
  - monitors materialised from Postgres into repeatable jobs.
- **Cancelling a run** (legacy `jobs.ts` defect) is not built: there is no cancel endpoint.
- **CPU-bound collector code** keeps running after its budget (Phase 3A carry-forward). The run
  is reported UNAVAILABLE and its fetches aborted, but sandboxed processors or worker threads
  would stop it.
- **Usage can under-count, never over-count.** An attempt that crashes before recording its
  outcome is not metered. A duplicate delivery running concurrently is not charged (the
  platform's duplicate, not the tenant's). Quotas can overshoot by the requests of jobs already
  in flight. Only `UPSTREAM_REQUEST` is enforced.
- **Operator views:**
  - The dead-letter queue is an operator record in Redis; tenants see their DEAD_LETTERED jobs
    through the API.
  - Listing across tenants belongs to the cross-tenant operator design (Phase 2A open question).
  - BullMQ's failed set is kept indefinitely, so it needs a retention policy (Phase 8).
- **Quotas have no operator tooling;** they are set as the schema owner. Phase 7.
- ~~**news** still has no extractor; registering it will need one (a test enforces this).~~ Built in
  Track M Day 2: it checks the result and draws nothing from it yet.
- **The progress stream polls.** Consider a push signal at scale.
- **Two load flakes seen:** the api server-spawn test (Phase 3B), and the web test worker start
  (this phase). Both pass alone and on rerun.

## Phase 5 record: analysis and reporting

A settled run can now be turned into a report, in the background. Everything a report states as
fact comes from the run's stored evidence and claims; one optional section, the synthesis, is
written by an open-weight model, cited, and validated. Every report opens with what was NOT
collected and why. Reports download as PDF, JSON, CSV and a Maltego graph table.

**Built.**

- **`packages/llm`** (it had no code before this phase):
  - Provider interface, one implementation: the OpenAI-compatible chat completions format both
    profiles serve. Every call has a timeout. A 429 or 5xx is retryable (with the provider's
    Retry-After); any other 4xx is not. Error messages never carry the provider's response
    body, which can echo the prompt.
  - **Open-weight allowlist** in `packages/config/src/llm.ts`, reviewed code rather than an
    environment variable. It holds five Apache-2.0 models: Qwen3-8B, gpt-oss-20b (small),
    Qwen3-32B, gpt-oss-120b, Mistral-Small-3.1-24B (large). Licence and base model were read
    from each model's Hugging Face API card on 2026-09-30. A test refuses any entry that is
    Llama-derived (by id or base model), Gemini, or not permissively licensed. Azure OpenAI
    endpoints are refused at startup.
  - **Profiles.** Hosted is the default. vLLM is built and validated but disabled: selecting it
    without `LLM_VLLM_ENABLED=true` stops startup. Its compose service (`vllm`, image pinned by
    digest) starts only under the `llm-selfhosted` profile; `docker compose --profile
    llm-selfhosted config` validates.
  - **Task routing:** extraction and classification go to the small model, synthesis to the
    large one.
  - **Redis response cache**, keyed by prompt, model, served name, profile and prompt version,
    and namespaced by tenant. Only accepted answers are stored. If the cache is down, the call
    goes to the model.
  - **Per-tenant token metering:** every call that consumed tokens is recorded, a rejected one
    included. A response without token usage is refused, since an unmetered call cannot be
    charged.
  - **Prompt-injection defence:**
    - Collected data reaches a model only as JSON inside one delimited block. Every `<`, `>` and
      `&` is escaped, and the boundary is a hash of the data, so nothing inside the block can
      close it.
    - Instructions can only be `trusted` template literals with no interpolation, enforced by
      the type system and at runtime.
    - Every answer is checked against a strict schema.
    - Output guards reject any answer that:
      - leaks the instructions' marker or markup;
      - echoes instruction-like source text;
      - reads as instructions itself;
      - names an identifier its cited records do not hold outside instruction-like text;
      - carries a call to action;
      - pronounces a safety, trust or risk verdict.
    - Zero-width characters and Unicode tag characters are decoded before scanning.
  - **Citation validator** (ported, see below). Every statement cites at least one supplied
    reference. Corroboration and CORRELATED need two independent sources. Certainty language is
    rejected unless negated. An answer is retried once with fixed-text corrections, then fails.
  - **CI injection corpus** (`test/fixtures/injection-corpus.json`, synthetic): 14 payloads, each
    from a published technique, set in collected content (known payloads, web pages, a news
    article, profile bios, a commit message, a DNS TXT record, a Wikidata description). For each
    payload:
    - the scanner flags it;
    - it reaches the model only inside the block;
    - a model that obeys it is rejected twice, by the named guards;
    - an honest answer passes.

    Nine benign texts about AI are not flagged.
  - **Evaluation harness** (`eval/golden.json`, `src/eval.ts`): three golden investigations, each
    with a reference answer and probes, scored for citation validity and hallucination rate.
    - In CI, the reference answers must score 1.0 and 0, and all 10 probes must be caught.
    - `pnpm --filter @repo/llm eval:live` scores the configured model through the production
      pipeline. It exits 2 when there is no provider.
- **Claims (item 4): strength is now decided by path.** An extractor names where a value is in
  the result and never supplies the value or the strength. Fusion reads the value: a path
  through `derived` is DERIVED; any other path takes the evidence's strength, with nested
  `derived` blocks stripped from the value. A value inside `derived` can no longer be stored as
  OBSERVED or REPORTED.
- **Report pipeline** (`packages/osint-engine/src/reports/`):
  - Assembly from a settled run: findings per entity with labelled, cited claims; relationships;
    sources numbered in citation order; attributions; and warnings for sources whose content
    reads as instructions to an AI.
  - **Coverage and limitations**, per collector:
    - COLLECTED, NOTHING_FOUND, FAILED, NEEDS_CREDENTIALS, REFUSED or NOT_FINISHED, each from the
      job's recorded outcome and error;
    - EXCLUDED, from the run's recorded plan, with its reason (plan, vetting, licence, scope);
    - HELD, for news;
    - not applicable, listed separately;
    - a headline, PARTIAL RUN, FAILED RUN or COMPLETE RUN, stated first;
    - fixed caveats on every report;
    - an omitted-claims count at the 2,000-claim limit.
  - **Synthesis** (optional): written from the report's own claims as untrusted records.
    Strength is CORRELATED, INFERRED or HYPOTHESIS only.
  - **Generation job** on a `reports` queue with its own bulkhead (`REPORT_CONCURRENCY`):
    - claim, then generate outside any lock, then record usage and state together;
    - an unavailable model is retried with backoff;
    - a rejected answer, a refused request, an unsettled run, a spent token quota, or a missing
      provider each fail the report with its reason;
    - a crash on the last attempt is failed and dead-lettered;
    - a finished report delivered again does nothing and is not charged.
  - **Stored write-once**: migration 0014's trigger refuses to replace a document or change a
    finished report's status (REP01), for every role.
- **PDF** (`packages/integrations/src/exports/pdf.ts`, pdf-lib with fontkit):
  - Noto Serif (OFL, vendored with SHA-256s checked by a test) at 12 pt for body text; 10 pt for
    footnotes, tables, header and footer.
  - Labels printed as text (`[REPORTED]`), and all text in black.
  - A numbered superscript per citation, with its footnote on the same page.
  - Coverage first, a boxed partial-run notice, then a glossary of strengths.
  - An evidence-basis table with a repeating header, and an attribution section.
  - The handling marking top and bottom of every page. With no marking it says "NO HANDLING
    MARKING IS SET FOR THIS ORGANISATION".
  - Characters outside the font's coverage are shown as `?` and counted in a rendering note.
- **Exports** (`REPORT_EXPORT_FORMATS`: pdf, json, csv, maltego). Every format carries the
  handling marking and attribution, and every tabular row carries the strength and citations.
  - JSON is the whole report document.
  - CSV has one row per claim or relationship.
  - The Maltego export is an edge list for Import Graph from Table, keeping the platform's kind
    beside each Maltego type.
- **Attribution rule (item 7):**
  - A test renders every export format for every catalogue source that declares attribution, and
    fails if the text or URL is missing.
  - An engine test runs a collector on an attribution-requiring source end to end and finds the
    attribution in the document and the PDF.
- **API:**
  - `POST /api/v1/runs/{id}/reports` returns 202 with `{synthesis: boolean}`. It refuses with:
    - 409 `RUN_NOT_SETTLED`;
    - 409 `SYNTHESIS_UNAVAILABLE`, with the reason;
    - 429 `QUOTA_EXCEEDED` on token quotas.
  - `GET /api/v1/runs/{id}/reports` and `GET /api/v1/reports/{id}`. The document is validated
    against its Zod schema on the way out.
  - `GET /api/v1/reports/{id}/export/{pdf|json|csv|maltego}`, or 409 `REPORT_NOT_READY`.
  - `PUT /api/v1/settings/report-handling-marking` (`organization:update`).
  - New permissions: `report:create` (analyst and above) and `report:read` (every role).
  - A run holding person data gates its reports through `@repo/access`, read from the tenant's
    own registry rows.
- **Migrations:**
  - 0013: the `reports` table, `usage_events.report_id` with a once-per-attempt index, and the
    tenant's `report_handling_marking`.
  - 0014: row-level security, column grants, and the write-once trigger.
  - The new usage key is added `NOT VALID`. The column is new and every row holds null, so there
    is nothing to validate, and a validating scan is refused by forced row-level security when
    no tenant is set.

**Ported from legacy.**

| Module | Verdict | Became | Defect fixed (regression test) |
| --- | --- | --- | --- |
| llm.ts | ADAPT | `packages/llm` provider, cache, metering | Collected text sat between `"""` inside instructions; a source containing `"""` escaped it (framing.test.ts). Also: keys from env, process-memory cache and log |
| reports.ts (validateCitations, generateProduct) | ADAPT | `citations.ts`, `generate.ts`, report synthesis | The bottom line was never cited or checked; citations were document numbers; two items from one source counted as corroboration; the retry prompt quoted the model's rejected words; the model labelled its own statements "reported" (citations.test.ts, generate.test.ts) |
| cases/case-analysis.ts (validateGroundedAnswer) | ADAPT | `citations.ts` | INFERRED and HYPOTHESIS findings could cite nothing (citations.test.ts) |
| cases/case-report.ts (completeness) | KEEP | `reports/assemble.ts` | Could not tell nothing found from failed; recomputed the plan at report time (reports.test.ts) |
| report-pdf.ts | ADAPT | `exports/pdf.ts` | Helvetica 9.5 pt, colour-coded labels, a fixed "UNCLASSIFIED" banner, characters silently replaced, product name hard-coded |
| maltego-export.ts | KEEP | `exports/tabular.ts` | Collected values went into cells unguarded: `=HYPERLINK(...)` ran as a formula (exports.test.ts) |
| analysis-llm.ts, credibility-llm.ts | ADAPT | Not ported | No consumer this phase |

**The checkpoint.** A report from a real Phase 4 run of `example.com`, through the reports queue
and worker:
- crtsh, dns and rdap answered from their recorded fixtures;
- wayback deliberately failed with its synthetic 503;
- the tenant's marking was set.

```
REPORT f5ad5550-5a4e-4aef-a15f-750eb83ec0a4 run 864fc76b-f023-4faa-8bd2-51a616d54924 status PARTIAL
HEADLINE PARTIAL RUN: 1 of 4 planned collectors did not complete, so this report does not cover
         what they would have collected (3 found something, 0 found nothing). 1 further
         collector(s) were excluded or held and did not run.
  COLLECTED  dns      DNS over HTTPS (Cloudflare resolver) | attempts 1
  COLLECTED  rdap     RDAP registration data | attempts 1
  COLLECTED  crtsh    crt.sh Certificate Transparency | attempts 1
  FAILED     wayback  Wayback Machine captures | UPSTREAM_UNAVAILABLE | The upstream is
                      unavailable: the Wayback CDX API answered HTTP 503. | attempts 3
  HELD       news     GDELT news coverage | COLLECTOR_HELD | Held off the platform until one live
                      FOUND for a domain phrase is recorded (docs/PLAN.md, Phase 3B).
CLAIMS 114 (all cited), RELATIONSHIPS 9, SOURCES 3, OMITTED 0
SYNTHESIS GENERATED 2 statements, attempts 1 (scripted provider)
PDF 926646 bytes
```

The rendered PDF was read back as text and drawn to PNG for review: 17 pages, with the handling
marking twice on each. Review found one defect, fixed with a regression test. crt.sh lists names
one per line, and the renderer dropped the line breaks, printing `example.comwww.example.com`.
They now render as `example.com / www.example.com`.

**Verified at the checkpoint.**

- `pnpm turbo lint typecheck test --force`: 46 of 46 tasks, exit 0, 1,359 tests.
  - By package: core 20, access 55, config 133, db 230, integrations 113, collectors 482,
    llm 115, osint-engine 94, api 109, web 4, worker 4.
  - The fabrication check passed on 284 files; the export check on 137 symbols across 8 entry
    points (`@repo/llm` added).
- Earlier full runs this phase failed on, and were fixed:
  - root format check (three files);
  - an unused type import in the config tests;
  - the release-blocking credentials guard, which lists every secret-shaped variable. The two
    platform-owned LLM keys were added to it with their reasons, as the test's own comment
    anticipates. The guard was not weakened.
- Found and fixed while building:
  - **The Maltego export lost attribution.** The attribution test caught it: a source cited
    only by claims about a linked entity had its attribution on no row. Every Maltego row now
    carries every attribution the report requires.
  - **Assembly asked for more rows than the repository allows** (2,000 against a 1,000 cap),
    crashing generation. Queries are now bounded per chunk, and anything left out is counted
    exactly.
  - **The person-data gate on reports trusted the platform registry**, so a collector
    missing from it would pass ungated. It now reads the tenant's own registry rows, and a
    test covers it.
  - **pdf-lib font subsetting dropped glyphs** (seen on the rendered pages). Fonts are
    embedded whole.
  - **Line breaks inside values were dropped** (the checkpoint defect above).

### Decisions taken in Phase 5

1. **No hosted vendor is chosen.** The hosted profile is the default but reports itself NOT
   CONFIGURED until `LLM_HOSTED_BASE_URL` is set. Which provider, under what data-processing
   terms and in which region (India residency, ARCHITECTURE-DECISIONS §10), is your decision.
   - **OpenRouter, evaluated 2026-10-01: no residency guarantee.** OpenRouter is a router, not a
     host: each request is forwarded to one of several third-party inference providers, chosen
     per request, so a prompt (collected content included) may be processed by any of them, in
     any of their regions, under each one's own data terms. The key's account reports
     `allowed_data_regions: ["global"]`. Nothing in our provider pins the upstream provider or
     region. As configured it cannot meet the India-region requirement and is suitable for
     development and evaluation only, not for tenant data.
   - Its free tier serves none of the allowlisted models (checked against its model list that
     day), so it was not wired up.
   - **Hugging Face Inference Providers, wired up for development 2026-10-01: no residency
     guarantee either.** `https://router.huggingface.co/v1` is also a router: each request goes
     to a third-party inference provider (for `openai/gpt-oss-120b` that day: groq, novita,
     cerebras, nscale, together, fireworks-ai, featherless-ai, scaleway, baseten, ovhcloud,
     deepinfra), chosen by the router unless a provider is named, under that provider's own data
     terms and in its own regions. A request, collected content included, may be processed
     outside India. Development and evaluation only; not for tenant data until a provider and
     region are pinned and the residency question is decided.
   - **Which provider served each call is now recorded** (2026-10-01), from the router's
     `x-inference-provider` response header: per call in `usage_events.model_calls` (a rejected
     answer's call included, since a provider still processed the material), and for the
     accepted answer in the report document (`synthesis.model.servedBy`, report format 3). A
     cache hit reports the provider that produced the answer originally. Null means the endpoint
     named none, never a guess. Not covered: a call that failed before the endpoint answered
     (timeout, refused connection) records nothing, though it may have reached a provider.
     Recording is not pinning: the router still chooses, so this answers "who processed it",
     not "where it may go".
   - **Structured output is `json_schema` for this profile.** Probed 2026-10-01 with the
     production synthesis schema and a prompt demanding prose, a non-`E` reference and an extra
     field: every one of the 10 providers that answered (cerebras, groq, novita, nscale,
     together, fireworks-ai, featherless-ai, scaleway, baseten, and the router's default pick,
     cerebras) returned schema-conforming JSON. The control without a schema could not be run:
     the account's monthly included credit ran out during the probe (HTTP 402 on every call,
     ovhcloud and deepinfra included). Schema conformance is shape only: refs may still be
     empty or unknown, and nscale and scaleway wrote the model's reasoning into a statement's
     text. The citation validator and output guards remain the gate.
   - **Groq, direct, from 2026-10-01** (`https://api.groq.com/openai/v1`, `openai/gpt-oss-120b`,
     `json_schema`), replacing the Hugging Face router for development. **The provider is now
     known rather than router-chosen:** every request goes to Groq, fixed by configuration,
     not picked per request from eleven third parties. That narrows the residency question to
     one provider; it does not answer it. Groq's own data-processing terms have not been
     reviewed here, so whether it meets the India-region requirement is still open, and it
     remains development and evaluation only.
     - Observed 2026-10-01: every response carried the header `x-groq-region: bom` (4 of 4
       probes, from a development machine). **A region header is evidence of what the provider
       said, not a residency guarantee.** It is recorded and printed exactly as sent and is never
       interpreted: no code or document maps a value to a place. It says nothing of where a
       request from other infrastructure would be served, or of what Groq commits to; that
       remains for the data-processing terms to settle.
     - **What every report and model call now records** (report format 3): the configured
       endpoint's host (`model.endpointHost`, e.g. `api.groq.com`), the upstream provider when
       the endpoint names one (`model.servedBy`), and every response header whose name
       contains "region", raw with its name (`model.regionHeaders`); per call, the same in
       `usage_events.model_calls`. Groq names no upstream provider, so its reports say "Served
       by: api.groq.com, the endpoint this request was sent to. It named no upstream
       provider." A region header prints as "The endpoint reported region header
       x-groq-region: bom. This records what the endpoint said; it is not a guarantee of where
       the request was processed.", and the line is omitted when the response carried none. A
       region value that is not printable ASCII or exceeds 200 characters is skipped, never
       altered.
     - Rate limits on this key, per its response headers: 8,000 tokens and 1,000 requests.
       Four eval runs spaced 65 s apart hit no limit.
     - `json_schema` ON against OFF, eval golden set, two runs each: every call costs exactly
       196 more input tokens with the schema (781/751/627 against 585/555/431 per case), the
       schema being sent with the prompt. Output tokens varied run to run in both modes. One
       case needed a retry in one ON run (1 of 6 case-runs); no OFF case did (0 of 6). With no
       schema the model returned valid JSON every time. Both modes: citation validity 1.0,
       hallucination rate 0, nothing rejected. Too small a sample to say the schema changes
       attempts; it does cost the 196 tokens.
   - An endpoint's refusal now carries what the endpoint said (an out-of-credit 402 says so),
     read narrowly: a bounded JSON error body only, the key and token-shaped strings
     redacted, and any message that repeats the prompt dropped (`packages/llm/src/endpoint-error.ts`).
     A refusal is still never retried.
2. **The facts never depend on a model.** Coverage, findings, relationships, sources and
   attribution are assembled from stored data. The model writes only the synthesis, which must
   be asked for.
3. **A synthesis that fails validation twice fails the whole report**, with its reason. A report
   without a synthesis can be requested instead.
4. **A model may claim only CORRELATED, INFERRED or HYPOTHESIS**, and every statement cites. Safety,
   trust and risk verdicts are rejected outright.
5. **The response cache is namespaced by tenant**, beyond the brief's prompt, model and version,
   so a cache hit cannot reveal another tenant's material.
6. **An unmetered model response is refused.**
7. **A report is a stored, write-once document, and renders only from what it stores.** Every PDF
   and export renders from it. As first committed this was only partly true: the glossary, every
   heading and notice, and the product name were read from code at download time. The follow-up
   below fixed that. The marking is captured at generation.
8. **Exports are of a report**, so every format carries what the report said: marking, strengths,
   citations, attribution.
9. **Body 12 pt; footnotes, tables, header and footer 10 pt.** The brief's minimum is read as
   applying to the body.
10. **Fonts are embedded whole, not subset.** pdf-lib's subsetting dropped glyphs from Noto Serif
    when rendered (seen on the review PNGs), so a PDF is about 0.8 to 0.9 MB.
11. **The CSV formula guard prefixes an apostrophe** to any cell starting with `=`, `+`, `-`, `@`, a
    tab or a carriage return. This includes negative numbers; the JSON export is exact.
12. **Claim-strength definitions** (`CLAIM_STRENGTH_DEFINITIONS` in core) were reviewed by you after
    commit 7de5145. CORRELATED and INFERRED now name the analysis model as the one drawing them.
    OBSERVED stays in the glossary although nothing produces it yet.

### Open questions and carry-forwards from Phase 5

- ~~**No live model has run.**~~ Resolved 2026-10-03: the checkpoint ran live against Groq
  (`openai/gpt-oss-120b`, development only) — see the follow-up below. The provider decision
  for production, and the residency question, remain open (decision 1 above).
- **What the guards cannot catch:**
  - injected steering that uses no instruction words, identifiers, certainty or verdicts (a
    paraphrased false conclusion);
  - payloads in languages other than English;
  - encoded payloads (base64).

  Framing and the citation requirement are the defence there.
- **Synthesis wording: what the first live review found** (report `1bece818`, 2026-10-03;
  the output was judged defensible). Two observations to track:
  - **A collector's stated caveat can be cut before the model ever sees it.** Statement 3 said
    September 2026 Common Crawl captures were "demonstrating that a web server is actively
    serving a page", without the collector's own limitation (`COMMONCRAWL_HISTORICAL_NOTE`:
    the index is a historical snapshot, published weeks after the crawl). The note WAS
    extracted as a claim and printed in the report — but the synthesis record takes each
    source's first `MAX_SYNTHESIS_CLAIMS_PER_SOURCE` (25) claims, and the note sat at
    position 36 of that source's 202, so the model never received it. Consider carrying a
    collector's caveat claims (derived notes) into the synthesis record ahead of the cap, so
    the model can honour them.
  - **"Demonstrating" and "indicating" sit outside the banned certainty list** (`confirmed /
    proven / verified / certain / definitive / …`). Accepted, not a defect: the strength
    labels and the synthesis notice carry the uncertainty, and the review judged the wording
    defensible. Recorded so the validator's line is a known characteristic, not a surprise.
- **Glyph coverage:** Latin, Greek and Cyrillic only. Devanagari and other scripts show as `?`,
  counted. India-region tenants will need more Noto faces.
- ~~**PDF rendering happens in the API request.**~~ Resolved 2026-10-03: rendered once in the
  worker and stored — see the follow-up below.
- **The handling marking's platform default is undecided** (`REPORT_HANDLING_MARKING` unset).
- **Not built:** embeddings into pgvector (ARCHITECTURE-DECISIONS §7) and the
  extraction/classification tasks. Their routing exists, but no feature calls them yet.
- **Report generation cannot be cancelled**, like runs.

### Phase 5 follow-up: reports render only from what they store

An evidence artefact must read the same whenever it is downloaded. As committed in 7de5145, the
PDF read the glossary from code at download time, so a later wording change would have altered
reports already generated. Checking for anything else read live found more:

- every heading, notice and label it prints, including the no-marking sentence, the coverage state
  labels, footnote phrasing, table headings, and the "not requested", "shortened", injection,
  attribution and rendering notes;
- the order of the glossary (`CLAIM_STRENGTHS`);
- the product name, read from configuration into the PDF's Creator and Producer;
- the PDF's creation and modification dates, set to the download time, so no two downloads were
  byte-identical;
- the CSV and Maltego exports' absence markers ("not set", "not recorded").

**Fixed.**

- All of that wording is now `REPORT_WORDING` in core (`report-wording.ts`). Each report stores a
  copy taken at generation (`ReportDocument.wording`), with the product name (`producedBy`).
- The renderers print only the stored copy. The PDF's dates are the report's generation time.
- `REPORT_FORMAT_VERSION` is now 2. No version-1 document exists outside the test databases,
  which each run recreates.
- The glossary text you approved: CORRELATED and INFERRED are "drawn by the analysis model";
  OBSERVED is kept.

**What still comes from code.** The layout (positions, sizes, page breaks), the fonts (vendored,
hash-checked) and the CSV and Maltego column headers (the exports' schema). A change to any of
these would change how an old report looks, never what it says. A byte-for-byte guarantee across
renderer changes would need the rendered PDF stored at generation; that is not built.

**Tests.**

- *Engine, on a real generated report stored in the database:* the report renders to identical
  bytes after the glossary in code is changed. A report generated after the change carries the new
  text, so the snapshot is real. Mutation-checked: pointing the renderer back at the code's
  glossary fails this test.
- *Integrations:* the same report renders to the same bytes on two downloads a second apart, and
  changing the code's glossary, headings and marking wording leaves a stored report's PDF
  unchanged.
- *Glossary text:* the stored glossary text is asserted verbatim.

### Phase 5 follow-up: test timeouts under parallel load

**Found.**

- Four tests timed out in different full runs:
  - the web test worker's start;
  - the new report-snapshot engine test;
  - the API's config-spawn test;
  - the export checker's own test, which takes about 2 s alone but hit its 5 s limit.
- A baseline run also failed two rate-limiter tests, which measure real-time intervals.
- All of them are startup, spawn or timer steps, not slow assertions.
- The cause was CPU oversubscription on the development laptop (i7-1165G7, 4 cores, 8 logical
  CPUs):
  - turbo ran up to 10 tasks at once (its default);
  - vitest started `availableParallelism() - 1` = 7 workers per package (read from vitest 5's
    source);
  - a full run reached a peak of 34 node processes, sampled every 2 s, with none running at idle.

**Changed.** Only concurrency; no timeout raised, no test moved or weakened.

- `turbo.json`: `"concurrency": "4"`.
- `@repo/config/vitest` exports `TEST_MAX_WORKERS`, default 2. A larger CI runner overrides it
  with the `TEST_MAX_WORKERS` environment variable, declared in turbo's `globalEnv`.
- Every package's vitest config uses `TEST_MAX_WORKERS`. `core`, `access` and `config` gained a
  vitest config for this.
- The engine report-snapshot test's 120 s budget, set in the previous follow-up, stays. That test
  does three 17-page renders and a generation through the queue, like the suite's other heavy
  steps, which already carry budgets of 60 to 90 s.

**Measured** (`pnpm turbo lint typecheck test --force`, wall time):

| | Wall time | Peak node processes | Result |
| --- | --- | --- | --- |
| Before (two baseline runs) | 157 s, 153 s | 34 | One red (two rate-limiter timing tests), one green: flaky |
| After (calibration run) | 151 s | 13 | Green |
| After (three consecutive runs) | 142 s, 148 s, 160 s | not sampled | Green, 46 of 46 each |

The suite takes the same time with a third of the processes: the extra parallelism had been
contention, not throughput. Separating the report and PDF tests (option 2) was not needed.

Per-package counts on the last run: core 20, access 55, config 133, db 230, integrations 116,
collectors 482, llm 115, osint-engine 96, api 109, web 4, worker 4 (1,360). The fabrication check
passed on 290 files; the export check on 139 symbols.

### Phase 5 follow-up: the live checkpoint, and what it broke (2026-10-03)

The checkpoint ran live for the first time: a real run of `example.com` through the running API
and worker (password + TOTP sign-in, tenant marking set, report with a live Groq synthesis). The
report generated — 615 claims, all cited; coverage accurate (crt.sh was genuinely down, HTTP 502,
dead-lettered after 5 attempts) — and then the PDF export took the whole API down. Three defects,
each now fixed with a regression test, plus the architectural change they forced:

1. **An unhandled connection error ended the process** (bulkhead violation, CLAUDE.md §5).
   pg-pool listens for a connection's errors only while it is idle in the pool; the export held
   its transaction past the server's 15 s idle-in-transaction timeout, the server ended the
   connection (SQLSTATE 25P03), and the 'error' event had no listener. Every pooled connection
   now carries a listener for its whole life (`packages/db/src/connection-errors.ts`), the work
   using it fails alone with `DatabaseConnectionLostError` (`DB_CONNECTION_LOST`, HTTP 503,
   retryable), and the pool serves the next request. Tests: db kills a checked-out connection;
   the API test terminates a request's backend mid-transaction and asserts that request fails
   503 while the same tenant and another are still served.
2. **The export rendered inside the request's transaction.** Handlers can now defer work until
   their transaction (audit row included) has committed (`afterCommit`, apps/api access layer);
   deferred work runs outside any transaction, is never run if the transaction failed, and is
   audited FAILED in its own transaction if it throws.
3. **Rendering a 615-claim report took ~150 s.** The renderer re-wrapped every footnote on the
   page for each line placed, re-shaping the text with fontkit every time, and the re-wrapping
   also re-counted undrawable characters (the rendering note printed hundreds of times the real
   number). Widths are now measured once per font/size/text and footnotes wrapped once.
   Measured on the 600-claim synthetic fixture (shaped like the live report):
   **573 s before, 5–7 s after**; pdf-lib measurements ~2,200 per claim before, ~6 after; output
   byte-identical to the old renderer on the existing fixtures. `pdf-performance.test.ts` pins
   both the measurement count (deterministic) and a generous wall-clock bound.
4. **The PDF is now rendered once, in the worker, and stored** (your decision: inherits the
   worker's timeouts, retries and dead-lettering; keeps slow work off the request path; makes
   every download byte-identical, closing the artefact-stability question).
   - `report_pdfs` (migrations 0016 + 0017): one row per generated report, PENDING →
     RENDERING → READY (content hash + size, written once, trigger-enforced like the report
     document) or FAILED (reason recorded). RLS forced, lifecycle columns only.
   - `ReportRenderer` on the new `report-renders` queue (own bulkhead,
     `REPORT_RENDER_CONCURRENCY`, default 1): render failures fail at once (the same document
     renders the same way), storage failures retry with backoff, a crashed last attempt is
     failed by the pool, never left RENDERING. The reports worker enqueues the render when a
     report succeeds; the PENDING row is created in the report's own success transaction.
   - The PDF is stored in the tenant's content store (content-addressed, shared with evidence;
     `CONTENT_STORE_DIR` now resolves relative paths from the repo root so API, worker and seed
     share one store, and the API requires it at startup).
   - `GET /api/v1/reports/:id/export/pdf` serves the stored file (re-hashed on read), answers
     **202 + Retry-After while PENDING/RENDERING** (and resumes a lost render idempotently —
     this also backfills reports generated before PDFs were stored), and **409
     REPORT_PDF_FAILED** with the reason if it could not be rendered. The report view carries
     `pdf: { status, byteLength, contentHash, error }`. JSON/CSV/Maltego still render in the
     request, after commit — they are milliseconds.

**The checkpoint, re-run live after the fixes** (tenant `cp5b-*`, report
`1bece818-df11-47d0-80ef-438ba2f31856`): run PARTIAL in 135 s (4 found, crt.sh dead-lettered);
synthesis GENERATED, attempts 1, provenance recorded (`api.groq.com`, no provider named,
`x-groq-region: bom` raw). PDF export: `202 (Retry-After 5)` at 58 ms → `200` at 3.0 s;
54 pages; marking on every page; coverage, provenance lines and evidence basis all present; no
unrenderable characters; second download byte-identical (`sha256:c63393ffdbce…`, 1,099,755
bytes, matching the recorded hash and size); `/health` stayed ≤ 19 ms throughout the render.
JSON/CSV/Maltego exported 200.

Full suite after the changes: `pnpm typecheck && pnpm lint && pnpm test --force`, 23 of 23
tasks, 1,415 tests (core 20, access 55, config 136, db 242, integrations 122, collectors 482,
llm 130, osint-engine 104, api 116, web 4, worker 4). Migrations 0016 and 0017 applied to the
dev database.

Carried forward: rendering is CPU-bound on the worker's event loop (concurrency 1 per worker by
default; a worker thread is the next step if render latency ever matters); stored PDFs are not
yet deleted with a tenant's other data (the content store's tenant namespace covers them when
deletion lands); the `cp5-`/`cp5b-` checkpoint tenants remain in the dev database by design
(append-only audit).

## Phase 6a record: the API surface the web application needs

No frontend work. Twenty-two operations added (contract 0.3.0), each declaring its permission,
running in the request's tenant transaction, validated and serialised by Zod and described in the
generated spec. Four decisions were taken with the owner before building (below).

### What was built

| Area | Routes | Permission |
| --- | --- | --- |
| Cases | `POST/GET /cases`, `GET/PATCH /cases/:id` (title, description, archive) | `case:write` / `case:read` |
| Pins | `POST /cases/:id/pins` (body: target `{type: evidence\|entity\|claim, id}`), `GET /cases/:id/pins`, `DELETE /cases/:id/pins/:pinId` | `case:write` / `case:read` |
| Entities | `GET /entities?caseId\|runId`, `GET /entities/:id` (claims, relationships, merged ids), `GET /entities/merge-candidates` | `evidence:read` |
| Merges | `GET/POST /entity-merges`, `POST /entity-merges/:id/undo` | `evidence:read` / `case:write` |
| Graph | `GET /graph?caseId\|runId&hops&maxNodes` | `evidence:read` |
| Timeline | `GET /timeline?caseId\|runId&sortBy` | `evidence:read` |
| Members | `GET /members`, `GET /members/invitations` (pending), `POST /members/invitations`, `PATCH/DELETE /members/:userId` | `member:read`, `member:read`, `invitation:create`, `member:update`, `member:delete` |
| Evidence | `GET /evidence/:id`, `GET /evidence/:id/payload` | `evidence:read` |
| Retention | `GET/PUT /settings/retention` | `tenant:read` / `organization:update` |
| Estimate | `POST /estimates` | `run:start` |

Code: `GraphStore` interface in `packages/core` (`graph.ts`, with `MAX_GRAPH_HOPS` 3 and
`MAX_GRAPH_NODES` 500); its Postgres adapter and the read models (`ExplorationRepository`) in
`packages/db`, exposed as `reads` on the tenant context (not in `Repositories`, so the
one-repository-per-table isolation tests keep their meaning). No Neo4j.

Schema: migration 0018 adds `tenants.retention_days` (nullable, CHECK 1 to 3650); 0019 grants the
application role UPDATE on that column only. Nothing else changed.

### Decisions taken with the owner

1. **A case is its pins.** There is no case-to-run link. A case's entities are its pinned entities
   plus those of pinned claims and of claims citing pinned evidence; its timeline is pinned
   evidence plus the evidence behind pinned claims and entities. Run-scoped reads exist too.
2. **Retention column added**, recorded only. The response says `enforced: false`; nothing deletes
   on expiry yet. The 1 to 3650 bound guards against nonsense and is not policy.
3. **Credit estimate: plan only, cost null.** No collector declares a cost and there is no credit
   ledger, so every `estimatedCredits` is null with a stated reason, never 0. Adding declared costs
   to registry entries is a separate decision.
4. **Merge candidates computed on read**, no table: same kind, same name ignoring case and
   padding. Always labelled INFERRED and `nameOnly`. Pairs with a merge on record (active or
   undone) are not suggested again.

### Judgement calls (flag if you disagree)

- **Permissions.** Entities, graph and timeline read under `evidence:read`; merges, pins and cases
  write under `case:write`. (Listing members first needed `member:update`; the follow-up below adds
  `member:read`.)
- **Member changes need a session.** Invite, change role and remove go through the identity
  provider with the caller's own session, so its checks (who may assign a role, the last owner)
  apply on top of ours. An API key gets 403 `SESSION_REQUIRED`.
- **A merge or undo is decided by a signed-in person.** As first built, a key could merge in its
  issuer's name; the follow-up below removes that: an API key now gets 403 `SESSION_REQUIRED`.
- **Pinning is idempotent** (200 with the existing pin; 201 when new); pinning to an archived case is
  409 `CASE_ARCHIVED`. Archiving is one-way (the repository has no unarchive).
- **Merged entities stay in lists and graphs as stored**, marked with `mergedIntoEntityId`. Folding
  them onto the survivor is the client's choice. An undone merge simply stops being marked.
- **Entity counts cover everything recorded about the entity**, not just the scope's share.
- **Claim values are typed `unknown` in the spec.** `z.json()` is recursive and its `$ref` did not
  resolve in the generated client (caught by `pnpm generate`). A stated null survives as null.
- `MERGE_RULE_VIOLATION` now maps to HTTP 409 (it was falling through to 500).

### Rules checked

- Nulls on the wire: the timeline test asserts `"observedAt":null` in the raw body and a null
  `collectedAt` stays null; a claim whose value is a stated null arrives as `null`; an unregistered
  collector's `sourceLabel` is null, not its id.
- The fabrication check caught `counts.get(id) ?? 0` for case pin counts. Fixed: the repository
  returns a measured entry for every case asked about, and a missing one now throws.
- Derived values stay distinguishable: every claim carries its strength, and DERIVED is the
  platform-computed label (Phase 3 `derived` rule). Graph `hop` and timeline totals are
  platform-computed read-model values, described as such in the spec.
- Isolation, release-blocking: `packages/db/test/exploration.test.ts` (scope reads, detail,
  timeline, graph incl. foreign seed ids, candidates, pins, retention) and the last `describe` of
  `apps/api/test/exploration-api.test.ts` (tenant B against every new endpoint: 404 or empty, and
  A's data verified unchanged afterwards).

### Gaps the UI will hit (need a decision before 6b; none stubbed)

- ~~No evidence read endpoint~~ and ~~no pending-invitations list~~: built in the follow-up below.
- ~~The 6a read endpoints do not apply the person-data gate~~: resolved, see "the person-data gate" below.
- **Case-level timeline of a whole run adoption** is not possible (decision 1); a `case_runs`
  link table is the follow-up if the UI wants it.
- Members list reads the tenant `users` table plus one role lookup per row (bounded by the page
  limit); a bulk role query in the auth store would remove the per-row lookups.

### Checkpoint output

`pnpm turbo lint typecheck test --force`: 46 of 46 tasks successful. Tests: core 20, access 55,
config 136, db 259 (was 242; +17), integrations 122, collectors 482, llm 130, osint-engine 104,
api 136 (was 116; +20), web 4, worker 4. Fabrication check clean. Migrations 0018 and 0019 applied
to the test database by the suite's setup.

### Phase 6a follow-up: permission, evidence, payload, invitations (2026-10-03)

1. **`member:read`** added to `packages/access` (module: none) and granted to every role, so a
   view-only role can see the team without any write permission. `GET /members` uses it; the
   catalogue test now pins who holds which member permission (`member:create/update/delete` and
   `invitation:*` stay admin and owner only). API keys inherit it through the issuer's role cap.
2. **`GET /evidence/:id`**: the record the provenance drawer shows. Collector id and version,
   source label and attribution (null when the collector is no longer registered), source URL,
   job and run id (null when recorded outside a job), content hash, `observedAt` and `collectedAt`
   separately with null preserved, `recordedAt`, the evidence's strength, and a measured
   `claimCount`. Claims citing it are split into `stated` and `derived` (strength DERIVED), with
   `claimsTruncated` when cut. The storage key (`payloadRef`) is not exposed.
   - Interpretation to confirm: evidence rows carry no `derived` block of their own; the stored
     payload is the raw upstream response. The platform-computed values are the DERIVED claims
     that cite the evidence, so `derived` is exactly those, apart from `stated`.
3. **`GET /evidence/:id/payload`**: the stored bytes, re-hashed on every read like the PDF export
   (read after commit, via `afterCommit`). A payload that no longer matches is refused with 500
   `EVIDENCE_PAYLOAD_INTEGRITY_FAILED` and none of its bytes are sent; a payload missing from the
   store is 404 `EVIDENCE_PAYLOAD_NOT_FOUND`. Served only as `application/octet-stream`, an
   attachment, `nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, `no-store`, with
   the hash in `x-content-hash`: a payload is untrusted third-party content and is never rendered
   in the app's origin. Audited as `evidence.payload`.
4. **Person-data gate on both**: evidence from a PERSON-discipline collector (read from the
   tenant's own registry row, as reports do) is 403 unless the plan includes it and vetting is
   approved, however old the evidence is. A missing registry row is gated as person data.
5. **`GET /members/invitations`** (pending, unexpired, newest first; `member:read`): small, so
   built. New `AuthStore.listPendingInvitations(organizationId, limit)`; the tenant comes from the
   principal. The enrolment token and its hash are never selected, so the list cannot reveal them.
   Invitee emails are visible to every role holding `member:read`, as member emails already are.
6. **API keys are barred from merges, undos and member changes.** One guard
   (`sessionPrincipalOf`, 403 `SESSION_REQUIRED`) is used by merge, undo, invite, change role and
   remove, so the record of who decided names the person who did. This corrects 6a as first built:
   merge and undo accepted a key and attributed the decision to the key's issuer. Tests issue a
   fully scoped key and assert 403 on each, that nothing was merged, and that a person's merge
   survives a key's undo attempt. A key can still read members, invitations and evidence.

### Phase 6a follow-up: the person-data gate on every read (2026-10-03)

**Owner's decision:** refuse the read and return a Locked response. Never hide rows or shrink
counts. A read may return its non-person part only if the response marks what was withheld and
why; otherwise it is refused whole. The rule is now in CLAUDE.md §9, together with the payload
serving rule (untyped attachment, `nosniff`, sandbox CSP, re-hash on every read).

- **One probe:** `ExplorationRepository.touchesPersonData`, in `packages/db`. It asks whether
  anything a read would show rests on evidence from a person-discipline collector, using the
  tenant's own registry row (no row counts as person). It covers:
  - the scope's evidence (a case's pins and what they stand on, or a run's evidence);
  - the evidence behind given claims;
  - the evidence behind every claim about the given entities, and about relationships touching
    them. Entity counts span all of an entity's claims, so a count can never be lowered silently.
- **One gate:** `requirePersonAccess` (`apps/api/src/http/person-gate.ts`). It does nothing for a
  tenant allowed person data, so the probe is never run for one. Otherwise, if the probe finds
  person data, it throws `LockedError`: 403, code `MODULE_NOT_IN_PLAN` or `VETTING_NOT_APPROVED`,
  and a `locked` block on the problem with `module`, `moduleSummary`, `withheld`, `reason`,
  `plan`, `vettingStatus` and `nextStep`. The detail says nothing was returned. `LockedSchema` is
  part of `ProblemSchema`, so the generated client types it.
- **Applied to:**
  - entity list (scope plus the page's entities);
  - entity detail (the entity plus the entities its relationships name);
  - graph (scope plus every returned node);
  - timeline (the whole scope, since its totals span it);
  - merge candidates (scope plus both sides of every pair);
  - case pins: the list probes the whole case; pinning probes the target before anything is
    written.
- **Reused:** the evidence routes now use the same gate, and the report gate keeps its codes but
  throws the same Locked refusal. Partial returns were not used anywhere: every gated read
  refuses whole.
- **Tests, release-blocking:**
  - `apps/api/test/person-gate.test.ts` walks no plan, then vetting pending, approved and
    suspended, across 14 calls (every gated endpoint, including mixed scopes and an entity with
    only some person claims). Locked states assert the 403, the code, the `locked` fields, that no
    result shape is present and that no person value leaks. Approved returns the whole result.
    Refused pin attempts write nothing.
  - Clean reads (7 calls) are byte-identical in every state, so the gate never over-refuses.
  - Neutering the gate makes all 7 tests fail (checked, then restored).
  - `packages/db/test/exploration.test.ts` covers the probe through each route (evidence, claim,
    both ends of a relationship, case scope) and confirms another tenant probing these ids gets
    `false`.
- **Not gated (no claim or evidence content):** the case list and case read (title and a measured
  pin count), entity merges (ids and the analyst's reason) and estimates. The Phase 4 run read
  (job outcomes, evidence ids) predates this rule and was not reviewed here.

**Checkpoint** (`pnpm turbo lint typecheck test --force`, 46 of 46 tasks, fabrication check clean):
core 20, access 56, config 136, db 260, integrations 122, collectors 482, llm 130, osint-engine 104,
api 153, web 4, worker 4 (1,471 tests). Migrations 0018 and 0019 are applied to the test database
by the suite, and to the dev database on 2026-10-03 (`pnpm migrate` as `app_owner`: 18 applied
before, 20 after; the dev and test migration lists are identical by timestamp and hash).

### Phase 6a follow-up: the run read, the progress stream, and one gate (2026-10-03)

**The review** (owner asked for it before any change). The run read (`GET /runs/:id`) and its
progress stream (`GET /runs/:id/events`) showed, for every job of a person collector, its outcome
(FOUND or NOT_FOUND), the NOT_FOUND detail, the last error, attempts, timestamps and the
evidence ids. The ids are UUIDv7, so each also carries when the evidence was recorded. One person
collector is registered today (`contact.phone`, local structural analysis), so the concrete
exposure was small, but the inconsistency was structural:
- the same run's report, evidence and timeline were Locked while its run read was not;
- the stream checked access once, at connect, then read for up to an hour;
- the report gate was still a local copy, contradicting the CLAUDE.md rule written the turn before.

**Owner's decisions:** gate the run read with the shared helper; refuse it whole rather than hide
person jobs; a missing registry row counts as person (fail closed); leave ungated the run list
(status comes from job statuses: FOUND and NOT_FOUND are both SUCCEEDED, so it shows collector
health, not findings), run start (no jobs exist yet), replay (returns the run id only; the worker
re-checks admission) and usage (aggregates). The plan's `input` is the analyst's own target, not
collected data.

**Built:**
1. **Job-based probe** (`packages/db`): `PersonProbe.runJobs`, true when any job of the run is a
   person collector's, whatever its outcome; a job with no registry row counts as person.
   - Judgement call, flagged: a run scope (`scope: { runId }`) now covers the run's jobs too.
     Covering evidence alone, entities, graph, timeline and merge candidates for a run would be
     refused when a person collector found something and answered (empty) when it found nothing,
     so the refusal would tell a locked tenant what the collector found. Case scopes are
     unchanged.
2. **Run read and stream.** `GET /runs/:id` refuses whole (Locked). The stream is checked at
   connect, as an ordinary 403 with no stream. It is then re-checked in the same transaction as
   every progress read, so the re-check interval is exactly `RUN_EVENTS_POLL_MS` (default
   1,000 ms). On a refusal it sends a `locked` event and closes. The event carries `code`, the
   Locked block, `recheckIntervalMs`, `checkedAt` and a detail saying the close is a policy
   decision, not a dropped connection; it is validated by Zod on the way out.
   - Judgement call, flagged: the interval is the poll interval, not a separate setting. A check
     on every read is the tightest possible and costs one primary-key read; the probe runs only
     for a tenant without person access. A separate, longer setting would only widen the window.
3. **One gate.** The report gate's local copy is gone; report create, list, read and export call
   `requirePersonAccess` with `runJobs`, with the same codes as before. `personLockFor` is the
   gate's non-throwing form, for code holding a transaction but no request (the stream).
4. **Guard** (`packages/config/scripts/person-gate-guard.ts` and `.test.ts`, release-blocking).
   It scans every workspace, as the fabrication check does, for the gate's pieces outside their
   homes:
   - a module or discipline access decision;
   - the discipline-to-module lookup;
   - a discipline compared with the person discipline, in code, SQL or a query builder;
   - the person module compared by name.

   Homes: the shared gate, `packages/access/src/`, the collection runtime's dispatch admission,
   and the probe. Run against the committed `reports.ts`, it flags both pieces of the old copy
   (lines 323 and 326). It also asserts each home exists and that the gate and probe are where it
   says. A grep cannot catch every disguise (a switch on a discipline reads like a switch on an
   entity kind); the lifecycle tests pin the behaviour.

**Tests:**
- `person-gate.test.ts`: the four-state lifecycle now covers the run read (a person run, and a
  run whose only person job was NOT_FOUND and recorded no evidence), the stream refused at
  connect (settled and unsettled runs), reports of both, and run-scoped entities, timeline, graph
  and candidates of the NOT_FOUND run.
- Clean run reads and a clean run's reports stay byte-identical in every state, including the
  mixed run whose entity has person claims from another run: its own jobs are technical.
- New, release-blocking: a stream opened while approved closes with `locked` (code,
  `recheckIntervalMs: 100`, Locked block, policy detail) when vetting is suspended mid-run, and
  never sends `end`.
- `packages/db/test/exploration.test.ts`: the job route (NOT_FOUND only; `runJobs` and run scope;
  a clean run; another tenant gets `false`).
- Each protection was checked by breaking it:
  - without the run-read gate, 6 tests fail;
  - without the stream re-check, the mid-run test fails (no close within 10 s);
  - with a run scope covering evidence only, 6 tests fail.

**Noted, not changed** (resolved in the next follow-up): the stream re-checks person access on every
read, but not membership or permissions. A member removed, or a role lowered, while a stream is open keeps receiving that
run's progress until it settles or the stream reaches its one-hour limit. The same re-check point
could check both; that needs a decision.

**Checkpoint** (`pnpm turbo lint typecheck test --force`, 46 of 46 tasks, fabrication check clean):
core 20, access 56, config 161, db 261, integrations 122, collectors 482, llm 130, osint-engine 104,
api 154, web 4, worker 4 (1,498 tests).

### Phase 6a follow-up: the stream re-checks the reader's whole access (2026-10-03)

**Owner's decision:** extend the stream's re-check to membership and permissions, on the same read
as the person-data check. Close with the same `locked` event, its `reason` telling the causes apart;
test each cause. (Both earlier judgement calls were confirmed: run scopes cover jobs; the re-check
interval is the poll interval.)

**Built:**
- **One access decision** (`accessDenial`, `apps/api/src/http/access.ts`). The checks every
  request makes after authentication (profile active, permission held, module allowed) moved out
  of the access layer into one function. Codes and messages are unchanged. The access layer and
  the stream both call it, so they cannot drift.
- **The re-check** (`apps/api/src/http/recheck.ts`). On every read the stream re-derives the
  principal's standing from what it recorded, not from the request:
  - **session:** the session still exists and has not expired; still a member; role → permissions;
    profile active;
  - **API key:** still usable (not revoked or expired); its issuer still a member; scope capped by
    the issuer's current role;
  - then `accessDenial` for `run:read`, then the person-data gate.

  Rate limits are not consumed.
- **Identity store first.** The identity half is one new read, `AuthStore.findSessionStanding`
  (session live plus role), or `findMemberRole` for a key's issuer. It runs before the tenant
  transaction opens: the identity store is a separate database role, and a slow one must never
  hold a tenant connection.
  - So the cost per read is one indexed identity lookup more, not literally unchanged.
- **The `locked` event** gains `reason`, the first failing check in this order:
  1. `CREDENTIAL_REVOKED`
  2. `MEMBERSHIP_REVOKED`
  3. `PERMISSION_LOST`
  4. `MODULE_NOT_IN_PLAN`
  5. `VETTING_NOT_APPROVED`

  `code` is what a fresh request now gets, and the tests assert they match: `NOT_A_MEMBER`,
  `MEMBER_INACTIVE`, `UNAUTHENTICATED`, `API_KEY_INVALID`, `PERMISSION_DENIED`, or the plan and
  vetting codes. The Locked block is present only when the person-data gate refused (null
  otherwise). Validated by Zod on the way out.
- **Judgement call, flagged:** `CREDENTIAL_REVOKED` is a fifth reason beyond the three causes
  asked for. A signed-out session or a revoked API key holding a stream is the same class of
  exposure as a removed member.
- **Not re-checked:** the session's active tenant. Switching tenants in another tab does not end
  access to this tenant: the reader is still a member.

**Reachability, stated plainly:** every role (viewer included) holds `run:read`, and every plan
includes the technical module. So no role change can remove this stream's permission today, and the
module check for `run:read` cannot fail. Lowering a role keeps the stream open because the lowered
role may still read runs. The re-check still derives permissions from the current role on every
read, so a future catalogue that removes `run:read` from a role closes the stream with
`PERMISSION_LOST`.

**Tests** (`apps/api/test/stream-access.test.ts`, release-blocking):
- A member removed mid-stream: `MEMBERSHIP_REVOKED` / `NOT_A_MEMBER`.
- A session signed out mid-stream: `CREDENTIAL_REVOKED` / `UNAUTHENTICATED`.
- An API key revoked mid-stream: `CREDENTIAL_REVOKED` / `API_KEY_INVALID`.
- An API key's issuer removed mid-stream: `MEMBERSHIP_REVOKED` / `API_KEY_INVALID`.
- Each of those is checked against a fresh request's code.
- A role lowered mid-stream keeps the stream exactly while the new role grants `run:read`; the
  expectation is computed from the catalogue, so it tracks a change. Removing the member then
  closes it.
- `PERMISSION_LOST` through the same function the stream calls, for a session and for an API key
  whose issuer is lowered (`run:start` lost, `run:read` kept), and a fresh request agrees.
- Plan and vetting (`person-gate.test.ts`): `VETTING_NOT_APPROVED` (vetting suspended mid-run) and
  `MODULE_NOT_IN_PLAN` (plan downgraded mid-run), both with the Locked block.
- Checked by breaking it:
  - with the re-check neutered, all 7 stream-access tests fail;
  - with the session-liveness check alone removed, exactly the sign-out test fails.

**Caught on the way:** the release-blocking route-access guard ("authorisation is by permission,
never by role name") flagged the first draft's null check on a membership's role. It was a
membership check, not a role-name comparison, but the guard was not weakened: the identity store now
returns `membership: { roles } | null`, so nothing compares a role field.

**Checkpoint** (`pnpm turbo lint typecheck test --force`, 46 of 46 tasks, fabrication check clean):
core 20, access 56, config 161, db 261, integrations 122, collectors 482, llm 130, osint-engine 104,
api 162, web 4, worker 4 (1,506 tests).

**For 6b:** ~~server-sent event payloads are described in text only~~: done as the 6b
prerequisite (below).

## Phase 6b record: the core web flow

Four steps, each stopped for the owner to look at: (1) auth, (2) search dashboard, (3) run view,
(4) results. Not in 6b: graph, timeline, map, media tabs, admin screens.

### Prerequisite: the progress stream's events as schemas (done)

- **Named events.** The six events (`run`, `job`, `end`, `locked`, `timeout`, `error`) are Zod
  schemas with ids. They are emitted as named components (`RunStreamEvent`, a union of
  `RunStream…Event`) and are the stream's `text/event-stream` response schema.
- **One `Locked` schema** is shared by every 403's `locked` block and the stream's `locked`
  event.
- **Validated on the way out.** Every event is checked against its schema before it is written.
  The shared test parser (`sseEvents`) checks every event every stream test receives.
- **No unused twins.** The Zod transform also emits an unused `…Input` twin of each named schema;
  `withoutUnusedSchemas` drops component schemas nothing references.
- **Tests:** a spec test checks the reference, the six members and that every component is
  referenced. `apps/web/src/stream-types.test.ts` asserts the generated types at type level, so
  the web build fails if an event stops being documented (checked by breaking it).

### Step 1: auth (done; looked at by the owner 2026-10-05)

**Decisions taken with the owner (2026-10-03):**
1. **Product session routes** instead of exposing the identity provider. Its own sign-in and
   verify responses carry the session token in the JSON body (proved by a control test), so the
   web app uses new documented routes that never return one.
2. **The whole approved stack, installed now:**
   - in `apps/web`: tailwindcss 4 with `@tailwindcss/vite`, `@tanstack/react-router`,
     `@tanstack/react-query`, zustand;
   - shadcn/ui's pieces in `packages/ui`: radix-ui, class-variance-authority, clsx,
     tailwind-merge.
3. **Extras approved:** lucide-react (installed, not used yet); IBM Plex Sans and Mono,
   self-hosted from `@fontsource`; uqr for the enrolment QR code.
4. **Existing accounts only.** With no sign-up screen, a new invitee cannot get an account in the
   UI. Step 1 serves operator-provisioned owners (enrolling with their provisioning token) and
   anyone who already has an account.

**API** (`apps/api/src/routes/session.ts`):
- **The routes:**
  - `GET /api/v1/session`: `SessionState`, one of SIGNED_OUT, MFA_ENROLMENT_REQUIRED or SIGNED_IN
    (with tenants and the active one);
  - `POST /api/v1/session/sign-in`: returns `next`, either MFA_CHALLENGE or MFA_ENROLMENT;
  - `POST /api/v1/session/mfa/verify`: TOTP or a backup code;
  - `POST /api/v1/session/mfa/enrolment`: password plus the link's token; returns the otpauth URI,
    the secret and the backup codes;
  - `POST /api/v1/session/mfa/enrolment/confirm`;
  - `POST /api/v1/session/tenant`;
  - `POST /api/v1/session/sign-out`.
- **How they work:** each calls the identity provider server-side through one helper,
  `callIdentityProvider`, which the old `/api/auth/*` pass-through now uses too. The provider's
  rules all apply and it still sets the cookies; its answers are parsed with Zod at the boundary.
- **Checks:** POSTs require a trusted Origin. The provider's 429 becomes `RATE_LIMITED`, with
  `Retry-After`.
- **Tests:** `test/session.test.ts` (12, release-blocking) covers every route and refusal, a
  backup code working once, an untrusted origin, and a tenant the person does not belong to. It
  also checks that no session-route body contains the session token, with a control showing the
  provider's own body does.

**Design system** (additions to `docs/DESIGN-SYSTEM.md`, each told to the owner):
- `target-min` (44px), `focus-ring-width` and `focus-ring-offset` (2px each),
  `layout-form-width` (400px), `qr-size` (176px);
- `qr-module` and `qr-ground`, fixed dark-on-light in both themes so the code always scans.

**UI foundation** (`packages/ui`, built with tsc like `packages/core`):
- **Tokens.** `tokens.css` is the only file with raw values. Every token is `--ds-` plus its
  design-system name; the prefix avoids collisions with Tailwind's own variables.
- **Theme.** `theme.css` resets every Tailwind default scale (colour, spacing, radius, shadow,
  font, type, container), so only token utilities exist. Checked with a real build: `p-7`,
  `bg-red-500`, `rounded-xl`, `text-sm`, `shadow-lg` and `font-serif` generate nothing even when
  used.
- **Components:** Button, Field and Input, Notice, Panel and Skeleton, plus `cn`
  (tailwind-merge told the token names).
- **Guard** (`packages/config/scripts/design-system-guard.test.ts`, release-blocking):
  - `tokens.css` equals the document value for value: 88 tokens, both themes, nothing extra. It
    caught the slip that motivated it: a Cyrillic letter typed into a hex value, found and fixed
    before the guard existed, and checked by breaking a value afterwards.
  - Neither `apps/web/src` nor `packages/ui/src` contains a raw colour, length, font stack,
    Tailwind arbitrary value or inline style.

**Web** (`apps/web/src`):
- **Routing.** TanStack Router, code-based. Each route's guard reads the session fresh and sends
  it to the screen its state belongs on. Pending state is a skeleton; failure is a plain reason
  with a retry, never "signed out".
- **Screens:** sign-in; MFA challenge, with a backup-code option and an expired-challenge link;
  enrolment; tenant choice (a single tenant is chosen automatically); a minimal signed-in shell
  (tenant, email, switch, sign out, API health).
- **Enrolment link.** The token travels in the link's fragment (`/enrol#token=…`), which never
  reaches a server or a log. It is kept in sessionStorage for the tab only, and removed once
  enrolment succeeds.
- **Messages.** Every call has a 15 s timeout, and failures map to plain messages with the code
  shown small.
- **Tests:** `auth-flow.test.tsx` (10) runs the real router and screens over a fetch stub.

**Smoke test against the real stack** (dev API, Vite, dev database), through the Vite proxy:
- signed out, then sign-in reports MFA_ENROLMENT;
- the session reads MFA_ENROLMENT_REQUIRED;
- a wrong token is refused with `MFA_ENROLMENT_TOKEN_INVALID`;
- the link's token returns the otpauth URI, the secret and 10 backup codes;
- the session token stays in the cookie.

It stopped before confirming, so nothing was enrolled. It left one provisioned tenant in the dev
database, `[6b smoke 6982a3]` (owner `smoke-6b-6982a3@example.com`), which is unused and can be
ignored. Its one-time token was printed once in the session transcript by a redaction slip; it is
a local dev account.

**The identity provider's pass-through, restricted** (owner's request, 2026-10-03). The
`/api/auth/*` wildcard is gone. Two explicit routes remain, listed with their reasons in
`OPEN_IDENTITY_ENDPOINTS` (`apps/api/src/routes/auth.ts`):
- **`POST /api/auth/sign-up/email`:** how an invited person creates an account.
  - No documented route can replace it: no sign-up ships before email sending, and CLAUDE.md §1
    pins its decoy behaviour by this path.
  - The provider never signs the new account in (`autoSignIn` off), so its body's token is always
    null and no session cookie is set.
- **`POST /api/auth/organization/accept-invitation`:** how an invited person joins a tenant. There
  is no documented route yet. Its body is the invitation and the membership, never a token.
- **Everything else is closed over HTTP,** about 60 endpoints, including every one whose body
  carries a session token: sign-in, the MFA verifications, get-session, list-sessions,
  change-password.
- **The provider's own guards stay in force** for the API's in-process calls: the MFA and
  enrolment-token hooks, the organisation allowlist, no tenant creation.

**Closed without a documented replacement** (no UI uses them; each needs a route when its screen
is built): cancelling and rejecting an invitation, viewing one, listing a person's invitations,
leaving a tenant, renaming a tenant, change-password, and the session list and revocation.

**Tests:**
- `test/identity-surface.test.ts` (5, release-blocking) takes every endpoint the provider
  defines, read from the provider itself so a library upgrade's additions are covered. Each is
  tried over HTTP, signed in and signed out:
  - only the two listed routes answer;
  - no body carries the session token;
  - no session is created, checked against the database's session count;
  - sign-in and the second factor are refused even with valid credentials;
  - the two open routes work without handing out a token;
  - a control shows the provider's own `get-session` body does carry it.
- Checked by breaking it: restoring the old wildcard fails two of its tests.
- The test harness and nine suites now sign in, enrol, choose tenants and manage members through
  the documented routes. Where a suite pinned one of the provider's own guards (MFA can never be
  switched off, the enrolment token on every step, the organisation allowlist, no tenant
  creation), it now checks two things: the endpoint is closed over HTTP, and the provider still
  refuses the call in-process. No assertion was dropped.

**Checkpoint** (`pnpm turbo lint typecheck test --force`, 50 of 50 tasks, fabrication check
clean): core 20, access 56, config 180, db 261, integrations 122, collectors 482, llm 130,
osint-engine 104, api 180, ui 5, web 17, worker 4 (1,561 tests).

### Fix after step 1: the page was blank in a browser (2026-10-05, commit 6c99779)

The screens imported `PRODUCT_NAME` from `@repo/config`'s main entry, which also carries Node-only
helpers (`node:path`, `node:fs`). Every test passed under Node; in a browser the page was blank.
`@repo/config/product` is now the browser's entry point (pinned by check-exports), and
`apps/web/scripts/browser-bundle.test.ts` builds the app as the browser gets it and fails on any
import of a Node built-in (checked by restoring the old import: it fails naming both).

Also found while running it locally: `.env` copied from `.env.example` leaves `AUTH_SECRET` and
`VAULT_MASTER_KEY` empty, so the API refuses to start (`CONFIG_INVALID`), and Docker Desktop must
be running for Postgres and Redis. Both are setup, not defects.

### Step 2: search dashboard (done; looked at by the owner 2026-10-05)

**What it does.** One input on the signed-in home screen. "Check target" calls
`POST /api/v1/estimates` and shows, in panels:
- **Target:** the normalised input in mono; the detected type, or a choice between detection's
  answer and its alternates ("Treat it as", the detected one marked). Choosing another type
  plans again with `targetType`. A candidate type the input is not valid for shows its reason.
- **Sources that would run:** label, the type each runs as, its key needs as stated by the
  registry ("Needs no key", "Uses a key if your organisation has set one; runs without it",
  "Needs a key. Without one it will not run"), and its cost.
- **Sources that would not run:** a §3 status chip with its word, the API's message and the
  reason code. Sources that do not take this kind of target at all are counted apart in a
  collapsed list, not mixed in with refusals.
- **Estimated cost of this run:** while no collector declares a cost (every estimate today), an
  em dash with the API's reason in its tooltip and accessible name, and the reason in plain text
  beside it. A cost the API does give shows as a number ("0 credits" is a measured zero).
- **Start run:** `POST /api/v1/investigations`, then `POST /api/v1/investigations/{id}/runs`
  with the chosen type. The queued run's status and id are shown; live progress is step 3.

**States.** Empty (before a check: what checking does, that nothing runs until started);
loading (skeletons in the panels' shape); stale (the text changed after the check: a notice, and
Start is disabled until checked again); failed (the reason and code; for a failed start after
the investigation was opened, a retry starts the run in it rather than opening another); no
source can run (Start disabled, with why); Locked (a 403 carrying a `locked` block, rendered from
the API's own wording, any screen).

**Components.** `packages/ui`: `Unmeasured` (the em dash, Radix Tooltip; a real button so the
reason is reachable by keyboard) and `StatusChip` (the seven §3 statuses, always as words).
`apps/web`: `LockedNotice` (ProblemNotice renders it for any refusal carrying `locked`), and
`src/search/plan.ts` for the mapping of exclusion reasons to §3 statuses.

**Judgement calls (flagged to the owner):**
- The investigation is titled with its target. There is one input, and the API requires a
  title. Renaming is a later screen.
- Exclusion reason to status: `LICENCE_BLOCKED`, `UNVERIFIED_SOURCE_NOT_ALLOWED` and
  `NOT_IMPLEMENTED` are Held; `MODULE_NOT_IN_PLAN`, `VETTING_NOT_APPROVED` and
  `SCOPE_AUTHORISATION_REQUIRED` are Skipped; `TARGET_TYPE_NOT_ACCEPTED` has no status (listed
  apart); anything else is an admission failure, shown as Failed with the API's message.
- No Locked panel for person collectors the plan leaves out: the estimate carries no `locked`
  block, and the page does not write its own next-step copy. They show as Skipped with the API's
  reason. Adding a `locked` block to the estimate response would be an API change; not made.
- The would-run rows have no status chip: nothing has run, and "Needs key" (§3) means no
  credential is configured, which the estimate does not know.

**Tests.** `src/search.test.tsx` (8): the empty state, the full plan (types, key needs, chips as
words, no number for an unestimated cost, the total's reason in sight), a measured zero, choosing
an alternate type through to the run's request, a failed start retried without a second
investigation, the stale plan, no runnable source, a plain refusal and the Locked state.
`packages/ui` (2 more): the em dash's name and tooltip, every status as words.

**Checkpoint** (`pnpm turbo lint typecheck test`, 50 of 50 tasks, fabrication check clean): core
20, access 56, config 180, db 261, integrations 122, collectors 482, llm 130, osint-engine 104,
api 180, ui 7, web 26, worker 4 (1,572 tests).

### Before step 3: runs could not progress locally, and a cost message promised too much (2026-10-05)

The owner asked why the site felt half-baked after step 2. Two real causes, both fixed:
- **No worker under `pnpm dev`.** `apps/worker` had no `dev` script, so nothing consumed the
  queues and every run stayed QUEUED. It now has one (`node --watch`, like the API), and the
  README no longer claims the worker exits NOT_IMPLEMENTED (`startWorker` has been complete since
  Phase 4). Checked live: the owner's queued run moved to RUNNING, and dns, rdap and commoncrawl
  succeeded. crt.sh answered UNAVAILABLE and is retrying with backoff.
- **The estimate's cost reasons.** The run total reused the per-collector reason ("for this
  collector"), and both said "the cost will be shown after the run", which nothing does: no run
  records a cost. The total now has its own reason, and neither promises a later cost.
  `test/exploration-api.test.ts` pins both texts.

### Step 3: run view (done; awaiting the owner's look)

**What it does.** "Start run" on the dashboard goes straight to `/runs/$runId`, which follows
`GET /api/v1/runs/{id}/events` through the generated client (`parseAs: "stream"`) and shows:
- **Run:** the target, the run status in words, queued, started and finished times (in mono,
  with the exact instant in `dateTime`), and "every source has finished; results still being
  merged" while finished but not settled.
- **Sources: n of m finished:** each job with its §3 chip and, in words, what it found ("Found 2
  evidence records", "Found nothing: …") or why not (the error and its code, the retry state:
  next attempt at, or gave up after n attempts and kept in the dead-letter queue). Found nothing
  and failed are different words, chips and reasons.
- **Not run:** the plan's exclusions with chips. The plan records collector ids only, so ids
  are shown in mono.
- **Cost:** estimated and actual, each an em dash with its reason. A run records neither (see
  the judgement calls below).

**The connection.** Connecting is bounded by the API timeout. Reading is bounded by a stall
timeout of 45 s, three missed keep-alives. Every event is checked at the boundary: its name,
JSON data, and the fields the page reads. Anything else is `STREAM_PROTOCOL`, never shown as
progress. Outcomes:
- `end`: the final state; the stream is closed, and no reconnect is offered.
- `timeout`: reconnects at once.
- `error`, an early close, a stall or malformed data: "Live updates stopped" with the reason
  and code, what is shown is marked "as of" the last update, and Reconnect is offered.
- `locked`: `LockedNotice` when person data is the reason; otherwise the API's detail and code.
  The stream closes and no reconnect is offered.
- A refused connection (403 Locked, 404) shows as any refusal does. An `end` with no status
  says the run no longer exists.

**Design system (added to §3 first):** **Queued** (planned, waiting for a worker or its next
attempt) and **Cancelled**, both on `claim-hypothesis-*`; `StatusChip` has both. No new tokens.

**Status mapping** (`src/run/progress.ts`, `jobStatus`, read the way the run report's
`coverageFromJob` reads a job): SUCCEEDED → Ran; FAILED → Needs key, Skipped (REFUSED) or Failed
by outcome; DEAD_LETTERED → Failed; CANCELLED, RUNNING, QUEUED as named.

**Other changes.** `AppShell` holds the signed-in header and footer, now shared by home and run;
the product name links home. The dashboard's "Run started" notice is gone: starting navigates.

**Judgement calls (flagged to the owner):**
- **Cost shown twice (§9) is two em dashes.** No run records its estimate or what it cost.
  Metering counts upstream requests per tenant per day and month (`/api/v1/usage`), not per
  run. A real actual cost needs per-run metering in `packages/db` and the engine, a backend
  change not made here.
- **Stream data checks are partial.** The web app has no runtime schema for the API's types,
  so it checks the fields it reads (Zod) and relies on the API validating every event on send.
- **Not-run rows show collector ids,** because the run's plan records no labels.

**Tests.** `src/run-view.test.tsx` (8): progress event by event (every chip, found versus found
nothing versus failed, retry and dead-letter, the plan's exclusions, the settled run with no
reconnect), the costs, reconnecting after `timeout`, a failed stream kept as of its last update
and reconnected, an early close and malformed data, both kinds of `locked`, a refused connection,
a run that no longer exists. `src/run/progress.test.ts` (6): the parser across split chunks,
CRLF, comments and multi-line data; boundary checks; the status mapping; job order.
`search.test.tsx` now expects navigation to the run. Checked by breaking the code: treating an
early close as finished, and showing "0 credits" in place of the em dash, each fail their test.

**Checkpoint** (`pnpm turbo lint typecheck test`, 50 of 50 tasks, fabrication check clean): core
20, access 56, config 180, db 261, integrations 122, collectors 482, llm 130, osint-engine 104,
api 180, ui 7, web 40, worker 4 (1,586 tests).

### Realignment with the screen designs (2026-10-05)

**What happened.** The owner had designed 15 screens in claude.ai (canvas of 2026-10-03), but
only the design system's tokens reached the repo. Steps 1 to 3 were therefore laid out from the
written rules alone, and look nothing like the designs: no side navigation, no hero search, no
two-column run view. The owner asked why. Claude Code never had the designs and never asked
whether screen designs existed.

**R0 (done).** The designs are now in the repo: `docs/design/README.md` and
`docs/design/mockups/`.
- **Contents:** 15 sources, screenshots, the canvas index and the tokens.
- **Token check:** the tokens equal DESIGN-SYSTEM.md exactly.
- **The README sets the rules:**
  - Layout and wording come from the mockup; values come from the tokens.
  - Data comes only from the API.
  - Unbuilt features are hidden.
  - False copy is corrected, with a list of every correction.
  - A screen-by-screen audit against the API.
- **Linked from:** BUILD-PHASES.md Phase 6 and DESIGN-SYSTEM.md.

**Owner's decisions:**
- Screens plus a small API exposure first, then a side-by-side review.
- Unbuilt features hidden until built.
- False copy corrected in the app only.

**R1 to R5 (done, awaiting the owner's side-by-side review):**
- **R5, API:** `GET /api/v1/collectors` (`apps/api/src/routes/collectors.ts`, permission
  `run:read`).
  - **What it returns:** each registry entry's label, discipline, mode, target types, claim
    strength, credential needs, and availability with its reason. It also says whether this
    deployment runs UNVERIFIED sources (`unverifiedSourcesAllowed`, the value the planner is
    built with).
  - **What it leaves out:** no live health, and no tenant credentials.
  - **Run views unchanged:** the web app labels jobs and exclusions from this list. That
    replaces the planned additions to the run view's fields, so the run and stream schemas
    did not change.
  - **Tests:** `test/collectors.test.ts`.
- **R1, app shell:** side navigation (Search only: nothing else exists yet), the
  organisation's name, and its vetting status in words from `/me` ("Verified tenant" only when
  APPROVED). An account menu holds the person, Switch organisation, the light/dark toggle
  (stored per device, light by default), Sign out and API health. The footer is gone.
- **R2, sign-in, challenge and enrolment:** the designs' layout and wording, with corrections.
  - **Lost device:** the line points to the backup codes; no one can reset a second factor.
  - **Link status:** "Enrolment link received", never "verified".
  - **Step order:** the enrolment steps are reordered so the backup codes are saved before
    "Confirm and finish", which leaves the page.
  - **Download codes:** saves the codes as a text file on the device.
- **R3, dashboard:** "What are you investigating?", the search bar, and the target types some
  source here can take. Investigate shows the estimate as before.
  - **Recent cases:** the newest open cases by creation, with their pins.
  - **Collector health:** each collector as Ready or Held, with why.
- **R4, run view:** two columns.
  - **Header:** target, detected type and real alternates, the run's status chip.
  - **Summary:** settled of total, elapsed, and status counts as chips.
  - **Every source in one list:** jobs, then the plan's exclusions labelled from the collector
    list, each with its discipline, evidence count or "found nothing", duration, attempts, retry
    or dead-letter state. Failed rows are tinted.
  - **Arriving now:** evidence records, found and found-nothing counts, and an em dash for what
    each source that did not complete would have found.
  - **Cost:** two em dashes with reasons.
  - **Settings:** passive only, from the registry's modes; person modules from `/me`; the model
    named on the report.
  - **The design's honesty note.**
- **Design system:**
  - **New sizes:** `layout-page-width` 880px, `layout-nav-width` 216px, `layout-search-width`
    780px; `layout-form-width` is now 500px.
  - **New status:** Ready (`claim-observed-*`).
  - **Colour discipline:** the vetting chip uses the accent, not green, because colour means
    only claim strength, collector status or entity class.
  - **UI package:** `Popover` added; `StatusChip` takes a count ("6 ran").
- **Tests:** web 44 (shell, corrected copy asserted absent, codes download, theme, dashboard
  panels, run view rows and settings); API 182.
- **Checkpoint** (`pnpm turbo lint typecheck test`, 50 of 50 tasks, fabrication check clean):
  core 20, access 56, config 180, db 261, integrations 122, collectors 482, llm 130,
  osint-engine 104, api 182, ui 7, web 44, worker 4 (1,592 tests).

**Then step 4:** results to Evidence.dc.html, run-scoped, after the owner's review.

### Locked state for every stream refusal, and what step 4 needs first (2026-10-06)

**State confirmed against the owner's 6b brief.** Step 1 (auth), step 2 (search dashboard) and
step 3 (run view) are built. R1 to R5 realign them with the screen designs, uncommitted and still
awaiting the owner's side-by-side review. Nothing was rebuilt.

**One step 3 requirement was not met, now fixed.** The brief asks that a `locked` event render as
the Locked state for all five reasons. A refusal of the reader's own access (CREDENTIAL_REVOKED,
MEMBERSHIP_REVOKED, PERMISSION_LOST) carries no `locked` block. It showed as a failure-toned
alert, "Updates stopped". It now shows as the Locked state (`AccessLockedNotice` in
`components/LockedNotice.tsx`):
- **Tone:** information, not failure (role `status`, never `alert`).
- **What is withheld:** live updates, with what is shown "as of" the event's `checkedAt`.
- **Why:** the API's own detail, with the reason and the code.
- **Next step:** an action this app can take: sign in again (`/sign-in`), choose an
  organisation (`/tenant`), or ask an owner or administrator (the roles holding
  `member:update`).
- **Test:** `run-view.test.tsx` covers all three access reasons and asserts there is no alert
  and no Reconnect.

**Collector "Partial" (§3) never shows on a job.** No job outcome records dropped sub-queries,
so the API has nothing to show it from. Partial shows only at run level (`PARTIAL`).

**Before step 4: what the endpoints cover, and what they do not.** Checked against
`apps/api/openapi.json`. Nothing is stubbed.
- **Covered:**
  - entities, graph and timeline, each scoped by run or case;
  - entity detail (claims carry `evidenceId`);
  - evidence detail (collector and version, run, both timestamps, hash, source URL,
    attribution, stated and derived claims) and the raw payload;
  - cases and pins.
  - Stated versus derived is `strength === "DERIVED"` (`routes/evidence.ts`), so every claim
    surface can show it the same way.
- **Q1. A case is only its pins.** Cases and runs are not linked, so a case-scoped read covers
  only what is pinned. Proposal: run-scoped tabs as the run's results, and the same tabs on a
  case labelled "pinned items only". Alternative: wait for a case–run link (a db migration and
  the API).
- **Q2. The evidence grid has one source, the timeline.** It returns at most 500 records, with
  `total` and `hasMore` but no cursor or offset. Proposal: build on it. A run with more than 500
  records shows as partial ("500 of N"), and sort and filter apply to the loaded rows only.
  Alternative: add paging to the API first.
- **Q3. Relationships have no provenance and cannot be pinned.** No endpoint returns a
  relationship's claims or evidence, and pins take evidence, entities and claims only. That
  breaks "pin on every result" and "provenance from any value" for graph edges and the entity
  relationship list. Proposal: an API addition, a relationship read with its claims and a
  `relationship` pin kind (with a migration). Alternative: show edges marked "no provenance or
  pin yet".
- **Q4. No entity-class colours exist.** §6 says graph nodes are distinguished by ring colour
  and a text label, but §2 defines no entity-class tokens. Workspace.dc.html uses claim colours
  and raw hex. Proposal: the owner adds entity-class tokens to §2; until then, nodes are neutral
  with their class as text.
- **Q5. Overview has no endpoint of its own.** Proposal: compose it from existing reads
  (timeline totals, undated counts, entities, pins). `/entities` has no total, so an entity count
  past the limit is an em dash with its reason.
- **Q6. New dependencies** approved in ARCHITECTURE-DECISIONS §8 but not yet installed:
  TanStack Table (with virtualisation) for the evidence grid, and Cytoscape.js behind a
  swappable component for the graph.
- **Checkpoint** (`pnpm turbo lint typecheck test`, 50 of 50 tasks, fabrication check clean,
  with Postgres and Redis up): core 20, access 56, config 180, db 261, integrations 122,
  collectors 482, llm 130, osint-engine 104, api 182, ui 7, web 44, worker 4 (1,592 tests). Run
  first without Docker, integrations and llm fail with ECONNREFUSED on 5432 and 6379: setup, not
  a defect.
- **Step 5 is covered by the spec as it stands:**
  - reports: create (409 SYNTHESIS_UNAVAILABLE), list and read;
  - PDF export: 202 with `Retry-After` while rendering;
  - the document: coverage with `partial`, citations, and the model's endpoint host and raw
    region headers.

**Gaps found by the audit, each needing its own decision:**
- **Cases and runs are not linked.** This blocks the workspace, overview and case reports.
- **No claims or evidence list endpoint.**
- **No correlation, inference or contradictions.**
- **No per-run cost or claim counts.**
- **Media, map, monitors and credits** are not built.
- **In production a domain target would run nothing.** 8 of 10 collectors are licence-UNVERIFIED
  and refused unless `COLLECTORS_ALLOW_UNVERIFIED=true`.

### Step 4: results and the case workspace (done 2026-10-06; awaiting the owner's look)

**Owner's answers to Q1–Q6 (2026-10-06):**
- **Q1:** pinned-only cases. A run's results get the tabs; a case gets the same tabs, labelled
  "pinned items only". Cases are not linked to runs: that is a schema change for the later cases
  reclamation.
- **Q2:** the evidence grid is built on the timeline. Past 500 records it says "500 of N";
  paging is a later API task.
- **Q3:** the API change, made now as the one exception: a relationship read and a relationship
  pin, with a migration and cross-tenant tests.
- **Q4:** entity-class tokens added to DESIGN-SYSTEM.md first, then used. Colour and the class in
  words, no raw hex.
- **Q5:** Overview is composed from existing reads. A count past the list limit is an em dash
  with its reason.
- **Q6:** TanStack Table and Cytoscape.js are installed.

**API and database (Q3):**
- **Migration `0020_phase6b_relationship_pins`:**
  - adds `case_pins.relationship_id`, with a tenant-scoped foreign key to
    `entity_relationships` and a unique index per case;
  - widens the one-target check to four targets.
  - **Expand-only, no downtime:** a nullable column and a looser check. The key and the check
    are `NOT VALID`, after 0015's precedent: every existing row holds a null there and passed
    the stricter check.
  - Table-level grants and RLS already cover the column.
- **`GET /api/v1/relationships/{id}`** (`routes/entities.ts`, `evidence:read`): the
  relationship, both ends with class and name, its measured claim count and strengths, and every
  claim behind it with its `evidenceId` (`claimLimit`, `claimsTruncated`).
  - **Person gate:** the shared `requirePersonAccess`, probing both ends. That covers the
    evidence behind the relationship's own claims.
- **Pins:** `relationship` is a fourth pin type. The pin summary names the relationship and both
  ends, read in one batched query (`relationshipDetails`). Pinning a relationship is gated on
  both ends.
- **Case scope:** a pinned relationship brings in both of its ends (entities, graph seeds) and
  the evidence behind its claims (timeline).
- **Tests:**
  - db `exploration.test.ts`: the relationship read, its claims only in its own tenant, a pinned
    relationship's ends in the case, and the database refusing a pin with two targets.
  - db `isolation.repositories.test.ts`: pinning another tenant's relationship.
  - api `exploration-api.test.ts`: the read (both ends, stated and derived claims citing
    evidence, truncation, 404, 400); pinning idempotently with its summary; the case scope after
    a pin. The release-blocking cross-tenant block also covers the read (404) and the pin type
    (404 from B's own case).
  - api `person-gate.test.ts`: a relationship asserted only by person evidence is refused
    across the lifecycle, and so are its pin and a case holding it (entities, timeline, graph).
    A clean relationship and a clean case graph are unchanged byte for byte.

**Design system:**
- **§2 Entity class:** 20 tokens. A ring and a fill for each of the ten classes, light and dark,
  in families as the designs group them: infrastructure greens, contact blues, person,
  account ambers, organisation, location.
  - **Measured:** every ring is at least 3:1 on `surface-sunken`; every label (`ink-primary`)
    is at least 4.5:1 on its fill. Classes within a family step in lightness.
  - **Not the claim colours,** deliberately: in the graph, colour says what a node is, and
    strength is said by the edge (dashed when only inferred or hypothetical claims stand
    behind it) and in words.
  - **Selection:** a seed has a wider ring of its own colour; the selected node has an `accent`
    outline.
- **§5:** `layout-drawer-width` (400px), the provenance drawer.
- **Guard:** 112 tokens, both themes, nothing extra.

**UI package:**
- `ClaimStrength`: the word, always, on a small-radius badge, since pills are for status only.
- `EntityClassName`: a colour dot and the class name.
- `Drawer`: Radix Dialog from the right edge.

**Web** (`apps/web/src/workspace/`), every call through the generated client:
- **Routes:**
  - `/runs/$runId/$tab` and `/cases/$caseId/$tab`, for overview, entities, evidence, graph and
    timeline;
  - `/cases`, the case list, which can also create a case;
  - **Cases** in the side navigation;
  - recent cases on the dashboard open their workspace.
  - The run view's tab bar starts with **Progress**. A case has no Progress tab.
  - An unknown tab is said plainly.
- **Evidence:** a TanStack Table grid over the timeline.
  - **Columns:** source label (the collector id with an em dash and its reason when the registry
    has no label), strength in words, observed and collected apart, claims, source URL, pin.
  - **Sorting:** unknown times sort last both ways.
  - **Filters:** text, strength and source, over the loaded rows.
  - **States:** "Partial: n of N" past 500, and how many records lack each timestamp.
- **Entities:** a grid with the class in words, strengths and measured counts. "Recorded", not
  "first seen": it is when the platform recorded the entity.
  - **The entity panel:** claims stated by a source apart from claims computed by the platform
    (DERIVED: dashed edge and the word). Each value opens its provenance with the claim marked.
    Each relationship opens its provenance.
  - **Pins:** the entity, each claim and each relationship.
- **Graph:** Cytoscape.js behind `GraphRendererProps`.
  - **Drawing:** colours, font and line widths are read from the tokens at runtime and redrawn
    when the theme changes. Each node carries its class name as well as its colour.
  - **Controls:** hops 0 to 3, a partial notice when the slice is cut, and a legend of the
    classes present.
  - **The list:** every node and relationship in words, with pins and provenance. It is the
    keyboard path, and the whole graph where no canvas exists.
- **Timeline:** order by observed or collected time (the API's `sortBy`). Events without that
  time are grouped as undated, never placed at the other time.
- **Overview,** composed:
  - **Totals:** evidence records (measured), entities (an em dash with why past 500), and how
    many lack an observed time.
  - **Strengths:** evidence counted by strength, an em dash when the list is cut.
  - **Key entities:** among those listed.
  - **For a run:** its coverage (status chips with counts; "These results are partial" for a
    PARTIAL run) and its gaps, each failed, keyless, refused or excluded source with its reason.
  - **For a case:** its pins counted by kind.
- **Provenance drawer:** one component, opened from any value. It has a Back trail from a
  relationship to the evidence behind a claim.
  - **Evidence:** collector and version, source label, run, observed, collected and recorded,
    the content hash, and the source URL (linked only if http or https).
  - **Attribution:** shown when present.
  - **Raw payload:** "Download raw payload", fetched as a blob through the client and saved as
    a file, never opened.
  - **Claims:** stated apart from derived, each pinnable.
  - **A relationship:** both ends and what asserts it.
- **Pin-to-case** on every result surface: grid rows, the timeline, entities, claims,
  relationships, graph nodes and edges, and inside the drawer.
  - **Choosing a case:** open cases only (archived ones take no pins), or "Create and pin".
    "Already pinned" is said on a 200.
  - **Permission:** a role without `case:write` is told why before anything is sent.
- **States everywhere:**
  - skeletons in the layout's shape;
  - an empty state that says where results would come from;
  - Failed, with the code and Try again;
  - Locked for any 403 carrying `locked`;
  - Partial, for cut lists and partial runs;
  - Stale: the read-at time with Refresh, and "still collecting" while a run is not settled.

**Judgement calls (flag if you disagree):**
- **No virtualisation.** TanStack Virtual positions rows with computed inline styles, which the
  design-system guard forbids, and the timeline caps the grid at 500 rows, which a plain table
  renders well. It was installed and then removed. When API paging lifts the cap, virtualisation
  needs a guard decision.
- **No hash or claim-text column** in the evidence grid. The timeline carries neither, and
  reading every record for them would be 500 reads. Both are in the drawer.
- **Hidden until built:**
  - the runs rail, discipline filters, the case summary paragraph and contradictions;
  - merge actions, bulk actions and saved views;
  - the timeline's range brush;
  - Re-verify and Cite in report.
- **Not driven in a real browser in this session.** jsdom has no canvas, so the Cytoscape
  drawing is exercised only by its fallback in tests. The owner's look is its first real
  rendering.

**Tests:**
- web `workspace.test.tsx` (18) covers the brief's non-negotiables:
  - source labels and both timestamps;
  - the em dash for an unknown observed time;
  - strengths in words;
  - derived apart from stated;
  - partial past 500;
  - Locked and not an error, and Failed with a retry;
  - the drawer's every field and the payload download;
  - the relationship-to-evidence trail;
  - pinning (by type and id; no archived cases; create and pin; refused for a role without
    `case:write`);
  - the graph's list, legend and cut notice;
  - undated timeline events and the reorder;
  - Overview for a partial run, a collecting run and a case;
  - the tab bar and an unknown tab.
- **Checked by breaking the code:** filling an unknown observed time from the collection time
  fails the evidence test.
- ui (3 more): strengths and classes in words, and entity colours merging.
- Two existing tests now expect Cases in the navigation and linked recent cases.

**Checkpoint** (`pnpm turbo lint typecheck test`, 50 of 50 tasks, fabrication check clean, with
Postgres and Redis up): core 20, access 56, config 180, db 264, integrations 122, collectors 482,
llm 130, osint-engine 104, api 184, ui 10, web 62, worker 4 (1,618 tests).

**Next: step 5, the report view,** after the owner's look.

### Step 0 of the master build sequence: step 4 verified live, step 5 built (2026-10-06)

**How it was checked.** The owner's running stack (`pnpm dev`, Docker), driven in headless Edge
by a Playwright script kept in the session scratchpad, outside the repo. It used a tenant
provisioned for the check, `[6b verify 38b0f4]` (owner `verify-6b-38b0f4@example.com`), which is
left in the dev database.
- **Sign-in and MFA** through the screens; the TOTP was computed from the key the enrolment
  screen showed.
- **A real run of `example.com`** from the dashboard. It finished PARTIAL:
  - RDAP and DNS each recorded evidence;
  - Wayback (HTTP 503), crt.sh (502) and Common Crawl (unreachable) were dead-lettered.

**Step 4, end to end:**
- **Pinning from the run's Evidence tab** ("Create and pin"):
  - `POST /cases` answered 201, then `POST /cases/{id}/pins` answered 201, with target
    `{type: evidence}` and the RDAP summary.
  - **In Postgres,** read inside the tenant: one `case_pins` row, holding only `evidence_id`.
- **The case, opened from Cases:**
  - "Pinned items only".
  - **Overview:** 1 evidence record pinned.
  - **Evidence:** exactly the RDAP record.
  - **Entities:** example.com and its two name servers.
  - **Graph:** drawn on a canvas, with each node's class in words and its class colour.
  - **Drawer, opened from the source value:** collector and version, run, observed and collected
    apart, and the full hash.
  - **The downloaded raw payload:** 2,440 bytes. They hash to the recorded
    `sha256:b02cbdd5…85121`.

**Defects found live, each fixed with a test that fails on the old code:**
- **The provenance drawer rendered off-screen.**
  - **Cause:** the theme resets Tailwind's spacing scale and the design system had no zero, so
    `top-0` and `right-0` generated no CSS. The fixed drawer took its static position, below the
    page (measured: y 900 in a 900px viewport). `min-w-0`, used in nine files, generated nothing
    for the same reason.
  - **Fix:** a `space-0` token (0px) in DESIGN-SYSTEM §5, `tokens.css` and the theme. The guard
    now counts 113 tokens.
  - **Test:** `apps/web/scripts/tailwind-classes.test.ts` (release-blocking).
    - **How:** compiles the app's real stylesheet with Tailwind and builds every class the UI's
      source writes, one at a time; a class that adds no CSS fails, with where it is used.
    - **Before the fix** it reported exactly `min-w-0`, `right-0` and `top-0`.
- **Graph nodes overlapped and hid each other's names.** The layout did not count the labels the
  nodes are sized to.
  - **Fix:** `nodeDimensionsIncludeLabels`, with padding and spacing from the tokens.
  - **Test:** `src/graph-renderer.test.tsx`, Cytoscape mocked; it fails on the old options.
  - **Re-checked by screenshot:** no overlap.

**Seen, not changed:**
- No favicon (`/favicon.ico` 404). It predates 6b-4.
- The RDAP evidence's observedAt (08:02:47Z) is 44 seconds after its collectedAt (08:02:03Z).
  The UI shows what is stored. It is the RDAP collector's choice of event time and the
  registry's clock, a question for that collector.

**Step 5, the report view** (`apps/web/src/workspace/report/`; a **Report** tab on a run; a case
has none, and says so):
- **Generate:** with or without a model synthesis.
  - **Settling:** disabled, with why, until the run has settled.
  - **Refusals:** `SYNTHESIS_UNAVAILABLE` and `RUN_NOT_SETTLED` show with their codes.
  - **Polling:** a QUEUED or RUNNING report is read again every 2 s.
  - **Picking a report:** the run's reports are listed for choosing, newest first.
- **The PDF:** `GET /reports/{id}/export/pdf` through the generated client (as a blob).
  - **While rendering:** a 202 shows "rendering" and is asked again after `Retry-After`. The 202's
    status word is shown only when the API gave it; otherwise "not ready yet", never a guess.
  - **Then the file:** embedded and downloadable, with the JSON, CSV and Maltego exports too.
  - **If it failed:** `REPORT_PDF_FAILED` shows as a failure with its code.
- **The document as stored,** in the report's own wording (`document.wording`), so the screen says
  what the PDF says:
  - **Coverage and limitations:** the headline, then what was not collected and why (each
    source's state chip in the report's words, detail, reason code, evidence count and attempts;
    a never-attempted source shows an em dash and why, never 0). Then what was collected, what
    does not apply, and the standing limits.
  - **A partial run** gets a notice before everything else.
  - **Synthesis:** none requested, skipped with its reason, or the statements with strength and
    citations. Model provenance comes from the stored templates:
    - model, licence and profile;
    - "Served by: {endpoint}, …It named no upstream provider." when `servedBy` is null;
    - each region header raw ("bom" stays "bom");
    - "The endpoint sent no region header." when there is none.
  - **Findings and relationships:** every claim's strength in words. DERIVED is dashed and says
    "computed by the platform". `[n]` citations open the cited evidence's provenance. Every
    claim, entity and relationship can be pinned.
  - **Also shown:** the evidence basis (both timestamps, hash, URL, pin), untrusted-content
    warnings, attribution, omitted claims and the glossary.
- **Live:**
  - **Synthesis:** refused with `SYNTHESIS_UNAVAILABLE`; no model provider is configured here.
  - **Report:** generated in about 3 s.
  - **Coverage:** the three FAILED sources show with their reasons and the HELD GDELT source
    with its own; the partial notice and the glossary render.
  - **Citations:** [1] opens the DNS evidence's drawer.
  - **The PDF:** 844,569 bytes, starting `%PDF-`.
  - **202 seen in the UI:** with renders queued, it showed "The PDF is rendering. Asking again in
    5 seconds, as the server asked.", asked again 5 s later, got 200 and showed the PDF.
- **Not seen live:** a GENERATED synthesis's model provenance, because no provider is configured
  here. Covered by tests with the stored wording.
- **Not seen in this check:** the PDF drawn inside the page. Headless Edge has no PDF viewer;
  the owner's look is the first.
- **Defects found and fixed:**
  - **Live:** the report picker said RUNNING beside a generated report (the list was read
    once). It is now read again when the shown report changes status, with a regression test.
  - **By the tests:** a 202's JSON body was read with `new Response(blob)`. It is now read with
    `blob.text()`, which works everywhere.
- **Tests:** `src/report-view.test.tsx` (9), with the wording captured from a real report. It
  covers:
  - partial coverage with failed and held sources;
  - the em dash for no attempts;
  - strength labels and citations opening provenance;
  - model provenance raw, with "bom" kept and no place name, in both served-by forms;
  - the 202, Retry-After and file sequence;
  - PDF failure;
  - generate, poll and the refused synthesis;
  - an unsettled run;
  - a failed report and the Locked state;
  - the stale-list regression.

**Checkpoint** (`pnpm turbo lint typecheck test`, 50 of 50 tasks, fabrication check clean, with
Postgres and Redis up): core 20, access 56, config 180, db 264, integrations 122, collectors 482,
llm 130, osint-engine 104, api 184, ui 10, web 74, worker 4 (1,630 tests). On the way the gates
caught three things in the new code, each fixed:
- two string or zero fallbacks (`?? "…"`, `?? 0`);
- raw lengths in a test's token stub;
- a placeholder shaped like a Tailwind arbitrary value.

### Step 0, second pass: a fresh live run and two independent reviews (2026-10-06)

**Fresh live run.** It repeated the check from scratch: a new run of `example.com` (PARTIAL: RDAP
and DNS found evidence; Common Crawl, Wayback and crt.sh failed upstream), a new case,
`[Verification case 38b0f4 rerun]`, and a new pin.
- **The pin:** the API answered 201 for the case and 201 for the pin. Postgres holds one
  `case_pins` row with only `evidence_id`.
- **The case, opened from Cases:** every check passed.
  - **The drawer:** the downloaded payload hashes to the new evidence's recorded
    `sha256:db7d9a56…`.
  - **Seen by screenshot:** the case's Evidence grid, Entities, the graph (class in words and
    colour, no overlap) and the drawer.
- **Defect found:** entities with no claims left their Strength cell **blank**. It now says "no
  claims, so no strength" (`StrengthList`). The regression test fails on the old code.
- **The report:** the 202 path seen live again. The page showed "The PDF is waiting to render.
  Asking again in 5 seconds…", got 202, 202, then 200.

**Review 1** (50 agents; six reviewers, one per non-negotiable; every finding put to two
skeptics told to refute it): 22 raised, 17 confirmed, 3 split, 2 refuted. All 20 confirmed or
split were fixed. Most were the screen not saying what the stored report and its PDF say
(`packages/integrations/src/exports/pdf.ts`):
- **High:** NOTHING_FOUND was listed under "What was collected". It is now under what was not
  collected, as the PDF lists it.
- **What the PDF prints:**
  - the evidence count on COLLECTED rows only;
  - no hard-coded "partial run" sentence: the stored headline is boxed;
  - no line, and no invented sentence, when there is no region header;
  - the finding's identifier;
  - the cover's `type value` and Run line;
  - omitted claims with coverage.
- **Behaviour:**
  - PDF and report polling stop on an error;
  - an export that gets no answer is `ApiUnreachable` (`API_TIMEOUT` / `API_UNREACHABLE`);
  - a stored PDF is fetched once (not again on focus or remount);
  - a FAILED PDF is not asked for and offers no retry that cannot work;
  - the report list reads the API maximum and says when it is cut;
  - Refresh re-reads reports;
  - the model-token quota refusal is shown in the API's words;
  - the PDF loading state is announced;
  - attribution links are 44px.

**Review 2** (45 agents): checked each fix, then three fresh reviewers. 17 of 20 were fixed;
the 3 partly fixed were finished. 8 new findings survived both skeptics, and all were fixed:
- **Blank PDF under StrictMode.** A cached PDF's object URL was revoked by StrictMode's second
  effect run. `useObjectUrl` now defers revocation by a tick, and a setup that follows cancels
  it.
  - **The test first missed it:** the PDF arrived after mount. Strengthened to leave the tab and
    return (the panel mounts with the PDF cached), it now fails on the old code.
- **The evidence basis** prints each source's claim count (the stored `Claims` column).
- **A just-generated report** missing from a cut list is offered in the picker, so the picker
  always names the report shown.
- **The report list** is read again when it disagrees with the report's own status, not on
  every mount.
- **Generate refusals:** `QUEUE_UNAVAILABLE` in the API's words. A refused synthesis says a
  plain report still works.
- **Download PDF** saves the PDF already held. A not-ready export is the coded
  `EXPORT_NOT_READY`.
- **Announcements:** the live regions are no longer stuck busy, and the generating and
  downloading pending states are announced.
- **An unmatched citation** prints the stored `footnote.missing` wording. Source links are
  44px wide too.
- **The flaky polling test** has a 10 s timeout.

**Mutation checks:** each main defect was put back one at a time, and each was caught by its
regression test (NOTHING_FOUND bucketing, polling through errors, an untyped unreachable
export, Refresh skipping reports, the StrictMode revocation).

**Checkpoint** (`pnpm turbo lint typecheck test`, 50 of 50 tasks, fabrication check clean):
core 20, access 56, config 188, db 264, integrations 122, collectors 482, llm 130,
osint-engine 104, api 184, ui 10, web 87, worker 4 (1,651 tests).

## Reclamation R0: the legacy classification pass (2026-10-06)

What `docs/MASTER-BUILD-SEQUENCE.md` calls R0, by the method in `docs/vapt/VAPT-REFERENCES.md`
part 1d. It produces the harvest list R1 starts from. **Nothing was ported.**

**Output:** `docs/reclamation/legacy-classification.md`. It is reference data that does not ship. It has every
exported function, class and object holding functions in `legacy/src` and `legacy/scripts`, with
path, export, bin and a one-line reason; a summary; and counts by area.

**Counts:** 1,162 exports in 299 files.

| Bin | Exports |
|---|---|
| PURE | 489 |
| FABRICATION-FLAGGED | 52 |
| IO-BOUND | 160 |
| UI/DEAD | 461 |

- **Not binned:** exported constants holding only data. They are counted in the document.
- **Not in scope:** `legacy/ai-service` is Python.

**Tooling** (`packages/config/scripts/`). It reads source only and never imports or runs legacy
code.
- **`legacy-classification.ts`:** the classifier.
- **`legacy-classify.ts`:** the CLI. `legacy/` is absent in CI, so it is run by hand:
  `node packages/config/scripts/legacy-classify.ts`.
- **`legacy-classification.test.ts`** (8): in-memory fixtures, never `legacy/`.
- **`eslint/fabrication-plugin.d.ts`:** types for the plugin, for TypeScript importers.

**How it bins** (first that applies):
- **UI/DEAD:**
  - React: JSX, hooks or the React module;
  - browser state: `localStorage`, `sessionStorage`, `window`, `document`, `navigator`;
  - or no importer anywhere in `legacy/`. Tests count as importers, and route files and app
    entry points count as used.
- **FABRICATION-FLAGGED:** this repository's gate fires inside it. That is both halves: the line
  patterns and the AST rule `no-fabricated-fallback`. Legacy's own disable comments are ignored.
- **IO-BOUND:**
  - **Direct or followed:** network, disk, database or queue, directly or through any function
    that is, followed across imports to a fixed point. The reason names the root cause and the
    path to it ("via resolveA (src/utils/attack-surface.ts): calls fetch").
  - **Also here:** the clock, randomness and the process environment, ranked below real I/O.
- **PURE:** the rest.

**Checked by hand before trusting it:**
- **Known modules agree with the audit.** `analysis.ts` `buildTimeline` is flagged at line 614,
  the zero-fallback INVENTORY.md names. `cib.ts`, `client-ip.ts`, `file-provenance.ts` and the
  `cases/` logic are mostly PURE.
- **Dead verdicts:** 8 random "nothing imports it" verdicts were confirmed by text search. The
  one name that appears elsewhere appears only in comments.
- **Three flaws found and fixed in the classifier, each with a test:**
  - a local `const window` read as the browser's;
  - collector definitions held in objects were skipped entirely;
  - the first-found cause hid the network behind the clock.

**Limits.** These are stated in the document. Calls through parameters, methods or dynamic
imports are not followed, so PURE means "no I/O found". An export used only inside its own file
reads as dead. Every port still passes the gate and brings its tests (CLAUDE.md).

**Checkpoint** (`pnpm turbo lint typecheck test`, 50 of 50 tasks, nothing cached, fabrication
check clean over 396 files): core 20, access 56, config 188, db 264, integrations 122,
collectors 482, llm 130, osint-engine 104, api 184, ui 10, web 74, worker 4 (1,638 tests).

**Next: R1,** the case analysis engine, from the PURE rows of `src/utils/cases/` and the
analytical parts of `src/utils/osint/`.

## UI foundation U1-a: the design system extracted from the mockups (2026-10-07)

**The brief.** The 15 mockups are now the binding visual specification. U1-a corrects
`docs/DESIGN-SYSTEM.md` and the tokens to match what is drawn. It is frontend and design system
only: no backend change, no new endpoint.

**How it was read.** Fifteen agents each read one mockup's `.dc.html` in full and checked it
against its PNG. Each returned a measured inventory: every colour with its role and count, type,
spacing, radii, borders, shadows, component specs and layout. One agent reconciled the
inventories with the document and computed contrast for every pair. A critic re-read the
mockups to find gaps and wrong values; it found ten, all taken in. I also looked at all 15
renders myself.

**What changed against the previous tokens** (113 before, 275 now; nothing removed):
- **Values corrected to the drawings:**
  - `ink-secondary` dark `#C4C6CC` → `#B6B8BF`.
  - Line heights to about 1.3×, as the mockups render: `display` 36→39, `body` and
    `body-strong` 21→18, `small` 19→16, `caption` 17→15, `mono-body` 20→17, `mono-caption`
    17→15, `metric` 26→27.
  - `layout-drawer-width` 400→350.
  - `qr-size` 176→150.
- **Colours added (from the drawings):** `surface-field`, `surface-control`, `surface-muted`,
  `surface-map`, `border-control`, `ink-body`, `accent-hover`, `link`, `link-hover`,
  `claim-inferred-tint` and `-border`, `status-failed-tint` and `-border`,
  `status-needs-key-ink`, and the missing marks `claim-correlated-mark` and
  `claim-hypothesis-mark`. Dark values come from the dark dashboard where drawn, and are
  derived to the same contrast where not.
- **Type:** the `serif` family (the report document card, D4) and 27 styles: the auth and page
  headings, `heading`, `subtitle`, `wordmark`, `prose` and `prose-lead`, `ui`, `section-label`,
  `meta`, `chip`, `th`, `badge`, the `mono-*` data styles, `mono-otp`, and `serif-title` and
  `serif-body`.
- **Spacing:** quarter steps of 4px, because the mockups step in single pixels (`space-2.25` is
  9px; the class is `p-2.25`; the CSS variable is `--ds-space-2_25`). 21 steps were added, 30 in
  all.
- **Radius:** `xs` 5, `inner` 9, `box` 10, `xl` 14, `bar` 3.
- **Sizes:**
  - `control-sm` 32 and `control-md` 36 (visual; hit area 44);
  - `row-compact` 44 and `row-comfortable` 52;
  - `tab-indicator-width`;
  - dots, bars, icons, avatar, logo tile, the OTP field;
  - the header, case-header and tab-bar heights;
  - the rails, document, palette and drawer widths;
  - the QR frame.
- **Components (§9), each naming its mockup:**
  - the app and case headers, tabs in the drawn order;
  - the command-palette button and palette, the account menu with its theme toggle;
  - the vetting pill (every vetting status), the credits meter (with its unmeasured state);
  - navigation, cards;
  - the status chip, claim badge md and sm, tag, removable filter chip;
  - the data table (the Evidence grid), the inspector and provenance drawer (one docked
    component with a footer pair);
  - the metric and cost card, "arriving now", the run view;
  - the graph shell, runs rail, evidence card, map shell;
  - buttons, inputs, the report document card.
- **States (§8):** each designed, plus **Not built** for tabs whose analysis does not exist.
- **Status (§3):** **Unavailable** defined. Run status separated from collector status (a run's
  PARTIAL is amber; a collector's Partial is green).

**Where the mockups yield** (§12). Each row is a rule that does not bend:
- **44px targets:** controls keep their drawn look with a hit area extended to 44px. Table rows
  are at least 44px (the mockups' 31–39px rows hold pin buttons).
- **Never fabricate:** the credits meter is an em dash with its reason and no bar, because no
  credit metering exists.
- **Contrast:** `th` at 11px so `ink-muted` never falls below 11px. Placeholders are `ink-muted`
  (the browser default fails at 4.49:1). Graph edges use colours that meet 3:1.
- **Colour discipline (ARCHITECTURE-DECISIONS §9):** graph nodes and map points by entity
  class, never in claim colours. Settings, review state, contradictions and non-status pills
  are neutral.

**Decisions for the owner (D1–D6, §12).** Each default is the rule-compliant choice:
- **D1:** the vetting pill is neutral, where the mockup draws it green.
- **D2:** links are standalone, with no inline-link exemption.
- **D3:** the focal graph node keeps its class colour.
- **D4:** serif in the report document card (adopted from the mockup).
- **D5:** map points by entity class.
- **D6:** the drawn tab order.

**Contrast, computed.** 162 pairs, both themes: every text pair the document relies on at
4.5:1 or more, and every mark at 3:1 or more against `surface-sunken` and `surface-raised`.
None below its minimum.

**Tooling:**
- **Generated, not hand-kept:** `tokens.css` is generated from the document (the guard holds it
  value for value). The Tailwind theme (`theme.css`) and `cn.ts`'s scale lists are generated
  from the same token list.
- **The guard** reads dotted spacing names and the serif family, and accepts underscores in
  variable names. It expects 275 tokens.
- **The class guard's** sanity case moved from `p-7` (now a real token, `space-7`) to `p-11`.

**Not changed in U1-a:** the screens. Their spacing and line heights shift with the corrected
tokens; they are rebuilt from the component library in U1-b and U1-c.

**Endpoint gaps the specs meet** (to raise, not stub):
- **Cost:** no per-run cost ("Spent so far").
- **Credits:** no credit balance.
- **Monitors:** no monitor or alert endpoint.
- **Workspace data:**
  - no evidence list with claim text or hash;
  - no case-level summary or contradictions;
  - no media endpoints;
  - no coordinates for the map;
  - no report sections or review state.

The UI shows these as an em dash with its reason, or as **Not built**.

**Checkpoint** (`pnpm turbo lint typecheck test`, 50 of 50 tasks, fabrication check clean, with
Postgres and Redis up): core 20, access 56, config 188, db 264, integrations 122, collectors 482,
llm 130, osint-engine 104, api 184, ui 10, web 87, worker 4 (1,651 tests).

## UI foundation U1-b: the shared component library (2026-10-07)

**The brief.** Build the primitives every screen is assembled from, in `packages/ui`.
Presentational only: components take props, and a dev-only gallery feeds them fixtures. No screen
rebuilds (U1-c), no API wiring, no new runtime dependency.

**Built** (one file per component, each naming its mockup; every listed state):
1. **Command palette** (Main): the header button (⌘K / Ctrl K), Ctrl K from anywhere, and the
   palette as a combobox with a grouped listbox. States: closed, open, query typed, grouped
   results, no results, loading, empty. Arrow keys move, Enter opens, Escape closes and returns
   focus to the opener. With it, the **app header row**, the **vetting pill** (every status,
   neutral, D1) and the **account menu** (Light/Dark radio pair).
2. **Status chip**: every collector status, plus two new ones, Found nothing and Locked (D7), and
   the run's own chip (a run's PARTIAL is amber, in capitals). Each has its dot.
3. **Strength badge**: all six strengths at md and sm, the dot, and a key (mark plus word).
4. **Filter chip**: removable, toggle on and off (`aria-pressed`), and the add chip. Drawn at
   `control-sm` with a `target-min` hit area; rows wrap with a `space-3` gap.
5. **Data table** (the Evidence grid): `th` header, sortable headers with `aria-sort`, rows at
   `row-compact` or larger holding the checkbox and pin targets, selected rows marked
   `aria-selected`, loading, empty, and **Not built**. An empty table is never blank.
6. **Inspector and provenance drawer** (`layout-drawer-width`): evidence, entity, claim and
   relationship. It shows the registry source label, observed and collected apart (a null
   observed stays null), version, run, the whole hash, source URL, and the payload as a download.
7. **Metric card and "arriving now"**: a value; unavailable (em dash with "Not measured — reason",
   failure ink only when a failure is the cause); Not built. Never 0, "N/A" or a bar.
8. **Graph shell** (Cytoscape): toolbar and legend overlays, loading, empty, and a required
   equivalent list. `graphStylesheet` themes nodes by entity class. The selected node keeps its
   class and gains an accent outline (D3). Edges are neutral; only all-INFERRED edges are amber.
9. **Runs rail and collector rows**: run rows in the run vocabulary. Each of the five lock
   reasons shows its heading, the API's detail, the Locked block where given, the code, and the
   re-check interval in the past tense. Collector rows: ran, running (a bar only where the source
   reports progress), failed (tinted, with its code), found nothing, needs key, held, skipped, and
   a locked list.
10. **Evidence card**: found (badge, claim, registry source, observed and collected, hash, pin);
    INFERRED (tinted, with "from …"); found nothing (its own neutral card).
11. **Map shell** (a slot for MapLibre GL): the layers rail, `surface-map` ground, the legend (by
    entity class, D5), the selected-point card, and keyboard-usable point lists. A point without
    coordinates is listed with an em dash and its reason, never placed.
12. **Report surface**: the only place the serif is applied. It goes on the report's own title
    and prose, never on a container. It also has the inferred passage (rule, tint, "from …"), the
    coverage limitation callout, and citations (D8).

**Shared:** `EmptyState`, `NotBuilt`, `LoadingState`, `FailedAlert`, `KeyValueList`, `PinButton`,
and the `hit-area` utility (`components.css`), which gives a small drawn control an invisible
`target-min` box.

**Checks added:**
- `packages/ui/scripts/no-raw-hex.ts` runs before every `@repo/ui` build and in its tests. A hex
  colour anywhere in the package's source except `tokens.css` fails the build.
- `serif-scope.test.ts`: no serif outside `report-surface.tsx`; the body is sans.
- `contrast.test.ts`: every mark and ring is at least 3:1 on every ground, in both themes.
- 57 `@repo/ui` tests (10 before): a render test per component, plus behaviour tests for the
  honest states.

**Review (mirroring U1-a).** Three independent critics re-read each component's source and its
gallery render against its mockup and the four rules. They found 49 mismatches; 12 broke a hard
rule. The rule breaks:
- a light-theme dot under 3:1, fixed with a token change: light `claim-hypothesis-mark`
  `#8E9096` → `#808288`, recorded in §2 and §12;
- Escape not returning focus from the palette;
- the palette acting on unlisted items while loading;
- a table header row under 44px with overlapping hit areas;
- a toolbar wrap gap that let hit areas overlap;
- a null collector version silently dropped;
- a PARTIAL run unlabellable in the rail;
- a lock interval stated in the present tense after the stream had closed;
- map lists not usable by keyboard;
- overlapping citation hit areas (D8);
- block content inside a button;
- the run lock missing the API's next step.

Every finding was fixed with a regression test, or raised to the owner. A fourth agent re-checked
all 49. It confirmed every one fixed or raised, except one nit left as §9 has it (the avatar edge
in dark). It also found four defects that the fixes had introduced, now fixed:
- hypothesis edges drawn in INFERRED's amber;
- a key wrapping beside the full hash;
- bare dashes in a gallery fixture;
- the search input's hit area painting over its text.

A browser audit (Edge headless, both themes) ends with no text pair under 4.5:1, no control with a
hit area under 44px, and no serif outside the report. The graph now uses a deterministic concentric
layout and redraws on a theme or font change; live switching had clipped labels.

**Gallery:** `/dev/gallery` (development builds only, absent from a production build). Every
component and state, labelled with its mockup, in Light, Dark, or both side by side. Fixtures are
bracketed placeholders.

**Screens touched** (minimal, no rebuild):
- `Run.tsx`'s status maps take the new statuses.
- The Graph tab's renderer uses the shared stylesheet. Its edges were `border-strong`, about
  1.4:1, and are now neutral at 3:1. It uses the concentric layout.

**Raised for the owner:** D7 (Found nothing and Locked in grey), D8 (citations as standalone
controls), and R1–R10 in DESIGN-SYSTEM §12:
- R1: 26px icon buttons;
- R2: input borders under 3:1;
- R3: the vetting pill matching the Running chip;
- R4: the report card's width;
- R5: run chip sizes;
- R6: the map card's width;
- R7: card heading size;
- R8: IBM Plex Serif not loaded (Georgia fallback);
- R9: MapLibre GL not installed;
- R10: edge weight and arrows.

**Checkpoint** (`pnpm turbo lint typecheck test`, 50 of 50 tasks, fabrication check clean, with
Postgres and Redis up): core 20, access 56, config 188, db 264, integrations 122, collectors 482,
llm 130, osint-engine 104, api 184, ui 57, web 87, worker 4 (1,698 tests).

**Closed 2026-10-07 on the owner's review.**
- **Accepted as built:** D7, D8, R1, R4–R7, R10, and the dark avatar's border.
- **R2 fixed.** A new token, `border-input` (light `#85878D`, dark `#757A84`), is 3:1 or more on
  every ground in both themes. Every text input takes it (`Input` and the grid's search); the
  deviation from the mockups is in §12, and `contrast.test.ts` holds it.
- **R3 fixed.** The vetting pill is told from every status chip by shape: an outline in
  `border-input`, no fill, no dot. A test checks every vetting status against every collector
  and run chip.
- **Deferred:** R8 (IBM Plex Serif, self-hosted later) and R9 (MapLibre GL, with GEOINT).
- **Moved:** `docs/legacy-classification.md` is now `docs/reclamation/legacy-classification.md`;
  the generator writes there.
- **Tokens:** 276 (was 275).

## UI foundation U1-c: every screen rebuilt from the component library (2026-10-07)

**The brief.** Rebuild every existing screen from `packages/ui` to match its mockup. No new
endpoints, no new runtime dependencies, no new components unless §9 specifies one and a mockup
draws it. Every capability without a backing endpoint shows its designed Not built card or an em
dash with its reason. Add a favicon.

**How it was done:**
- Seven readers specced each screen group against its mockups, the API and the tests.
- A foundation pass built the approved components and the shared pieces.
- Seven implementers then worked in parallel, each owning its own files.
- Four independent critics compared the source and live screenshots with each mockup and the
  rules. They found 45 mismatches, 7 of them rule breaks. Each was fixed with a test, or raised.
- A fifth agent re-checked all 45. It found one new rule break (below), since fixed with a
  mutation-proven test.

**Screens, and the mockup each matches:**

| Screen | Mockup | Notes |
|---|---|---|
| Sign in | SignIn (left) | Primary stays enabled; an empty field is refused with its error |
| MFA challenge | SignIn (right) | Own route on the raised ground; backup-code path |
| MFA enrolment | MfaEnrol | Link state is a tag; backup codes before confirm |
| Dashboard (search) and the app frame | Main, Dashboard-dark | The frame: side nav, header, outlined vetting pill, account menu with the Light/Dark toggle, Ctrl/⌘K palette. Credits as an em dash. Monitor alerts Not built |
| Cases | (none; the frame's list pattern) | Created date, Partial when cut |
| Tenant chooser | (none) | In the app frame when a tenant is open, the sign-in frame otherwise |
| Members, Settings | **No mockup: provisional** | Read-only, existing components only; actions not built |
| Run view | RunLive | Full-bleed. Any lock, or a refused reconnect, withholds everything held |
| Workspace frame and tabs (D6 order) | Workspace, Overview, Entities, Timeline, Evidence | Runs rail and docked inspector on Graph as drawn; current tab underlined |
| Graph | Workspace | Labels never below 11px; Hide inferred says what it hides |
| Media, Map; a case's Report | Media, Map | Not built cards |
| Report view | Report | One continuous serif document card, the sections rail, the citation rail (beside it from `xl`), citations as standalone controls (D8), View PDF |

**New components** (approved: §9 specifies them and a mockup draws them; each is in the gallery
with all its states and tested):
- Button sizes; TextLink and BackLink; Tag;
- ProductMark, SideNav and NavItem; CreditsMeter;
- ContextHeader; TabBar and TabLink;
- Card, NestedCard and DashedNote; DensityToggle;
- Input variants and ToolbarInput; HeroSearch;
- ReportSectionHeading.

Small extensions to U1-b components are listed in the foundation report.

**Favicon:** `apps/web/public/favicon.svg`. A guard holds its colours to the tokens. It clears the
earlier 404.

**Live audit** (Edge, headless, real API, worker and data: a PARTIAL run, a case with a pin, a
generated report):
- **Coverage:** every screen and open state in both themes, 58 screen-states including both
  enrolment steps.
- **Result:** no text pair under 4.5:1, no input edge under 3:1, no hit area under 44px, no
  serif outside the report, no console errors, no horizontal scroll.
- **What the audit could not see** (the critics caught it): the current tab's underline was
  clipped, and then lost the cascade. Both are fixed, now pinned by a test on the compiled CSS,
  and the pixels were checked in both themes.

**Rule breaks fixed in review:**
- the tab underline;
- graph labels shrinking below 11px;
- the elapsed time ticking after the stream dropped;
- a locally computed person-access verdict;
- retention wording not read from the API;
- prose broken mid-word;
- a run's earlier data left on screen after a refused reconnect.

**Raised, not built:** listed in DESIGN-SYSTEM §12 under U1-c:
- components outside the approval rule, and a mobile navigation sheet;
- endpoints that do not exist (a tenant-wide runs list, reading the report marking, per-entity
  evidence, cost, credits, monitors, media, coordinates);
- backed but state-changing features not built here (merges, replay, member and settings edits,
  API keys, credentials, scope authorisations, usage);
- the PDF panel's page height.

**Checkpoint** (`pnpm turbo lint typecheck test`, 50 of 50 tasks, fabrication check clean on 447
files, with Postgres and Redis up): core 20, access 56, config 188, db 264, integrations 122,
collectors 482, llm 130, osint-engine 104, api 184, ui 93, web 176, worker 4 (1,823 tests). A
load-sensitive timing test in integrations failed once with the whole stack running, then passed
three times alone; the package has no changes.

## Reclamation R1-0: planning the case analysis engine (2026-10-08)

**The brief.** Plan R1 without porting anything. Read-only on `legacy/`, and only docs written,
except that the pre-flight may fix a missing U1-b follow-up, or a route unreachable at phone
width, with the simplest change and a regression test.

**Pre-flight.**
- U1-c was already committed (`fcad376`); the tree was clean.
- **U1-b follow-ups confirmed, no change needed.**
  - R2: `border-input` is 3:1 or more on every ground in both themes. The lowest is
    `surface-muted` (3.00 light, 3.16 dark); the search input's own ground, `surface-field`, is
    3.59 light and 3.65 dark. It is recorded in DESIGN-SYSTEM §12 and held by `contrast.test.ts`.
  - R3: the vetting pill is an outline with no fill and no dot, held by the R3 test in
    `library.test.tsx`.
  - Note: `contrast.test.ts` checks `border-input` against seven grounds but not `surface-field`
    or `surface-control` (both pass when measured). Not widened here, since it was not missing.
- **The classification file.** On `main` it was never at `docs/legacy-classification.md`: R0's
  commit (`ad31de8`) adds it at `docs/reclamation/`, because the move was folded into the
  four-commit split. The rename itself is in the pre-split history (`backup/final-tree-2026-10-07`,
  `4531a63`, R100). Every reference points at the new path.
- **Phone width (375px).** Three defects were found, live, and fixed:
  1. **Header overlap.** The app header's right group could not shrink, so the organisation, the
     vetting pill and the account button covered the product mark and the palette button. The
     header now wraps, as the case header does, and the organisation's name truncates.
  2. **Members and Settings unreachable.** The side navigation is not drawn below `md`. The same
     destinations are now a plain row of tab links under the header: the existing TabBar and
     TabLink, one shared list with the side navigation, and no navigation sheet.
  3. **Sideways scroll on Evidence and Entities** (613-728 wide at 375). A header's visually
     hidden label is absolutely placed and escaped the table's own scrolling. The scroll
     container is now positioned.
  - Each fix has a regression test that fails without it (three tests).
  - Re-checked live:
    - every route at 375 in both themes, plus sign-in, the challenge and enrolment: no sideways
      scroll;
    - every control on every route tappable at 375, 768, 1024 and 1440;
    - the phone reaches the same destinations as the desktop.
  - A run is reached by starting a search, and the organisation chooser only when there are two
    organisations, at every width.

**Written** (`docs/reclamation/`):
- `R1-INVENTORY.md`: all 224 exports of `legacy/src/utils/cases/` (15 files, 5,262 lines, each
  read in full).
  - Verdicts: PORT-AS-IS 7, PORT-ADAPTED 76, REWRITE 27, DROP 109, NEEDS-DECISION 5. Ten rows
    not marked DROP are not ported (nine already built here, one with no consumer).
  - Reconciled with R0: all 86 R0 rows match, with the same bins; the other 138 are types,
    interfaces and constants, which R0 does not bin.
  - Every REWRITE quote is verbatim, with its line checked by script.
- `R1-HONESTY.md`: 26 capabilities, seven questions each. None ships as legacy computed it.
- `R1-PLAN.md`:
  - six sub-stages, R1-a to R1-f (the engine, persistence and the job, cross-intelligence,
    contradictions, the UI, the written summary);
  - the 17 standing rules;
  - decisions D-1 to D-28 for the owner;
  - an appendix routing all 115 rows not dropped to a stage, a later phase or a decision.
  - Credibility is moved to R2, as the build sequence says.

**Review.** An independent critic checked about 90 quotes, all 224 rows and about 40 claims about
our code. It found 24 problems, two of them high, all fixed:
- **The person gate:** a case analysis must also gate on every run that contributed to the case
  (a run that used a person collector is person data whatever it found).
- **Freshness:** the analysis is keyed on everything it read, not on the pin set, because new runs
  add claims to entities already pinned.

The others were verdict and routing inconsistencies, missing decisions, and wording errors.

**Re-check.** A second, independent pass confirmed 20 of the 24 fixed and 3 partly. It found 19
smaller problems, all fixed, chief among them:
- **A stored analysis is gated on what it read,** not only on the case as it is now.
- **A job-time person re-check (D-28) would amend CLAUDE.md §9's wording,** so it is raised for
  the owner.

**Found, not fixed** (raised in R1-PLAN):
- the entity-merge routes call no person gate (D-10);
- the fabrication gate does not flag `?? ""` (D-14).

**Checkpoint** (`pnpm turbo lint typecheck test --force`, 50 of 50 tasks, nothing cached,
fabrication check clean on 447 files, with Postgres and Redis up): core 20, access 56, config
188, db 264, integrations 122, collectors 482, llm 130, osint-engine 104, api 184, ui 95, web
177, worker 4 (1,826 tests; 3 more than U1-c, the phone-width regression tests).

**Closed 2026-10-08 on the owner's review.** The rulings are recorded at the top of
`docs/reclamation/R1-PLAN.md`.
- **Accepted:** D-1, D-2, D-3, D-5, D-14, D-19, D-20 and D-28; credibility moves to R2; the
  model summary is its own stage (R1-f).
- **Conditions:**
  - D-1's move of the coverage helpers is a pure move, proven by an identical-output test.
  - D-14's gate change is its own commit, and every flagged file is rewritten, with no
    allowlist.
- **D-10** is fixed next, before R1-a.
- **Every other decision is held** for the owner's review.

## D-10: the person gate on entity merges, and the route audit (2026-10-08)

**The brief.** Close the person-gate hole on `/api/v1/entity-merges` with the shared gate only;
refuse whole, never thin; keep SESSION_REQUIRED on the mutations; audit every other route that
returns or accepts entities, relationships, claims, pins or case data, fixing further small gaps
the same way and reporting the rest; release-blocking tests that fail on the old code.

**What leaked** (verified by tests against the old code):
- `GET /api/v1/entity-merges` listed merge decisions on entities resting on person evidence: both
  entity ids, the kind and the analyst's free-text reason. With `?entityId` it also said whether a
  person entity had any merge.
- `POST /api/v1/entity-merges` let a locked tenant merge person-data entities, changing how they
  are presented, and returned the merge record.
- `POST /api/v1/entity-merges/:id/undo` let a locked tenant undo such a merge and returned it.

**Fixed.**
- **The merge routes:**
  - **List:** probes both sides of every merge it fetches, and the entity asked about even when
    it has none.
  - **Create and undo:** probe both entities after the session check and before anything changes.
- **Four further gaps from the audit:**
  - **Case pins list:** now probes every pinned entity and both ends of every pinned relationship,
    across the whole case, not only the page.
  - **Entity detail:** probes its merge partners and its survivor.
  - **Graph:** probes the survivor each merged node names.
  - **Run progress stream:** each poll reads first, then probes, so a person job committed between
    the two never reaches a locked tenant.
- **From the review:**
  - **Entity list:** probes the survivor its rows name.
  - **Lists:** the entity, candidate and merge lists probe the row past the page that decides
    `hasMore`.
  - **Detail reads:** entity and relationship detail read their claims before the probe.
  - **Large probes:** the shared gate splits a probe of more than 1000 ids into parts, so a large
    read is decided, never answered 500.

**Supersedes** the Phase 6a line that listed entity merges as not gated (above, "Not gated (no
claim or evidence content)").

**Raised, not fixed** (R1-PLAN.md, D-29 to D-32):
- merge partners in the probe;
- replay of a person run's job, which reverses a Phase 6a ruling;
- where a refusal falls in a paged list;
- a case scope that changes between read and probe.

**Guard.** `person-gate-guard` now classifies every API route, file by file. A gated route's own
registration call must await the shared gate; any other states why it need not. Every route
file is scanned or says why not.

**Tests** (release-blocking), in `apps/api/test/person-gate.test.ts`:
- **Coverage:** every merge route, both sides of a merge, and each further gap.
- **Behaviour asserted:** a locked tenant is refused whole with no thinned body; an allowed one
  is unchanged; refused mutations change nothing; an API key still meets SESSION_REQUIRED first.
- **Old-code proof:** each test failed on the code before its fix, shown by removing each fix in
  turn.

**Review:** three lenses, each finding verified adversarially. Nineteen findings stood; all
fixed or raised.

**Checkpoint** (`pnpm turbo lint typecheck test --force`, 50 of 50 tasks, nothing cached,
fabrication check clean on 447 files, with Postgres and Redis up): core 20, access 56, config
194, db 264, integrations 122, collectors 482, llm 130, osint-engine 104, api 189, ui 95, web
177, worker 4 (1,837 tests; 11 more than R1-0: config 6, api 5).

## D-10b: probe merge partners, gate job replay (2026-10-08)

**The rulings** (the owner, on the items D-10 raised): D-29 and D-30 accepted, built here as one
commit. D-31 accepted with changes and not built yet (a cheaper option raised first, as the
ruling asked). D-32 folded into R1-b as its prerequisite. Recorded at the top of
`docs/reclamation/R1-PLAN.md`.

**D-29.** The shared probe (`touchesPersonData`) follows active merges.
- **What it covers:** an entity the probe names brings every entity an active merge joins it
  to, in either direction and through chains. An undone merge joins nothing.
- **Effect:**
  - the entity list's merge count no longer passes a locked tenant when a merged-in entity
    rests on person evidence;
  - a merge request naming an entity already merged into one is refused (403) before the merge
    rules can answer 409.
- **Accepted cost:** reads that show no merge field (relationship detail, merge candidates) are
  refused too when a merge partner rests on person evidence.

**D-30.** `POST /api/v1/jobs/:id/replay` is gated with the job's run (`runJobs`), before the
replayer starts its own transaction.
- **Why:** a replay re-queues person collection and rewrites the job's and the run's recorded
  state, so the gate has to come first.
- **Recorded:** the reversal of the Phase 6a ruling, and its reason, is in
  `docs/ARCHITECTURE-DECISIONS.md` §6. The route is now "shared-gate" in the guard.

**Tests** (release-blocking):
- **Probe (database level):** the probe follows active merges either way and through chains,
  never undone ones, and only in its own tenant.
- **Gate suite, through the lifecycle:**
  - the entity list of a run whose entity has a person-evidence entity merged in;
  - a merge naming an entity beside one already merged into a person-evidence entity (403 when
    locked, still 409 when allowed);
  - a locked tenant's replay of a person job is refused, and the job and its run are unchanged,
    its recorded failure included;
  - an allowed replay still re-queues.
- **Old-code proof:** each test failed on the code before its fix, shown by removing the probe
  change and the gate in turn.

**Checkpoint** (`pnpm turbo lint typecheck test --force`, 50 of 50 tasks, nothing cached,
fabrication check clean on 447 files, with Postgres and Redis up): core 20, access 56, config
194, db 265, integrations 122, collectors 482, llm 130, osint-engine 104, api 189, ui 95, web
177, worker 4 (1,838 tests; one more than D-10, the probe's merge test; the API's new checks
sit inside its existing lifecycle tests).

## D-10c: probe the whole scope in SQL (2026-10-08)

**The ruling** (D-31, the cheaper option): the entity list and merge candidates probe the whole
scope in one SQL query; the merge list keeps a fixed window; the graph probes its whole
hops-bounded neighbourhood in SQL, whatever `maxNodes` asks; if that is costly at three hops,
raise it, never fall back to a window.

**Built.**
- **The shared probe** (`touchesPersonData`) takes `scopeEntities: { scope, hops }`.
  - What it covers: every entity in the scope, and with hops, every entity that many
    relationships away, walked as the graph store walks.
  - Each entity brings its merge partners (D-29).
  - The entity set is computed once, in one recursive query.
- **Callers.**
  - The entity list and merge candidates pass the scope at 0 hops.
  - The graph passes its own hop limit.
  - The merge list reads and probes a fixed window: the largest page (`LIMIT_MAX`, 500) and the
    row past it, whatever `limit` asks. A merge past the window is neither shown nor probed.
    The residual is accepted: a refusal can rest on a row the page does not hold.
- **A defect found and fixed on the way.** D-10's `probeParts` rebuilt each part field by field
  and dropped the new field, so the whole-scope probe vanished on the API path. The first part
  now keeps every field, and a unit test holds it.

**Cost at three hops (raised, D-33).** Measured on one machine, on a synthetic tenant shaped
like TECHINT data: domains, subdomains, shared nameservers and addresses, with a claim on every
entity and relationship. It is the worst case: person evidence exists in the tenant but none is
reachable, so the whole walk runs. The probe runs only for a tenant without person access.

| Tenant | Hops | Entities reached | Probe as first written | Probe as built (two-way edges) | Existing graph read |
|---|---|---|---|---|---|
| 125k entities, 260k relationships, 385k claims | 0 / 1 / 2 / 3 | 6 / 14 / 3,144 / 18,901 | 198 / 614 / 1,086 ms / over 15 s (statement timeout) | 94 / 336 / 621 / 802 ms | 0.7 to 0.9 s / 2.0 to 2.4 s / over 15 s / over 15 s |
| 12.5k entities, 26k relationships, 38.5k claims | 0 / 1 / 2 / 3 | 6 / 14 / 444 / 2,026 | not measured in the worst case | not measured in the worst case | 0.1 / 0.2 / 2.9 / 4.7 s |

The first version tested `source = x or target = x` row by row. The probe as built lists each
relationship both ways, so every step is a join Postgres can hash. The existing graph read walks
the old way and times out at two hops on the larger tenant; that predates this change and is
raised with it.

**Tests** (release-blocking):
- **Probe (database level):** whole scope versus scope evidence, a neighbour at each hop limit,
  the hop bound, and another tenant learning nothing.
- **Gate lifecycle:**
  - an entity list and a candidate list whose person data sits past the page;
  - a merge list whose undone person merge sits past the page;
  - a graph whose person neighbour lies past the node cap.
- **Unit:** the probe split keeps every field.
- **Old-code proof:** each test failed on the code before its fix, shown by restoring each
  route's earlier probe and the earlier split in turn.

**Checkpoint** (`pnpm turbo lint typecheck test --force`, 50 of 50 tasks, nothing cached,
fabrication check clean on 448 files, with Postgres and Redis up): core 20, access 56, config
201, db 266, integrations 122, collectors 482, llm 130, osint-engine 104, api 190, ui 95, web
177, worker 4 (1,847 tests).
- **This change:** db 1 and api 1.
- **Not this change:** config 7 and the 448th scanned file are an uncommitted `.gitignore` test
  in the working tree, made outside this change; it is not part of this commit.

## R1-0: rulings recorded (2026-10-08)

**Every R1 decision is now ruled.** D-1 to D-33 are marked in `docs/reclamation/R1-PLAN.md`,
beside each heading, except D-33, which D-10c raised and which is open.
- **Ruled in the last round:** D-4, D-6, D-7, D-8 (deferred with retention), D-9, D-11 to
  D-13, D-15 to D-18, D-21 to D-27, and D-2's related option (merge candidates relabelled
  HYPOTHESIS, in R1-e).
- **D-17's conditions, met:**
  - each DROP that server-side storage or code already here replaced names the file that
    replaced it (100 of the 109 DROP rows; the other nine are dead code, UI copy for legacy
    pages, demo data, or a transport R1-f builds anew);
  - `docs/audit/INVENTORY.md` points to R1-INVENTORY.md for `cases/`.
- **D-23:** recorded in `docs/ARCHITECTURE-DECISIONS.md` §5. Locations join the
  no-merge-by-name rule; it is enforced when R3 creates them.
- **D-22's final wording** (the reworded caveat and the two limitation lists) went to the owner
  before any commit, as ruled.

R1-a waits for its prompt.

## R1-a: the case engine, pure (2026-10-09)

**`packages/case-engine` exists, and is pure.** It has no database, API, queue or UI, and adds
no dependency. It builds a case's coverage, the shared per-collector view and the discipline
breakdown, over plain data. The run report's coverage moved into it unchanged.

- **Baseline (47d3cb2).** Golden files under `packages/osint-engine/test/golden/` capture the
  output of the run report's coverage functions, written from the code before anything moved:
  - functions: `coverageOf`, `coverageFromJob`, `headline`, `COVERAGE_CAVEATS`, `displayValue`;
  - fixtures: empty runs, a partial run, failed collectors, held collectors, nulls, unicode,
    and a run of 420 jobs.
  - **Comparison:** the test compares byte for byte.
  - **Rewrites:** a golden file is rewritten only by `WRITE_GOLDEN=1`, and that run always
    fails.
  - **Formatting:** the directory is excluded from formatting.
- **Move (47c7db0).** A pure move, over plain data types (owner ruling D-1):
  - **What moved:** the coverage functions (`coverageFromJob`, `coverageHeadline`,
    `runCoverage`, `sourceLabelOf`), `COVERAGE_CAVEATS` and `displayValue`.
  - **What stayed in `assemble.ts`:** the zod parse of the stored plan, a `coverageOf` with its
    old signature, and re-exports.
  - **Proof:** the golden test passes unchanged, and fails on each of five mutations of the
    moved code.
  - **Registration:** CLAUDE.md §6, `check-exports.ts` and `boundaries.test.ts` gained the
    package.
- **Build.**
  - **Functions:**
    - `caseCoverage`: the runs derived from pins (D-4), each named with its investigation and
      its coverage recomputed by the run report's own function. It adds what of each job's
      evidence is in the case ("collected but not pinned"), evidence with no recorded
      collection job (counted, by collector), and collection and observation spans kept
      apart.
    - `caseCollectors`: the shared per-collector view for R1-c and R1-d.
    - `caseBreakdown`: per discipline:
      - counts of evidence, claims, entities and relationships, each with its ids, and by
        recorded strength;
      - collectors grouped as ran, found something, found nothing, failed, not finished,
        locked, excluded, not applicable, held (with the reason) and in no run;
      - the previous codebase's further figures, each null with the input it needs.
  - **Empty case:** a case with no records gets an explicit `EMPTY_CASE` document.
  - **Absences:** anything unmeasurable is null with a reason, never 0.
  - **Input that contradicts itself is refused whole** (`CaseInputError`,
    `CASE_INPUT_INVALID`, every problem named in a fixed order). It is never thinned.
  - **Version:** `ENGINE_VERSION` (1) is stamped on every document.
- **Purity, two layers:**
  - **Lint on `src/`:** imports only `@repo/core` and its own files. No clock, randomness,
    process, environment, network, timers, `import.meta`, `console`, locale formatting, or
    `Math` passed on.
  - **`test/purity.test.ts`:** reads the source with the TypeScript parser and checks the
    same, with a self-test that it finds each impurity.
- **Review.** Three independent critics (honesty and the rules; correctness, determinism and
  purity; plan and inventory conformance), two passes each.
  - **The first pass found:**
    - today's held list was applied to old runs, so a collector showed COLLECTED and HELD in
      one run;
    - a lock refused at dispatch was filed as ran and failed;
    - contradictory input was accepted;
    - nested lists leaked their order;
    - holes in both purity layers;
    - an unapproved headline in legacy wording;
    - a CLAUDE.md line wider than the plan.
  - **The second pass found:**
    - one job labelled two ways;
    - a sort tie;
    - a status rule counting unfinished jobs;
    - `Math` reachable through an alias;
    - a FOUND job with no evidence list.

  All fixed. Every guarantee has a mutation that breaks it and a test that then fails: 34 of
  34 caught.

**Pipeline:** 54 of 54 tasks; the fabrication check is clean on 463 files, with no allowlist;
check-exports covers 151 symbols across 10 entry points.

| Package | Tests |
|---|---|
| collectors | 482 |
| db | 266 |
| config | 203 |
| api | 190 |
| web | 177 |
| llm | 130 |
| integrations | 122 |
| osint-engine | 109 (the golden test's 5 among them) |
| ui | 95 |
| access | 56 |
| case-engine | 55 |
| core | 20 |
| worker | 4 |
| **Total** | **1,909** |

Config's 203 includes 7 from an uncommitted `.gitignore` test in the working tree that is not
part of R1-a.

**Raised for the owner (not decided):**
1. **Wording.** The case documents' caveats and reasons are codes. The inventory asks for the
   legacy texts reworded (`TOTALS_OVERLAP`, `SILENT_MEANING`, `BREAKDOWN_CAVEATS`,
   `COMPLETENESS_CAVEATS[0]`), and the brief says no wording change, so none is written:
   - the drafts went to the owner;
   - as did the legacy `breakdownHeadline` text, whose first branch misleads when only
     unregistered collectors contributed. It is not shipped;
   - as did a case-level headline (R1-HONESTY's "aggregate statement"), also not built.
2. **D-3, where the canonical input hash is computed.** In `case-engine`, it needs a pure
   SHA-256 (no `node:crypto` under the purity rule). In R1-b's job, beside the database read
   that gathers the input. Or in `core`.
3. **The package's dependencies.** The brief says core only (enforced now). The plan puts
   R1-b's job processor in `case-engine/src/jobs` on core, db, llm and zod (and access under
   D-28). That widening needs a CLAUDE.md §6 change.
4. **Discipline statuses.**
   - **HELD is added:** a discipline whose only collectors are held, and none of whose jobs
     completed in the case's runs. Its counts are null, as for NOT_BUILT.
   - **NOT_CASE_SCOPED is not built:** nothing produces it in R1-a.
   - **An asymmetry, open:** a discipline whose registered collectors were all locked or
     excluded in every run is ZERO, a measured zero.
5. **`LOCK_REASONS`** (`MODULE_NOT_IN_PLAN`, `VETTING_NOT_APPROVED`) is a copy of
   `@repo/access`'s vocabulary, because core does not hold it. Moving it to core would let
   both share one list.
6. **Merges.** Active analyst merges (D-21) are not in `CaseInput`. R1-c and R1-d fold them;
   R1-b's input hash lists them.
7. **R1-b's input contract.** These refusals are new and refuse the whole analysis:
   - `INPUT_MISSING`
   - `HELD_AND_REGISTERED`
   - `FOUND_RESULT_NOT_RECORDED`
   - `EVIDENCE_NOT_IN_JOB_RESULT`
   - `JOB_EVIDENCE_ELSEWHERE`
   - `CLAIM_SUBJECT_MISSING`
   - `JOB_AND_EXCLUSION`

   So R1-b must bring every pinned claim's subject into the case, and pass each job's recorded
   evidence list.
   - **A path that breaks this:** `CollectionExecutor.collect` writes evidence carrying a job
     id without setting that job's evidence list. It has no production caller today.
8. **No evidence makes a case partial.** A case that holds records but no evidence is partial
   (`NO_EVIDENCE_IN_CASE`), because no collection can be named for it.
9. **A recomputed run's coverage can differ from a report stored earlier:**
   - a held collector the plan named is not listed as held;
   - a held collector is labelled with its declared name throughout;
   - a held entry's target type follows core's order;
   - entries are in a fixed order.

   The run report computes held entries against the held list at report time, so it shares the
   first effect if a collector is held after its run.
10. **Renames in the move.** `coverageOf` is `runCoverage`, `headline` is `coverageHeadline`,
    and `sourceLabelOf` is public. `assemble.ts` keeps the old names.
11. **Behaviour the pure move preserved:**
    - `displayValue(undefined)` throws;
    - truncation can split a surrogate pair;
    - headlines read "all 0 planned collectors" and "1 planned collectors".
12. **A missing field inside a record** (for example a run's `plan`) still fails with an uncoded
    `TypeError`. The types forbid it; only top-level presence is checked.

## R1-a: rulings recorded (2026-10-09)

R1-a was approved, and every item it raised is ruled. The rulings are recorded in
`docs/reclamation/R1-PLAN.md` (Owner's rulings) and beside D-1, D-3 and D-21 there.

- **D-1's processor clause is superseded:** `case-engine` stays pure, on `core` only, and its
  job processor goes in `apps/worker` or a thin package depending on `case-engine`, `db`, `llm`
  and `access`. CLAUDE.md §6 and `boundaries.test.ts` now state "core only" as permanent.
- **D-3's input hash** is computed in R1-b's job. **Merges** (D-21) go into R1-c's input.
  **R1-b's input contract**, the seven refusals R1-a added, is accepted.
- **Follow-ups, each in its own commit:**
  - the lock reasons move to `core`;
  - a discipline whose collectors were all locked is null with the reason `LOCKED`;
  - the approved caveat wording and the breakdown headline;
  - `CollectionExecutor.collect` refuses a request inside a job;
  - the display fixes, as a behaviour change with updated golden files;
  - a clear failure when the test database is unreachable.

## R1-b: persistence, the analysis job, three endpoints, the person gate over a case (2026-10-09)

A case's analysis can be requested, is made in the background from the case's stored records, is
recorded once, and is read with its state. No UI, no model call, no cross-intelligence and no
contradictions. R1-c is not started. Commits: A e4ea3f8, B be77d4e, D 926de9d (built before C, as
D-32 is C's prerequisite), C b7aeee2, E/F 1c77eb8, review fixes ddf2c97 and 76675e0.

- **A. `case_analyses`, written once** (migrations 0021, 0022; 0023 from the review).
  - **The analysis:** one row per tenant, case and input hash (unique). Where it stands is a
    second, append-only table, `case_analysis_events`:
    - each attempt is requested (PENDING), then finishes once;
    - a finish is COMPLETE, with the document and the wording it was made under, or FAILED, with
      a code and a message;
    - a failed analysis gets a new attempt, and nothing follows a document.
  - **The database's guarantees:**
    - forced RLS with the canonical tenant policy on both tables;
    - `app_runtime` holds SELECT and INSERT only;
    - statement-level triggers refuse UPDATE and TRUNCATE to every role, the owner included
      (CAN01);
    - an AFTER INSERT trigger refuses an event out of order (CAN02);
    - partial unique indexes allow one request and one finish per attempt, and one document per
      analysis.
  - **Deletion:** DELETE is not refused, so the future retention path is never blocked (tested
    as the owner).
  - **The basis (0023):** records what each analysis rests on, the evidence and run ids of its
    input, with the request. Its columns are nullable for expand-safety; a read refuses a row
    without one.
- **B. The input and its hash.**
  - **The read:** `CaseScopeRepository.records` reads the case as D-4 defines it.
  - **The hash:** `caseInputHash` is SHA-256 over a canonical form (sorted keys and lists, null
    kept apart from absent) of:
    - the input, with a case id spelled in capitals read as the stored id;
    - the active merge ids (R1-c folds them);
    - the engine version and the wording.
- **C. The job.**
  - **Where it lives:** `CaseAnalysisProcessor` (`packages/osint-engine/src/jobs`), injected by
    the worker.
  - **The queue:** `case-analyses`, with its own global bulkhead (`CASE_ANALYSIS_CONCURRENCY`),
    a per-attempt timeout (`CASE_ANALYSIS_TIMEOUT_MS`) and dead-letter kind `CASE_ANALYSIS`.
  - **Idempotency:** keyed by the analysis (case and input hash) and the attempt. A replay or a
    concurrent delivery records once.
  - **Each refusal fails the attempt whole:**
    - the seven input refusals (CASE_INPUT_INVALID);
    - CASE_INPUT_CHANGED;
    - CASE_TOO_LARGE, counted in the database before anything is read (bound 50,000 records);
    - CASE_ANALYSIS_TIMEOUT;
    - CASE_DOCUMENT_INVALID (the document is validated against its zod schema before it is
      recorded);
    - the gate's codes.
  - **Dead letters:** the record is written whatever the cleanup does, for every kind, one per
    final failure. Enqueueing a pending attempt whose job was kept as failed delivers it again.
  - **Passive:** an allowlist module-graph test (zod and `node:crypto` only outside the repo)
    refuses any other module and any load it cannot follow.
- **D. The person gate.**
  - **D-19:** the probe takes a list of runs.
  - **D-28:** `personGate` in `packages/access` is the one decision. The API's helpers call it,
    and the job calls it before it reads the case's records.
  - **D-32:** `withTenant(..., { snapshot: true })` runs each gated read in a repeatable-read
    transaction:
    - one retry on a serialisation conflict, then 409 SNAPSHOT_CONFLICT;
    - the guard requires a snapshot on every gated GET.
- **E/F. Endpoints** (contract 0.4.0).
  - **The routes:**
    - `POST /api/v1/cases/:id/analyses` (case:analyse) answers a summary without the documents;
    - `GET /api/v1/cases/:id/analyses` and `GET /api/v1/case-analyses/:id` (case:read) answer
      the analysis with its documents.
  - **The gate:** all three are shared-gate, on one snapshot. A stored analysis is probed by its
    basis, whatever its status, as well as by the case as it is now.
  - **Read states:** NONE_YET, PENDING, COMPLETE, FAILED (with its code) and STALE, each with a
    reason, and none claims progress that was not measured.
  - **Credits:** `estimatedCredits` is null, with its reason, and no usage event is recorded.
- **Review.** Two passes, each by three critics (data and migration; gate and concurrency; API
  and contract), with each finding adversarially verified:
  - first pass: 7 confirmed, 1 plausible and 2 refuted;
  - second pass: 8 confirmed (one defect found twice).
  - Every confirmed and plausible finding is fixed, each with a test that fails when its fix is
    removed.
- **Pipeline after R1-b.** 54 tasks; 2,024 tests:
  - core 25, access 59, config 205, case-engine 62, collectors 482, llm 130, integrations 122,
    db 289, osint-engine 154, worker 4, api 220, ui 95, web 177.
  - The fabrication check is clean over 489 files, with no allowlist. No dependency was added.
- **Raised, for the owner's ruling:**
  - **Retention:** analyses hold entity values, so they must go where their evidence goes.
    - Recommended: a tenant deletion removes them, events first; deleting evidence removes every
      analysis whose recorded basis lists it; there is no time-based expiry.
    - Today, no deletion path exists and nothing is enforced.
  - **Status as appended rows:** built as a separate append-only events table. This keeps
    `case_analyses` unique per input, and no row is ever rewritten.
  - **Permission:** `case:analyse` (TECHINT; analyst, admin and owner) to request; `case:read` to
    read.
  - **API keys:** allowed when scoped. The issuer is recorded as the requester, and a request
    never answers the documents.
  - **The processor's home:** `packages/osint-engine`. The brief chose it, but it is neither
    option the R1-a ruling named.
  - **The development seed:** it writes evidence that its job's result does not list, so an
    analysis of a seeded case fails as CASE_INPUT_INVALID.
  - **The size bound:** 50,000 records, not configurable. A read of a case past it answers 409,
    so its earlier analyses cannot be read until it shrinks.
  - **Cost of freshness:** every GET reads and hashes the case to judge freshness.
  - **Archived cases:** can be analysed.
  - **Deterministic failures:** a failed analysis with a deterministic code is retried on request
    and fails the same way.
  - **Unbounded enqueues elsewhere:** the run and report routes still enqueue without a bound.
  - **Report generation:** it does not re-check the gate (the D-28 follow-up).
- **Awaiting the owner's approval, uncommitted:** the CLAUDE.md §9 sentence and standing rule 6,
  amended for D-28.

## D-33: graph walk and indexes (2026-10-13)

**The ruling** (D-33, accepted 2026-10-11): walk the graph store as the probe does, add the two
indexes in a forward-only migration, re-measure at the same synthetic size, and commit the
numbers, before R1-c.

**Built.**
- **The graph store's walk** (`PostgresGraphStore.neighbourhood`) now lists each relationship
  both ways and steps by one equality join, as the person probe does. Before, it tested
  `source = x or target = x` row by row. The result is unchanged: each entity at its nearest
  hop, the same order, the same node cap. The graph store's tests pass unchanged.
- **Migration 0024** adds `entity_relationships (tenant_id, target_entity_id)` and
  `claims (tenant_id, relationship_id)`. It is a plain CREATE INDEX: the migrator runs in a
  transaction, where CONCURRENTLY is not allowed, as in every index migration here. Writes to
  the two tables wait while each builds. A schema test pins both indexes.

**Re-measured** on one machine, on a synthetic TECHINT-shaped tenant of D-10c's size: 125,001
entities, 260,000 relationships and 385,001 claims. D-10c's generator was not kept, so a new one
was written, outside the repository:
- 25,000 domains, each with two subdomains, its own nameserver, one of 8 hub nameservers (each
  shared by 3,125 domains) and an address;
- each subdomain resolves to two addresses, and each nameserver to one;
- 10,000 mail links;
- a claim on every entity and every relationship, citing 1,000 evidence rows;
- one PERSON entity with person evidence that nothing reaches, so the probe walks everything
  (the worst case).

The seeds are the six entities a case pins: a domain, its two subdomains, its own nameserver and
two addresses. They reach 6 / 14 / 3,151 / 18,796 entities at 0 / 1 / 2 / 3 hops, against
D-10c's 6 / 14 / 3,144 / 18,901. Each figure below is three runs, in milliseconds, with a 15 s
statement timeout.

| What is timed | Hops 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| The walk alone, old, without the indexes | 266 to 476 | 493 to 645 | 581 to 710 | over 15 s |
| The walk alone, new, without the indexes | 46 to 58 | 97 to 217 | 207 to 389 | 401 to 514 |
| The walk alone, old, with the indexes | 10 to 12 | 9 to 10 | 34 to 50 | 119 to 242 |
| The walk alone, new, with the indexes | 31 to 76 | 210 to 221 | 189 to 242 | 427 to 518 |
| The graph store as the API calls it (new walk, edges and claim counts), without the indexes | 647 to 843 | 1,717 to 1,899 | over 15 s | not run |
| The graph store as the API calls it, with the indexes (0024) | 63 to 123 | 79 to 150 | 176 to 294 | 303 to 575 |
| The person probe as built, without the indexes | 1,791 to 2,409 | over 15 s | over 15 s | over 15 s |
| The person probe as built, with the indexes | 1,772 to 1,933 | over 15 s | over 15 s | over 15 s |

Notes on the table:
- **Agreement.** The old and new walks returned the same nodes at the same hops wherever both
  finished: hops 0 to 2 without the indexes, and 0 to 3 with them.
- **Index builds.** At this size, `entity_relationships_target_idx` built in 375 ms and
  `claims_relationship_idx` in 447 ms.

**What the numbers show.**
- **The graph store now answers at every hop:** under 0.6 s at three hops, where it timed out at
  two (D-10c).
- **The claims index is what bounds the edges step.** Without it, the store timed out at two
  hops counting each edge's claims, even with the new walk.
- **With the target index, the old walk is faster than the new one at every hop.** The index lets
  Postgres answer `source = x or target = x` with two index scans. The walk as ruled reads every
  relationship twice in each query (520,000 rows) and does not use the indexes. Raised as D-36.
- **The person probe times out from one hop, with or without the indexes.** The graph read calls
  the probe for every tenant without person access, so on a tenant this size the graph cannot be
  read past 0 hops until the probe is fixed. Raised as D-35.
  - **The cause.** Its last step finds claims on relationships touching the walked entities with
    `source in (linked) or target in (linked)`, which Postgres runs as a per-row subplan over
    every relationship.
  - **A tried rewrite.** That step written as two joins (not built: evidence for D-35) finishes
    in 2.9 to 3.7 / 3.8 to 4.1 / 4.1 to 4.2 / 3.5 to 3.7 s, and still finds no person data.
  - **Against D-10c.** D-10c recorded the probe at 94 to 802 ms on its own tenant. Its generator
    was not kept, so the difference cannot be traced to the data or to the code.

## R1-b: rulings carried out (2026-10-13)

The owner approved R1-b and ruled on what it raised (recorded in
`docs/reclamation/R1-PLAN.md`, Owner's rulings). Carried out, each in its own commit:

- **2da4572** The person-gate amendments: CLAUDE.md §9 and standing rule 6, with D-34 for report
  generation.
- **98cb450** The worker installs `@repo/osint-engine` at runtime. A guard checks that what the
  API and the worker load at runtime is a runtime dependency.
- **fca803e** The last two planned-collector wording leftovers. A PARTIAL run that planned
  nothing says NOTHING PLANNED, and "1 further collector was" agrees in number. Golden diff of 9
  lines; ENGINE_VERSION 4.
- **bd83d11** Every enqueue is bounded at 5 s and gives up with QUEUE_UNAVAILABLE. The API's 503
  answers say what was recorded.
- **c5f69dc** A failure the same inputs repeat (CASE_INPUT_INVALID) is returned with 200, and no
  new attempt is made.
- **bfa1805** The development seed lists each job's evidence, so its cases can be analysed.
- **d3baa8c** Rulings recorded:
  - retention and case deletion, in ARCHITECTURE-DECISIONS.md §5;
  - the analysis limits, in §6;
  - the R1-b sub-stage, rewritten to describe what was built.
- **0e42d8d** D-33: the graph walk and indexes, re-measured above. It raised D-35 and D-36.

Raised again, awaiting a ruling: analysing an archived case (recommended: refuse), and BLOCKED
and NOT_IMPLEMENTED registry entries counted as registered (recommended: exclude them from what
can run, keeping their label). Also open: D-35 (the probe's cost) and D-36 (which walk to keep).

**Pipeline** (`pnpm turbo lint typecheck test`): 54 of 54 tasks, 2,038 tests. The fabrication
check is clean on 491 files.

| Package | Tests | Package | Tests |
|---|---|---|---|
| core | 25 | osint-engine | 160 |
| access | 59 | worker | 4 |
| config | 207 | api | 223 |
| case-engine | 63 | ui | 95 |
| collectors | 482 | web | 177 |
| llm | 130 | integrations | 122 |
| db | 291 | | |

## D-35 and D-36: the person probe and the shared walk (2026-10-13)

**The rulings** (2026-10-13, recorded in `docs/reclamation/R1-PLAN.md`):
- Fix both properly, in their own commit, before R1-c, with no depth cap.
- Decide the walk with the check, so the graph read and the person check walk the same way.
- Aim well below 3 to 4 s on the 125k-entity tenant. Consider computing reachability once per
  tenant state, and raise any schema change first.

**Built.** There is no schema change and no depth cap.
- **One walk (D-36).** `reachCte` in `packages/db/src/repositories/walk.ts` is the only walk.
  The graph store and the probe both take theirs from it.
  - Each step makes two index lookups per entity: one by source, through the unique key, and one
    by target, through migration 0024's index.
  - It replaces D-33's listing of every relationship both ways, and reaches the same entities.
- **The probe's check (D-35).** The question is unchanged: does any claim about a walked entity,
  or about a relationship one of them is at either end of, cite person evidence?
  - It now computes the walked set once, then the relationships around it (two index lookups per
    entity).
  - It then reads the claims citing person evidence and tests each against those two sets as
    hashes.
  - Computing each set once stops the planner turning a step into one subplan per relationship.
    That subplan is what timed out from one hop (D-33).
- **JIT off for the probe's statement,** put back after it.
  - The planner's estimate of a walk bears no relation to its size. Past `jit_above_cost`,
    Postgres compiles the statement before running it.
  - The probe before D-35 was estimated at about 2 million and compiled for 1 to 2 s.
  - The new one is estimated just under the threshold on this tenant, so a larger tenant would
    cross it.
  - JIT changes how a statement runs, never what it returns.
- **A case's claims** are read with two index-driven lookups (by pinned claim, by pinned
  evidence) instead of one scan testing both conditions.

**Considered, not built.**
- **Reachability once per tenant state.** A stored reach depends on the seeds and the hop limit,
  so it would have to be kept per case and per limit. Every new relationship or merge would
  invalidate it. Connected-component labels do not bound hops: the shared nameservers join
  nearly the whole graph. It is not needed at this size.
- **Person marks kept per tenant.** This would make the check cost only the walk, however much
  person data the tenant holds. It is a schema change, raised as D-37.
- **Starting from the person evidence.** This was the fastest shape when person data is rare,
  0.13 s at worst. It took 4 to 5 s on a tenant holding 100,000 person claims, so it was not
  built.

**Re-measured** on the D-33 tenant, the same synthetic size, on one machine:
- 125,001 entities, 260,000 relationships and 385,001 claims;
- one person entity that nothing reaches, so the whole walk runs;
- reach of 6 / 14 / 3,151 / 18,796 entities at 0 / 1 / 2 / 3 hops.

Then on a copy of it with 50,000 person entities, 49,999 relationships between them and 100,000
claims citing person evidence, none of which the case reaches. That is the worst case for the
new check. It might be a tenant that held person access and lost it.

Each figure is the range of three or six runs in milliseconds. Every run goes through the
application's own database access, with its 15 s statement timeout. "Old" is the code at 0e42d8d,
run as the database is configured (JIT on).

| What is timed | Hops 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| The probe, old | 1,936 to 2,509 | over 15 s | over 15 s | over 15 s |
| The probe, old, JIT off | 531 to 602 | over 15 s | over 15 s | over 15 s |
| The probe, new | 19 to 123 | 19 to 33 | 42 to 159 | 287 to 631 |
| The graph store, new | 11 to 20 | 6 to 18 | 30 to 130 | 98 to 244 |
| The walk alone: `source = x or target = x` (before D-33) | 2 to 6 | 3 to 4 | 21 to 35 | 61 to 99 |
| The walk alone: both ways (D-33) | 32 to 82 | 207 to 231 | 144 to 399 | 396 to 526 |
| The walk alone: `reachCte` (now) | 3 to 4 | 4 to 5 | 12 to 22 | 52 to 55 |
| With 100,000 unreachable person claims: the probe, old | 1,551 to 2,554 | over 15 s | over 15 s | over 15 s |
| The same: the probe, new | 91 to 96 | 86 to 124 | 195 to 212 | 543 to 603 |
| The same: the graph store, new | 17 to 25 | 11 | 70 to 129 | 153 to 274 |
| The same, with person data on a relationship at an entity first reached at hop 3: the probe, new | | | 168 to 305 (not held) | 377 to 596 (held) |

The three walks reached the same entities at every hop.

**Shapes of the check tried** (JIT off, the same walk, the slowest run at any hop):

| Shape | D-33 tenant | With 100,000 person claims |
|---|---|---|
| Person side: one index lookup per person claim | 131 | 5,057 |
| Person side: plain joins | 603 | over 15 s |
| Person side: each set computed once, then joined | 401 | over 15 s |
| Person side: each set computed once, the walked set hashed | 515 | 789 |
| Person side: each person relationship's ends looked up | 1,079 | 2,301 |
| Walk side: one test per kind of claim | 1,009 | 2,323 |
| Walk side: every claim around the walked set listed | 1,007 | 1,205 |
| Walk side: each set computed once, then hashed (built) | 554 | 703 |

"Person side" starts from the person evidence, and "walk side" from the walked entities. Two
shapes stayed under a second on both tenants. The built one was also the fastest of all eight
at 0 to 2 hops on the D-33 tenant.

**The gap with D-10c's figure.** D-10c recorded this probe at 94 / 336 / 621 / 802 ms at 0 to 3
hops, on a tenant of this size. D-33 measured the same code at 1.8 to 2.4 s at 0 hops, and over
15 s from one hop. The gap is partly explained:
- **At 0 hops, by JIT.** With JIT off, the same code answers in 0.53 to 0.60 s, inside D-10c's
  range. With it on, it spends 1 to 2 s compiling first. Whether D-10c's server compiled cannot
  be checked.
- **In part, by statistics.** The old probe is slow only once the planner has statistics. On a
  graph of 1,000 domains (2,012 entities) probed straight after it was built, before autovacuum
  had analysed it, it answered in 35 to 116 ms. After ANALYZE it took 0.3 to 0.4 s with JIT off,
  and about 2 s with it. At 3,000 domains it took 48 to 56 ms before ANALYZE, and 1.3 to 3.9 s
  after it with JIT off.
- **From one hop at D-10c's size, it cannot be explained.**
  - Here the old probe runs out of time from one hop, with or without JIT and with or without
    statistics.
  - Its relationship step, `source in (linked) or target in (linked)`, runs as one subplan per
    relationship. The planner estimates the walked set at 116 billion rows, so it never builds a
    hash of it, even with `work_mem` at 1 GB.
  - D-10c's figures need a plan that hashed that step. D-10c's generator and data were not kept,
    so what made its planner do so cannot be found.

**Tests** (release-blocking):
- **The graph.** `buildProbeGraph` in `@repo/db/testing` builds the graph both new test files
  use. It is a tenant on which the old probe took 5 to 14 s with JIT off:
  - 6,000 domains with 12,016 entities, 18,008 relationships and 30,026 claims, analysed as
    autovacuum would;
  - a chain from one case's pin to an entity three relationships out, which carries a person
    claim;
  - a chain from another case's pin to an entity three relationships out, a relationship at
    which carries a person claim.
- **Database level** (`person-probe-depth.test.ts`, 5 tests, with a 2 s statement timeout):
  - person data three relationships out, on an entity and on a relationship, is held at 3 hops
    and never nearer;
  - the JIT setting is put back after the probe;
  - the graph store and the probe both take their walk from `reachCte`, and nothing else walks;
  - the graph's size is pinned.
- **API** (`person-gate-depth.test.ts`, 4 tests, with the application's statement timeout at 2 s;
  `createTestApi` takes the timeout as an option):
  - with no plan, and then with vetting pending, a locked tenant's graph read reaching that
    person data is refused whole: 403, the Locked detail complete, no nodes or edges, no person
    data in the refusal;
  - its read one hop shorter returns 200 with the whole graph;
  - once approved, the same short read returns the same body, byte for byte.
- **Old-code proof.** With `exploration.ts` and `graph.ts` restored from 6d50a8c, 4 of the 5
  database tests fail. The probes ran out of time, and the walk guard found the store's own walk.
  The size check passes; it does not use the probe. All 4 API tests fail: every locked read
  answered 500.

**Pipeline** (`pnpm turbo lint typecheck test --force`, in a clean worktree of this commit):
- 54 of 54 tasks, nothing cached, 2,042 tests;
- the fabrication check is clean on 493 files, and the export check passes.

| Package | Tests | Package | Tests |
|---|---|---|---|
| core | 25 | osint-engine | 161 |
| access | 59 | worker | 4 |
| config | 200 | api | 228 |
| case-engine | 63 | ui | 95 |
| collectors | 482 | web | 177 |
| llm | 130 | integrations | 122 |
| db | 296 | | |

Against the last record:
- **This change:** db +5 and api +4.
- **Archived cases (6d50a8c):** api +1 and osint-engine +1.
- **Config, 7 fewer:** the earlier run counted an uncommitted `.gitignore` test from the main
  working tree. A clean worktree does not have it.

**Raised.**
- **D-37:** person marks kept per tenant, a schema change.
- **D-38:** a statement that times out answers 500 `INTERNAL_ERROR`, as the old-code proof
  showed.

**Noted.** `packages/collectors/src/catalogue.ts` imports
`packages/collectors/src/data/rdap-registry-hosts.ts`, which has never been committed: the
committed `.gitignore` rule `data/` matches its folder. A fresh clone or worktree therefore cannot
build the collectors. It was copied in by hand for this work. The `.gitignore` files were left
alone, as ruled.

## Track M Day 1: TOPIC, person data whatever collects it (2026-10-15)

**The owner's instruction** (2026-10-15), which rules D-M1 (`docs/monitoring/MONITORING-PLAN.md`
§9):
- Add a TOPIC target type to the vocabulary and to target detection. Keep ambiguity as
  alternates; never guess it away.
- A run whose target is TOPIC is person-bearing at the run level, whichever collectors it uses,
  and the run records it so the gate can read it.
- The shared person gate treats any TOPIC run as person data, and refuses a whole read with 403
  and the Locked block. Planning a TOPIC run for an unentitled tenant is refused up front, as a
  person collector is.
- Fail closed on the target type, with no name detector. The person-gate guard covers TOPIC runs.
- The GDELT and RSS collectors, the monitoring page and the scheduler are later days.

**Pre-flight.**
- The outstanding R1 work was committed first (2c79c84), on the owner's instruction.
  - Its pipeline ran in a clean worktree with the R1 changes applied: 54 of 54 tasks, nothing
    cached, 2,067 tests; the fabrication check clean on 495 files.
  - In the main working tree the format check fails on the untracked `.claude/` folder, and the
    person-gate guard finds the gate's pieces in the copies under `.claude/worktrees/`. Neither
    is repository code, which is why pipelines are recorded in a clean worktree.
- The D-35 branch (`d35-probe`, c84f5a8) is already an ancestor of `main`: nothing to merge. Its
  worktree, `D:/vestigo-d35`, is clean and was left in place.
- The D-38 branch (`d38-statement-cancelled`, 5d1a417) is unmerged and was left parked.

**Built.**
- **Vocabulary and detection** (`packages/core`):
  - TOPIC is appended to `TARGET_TYPES`. Appending keeps every existing type's position, which
    a case analysis sorts by.
  - A hashtag (`#` and one word; letters, combining marks, digits or underscores, so Indic
    hashtags count) or a phrase in quotes is TOPIC.
  - Other words with spaces are ORGANIZATION first, with TOPIC as an alternate.
  - Bare words, short or long, are unchanged.
- **The rule** (`packages/access/src/person-target.ts`):
  - `PERSON_TARGET_TYPES = ["TOPIC"]`.
  - `plannedTargetTypes`: a person target type is planned only when it was chosen or detected
    first, never as an alternate, so an ordinary search never becomes person data unasked.
  - `runRestsOnPersonTarget`: the run plans a person target type.
  - `decideTargetAccess`: a person target type needs the person module's plan and approved
    vetting, whatever the collector's discipline.
- **Collection**:
  - The runtime's admission refuses a TOPIC target with MODULE_NOT_IN_PLAN or
    VETTING_NOT_APPROVED, after the discipline check.
  - The planner plans `plannedTargetTypes`, and records the detected alternates it did not plan
    in a new `notPlanned` list, each with its reason (`NOT_PLANNED_UNLESS_CHOSEN`).
  - `parseTarget` takes a TOPIC as typed, with its spacing made single, up to 300 characters.
  - Fusion refuses a TOPIC target as not implemented: no collector reads one yet.
- **The run's record** (`packages/db`, migrations 0025 and 0026):
  - `runs.person_bearing` is set by `RunsRepository.create` from the investigation's own target
    and the requested type, never from the caller. A run on an investigation the tenant does not
    hold fails on its foreign key, whatever type was chosen.
  - The application role has no UPDATE grant on it.
  - A check refuses a run that chose a person target type without it.
  - A trigger on jobs refuses a job on a person target type in a run without it (SQLSTATE
    PTT01, translated to `PersonTargetOutsidePersonRunError`).
    - The coordinator then FAILS the run, with that code in its plan, in a transaction of its
      own. The planning job dead-letters at once: no retry changes it.
    - Only a run queued before migration 0025 can reach this.
  - New index: `jobs (tenant_id, run_id)`, for the probe's run check.
- **The probe** (`ExplorationRepository.touchesPersonData`):
  - A person-bearing run is person data before it has any job.
  - Everything such a run collected is person evidence, from any collector. That covers its
    evidence, claims, entities, case pins, case scopes and neighbourhoods.
  - The person-evidence check of D-35 is unchanged, so the plan measured there stands.
  - A separate check reaches a person-bearing run's data from the claims or evidence ids the read
    names, by key, through evidence and job to run.
  - No sublink inside an OR grows with a run's jobs, and no evidence beyond what the read names is
    read.
- **The API**:
  - `POST /api/v1/investigations/:id/runs` creates the run, then calls `requirePersonAccess` on
    it before anything is queued.
  - Refused, the request's transaction rolls back: no run, nothing queued, and the audit row
    names no run.
  - `ROUTE_GATING` now classifies the route `shared-gate`.
  - The run plan's schema gains the optional `notPlanned` list. The estimate carries it too.
  - The estimates route's description says how TOPIC is refused.
- **The guard** (`packages/config/scripts/person-gate-guard.ts`) flags, outside the gate's
  homes:
  - a `decideTargetAccess` call;
  - a target type compared with TOPIC:
    - in code: either way round, a membership test, a query builder;
    - in SQL, by the value: either way round, wrapped, in an IN or ANY list, or a CASE;
  - a call of `targetRestsOnPersonData` or `runRestsOnPersonTarget`;
  - the list `PERSON_TARGET_TYPES` used as a value;
  - a decision on `person_bearing` or `personBearing`: a condition, a predicate, optional
    chaining, a comparison, a drizzle combinator or template, an SQL keyword with or without a
    bracket.

  It does not flag naming a value, setting it in a SET list of any length, or a comment line.
  A new `alsoAllowedIn` field allows, each for a stated reason, one piece and nothing else in:
  - the runs repository;
  - the schema;
  - the database test that keeps the database's rules in step with the list.
- **Web**: the TOPIC labels. The run header marks an alternate that was not planned as "(not run
  unless chosen)".

**Review.**
- An adversarial review ran: five reviewers with different lenses, each finding put to two
  skeptics. It returned 10 findings: 3 upheld by both skeptics, 6 split, 1 refuted.
- The refuted finding, a test registering a collector twice, had already been fixed.
- **Upheld, fixed:**
  - The probe's first form (`ev.job_id in (...)` inside an OR) would stop hashing once a tenant
    held about 210,000 jobs in person-bearing runs. It is now joins.
  - The guard had no check for decisions on the run's record. It now has one.
  - The 0025 comment wrongly said no queued run could plan a TOPIC, and PTT01 had no typed
    error. Both are fixed: the comment is true, and the error is typed and unretried.
- **Split, fixed:**
  - The guard missed the helpers, `.includes()`, uppercase SQL, quoted identifiers and list
    positions, and wrongly matched an SQL assignment.
  - A multi-word run showed "alternates: topic" with no record that TOPIC was not planned.
- **Split, not changed:**
  - The CHECK is added validating, not NOT VALID. 0018 and 0023 do the same. Validating proves
    every existing row passes.
  - A hashtag or a quoted phrase is TOPIC with no ORGANIZATION alternate, as D-M1 specifies.
    See the open items.
- **A second round** reviewed those fixes, with three lenses and two skeptics each. It returned
  11 findings: 7 upheld, 2 split, 2 refuted. All nine upheld or split were fixed:
  - The fixed probe's new arm read the tenant's whole evidence by job, with no index. The
    person-evidence check is back to D-35's form, and the run's data is reached by key from
    what the read names. The partial index the probe no longer used was dropped.
  - A TOPIC run on an investigation the tenant does not hold failed on the record's check, not
    its foreign key.
  - The guard let through an inline copy of the list, and plain predicate, optional-chaining
    and drizzle-combinator forms. It flagged a multi-column SET list and prose naming the list.
    Its SQL comparison now matches by the value. Its look back runs only after an operator, so
    the repository scan stays near one second.
  - The estimate did not say what it would leave out.
  - A long single word wrongly gained a TOPIC alternate.
  - A run refused with PTT01 stayed QUEUED with no reason.

**Found while running the pipeline, and fixed.** `CasePinsRepository.listForCase` and `list`
ordered by `created_at` alone.
- Pins made in one transaction share their time, so two reads could list them in different
  orders, and a page could repeat or skip one.
- The person-gate lifecycle test's "suspended: reads that rest on no person data are unchanged,
  byte for byte" failed once on it: a clean case's two pins swapped.
- The id now breaks the tie. A regression test pins five items in one transaction; it fails on
  the old ordering.

**Shown failing on the code before the change** (each piece removed, the tests run, the file
restored byte for byte; the probe's case was run again on the final code):
- **Without the gate call in the run start:** a TECHINT tenant's TOPIC start answered 202, not
  403, and the three refusal tests failed.
- **With the probe as before:** a TOPIC run that used only a news collector read 200 for a TECHINT
  tenant. The database probe test and the API read test failed.
- **Without the TOPIC admission check:** a news collector collected on a topic for a TECHINT
  tenant. The runtime test failed, and so did two planner tests.

**Pipeline** (`pnpm turbo lint typecheck test --force`, in a clean worktree with exactly this
change applied):
- 54 of 54 tasks, nothing cached, 2,163 tests (96 more than the R1 baseline's 2,067);
- the fabrication check is clean on 499 files, and the export check passes (181 symbols).

| Package | Tests | Package | Tests |
|---|---|---|---|
| core | 33 | osint-engine | 172 |
| access | 67 | worker | 4 |
| config | 265 | api | 235 |
| case-engine | 73 | ui | 95 |
| collectors | 484 | web | 179 |
| llm | 130 | integrations | 122 |
| db | 304 | | |

An earlier full run failed once on the lifecycle test above, before its fix. A run in the main
tree, just after Docker restarted, timed out in three API setup hooks; they passed when run
again.

**Open for the owner.**
- **Detection of a hashtag or a quoted phrase.** As D-M1 specifies, it is TOPIC alone. A quoted
  organisation name, such as `"[an organisation]"`, therefore no longer runs as an organisation
  unless its quotes are removed or the type is chosen. Wikidata ran on such input before. The
  alternative is to keep ORGANIZATION as an alternate. The run would still be person-bearing,
  but the estimate would show Wikidata planned while starting the run is refused, for a tenant
  without person access.
- **Monitoring is person investigation.** Every TOPIC run needs the person plan and approved
  vetting, so every monitoring customer, a newsroom included, needs vetting. Narrowing that is
  a separate ruling.
- **The investigation record.** It keeps the analyst's typed target, which may be a name. It is
  readable as before: it is the analyst's own input (`ROUTE_GATING`, `investigations.ts`).
- **The estimate for a tenant without person access.** It lists a collector that takes topics
  as refused, MODULE_NOT_IN_PLAN or VETTING_NOT_APPROVED, once one exists (Day 2). Starting the
  run is refused whole.

**Noted.** `apps/worker/data/content-store/` holds a local run's stored payloads. It is untracked,
not ignored, and not committed.

## Track M Day 2: GDELT un-held for a topic, behind the Day 1 gate (2026-10-15)

**The owner's instruction** (2026-10-15), which rules D-M4 (`docs/monitoring/MONITORING-PLAN.md`
§9) and changes its canary:
- Add TOPIC to the GDELT collector, which took domains, mapping each article's language and outlet
  country from what GDELT returns. The source label comes from the registry, never an article.
- Un-hold GDELT, with the live FOUND recording it was held for as a fixture. Attribution travels
  on its evidence.
- GDELT's empty answer is "returned nothing — unconfirmed", never a confident NOT_FOUND and never
  "0 articles". A list that reached the cap is "newest 250 only", never readable as a rise.
- One request every five seconds, shared across tenants by the Redis limiter, proved across two
  workers. A topic run that used only GDELT stays person data (Day 1).
- A canary whose pass means GDELT is up, not that any query found something, and says so.
- The RSS collector, the monitoring page and the scheduler are later days.

**Pre-flight.**
- The base is 51a7576 (Day 1), the same as `origin/main`; the tracked tree was clean.
- The clean worktree `D:/vestigo-baseline` was reset to 51a7576; it held Day 1's change
  uncommitted, identical but for the record's pipeline placeholder.
- The baseline took five runs. Runs 1 to 4 each failed on a different load or pause timeout, and
  each test passed alone: a web worker that did not start; a web lookup that timed out; a run the
  machine slept through; database and Redis waits. Run 5, at turbo concurrency 2: 54 of 54
  tasks, nothing cached, 2,163 tests, as Day 1; fabrication clean on 499 files; 181 symbols.

**The live recording.** GDELT refused this address most of the day: 429 ("Please limit requests to
one every 5 seconds"), from the first request, or a refused connection. Polling every ten minutes,
one request was answered:
- `"climate change"`, 17:27 UTC, through the collectors package's own fetcher: 200, 166 articles
  from 150 outlet domains in 20 languages, each with all eight fields. `language` and
  `sourcecountry` are names ("English", "United States"), not codes; `url_mobile` is blank in 140,
  `socialimage` in 24, `sourcecountry` in 3; every `seendate` is `YYYYMMDDTHHMMSSZ`, newest first.
- Under the 250 cap, yet its seendates run from 14:30 to 17:00 UTC that day, of the three months
  asked for: a list under the cap is not all the coverage in the window either.
- Stored as `test/fixtures/news/found.json`, recorded-redacted: titles become `[headline N]`, and
  the paths of `url`, `url_mobile` and `socialimage` become placeholders (the first URL named a
  person). Everything else is as received; GDELT's layout was rebuilt byte for byte from the
  parsed answer before redacting, and the received body's SHA-256 is in the notes.
- Not recorded, every attempt answered 429: the canary's own answer (`canary-found.json` is
  synthetic and says so) and a FOUND for a domain phrase, the Phase 3B condition.

**Built, in two commits.**
1. **The ruling** (6c230e5), in a commit of its own with its golden diff, as coverage requires:
   - EMPTY_UNCONFIRMED, appended to the job outcomes and coverage states (`packages/core`), worded
     RETURNED NOTHING (UNCONFIRMED). A report keeps its wording, so a stored one may lack a label
     added since: the API reads it partially, and the PDF prints the state's own name.
   - `ctx.emptyUnconfirmed` (a 2xx this run received, a detail, network collectors only). A
     collector declaring `emptyAnswersUnreliable` cannot return `notFound()`.
   - Migration 0027 appends the enum value and lets a job keep its detail
     (`jobs_detail_only_empty_answers`, compared as text, as 0025 did).
   - The job SUCCEEDS with its detail, is never retried, and is the circuit's success.
   - Coverage (`packages/case-engine`): its own state, counted apart in the headline ("1 returned
     nothing — unconfirmed") with a caveat; a breakdown lists it as ran, never found nothing;
     ENGINE_VERSION 6.
   - Golden files rewritten with `WRITE_GOLDEN=1`, every existing row unchanged: the outcomes are
     ordered as first written, then null, then added ones. Six rows were added; the large run
     gained its 60 jobs, so its name, headline and caveats changed.
   - Web: the Unconfirmed chip in the hypothesis grey (DESIGN-SYSTEM D9); its row gives the
     collector's words, never "0 evidence records"; its own count chip; a gap on the Overview.
2. **GDELT** (the commit after it):
   - `news` 2.0.0 takes DOMAIN and TOPIC. A topic is one exact phrase, less one pair of outer
     straight or curly quotes. A quote mark inside, or nothing inside the quotes, is refused before
     anything is sent (`TARGET_NOT_SEARCHABLE`): it would end the phrase and turn the rest into
     GDELT's operators. A hashtag is sent as typed.
   - An empty answer runs the canary: `"government"`, the documented default list of 75, the same
     window and the same shared limit. Articles back: EMPTY_UNCONFIRMED, its detail ending "A
     passing canary means GDELT is up — not that any query found something." Nothing back:
     UNAVAILABLE, GDELT is not answering searches. A refused canary is UNAVAILABLE and says so.
   - The result states the search sent, `newest250Only`, the span of seendates it covers, and
     `volume: { count: null, reason: NOT_MEASURED_BY_AN_ARTICLE_LIST }`; `returnedCount` and
     `capped` are gone, so no figure in it counts coverage.
   - Comments that called GDELT's `{}` and seendate "documented" now say recorded.
   - Registered, appended to `PLATFORM_COLLECTORS`; `HELD_PLATFORM_COLLECTORS` is empty, exported.
   - Fusion: a news extractor that checks the result and draws nothing yet (no entity, no claim,
     no count), so a TOPIC fuses without an entity kind.

**Review.** An adversarial review was started (five lenses, two refuting skeptics per finding) and
did not finish: the session ended while its reviewers ran, and at the owner's request for speed it
was not run again. The risky pieces were checked directly instead, and by the removals below.

**Shown failing on the code before the change** (each piece removed, the tests run, the file
restored byte for byte, hash checked):
- **An empty answer as NOT_FOUND**, as before: the runtime refused it, and five honesty tests
  failed.
- **Without TOPIC:** 16 news tests failed, the live-recording FOUND test among them.
- **Without the newest-250 flag:** the cap test failed.
- **GDELT's limit at one a second:** the two-worker test failed on Redis's clock.
- **news not registered,** as before: the API's GDELT-only topic run planned nothing, and the suite
  failed.
- **Without GDELT's attribution:** the evidence test failed.

**Pipeline** (`pnpm turbo lint typecheck test --force --continue --concurrency=2`, in the clean
worktree: at commit 1, then with commit 2's change mirrored into it, every file identical to the
commit but this record's pipeline lines).
- Commit 1 (6c230e5): 53 of 54 tasks, nothing cached, 2,180 tests (17 more than the baseline's
  2,163); the fabrication check clean on 499 files; the export check 181 symbols. The one failure
  was a 30-second timeout in the stream-access test (a member removed mid-stream), which this
  change does not touch; run alone, that file passed, 7 of 7.
- Commit 2: 52 of 54 tasks, nothing cached, 2,203 tests (40 more than the baseline); the
  fabrication check clean on 501 files; 181 symbols. Five tests failed, none of them Day 2's, all
  in one pause of the machine: four 30-second timeouts were reported after 363 to 370 seconds, in
  the api and osint-engine suites at once, and a fifth test lost its database connection just
  after. Docker ran throughout. The two suites rerun alone in the same worktree, their builds
  cached: api 239 of 239, osint-engine 179 of 179.

| Package | Tests | Package | Tests |
|---|---|---|---|
| core | 33 | osint-engine | 179 |
| access | 67 | worker | 4 |
| config | 265 | api | 239 |
| case-engine | 77 | ui | 95 |
| collectors | 504 | web | 183 |
| llm | 130 | integrations | 122 |
| db | 305 | | |

**Open for the owner.**
- **Domains.** news keeps DOMAIN, as item 1 and §4.2 read. No live FOUND for a domain phrase could
  be recorded, and GDELT's answers covered only the newest hours, so most domain searches will be
  unconfirmed. Every domain run, for every tenant, now spends one or two GDELT requests. In
  production it is the one domain collector that runs, the others being unverified. One line
  (`targetTypes`) makes it topic-only.
- **Case engine.** The ruling touched `packages/case-engine` and its R1 code, against the Track M
  ruling that it would not: without it, coverage reads an unconfirmed answer as NOTHING FOUND.
- **Stored case analyses read STALE** after deploy: ENGINE_VERSION 6, and the held list changed.
- **GDELT is under strain.** It asks (blog, 2026-06-30) that searches move to its ngram files for
  now, and its 429 counts toward the circuit, as every collector's 429 does.
- **D9**, the Unconfirmed chip's colour.
- **The canary and the domain recordings** are still to be made when GDELT answers this address.

**Noted.** `PROJECT-BRIEF.md`, `R1-HONESTY.md` and `R1-PLAN.md` still say news is held; they are
dated snapshots and R1 files, left as they are.

## Access methods: a licence-gated registry, GDELT the first open source (2026-10-16)

**The owner's instruction** (2026-10-16):
- Every source declares one or more access methods and a licence verdict. The methods are open (a
  free public API), official (a keyed API), licensed (a data vendor's account) and operator
  (operator-supplied credentials, off by default).
- A source runs only via an enabled method whose verdict is PERMITTED. The operator method stays
  off unless configuration enables it. No credentialed scraping code, only the interface an
  operator would attach their own collector to.
- A source with no runnable method yields "—" or null, never 0. Tenant isolation and the Day 1
  person gate hold.
- GDELT's news collector is the first open source, PERMITTED and enabled, not rewritten, its Day 2
  behaviour intact.
- Acceptance: (a) operator is off by default; (b) a BLOCKED or UNVERIFIED source never runs; (c) a
  source with no runnable method renders "—", not 0; (d) GDELT's Day 2 tests pass unchanged.

**How it was read** (stated here so the owner can correct it):
- **(b) is absolute in the product.** No runtime the API or a worker builds runs an UNVERIFIED
  source, in any environment. `COLLECTORS_ALLOW_UNVERIFIED` and `allowsUnverifiedSources` are
  retired, and the variable is dropped if set, as every retired variable is. This supersedes the
  Phase 3A allowance (unset: on in development and test). The offline fixture harness may still
  replay recorded answers for an UNVERIFIED collector. Its network is a loopback fixture server
  and a placeholder resolver, so a replay never contacts the source. The grant is package-internal
  (`replayRecordedAnswers`, lint-fenced to `src/testing.ts`), and a new RELEASE-BLOCKING check
  fails if any app or package source loads `@repo/collectors/testing`. Without replay, about 240
  tests of eight shipped collectors, the cross-tenant API checkpoints among them, would have had
  to go.
- **"The operator supplies the key" means the tenant's administrator, through the tenant's vault.**
  No platform-level collector credential exists (the Phase 3A tenant-keys-only ruling; an env file
  is plaintext on disk, CLAUDE.md §9). The deployment's configuration only switches methods on.
- **A licensed vendor, or an operator's own collector, is a source of its own**, with its own id,
  label, verdict and hosts (CLAUDE.md, source labelling). The verdict stays one per source, shared
  by every method (Phase 3A decision 2): different terms for another way in are another source.
- **"Enabled in config"** is `COLLECTORS_ACCESS_METHODS`, a comma-separated list. Unset, it is
  open, official and licensed, never operator. Verdicts stay code.
- **"First" open source** is a fact of this change's history, not something a test can measure.
  wikidata and libphonenumber declare open in the same change.

**What changed.**
- **config:** `ACCESS_METHODS`, `DEFAULT_ACCESS_METHODS`, `COLLECTORS_ACCESS_METHODS` and
  `enabledAccessMethods`; `.env.example` regenerated.
- **collectors:**
  - `SourceDeclaration.access` is required, and every catalogue source declares its methods
    from what the audit records of a key, token or paid account. Open or official: github,
    jina-reader, bluesky. Official: ucdp, reliefweb, hibp, reddit-api, brave-search,
    youtube-data-api. Licensed: kpler. Open: the rest, gdelt-doc first.
  - Validation allows at most one keyed method. Operator stands alone, needs a network, and is
    exactly the sources and collectors whose ids start `operator.`.
  - No source may declare an Instagram, Facebook or X host: a backstop for §3, not the rule
    itself.
  - The registry checks that a collector's credentials fit its source's methods, and lists the
    methods each collector can use. A tenant vault id belongs to one source: a collector on
    another source may not name it, so an attached collector cannot be handed, say, the
    tenant's GitHub key. An operator collector must be declared PERSON: it may read
    people whatever it says, so it is person data, fail closed (`@repo/access`
    `disciplineFitsOperatorCollector`).
  - The runtime's `access()` and `sources()` decide, in order: licence (BLOCKED, then
    UNVERIFIED), an enabled method, an implementation. Then the unchanged discipline, Day 1
    TOPIC and scope checks run. It hands a collector only the credentials of a keyed method
    enabled here. `createPlatformRegistry({ operatorAttachments })` is the attach interface, and
    the product attaches none.
- **core:** `UNRUNNABLE_REASONS` gains `UNVERIFIED_SOURCE_NOT_ALLOWED` and
  `ACCESS_METHOD_NOT_ENABLED`.
- **osint-engine:** the executor reads from the vault only the vault ids `access()` allows.
  `caseAnalysisCollectors` marks an UNVERIFIED collector as unable to run, from the registry
  alone, so the API and the worker agree and configuration stays out of the input hash. The
  stored-document schema names registrations by value.
- **case-engine (D-39, for UNVERIFIED):** registration and discipline status UNVERIFIED, counts
  null with `ONLY_UNVERIFIED_COLLECTORS`, and ENGINE_VERSION 7.
- **api:** GET /api/v1/collectors gives each collector its `sourceId` and `access`, with
  `runsVia` null and a refusal and reason when nothing runs. The list gains
  `accessMethodsEnabled` and every catalogue source. `unverifiedSourcesAllowed` stays, always
  false, so clients do not break. The estimate's vault ids are the ones a run would read.
- **worker:** reads `COLLECTORS_ACCESS_METHODS`.
- **web:** readiness is the API's `access`, failing closed. Each health-card row says what it
  runs via, or a dash ("None. No access method can run here."). `ACCESS_METHOD_NOT_ENABLED` reads
  Held. `Unmeasured` takes an optional summary for a dash that stands for a known absence.

**Acceptance tests.**
- **(a) Operator is off by default:**
  - the config, in every NODE_ENV (`env.test.ts`, `env-example.test.ts`);
  - the runtime, where an attached operator collector is refused, its code unrun and its account
    unread, until operator is named, and stays person-gated once it is (`runtime.test.ts`);
  - a deployment's runtime and the platform registry (`platform/access-methods.test.ts`);
  - the attach interface's refusals, in the same file.
- **(b) BLOCKED and UNVERIFIED never run:** by default and with every method enabled, the
  environment loaded as a deployment loads it (loadEnv drops the retired flag; the runtime takes
  nothing else from the environment, NODE_ENV included). Checked in the runtime, for every
  platform collector, and end to end with no request, no evidence, and no read of the key the
  tenant holds for it (`collection.test.ts`). A deployment's DOMAIN plan is news alone. The
  BLOCKED test now runs on the most permissive path left: the replay grant with all four
  methods.
- **(c) Null and a reason, never 0:** in the runtime and on the platform; through the API
  (`collectors.test.ts`); in the web health card, a dash named "None.", no zero, and a collector
  the API did not decide held (`search.test.tsx`). In the case breakdown, a discipline whose
  only collector is UNVERIFIED reads null (`case-analysis.test.ts`,
  `case-analysis-collectors.test.ts`). A stored ENGINE_VERSION 6 document, written by 6bf5fe3's
  own code, still reads.
- **(d) GDELT's Day 2 tests are unchanged and pass:** `news.test.ts`, `gdelt-limit.test.ts`,
  `gdelt-topic-runs.test.ts` and `platform-registry.test.ts` are byte-identical to 6bf5fe3. In
  `pipeline.test.ts`, only its own fake source gained `access: ["open"]` and five retired-option
  lines went; its GDELT tests are untouched. New: gdelt-doc declares exactly open, PERMITTED and
  enabled; news runs via open and sends no credential; turning open off turns GDELT off, and
  says so.
- **Credentials and configuration:** GitHub's collector is handed the tenant's key only while
  official is enabled (`platform/access-methods.test.ts`); an attachment naming another source's
  key is refused; a worker started with open switched off plans no GDELT job and records
  `ACCESS_METHOD_NOT_ENABLED` (`apps/worker/src/index.test.ts`); the estimate's vault ids follow
  the enabled methods (`apps/api/test/estimate-access.test.ts`); every unrunnable reason reads
  Held in the web (`search/plan.test.ts`).
- **Changed on purpose:**
  - The worker's DOMAIN plan, which Day 2 extended with news, is now news alone.
  - The case-analysis collectors test now reads UNVERIFIED as unable to run.
  - The collection and runtime tests that ran an UNVERIFIED source "where allowed" became the
    (b) tests.

**Pipeline.** (`pnpm turbo lint typecheck test --force --continue --concurrency=2`, in the clean
worktree at 6bf5fe3 with this change mirrored into it, every file identical to the commit but this
record's pipeline line): 54 of 54 tasks, nothing cached, 2,259 tests (56 more than Day 2's
2,203); the fabrication check clean on 508 files; the export check 195 symbols. An earlier run of
the same change, before the review's fixes, lost four tests to one pause of the machine (30-second
timeouts reported after up to 786 seconds); those suites rerun alone passed.

| Package | Tests | Package | Tests |
|---|---|---|---|
| core | 33 | osint-engine | 181 |
| access | 69 | worker | 5 |
| config | 273 | api | 241 |
| case-engine | 81 | ui | 96 |
| collectors | 537 | web | 186 |
| llm | 130 | integrations | 122 |
| db | 305 | | |

**Open for the owner.**
- **Production and development now run the same three collectors:** wikidata, contact.phone and
  news. A USERNAME target plans nothing anywhere. The M3 live checkpoint waits for Bluesky's and
  Mastodon's verdicts. Recording verdicts is owner work.
- **The operator attach interface** runs attached code in the worker's process, with what that
  process can reach. It needs the same review as platform code. Host, verdict and person rules
  are backstops, not a sandbox. Open questions:
  - whose account an operator method uses;
  - whether enabling it should be a per-tenant, audited record rather than a deployment
    setting;
  - fusion: no extractor exists for an attached collector, so a FOUND job from one would fail
    fusion with a typed error.
- **The case engine** was touched again (ENGINE_VERSION 7), so stored analyses read STALE after
  deploy.
- **Owner-reviewed wording, not changed:** `UNMEASURED_IS_NOT_ZERO` lists the causes as "none is
  built, or each is held, blocked by its source's licence, or not yet implemented". Proposed:
  "none is built, or each is held, blocked by its source's licence, waiting for its source's
  licence to be checked, or not yet implemented".
- **What D-39 leaves:** a collector whose only methods are switched off by configuration still
  reads REGISTERED in case analysis. Its runs record `ACCESS_METHOD_NOT_ENABLED`, which the lock
  judgement leaves out. No platform collector is affected under the default.
- **Stored report coverage** still carries `evidenceCount: 0` for excluded and held entries.
  Neither the web nor the PDF renders it. Making it null is a core type change with a migration
  plan.
- **The database's guard stays at BLOCKED.** UNVERIFIED rows stay enabled, because the offline
  replay writes their evidence, so the runtime is what refuses them.
- **Removing `unverifiedSourcesAllowed`** from the API is a breaking change, left for a version
  bump.
- **`platform-registry.test.ts`'s title** still says "UNVERIFIED only where allowed". It is kept
  byte-identical for (d), and its assertion (availability) still holds.

**Noted.** `R1-PLAN.md` (D-39 open) and `PROJECT-BRIEF.md` are R1 files and a dated snapshot, left
as they are. In the main tree, the untracked `.claude/` worktrees trip the person-gate guard. The
clean worktree has none.

## Monitoring collectors: RSS, Reddit and Bluesky on the open method (2026-10-17)

**The owner's instruction** (2026-10-17):
- Build RSS, Reddit and Bluesky collectors on the access-method seam, each item in the news
  collector's shape, with the registry's label, claim strengths (OBSERVED for the item's
  existence, REPORTED for what it says), a published date that is null when the source gives
  none, and a region when known.
- RSS: World Monitor's direct-publisher feeds, without Google News, plus six to eight named
  Indian outlets, each verified live.
- Reddit: the public JSON endpoint at one request a second, or an OAuth app if configured.
  Bluesky: the public `searchPosts`.
- An empty or failed fetch is EMPTY_UNCONFIRMED, never 0. TOPIC runs stay person-gated.

**The owner's rulings, the same day**, on four conflicts raised before building:
- **Held:** the sources have no recorded verdict, so they are built UNVERIFIED and tested on
  recorded answers; none runs until the owner records its terms.
- **Collectors only:** there is no watch, trends or brief stage in Vestigo (slices M1, M3, M5 of
  `docs/monitoring/MONITORING-PLAN.md`), so items reach stored evidence, as GDELT's do.
- **The feed list as leads only:** World Monitor's list is AGPL-3.0. No file is copied. Each
  publisher's own feed URL is verified and declared under a source of its own.
- **Additive fields:** items keep the news shape and add `published` and, derived, `publishedAt`
  and `region`. GDELT keeps its own shape.

**What was found, live.**
- **Bluesky:** the public AppView answered an unauthenticated `searchPosts` with 403
  (recorded). Keyless Bluesky search does not exist today.
- **Reddit:** www.reddit.com answered this address's unauthenticated search with its 403 block
  page (recorded). Neither refusal was worked around (CLAUDE.md §3).
- **RSS:** 179 URLs were fetched once each: 167 from World Monitor's list and twelve Indian
  candidates. `test/snapshots/rss-feed-verification.json` records what happened to every one:
  - 153 kept, from 132 publishers;
  - 15 failed the check and were skipped (HTTP 403, 404, 429, not a feed, a reset
    connection), three of them Indian candidates: ThePrint (403), The Wire (not a feed) and
    Deccan Herald (404);
  - 10 Google News URLs, written out by hand rather than through `gn()`, left out whatever
    they answered (8 had parsed);
  - a ninth Indian outlet that passed, Business Standard, left out to stay within eight.
- **Language is not a region:** The Hindu's feed states en-US and The Times of India's en-GB.
  So `region` comes only from a country the feed list records, never from a language tag.
  It is IN for twelve publishers:
  - seven publishers for the eight added outlets (The Times of India and The Economic Times
    share indiatimes.com);
  - five from World Monitor's list: NDTV, The Hindu, Inc42, Aaj Tak and Amar Ujala.

**What changed.**
- **collectors:**
  - `rss.<domain>`: one collector per publishing domain, each on its own UNVERIFIED source
    with its own limit (one request every two seconds).
    - **Matching:** for a topic, it keeps the items whose title or summary contains the phrase
      as whole words, case-insensitively, the title and the summary each on its own. A
      letter, mark or digit on either side continues a word, in any script, so "AI" is not
      found in "said". Typographic apostrophes and dashes match their plain forms, and HTML's
      named entities are decoded first, so "Côte d’Ivoire" and "M&amp;uuml;nchen" are found.
    - **No link:** an item that mentions the topic but gives no link cannot be cited. It is
      counted (`itemsMentioningWithoutLink`), and an answer with only such items says so.
  - `bluesky.search` reads the public AppView, or bsky.social with the tenant's app password
    (vault id `bluesky`). There it signs in, searches, and closes the session
    (`deleteSession`) whatever the search answered, or if it could not be sent. A close that
    fails, or cannot be sent, is UNAVAILABLE and says the session may still be open. A post's
    web link is built from the DID in its URI, never from its author's handle.
  - `reddit.search` reads the public JSON endpoint, or oauth.reddit.com with the tenant's OAuth
    app (vault id `reddit-api`), at Reddit's one request a second. `reddit-api` now declares
    open and official.
  - A page that names another page (Bluesky's `cursor`, Reddit's `after`) is marked
    newest-only, as a full page is.
  - **The RSS and Atom reader** uses no XML library and no DTD, and fetches nothing. It returns
    each value as the feed's text has it, for the provenance check, and decoded under
    `derived`.
    - It reads, and decodes text, in one forward pass, so a hostile body costs time in
      proportion to its length. An item that never closes is a typed failure.
    - An Atom entry takes its alternate link, or its first link without a rel, and never
      reads the `<source>` it was copied from as its own. An RSS item with no `<link>` takes
      its guid when that is a permalink URL.
    - A video's `media:content` is never the item's image; its poster thumbnail is.
  - **Dates** are read field by field, in the two forms feeds use: RFC 822/2822 (RSS) and
    RFC 3339 (Atom, Bluesky). A date with no time zone, no year, a day the month does not
    have, an order that could be day-first or month-first, or a weekday that is not the
    date's, is null, never a lenient parser's guess or this server's reading. A two-digit
    year is read by RFC 2822's rule only when the weekday confirms it (CISA's feed writes
    them). On the 7,052 dated items of the live check, this reads every date as before.
  - `CredentialMalformedError`, for a vault credential not in the form a collector needs.
- **osint-engine:** extractors that check each result and draw nothing yet, as news does.

**Departures from the instruction, stated.**
- **A failed fetch is a typed failure, not EMPTY_UNCONFIRMED.** CLAUDE.md §1 says a collector
  that fails returns a typed error, and the runtime refuses an unconfirmed answer that cites
  no 2xx response. A 429 or 5xx is UNAVAILABLE and retried; a 403 is FAILED,
  UPSTREAM_REFUSED. Neither is ever 0. A 2xx with nothing on the topic is EMPTY_UNCONFIRMED.
- **The source label is not in the item.** A collector cannot state a label (CLAUDE.md, source
  labelling). Every evidence row takes it from the registry through its collector id. The
  pipeline test checks that each row's collector is its own job's.
- **Real items exist for RSS only.** Bluesky's and Reddit's found answers are synthetic in
  their documented shapes until an app password or an OAuth app lets one be recorded.
- **The user agent is the platform's** (`Vestigo-collector/1.0`). A collector cannot set its
  own, and Reddit asks for one naming a contact.

**Acceptance tests.**
- **(a) Items reach stored evidence:** a topic run through the engine
  (`pipeline.test.ts`) stores a real BBC item, a Bluesky post and a Reddit post, one
  evidence row each, with nothing drawn. Each row is its own job's collector's, and BBC's
  cites the World feed, where the item was.
- **(b) Empty is unconfirmed, failure is typed, never 0:**
  - an RSS topic with no matching item, and an empty Bluesky or Reddit page, are
    EMPTY_UNCONFIRMED, and a run of one completes with nothing stored;
  - a feed answering 503, 403 or a page that is not a feed, and the recorded Bluesky and
    Reddit 403s, are typed failures;
  - one unreadable feed of a publisher fails its whole job, never a quiet partial: the last
    of BBC's seven, after an earlier one matched, and a middle one refusing.
- **(c) No invented date:** BBC Hindi's recorded second item has no `<pubDate>`, and its
  `publishedAt` is null; so are a Bluesky post with no `createdAt`, a Reddit post with no
  `created_utc`, a date with no time zone, dates such as "17-Oct-2026", whose year could
  pass for an offset, and dates a lenient parser would complete (no year, 31 February, a
  wrong weekday). One item's malformed date is null on that item alone: the run keeps the
  others.
- **(d) The Day 1 gate:** each collector refuses a topic without the person module or approved
  vetting, and the planner leaves all three out of a topic run for such a tenant.
- **The feed list:** a test checks it is exactly the feeds the live check kept, with no Google
  News and eight Indian outlets added. It checks that the snapshot accounts for all 179 URLs,
  and that each publisher's country is the one the snapshot records for its feeds.

**The adversarial review, the same day.** It confirmed 17 findings, 14 distinct issues, all
fixed. Each fix has a test that fails when it is reverted (the Verge fixtures' since the
second review); eleven were checked by putting the defect back.
- **Dates:** a zoneless date ending in a dash and a year ("17-Oct-2026") read as having an
  offset, giving this server's midnight.
- **Matching:**
  - the phrase was a raw substring of the title and summary joined, so "AI" was found in
    "said", and across the two fields;
  - matching items with no link were dropped silently, and the empty answer then said that
    nothing mentioned the topic.
- **The reader:** its item scan was quadratic on items that never close, blocking the worker.
- **Bluesky:**
  - its web link used the author's handle, which can be "handle.invalid" or change;
  - each signed-in run left its session open on the tenant's account.
- **Paging:** Bluesky's cursor and Reddit's `after` were ignored, so a partial page read as
  complete.
- **Data:**
  - Aaj Tak and Amar Ujala had no country, and the test pinned that gap;
  - the record's figures did not add up, with every left-out URL missing from the snapshot;
  - the Verge fixtures kept their Atom category terms, a person's name among them.
- **Tests:**
  - the partial-failure test failed the first feed, so it could not catch a quiet partial;
  - the Atom link choice was untested;
  - the acceptance (a) label check compared the registry with a copy of itself.

**A second review, of those fixes, the same day.** Four reviewers, each checked by a skeptic,
confirmed 14 findings, 12 distinct issues, all fixed. Each fix has a test that fails when it is
reverted; all eleven code fixes were checked by putting the defect back.
- **The reader:**
  - its tag strip was still quadratic, so matching, not parsing, could block the worker;
  - a video's `media:content` was stored as the item's image;
  - `&constructor;` decoded to a function's source text, which a topic could then match;
  - most named entities stayed encoded, so "M&amp;uuml;nchen" did not match "München";
  - an Atom entry's `<source>` could give the entry its title, link and date.
- **Matching:** curly apostrophes did not match straight ones.
- **Dates:**
  - `Date.parse` filled in missing years and days, rolled 31 February into March and
    guessed month-first;
  - a five-digit year failed the whole run's result, losing every item.
- **Bluesky:** a close that could not be sent left the session open without saying so, and
  the test for the close ran no path that needed it.
- **Claims:** the schema still said no mentioning item is dropped, the monitoring plan still
  called Reddit official only, and the first review's "each fix has a test" was not yet true
  for the Verge fixtures.

**Pipeline.** In a clean worktree holding only this change, `pnpm turbo lint typecheck test --force`
ran 54 of 54 tasks green, lint and typecheck clean, 2,318 tests: collectors 590, db 305,
config 273, api 241, osint-engine 187, web 186, llm 130, integrations 122, ui 96, case-engine
81, access 69, core 33, worker 5.

**Open for the owner.**
- **Verdicts:** 134 sources wait on the owner reading the terms: Bluesky's, Reddit's Data API
  terms (D-M8), and each of the 132 publishers'. Until then none runs.
- **Keys to record real answers:** a Bluesky app password and a Reddit OAuth app, held as tenant
  credentials, would let their found answers be recorded and the synthetic fixtures replaced.
- **Scale:** each source gets its own collect queue, so a collect pool now opens 134 more queues,
  idle while the sources are UNVERIFIED. Opening queues only for sources that can run is a
  separate change.
- **The health card** lists the 134 among the held collectors.
- **Feeds change:** a publisher can move or drop a feed. Its collector then fails, typed, until
  the list is checked again.
- **Bluesky sessions:** a signed-in run opens and closes its own session. Bluesky limits
  sign-ins per account, so a tenant watching many topics would need one session kept between
  runs, outside the collector. Not built; latent while Bluesky is held.
- **One feed to look at closely:** `rss.trumpstruth-org` is a third party's feed of one
  person's posts on a social platform. Whether reading it is within that platform's terms
  (CLAUDE.md §3) belongs in its verdict.

**Noted.** Docker Desktop was not running this morning; it was started for the tests.

## Global RSS/Atom publishers from the owner's news catalog (2026-10-21)

**The owner's instruction.** The owner added `Vestigo_Global_News_Providers_and_APIs.md`, a
research catalog of ~250 news providers, and asked to add all of them and to build "fallback
ones for uninterrupted retrieval." Two rules shaped what is deliverable, and the owner chose the
scope around them (this session):

- **Scope: RSS feeds first.** Nothing runs until the owner records a licence verdict, so
  everything added here is held `UNVERIFIED`, exactly like the existing RSS publishers.
- **Fallback: both the honest kinds.** Silent substitution (one source's data under another's
  label) cannot be built — it is structurally impossible here (CLAUDE.md source labelling). The
  parallel-independent-sources model already gives "uninterrupted": the planner runs every
  TOPIC source as its own job, each with its own rate limit, bulkhead and circuit breaker, and a
  rate limit retries with backoff without opening the circuit (`policy.ts`). More verified
  publishers is itself more resilient coverage. Multiple-keys-per-API is deferred to the
  news-API round (no keyed news source exists yet to use it); its one seam is
  `packages/osint-engine/src/credentials.ts`.
- **Skipped:** licensed wire agencies (Reuters, AP, AFP, Bloomberg, Factiva, LexisNexis,
  Meltwater, Xinhua, TASS, Anadolu, EFE, DPA, Kyodo, Yonhap, Bernama, PTI, ANI, Antara) and
  website-only outlets — no feed, API or contract to use yet. Instagram/Facebook/X refused.

**What changed.** The catalog's publishers were turned into candidate feed URLs (the explicit
ones it lists, plus conventional paths), fetched live on 2026-10-21, and kept only where a URL
answered 200 within its redirects and parsed as RSS or Atom with a titled, linked item. 86 feeds
verified, adding **85 new publishers** (one more feed merged into the existing euronews entry);
`RSS_PUBLISHERS` grows from 132 to **217**, each a held `UNVERIFIED` source + collector + queue
through the existing batch path (no change to `catalogue.ts`). The 2026-10-17 baseline is
untouched but for country enrichment.

- **`country` widened** from `"IN" | null` to an ISO 3166-1 alpha-2 set (`RSS_COUNTRY_CODES`,
  generated), tagged from the catalog's own country grouping — recorded data, never a guess, and
  never from a language tag. 48 countries now; the article `region` schema widened to match.
- **Snapshot** (`test/snapshots/rss-feed-verification.json`) now records two live batches and
  accounts for every one of the 328 URLs fetched across both (239 kept, 78 failed with a reason,
  11 excluded). The stale "153 kept" header is corrected while regenerating.

**Departures / honesty.**
- **Not "all ~250."** Many catalog publishers are website-only or 403 automated fetches; the
  change adds the ones that genuinely resolve and parse, and the snapshot records why each other
  was skipped. The count is what verified, not what was hoped.
- **Still held.** No source here is PERMITTED; none runs until the owner reads its terms. 217 RSS
  sources wait on per-publisher verdicts.

**Acceptance.** The RSS, registry, access-method and extractor-coverage suites derive their
expected lists from `RSS_PUBLISHERS`, so the new publishers flow through them; collectors 590,
osint-engine units 53. The region test checks each publisher's country against the snapshot feed
by feed. Guards: no new PERMITTED source, no Google News or Instagram/Facebook/X host, every feed
host declared under an operator (enforced by the registry build).

**Open for the owner.**
- **Verdicts:** 217 RSS publishers now wait on the owner reading each one's terms; until then
  none runs. The licence reading pack is the next step.
- **Scale:** the worker now derives 217 idle collect queues; opening queues only for runnable
  sources remains a separate change.
- **The news-search APIs** (GDELT Cloud, NewsAPI, The News API, World News API, Currents,
  Mediastack, NYT, Guardian) and multiple-keys-per-API are the next round, not this one.

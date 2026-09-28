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
| 3     | Collector SDK and migration             | **Session A done, 2026-09-28:** collector SDK, registry, licence gating, fetcher, evidence path. Session B (porting the collectors) not started. See the record below. |
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
  since Phase 2B; the worker still does not.
- **Fabrication ESLint plugin, two legacy defects left as found:**
  - The `configCallees` option has no effect.
  - `require-fabrication-justification` does not check blanket `eslint-disable` comments, or
    disables of itself.
- **Scheduled monitors** exist as rows only; materialising them into jobs is Phase 4.

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
- **Enrol-on-first-login gap.** A password stolen before its owner enrols TOTP lets the thief enrol
  their own device. Invitation plus email verification narrows this. Consider a one-time
  enrolment link instead.
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
  subdomains, CIDR ranges, or specific tools? There is no API to create one yet; it will need
  its own permission, and an audit entry for each one created.
- **Tool containers are internal services.** theHarvester, SpiderFoot, SearXNG and IVRE run on
  private addresses, which the fetcher refuses by design. Phase 4 needs an explicit, separately
  audited path for them.

### Carry-forwards from Phase 3A

- **A language-neutral contract** (JSON Schema export, BUILD-PHASES Phase 3 item 2): session B.
- **Metering usage events** per external call, and **circuit breakers and bulkheads**: Phase 4.
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

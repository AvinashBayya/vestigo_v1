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
| 3     | Collector SDK and migration             | **Done, 2026-09-30.** Session A: collector SDK, registry, licence gating, fetcher, evidence path. Session B: eleven collectors ported, ten registered (news held), the `derived` provenance rule. See both records below. |
| 4     | Jobs, orchestration and tool containers | **Done, 2026-09-30** (tool containers and monitors deferred). BullMQ per-source queues, fault isolation, metering and quotas, run API with SSE, fusion, scope-authorisation API, operator-named labels, MFA enrolment token. See the record below. |
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
with no coverage.

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

1. **news is held unregistered** until a live FOUND for a domain phrase is recorded.
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
- **news** still has no extractor; registering it will need one (a test enforces this).
- **The progress stream polls.** Consider a push signal at scale.
- **Two load flakes seen:** the api server-spawn test (Phase 3B), and the web test worker start
  (this phase). Both pass alone and on rerun.

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
| 5     | AI, fusion and reports                  | **Done, 2026-10-01; live checkpoint passed 2026-10-03** (Groq, development only — see the follow-up below). `packages/llm` with allowlist, profiles, cache, metering, injection defence and citation validator; path-decided claim strength; report pipeline with coverage and limitations; PDF, JSON, CSV and Maltego exports; evaluation harness. See the record below. |
| 6     | Frontend                                | **6a done, 2026-10-03.** **6b in progress:** prerequisite and step 1 (auth) done 2026-10-03, looked at by the owner 2026-10-05; step 2 (search dashboard) done and looked at 2026-10-05; step 3 (run view) done 2026-10-05. **Realigning with the screen designs** (docs/design/) before step 4. See the Phase 6a and 6b records below. |
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

**Next, in order:**
- **R1. App shell** to Main.dc.html: side navigation (only what exists), the tenant's
  vetting chip from `/me`, an account menu, and a light/dark toggle.
- **R2. Sign-in, MFA challenge and enrolment** to SignIn and MfaEnrol, with corrected copy.
- **R3. Dashboard** to Main.dc.html: hero search, the estimate inline, recent cases and
  collector health.
- **R4. Run view** to RunLive.dc.html: the two columns, summary chips, rich rows, and arriving
  now, cost and settings.
- **R5.** `GET /api/v1/collectors` and registry fields on run jobs and exclusions, in
  `apps/api` only.
- **Then step 4:** results to Evidence.dc.html, run-scoped.

**Gaps found by the audit, each needing its own decision:**
- **Cases and runs are not linked.** This blocks the workspace, overview and case reports.
- **No claims or evidence list endpoint.**
- **No correlation, inference or contradictions.**
- **No per-run cost or claim counts.**
- **Media, map, monitors and credits** are not built.
- **In production a domain target would run nothing.** 8 of 10 collectors are licence-UNVERIFIED
  and refused unless `COLLECTORS_ALLOW_UNVERIFIED=true`.

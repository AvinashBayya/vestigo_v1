# OSINT investigation platform

Multi-tenant SaaS for open-source intelligence investigations. Read [CLAUDE.md](CLAUDE.md) before
changing anything, and [docs/ARCHITECTURE-DECISIONS.md](docs/ARCHITECTURE-DECISIONS.md) for why the
stack looks the way it does. Progress is tracked in [docs/PLAN.md](docs/PLAN.md).

The product name is defined once, as `PRODUCT_NAME` in
[packages/config/src/product.ts](packages/config/src/product.ts). Everything that displays it
reads it from there.

## Prerequisites

- **Node 24 LTS.** Node is the only runtime, in development, tests and production. Do not use Bun.
- **pnpm 12** (the version is pinned in `package.json` under `packageManager`).
- **Docker** with Compose, for Postgres (with pgvector) and Redis.

## Run it locally

```sh
pnpm install
cp .env.example .env          # local defaults that match docker-compose.yml
docker compose up -d          # Postgres 17 + pgvector and Redis, bound to 127.0.0.1 only
pnpm db:migrate               # applies migrations as the schema owner
pnpm db:seed                  # optional: two development tenants with distinct data

# Two secrets come from the shell environment, never from a file:
export AUTH_SECRET=$(node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))")
export VAULT_MASTER_KEY=$(node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))")
pnpm dev                      # builds dependencies, then runs the API and the web app
```

The vault master key encrypts stored provider credentials; a new one each session makes
credentials stored earlier unreadable, which is harmless locally. A Postgres volume created before
Phase 2B lacks the `app_auth` role: recreate it with `docker compose down -v`.

| What          | Where                                     |
| ------------- | ----------------------------------------- |
| Web app       | http://localhost:5173                     |
| API health    | http://127.0.0.1:3000/health              |
| OpenAPI (3.1) | http://127.0.0.1:3000/api/v1/openapi.json |

The web dev server proxies `/health` and `/api` to the API, so the browser talks to one origin.

The worker (`apps/worker`) is not started by `pnpm dev`: it validates its configuration and then
exits with `NOT_IMPLEMENTED`, because queue consumption is not built yet.

To stop the databases: `docker compose down` (add `-v` to delete their data volumes).

## Database

Postgres is the single source of truth, accessed through Drizzle in
[packages/db](packages/db). Tenant isolation is enforced by the database, not by convention:

- **Three roles with disjoint reach, none a superuser or able to bypass row-level security.**
  `app_owner` owns the schema and runs migrations (`DATABASE_MIGRATION_URL`). `app_runtime` is the
  only role that reaches tenant data (`DATABASE_URL`); it owns nothing and holds the minimum grants.
  `app_auth` is the identity provider's role (`DATABASE_AUTH_URL`): the `auth` schema only, no
  tenant data. All three are created by [infra/postgres/init](infra/postgres/init) when the compose
  volume is first initialised. Each database handle checks its role before first use and refuses
  one that could escape its reach.
- **Identity is the one exception to `tenant_id`** (CLAUDE.md §2): users, sessions, organisations
  and memberships live in the `auth` schema, because a person signs in before any tenant is known
  and may belong to several. A test fails if any other table lacks `tenant_id`.
- **Every table** carries `tenant_id`, forces row-level security, and has one policy comparing
  `tenant_id` with the transaction's tenant. Foreign keys and unique keys all include
  `tenant_id`, so no row can reference, or collide with, another tenant's.
- **Tenant data is reachable only inside `db.withTenant(tenantId, …)`**, which sets the tenant
  for that one transaction and hands out the repositories. A repository refuses to run outside
  it, and a query that reaches a table with no tenant set fails rather than returning rows.
- **Append-only:** evidence, claims, relationships and usage events have no update or delete
  grant; the audit log is insert-only by grant, and triggers refuse to update or delete it even
  for the schema owner. Evidence is partitioned by month on its UUIDv7 id.

Migrations are forward-only (expand, then contract). To change the schema, edit
`packages/db/src/schema`, then:

```sh
pnpm --filter @repo/db generate:migration   # writes SQL from the schema; review it
pnpm db:migrate
```

Row-level security, grants, triggers and partitioning live in hand-written SQL migrations
(`packages/db/migrations/0002_security.sql`); Drizzle cannot express them.

The db tests run against a real Postgres: `docker compose up -d` first. They recreate a separate
`app_test` database on every run (override with the `TEST_DATABASE_*` variables), and are never
served from the Turborepo cache.

## Authentication and access

Identity is [Better Auth](https://www.better-auth.com), self-hosted and mounted at `/api/auth`.

- **Tenants are organisations.** An operator creates a tenant and its first owner:

  ```sh
  PROVISION_OWNER_PASSWORD='...' pnpm --filter @repo/api provision-tenant \
    --name "[Tenant]" --slug tenant --owner-email owner@example.com \
    --owner-name "[Owner]" --operator "[you]"
  ```

  Everyone else joins by invitation; there is no open sign-up, and nobody can create or delete a
  tenant through the API. A refused sign-up is answered exactly like an accepted one, so the
  response does not reveal which addresses have accounts: the one exception to the never-fabricate
  rule (CLAUDE.md §1), and it applies to nothing else.

- **MFA (TOTP) is required for every account.** After a password sign-in, only TOTP enrolment
  works. Later sign-ins stop at the second factor. MFA cannot be switched off.
- **The tenant comes from the session's active organisation** (`/api/auth/organization/set-active`)
  or from the API key, never from anything else in the request. Every request runs in one tenant
  transaction.
- **Access is by permission** (`investigation:create`, `person:search`), never by role name.
  Roles (`owner`, `admin`, `analyst`, `viewer`) map to permission sets in
  [packages/access/src/permissions.ts](packages/access/src/permissions.ts). Every route declares
  its permission or why it is public; an undeclared route stops the app from starting. The API
  and the workers make every access decision through [packages/access](packages/access).
- **Modules are gated by plan.** Person investigation needs a plan that includes it and approved
  vetting. The application cannot change a tenant's plan or vetting status; a database trigger
  audits any change an operator makes.
- **API keys** (`Authorization: Bearer ak_…`) are scoped to permissions, capped by what their issuer
  can do now, hashed at rest, shown once, rotatable, and rate-limited per key in Redis. If Redis is
  unreachable, API-key requests are refused (503), not waved through.
- **Every authenticated action is audited** in the tenant's `audit_log`: actor, action, target,
  outcome (allowed, denied or failed), the permission exercised, how the caller authenticated, and
  the request id.
- **Provider credentials** go in the per-tenant vault
  ([packages/integrations](packages/integrations)), envelope-encrypted under `VAULT_MASTER_KEY`. No
  API response returns one, and every server-side read is audited.

## Tasks

Run from the repository root. Each is a Turborepo task across every package.

| Command           | What it does                                                      |
| ----------------- | ----------------------------------------------------------------- |
| `pnpm build`      | Compiles packages, emits the OpenAPI document, builds the web app |
| `pnpm lint`       | Prettier check, then type-aware ESLint with zero warnings allowed |
| `pnpm typecheck`  | `tsc` in every package                                            |
| `pnpm test`       | Vitest in every package, after the repository gates below         |
| `pnpm db:migrate` | Applies pending migrations as `app_owner`                         |
| `pnpm db:seed`    | Creates two development tenants with distinct data (idempotent)   |

All four at once: `pnpm turbo build lint typecheck test`.

### Repository gates

Both live in [packages/config/scripts](packages/config/scripts) and run before `test`:

- **fabrication-check** fails on any line that invents a value: a timestamp fallback to "now", a
  capitalised string fallback that reads as data, or a numeric fallback to zero. There is no
  allowlist. It runs after code generation, so the generated API client is scanned too. Run it
  alone with `pnpm turbo run fabrication-check --filter=@repo/config`.
- **check-exports** fails if a package entry point stops exporting a symbol listed in
  [check-exports.ts](packages/config/scripts/check-exports.ts).

## Configuration

Server-side processes validate their environment at startup against the Zod schema in
[packages/config/src/env.ts](packages/config/src/env.ts). An invalid or missing variable stops
the process with `CONFIG_INVALID` and names each variable at fault, without printing its value.

`.env.example` is generated from that schema, and a test fails if the two differ. After changing
the schema, run:

```sh
pnpm --filter @repo/config generate:env
```

## The API client

The web app never hand-writes API calls. `pnpm build` makes the API emit `apps/api/openapi.json`
from the same Zod schemas that validate its requests; the web app's `generate` task turns that
document into a typed client in `apps/web/src/client`. Both files are generated and gitignored.
Calling a path, or sending a shape, that the spec does not describe fails to compile.

## Layout

```
apps/api          Fastify API: routes, identity wiring, HTTP guards; no business logic
apps/web          React SPA (Vite)
apps/worker       one worker codebase, deployed as pools by queue
packages/config   env schema, product name, shared tsconfig / ESLint / Prettier, repo gates
packages/core     domain types, vocabulary, errors; depends on nothing else
packages/access   who may do what: permissions, plan and vetting, API key hashing and
                  verification; pure, depends only on core, shared by API and workers
packages/db       schema, migrations, row-level security, repositories, content store
packages/integrations  credential vault, API key storage, rate limits
packages/*        collectors, llm (toolchain only so far); osint-engine,
                  media-forensics, ui (placeholders)
infra/postgres    first-run database bootstrap for docker compose (three roles, pgvector)
docs/             architecture decisions, audit, build phases, plan
```

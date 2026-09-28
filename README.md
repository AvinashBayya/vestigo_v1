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
pnpm dev                      # builds dependencies, then runs the API and the web app
```

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

- **Two roles, neither a superuser nor able to bypass row-level security.** `app_owner` owns the
  schema and runs migrations (`DATABASE_MIGRATION_URL`). `app_runtime` is the only role application code
  connects as (`DATABASE_URL`); it owns nothing and holds the minimum grants. Both are created
  by [infra/postgres/init](infra/postgres/init) when the compose volume is first initialised. Before
  its first query, `createDatabase` checks the role and refuses a superuser or `BYPASSRLS` role.
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
apps/api          Fastify API: routes only, no business logic
apps/web          React SPA (Vite)
apps/worker       one worker codebase, deployed as pools by queue
packages/config   env schema, product name, shared tsconfig / ESLint / Prettier, repo gates
packages/core     domain types, vocabulary and errors; depends on nothing else in the repo
packages/db       schema, migrations, row-level security, repositories, content store
packages/*        collectors, llm (toolchain only so far); osint-engine,
                  media-forensics, integrations, ui (placeholders)
infra/postgres    first-run database bootstrap for docker compose (roles, pgvector)
docs/             architecture decisions, audit, build phases, plan
```

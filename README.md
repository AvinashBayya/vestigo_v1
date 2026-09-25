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
- **Docker** with Compose, for Postgres and Redis.

## Run it locally

```sh
pnpm install
cp .env.example .env          # local defaults that match docker-compose.yml
docker compose up -d          # Postgres 17 and Redis, bound to 127.0.0.1 only
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

## Tasks

Run from the repository root. Each is a Turborepo task across every package.

| Command          | What it does                                                      |
| ---------------- | ----------------------------------------------------------------- |
| `pnpm build`     | Compiles packages, emits the OpenAPI document, builds the web app |
| `pnpm lint`      | Prettier check, then type-aware ESLint with zero warnings allowed |
| `pnpm typecheck` | `tsc` in every package                                            |
| `pnpm test`      | Vitest in every package, after the repository gates below         |

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
packages/core     domain types and errors; depends on nothing else in the repo
packages/*        collectors, db, llm (toolchain only so far); osint-engine,
                  media-forensics, integrations, ui (placeholders)
docs/             architecture decisions, audit, build phases, plan
```

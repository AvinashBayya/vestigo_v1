# 01 — Project Inventory

## 1. Identification

| Attribute | Finding | Evidence |
|---|---|---|
| Name | **Vestigo** (single `PRODUCT_NAME` constant) | `packages/config/src/product.ts:6` |
| Category | Multi-tenant SaaS OSINT investigation platform | `CLAUDE.md`; README.md |
| Shape | One monorepo: 3 apps + 11 packages (+ gitignored `legacy/` reference) | `pnpm-workspace.yaml` |
| Deployment model | Web app (SPA) + HTTP API service + background worker pools; local Docker Compose for datastores | `docker-compose.yml`; `apps/*` |
| Maturity | MVP / pre-launch; foundations production-grade, several features stubbed/frozen | throughout |
| Primary language | TypeScript (strict) | all `apps/`, `packages/` |
| Package manager | pnpm `12.6.0` | `package.json:5` |
| Monorepo tool | Turborepo `^2.11.3` | `turbo.json`; `package.json` |
| Node runtime | `>=24.0.0` | `package.json:7` |
| TypeScript | `~6.0.3`, strict + `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` | `packages/config/tsconfig/base.json` |

### Tracked-file census (legacy excluded)
882 tracked files. By extension: `ts` 406, `json` 255, `tsx` 92, `md` 31, `sql` 29 (28 migrations + 1 bootstrap), `js` 19, `html` 16, `png` 15, `css` 4, `ttf` 3. ~65k non-test TS/TSX LOC vs ~47k test LOC (~156 test files). *(Counts from `git ls-files`; `.ts`/`.tsx` LOC via `wc -l`.)*

### Git provenance
Single author (`avina <whhoohh@gmail.com>`), 77 commits, 2026-09-25 → 2026-10-21, no tags, **no submodules**, **no vendored code**, one remote (`origin → github.com/AvinashBayya/vestigo_v1`). See [09-references-and-repo-links.md](09-references-and-repo-links.md).

---

## 2. Workspace map

```
apps/
  api/        Fastify 5 HTTP API — routes + guards + identity wiring only (no business logic)
  web/        React 19 SPA (Vite 8) — talks only through the generated OpenAPI client
  worker/     BullMQ worker; one codebase deployed as pools selected by WORKER_QUEUES
packages/
  core/           domain types, evidence/entity model, target detection — depends on NOTHING in-repo
  access/         permission catalogue, plan & vetting, API-key hash/verify, person-gate — pure, deps: core only
  case-engine/    case analysis over stored records — pure (no I/O/clock/randomness), deps: core only
  collectors/     collector SDK, source catalogue, registry, licence gating, the ONE outbound fetcher
  osint-engine/   orchestration: planner, dispatch gates, result→evidence, fusion/merge, jobs, reports
  llm/            open-weight LLM provider interface, routing, framing, citation validation, guards, cache, metering
  db/             Drizzle schema, migrations, RLS policies, repositories, content store
  integrations/   credential vault, API-key storage, rate limiters, circuit breaker, report exporters
  config/         env Zod schema, tsconfig/eslint/prettier/vitest, source-guard scripts, PRODUCT_NAME
  ui/             shadcn/radix component library + design tokens (no-raw-hex guard)
  media-forensics/ PLACEHOLDER — not built (0 src, 0 tests)
infra/postgres/init/  01-bootstrap.sql (role + extension bootstrap; only superuser-run file)
docs/                 ADRs, plans, audits, design mockups
data/, apps/worker/data/  content-addressed evidence/report stores (gitignored)
legacy/               READ-ONLY previous codebase ("Sentinel AI"), ~7.7 MB / 475 files, 0 tracked
```

Package-boundary rules are **enforced in CI** by `packages/config/scripts/boundaries.test.ts`: `core` depends on nothing `@repo/*`; `access` only on `core`; `case-engine` only on `core`; `collectors` has no db/redis/integrations dependency.

---

## 3. Dependency inventory (from each `package.json`, verified against `pnpm-lock.yaml`)

### Backend / API (`apps/api`)
`fastify ^5.12.5`, `@fastify/swagger ^9.9.0` (OpenAPI generation), `fastify-type-provider-zod ^7.0.0`, `better-auth ^1.7.6` (identity), `zod ^4.6.5`, `openapi-types`, `pg ^8.23.0` (dev). Workspace deps: access, collectors, config, core, db, integrations, osint-engine.

### Worker (`apps/worker`)
`pino 10.3.1` (logging). Workspace deps: collectors, config, core, db, integrations, llm, osint-engine. (BullMQ/ioredis arrive transitively through osint-engine/integrations.)

### Frontend (`apps/web`)
`react ^19.3.0`, `react-dom ^19.3.0`, `@tanstack/react-router ^1.170.41`, `@tanstack/react-query ^5.104.1`, `@tanstack/react-table ^9.2.6`, `cytoscape ^3.34.3` (graph), `openapi-fetch ^0.17.0`, `zod ^4.6.5`, `zustand ^5.0.15` **(declared but UNUSED — see [08](08-code-quality-and-tech-debt.md))**, `tailwindcss ^4.3.3`, `@tailwindcss/vite`, `lucide-react ^1.50.0`, `uqr ^0.1.3` (QR), `@fontsource/ibm-plex-*`. Dev: `vite ^8.3.0`, `vitest ^5.0.1`, `openapi-typescript ^7.13.0`, jsdom, testing-library.

### Packages of note
- `collectors`: `libphonenumber-js 1.13.14` (phone analysis), `zod`.
- `db`: `drizzle-orm ^0.45.3`, `pg ^8.23.0`, `drizzle-kit ^0.31.11` (dev).
- `integrations`: `ioredis ^6.0.0`, `pdf-lib 1.17.1` + `@pdf-lib/fontkit 1.1.1` (PDF reports), `pdfjs-dist 6.3.289` (dev, PDF assertions).
- `osint-engine`: `bullmq 6.3.10`, `ioredis` (dev), `zod`.
- `llm`: `zod` only at runtime (**no vendor AI SDK**); `ioredis` dev-only.
- `ui`: `radix-ui ^1.6.7`, `class-variance-authority`, `clsx`, `tailwind-merge`.
- `config`: `@eslint/js ^10`, `typescript-eslint ^8.70`, `eslint-config-prettier`, `eslint-plugin-react-hooks`, `zod`.

**Supply-chain posture:** `pnpm-workspace.yaml` sets `minimumReleaseAgeStrict: true` (rejects too-new releases) and denies dependency build scripts except an explicit allow-list (`esbuild:false`, `msgpackr-extract:false`). CI installs with `--frozen-lockfile`.

---

## 4. Entry points

| Process | Entry | Notes |
|---|---|---|
| API server | `apps/api/src/server.ts` (`buildApp` in `app.ts:63`) | `app.listen({host: API_HOST, port: API_PORT})` `server.ts:162`; refuses to boot unless the identity DB role is isolated (`authStore.verifyRole()` `server.ts:61-62`) |
| Worker | `apps/worker/src/index.ts` → `startWorker` (`worker.ts:99`) | SIGTERM/SIGINT graceful drain; pools selected by `WORKER_QUEUES` |
| Web | `apps/web/src/main.tsx` → `apps/web/src/router.tsx` | TanStack Router, all screens lazy chunks |
| Migrations | `packages/db/scripts/migrate.ts` → `migrateDatabase()` | refuses to run as superuser/BYPASSRLS |
| Seed | `packages/db/scripts/seed.ts` | two placeholder dev tenants; no gate bypass |
| Tenant provisioning | `apps/api/scripts/provision-tenant.ts` | the only invitation-bypass path; password via env, never argv |
| OpenAPI emit | `apps/api/scripts/emit-openapi.ts` | writes `apps/api/openapi.json` (gitignored artifact) |
| Web client gen | `apps/web/scripts/generate-client.ts` | `openapi-typescript` → `apps/web/src/client` (gitignored) |
| LLM live eval | `packages/llm/scripts/eval-live.ts` | not in CI; needs a configured provider |

No cron/scheduler process exists yet (the `monitors` table and `schedule_cron` column exist but nothing sweeps them — see [06](06-database-and-data-model.md)).

---

## 5. Build / run tooling

- **Turbo tasks** (`turbo.json`): `build` (→ `^build`, `generate`), `generate` (OpenAPI/web client), `typecheck`, `lint` (→ `//#format-check`), `test`. The `test` task depends on `@repo/config#fabrication-check` and `@repo/config#check-exports`, so both source guards must pass before any package's tests run.
- **Scripts:** root `package.json` exposes `build/dev/lint/typecheck/test/format/db:migrate/db:seed`.
- **Lint/format:** shared flat ESLint (`strictTypeChecked`, type-aware) banning `any`-comments without ≥10-char reason and banning Bun globals/imports; Prettier `printWidth:100`.

---

## 6. Generated vs source vs ignored

| Kind | Paths | Tracked? |
|---|---|---|
| Generated (gitignored) | `apps/api/openapi.json`, `apps/web/src/client/`, `dist/`, `.turbo/`, `coverage/` | no |
| Runtime data (gitignored) | `data/content-store/`, `apps/worker/data/` | no |
| Secrets (gitignored) | `.env`, `.env.*` (only `.env.example` committed) | no |
| Local tooling (gitignored) | `.claude/` | no |
| Reference (gitignored) | `legacy/` | no |

Largest *tracked* files are legitimate: 3 NotoSerif TTF fonts (~500 KB each, for PDF reports) in `packages/integrations/assets/fonts/`, 15 design mockup PNGs (267–444 KB), `docs/PLAN.md` (~300 KB), `pnpm-lock.yaml` (284 KB). No build output, archives, certs or key material tracked.

---

## 7. Dead / unused / abandoned

- **`zustand`** declared in `apps/web/package.json:34` but a repo-wide grep finds no usage — unused dependency.
- **`pgvector` extension** installed in bootstrap/migrations but **no vector/embedding/RAG code uses it** (confirmed across `packages/llm` and `packages/db`); reserved for the ADR's deferred graph/embedding work.
- **`services/vision`, `infra/` tool containers, Dockerfiles** — referenced by CLAUDE.md §6 / ADRs but not present.
- **`packages/media-forensics`** — placeholder manifest only.
- Two PERMITTED catalogue sources (`gdelt-events`, `safecast`) have **no registered collector** (declared, unused).
- `declareCollector` (no-implementation path) and `HELD_PLATFORM_COLLECTORS` are present but unused by the shipped platform list.

No duplicated/copy-pasted module logic was found in shipped `packages/` (the one deliberately-duplicated-looking area, the person-gate, is actively prevented from being copied by a CI guard).

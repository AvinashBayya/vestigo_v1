# System Specification

Status: descriptive snapshot, generated 2026-11-09 from the source tree on branch
`feature/m5-article-synthesis`. This document captures **what exists and how it is structured**,
for engineers onboarding to or reviewing the codebase. It is descriptive only — no
recommendations, risk analysis, or policy discussion. Architecture *rationale* (why the choices
were made) lives in [ARCHITECTURE-DECISIONS.md](ARCHITECTURE-DECISIONS.md); the standing rules live
in [../CLAUDE.md](../CLAUDE.md).

Secrets are referred to by their environment-variable **name** only; no secret values are read,
requested, or inferred anywhere in this document. Components that need a secret are described as
"configured via environment".

---

## 1. Project overview

Vestigo is a commercial, **multi-tenant SaaS OSINT (open-source intelligence) investigation
platform**. End to end: an analyst in a tenant organisation opens an *investigation* into a target
(a domain, IP, email, phone, username, organisation, URL, file, or free-text topic); the backend
*plans* which collectors can legally and technically run for that target, fans the work out to
background jobs that each query one upstream open-source data provider through a locked-down
fetcher, writes every successful result as content-addressed **evidence** with a provenance label
and a claim-strength label, then *fuses* the evidence into entities, relationships and claims.
Analysts watch progress live over a server-sent-event stream, explore results in a tabbed
workspace (entities, evidence, timeline, graph, …), pin findings to *cases*, run derived *case
analyses*, and generate cited *reports* (optionally with an LLM-written synthesis) exportable as
PDF/JSON/CSV/Maltego. The product's defining constraint is that it **never fabricates data**: an
unmeasured value is rendered as an em dash with an explanation, never a plausible guess, and this
is enforced by repository build gates and tests.

- **Primary users:** analysts and administrators inside tenant organisations (mixed buyer base per
  the architecture record: enterprise security, government/law enforcement, corporate due
  diligence), reached through per-plan module gating. There is no open sign-up; membership is by
  invitation. MFA (TOTP) is mandatory for every account.
- **Single main workflow:** *target → investigation → run → collect → fuse → explore → (pin to
  case / generate report)*.

The product name is defined once, as `PRODUCT_NAME` in `packages/config`, and read from there
everywhere it is displayed.

---

## 2. System architecture

### 2.1 Component diagram (text)

```
                            Browser (analyst)
                                  │
                      React SPA (apps/web, Vite)
                      — generated API client only —
                                  │  HTTPS, same-origin; cookies (session) or Bearer ak_ (API key)
                                  │  dev: Vite proxies /api and /health to the API
                                  ▼
        ┌───────────────────────────────────────────────────────────┐
        │  Fastify API (apps/api)   /api/v1 + /api/auth               │
        │  routes · HTTP guards · identity wiring · OpenAPI 3.1       │
        │  (no business logic — that lives in packages/*)             │
        └───────────────────────────────────────────────────────────┘
             │ enqueue (BullMQ)        │ read/write            │ identity
             │                         │ (app_runtime role)    │ (app_auth role)
             ▼                         ▼                       ▼
        ┌─────────┐          ┌──────────────────┐     ┌──────────────────┐
        │  Redis  │◄────────►│  Postgres 17     │     │  Better Auth     │
        │ queues, │  job     │  + pgvector      │     │ (self-hosted,    │
        │ rate-   │  state   │  RLS, 3 roles,   │     │  mounted at      │
        │ limits, │  truth = │  partitioned     │     │  /api/auth; auth │
        │ breaker,│  Postgres│  evidence        │     │  schema in same  │
        │ LLM     │          └──────────────────┘     │  Postgres)       │
        │ cache   │                   ▲                └──────────────────┘
        └─────────┘                   │ evidence rows + content refs
             ▲                        │
             │ consume queues         │ content-addressed raw payloads
             │                        ▼
        ┌───────────────────────────────────────────────────────────┐
        │  Worker (apps/worker) — one codebase, deployed as pools    │
        │  queues: investigations · collect.<source> · fusion ·      │
        │  reports · report-renders · case-analyses · extractions ·  │
        │  dead-letter                                               │
        └───────────────────────────────────────────────────────────┘
             │ the one SSRF-checked fetcher (packages/collectors)
             ▼
   External upstreams (read-only HTTP/S): GDELT, Wikidata, crt.sh, Cloudflare DoH,
   RDAP registries, Wayback, GitHub, Hacker News, DEV.to, Common Crawl, Bluesky,
   Reddit, Telegram (t.me), ~217 RSS publishers, direct article hosts
             │
             ▼
   LLM endpoint (OpenAI-compatible): hosted open-weight API (default) OR
   self-hosted vLLM (built, disabled by default, GPU)

   Content store: filesystem (CONTENT_STORE_DIR) today; S3-compatible backend
   behind the same interface is not built yet.
```

### 2.2 Where each component runs

| Component | Runs where |
|---|---|
| Web SPA (`apps/web`) | The analyst's **browser**. Built by Vite; intended to be served as static files from a CDN. Dev server on `http://localhost:5173`, proxying `/api` and `/health` to the API. |
| API (`apps/api`) | A Node 24 process. Local dev on `127.0.0.1:3000`. Not containerised in-repo. |
| Worker (`apps/worker`) | A Node 24 process; one codebase deployed as multiple **pools** selected by the `WORKER_QUEUES` env var. Not containerised in-repo. |
| Postgres 17 + pgvector | **Docker Compose** locally (`pgvector/pgvector:0.8.6-pg17-trixie`, pinned), `127.0.0.1:5432`. Production target: a managed Postgres. |
| Redis | **Docker Compose** locally (`redis:8`), `127.0.0.1:6379`. |
| vLLM (optional) | **Docker Compose** behind the `llm-selfhosted` profile (off by default; needs an NVIDIA GPU), image pinned by digest, serves OpenAI-compatible API on `127.0.0.1:8000`. |
| Better Auth (identity) | In-process inside the API (self-hosted), mounted at `/api/auth`; its tables live in the same Postgres under the `auth` schema. |

The architecture record states the production target is a managed container service with rolling
deploys (no Kubernetes at launch); the cloud provider is undecided, so only portable building
blocks are used. No application-tier Dockerfiles exist in the repo today — Compose provides only
the backing services.

### 2.3 How components communicate

- **Browser → API:** HTTPS, same-origin. The SPA calls only a **generated typed client** built
  from the API's OpenAPI document; it can do nothing the public API cannot. Session auth is carried
  by a cookie (`better-auth.session_token`); API-key auth is `Authorization: Bearer ak_…`.
- **API → Worker:** indirectly, via **BullMQ on Redis**. The API *enqueues* work (a run's planning
  job, a report, a case-analysis attempt, a job replay) and never performs collection itself.
  Postgres is the source of truth for every job's state; BullMQ only delivers work. Queue messages
  carry **ids only**, never target values, and are schema-validated on receipt.
- **API/Worker → Postgres:** via Drizzle, only inside a per-tenant transaction (`db.withTenant`).
- **Worker → external upstreams:** HTTP/HTTPS through the single SSRF-protected fetcher.
- **Worker → LLM:** HTTP REST (OpenAI-compatible `/chat/completions`).
- **Live progress → browser:** Server-Sent Events (`text/event-stream`) over the same HTTP origin.
- There is **no GraphQL, no tRPC, no message bus beyond Redis/BullMQ, and no inter-service RPC** —
  it is a modular monolith plus worker pools, not microservices.

---

## 3. Technology stack

### 3.1 Languages, runtime, build

- **Language:** TypeScript (strict; no `any` in committed code). One language across frontend,
  backend and workers.
- **Runtime:** Node (`engines.node >= 24.0.0`) everywhere — dev, test, production. Bun is explicitly
  not used.
- **Package manager / monorepo:** pnpm (`packageManager: pnpm@12.6.0`, pinned) with workspaces;
  **Turborepo** orchestrates `build / lint / typecheck / test / generate`. `minimumReleaseAgeStrict`
  is on as a supply-chain guard.
- **Tests:** Vitest across every package; Testing Library for components (Playwright named for
  critical flows in the architecture record).
- **Lint/format:** type-aware ESLint (zero warnings allowed) + Prettier.

### 3.2 Backend

- **Framework:** Fastify with `fastify-type-provider-zod`. The OpenAPI 3.1 document is **generated
  from the same Zod schemas** that validate requests (`@fastify/swagger`); the web client is
  generated from that document. Public contract version `0.4.0`; request timeout 30 s.
- **Errors:** typed, machine-readable codes (RFC 9457 problem-details shape); cursor pagination;
  idempotency keys on work-starting endpoints; SSE for live progress.
- **Identity:** Better Auth (self-hosted) with its organisation plugin (teams, roles, invitations);
  TOTP MFA mandatory.

### 3.3 Frontend

- React 19 + **TanStack Router** (lazy/code-split routes) + **TanStack Query** (server-state cache;
  `retry: false`). **TanStack Table** for grids. Tailwind v4 (`@tailwindcss/vite`) + a shared
  `@repo/ui` (shadcn-based) component library. **Cytoscape** for the graph tab (lazy-loaded).
  `openapi-fetch` for the generated client. `uqr` for TOTP QR codes; `lucide-react` icons;
  `@fontsource` IBM Plex Sans/Mono.
- Declared but **not used:** `zustand` (no imports found). Named in the architecture record but
  **not present** in `apps/web`: Recharts (the one chart, a timeline strip, is hand-rolled inline
  SVG) and MapLibre GL (the Map tab is an explicit "not built" stub).

### 3.4 Data stores, cache, queues

- **Postgres 17** (single source of truth) + **pgvector** extension *enabled* (the extension is
  installed and asserted by a schema test, but **no table defines a `vector`/embedding column yet** —
  it is provisioned but unused by the current schema). Full-text + trigram search available.
- **Redis** (`redis:8`) — BullMQ job queues, LLM response cache, rate-limit counters, short-lived
  collection locks, circuit-breaker state.
- **Content store** — content-addressed raw-payload storage. Only `FileSystemContentStore` exists
  (rooted at `CONTENT_STORE_DIR`); the S3-compatible production backend behind the same interface
  is not built yet.

### 3.5 Deployment / orchestration

- **Local:** Docker Compose (`docker-compose.yml`) for Postgres+pgvector and Redis (both bound to
  `127.0.0.1`), plus an optional GPU vLLM service behind the `llm-selfhosted` profile.
- **DB bootstrap:** `infra/postgres/init/01-bootstrap.sql` creates the three roles and extensions on
  first volume init.
- **CI:** a single GitHub Actions workflow (`.github/workflows/ci.yml`), job `verify` on
  `ubuntu-latest`: checkout → Node 24 → `corepack` (pnpm) → `pnpm install --frozen-lockfile` →
  `docker compose up -d --wait postgres redis` → fresh `AUTH_SECRET`/`VAULT_MASTER_KEY` per run →
  `pnpm turbo build lint typecheck test`. The release-blocking gates run inside `test`. No live
  external APIs are called in CI (fixtures/mocks only).
- **Kubernetes:** not used at launch (per the architecture record).

---

## 4. Collection / worker layer

### 4.1 The collector model (SDK)

A **collector** is a pure async function of `(target, credentials, fetch)` that returns a typed
outcome (`packages/collectors/src/contract.ts`). It has **no database access and no network access
except the one `fetch` it is given**, enforced by lint rules and a dependency test. A collector
*declares*, as data, its `id`, `version`, `displayName` (which becomes the evidence label — a
collector cannot set its own source label), `discipline`, accepted `targetTypes`, `collectionMode`,
its single `source` (catalogue id), credential `vaultIds` + whether it `runsWithout` them,
`claimStrength`, run `timeoutMs`, and a Zod `resultSchema`.

- `defineCollector(...)` = implemented; `declareCollector(...)` = listed-only placeholder. **Every
  registered collector is implemented** — there are no placeholder collectors in the registry.
- Collector code can only return via `found()` / `notFound()` / `emptyUnconfirmed()`; return values
  are branded with the run's symbol so the runtime rejects anything it did not produce. Failures are
  **thrown as typed errors**, never returned as an empty success.

**Outcome set (7 statuses):** `FOUND`, `NOT_FOUND`, `EMPTY_UNCONFIRMED`, `FAILED`, `UNAVAILABLE`,
`NEEDS_CREDENTIALS`, `REFUSED`. Only `FOUND` writes evidence (an empty/zero result is refused as
FOUND). `EMPTY_UNCONFIRMED` exists for sources whose empty answers are unreliable (e.g. GDELT): the
collector must flag `emptyAnswersUnreliable` and return `emptyUnconfirmed()`, and the runtime
refuses a `notFound()` from it. `claimStrength` on evidence is one of `OBSERVED | REPORTED |
DERIVED` (DERIVED only for `LOCAL_ANALYSIS` collectors).

**Writing evidence (one path):** the runtime validates a FOUND result against its Zod schema,
checks every cited response was captured this run with a 2xx status, enforces a non-empty result,
and enforces a **provenance rule** — every scalar outside a `derived` key must literally appear in
the cited response bytes, or the result is rejected. Evidence is then written only through
`packages/osint-engine` `CollectionExecutor.persistEvidence`, which stores each raw payload in the
content store by hash and writes one evidence row carrying collector id+version, the payload's
source URL, `observed_at` (from upstream data; **null** when the upstream gives none — never the
clock) and `collected_at` (measured). The database independently refuses evidence from any collector
whose tenant registry row is not enabled.

### 4.2 The fetcher (the one way out)

`createUpstreamFetch` (`packages/collectors/src/fetcher/`) is the single network egress, bound to a
collector's source. Every request passes: method allowlist (GET/HEAD/POST) and header allowlist
(UA/host/cookie/encoding are fetcher-controlled, CR/LF/NUL rejected); scheme must match the source;
no credentials-in-URL and no explicit port; **host must be in the source's allow-set**; DNS
resolution with **every resolved address checked public** (full RFC-6890 private/loopback/link-
local/CGNAT/cloud-metadata/IPv6-ULA set blocked); **address pinning** (connects to the exact checked
address, no second lookup — anti-rebinding), with TLS still verifying the hostname cert; redirects
≤ 5 hops, each re-checked against the same allow-set (POST not auto-followed); a mandatory whole-call
timeout ≤ 60 s; a size cap (default 5 MiB, max 50 MiB) with bounded decompression; a fixed platform
user-agent; a **shared rate limit** per source (Redis sliding-log, across all workers), failing
**closed** when Redis is unavailable; per-request metering; and secret scrubbing from any recorded
URL. The one open-host source (`direct-article`) binds the fetch to the authorised target's own
single host under the identical checks.

### 4.3 Registered collectors

The platform registry (`packages/collectors/src/platform/index.ts`) registers **232 collectors**:
15 distinct ones plus one RSS collector per publisher (**217 publishers, 236 feeds**). Every source
carries an explicit **commercial-use verdict** (`PERMITTED | BLOCKED | UNVERIFIED`) in
`catalogue.ts`; **only PERMITTED sources run** — BLOCKED never runs, and UNVERIFIED never runs in a
deployment until an owner records the source's terms (UNVERIFIED collectors execute only against
recorded fixtures in tests). Net effect today: **only three registered collectors sit on PERMITTED
sources and are runnable in production — `contact.phone`, `wikidata`, `news`.**

| id | discipline | target types | mode | source | strength | credential (vault id) |
|---|---|---|---|---|---|---|
| `crtsh` | TECHINT | DOMAIN | PASSIVE_API | crt.sh *(UNVERIFIED)* | REPORTED | — |
| `dns` | TECHINT | DOMAIN | PASSIVE_API | Cloudflare DoH *(UNVERIFIED)* | REPORTED | — |
| `rdap` | TECHINT | DOMAIN | PASSIVE_API | RDAP *(UNVERIFIED)* | REPORTED | — |
| `wayback` | MEDIAINT | DOMAIN, URL | PASSIVE_DATASET | Wayback CDX *(UNVERIFIED)* | REPORTED | — |
| `contact.phone` | PERSON | PHONE_NUMBER | **LOCAL_ANALYSIS** | libphonenumber-js *(PERMITTED)* | **DERIVED** | — (no network) |
| `wikidata` | SOCMINT | ORGANIZATION | PASSIVE_API | Wikidata *(PERMITTED)* | REPORTED | — |
| `github` | SOCMINT | USERNAME | PASSIVE_API | GitHub API *(UNVERIFIED)* | REPORTED | `github` (optional) |
| `hackernews` | SOCMINT | USERNAME | PASSIVE_API | Hacker News *(UNVERIFIED)* | REPORTED | — |
| `devto` | SOCMINT | USERNAME | PASSIVE_API | DEV.to *(UNVERIFIED)* | REPORTED | — |
| `commoncrawl` | TECHINT | DOMAIN | PASSIVE_API | Common Crawl *(UNVERIFIED)* | REPORTED | — |
| `news` | MEDIAINT | DOMAIN, TOPIC | PASSIVE_API | GDELT DOC *(PERMITTED)* | REPORTED | — (empty→EMPTY_UNCONFIRMED) |
| `bluesky.search` | SOCMINT | TOPIC | PASSIVE_API | Bluesky *(UNVERIFIED)* | OBSERVED | `bluesky` (optional) |
| `reddit.search` | SOCMINT | TOPIC | PASSIVE_API | Reddit *(UNVERIFIED)* | OBSERVED | `reddit-api` (optional) |
| `telegram.channel` | SOCMINT | USERNAME | PASSIVE_PUBLIC_WEB | Telegram preview *(UNVERIFIED)* | OBSERVED | — |
| `rss.<domain>` ×217 | MEDIAINT | TOPIC | PASSIVE_PUBLIC_WEB | one RSS source each *(UNVERIFIED)* | OBSERVED | — |
| `article` | MEDIAINT | URL | **ACTIVE** | direct-article (open-host) *(UNVERIFIED)* | REPORTED | — |

`catalogue.ts` additionally lists many sources that have **no collector**, registered only for
visibility of their verdict: BLOCKED (e.g. Shodan InternetDB, YouTube, OpenSky, local-network-scan)
and UNVERIFIED (e.g. HIBP, Gravatar, the GPL/AGPL "tool container" sources SpiderFoot /
theHarvester / SearXNG / IVRE, Kpler, etc.). These never run by any path.

### 4.4 Implementation mechanism

**Most implemented collectors collect via a library HTTP call through the provided `fetch`**, with
HTML/JSON parsing dependency-free (bounded regex / Zod) in-process. Two kinds of collector do not use
`fetch`: `contact.phone`, a **local library analysis** (`libphonenumber-js`, no network at all); and
the **Agent-Reach tool-container channels** (added 2026-11-11), the first **subprocess / tool
container** in the repo. A tool-container collector is `LOCAL_ANALYSIS`/DERIVED: it runs the
container argv-only (no shell), bounded by a timeout and an output cap, through the one subprocess
runner (`packages/collectors/src/tool/container.ts`), and records what the container prints as its
evidence. The container does its own egress, so the in-process fetcher's SSRF and forbidden-platform
guards neither see nor bound it — these are operator-configured local adapters (CLAUDE.md §3), and the
guards stay fully intact for every `fetch`-based collector. Several collectors make multiple requests
internally (e.g.
`github` profile→repos→commits; `wikidata` search→get; `article` fetch→in-process extract;
`bluesky`/`reddit` open vs. credentialed session paths), but **no collector falls back to a
different source** — a fallback would have to be its own registered collector with its own verdict
(the source-labelling invariant).

Registered in Phase 1 (2026-11-10): `braveSearchCollector` (Brave Search API) is in the
`PLATFORM_COLLECTORS` array and dispatchable through the collector runtime, on the now-PERMITTED
`brave-search` source (`official` method, `runsWithout: false`). Separately, its
`BraveSearchDiscoveryProvider` is used by the search-discovery path outside the collector runtime.

Registered 2026-11-11: the **Agent-Reach tool-container channels** — 14 `LOCAL_ANALYSIS`/DERIVED
collectors (`agent-reach.web`, `.github`, `.youtube`, `.v2ex`, `.bilibili`, `.xueqiu`, `.xiaoyuzhou`,
`.boss`, `.x`, `.linkedin`, `.reddit`, `.xiaohongshu`, `.facebook`, `.instagram`), each on a
`network: null` source that is **PERMITTED by the operator's recorded decision** (CLAUDE.md §3:
operator-configured local adapters; the operator owns each platform's terms and enables/disables each
channel per deployment via `agent-reach add/remove` and the tenant registry's `enabled` flag). The
people-centric channels are PERSON-discipline, so the plan/vetting gate applies. The worker launches
the container only when `AGENT_REACH_ENABLED=true` (`configureAgentReach`); unconfigured, the channels
report the tool unavailable rather than guessing. The container (`infra/agent-reach`) and its
per-channel output field mapping are confirmed against a live run as a follow-up; the collector,
runner, schema and gating are covered offline.

### 4.5 Authentication / credentials for collectors

No collector credential is ever an environment variable (a config test fails if one is). Credentials
live per-tenant in the envelope-encrypted **vault** and are revealed to a collector only when a
keyed access method is actually enabled in the deployment; each reveal is audited. The credentialed
registered collectors all use the `official` method and all `runsWithout: true` (so they also run
unauthenticated, usually at a lower rate limit): `github` (`github`, bearer token),
`bluesky.search` (`bluesky`, `{identifier, appPassword}`), `reddit.search` (`reddit-api`,
`{clientId, clientSecret}` → token exchange). The registered `brave-search` collector uses the
`brave-search` vault id with `runsWithout: false`. Inside a run, a collector reads `ctx.credentials.get(id)`
and only calls `.expose()` when building the request; secret values are scrubbed from recorded URLs.

### 4.6 Gates before a collector runs

Enforced in `packages/collectors/src/runtime.ts` (and re-enforced in the executor and job
processor):

1. **Licence** — BLOCKED → `REFUSED LICENCE_BLOCKED`; UNVERIFIED → `REFUSED
   UNVERIFIED_SOURCE_NOT_ALLOWED`.
2. **Access method enabled** — the deployment's `COLLECTORS_ACCESS_METHODS` must enable a usable
   method and the verdict must be PERMITTED, else `REFUSED ACCESS_METHOD_NOT_ENABLED` (default
   enabled set: `open, official, licensed`; never `operator`).
3. **Implementation exists** → else `REFUSED NOT_IMPLEMENTED`.
4. **Target type accepted** and **target valid** (parsed/normalised).
5. **Plan + vetting** (discipline module gate) → `REFUSED MODULE_NOT_IN_PLAN | VETTING_NOT_APPROVED`.
6. **Person target-type gate** — a `TOPIC` target is person data whatever collects it, so it needs
   the person module's plan + vetting.
7. **ACTIVE scope authorisation** — an ACTIVE collector (only `article`) needs an in-force
   `scope_authorisations` row matching the exact target, else `REFUSED
   SCOPE_AUTHORISATION_REQUIRED`.
8. **Credentials present** for a runnable keyed method → else `NEEDS_CREDENTIALS` (unless it can run
   open).
9. Operationally, the job processor additionally checks the tenant's **usage quota** (→ `REFUSED
   QUOTA_EXCEEDED`) and the per-source **circuit breaker** (→ `UNAVAILABLE CIRCUIT_OPEN`) before
   dispatch.

### 4.7 The worker

`apps/worker` is one codebase whose composition root (`worker.ts`) wires Postgres, Redis, the
collector runtime, content store, executor (+ vault credential source), job processor (+ Redis
circuit breaker), the LLM client, and the report / case-analysis / article-extraction processors,
then starts a worker pool over the queues named in `WORKER_QUEUES` (exact name, `collect.*` glob, or
`*`). Queues (`packages/osint-engine/src/jobs/queues.ts`):

| Queue | Work | Concurrency / bulkhead |
|---|---|---|
| `investigations` | One planning job per run (`RunCoordinator.plan`) → emits the run flow | 4 |
| `collect.<sourceId>` | That source's collector jobs (one queue **per upstream source**) | `COLLECT_CONCURRENCY` (global, per source) |
| `fusion` | Flow parent per run; waits for all children, then `RunFusion.fuseRun`; fans out article extractions when a model is configured | 4 |
| `reports` | Report generation (assembly + optional LLM synthesis) | `REPORT_CONCURRENCY` (global) |
| `report-renders` | PDF render of a generated report | `REPORT_RENDER_CONCURRENCY` (global) |
| `case-analyses` | One attempt at a case analysis (passive; reads stored records) | `CASE_ANALYSIS_CONCURRENCY` (global) + per-job timeout |
| `extractions` | One article prose extraction per FOUND article job (LLM) | `EXTRACTION_CONCURRENCY` (global) |
| `dead-letter` | Terminal record of jobs that ran out of attempts; nothing consumes it | — |

A collector job runs in three steps so no DB transaction is open during network I/O: **claim**
(lock row, skip if already finished, check quota, count the attempt, → RUNNING), **collect** (circuit
admit → executor runs the collector with a usage meter → circuit record), **record** (lock row again;
FOUND persists evidence + result + usage in one transaction; other outcomes record their typed
error; a job another delivery already finished is left untouched).

---

## 5. Data flow

### 5.1 Step by step

1. **User action.** An analyst creates an investigation (`POST /api/v1/investigations` with a title
   and a target string) and starts a run (`POST /api/v1/investigations/:id/runs`, optional
   `targetType` and a `collectorIds` source filter).
2. **Frontend request.** The SPA calls these through the generated typed client (same origin; session
   cookie or API key). Every call has a 15 s client-side timeout.
3. **Backend admission + enqueue.** The run route checks the tenant's **usage quota**, creates the
   `runs` row (recording, at creation, whether the run **rests on person data**), applies the shared
   **person gate** (`requirePersonAccess`), and enqueues the run's planning job on the
   `investigations` queue *inside the run's own transaction*. It returns `202` with the QUEUED run;
   collection happens in the background. (A refused person run rolls back whole — no run exists.)
4. **Planning.** The worker's `RunCoordinator.plan` loads the investigation, detects/normalises the
   target type(s), and asks the planner which collectors are admitted. The plan records **every
   excluded collector with a machine-readable reason** (e.g. `TARGET_TYPE_NOT_ACCEPTED`,
   `LICENCE_BLOCKED`, `NOT_SELECTED`). It creates one `jobs` row per admitted collector (idempotency
   key = tenant+run+collector+target+params) and transitions the run to RUNNING (or FAILED if there
   is nothing to dispatch).
5. **Fan-out.** A BullMQ **flow** is added: a `fuse-<runId>` parent on `fusion`, with one
   `collect.<sourceId>` child per job (`ignoreDependencyOnFailure: true`, so a failed collector never
   fails the run).
6. **Collection.** Each child job runs the three-step collector job (§4.7). FOUND writes
   content-addressed evidence; NOT_FOUND / EMPTY_UNCONFIRMED record no evidence; failures record a
   typed error; only `UNAVAILABLE` is retried (backoff), and its last attempt dead-letters.
7. **Fan-in (fusion).** When all children settle, the `fusion` parent runs `RunFusion.fuseRun`: for
   each FOUND job (idempotent per job via `jobs.fused_at`), a per-collector **extractor** turns the
   recorded result into **entities** (resolved by kind + normalised identifier; persons/orgs without
   an external identifier are always new entities — never auto-merged by name), **relationships**,
   and **claims** (each citing an evidence id, each carrying a strength label; values/strengths are
   read from the result, never from the extractor). The run's status is settled: `SUCCEEDED` (all
   jobs succeeded), `PARTIAL` (some failed), or `FAILED` (none succeeded). When a model is configured,
   fusion then fans out one article prose **extraction** per FOUND article job.
8. **Result storage / correlation.** All of the above lands in Postgres (tenant-scoped). Raw payloads
   live in the content store, addressed by SHA-256 and namespaced per tenant; evidence rows hold the
   hash + a content-store ref, re-hashed and verified on every read.
9. **Display.** The analyst watches live progress and then explores results:
   - **Live progress:** `GET /api/v1/runs/:id/events` streams SSE `run` / `job` / `end` / `timeout`
     / `error` / `locked` events; the `/runs/:runId` screen renders them from local state. Access is
     **re-checked on every poll**, and a refusal closes the stream with a `locked` event (the stream
     never outlives the access that opened it).
   - **Results workspace:** `/runs/:runId/:tab` (and `/cases/:caseId/:tab`) renders tabs — Overview,
     Entities, Graph, Timeline, Evidence, Media, Map, Report — reading through TanStack Query
     (`workspace/queries.ts`, list limit 500 with explicit "partial" notices). Run-scope tabs poll
     every 3 s until the run is *settled*; case-scope shows only pinned items. A Provenance drawer
     opens from any value; raw payloads download as `application/octet-stream` attachments (never
     rendered in-app). Map and Media tabs are "not built" stubs.

### 5.2 What is stored where, in what format

- **Postgres** (relational, tenant-scoped) — structured domain data: investigations, runs, jobs
  (with `result` jsonb and the planner's `plan` jsonb), evidence pointers, claims (`value` jsonb),
  entities, relationships, merges, cases, pins, monitors, alerts, reports (`document` jsonb),
  case-analyses, usage events, audit log, plus the per-tenant collectors registry and quotas.
  Identity data (users, sessions, orgs, memberships, invitations, TOTP) lives in the `auth` schema.
- **Content store** (filesystem today) — the **raw upstream payload bytes** for each piece of
  evidence, and generated report PDFs, addressed by SHA-256 under `tenants/<tenantId>/sha256/…`.
- **Redis** — transient operational state: BullMQ queues/flows, rate-limit windows, circuit-breaker
  state, the LLM response cache, and Better Auth's own rate-limit counters.

### 5.3 Correlation / deduplication / enrichment

- **Entity resolution (correlation):** during fusion, one entity per `(kind, normalised identifier)`
  is found-or-created. People and organisations without an external identifier are **always new
  entities** and are never auto-merged on a name match alone; `LOCATION` is covered by the same
  rule. Merges are explicit, reversible records (`entity_merges`) carrying confidence and signals.
- **Deduplication:** raw payloads are **content-addressed** (SHA-256), so identical bytes dedupe at
  the content store; evidence re-verifies bytes against the recorded hash on every read. (pgvector
  is enabled for future semantic dedup/search but no embedding column exists yet.)
- **Enrichment:** article collectors capture prose, and — when an LLM is configured — an
  `extractions` job derives grounded `article_statements` claims (DERIVED) from the article text,
  one per evidence (guarded by a unique index). Case **analyses** (`packages/case-engine`, a pure,
  I/O-free engine) compute coverage, collector breakdown, contradictions and discipline views over a
  case's stored records; freshness is recomputed on every read.

---

## 6. Integrations

All external integrations the running system calls are **read-only lookups** — none mutates external
state. The only writes the platform performs are to its own data stores and content store.

### 6.1 Active data-source integrations (via collectors, HTTP/S through the fetcher)

| Integration | Purpose | Protocol | Read/Write |
|---|---|---|---|
| GDELT DOC 2.0 (`news`) | News coverage for a domain/topic | REST/JSON | read-only |
| Wikidata (`wikidata`) | Entity/org lookup | REST/JSON | read-only |
| crt.sh (`crtsh`) | Certificate-transparency subdomains | HTTP | read-only |
| Cloudflare DoH (`dns`) | DNS-over-HTTPS records | REST/JSON | read-only |
| RDAP registries (`rdap`) | Domain registration data | REST/JSON | read-only |
| Wayback CDX (`wayback`) | Archived captures of a domain/URL | REST | read-only |
| GitHub REST API (`github`) | Public profile/repos/commits | REST/JSON | read-only |
| Hacker News (`hackernews`) | Account via Firebase + Algolia | REST/JSON | read-only |
| DEV.to (`devto`) | Public profile | REST/JSON | read-only |
| Common Crawl (`commoncrawl`) | URL index | REST/JSON | read-only |
| Bluesky (`bluesky.search`) | Public post search (optional session) | XRPC/JSON | read-only |
| Reddit (`reddit.search`) | Public/OAuth post search | REST/JSON | read-only |
| Telegram (`telegram.channel`) | Public channel preview page (`t.me`) | HTTP/HTML | read-only |
| ~217 RSS publishers (`rss.*`) | News/article feeds | HTTP/RSS | read-only |
| Direct article hosts (`article`) | Fetch + parse one authorised article URL (ACTIVE) | HTTP/HTML | read-only |
| libphonenumber-js (`contact.phone`) | Phone metadata | **in-process library** | local, no network |

Of these, only GDELT, Wikidata and libphonenumber-js sit on PERMITTED sources and run in a
deployment today; the rest are UNVERIFIED and gated off until their terms are recorded.

### 6.2 Other integrations

- **LLM endpoint** — an OpenAI-compatible `/chat/completions` service, used for report synthesis and
  article prose extraction. Two configured profiles: **hosted** open-weight API (default; e.g. a
  Hugging Face–style router) and **self-hosted vLLM** (built, disabled unless `LLM_VLLM_ENABLED`).
  Endpoint and key are configured via environment. Model and endpoint are never hard-coded; the
  **model allowlist is reviewed code** (current entries are Apache-2.0 Qwen3 / gpt-oss / Mistral
  variants; Llama-derived and Gemini families are refused, as are Azure OpenAI hosts). Read-only
  (text generation). If unconfigured, synthesis is simply unavailable and says so; the rest of a
  report still generates.
- **Better Auth** — self-hosted identity, mounted at `/api/auth`, backed by the `auth` schema.
- **Postgres / Redis** — the platform's own data stores (§3.4), not third-party APIs.
- **Brave Search API** — reached by the `brave-search` collector (registered Phase 1) and, for the
  search-discovery path, a separate `BraveSearchDiscoveryProvider`; both use a tenant Brave key.
- **Agent-Reach tool container** — the first **subprocess / tool-container** integration (added
  2026-11-11). The worker launches the container (`infra/agent-reach`) one-shot per collection,
  argv-only, to read public-web and platform channels; it is enabled per worker pool with
  `AGENT_REACH_ENABLED`. Read-only. See §4.4.
- **CLI/protocol note:** apart from the Agent-Reach tool container above, there are **no other CLI,
  Playwright/browser-automation, or MCP integrations** in the running system. The GPL/AGPL "tool
  container" sources (SpiderFoot, theHarvester, SearXNG, IVRE) still appear only as catalogue entries;
  their containers are not in the repo.

State-changing actions are confined to the platform's own stores: creating investigations/runs/jobs,
writing evidence/claims/entities, the per-tenant credential vault (envelope-encrypted writes), API
keys, audit log, and usage metering. No integration performs an outward state-changing action.

---

## 7. Failure and recovery

### 7.1 Where code and config live

- **Monorepo root:** `D:\vestigo`. Source under `apps/` (`api`, `web`, `worker`) and `packages/`
  (`core`, `access`, `collectors`, `osint-engine`, `case-engine`, `db`, `integrations`, `llm`,
  `config`, `ui`, `media-forensics`). Infra bootstrap under `infra/postgres/init/`. Docs under
  `docs/`.
- **Generated, git-ignored (never hand-edited):** `apps/api/openapi.json` and `apps/web/src/client/`
  (the typed API client), both produced by the Turbo `generate` task.
- **Config:** server processes validate their environment at startup against the Zod schema in
  `packages/config/src/env.ts`; `.env.example` is **generated** from that schema (a test fails on
  drift) and is the only env file committed. Real `.env` / `.env.*` are git-ignored (two secrets —
  `AUTH_SECRET`, `VAULT_MASTER_KEY` — are supplied from the shell/secret manager, never a file).
- **Runtime data (git-ignored):** the evidence/PDF content store at `CONTENT_STORE_DIR` (e.g.
  `apps/worker/data/`), Docker named volumes `postgres-data` / `redis-data` / `vllm-models`, and the
  Turborepo cache `.turbo/`.
- **`legacy/`** — the previous codebase, git-ignored, read-only reference for porting; never
  imported at runtime.

### 7.2 Version control and local history

- **Git.** Default branch `main`; active work on `feature/m5-article-synthesis`. CI runs on push to
  `main` and all PRs. Migrations are **forward-only** (expand → contract); 29 SQL migrations exist
  (`0000_foundation` … `0028_m4_4b_article_extraction_dedup`).
- **Build-history trail in `docs/`.** Milestone/phase reports (BUILD-PHASES, MASTER-BUILD-SEQUENCE,
  the `M1`…`M5` and `DAY_n` reports, exit reviews) record what each stage changed and verified. The
  architecture record uses dated amendment markers (e.g. D-23, D-30, R1-b).
- **Runtime durability / recovery mechanisms:** Postgres is the source of truth for job state (not
  Redis); jobs are **idempotent** (idempotency keys) so retries never double-charge or duplicate
  evidence; failed jobs land in a **dead-letter queue** and are inspectable/replayable
  (`POST /api/v1/jobs/:id/replay`, itself person-gated); **retries distinguish cause** (only
  `UNAVAILABLE` backs off; auth/invalid-target fail immediately); **circuit breakers** pause a
  failing source; **bulkheads** cap per-source concurrency; every external call has a timeout and
  every enqueue is bounded (no unbounded waits). A crash on a job's last attempt is settled to
  dead-lettered rather than left RUNNING. The architecture record also names PITR backups and object-
  storage versioning as the data-recovery posture (infra target, not in-repo).

### 7.3 Known points where work stopped mid-task / is not yet built

These are places where the code explicitly marks itself incomplete (not defects — documented state):

- **Uncommitted work in progress** on `feature/m5-article-synthesis`: the monitors/alerts/search-
  discovery routes and screens, the Telegram and Brave-Search collectors, and the M5 article-
  synthesis path appear as modified/untracked files in the working tree.
- **Person-investigation collectors** are not built: `apps/api/src/routes/person.ts` throws
  `NotImplementedError` ("Phase 3"). (The person *gate* is fully built; the collectors behind it are
  not.)
- **Retention deletion** is not enforced: a tenant can record a retention window, but
  `settings.ts` states deletion-on-expiry is not built (`enforced: false`). No tenant/case/evidence
  deletion path is wired yet (the architecture record describes the intended cascade).
- **Fusion for `FILE` and `TOPIC` targets** throws `NotImplementedError` (no collector reads FILE
  targets yet; a TOPIC has no entity kind yet).
- **Phase 1 licence flips (2026-11-10):** `crtsh`, `dns`/`cloudflare-doh`, `wayback-cdx`,
  `github-api` and `bluesky` are now PERMITTED (operator verdicts); `reddit-api` stays UNVERIFIED.
  The `brave-search` collector is registered and PERMITTED, and its result now carries computed
  values (`sourceDomain`, counts) under `derived` blocks to satisfy the provenance contract.
- **UI "not built" stubs:** Map tab (no geolocation read / MapLibre deferred), Media tab (no media
  endpoints), Overview "Written summary", Entities "Merge candidates", Settings "API keys"; Members
  and Settings screens are marked "provisional". Credits/cost-after-run display shows "not built"
  honestly rather than a number.
- **S3 content-store backend** is not built (filesystem only); **`services/vision`** (the Python
  FastAPI GPU media-forensics service) is **absent**; **`packages/media-forensics`** is a
  placeholder package with no source; **tool-container Dockerfiles** (SpiderFoot/theHarvester/
  SearXNG/IVRE) are absent.
- **pgvector** is enabled but no embedding column is defined, so semantic dedup/search is not yet
  wired to it.

---

## 8. Open questions

Neutral design questions where the code and the records left something ambiguous:

1. **D-34 (report-generation person-gate re-check).** `CLAUDE.md` §9 lists this as an open gap
   ("Report generation does not yet re-check; … tracked as D-34"), but `reports/generator.ts` has a
   "closes D-34" comment and `reports.test.ts` carries a `RELEASE-BLOCKING, D-34` test. Which is
   authoritative — is D-34 closed, and should the standing rule be updated?
2. **How do scheduled monitors fire?** The `monitors` table carries `schedule_cron` and the API
   manages monitors/alerts, but the worker composition root wires no monitor-scheduling queue or
   process. Is the scheduler-to-run path built yet, and if so where does it live?
3. **`brave-search` registration.** Resolved in Phase 1 (2026-11-10): the Brave collector is
   registered in `PLATFORM_COLLECTORS` and its source is PERMITTED (operator verdict).
4. **Content-store production backend.** The `ContentStore` interface anticipates an S3-compatible
   backend; is there a target implementation/timeline, and does evidence deletion depend on it?
5. **pgvector usage.** The extension is provisioned and asserted but unused by the schema. What is
   the intended first consumer (semantic dedup, embeddings search), and on which table?
6. **Alert delivery.** Alerts are stored and acknowledged in-product; the architecture record
   mentions outbound webhooks. Is any outbound alert delivery built, or is surfacing in the UI the
   only current path?
7. **Retention deletion cascade.** Windows are recorded but not enforced. Is the deletion cascade
   (tenant → analyses/events → evidence/derived data) scheduled for a specific phase?
8. **Operator-collector attachments.** The registry supports operator attachments (compiled into a
   deployment, run in the worker process) but the product ships none. Is an attachment expected to
   be built per-customer, and what review/packaging path does it take?
9. **Deployment target.** The cloud provider is recorded as undecided and no application-tier
   Dockerfiles exist in-repo. Is the intended container/runtime packaging defined elsewhere?
10. **Report synthesis availability in practice.** Synthesis depends on `LLM_HOSTED_BASE_URL` being
    configured; is a hosted open-weight endpoint provisioned for staging/production, or is synthesis
    expected to stay unavailable until a customer needs it?

---

*End of specification. All statements above were taken from the source tree; where the code did not
settle a point, it is raised in §8 rather than assumed.*

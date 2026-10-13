# Vestigo: project brief for research and planning assistants

State as of **2026-10-13**, commit `045e0bb` on `main`. This is a self-contained snapshot for an
assistant that cannot see the repository. Everything below was read from the repository; nothing is
estimated unless it says so.

---

## 0. Instructions for the assistant reading this

You are helping the founder of Vestigo, a commercial OSINT investigation platform, research and plan
development. Implementation is done separately by Claude Code inside the repository; your output
feeds that work.

1. **Treat §3 (the rules) as hard constraints.** Do not propose anything that breaks them. If the
   best answer would need a rule changed, say so explicitly, name the rule, and give the trade-off.
   Do not quietly work around it.
2. **Do not relitigate settled decisions** (§4, §5) unless asked. Propose changes as decisions for
   the owner, with a recommendation.
3. **Never invent facts about the code.** If you need a file, ask for it by path (§15 lists the key
   paths). Mark anything you have not verified as an assumption.
4. **For external facts** (API terms, pricing, quotas, licences, laws), give the source URL and the
   date you read it. Licence and terms answers must quote the operative clause. Terms change; say
   when a source may be stale.
5. **Match the house style for plans:** small reviewed stages; each stage states scope, what it
   turns on, dependencies, rough size (source + tests lines), confidence, what it stops at
   (checkpoint), and the decisions it needs from the owner (numbered like `D-M1`).
6. **When asked for an implementation prompt for Claude Code**, write it as a self-contained
   paste-in prompt: goal, scope, files to touch, rules that apply, tests required (including
   regression tests for each fixed defect), what it must not do, and the checkpoint where it stops
   and reports.
7. **Be concise and decisive.** Give a recommendation, not a survey of every option.
8. **The owner prefers plain explanations.** When presenting a technical choice, explain each
   option in plain words with an example before asking them to pick.

---

## 1. What Vestigo is

- **A multi-tenant SaaS OSINT investigation platform.** An analyst enters a target (domain, IP,
  email, phone, username, organisation, URL). The platform plans which collectors can lawfully run,
  collects passively from public sources in the background, stores every response as tamper-evident
  evidence, fuses results into an entity graph, and produces cited reports and case analyses.
- **Core promise: it never fabricates.** A value that was not measured is shown as "not measured"
  with the reason, never as 0 or a guess. Every claim carries a strength label and traces to stored
  evidence.
- **Buyers (not yet confirmed):** enterprise security (suggested beachhead), government and law
  enforcement, corporate due diligence. Served through per-plan module gating.
- **Deployment:** multi-tenant SaaS only. No on-premise or air-gapped installs. An India region is
  required (DPDP Act 2023, latency).
- **Team:** one engineer (the founder), with heavy AI-assisted development (Claude Code). Possibly
  one or two juniors later.
- **Name:** the product is Vestigo. It is defined once, as the `PRODUCT_NAME` constant in
  `packages/config`. It is never hard-coded anywhere else in code or UI.
- **Origin:** a clean rebuild of an earlier monolith ("Sentinel AI", kept read-only in `legacy/`),
  which was built for a government programme (iDEX PS-18) and was audited as fabricating data in
  places. The rebuild ports the good logic through a fabrication gate (§12).

---

## 2. Status at a glance

| Area | State |
|---|---|
| Core backend (tenancy, auth, collection, evidence, jobs, fusion, reports) | Built (Phases 0–5) |
| Frontend (sign-in, search, run view, case workspace, report view) | Built (Phase 6a/6b, UI foundation U1-a/b/c) |
| Case analysis engine | R1-a and R1-b built; R1-c to R1-f not started |
| Credibility, coordinated-behaviour (CIB) and social analysis | Not built (scheduled R2, now proposed as Track M) |
| Social media and news monitoring | Planned only: `docs/monitoring/MONITORING-PLAN.md` (Track M), awaiting owner rulings |
| Person, GEOINT and MEDIAINT disciplines | Not built (R3) beyond phone-number parsing |
| Media forensics | Not built (R4); `packages/media-forensics` is an empty placeholder |
| Vulnerability assessment / pentest (VA/PT) | Planned only (Track 2, Stages A–F) |
| Commercial layer (billing, plans UI, vetting UI, onboarding, webhooks) | Not started (Phase 7) |
| Infrastructure (cloud, CI, observability) | Not started (Phase 8). **No CI config and no Dockerfiles exist yet.** |
| Hardening and launch readiness | Not started (Phase 9) |
| Tests | 2,038 tests across 13 packages, 54 Turbo tasks green; fabrication check clean on 491 files |

---

## 3. The rules (hard constraints, from `CLAUDE.md`)

### 3.1 Never fabricate data (the most important rule)

- An unmeasured value is `null` and renders as an em dash with an explanation. Never `0`, `"N/A"`,
  `""` or a plausible guess. `0` means "measured, and the count was zero".
- No defaults for missing timestamps (`|| new Date()`, `?? 0` and similar are banned; a lint rule
  and a repo-wide fabrication check enforce this).
- A collector that fails returns a typed error, never an empty successful result.
- Partial results are labelled partial and say what was not covered.
- Every claim carries a strength label: **OBSERVED, REPORTED, DERIVED, CORRELATED, INFERRED,
  HYPOTHESIS**. Collectors may produce only OBSERVED, REPORTED or DERIVED; the model may produce
  only CORRELATED, INFERRED or HYPOTHESIS.
- Never invent statistics, source names, dates or identifiers, including in fixtures, comments,
  docs and UI copy. Use bracketed placeholders.
- **One approved exception:** a refused sign-up returns the same 200 response as an accepted one
  (anti-enumeration), with a synthetic user. This applies to sign-up only. No sign-up screen ships
  until sign-up sends an email, which is not built yet.

### 3.2 Tenant isolation is absolute

- Every table carries `tenant_id`. Every query runs in a transaction with the tenant set, so
  Postgres row-level security (RLS) applies. RLS is forced on every tenant table.
- **One approved exception:** the identity provider's tables in the `auth` schema (user, session,
  account, verification, two_factor, organization, member, invitation, rate_limit) have no
  `tenant_id`, because a person signs in before a tenant is known. Only the `app_auth` database role
  reaches them. A schema test fails if any other table lacks `tenant_id`.
- No repository function is callable without a tenant context. No RLS bypass, no superuser
  connection from application code, no "admin" back door.
- Cross-tenant isolation tests block release.
- A server-sent event stream re-checks session, membership, permission, plan, vetting and person
  access on every read, and closes with a `locked` event when access is lost.

### 3.3 Collection safety and legality

- Passive collection by default. Active scanning needs a recorded scope authorisation naming
  tenant, target and authoriser.
- **No scrapers for Instagram, Facebook or X**, ever. Never work around a platform's terms.
- Targets are passed to tools as arguments, never interpolated into a shell command.
- Every fetch of a user-supplied URL goes through SSRF protection: no private ranges, no cloud
  metadata endpoints, no redirect chains that escape the allowlist.
- Every source carries a licence verdict (PERMITTED / BLOCKED / UNVERIFIED) and a commercial-use
  statement. When in doubt: blocked, and ask.

### 3.4 LLM rules

- **Open-weight models only**, from an allowlist in code, Apache-2.0 or MIT licensed. **Never**
  Llama-derived models, Gemini, or Azure OpenAI.
- Model and endpoint are configuration, never hard-coded.
- All collected content is untrusted. It is passed in delimited form, never concatenated into
  instructions. Every response is schema-validated. Output that follows instructions found in
  source material is rejected.
- Every claim in generated text maps to an evidence id. Uncited output is retried once, then fails.
  The citation validator is never relaxed to pass a test.
- Tokens are metered per tenant on every call.
- An output guard rejects verdict language (safe, malicious, trustworthy, risky...). The model
  never issues a verdict or a score of its own.

### 3.5 Fault isolation

- Timeouts on every external call. Fixed concurrency per source (bulkheads). Circuit breakers per
  source. Failed jobs go to a dead-letter queue and are replayable.
- Jobs are idempotent, keyed by tenant, run, collector, target and parameters, so a retry never
  double-charges or duplicates evidence.
- Retries distinguish cause: rate limits, timeouts and 5xx back off; auth failures and invalid
  targets fail at once.
- **No microservices to solve reliability.** A service is extracted only for a different runtime, a
  very different resource profile, independent scaling, a separate compliance boundary, or a team
  that owns it.

### 3.6 Structure, contracts, code style

- Business logic lives in `packages/`, never in route handlers or React components.
- Cross-package imports go through entry points only. `packages/core` depends on nothing;
  `packages/access` depends only on core and does no I/O; `packages/case-engine` depends only on
  core and is pure (no I/O, no clock, no randomness), and can never cause collection.
- The OpenAPI spec is generated from the Zod schemas that validate requests; the web app uses a
  client generated from it. The UI can do nothing the public API cannot.
- Core evidence and entity types are additive-only.
- Validate at every boundary: HTTP, collector output, model responses, queue messages.
- TypeScript strict, no `any`, Node only (no Bun anywhere). Errors are typed with machine-readable
  codes. Structured logs with tenant, run and job ids; never log secrets or raw personal data.
- Every change ships with tests; every bug fix with a regression test. Migrations are forward-only,
  expand then contract, no downtime.

### 3.7 Privacy and retention

- Person-investigation features are plan-gated and vetting-gated, for reading stored data as well
  as collecting it. A read that rests on person data, when the tenant may not access it, is refused
  whole: 403 with `MODULE_NOT_IN_PLAN` or `VETTING_NOT_APPROVED` and a `locked` block (what was
  withheld, why, the next step). Never hide rows or lower counts to make a read pass. An unknown
  collector counts as person data (fail closed). There is exactly one gate function (`personGate`);
  a guard test fails if a copy appears.
- Raw evidence payloads are served only as `application/octet-stream` attachments with `nosniff` and
  a `default-src 'none'; sandbox` CSP, re-hashed against the stored hash on every read.
- Credentials use envelope encryption at rest; never written in plaintext, logged or committed.
  **Collector credentials live only in each tenant's encrypted vault, never in environment
  variables** (a test enforces this).
- Deletion genuinely removes evidence, media and derived data. The audit log is append-only.

### 3.8 Working style

- Work in reviewed phases/stages. Report what changed, what builds, what tests pass. Never proceed
  on red.
- Prefer targeted edits. Never write a placeholder that returns fake data; an honest
  `NotImplementedError` is always better.
- Evidence takes its source label from the collector registry, never from a string the collector
  supplies. A fallback source is its own registered collector, visibly different.

---

## 4. Technology stack (as installed)

| Layer | Choice |
|---|---|
| Runtime | Node ≥ 24, TypeScript ~6.0 strict, ES modules |
| Monorepo | pnpm 12.6 workspaces, Turborepo 2.11 |
| API | Fastify 5.12, `fastify-type-provider-zod` 7, Zod 4.6, `@fastify/swagger` (OpenAPI 3.1), RFC 9457 problem+json errors |
| Auth | Better Auth 1.7 (self-hosted, organisation plugin), invitation-only, mandatory TOTP MFA |
| Database | Postgres 17 with pgvector 0.8.6 (extension installed, no column uses it yet), Drizzle ORM 0.45, forced RLS, three roles (`app_owner`, `app_runtime`, `app_auth`), 25 migrations (0000–0024) |
| Queue | BullMQ 6.3 on Redis 8 (ioredis 6) |
| LLM | OpenAI-compatible provider interface; "hosted" profile (an open-weight API host) and "vllm" self-hosted profile (off by default) |
| Web | React 19.3 SPA on Vite 8.3, TanStack Router 1.170 and Query 5.104, Tailwind 4.3, shadcn-style components on Radix, lucide icons, TanStack Table, Cytoscape 3.34 for graphs, `openapi-fetch` generated client. No chart library yet. |
| Tests | Vitest 5 (2 workers per package), real Postgres and Redis via Docker Compose |
| Lint | ESLint flat config (strict type-checked + a custom fabrication plugin), Prettier |
| PDF | Server-side PDF export with embedded Noto Serif |
| Local infra | `docker-compose.yml`: postgres, redis, and an optional `vllm` service (GPU, `--profile llm-selfhosted`) |

Commands: `pnpm install`, `pnpm build`, `pnpm test` (needs `docker compose up -d`), `pnpm lint`,
`pnpm typecheck`, `pnpm db:migrate`, `pnpm db:seed`.

---

## 5. Architecture

### 5.1 Repository layout (what actually exists)

```
apps/api            Fastify API: routes, HTTP guards, auth wiring (no business logic)
apps/web            React SPA
apps/worker         one worker codebase, deployed as pools selected by queue name
packages/core       domain types, vocabulary, evidence/claim/graph interfaces, target detection
packages/access     permission catalogue, roles, plans, vetting, personGate, API key scope (pure)
packages/collectors collector SDK, source catalogue, registry, runtime, fetcher, 10 collectors
packages/osint-engine  planner, run coordinator, job processors, queues, fusion, reports, case-analysis job
packages/case-engine   pure case analysis (coverage, collectors view, discipline breakdown)
packages/llm        provider, router, citation validator, guards, injection scanner, cache, metering, evals
packages/db         Drizzle schema, migrations, RLS, repositories, graph store, seed
packages/integrations  credential vault, API key service, rate limiters, circuit breaker, exports
packages/ui         shared component library (design tokens, graph shell, map shell)
packages/config     env schema, tsconfig/eslint/prettier presets, CI guard scripts, PRODUCT_NAME
packages/media-forensics  placeholder, no code
legacy/             previous codebase, read-only reference, gitignored, never imported
docs/               ADR, plans, audit, design mockups, reclamation, VA/PT, monitoring
```

Planned but absent: `services/vision` (Python GPU service), `infra/` tool containers, Dockerfiles,
CI workflows, object storage (the content store is filesystem-only today).

### 5.2 Request path

1. Every route must declare its access: `{permission, action, snapshot?}` or `{public: "reason"}`.
   The app refuses to start otherwise.
2. The principal is resolved from a session cookie (MFA enrolled, trusted origin for writes, active
   tenant chosen) or a Bearer API key (`ak_<tenant>_<key>_<secret>`, hashed, rate-limited, capped
   to the issuer's current roles).
3. One tenant transaction opens (RLS set). Membership is re-checked; permission, plan module and
   vetting are decided in `packages/access`. Reads marked `snapshot` run REPEATABLE READ.
4. Handlers that read person-capable data call `requirePersonAccess` (the shared gate) before
   answering.
5. Every request writes an audit row: ALLOWED, DENIED or FAILED.

### 5.3 Access model

- **Roles:** viewer (reads), analyst (+ create investigations, write cases, analyse, start runs,
  replay jobs, create reports, person search), admin (+ audit, API keys, credentials, scope
  authorisations, usage, settings, members), owner (+ delete organisation).
- **Modules:** TECHINT (covers the TECHINT, SOCMINT, MEDIAINT and GEOINT collector disciplines) and
  PERSON_INVESTIGATION (the PERSON discipline).
- **Plans:** `TECHINT` and `TECHINT_AND_PERSON`.
- **Vetting:** NOT_SUBMITTED, PENDING, APPROVED, REJECTED, SUSPENDED. Person features need APPROVED.

### 5.4 Data model

| Table(s) | Purpose |
|---|---|
| `tenants`, `users`, `api_keys` | Tenancy (plan, vetting, retention days, handling marking) |
| `auth.*` | Better Auth identity tables (the approved exception) |
| `audit_log` | Append-only audit trail |
| `collectors_registry`, `scope_authorisations` | Tenant copy of each registry entry (label, licence); active-scan authorisations |
| `investigations` → `runs` → `jobs` | A target as entered; one collection run with its plan; one job per collector (idempotency key, attempts, outcome, result, evidence ids, dead-letter and fusion markers) |
| `evidence` | Append-only, partitioned by month: collector + version, source URL, content hash, payload pointer, `observed_at` (from the upstream, nullable) vs `collected_at`, claim strength |
| `claims` | A statement about one entity or relationship, citing one evidence row, with its strength |
| `entities`, `entity_relationships`, `entity_merges` | Graph nodes (unique per kind + normalised identifier), edges (free-text kinds), reversible analyst merges |
| `cases`, `case_pins` | Cases and pinned evidence/entities/claims/relationships |
| `reports`, `report_pdfs` | Run reports (stored document) and rendered PDFs |
| `case_analyses`, `case_analysis_events` | Write-once analyses per (case, input hash) with append-only status events |
| `monitors`, `alerts` | **Tables and repositories exist; nothing uses them yet** (no API, worker or scheduler) |
| `credentials` | Envelope-encrypted vault secrets per tenant |
| `usage_events`, `tenant_quotas` | Append-only metering (upstream requests, LLM tokens); operator-set quotas |

**Entity kinds:** PERSON, ORGANIZATION, DOMAIN, IP_ADDRESS, EMAIL_ADDRESS, USERNAME, PHONE_NUMBER,
URL, SOCIAL_ACCOUNT, LOCATION.
**Target types:** DOMAIN, IP_ADDRESS, EMAIL_ADDRESS, PHONE_NUMBER, USERNAME, ORGANIZATION, URL,
FILE. There is no keyword/topic/hashtag target type yet.
**Graph:** a `GraphStore` interface with a Postgres recursive-CTE adapter (max 3 hops, 500 nodes).
Neo4j is deferred until a real need (beyond about 50,000 edges, or graph algorithms being sold).

### 5.5 Collection pipeline

```
POST /investigations/:id/runs
  → queue "investigations": planRun (which collectors may run, and why the others may not)
  → BullMQ flow: one job per collector on queue "collect.<sourceId>" (bulkhead per source)
      → CollectorRuntime: licence, plan/vetting, scope authorisation, credentials checks
      → collector runs with a host-bound, SSRF-safe fetch; responses captured and stored
      → evidence recorded, usage metered, outcome recorded (one transaction)
  → queue "fusion" (flow parent): per-collector extractors → entities, relationships, claims
  → run status SUCCEEDED / PARTIAL / FAILED; progress streamed over SSE
```

- **Collector outcomes:** FOUND, NOT_FOUND, FAILED, UNAVAILABLE (with retry-after),
  NEEDS_CREDENTIALS, REFUSED (with a reason such as LICENCE_BLOCKED or VETTING_NOT_APPROVED).
- **Provenance rule:** every value in a result must literally appear in a cited response, except
  values under a top-level `derived` block, which become DERIVED claims.
- **Collector contract today:** a collector receives `target`, `credentials`, `fetch`, `signal`.
  **It receives no parameters**, so "since last check" or "this query" is not expressible yet.
- **No scheduler exists:** no cron, no repeatable jobs.
- **Fusion** resolves entities by exact kind + normalised identifier. People and organisations are
  resolved only by an external id (for example `wikidata:Q42`). Nothing is merged by name. No
  confidence scores are invented.
- **Queues:** `investigations`, `fusion`, `collect.<source>`, `reports`, `report-renders`,
  `case-analyses`, `dead-letter`. Every enqueue is bounded at 5 seconds.

### 5.6 LLM layer (`packages/llm`)

- **Allowlist:** small tier Qwen/Qwen3-8B, openai/gpt-oss-20b; large tier Qwen/Qwen3-32B,
  openai/gpt-oss-120b, mistralai/Mistral-Small-3.1-24B-Instruct-2503.
- **Routing:** tasks `extraction` and `classification` (small) and `synthesis` (large).
  `extraction` and `classification` have **no caller yet**; only report synthesis uses the model.
- **Safeguards:** citation validator (no uncited statement, no unknown reference, CORRELATED needs
  at least two independent sources, no certainty words), output guards (markup leak, instruction
  echo, unsupported identifier, call to action, risk verdict), injection scanner, untrusted-data
  framing, validate-then-retry-once, tenant-namespaced Redis cache, token metering, golden eval set.
- **Live checkpoint:** passed 2026-10-03 against a hosted open-weight endpoint, development only.

### 5.7 Reports and case analysis

- **Run reports:** assembled from a settled run with coverage and limitations, optional model
  synthesis with citations; exported as PDF, JSON, CSV and Maltego edge-list CSV.
- **Case analysis (R1-a/b):** `packages/case-engine` computes case coverage, a per-collector view and
  a discipline breakdown from stored records only. Unbuilt metrics (contradictions, media claims,
  location hypotheses) are null, never 0. Stored once per (case, input hash) by a background job;
  freshness re-checked on every read; bounded at 50,000 records per analysis (409
  `CASE_TOO_LARGE` beyond).

### 5.8 Frontend

- **Routes:** `/sign-in`, `/sign-in/verify`, `/enrol`, `/tenant`, `/` (search), `/runs/$runId`
  (live progress over SSE), `/runs/$runId/$tab`, `/cases`, `/cases/$caseId/$tab`, `/members`,
  `/settings`, `/dev/gallery` (dev builds only).
- **Workspace tabs:** overview, entities, graph (Cytoscape), timeline, evidence, media and map (both
  "Not built"), report.
- **Design system:** tokens from 15 HTML mockups in `docs/design/`; a guard test rejects raw colours,
  lengths and inline styles. Colour carries only three meanings (claim strength, collector status,
  entity class), always with a text label too.
- **API features the UI does not call yet:** audit log, API keys, credentials, scope
  authorisations, entity merges, case analyses, job replay, usage, settings writes, member changes.

### 5.9 CI guard scripts (run as tests)

Package boundaries; person-gate single-home and route classification; design-system tokens;
`.env.example` generated from the schema; package export integrity; repo-wide fabrication scan;
legacy classification; `.env*` files git-ignored (in progress).

---

## 6. What is built: inventory

### 6.1 Registered collectors (10, all passive)

| Id | Source | Discipline | Targets | Licence verdict |
|---|---|---|---|---|
| `crtsh` | crt.sh certificate transparency | TECHINT | DOMAIN | UNVERIFIED |
| `dns` | Cloudflare DNS-over-HTTPS | TECHINT | DOMAIN | UNVERIFIED |
| `rdap` | RDAP registration data | TECHINT | DOMAIN | UNVERIFIED |
| `commoncrawl` | Common Crawl URL index | TECHINT | DOMAIN | UNVERIFIED |
| `wayback` | Wayback Machine CDX | MEDIAINT | DOMAIN, URL | UNVERIFIED |
| `wikidata` | Wikidata entity search | SOCMINT | ORGANIZATION | PERMITTED (CC0) |
| `github` | GitHub public profile | SOCMINT | USERNAME | UNVERIFIED |
| `hackernews` | Hacker News API + Algolia | SOCMINT | USERNAME | UNVERIFIED |
| `devto` | DEV Community | SOCMINT | USERNAME | UNVERIFIED |
| `contact.phone` | libphonenumber (local) | PERSON | PHONE_NUMBER | PERMITTED |

Plus `news` (GDELT DOC 2.0, MEDIAINT, PERMITTED with attribution): built but **held** because GDELT's
`{}` "no results" answer may be systematically false.

**Production effect:** UNVERIFIED sources are refused in production unless explicitly allowed, so
today only `wikidata` and `contact.phone` would run in production. Recording licence verdicts is an
owner task, not a code task.

### 6.2 Source catalogue (declared, no collector yet)

**PERMITTED:** GDELT Events, Safecast. **UNVERIFIED:** Bluesky, Reddit Data API, Telegram channel
preview, YouTube Data API v3, Brave Search, SearXNG, Jina Reader, Wikipedia, HIBP, Gravatar,
Nominatim, OpenPGP keyservers, CISA KEV, Feodo Tracker, and others. **BLOCKED:** Shodan InternetDB (non-commercial), Google News RSS,
DuckDuckGo HTML, YouTube InnerTube and yt-dlp, InsightFace buffalo_l (non-commercial), HackerTarget,
AlienVault OTX, UCDP, ReliefWeb, OpenSky, C2IntelFeeds, local network scanning.

### 6.3 API (about 68 routes under `/api/v1`)

Health and OpenAPI; session (sign-in, MFA, tenant choice); me; investigations; runs (start, list,
read, SSE events, job replay, usage); reports (create, list, read, export, handling marking); scope
authorisations; cases and pins; case analyses; entities, relationships, merge candidates, merges and
undo; evidence and raw payload; graph and timeline; members and invitations; retention settings;
estimates; collectors catalogue; person search (returns 501 after the gate).

---

## 7. What is not built (known gaps)

- **Monitoring:** no topic target, no collector parameters, no scheduler, no posts/articles table, no
  alerts pipeline, no monitoring UI.
- **Analysis:** no credibility, CIB, narrative clustering, spike detection, sentiment or embeddings
  (zero hits in backend code).
- **Disciplines:** person collectors beyond phone parsing, GEOINT, MEDIAINT claims, media forensics.
- **Search backend:** Brave was chosen (ADR §11, because Google Custom Search closes to existing
  customers on 2027-01-01) but never built. `BRAVE_SEARCH_API_KEY` was deliberately removed from the
  env schema because keys belong in the tenant vault.
- **Ops:** CI, Dockerfiles, cloud deployment, OpenTelemetry, object storage (S3), email sending,
  outbound webhooks, retention/deletion jobs, Python vision service.
- **Commercial:** plans UI, vetting UI, onboarding, billing, sign-up screen.
- **UI:** credentials, API keys, audit, usage, merges and case-analysis screens; map and media tabs.

---

## 8. History and current phase

| Phase | Scope | Status |
|---|---|---|
| 0 | Audit of the legacy codebase, per-module verdicts | Done |
| 1 | Scaffold, toolchain, fabrication gate | Done 2026-09-25 |
| 2 | Data foundation, RLS, Better Auth, MFA, permissions, API keys, audit, vault | Done 2026-09-28 |
| 3 | Collector SDK, licence gating, fetcher, 10 collectors, provenance rule | Done 2026-09-30 |
| 4 | BullMQ jobs, fault isolation, metering, run API + SSE, fusion | Done 2026-09-30 (tool containers and monitors deferred) |
| 5 | LLM, citations, reports, exports, evals | Done 2026-10-01; live checkpoint 2026-10-03 |
| 6 | Frontend: 6a, 6b, UI foundation U1-a/b/c | Done 2026-10-07, awaiting the owner's review |
| R0 | Automated classification of 1,162 legacy exports | Done 2026-10-06 |
| R1-0 | Case analysis plan, decisions D-1 to D-34 | Done 2026-10-08 |
| D-10/10b/10c | Person gate on merges, replay gating, whole-scope SQL probe | Done 2026-10-08 |
| R1-a | Pure case engine | Done 2026-10-09 |
| R1-b | Case analysis persistence, job, endpoints, person gate over a case | Done 2026-10-09; rulings carried out 2026-10-13 |
| D-33 | Graph walk rewrite and two indexes (migration 0024); graph store now answers in under 0.6 s at 3 hops on a 125k-entity synthetic tenant | Done 2026-10-13 |
| **Next** | R1-c (cross-intelligence), R1-d (contradictions), R1-e (workspace UI), R1-f (written case summary through the LLM) | Not started |
| 7, 8, 9 | Commercial, infrastructure and CI, hardening | Not started |

### 8.1 Open items awaiting the owner (R1 track)

- **D-35:** the person probe times out from one hop on a 125k-entity tenant, so the graph cannot be
  read past 0 hops there for tenants without person access. A two-join rewrite measured 3–4 s
  (not built).
- **D-36:** with the new indexes, the old graph walk is faster than the ruled one at every hop.
  Which walk the store and the probe share is undecided.
- **D-34:** report generation must re-check the person gate (ruled; to be built no later than R1-f).
- Analysing an archived case (recommended: refuse).
- BLOCKED and NOT_IMPLEMENTED registry entries counted as registered (recommended: exclude from what
  can run, keep the label).

---

## 9. Roadmap

### 9.1 The master sequence (`docs/MASTER-BUILD-SEQUENCE.md`)

Three tracks; backend capability and its UI ship together, one reviewed stage per session.

- **Track 1: legacy analysis reclamation** (about 25,000 lines of analysis logic still in `legacy/`)
  - R1: case analysis engine (cross-intelligence, contradictions, gaps). In progress.
  - R2: credibility, CIB, social. **Now proposed to run as Track M (§9.2).**
  - R3: person, GEOINT, MEDIAINT disciplines (person work behind the vetting gate).
  - R4: media forensics (file provenance, imaging, audio, transcription), GPU-adjacent.
  - R5: specialised modules by commercial need (cyber-intel, attack surface, watchlists, manual
    evidence).
- **Track 2: VA/PT** (none started). Stage A `packages/vuln-engine` skeleton and ASM discipline; B
  scope-authorisation extension; C passive ASM collectors (CVE match, subdomain takeover, secrets
  exposure, TLS hygiene); D breach/identity collectors; E active scans (Nmap, Nuclei as containers);
  F assisted pentest, blocked on legal work.
- **Track 3: commercial and ops.** Phase 7 plans, vetting, onboarding, billing, webhooks,
  export/deletion; Phase 8 cloud, CI, OpenTelemetry; Phase 9 hardening, vision service repair,
  licence verdicts, load tests. Legal work (terms of service, acceptable-use policy, vetting
  procedure, DPDP, insurance) should start in parallel now.

### 9.2 Track M: social media and news monitoring (proposed 2026-10-13)

**Goal:** continuous, automatic monitoring of narratives, outlets, channels and accounts across news
and social platforms, with the investigation depth of a disinformation research lab: narrative
tracking, cross-platform networks, timelines, coordination signals, source credibility, entity and
relationship mapping. Reference for the kind of output wanted: thedisinfolab.org.

**Owner rulings so far:** run Track M in parallel with R1 (it does not touch `case-engine` or R1
files); all eight sources in the first slices; scheduled polling every 5–15 minutes first, live
stream later; three analysis layers in order (deterministic scoring, then the LLM for text, then
embeddings).

**Central design idea: a monitor tick is a run.** Each scheduled tick creates an ordinary run, so
bulkheads, circuit breakers, retries, dead letters, metering, replay and SSE are reused. New on top:
an `items` table (posts, articles, videos, messages), a pure `packages/signal-engine` (same
constraints as `case-engine`), narratives, assessments, alerts, and screens.

**Sources:**

| Collector | Source | Key needed | Notes |
|---|---|---|---|
| `rss` | publishers' RSS/Atom feeds (tenant-declared hosts, SSRF-bound) | no | |
| `news` (un-held) | GDELT DOC 2.0 | no | a canary query detects GDELT's false-empty answers |
| `bluesky.search`, `bluesky.profile` | Bluesky public API | no | |
| `mastodon.tag`, `mastodon.account` | Mastodon instances (tenant-declared) | no | full-text search is instance-local |
| `telegram.channel` | `t.me/s/{channel}` preview page | no | an HTML page, not an API; brittle |
| `brave.web`, `brave.news` | Brave Search API | yes (tenant vault) | metered; about $5 per 1,000 requests with a monthly credit tied to attribution (2026 pricing; verify) |
| `youtube.search`, `youtube.channel` | YouTube Data API v3 | yes | default 10,000 units/day; a search costs 100 units |
| `reddit.search` | Reddit Data API (OAuth) | yes | commercial use needs approval; terms restrict surveillance use; built last, may end BLOCKED |

**Slices:**

| Slice | Scope | Size (src + tests, estimate) |
|---|---|---|
| M0 | Plan recorded, ADR amendments, licence task list | docs |
| M1 | `TOPIC` target type; collector parameters; open-host sources; `runs.monitor_id` + window; `monitors` extended; `items` + `item_matches`; `signal-engine` skeleton with purity test; `MONITORING` module and permissions | 1,200 + 1,400 |
| M2a | Keyless collectors (RSS, GDELT, Bluesky, Mastodon, Telegram) and their extractors | 1,800 + 2,000 |
| M2b | Keyed collectors (Brave, YouTube, Reddit); first credentials screen | 1,300 + 1,400 |
| M3 | Scheduler, tick processor, per-tick readings, rolling-baseline spike detection, in-app alerts, Monitoring and Alerts screens with live updates. **First demo milestone.** | 2,000 + 2,200 |
| M4 | Story clustering into narratives; 7-factor configurable credibility; 5 CIB signals; graph edges (`posted_by`, `published_by`, `links_to`, `amplifies`, `uses_hashtag`...); pin items and narratives to cases; pivot from outlet domains to the existing WHOIS/certificate/archive collectors | 2,400 + 2,600 |
| M5 | LLM: entity and claim extraction, cited narrative summaries, topic classification, metered | 900 + 1,100 |
| M6 | Embeddings (an Apache-2.0/MIT multilingual model, for example BAAI/bge-m3) in pgvector, cross-language narrative clustering | 900 + 1,000 |
| M7 | Adaptive polling, per-monitor budgets, plan quotas, webhook alerts, narrative report export, optional Bluesky Jetstream live pool | 1,500 + 1,500 |

**New tables:** `items`, `item_matches`, `monitor_readings`, `narratives`, `narrative_members`,
`assessments`, `credibility_profiles`, `source_tiers`, `item_embeddings` (M6); `monitors`, `alerts`
and `runs` extended. All with forced RLS.

**Analysis to port from legacy (REWRITE through the fabrication gate):**
- Keyword monitors and spike detection, three-valued: spiking / not spiking / not enough history.
  Rolling baseline, 3σ, at least 10 completed buckets.
- CIB, five signals: temporal synchrony (against a uniform-window null), content duplication (5-word
  shingles), account maturity, handle patterns, amplification. Output is "signals warranting review,
  never a verdict", with a mandatory caveat.
- Credibility, seven factors: domain tier, corroboration, citation depth, recency, source
  diversity, custom keywords, linguistic markers (LLM, opt-in). Each factor is weighted and can be
  switched off; a factor that cannot be computed is excluded, never defaulted.
- Story identity: title tokens, similarity, clustering.

**Decisions awaiting the owner (D-M1 to D-M11):**

| Id | Decision |
|---|---|
| D-M1 | Add the `TOPIC` target type |
| D-M2 | Add `NARRATIVE` and `HASHTAG` entity kinds |
| D-M3 | Open-host sources |
| D-M4 | Un-hold GDELT with a canary |
| D-M5 | `MONITORING` module in both plans until Phase 7 |
| D-M6 | Continuous monitoring of an individual's account counts as person data (gated, fail closed) |
| D-M7 | Embedding model allowlist |
| D-M8 | Reddit built last, shipped only with a recorded verdict |
| D-M9 | Alert delivery beyond in-app in M7 |
| D-M10 | Bluesky Jetstream in M7 |
| D-M11 | Usage units for monitoring |

**Quota strategy at scale:** each tenant brings its own keys (its own quota); keyless sources do
continuous watching while keyed sources do discovery within a per-monitor budget; since-cursors and
dedupe; adaptive polling; plan quotas through `usage_events`/`tenant_quotas`; paid tiers bought to
match. When a source runs out, the reading shows it as "not covered since [time]", never zero.

---

## 10. Data licensing status (open workstream)

- **Confirmed:** Shodan InternetDB is non-commercial only. Google Custom Search is closed to new
  customers and ends for existing ones on 2027-01-01. OpenSky needs a separate agreement for a paid
  product.
- **Brave as the dork backend:** it does not support the full Google operator set. The engine must
  translate what it can and clearly mark what it could not run; silently returning fewer results
  would be a fabrication defect.
- **Still to verify before launch:** Reddit, HIBP, Bluesky, Telegram, YouTube, Brave, the GPL/AGPL
  tools (theHarvester, SearXNG, IVRE, SpiderFoot), and Maltego (a transform server and graph export
  are the realistic start; Transform Hub needs a partnership).
- **Tool containers:** GPL tools run as separate services over HTTP, to keep GPL code at arm's length.

---

## 11. Constraints and risks

- **Solo founder.** Every stage must be small, reviewable and test-backed. No architecture that
  needs a team to run (no Kubernetes, no microservices, no Neo4j in v1, no GraphQL).
- **Cloud undecided.** Use only portable building blocks: containers, standard Postgres,
  Redis/Valkey, S3-compatible storage, OpenTelemetry. India region required.
- **No CI yet.** The tests are thorough but run locally; CI is Phase 8.
- **Licences gate production.** Most sources are UNVERIFIED; until the owner records verdicts, only
  two collectors would run in production.
- **DPDP Act 2023.** Public posts are personal data of identifiable people. Store text and URLs,
  never media bytes; enforce retention; gate person-centric monitoring.
- **IT Act 2000 s.43/66.** Unauthorised scanning is a legal exposure, hence passive by default and
  the scope gate.
- **LLM cost and sovereignty.** Open-weight only; a hosted API by default, a vLLM profile for
  tenants needing in-house inference.
- **Platform reality.** Instagram, Facebook and X are out of scope. Reddit may be commercially
  unusable. Telegram previews are brittle. YouTube quota limits polling frequency.
- **Performance.** The person probe does not scale past one hop on large tenants (D-35); it blocks
  graph reads for tenants without person access on big datasets.

---

## 12. The legacy codebase and provenance

- `legacy/` is "Sentinel AI" (the npm package was named `sentinel-ai`), a TanStack Start monolith
  with a Python AI service. It was copied from a local working copy of `social-media-ai-agents-v2`
  (branch `transform/pulselens`, commit `ebfe83b`). **No repository URL is recorded**, and the copy
  is partial (its README, `app/`, `osint-workers/` and docs are missing).
- 46 legacy files were themselves ported from a teammate's fork, `social-media-ai-agents-2.3`
  (cases, GEOINT, MEDIAINT, contradictions, timeline). That fork is not in the repository.
- **Ported so far:** the fabrication gate and its ESLint rule; the 10 collectors plus `news`; query
  planning, orchestration, jobs, merge and entity resolution; the LLM layer, citations, report PDF
  and Maltego export; case coverage and breakdown.
- **Still in legacy, high value:** `social.ts` (2,388 lines: Bluesky, Reddit, Telegram, Mastodon,
  monitors, spikes), `cib.ts` (886), `credibility*.ts` (~1,580), `analysis*.ts` (~1,000),
  `news-aggregation.ts` (222), the case logic for R1-c..f, person/GEOINT/MEDIAINT collectors, and
  about 9,000 lines of media forensics.
- **Porting rule:** read the module's verdict in `docs/audit/INVENTORY.md`, then KEEP (imports only),
  REWRITE (fix the data path and add a regression test for the specific defect the audit found) or
  DROP. Tests come across with the module. Nothing enters while the fabrication check fails on it.
- **External repositories reviewed and rejected (no code used):** alpkeskin/mosint (its service list
  only, for VA/PT later), 0x0be/yesitsme, osintambition/Social-Media-OSINT-Tools-Collection,
  SepJs/aegis-guard, CyberWardion/ai-pentest-agent, Arunava-27/vapt-toolkit. A separate Python
  "Sentinel" prototype and osiris contributed ideas only.

---

## 13. Glossary

- **Run:** one collection pass over one target. **Job:** one collector within a run.
- **Evidence:** a stored upstream response (append-only, hashed). **Claim:** a statement citing one
  evidence row, with a strength label.
- **Fusion:** turning results into entities, relationships and claims.
- **Discipline:** TECHINT, SOCMINT, MEDIAINT, GEOINT, PERSON.
- **Module:** the plan unit that disciplines map to (TECHINT, PERSON_INVESTIGATION).
- **Person gate / `personGate`:** the single function deciding whether a read or job that rests on
  person data is allowed.
- **Pin:** attaching evidence, an entity, a claim or a relationship to a case.
- **Held collector:** built but not registered to run.
- **UNVERIFIED / BLOCKED / PERMITTED:** a source's commercial-use licence verdict.
- **R-stages:** reclamation stages (porting legacy analysis). **D-n:** an owner decision.
  **M-stages:** monitoring track slices.

---

## 14. Useful work for an assistant right now

1. **Licence and terms research** for Bluesky, Mastodon (common instance policies), Telegram
   previews, Reddit Data API, YouTube API Services, Brave Search API, GDELT. Quote the operative
   clauses on commercial use, monitoring/surveillance restrictions, data retention, attribution and
   rate limits, with URLs and dates. Output one verdict per source (PERMITTED / BLOCKED /
   UNVERIFIED) with the reasoning.
2. **Quotas and pricing at scale** for the keyed sources: current limits, how to request increases,
   and cost per 1,000 monitored topics per day under a 5–15 minute polling schedule.
3. **Embedding model choice** for multilingual (English, Hindi, Urdu and other Indian languages)
   narrative clustering: open-weight, Apache-2.0 or MIT only, never Llama-derived. Compare quality,
   dimension, context length, CPU vs GPU serving cost, and pgvector HNSW settings.
4. **Method review** of the CIB signals and credibility factors against published
   disinformation-research methods (for example DFRLab, EU DisinfoLab, Stanford Internet
   Observatory, Graphika). Which signals add the most, and which produce false positives on
   legitimate organised campaigns?
5. **DPDP Act 2023 obligations** for a SaaS that stores public social posts: lawful basis, retention,
   data-principal rights, cross-border transfer, and what the vetting and gating must document.
6. **Critique of the Track M plan:** gaps, risks, ordering, simpler alternatives that stay within the
   rules.
7. **Decision support** on D-35/D-36 (person probe performance) given the measurements in §8.1.

---

## 15. Key files (ask the owner to paste any of these)

| Path | What it is |
|---|---|
| `CLAUDE.md` | The full rules (§3 is a summary) |
| `docs/ARCHITECTURE-DECISIONS.md` | The architecture decision record |
| `docs/PLAN.md` | Living tracker with a record per phase and stage |
| `docs/MASTER-BUILD-SEQUENCE.md` | The three-track roadmap |
| `docs/monitoring/MONITORING-PLAN.md` | Track M plan in full |
| `docs/reclamation/LEGACY-RECLAMATION-AUDIT.md` | What is left in legacy and in which order |
| `docs/reclamation/R1-PLAN.md` | R1 stages and decisions D-1 to D-36 |
| `docs/audit/INVENTORY.md`, `COLLECTORS.md`, `REPORT.md` | Legacy audit: verdicts, integrations, problems |
| `docs/vapt/VAPT-PLAN.md` | VA/PT stages |
| `docs/DESIGN-SYSTEM.md` | Design tokens and UI rules |
| `packages/collectors/src/contract.ts` | The collector interface |
| `packages/collectors/src/catalogue.ts` | Every source with its licence verdict |
| `packages/collectors/src/platform/news.ts` | Example collector (GDELT), shows the house style |
| `packages/osint-engine/src/jobs/queues.ts` | Queues, flows, dead letters |
| `packages/db/src/schema/*.ts` | Database schema |
| `packages/access/src/permissions.ts`, `entitlements.ts`, `person-gate.ts` | Access model |
| `packages/llm/src/citations.ts`, `guards.ts` | Citation validator and output guards |
| `packages/config/src/env.ts`, `llm.ts` | Env schema and model allowlist |
| `legacy/src/utils/social.ts`, `cib.ts`, `credibility.ts`, `analysis.ts` | Legacy logic for Track M |

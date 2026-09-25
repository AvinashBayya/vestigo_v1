# Build Phases — Claude Code Prompts

Ten phases, each a self-contained prompt to paste into Claude Code. Run them in order. Each ends with a checkpoint you review before starting the next.

**Why phased:** a single prompt covering this scope exhausts the context window around phase four, after which the agent starts declaring work complete that it has not done.

**Before you start**

- Put `CLAUDE.md` at the root of the new repository and `ARCHITECTURE-DECISIONS.md` in `docs/`. Every phase assumes the agent has read both.
- Keep `docs/PLAN.md` as a living tracker: phases done, decisions taken, open questions. Each phase updates it.
- The old repository stays read-only. Nothing is ever written into it.

**Placeholders to replace before running:** `<OLD_REPO_PATH>`, `<NEW_REPO_NAME>`, and any product name once chosen.

---

## Phase 0 — Audit and migration map

```
Read CLAUDE.md and docs/ARCHITECTURE-DECISIONS.md first; they govern everything below.

The previous codebase is at <OLD_REPO_PATH>. It is READ-ONLY: never modify, move or delete anything inside it.

It contains three stacks in one flat root:
  src/         TanStack Start + React + TypeScript. This is BOTH the old frontend AND the old backend: the API layer is createServerFn server functions inside src/utils/ (~80 modules). This is the mature core worth keeping.
  app/         Python FastAPI YouTube collector (yt-dlp).
  ai-service/  Python FastAPI vision/forensics service. Several endpoints are 501 stubs.
  osint-workers/  docker-compose for SearXNG and theHarvester.
Plus legacy root scaffolding: a root Dockerfile, a root requirements.txt, three test roots (tests/, tests_py/, ai-service/tests/), duplicate scraper scripts, and large governance documents.

Your job in this phase is to UNDERSTAND and PLAN. Write no application code.

1. Read the old codebase thoroughly, especially: its CLAUDE.md, README, .env.example, package.json, both requirements.txt files, src/types/core.ts, src/utils/llm.ts, src/utils/credential-vault.ts, src/utils/youtube-collector.ts, the whole of src/utils/collectors/**, src/utils/osint/**, src/routes/, and ai-service/app/.

2. Write docs/INVENTORY.md: every module (TypeScript and Python) with path, purpose, whether it has tests, and a decision of KEEP / ADAPT / REWRITE / DROP with a one-line reason. Group by destination package.

3. Write docs/MIGRATION-MAP.md: old path to new path for everything being carried over. Record these resolutions explicitly:
   - YouTube exists twice: the TypeScript InnerTube collector is canonical; the Python app/ service is redundant unless you find a concrete server-side yt-dlp requirement. State your finding.
   - The fake-engagement scraper scripts (both the .js and .py) are DELETED, not ported. Note that a test must later fail if they reappear.
   - The broken ytdl-core fallback is dropped.
   - Three test roots consolidate to per-package tests plus one e2e root.

4. Write docs/COLLECTOR-INVENTORY.md: every collector, its discipline (TECHINT / SOCMINT / MEDIAINT / GEOINT / PERSON), whether it is passive or active, what credentials it needs, and its DATA LICENCE with a commercial-use verdict. Mark as BLOCKED any source you cannot confirm is licensed for commercial use. Known already: Shodan InternetDB is non-commercial only (needs paid API); Google Custom Search is closed to new customers and ends 1 Jan 2027 (Brave Search API replaces it); OpenSky needs a separate commercial agreement.

5. Write docs/PLAN.md with the phase tracker and any open questions.

STOP. Report a summary of the four documents and wait for review before Phase 1.
```

---

## Phase 1 — Scaffold

```
Read CLAUDE.md, docs/ARCHITECTURE-DECISIONS.md and docs/PLAN.md.

Create the new repository structure for <NEW_REPO_NAME>. No business logic yet — this phase is the skeleton and the toolchain.

1. pnpm workspaces + Turborepo. Node LTS everywhere; no Bun anywhere, including tests.
2. Create the package layout exactly as CLAUDE.md section 6 specifies.
3. Shared tooling in packages/config: strict tsconfig base, ESLint flat config (port the custom rules from the old eslint-rules/ that enforce the no-fabrication patterns), Prettier, and a Zod-validated environment schema covering every variable found in the old .env.example plus DATABASE_URL, REDIS_URL, AUTH_*, VAULT_MASTER_KEY. Generate .env.example from the schema. Fail fast with a clear message on invalid config.
4. Turbo tasks: build, lint, typecheck, test, and a placeholder e2e.
5. docker-compose for local development: Postgres, Redis, and placeholders for the tool containers.
6. A minimal Fastify app in apps/api that serves /health and /api/v1/openapi.json, with Zod type provider wired and OpenAPI generation working end to end.
7. A minimal Vite React app in apps/web that fetches /health through a client generated from the OpenAPI spec.
8. Root README explaining how to run everything locally.

CHECKPOINT: pnpm install succeeds, all turbo tasks pass, docker compose up works, the API serves a valid OpenAPI document, and the web app renders health status through the generated client. Report and stop.
```

---

## Phase 2 — Data foundation and tenancy

```
Read CLAUDE.md and docs/ARCHITECTURE-DECISIONS.md.

Build the data layer and tenant isolation. This phase determines whether the product is safe to sell, so it gets more care than any other.

1. packages/db with Drizzle: tenants, users, memberships, roles/permissions, api_keys, audit_log, investigations, runs, jobs, collectors_registry, evidence, entities, entity_relationships, entity_merges, claims, cases, case_pins, monitors, alerts, credentials, usage_events.
2. Every table carries tenant_id. Write RLS policies for all of them. Application code connects as a non-superuser role that cannot bypass RLS.
3. A transaction helper that sets tenant context, and a repository base that CANNOT be called without one. Make this structurally impossible, not merely discouraged.
4. Evidence: append-only, partitioned by month, with observedAt separate from collectedAt, collector name and version, source URL, content hash, and an object-storage pointer. Add the content-addressed storage helper.
5. Entity merges as reversible records carrying reason and confidence. People and organisations must never auto-merge on name alone.
6. Claim strength as a first-class column with the six labels.
7. Better Auth with the organisation plugin: sessions, invitations, MFA required, API keys hashed at rest and separately rate-limited. Permission-based guards, never role-name checks.
8. Plan-based module gating, with person-investigation features gated by both plan and vetting status.
9. Credential vault with envelope encryption; master key from the secret manager, never on disk.
10. Append-only audit log with an insert-only grant.
11. TESTS THAT BLOCK RELEASE: a suite that attempts cross-tenant reads and writes through every repository and fails the build if any succeed; a test that a repository call without tenant context throws; a test that audit rows cannot be updated or deleted.

CHECKPOINT: migrations run clean, isolation tests pass, auth flows work end to end (signup, invite, login with MFA, API key). Report and stop.
```

---

## Phase 3 — Collector SDK and migration

```
Read CLAUDE.md, docs/MIGRATION-MAP.md and docs/COLLECTOR-INVENTORY.md.

Build the collector layer and port the existing collectors.

1. packages/collectors: a collector SDK where each collector declares id, version, discipline, target types it accepts, passive or active, required credentials, data licence and commercial-use verdict, rate limits, and its result schema.
2. A language-neutral job contract: queue message in, schema-validated JSON out, exported as JSON Schema so a Python runtime can be added later. Do NOT build the Python runtime now.
3. Port the TypeScript collectors from the old repo per the migration map, updating imports to the new package boundaries. Preserve their tests.
4. Every collector returns typed errors on failure and never an empty success. Preserve the anti-fabrication tests and the grep guards.
5. Collectors whose licence verdict is BLOCKED are registered but disabled, with the reason surfaced through the registry.
6. Replace the dork engine's search backend with Brave Search API. It must translate the operators Brave supports, and explicitly report which operators it could NOT run, offering browser links for those. Silently dropping operators is a fabrication defect.
7. SSRF protection for every user-supplied URL fetch, with tests using private ranges and metadata endpoints.

CHECKPOINT: every ported collector has passing tests, the registry lists disciplines and licences, and the dork engine reports unsupported operators honestly. Report and stop.
```

---

## Phase 4 — Jobs, orchestration and tool containers

```
Read CLAUDE.md, especially section 5 on fault isolation.

Build the execution engine.

1. BullMQ on Redis. An investigation is a parent job that fans out to per-collector jobs on per-source queues and fans in to fusion.
2. One worker codebase in apps/worker, deployed as pools selected by queue via configuration.
3. Fault isolation, implemented and tested: per-call timeouts, per-collector concurrency bulkheads, circuit breakers with a cooling period and an "unavailable" state, a dead-letter queue, and idempotency keyed by tenant + target + collector + parameters. Retries must distinguish retryable causes from permanent ones.
4. Port the orchestrator: target detection, query planning per target type, parallel execution with per-collector budgets, fusion, entity resolution and merge rules.
5. Usage metering: every external call records units against the tenant; quotas are checked before dispatch.
6. SSE endpoint streaming job progress; the API must not block on any collection work.
7. Tool containers in infra/: SpiderFoot and theHarvester as their own services called over HTTP. Targets passed as arguments, never through a shell. Restricted egress.
8. Monitors stored in Postgres and materialised into repeatable jobs, so schedules survive a Redis flush.
9. Tests: a hung collector must not stall other queues; a failing source must open its circuit; a replayed job must not double-charge credits or duplicate evidence.

CHECKPOINT: an end-to-end investigation runs against at least four collectors, with one deliberately failing, and the result correctly shows partial completion with the failure surfaced. Report and stop.
```

---

## Phase 5 — AI, fusion and reports

```
Read CLAUDE.md sections 1 and 4.

Build the analysis and reporting layer.

1. packages/llm: provider interface with an open-weight allowlist, task-based routing (small model for extraction and classification, larger for synthesis), Redis response cache keyed by prompt + model + version, and per-tenant token metering.
2. Configure both backends: hosted open-weight API as the default, and a self-hosted vLLM profile that is built and validated but left disabled.
3. Prompt-injection defence: collected content passed only as delimited untrusted data, schema-validated responses, rejection of output that follows instructions found in source material. Add a CI corpus of known injection payloads.
4. Port the citation validator: every claim maps to an evidence ID; uncited output is retried once, then fails honestly.
5. Report pipeline producing the report sections, including a coverage-and-limitations section that states what was NOT collected and why.
6. PDF output: serif body at 12pt minimum, numbered citations as footnotes, claim labels printed as text rather than colour, a per-tenant handling marking, and an evidence-basis table.
7. Exports: Maltego-compatible graph export, CSV, JSON.
8. Evaluation harness: a golden set of investigations with expected outputs, tracking citation validity and hallucination rate, runnable in CI.

CHECKPOINT: a report generates from a real case with every claim cited, the limitations section is present and accurate, and the PDF renders correctly. Report and stop.
```

---

## Phase 6 — Frontend

```
Read CLAUDE.md and docs/DESIGN-SYSTEM.md (tokens and rules from the design system artifact).

Build the web application. The API client is generated from the OpenAPI spec — never hand-written, and never call an endpoint the spec does not describe.

Screens, in this order:
1. Search dashboard: single input accepting domain, IP, email, phone, username, org or file; target detection; run options with a CREDIT ESTIMATE before commitment.
2. Run view: live progress over SSE, per-collector status (ran, running, partial, failed, needs key, skipped) with reasons, results appearing progressively.
3. Case workspace with tabs: Overview, Entities, Graph, Timeline, Evidence, Media, Map, Report.
4. Pin-to-case on EVERY result surface, including direct tool panels.
5. Provenance drawer, openable from any number, claim or attribute.
6. Admin: members and roles, API keys, credentials, usage and billing, audit log viewer, retention settings.

Rules:
- A never-measured value renders as an em dash with an explanation, never 0.
- Claim strength always renders with its text label, never colour alone.
- Light theme primary, dark supported, two density modes, all from tokens.
- Every control is a real button, link or labelled input. Icon-only buttons carry aria-labels. Text meets 4.5:1 in both themes.
- Locked modules explain what they do and how to unlock them.
- English only; keep the i18n plumbing.

CHECKPOINT: a user can sign in, run an investigation, watch it progress, pin evidence, view the graph and generate a report, entirely through the UI. Report and stop.
```

---

## Phase 7 — Commercial layer

```
Read CLAUDE.md and docs/ARCHITECTURE-DECISIONS.md section 0.

Build what makes this a business rather than a tool.

1. Plans and entitlements: module gating, quotas, seat limits, all enforced server-side.
2. Signup with vetting: work email verification, stated use case, acceptable-use policy acceptance, and a pending-approval state. Person-investigation modules stay locked until approval.
3. Onboarding: connect credentials, choose a plan, run a first investigation, invite teammates.
4. Usage and billing: per-tenant metering surfaced in the UI, budget alerts, and overage handling. Integrate a payment provider only if one has been chosen; otherwise expose the metering and leave billing pluggable.
5. Webhooks for alerts, with signing and retry.
6. Data rights: export a tenant's data, and a real deletion path covering evidence, media, derived data and object storage.
7. Legal surfaces: terms, acceptable-use policy, privacy notice, and a retention settings page.

CHECKPOINT: a new tenant can sign up, be approved, be gated correctly by plan, consume metered credits, and export or delete their data. Report and stop.
```

---

## Phase 8 — Infrastructure, observability and CI

```
Read CLAUDE.md section 5 and docs/ARCHITECTURE-DECISIONS.md section 10.

Make it operable by one person.

1. Dockerfiles per deployable: api, worker, web (static), vision (optional GPU). Multi-stage, non-root, minimal.
2. Compose for local; deployment manifests for a managed container service. Cloud-agnostic only — no provider-specific services in application code.
3. OpenTelemetry: traces from request to job to collector call; structured logs carrying tenant, run and job IDs; metrics for queue depth, per-collector duration and failure rate, circuit state, credits and tokens per tenant.
4. Expose collector health metrics through the API so the in-product health panel shows the same truth as the dashboards.
5. Error tracking, uptime checks, and a short alert list: API error rate, stuck jobs or dead-letter growth, database space or connections, cost spikes, circuit breaker stuck open.
6. CI: lint, typecheck, JS tests, Python tests, cross-tenant isolation tests, prompt-injection tests, image build, migrations, deploy. Isolation test failure blocks release.
7. Secrets from the cloud secret manager. No environment files in production.
8. Backups with point-in-time recovery and a documented, tested restore procedure.
9. Runbooks in docs/: a collector provider changes its API, the dead-letter queue fills, a restore drill, and rotating the vault master key.

CHECKPOINT: staging deploys from CI, traces and metrics appear, an alert fires correctly in a deliberate failure test, and a restore has been performed at least once. Report and stop.
```

---

## Phase 9 — Hardening and launch readiness

```
Read CLAUDE.md in full.

Close the gaps before the first paying customer.

1. Security review: dependency and secret scanning, rate limits at the edge, session and API key handling, SSRF and injection coverage, file upload limits and type checks.
2. Repair the Python vision service: fix insightface (1.0.1 does not exist; use 0.7.3), migrate transformers to the current major version, update torch/torchvision/onnxruntime/numpy/pillow, and LEAVE opencv-python-headless 5.0.0.93 alone — it is valid. Verify every pin installs. Either implement or honestly return 501 for the stub endpoints.
3. Load test the job system: many concurrent investigations, one deliberately failing source, and confirm bulkheads and circuit breakers behave.
4. Accessibility pass on the main flows.
5. Complete the licence audit from Phase 0: resolve every collector still marked BLOCKED, either by licensing it, replacing it, or removing it.
6. Write the final report in docs/BUILD-REPORT.md: what was migrated, what was rewritten, what was dropped and why, dependency changes, test and coverage status, known gaps, and decisions still needing a human.

CHECKPOINT: full test suite green, no BLOCKED collectors enabled, load test passing, build report complete.
```

---

## Running notes

- If a phase's checkpoint fails, fix it before moving on. Do not let an agent carry a red build forward.
- Update `docs/PLAN.md` at the end of every phase, so a fresh session can resume with context.
- Phases 3 through 6 are each large enough to need several sessions. Split by package when that happens, and keep the checkpoint as the phase boundary.

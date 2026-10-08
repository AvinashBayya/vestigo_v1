# Architecture Decisions

Status: agreed, September 2026. This record exists so neither the team nor an AI coding agent relitigates settled choices mid-build. Each entry states the decision, why, what it costs, and what would make us change our mind.

Product: a commercial, multi-tenant SaaS OSINT investigation platform, rebuilt from an earlier demonstrator. The ADITI / PS-18 compliance framing no longer applies.

---

## 0. Product context

- **Deployment:** multi-tenant SaaS only. No air-gapped or per-customer on-premise installs.
- **Buyers:** mixed (enterprise security, government and law enforcement, corporate due diligence). Served through per-plan module gating. Enterprise security is the suggested beachhead because the five priority tools are TECHINT-heavy. Not yet confirmed.
- **Team:** one engineer (the founder), possibly one or two juniors later, with heavy AI-assisted development.
- **Product name:** undecided. "Sentinel" collides with Microsoft Sentinel in the same market and should not be carried forward without a trademark check.

---

## 1. Rules carried over, changed, or dropped

| Rule | Status | Reason |
| --- | --- | --- |
| Open-weight LLMs only | **Kept**, now by choice | Data sovereignty is a selling point and keeps government buyers possible. Llama-derived models remain excluded. |
| Never fabricate data | **Kept**, strengthened | For a paid product this is the core trust promise. Enforced by tests, not convention. |
| Passive collection by default | **Kept** | Unauthorised scanning creates legal exposure (IT Act 2000 s.43/66) for us and our customers. Active scanning is gated behind a recorded scope authorisation. |
| DPDP-grade privacy handling | **Kept**, stricter | As a commercial data fiduciary: consent handling, retention windows, real deletion. |
| No Instagram / Facebook / X scraping | **Kept** | Platform terms create legal risk. Official paid APIs may be considered later. |
| Free tooling and data only | **Dropped** | Paid APIs are allowed; each becomes a metered cost line per tenant. |
| M1–M5 module framing | **Dropped** | Replaced by product-led navigation: search, case, report. |
| Demonstrator markings, air-gap assumptions | **Dropped** | Artefacts of the government programme. |

---

## 2. Language and runtime — TypeScript on Node, with a language-neutral collector contract

**Decision.** TypeScript on the current Node LTS everywhere, pnpm workspaces, Turborepo, Vitest. Collectors are defined by a language-neutral contract (queue message in, schema-validated JSON out) so a Python collector runtime can be added later without redesign. That runtime is **not** built until a Python-only tool requires it.

**Why.** Roughly 80 business-logic modules and 2,056 tests already exist in TypeScript. One language across frontend, backend and workers suits a solo maintainer. The Bun-in-dev, Node-in-prod split in the old codebase caused real production bugs and is eliminated.

**Cost.** The OSINT ecosystem is Python-heavy; some future tools will need wrapping as services rather than ported.

**Revisit if.** More than a handful of high-value collectors turn out to be Python-only; then build the Python collector runtime behind the existing contract.

---

## 3. Backend framework — Fastify with REST and OpenAPI

**Decision.** Fastify with Zod type providers. A single public contract at `/api/v1`, documented by an OpenAPI spec generated from the same schemas that validate requests. The product's own frontend consumes a client generated from that spec, so the UI can do nothing the API cannot.

Supporting choices: RFC 9457 problem-details errors with machine-readable codes; cursor pagination; idempotency keys on anything that starts work; SSE for live job progress; outbound webhooks for alerts. No GraphQL, no tRPC, no Express.

**Why.** Mature official plugins for rate limiting, security headers, back-pressure and uploads. Schema-first design means the compiler and the spec catch AI-generated mistakes, which is the main safety net when reviewing solo. NestJS was rejected: its value is enforcing consistency across large teams, and its boilerplate is a cost here.

**Structure.** Modular monolith. Each feature module owns routes, service and data access; business logic lives in shared packages and knows nothing about HTTP. Discipline comes from folder conventions, lint rules and `CLAUDE.md`, not from a framework.

**Revisit if.** The team grows past roughly five engineers of mixed seniority.

---

## 4. Tenancy and authentication — Postgres RLS with Better Auth

**Decision.** Shared database, shared schema, `tenant_id` on every table, isolation enforced by Postgres row-level security. Every request opens a transaction and sets the tenant context; no query may run outside one. Better Auth, self-hosted, with its organisation plugin for teams, roles and invitations.

Supporting rules:

- Permission-based access checks (`investigation:create`), never role-name checks.
- Module gating per plan, which is how the mixed-buyer strategy is enforced.
- MFA required for all users. For an OSINT product, account takeover is a data breach involving third parties.
- API keys separate from sessions: scoped, rotatable, hashed at rest, independently rate-limited.
- Customer vetting at signup: work email verification, stated use case, signed acceptable-use policy, and manual approval before person-investigation features unlock.
- Append-only audit log of who searched what, when, under whose authorisation.
- Per-tenant credential vault with envelope encryption; the master key lives in the cloud secret manager.
- Per-tenant retention windows and a real delete covering evidence, media and derived data.

**Why.** Isolation enforced by the database survives application bugs. Self-hosted auth avoids per-user fees and keeps identity data in-region, consistent with the sovereignty story.

**Cost.** Enterprise SSO and SCIM need more work than a managed provider would.

**Revisit if.** An enterprise deal requires SAML and SCIM sooner than expected; WorkOS is the fallback.

---

## 5. Data — Drizzle on Postgres, graph deferred

**Decision.** Managed Postgres as the single source of truth, Drizzle as the query layer, forward-only expand/contract migrations.

Three parts of the schema carry the product's integrity:

- **Evidence is append-only.** Collector and version, `observedAt` separate from `collectedAt`, source URL, content hash, and a pointer to the raw payload in object storage. Content-addressed storage deduplicates and makes every claim re-verifiable.
- **Merges are reversible.** People and organisations are never auto-merged by name. Merge decisions are records carrying reason and confidence, and can be undone without losing evidence.
- **Locations are never auto-merged by name either** (amended 2026-10-08, D-23). The earlier codebase merged location entities whose names matched; two places can share a name. No collector creates LOCATION entities yet, so the database's rule that refuses an automatic merge on a name alone is extended to LOCATION when R3 first creates them, with a test.
- **Claim labels are first-class.** OBSERVED / REPORTED / DERIVED / CORRELATED / INFERRED / HYPOTHESIS is a column, not a string in a report.

Supporting choices: evidence partitioned by month from day one; pgvector enabled for semantic deduplication; Postgres full-text plus trigram search; a `region` field on tenants even with one region today; point-in-time recovery; cross-tenant isolation tests in CI that block the build.

**Graph.** A `GraphStore` interface with a Postgres adapter only. Recursive queries handle case-sized graphs. Neo4j is deferred to Phase 2 behind an outbox-backed projection, triggered by a real need: graphs beyond roughly 50,000 edges, path-finding or graph algorithms in a feature being sold, or a demo requirement Postgres cannot meet.

**Redis.** Job queue, LLM response cache, rate-limit counters (fixing the per-process counters that over-permit across replicas), and short-lived collection locks.

---

## 6. Jobs and workers — BullMQ, with fault isolation as a first-class requirement

**Decision.** BullMQ on Redis. An investigation is a parent job that fans out to per-collector jobs on per-source queues, then fans in to fusion and reporting. One worker codebase, deployed as separate pools by queue.

Because jobs are now durable and background, the old 60-second global cap becomes a per-collector budget; a 20-minute SpiderFoot scan is normal, with progress streamed over SSE.

**Fault isolation rules** (these are the answer to "should this be microservices"; the answer is no — isolation comes from these patterns, not from deployment boundaries):

- Timeouts on every external call. Nothing waits indefinitely.
- Bulkheads: fixed concurrency per collector, so one slow source cannot consume every worker slot.
- Circuit breakers: after repeated failures, stop calling a source for a cooling period and mark it unavailable in the UI.
- Dead-letter queue: failed jobs are inspectable and replayable, never silently dropped.
- **Replay meets the person gate** (amended 2026-10-08, D-30). A replay re-queues collection on the job's run and rewrites the job's and the run's recorded state, so it is refused whole, before anything changes, when the run is person data and the tenant may not access it: the same gate as reading the run. This reverses the Phase 6a ruling that left replay ungated ("returns the run id only; the worker re-checks admission"). The worker's re-check stops the collection, but by then the request has already re-queued person collection and changed the person run's record; its recorded failure would be overwritten by the refusal.
- Idempotent jobs keyed by tenant, target, collector and parameters, so retries never double-charge credits or duplicate evidence.
- Retries distinguish causes: rate limits, timeouts and 5xx back off and retry; auth failures and invalid targets fail immediately.
- Degradation is a product behaviour: a failed collector renders as failed beside the ones that succeeded.

**Metering.** Every external call records units consumed (API credits, search queries, LLM tokens) against the tenant, and quotas are checked before dispatch.

**Monitors** are defined in Postgres, not only as Redis repeatable jobs, so schedules survive a Redis flush.

**Tool containers.** SpiderFoot and theHarvester run as their own services, called over HTTP. This keeps GPL code at arm's length from the commercial codebase and lets each scale separately. Targets are passed as arguments, never interpolated into a shell command. User-supplied URL fetches go through SSRF protection.

---

## 7. AI and LLM serving — hybrid, open-weight only

**Decision.** A provider interface with two configured backends: hosted open-weight APIs by default, and a self-hosted vLLM profile for tenants requiring in-house inference. The vLLM path is built and validated once, then left switched off until a customer needs it, so no GPU idles.

Supporting choices:

- Explicit model allowlist, permissively licensed. Llama-derived models excluded.
- Task-based routing: a small fast model for classification and extraction, a larger one for report synthesis.
- The citation validator is retained: every claim maps to an evidence ID, uncited output is retried once and then fails honestly.
- Responses cached in Redis by prompt, model and version; tokens metered per tenant.
- Open-weight embeddings into pgvector for deduplication and semantic search.

**Prompt injection is treated as an attack on the product, not an edge case.** Everything collected from the internet is untrusted data: passed in delimited form, never concatenated into instructions, with schema-validated output. A corpus of known injection payloads runs in CI.

**Evaluation.** A golden set of investigations with known-correct outputs runs in CI, tracking citation validity and hallucination rate, so models and prompts can change without quietly degrading report quality.

**Vision service.** CPU media forensics (EXIF, C2PA, perceptual hashing, OCR) ships in v1. GPU models (detection, description, face analysis) stay behind a feature flag. Face matching must not ship before vetting, consent handling and audit logging are solid. The existing service also needs dependency repair: `insightface==1.0.1` does not exist (latest real release is 0.7.3), and transformers, torch, onnxruntime, numpy and pillow are all badly outdated. `opencv-python-headless==5.0.0.93` is valid and must not be "fixed".

---

## 8. Frontend — React SPA on Vite

**Decision.** A single-page app built with Vite and served as static files from a CDN, consuming the public API like any other client. TanStack Router and Query, Zustand for UI-only state, Tailwind with shadcn/ui, TanStack Table with virtualisation, Recharts, MapLibre GL, Cytoscape.js behind a swappable component, SSE feeding job progress into the query cache. Vitest and Testing Library for components, Playwright for critical flows. The marketing site is separate.

**Why.** Everything sits behind a login, so SSR adds little. TanStack Start's server functions are precisely the coupling being removed.

**Language scope.** English only at launch. The i18n infrastructure is retained but the 15-language surface is not maintained until customers ask.

---

## 9. Design

A design system artifact holds the tokens and rules; screens are assembled from it rather than invented. Light theme is primary, dark supported. Two density modes. Claim strength, collector status and entity class are the only semantic uses of colour, and each always carries a text label as well, never colour alone. Printed reports are a separate design: serif body at 12pt minimum, numbered citations, claim labels as text for greyscale printing.

Structural UI rules that fix defects in the old build:

- Pin-to-case appears on every result, including direct tool panels.
- A never-measured value renders as an em dash with an explanation, never as 0.
- A provenance drawer opens from any number, claim or attribute.
- Locked modules explain what they do and how to unlock them.
- Cost is shown twice: estimated before a run, actual after.

---

## 10. Infrastructure

**Cloud: undecided**, to be chosen on cost. Therefore only portable building blocks are used: containers, standard Postgres, Redis or Valkey, S3-compatible storage, OpenTelemetry. No provider-only services in application code. An India region is required for DPDP and latency.

Local development on Docker Compose; staging and production on a managed container service with rolling deploys and one-command rollback. No Kubernetes. Secrets in the cloud secret manager, never environment files in production.

**Observability.** Structured logs carrying tenant, run and job IDs; traces from request to job to collector call; metrics for queue depth, per-collector duration and failure rate, circuit state, and credits and tokens per tenant; error tracking. Collector metrics feed the in-product health panel, so customers see the same truth the operator does.

**Alerts, deliberately few.** API error rate, stuck jobs or a filling dead-letter queue, database space or connections, cost spikes, and a circuit breaker stuck open.

**CI.** Lint, type check, JS and Python tests, cross-tenant isolation tests, prompt-injection tests, then image build, migrations and deploy. Isolation test failure blocks release.

**Backups.** Point-in-time recovery, object storage versioning, and at least one tested restore.

---

## 11. Data licensing — an open workstream

Selling the product changes what may legally be used. Confirmed so far:

- **Shodan InternetDB** is free for non-commercial use only; a paid Shodan API or enterprise licence is required.
- **Google Custom Search JSON API** is closed to new customers and ends for existing ones on 1 January 2027. **Brave Search API** is the chosen dork backend. It does not support the full Google operator set, so the dork engine must translate what it can and clearly mark what it could not run, offering browser links for the remainder. Silently returning fewer results would be a fabrication defect.
- **OpenSky** permits non-profit research, education, internal commercial evaluation, and government use; a paid product needs a separate agreement. The aircraft layer ships disabled and labelled accordingly.

Still to verify before launch: Reddit commercial API terms, HIBP, GPSJam's underlying ADS-B data, the GPL and AGPL tools (theHarvester, SearXNG, IVRE), Neo4j Community if ever adopted, and Maltego (a TRX transform server and graph export are the realistic starting point; Transform Hub requires partnership).

Every source must carry a licence note in its collector registry entry stating whether commercial use is permitted.

---

## 12. Explicitly not doing

- Microservices as an architecture. Fault isolation comes from timeouts, bulkheads, circuit breakers and separate worker pools. Services are extracted only for a different runtime, a wildly different resource profile, independent scaling needs, a separate compliance boundary, or a team that owns them.
- Kubernetes at launch.
- Neo4j in v1.
- GraphQL.
- Social media posting, scheduling or publishing. Despite the old repository name, this is an analysis product, and posting would breach platform terms.
- Re-adding scrapers for Instagram, Facebook or X.
- Any feature that fabricates a value to fill a gap.

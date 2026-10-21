# Vestigo — Repository Audit (Stage 1)

Date: 2026-10-21 · Audience: the founder + any collaborators who will choose the implementation scope.
Scope: read-only inspection of the current codebase (apps/, packages/, infra/, docs/), plus safe build/test runs. No project files were modified. `legacy/` inspected only as porting reference.

---

## 1. Architecture map

Modular monolith, TypeScript end to end, pnpm workspaces + Turborepo. Node 24, pnpm 12, Vitest. Build is green.

- **apps/api** — Fastify + Zod type provider. Routes only; business logic lives in packages. OpenAPI 3.1 generated from the same Zod schemas that validate requests. ~55 routes. Auth/tenant-transaction/audit enforced by an `onRoute` hook so every route must declare its permission or a public reason, or the app refuses to start.
- **apps/web** — React 19 SPA (Vite), TanStack Router/Query, Zustand, Tailwind v4, Cytoscape. Talks only through a client generated from the OpenAPI spec (zero hand-written fetches).
- **apps/worker** — thin wrapper (3 files); all job logic is in packages/osint-engine. Deployed as pools selected by `WORKER_QUEUES`.
- **packages/core** — vocabulary/enums (DB enums generate from these), evidence/report domain types, target detection, `GraphStore` interface. Depends on nothing else.
- **packages/access** — permissions, roles, plan + vetting gating, the person-gate, API-key hashing/verification. Genuinely pure (node:crypto only).
- **packages/collectors** — collector SDK/contract, source catalogue with commercial-use verdicts, the access-method seam (open/official/licensed/operator), and the single SSRF-hardened fetcher.
- **packages/osint-engine** — planner → fan-out (per-collector jobs) → fan-in (fusion), the single evidence write path, entity resolution, report generation, and the case-analysis job processor.
- **packages/case-engine** — pure case analysis (coverage, collectors, discipline breakdown). No I/O, clock, or randomness.
- **packages/llm** — real configurable OpenAI-compatible provider, citation validator, token metering, prompt-injection defence. Unavailable (honestly) until a provider is configured.
- **packages/db** — Drizzle on Postgres 17 + pgvector. 25 app tables + 9 identity tables, 28 forward-only migrations, RLS FORCE + three disjoint DB roles, content-addressed evidence store (filesystem).
- **packages/integrations** — credential vault (envelope encryption), API-key service, fail-closed Redis rate limiters + circuit breaker, PDF/JSON/CSV/Maltego exports.
- **packages/config** — env schema (generates .env.example), product name, shared tsconfig/eslint, the repo gates (fabrication-check, check-exports).
- **packages/media-forensics** — empty placeholder.
- **packages/ui** — shadcn-based component library + dev gallery.
- **infra/** — only the Postgres bootstrap SQL (three roles, pgvector). No Dockerfiles for api/worker/web. `services/vision` (Python) does not exist yet.

Phase tracker: Phases 0–5 done; Phase 6 (frontend) substantially done; **Phase 7 (commercial), 8 (infra/observability/CI), 9 (hardening) not started.** Active frontier = Track M (news/social monitoring → "situation brief"), mostly planned, partly built.

---

## 2. Existing capabilities and status

| Capability | Status |
|---|---|
| Auth: invite-only sign-in, mandatory TOTP MFA, enrolment, org/tenant selection, sign-out | Done, wired API+web, test-backed |
| Tenant isolation (RLS FORCE, composite FKs, column grants, withTenant set_config, scope liveness, role safety) | Done, defence-in-depth, isolation tests in suite |
| API keys (scoped, capped to issuer, hashed, rotatable, rate-limited, fail-closed) | Done |
| Credential vault (AES-256-GCM envelope, per-credential data key, audited reads) | Done (API); **no web UI** |
| Investigations + runs: create, plan, fan-out, SSE progress, fan-in fusion | Done |
| Collectors framework (SDK, registry, catalogue verdicts, access methods, SSRF fetcher) | Done, robust |
| Collectors implemented | 13 named + 217 RSS; **only 3 run by default** (see §4) |
| Evidence path (content-hash store, observed_at vs collected_at, registry source labels, append-only) | Done; 74 real payloads on disk prove it runs live |
| Entity resolution / reversible merges / graph / timeline | Done (Postgres graph adapter only) |
| Cases + pins + per-case person-gated reads | Done |
| Case analysis (pure engine + gated job) | Done |
| Reports: generation, coverage/limitations, PDF/JSON/CSV/Maltego export | Done; **AI synthesis dormant until LLM configured** |
| LLM provider, citation validation, metering, injection defence | Built; **no provider configured by default** |
| Fault isolation: timeouts, bulkheads, circuit breakers, DLQ, retries-by-cause, idempotency, metering | Done (two caveats in §4) |
| Web: core analyst loop (sign-in→run→SSE→results→pins→report→export) | Done, generated-client only |
| Web: member mgmt, credentials, cost metering, media/map tabs, monitors | **Stubbed/NotBuilt, cleanly labelled** |
| Retention settings | Recorded but **`enforced:false`** — no deletion |
| Monitoring "Watch" product (Track M) | Mostly planned; collectors partly built, held UNVERIFIED; scheduler/readings/narratives/screens not built |
| CI / Dockerfiles / observability | Not started |

Nothing fabricates data: unmeasured values render as em-dash + reason; stubs use `NotImplementedError` or explicit NotBuilt surfaces; estimate/analysis credits are `null` with a reason (no cost model yet), never 0.

---

## 3. Build and test results

- `pnpm build` → **PASS** (14/14 turbo tasks; OpenAPI emitted; web bundle built).
- `pnpm test` → **turbo exits 1.** `@repo/web` test task fails: **3 failed test files** (`lazy-routes.test.tsx`, `report-view.test.tsx`, `settings.test.tsx`), 20 passed. Every other package suite passes (osint-engine observed passing live; several cached).
- Root cause: a `vi.mock` factory hoisting error originating in `apps/web/src/lazy-routes.test.tsx` (an **untracked** file from the in-progress lazy-route/code-splitting refactor), cascading into report-view and settings tests. Error: *"the members screen could not be downloaded"* + an error-boundary assertion (`role=heading name="Cannot continue"`) that no longer matches.
- Attribution: these are exactly the files changed in the uncommitted working tree (git status). The last **committed** state's recorded pipeline was green (2,318 tests). I did not re-run against a clean HEAD (that would modify the tree), so HEAD-green is inferred from the evidence, not independently re-verified here.
- lint / typecheck: not separately run this session; `build` (which includes codegen) is green, and the web failures are test-only. Recommend running `pnpm turbo lint typecheck` during implementation.

Blockers for a clean baseline: (1) the red web tests above; (2) a live run needs Postgres+Redis (up) **and** an API port — the Vestigo API default port 3000 is currently occupied by an unrelated `intelligence-frontend` container (`0.0.0.0:3000`); set `API_PORT` or stop that container.

---

## 4. Critical bugs, risks, and data-integrity concerns

1. **Red test suite (working tree).** Delivery blocker until the lazy-route refactor is finished/reverted. Fixable (test-infra mocking + one assertion).
2. **No CI.** The product's safety story (fabrication, cross-tenant isolation, prompt-injection gates) runs only locally/manually. Nothing enforces it on commit → regressions can ship silently. `.github/` does not exist.
3. **Thin runnable collector surface.** Only `wikidata`, `contact.phone`, `news`(GDELT) run under the default config; everything else is held UNVERIFIED pending owner licence verdicts. Of the three, **`news`/GDELT has a "checked-only" extractor — it stores evidence but produces no entities/claims/graph.** So the one broadly-useful open source doesn't populate results.
4. **LLM not configured by default** → no report synthesis / narrative (honest, but the headline feature is dormant). `LLM_HOSTED_BASE_URL` empty.
5. **Retention not enforced / no deletion path** (`settings.ts` `enforced:false`). CLAUDE.md §9 ("deletion must genuinely remove evidence") is unmet; report generation does not re-check the person gate (tracked as D-34). Commercial/privacy risk for Phase 7/9, not for a prototype demo.
6. **No global security-headers (helmet) or global rate-limit plugin.** Handled narrowly (API-key limiter + Better Auth's own limiter + per-response headers on binary/SSE). Fine now; a Phase 9 hardening gap.
7. **Bulkhead gap at scale.** `investigations` and `fusion` queues use per-process concurrency (hardcoded 4), not `setGlobalConcurrency`, unlike collect/reports/renders/case-analyses — weaker than the documented "bulkhead across every worker" at multi-pool scale.
8. **DLQ is inert** (manual replay via API only; no auto-drain or growth alert — Phase 8). **S3 content store and graph DB adapter not built** (deferred by design; filesystem + Postgres are fine for a prototype).
9. **TOPIC/FILE fusion gap.** `TARGET_TYPES` includes TOPIC/FILE and detection/planning can propose them, but fusion throws `NotImplementedError` for both → a TOPIC run stores evidence but yields no entities; no collector reads FILE. (Also: TOPIC is person-gated.) Keep demos on DOMAIN/ORGANIZATION to avoid this.
10. **Minor:** report-export OpenAPI `200` schema says `z.string()` but body is binary via `reply.hijack()` (cosmetic contract mismatch); `entity-merges` list probes only a fixed window (accepted D-31 edge); benign legacy enum/RLS artifacts under expand-then-contract.

Security posture is otherwise strong: SSRF + DNS-rebinding defence, pinned connections, fail-closed rate limiters/circuit breaker, constant-time key verification, no secret logging, `.env` correctly untracked, append-only evidence/audit, delimited untrusted LLM input.

---

## 5. Missing connections between existing components

These are places where one side is built and the other isn't wired — the cheapest value to recover:

- **news/GDELT evidence → entities:** collector stores evidence, but the fusion extractor is checked-only → no graph/claims from it.
- **Credential endpoints → UI:** `/credentials` + vault fully built; web Settings shows NotBuilt → a tenant cannot add provider keys through the product (so keyed collectors can't be enabled by users).
- **Member endpoints → UI:** invite/role/remove exist API-side; web Members is read-only "provisional."
- **Metering → UI:** `usage_events` recorded + `/usage` endpoint exist; web shows "per-run metering not built" and an unmetered credits meter; `estimatedCredits` always null (no cost model declared on collectors).
- **Retention settings → deletion job:** recorded, nothing consumes them.
- **Report generation → person-gate re-check (D-34):** reads re-check; report generation doesn't.
- **Officer "Watch" mockups + MONITORING-PLAN → backend:** screens/flows designed; monitors/items/readings/narratives tables + scheduler not built.
- **Built-but-gated collectors → runtime:** ~10 fully built, tested collectors (DNS, RDAP, crt.sh, Common Crawl, GitHub, Hacker News, dev.to, Wayback) are one `audited(url)` line each away from running.

---

## 6. The three highest-value improvements (3-day target)

Goal: make the **flagship investigation → report workflow genuinely demonstrable end-to-end on a real target, with real entities, a populated graph, and an AI-synthesised, cited report.** This completes an existing workflow (not new features), reuses the whole architecture, and adds zero dependencies.

**#1 — Make runs produce rich results.**
 - (floor, no new verdicts) Write the **GDELT/news fusion extractor** (article→URL entity, outlet→DOMAIN entity, `published_by` relationship, REPORTED claims) so the already-permitted `news` source populates the graph. Pattern exists (wikidata extractor). Pair with `wikidata` (ORGANIZATION target) for entity richness.
 - (unlock, owner-gated) For the subset of already-built, keyless **open** sources whose terms you confirm permit commercial use, record the licence verdict (one `audited(row, url)` line each in `catalogue.ts`) to flip them PERMITTED. Strong candidates to review: Wikidata (already PERMITTED), crt.sh (CT logs), RDAP, Cloudflare DoH, Common Crawl, Hacker News API, dev.to. The collectors + extractors already exist and are tested — recording verdicts is **your** decision (reading terms); the code change is mechanical.

**#2 — Turn on AI report synthesis.** Configure the hosted open-weight provider (`LLM_HOSTED_BASE_URL`/`LLM_HOSTED_API_KEY`/allowlisted Qwen model — the Phase 5 live checkpoint already did this with Groq), then run a live synthesis checkpoint and confirm the citation validator passes on a real report. Wiring + verification; little or no new code.

**#3 — Make it a deliverable: green + guarded + driveable.** Fix the uncommitted lazy-route web test regression (restore green `pnpm test`), stand up a **minimal CI** (GitHub Actions running the existing gate: install → build → lint → typecheck → test incl. fabrication-check, check-exports, isolation tests, against Postgres+Redis service containers), and write a short demo runbook + a provisioned demo tenant so the flow can be driven live and repeatably.

Deliberately **out of scope** for 3 days: the Watch/monitoring product (Track M M1–M7 ≈ 25k lines), credential/member UIs, billing, deletion/retention enforcement, Dockerfiles/observability, Python vision service.

---

## 7. Realistic three-day schedule (solo + AI assistance)

**Day 1 — Green baseline + synthesis**
- Fix the 3 failing web tests; finish or cleanly revert the lazy-route refactor; commit; `pnpm turbo build lint typecheck test` green.
- Configure the hosted LLM; live synthesis checkpoint; confirm citation validation passes.
- Start the GDELT/news extractor + fixture tests.

**Day 2 — Rich live results**
- Finish + test the GDELT extractor. (If unlocking open sources: you record the verdicts; flip them PERMITTED; verify each built collector runs live.)
- End-to-end live checkpoint: provision a demo tenant → DOMAIN/ORG investigation → SSE → entities/graph/timeline/evidence+provenance → synthesised cited report → PDF export. Fix defects found live.

**Day 3 — Guard + demo**
- Minimal CI workflow (existing gates, with Postgres+Redis services).
- Demo runbook in docs/ + scripted/seeded demo path; quick a11y/polish sweep of the demo screens; buffer.
- Full dry-run against the acceptance criteria (§8).

---

## 8. Acceptance criteria for the final demonstration

- `pnpm turbo build lint typecheck test` **green** on a clean checkout and in CI.
- Demo tenant: password sign-in → **TOTP MFA** → select org → create an investigation on a real **DOMAIN/ORGANIZATION** target → start a run.
- Run executes **≥2 real collectors live** (wikidata + GDELT news, plus any owner-approved open sources), streaming job progress over **SSE**; failed/held collectors render as failed/held — **never hidden, never faked**.
- Results show **real entities, a populated graph** (nodes + edges with a provenance drawer), a **timeline** (observed vs collected), and **evidence** rows whose raw payload downloads as a sandboxed attachment and re-hashes correctly.
- A report generates **with AI synthesis**: every synthesised sentence cites an evidence ID (citation validator passes), coverage + limitations shown; exports to **PDF/JSON/CSV/Maltego**.
- **Tenant isolation** holds (second tenant sees none of the first's data) — evidenced by the isolation tests in CI.
- **No fabricated values** anywhere (fabrication-check green); unmeasured renders as em-dash + reason.

---

## 9. Exact files likely to need modification (implementation stage)

- **Web test fix / lazy-route refactor:** `apps/web/src/lazy-routes.test.tsx` (untracked), `apps/web/src/router.tsx`, `apps/web/src/main.tsx`, `apps/web/src/screens/Run.tsx`, `apps/web/src/test-screens.ts` (untracked), `apps/web/src/report-view.test.tsx`, `apps/web/src/settings.test.tsx`, `apps/web/src/workspace/{Workspace,GraphTab}.tsx`, `apps/web/src/workspace/test-fixtures.tsx`.
- **GDELT/news extractor:** `packages/osint-engine/src/fusion/extractors.ts` (replace the checked-only path for `news`), new fixtures under `packages/osint-engine/test/`, possibly `packages/osint-engine/src/fusion/identifiers.ts`.
- **LLM config:** `.env` (local), confirm `packages/config/src/llm.ts` (allowlist + model-name mapping); verify (no change expected) `packages/osint-engine/src/reports/synthesis.ts`.
- **Collector verdicts (owner-approved only):** `packages/collectors/src/catalogue.ts` (flip chosen sources to PERMITTED with `audited(url)`); `packages/collectors/src/data/rss-feeds.ts` only if an RSS publisher is unlocked.
- **CI (new):** `.github/workflows/ci.yml` (+ Postgres/Redis service config).
- **Demo (new/seed):** a runbook in `docs/`; `packages/db` seed if a demo seed is wanted; reuse `apps/api` `provision-tenant` as-is.

---

## 10. Notes

- Two unrelated Docker stacks are running on this machine (an older "sential/intelligence" stack with Mongo/Neo4j + the correct `vestigo-postgres-1`/`vestigo-redis-1`). Only the **port-3000 conflict** (intelligence-frontend vs Vestigo API default) affects a live Vestigo run.
- Do not relitigate settled ADR decisions (open-weight-only LLMs, Postgres RLS tenancy, no microservices, no IG/FB/X scrapers, never-fabricate).
- Licence verdicts are owner work by design; the engineering is ready behind them.

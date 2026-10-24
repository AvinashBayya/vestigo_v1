# Vestigo — Technical Due-Diligence Audit

**Audit date:** 2026-10-22
**Repository:** `D:\vestigo` — git `github.com/AvinashBayya/vestigo_v1`
**Branch audited:** `milestone/vestigo-days-1-3-osint-addendum` (HEAD `156952f`)
**Method:** read-only inspection of source, config, schema, migrations, tests and CI. Every claim is cited as `file:line`. Items not determinable without execution are marked **UNKNOWN — requires runtime access**. Secret *values* are never printed; only variable names, file and risk.

> This is an evidence-based audit of the code as it exists on disk. It does **not** rely on README, docs or commit messages except where it explicitly compares them against code.

---

## 1. What this project actually is

**Vestigo is a commercial, multi-tenant SaaS OSINT (open-source-intelligence) investigation platform**, pre-launch, built as a **TypeScript modular monolith** in a pnpm + Turborepo workspace. An operator signs in (invitation-only, MFA-mandatory), starts an *investigation* against a *target* (domain, IP, email, phone, username, URL, organisation or free-text topic), and the platform plans and runs a set of *collectors* against public/licensed sources, fuses the results into an evidence graph (entities, relationships, cited claims), and produces exportable reports (PDF/JSON/CSV/Maltego). The product's entire value proposition is **evidentiary honesty**: every datum is traceable to a source with a strength label, and unmeasured values are rendered as an em-dash, never fabricated.

It is **one project** (a monorepo of 3 apps + 11 packages), not several embedded products. There is a read-only `legacy/` reference copy of a previous codebase ("Sentinel AI") used only for porting; it is gitignored and never shipped.

- **Primary language:** TypeScript (~406 `.ts` + 92 `.tsx` tracked source files; ~65k non-test LOC, ~47k test LOC). One small SQL surface (28 migrations). No committed Python despite docs referencing a Python vision service (see §5).
- **Maturity:** **MVP / pre-launch, mixed.** The security, data-integrity and multi-tenancy foundations are production-grade and heavily tested; several user-facing capabilities are deliberately stubbed or frozen off (see "Missing pieces").

See [01-project-inventory.md](01-project-inventory.md) for the full stack and structure.

---

## 2. Overall architecture (one paragraph)

A **React 19 SPA** (`apps/web`, Vite 8) talks **only** through a client generated from the API's OpenAPI spec to a **Fastify 5 API** (`apps/api`). The API holds HTTP guards, Better-Auth identity wiring and sign-in routes only — all business logic lives in `packages/`. Work is enqueued to **Redis/BullMQ** and executed by **worker pools** (`apps/worker`) that run collectors through the orchestration engine (`packages/osint-engine`), fuse results to evidence, generate reports, and run case analysis (`packages/case-engine`, a pure function library). State lives in **Postgres 17 + pgvector** (`packages/db`) under **row-level security**, reached through three distinct least-privilege DB roles. An optional **open-weight LLM** (`packages/llm`, self-hosted vLLM or a hosted OpenAI-compatible endpoint) writes only cited synthesis. Full diagrams in [02-architecture.md](02-architecture.md).

---

## 3. Strongest components (what to keep as-is)

1. **Tenant isolation (`packages/db`).** Three independent layers — RLS *enabled and forced* on all 25 public tables with one canonical `tenant_isolation` policy, composite `(tenant_id, id)` foreign keys, and least-privilege column grants to a non-superuser `app_runtime` role — plus a catalog-driven, release-blocking test suite that auto-fails any new table lacking RLS/policy/`tenant_id`. See [06-database-and-data-model.md](06-database-and-data-model.md).
2. **The no-fabrication discipline.** Enforced in CI by a regex `fabrication-check`, an ESLint AST plugin, and pervasive `null`/em-dash handling in the UI. Absent values are never `0`/`"N/A"`; timestamps are never substituted; collectors that fail return typed errors, not empty successes.
3. **SSRF-hardened outbound fetcher (`packages/collectors/src/fetcher`).** Single egress path, exact-hostname allowlist re-checked on every redirect, DNS-rebinding defense with the socket pinned to the checked address, full private/metadata/reserved IP blocking, redirect cap, decompression-bomb guard, fail-closed rate limiting.
4. **The LLM safety envelope (`packages/llm`).** Open-weight-only allowlist (structurally refuses Llama/Gemini/Azure), untrusted data passed delimited + inert-escaped, a type-level brand preventing interpolation into instructions, citation validation with retry-once-then-fail, and output guards that reject obedience to injected instructions.
5. **Identity & access (`packages/access`, `apps/api/src/auth`).** One permission catalogue shared by the API guard and the identity provider, MFA mandatory and un-disable-able, API keys SHA-256 hashed and verified in constant time with issuer-capped scope, envelope-encrypted credential vault (AES-256-GCM, audited-first reveal).
6. **Person-data gate.** A single shared decision (`personGate`) gates reading *and* collecting person data on plan + vetting, fails closed (unknown collector = person), refuses the whole read (never silently thins rows), and is guarded against copy-paste divergence by a CI test.

---

## 4. Biggest risks (detail in [07-security-privacy-audit.md](07-security-privacy-audit.md))

| # | Risk | Severity | Where |
|---|------|----------|-------|
| 1 | **Live third-party API keys in plaintext** in local `.env` (`OPENAI_API_KEY`, `GEMINI_API_KEY`) — gitignored and *not read by Vestigo* (personal `llm-council` skill keys), so exposure is via backups/archives/screen-share, not git. | High (operational) | `.env:173-177` |
| 2 | **Data-retention expiry is recorded but not enforced** — `tenants.retention_days` is stored; nothing deletes on expiry yet. Diverges from the stated "deletion must genuinely remove data" promise for the retention path. | Medium | `settings.ts:12-15`; `tenancy.ts:39-42` |
| 3 | **No CORS/Helmet middleware** in the API; cross-origin safety rests on an Origin-allowlist CSRF guard and an assumed reverse proxy. Browser CORS/header behaviour is **UNKNOWN — requires runtime access**. | Medium | `apps/api/src/http/principal.ts:131-139` |
| 4 | **Populated dev `AUTH_SECRET` / `VAULT_MASTER_KEY`** (`VAULT_MASTER_KEY_ID=local-dev-1`) in `.env` — fine for dev, must never reach production. | Medium | `.env` (masked) |
| 5 | Report/evidence **attribution URLs are not scheme-validated** before being rendered as links (evidence `sourceUrl` is). Low risk (trusted registry source), but inconsistent. | Low | `ReportDocument.tsx:200-208`; `Provenance.tsx:453-459` |
| 6 | **Doc/code drift**: CLAUDE.md §6 lists `services/vision` + tool containers that do not exist; CLAUDE.md §9 still calls D-34 (report-gen person-gate) an open gap though code closed it. | Informational | see [08](08-code-quality-and-tech-debt.md) |

**No Critical code vulnerability was found.** For its stage this codebase is unusually well-secured; most findings are operational or forward-looking.

---

## 5. Missing / unfinished pieces

- **`services/vision` (Python GPU) and `infra/` tool containers (SpiderFoot/theHarvester/IVRE/nmap) do not exist**, and there are **no Dockerfiles** — compose uses pre-built images only. These are ADR-level plans. `packages/media-forensics` is an empty placeholder (0 tests).
- **Only 3 of 231 registered collectors are runnable** (`contact.phone`, `wikidata`, GDELT `news`); the other 228 (incl. all 217 RSS) are code-complete but frozen `UNVERIFIED` pending a recorded licence verdict — this is the intended default-deny state.
- **Person investigation is gate-only:** `POST /api/v1/person/search` returns 501; no person collector exists yet.
- **LLM synthesis is optional and off by default** (`NOT_CONFIGURED` when no endpoint set); reports still generate without it.
- **Production S3 content store not built** (filesystem store only).
- **UI gaps:** Members and Settings screens are "provisional" (read-only); Media, Map, Monitor-alerts, Contradictions and Merge-candidates tabs render honest "Not built" placeholders with no backing endpoint.
- **CI is minimal** (one workflow: build/lint/typecheck/test); no image-build/migrate/deploy/Python/prompt-injection-corpus job wired.

---

## 6. Top 10 actions (full roadmap in [10-recommendations-and-roadmap.md](10-recommendations-and-roadmap.md))

1. **Move the live `OPENAI_API_KEY`/`GEMINI_API_KEY` out of the repo `.env`** into the `llm-council` skill's own config; rotate them if they have ever been shared/screen-shared.
2. **Regenerate `.env`** from the current schema (`pnpm --filter @repo/config generate:env`) — it carries the retired `COLLECTORS_ALLOW_UNVERIFIED` and is missing three newer vars.
3. **Fix the CLAUDE.md drift**: remove `services/vision` from the §6 layout, and update §9's D-34 text (the report-gen person-gate is implemented at `generator.ts:148-163`).
4. **Decide and implement the retention-deletion path** (or relabel the Settings copy so it never implies enforcement).
5. **Add explicit CORS/Helmet** (or document the required reverse-proxy config) and add a runtime check that production `AUTH_SECRET`/`VAULT_MASTER_KEY` differ from the dev values.
6. **Scheme-validate attribution URLs** the way `sourceUrl` already is.
7. **Stand up the real CI pipeline** ADR §10 describes: run DB isolation tests against live Postgres, add the prompt-injection corpus and golden-eval as named steps, and add image-build/migrate stages.
8. **Remove dead weight:** the unused `zustand` dependency; reconcile the unused `pgvector` extension (either use it for the planned graph/embedding work or drop it from bootstrap).
9. **Build the first person collector + wire `person/search`**, or clearly mark the person module "not yet available" end-to-end.
10. **Verify the suite end-to-end on a clean machine** (Postgres + Redis up) and publish the pass/fail — current green status is **UNKNOWN — requires runtime access**; only a cached `@repo/config` run (273 tests) is on disk.

---

## 7. Deliverables index

| File | Contents |
|------|----------|
| [README.md](README.md) | This executive summary |
| [01-project-inventory.md](01-project-inventory.md) | Languages, frameworks, packages, entry points, structure |
| [02-architecture.md](02-architecture.md) | Reconstructed architecture, data flow, module map, API surface, jobs, Mermaid diagrams |
| [03-external-services-and-apis.md](03-external-services-and-apis.md) | Every external API/service, credential variable, integration detail |
| [04-ai-llm-agents-mcp-a2a.md](04-ai-llm-agents-mcp-a2a.md) | LLM/model inventory, prompts, guards, MCP/agent/RAG findings |
| [05-crawlers-scrapers-data-sources.md](05-crawlers-scrapers-data-sources.md) | Every collector, data source, fetcher/SSRF, extraction |
| [06-database-and-data-model.md](06-database-and-data-model.md) | Schema, tables, RLS, migrations, indexes, governance gaps |
| [07-security-privacy-audit.md](07-security-privacy-audit.md) | Severity-ranked findings + remediation |
| [08-code-quality-and-tech-debt.md](08-code-quality-and-tech-debt.md) | Quality, dead code, duplication, tests, doc drift, cleanup |
| [09-references-and-repo-links.md](09-references-and-repo-links.md) | Git remotes, referenced repos/APIs/datasets, provenance |
| [10-recommendations-and-roadmap.md](10-recommendations-and-roadmap.md) | Keep/refactor/delete/secure/test/build + 1wk/1mo/3mo roadmap |
| [audit-summary.csv](audit-summary.csv) | Machine-readable finding table |

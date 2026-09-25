# CLAUDE.md

Standing rules for this repository. Read this before writing code. If a task appears to require breaking one of these rules, stop and ask rather than working around it.

This is a commercial, multi-tenant SaaS OSINT investigation platform. Architecture rationale lives in `docs/ARCHITECTURE-DECISIONS.md`; do not relitigate settled decisions.

---

## 1. Never fabricate data

This is the product's core promise and the most important rule in the repository.

- A value that was not measured is `null`, and renders as an em dash with an explanation. Never `0`, never `"N/A"`, never an empty string, never a plausible guess. `0` means measured and the count was zero.
- Never substitute a default for a missing timestamp. No `|| new Date()`, no `?? 0`, no placeholder strings standing in for real values.
- A collector that fails returns a typed error. It never returns an empty successful result.
- Partial results are labelled partial, and the response states what was not covered.
- Every claim carries its strength label: OBSERVED, REPORTED, DERIVED, CORRELATED, INFERRED, HYPOTHESIS.
- Never invent statistics, source names, dates or identifiers in code, fixtures, comments, documentation or UI copy. Use bracketed placeholders.

Tests enforce this. Do not weaken or skip them.

## 2. Tenant isolation is absolute

- Every table carries `tenant_id`. Every query runs inside a transaction with the tenant context set, so Postgres row-level security applies.
- No repository function may be callable without a tenant context.
- Never disable RLS, never use a superuser connection from application code, never add a "just for admin" bypass path.
- Cross-tenant isolation tests run in CI and block release. If they fail, nothing ships.

## 3. Collection safety and legality

- Passive collection by default. Active scanning requires a recorded scope authorisation naming tenant, target and authoriser.
- Never add scrapers for Instagram, Facebook or X, and never work around a platform's terms of service.
- Targets are passed to tool containers as arguments. Never interpolate user input into a shell command.
- Any fetch of a user-supplied URL goes through SSRF protection: no private ranges, no cloud metadata endpoints, no redirect chains that escape the allowlist.
- Every collector registry entry states its data licence and whether commercial use is permitted. If in doubt, mark it blocked and ask.

## 4. LLM rules

- Open-weight models only, from the allowlist in configuration. Never add a Llama-derived model, Gemini, or Azure OpenAI.
- Model and endpoint are configuration, never hard-coded.
- **All collected content is untrusted data.** Pass it in delimited form, never concatenated into instructions. Validate every model response against a schema. Reject output that follows instructions found inside source material.
- Every claim in generated text maps to an evidence ID. Uncited output is retried once, then fails. Never relax the citation validator to make a test pass.
- Meter tokens per tenant on every call.

## 5. Fault isolation

- Timeouts on every external call. No unbounded waits.
- Fixed concurrency per collector (bulkheads), so one slow source cannot exhaust the worker pool.
- Circuit breakers: after repeated failures, stop calling a source for a cooling period and report it unavailable.
- Failed jobs land in the dead-letter queue, never disappear.
- Jobs are idempotent, keyed by tenant, target, collector and parameters. A retry must never double-charge credits or duplicate evidence.
- Retries distinguish cause: rate limits, timeouts and 5xx retry with backoff; auth failures and invalid targets fail immediately.

Do not solve reliability problems by extracting a new microservice. Services are extracted only for a different runtime, a wildly different resource profile, independent scaling, a separate compliance boundary, or a team that owns them.

## 6. Repository structure

```
apps/web          React SPA (Vite)
apps/api          Fastify API — routes only, no business logic
apps/worker       one worker codebase, deployed as pools by queue
packages/core     domain types, evidence model, target detection
packages/collectors  collector SDK, registry, collectors
packages/osint-engine  orchestration, planner, fusion, merge
packages/llm      provider interface, citation validation
packages/db       schema, migrations, RLS policies
packages/media-forensics
packages/integrations  credential vault, rate limits, exports
packages/ui       shadcn/ui components
packages/config   env schema, shared tsconfig/eslint
services/vision   Python FastAPI (GPU, optional)
infra/            compose files, Dockerfiles, tool containers
docs/
```

Rules:

- Business logic lives in `packages/`, never in route handlers or React components.
- A new module copies the shape of an existing one. Consistency beats cleverness.
- Cross-package imports go through package entry points, never deep paths.
- `packages/core` depends on nothing else in the repo.

## 7. Contracts and types

- The OpenAPI spec is generated from the same Zod schemas that validate requests. Never hand-edit it.
- The frontend uses a client generated from that spec. The UI must not be able to do anything the public API cannot.
- Core evidence and entity types are additive-only. Changing an existing field shape requires a migration plan.
- Validate at every boundary: HTTP requests, collector output, model responses, queue messages.

## 8. Code style and delivery

- TypeScript strict, no `any` in committed code, no `@ts-ignore` without an explanatory comment.
- Node only. No Bun-specific globals anywhere, including tests; the runtime is Node in every environment.
- Errors are typed and carry a machine-readable code. No bare `throw new Error("failed")`.
- Structured logging with tenant, run and job IDs. Never log secrets, credentials, or raw personal data.
- Every change ships with tests. Bug fixes ship with a regression test.
- Migrations are forward-only, expand then contract, and never require downtime.

## 9. Privacy and retention

- Person investigation features are plan-gated and vetting-gated. Never bypass the gate, including in development seeds.
- Credentials are encrypted at rest with envelope encryption. Never write a credential to disk in plaintext, log it, or commit it.
- Deletion must genuinely remove evidence, media and derived data for a tenant.
- The audit log is append-only. Never add code that edits or deletes audit entries.

## 10. Working style for AI agents

- Work in phases. After each phase, report what changed, what builds and what tests pass. Do not proceed on red.
- Prefer targeted edits over wholesale rewrites. Reuse proven code from the previous codebase where it fits; rewrite only where a boundary, a security fix or a dependency upgrade requires it.
- Never mark work complete without running the relevant tests.
- If a task conflicts with a rule here, stop and ask. Do not silently choose an interpretation.
- Never invent a placeholder implementation that returns fake data to make something compile. An honest `NotImplementedError` is always better.

## Product name
The product is Vestigo. It appears in exactly one place: a PRODUCT_NAME constant in packages/config. Never hard-code the product name anywhere else — not in page titles, email templates, report headers or the API.

## The legacy/ folder
legacy/ holds the previous codebase as READ-ONLY reference for porting. It is gitignored and never shipped.
- Never modify anything inside legacy/. Never import from it at runtime.
- Porting means: read docs/audit/INVENTORY.md for that module's verdict, then KEEP (imports only), REWRITE (fix the data path and add a regression test for the specific defect the audit found), or DROP.
- Bring each module's tests across with it.
- No module enters this repo while the fabrication check fails on it.

## Source labelling
Evidence records take their source label from the collector registry entry of the collector that produced them, never from a string the collector supplies. A fallback source is its own registered collector with its own ID, so a fallback is always visible as a different source. The previous codebase silently returned one source's data under another source's name; that must be structurally impossible here.

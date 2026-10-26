# 07 — Security, Privacy & Compliance Audit

Findings are ranked Critical → High → Medium → Low → Informational. Each gives location, scenario, and remediation. The overall posture is **strong for the stage**: no Critical code vulnerability was found, and the platform's security-defining controls (tenant isolation, SSRF, person-gate, vault, LLM guards, append-only audit) are implemented and heavily tested.

Secret *values* are never printed here.

---

## Critical
**None found.**

The usual critical classes were checked and are absent or well-mitigated: SQL injection (all queries parameterised through Drizzle + RLS; no string-built SQL), command injection (no `child_process`/`exec`/shell anywhere in shipped code), SSRF (see the dedicated control below), auth bypass (shared permission catalogue, MFA mandatory, boot-time role verification), and unsafe deserialization (no pickle/eval; JSON parsed then Zod-validated).

---

## High

### H-1 Live third-party API keys in plaintext `.env`
- **Location:** `.env:173-177` — `OPENAI_API_KEY` (line 175, `sk-proj-…`) and `GEMINI_API_KEY` (line 177, `AQ.…`), under a comment marking them personal `llm-council` skill keys "Not read by Vestigo."
- **Scenario:** `.env` is correctly gitignored (never committed; verified `git log --all -- .env` is empty) and `gitignore.test.ts` pins that. Residual exposure is via local backups, archives, screen-shares, or an accidental `git add -f`.
- **Fix:** move these keys out of the repo `.env` into the `llm-council` skill's own config/secret store; **rotate** them if they have ever been shared or shown. They are unrelated to Vestigo and should not live in the product's env file.

### H-2 (Privacy) Retention deletion-on-expiry is not implemented
- **Location:** `apps/api/src/routes/settings.ts:12-15,44,58` (`enforced:false` hard-asserted); `tenancy.ts:39-42` (`retention_days` recorded only).
- **Scenario:** a tenant sets a retention window expecting data older than N days to be purged; nothing purges it. This diverges from CLAUDE.md §9 ("deletion must genuinely remove data") for the retention path and is a compliance exposure (data kept beyond a stated window). Separately, no tenant-wide "delete everything" implementation was located (**UNKNOWN / not found**), though per-tenant rows + per-tenant content-store keys make it feasible.
- **Fix:** implement a retention sweeper (worker job) that deletes expired evidence + content-store payloads + derived rows per tenant, and a verified tenant-deletion path; until then, change the Settings copy so it never implies enforcement (it currently labels the window honestly, but the feature's absence should be explicit end-to-end). Add a regression test.

---

## Medium

### M-1 No CORS/Helmet middleware; cross-origin safety assumes a proxy
- **Location:** no `@fastify/cors`/helmet registered (`apps/api` grep clean); cross-origin protection is the Origin-allowlist CSRF guard (`http/principal.ts:131-139`, `session.ts:74-79`).
- **Scenario:** the guard blocks non-safe session-cookie requests from untrusted origins, but there is no `Access-Control-Allow-Origin` emission or security-header set (HSTS, X-Frame-Options, Referrer-Policy, etc.). Browser preflight/CORS and header behaviour is **UNKNOWN — requires runtime access** (likely delegated to a reverse proxy that is not in this repo).
- **Fix:** register explicit CORS with the trusted-origin allowlist and Helmet-style security headers at the app (so protection does not depend on an undocumented proxy), or document the required proxy config as part of the deployment contract.

### M-2 Populated dev secrets in `.env`
- **Location:** `AUTH_SECRET` and `VAULT_MASTER_KEY` are populated (labelled `VAULT_MASTER_KEY_ID=local-dev-1`).
- **Scenario:** acceptable for dev, but reuse in production would compromise session signing and the credential vault master key.
- **Fix:** add a startup assertion that rejects the known dev values when `NODE_ENV=production`; generate production secrets at deploy time (CI already does this for test runs).

### M-3 `.env` is stale vs the schema
- **Location:** `.env` carries the **retired** `COLLECTORS_ALLOW_UNVERIFIED=` (silently ignored, not in schema) and is missing `COLLECTORS_ACCESS_METHODS`, `CASE_ANALYSIS_CONCURRENCY`, `CASE_ANALYSIS_TIMEOUT_MS` (defaults apply).
- **Scenario:** config drift; an operator may believe `COLLECTORS_ALLOW_UNVERIFIED` still does something (it does not).
- **Fix:** `pnpm --filter @repo/config generate:env`, then re-apply the real local values (keeping secrets out, per H-1).

---

## Low

### L-1 Attribution URLs rendered as links without scheme validation
- **Location:** `apps/web/src/workspace/report/ReportDocument.tsx:200-208` and `workspace/Provenance.tsx:453-459` render attribution `href` without the `^https?://` check that evidence `sourceUrl` gets (`Provenance.tsx:306-332`).
- **Scenario:** a `javascript:`/`data:` URL would be clickable if it reached the attribution field. Low risk because attribution comes from the trusted collector registry / stored report, not free-form collected content. React escapes text, and `rel="noopener noreferrer"` is set.
- **Fix:** apply the same `^https?://` guard (and `nofollow`) to attribution hrefs for consistency.

### L-2 Short-secret redaction gap in captured URLs
- **Location:** `packages/collectors/src/fetcher/fetcher.ts:257` — URL secret scrubbing only redacts secrets ≥4 chars.
- **Scenario:** a very short credential embedded in a captured URL would not be redacted from the recorded evidence URL. No current collector puts a credential in a URL, so unexploitable today.
- **Fix:** redact any credential-like query param by key regardless of length.

### L-3 `http` permitted if a source declares it
- **Location:** `source.ts` scheme model permits `http` when a source declares `protocol:"http"`; **no platform source does** (all https; open-host forced https).
- **Fix:** forbid `http` outright, or require an explicit documented exception, to prevent a future source from downgrading.

---

## Informational / positive controls

- **Tenant isolation:** 3-layer RLS (enabled+forced, composite FKs, least-privilege grants), boot-time role verification, catalog-driven release-blocking tests. See [06](06-database-and-data-model.md).
- **SSRF:** single egress, exact-hostname allowlist re-checked per redirect, DNS-rebinding defense with pinned socket, full metadata/private IP blocking, redirect cap, decompression-bomb guard, fail-closed limiter, Instagram/Facebook/X denylist. See [05](05-crawlers-scrapers-data-sources.md).
- **Prompt injection:** collected content delimited + inert-escaped + canary-guarded; type-level brand prevents interpolation into instructions; output guards reject obedience to injected instructions; citation validator + retry-once-then-fail; retry never shows the model its rejected answer or the data. See [04](04-ai-llm-agents-mcp-a2a.md).
- **Authentication:** MFA mandatory and un-disable-able (`/two-factor/disable` → 403 forever); enrolment token hashed, one-time, 48h TTL, carried only in a URL fragment (never to server/logs) and stripped from the address bar; sessions 12h, no token ever in a response body; IP-spoof protection on `x-client-ip`; identity-provider logger clamped so raw emails are never logged.
- **API keys:** 256-bit random secret, SHA-256 hashed, **constant-time** verification with an unmatchable-hash path so unknown-key timing matches wrong-secret timing; rate-limited *before* verification; scope capped by the issuer's current role each request and killed if the issuer leaves.
- **Credential vault:** AES-256-GCM two-level envelope (random data key per credential wrapped under the master key), AAD binds each envelope to its tenant/id/provider (a copied envelope fails auth), plaintext/data-key buffers zeroed in `finally`, reveal writes an audit row **before** decrypting, master key redacted in `toString/toJSON/inspect`.
- **Anti-enumeration sign-up (approved exception):** `POST /api/auth/sign-up/email` returns 200 with a synthetic user for a refused sign-up so the response can't reveal which addresses have accounts; `autoSignIn:false` so no token is issued; clients never display/store it; pinned by `apps/api/test/auth-flow.test.ts`.
- **Raw payload serving:** octet-stream + attachment + nosniff + `CSP: default-src 'none'; sandbox` + no-store + re-hash on read; never rendered inline in-origin; the UI fetches payloads as a Blob and saves them, never opens them.
- **Audit log:** append-only by grant *and* trigger, immutable even to the owner; every protected request and every org-plugin action is audited (incl. DENIED).
- **Error hygiene:** RFC-9457 problem+json; unknown errors never leak their message; validation errors never echo the submitted value; secrets never logged; structured logging with tenant/run/job ids.
- **Client-side:** no `dangerouslySetInnerHTML`/`innerHTML`/`eval`/`document.write`; no bearer/access token stored client-side (session is server-held cookie); `localStorage` holds only the theme; `sessionStorage` holds only the one-time MFA token (cleared on success), all reads wrapped in try/catch.

---

## Privacy & compliance summary

- **Person data is plan- and vetting-gated** for both collection *and* reading, through one shared `personGate` that fails closed (unknown collector = person; TOPIC target = person whatever collects it), refuses the whole read (never silently thins rows/counts), and is guarded against copy-paste divergence by a CI test. Case analysis re-checks the gate before reading records (D-28); report generation re-checks it during assembly (D-34, closed in code); replay re-checks it (D-30); SSE re-checks it on every poll.
- **Personal/sensitive data at rest:** identity (emails, scrypt password hashes, MFA secrets/backup codes) in the `auth` schema reachable only by `app_auth`; collected evidence under per-tenant RLS; credentials envelope-encrypted; no raw personal data logged.
- **Gaps:** retention enforcement (H-2) and a verified tenant-deletion path are the main privacy/compliance gaps. Data-licensing for UNVERIFIED sources is an open workstream (default-deny today). Vetting-at-signup is enforced as a gate but the vetting *review workflow* itself is out of this repo's code (**UNKNOWN — requires runtime/process**).
- **Dependency vulnerabilities:** not scanned here (no `npm audit`/SCA run as part of this read-only audit); recommend adding SCA to CI. Dependencies are current and pinned via `pnpm-lock.yaml` with `minimumReleaseAgeStrict`.

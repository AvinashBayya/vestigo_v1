# Exact-article intelligence — design plan (not implemented)

Date: 2026-10-21. This is a **design only**; no code in this plan is built. It follows the news-URL fix ([NEWS_URL_INVESTIGATION_FIX_REPORT.md](NEWS_URL_INVESTIGATION_FIX_REPORT.md)), which made a pasted article URL run GDELT news for the publisher **domain** — useful, but **publisher-wide coverage, not the exact submitted article's text**. This plan describes how to retrieve and analyse the exact article, within the existing collector/SSRF/evidence/verdict architecture, and what human source-approval must precede it.

Grounding (read from code): a collector is a pure function of `(target, credentials, fetch)` with a Zod `resultSchema` ([packages/collectors/src/contract.ts]); the one fetcher `createUpstreamFetch` binds every request to the **source's declared host list** — "Nothing outside `hosts` is ever contacted" ([source.ts:49-53], [fetcher/fetcher.ts:264-432]) — with public-address/DNS-rebinding checks, redirects re-checked per hop, a ≤60s timeout, a size cap, the platform user agent, and a shared per-source rate limit; evidence is content-hashed, append-only, with `observed_at` separate from `collected_at`, written through one path ([osint-engine executor]); source labels and licence verdicts come only from `catalogue.ts`. There is **no open-host/`tenantHosts` mechanism today** (the monitoring plan's D-M3 is approved but unbuilt), and `source.ts:124-125` notes a fixed host list "cannot see … a service that fetches any URL." That gap is the heart of this plan.

## 1. Input and identity

- **Target.** The exact article is a `URL` target; the `url()` rule already preserves the full submitted href (scheme, host, port, path, query), refusing credentials and non-http(s). Keep the submitted URL verbatim as the requested target — never silently replace it with its domain.
- **Separate from the domain search.** The domain path (news-URL fix) and the exact-article path are **different collectors on different sources**, so their evidence is never conflated: GDELT evidence's `source_url` is the GDELT query; the article collector's `source_url` is the article URL, and its content is the article's own bytes. The workspace distinguishes them by collector id / source label (already how evidence is labelled).
- **Dedup without losing the original.** Store the submitted URL as given. Derive a **canonical form** for dedup only (lower-case host, drop the fragment, drop known tracking params such as `utm_*`/`fbclid`, collapse a trailing slash) — recorded alongside, not instead of, the original. The existing idempotency key `(tenant, target, collector, params)` stops a resubmission from collecting twice; the content hash deduplicates identical bytes. Two different URLs that resolve to the same article remain two evidence rows unless their bytes hash equal.

## 2. Permitted retrieval

No existing **approved** collector retrieves article full text: `jina-reader` (a fixed-host extraction SaaS, `r.jina.ai`) and `wayback-cdx` (archive index) are both in the catalogue but **UNVERIFIED** (never run), and Wayback is a capture index, not live full-text extraction. Two minimal adapter options, each gated on an owner verdict:

- **Option A — direct publisher fetch (open-host).** Fetch the article URL from the publisher itself. Faithful ("the exact article, no third party") but requires the **open-host network declaration** (D-M3): the request's allowed host is derived from the target URL at request time and validated by the *same* SSRF checks. Its licence verdict cannot be pre-recorded for arbitrary publishers, so it is **operator/tenant-scoped** — a tenant enables only publishers whose terms they are licensed to read, recorded as an audited per-tenant/per-domain decision. Robots/paywall/terms are **respected**: a disallowed, paywalled, or blocked fetch is a typed `REFUSED`/`NEEDS_CREDENTIALS`/`UNAVAILABLE`, never fabricated text.
- **Option B — extraction SaaS (`jina-reader`).** Fits the current fixed-host fetcher with no open-host work (the only host contacted is `r.jina.ai`). But it **sends the article URL (and thus the content read) to a third party**, a DPDP/§9 data-sharing decision, and jina's own terms are unverified.

**Recommendation:** Option A is the correct long-term shape (no third-party data sharing, exact-publisher provenance) and is gated on (a) building the open-host declaration and (b) a per-tenant/per-domain verdict policy. Option B is smaller but carries a third-party-sharing caveat; use it only if the owner records jina's verdict and accepts that sharing. **Neither runs until the owner records a verdict** (`audited(row, url)` in `catalogue.ts`); nothing here changes a verdict or bypasses any restriction.

## 3. Secure fetch (reuse, do not weaken)

Reuse `createUpstreamFetch` unchanged in spirit; for Option A add an **open-host** network kind that keeps every current guarantee:
- HTTP(S) only; the platform user agent; a mandatory ≤60s timeout and a response-size cap.
- The destination host comes from the (validated) target URL; **public-address and DNS-rebinding checks apply** (no private/loopback/link-local/cloud-metadata), with the connection pinned to the checked address.
- **Redirects stay on-host:** each hop is re-validated; a redirect to a different registrable domain (or a private address) is refused, not followed — never an escape from the allowlist.
- Per-host rate limiting through the existing shared limiter; a `Retry-After` backs the job off.
- Retrieved bytes are **untrusted data**: never executed, never interpreted as instructions; any model step frames them as untrusted (existing `@repo/llm` framing).

## 4. Evidence and extraction

- **Evidence row:** `source_url` = the article URL; `collected_at` = fetch time; `observed_at` = the article's **published time only when a trustworthy field is present** (JSON-LD `datePublished`, OpenGraph `article:published_time`), else null — never filled from `collected_at` or from GDELT's `seendate`; `content_hash` of the retrieved bytes; the raw bytes stored by hash; provenance = the collector's registry source; an **extraction status** (FULL_TEXT / METADATA_ONLY / EXTRACTION_FAILED).
- **Deterministic extraction** (decision to record): a vetted readability-style HTML→main-text extractor, or jina's server-side extraction (Option B). Extract title, byline (if stated), published time, and body text. **No LLM for the text itself.**
- **Claims from retrieved text only.** The fusion extractor emits the article as a `URL` entity, the outlet as a `DOMAIN` (`published_by`), and REPORTED claims for what the article itself states (title, published time, author) — each citing the article evidence row. The body text is evidence, not a claim. Optional LLM synthesis uses the existing cited-synthesis pipeline (every statement → an evidence id; fail-closed). **GDELT metadata and article text are kept distinct** (different sources; the article's `observed_at`/text vs GDELT's index).
- **Never fabricate** an entity, date, event, relationship, or contradiction; an empty, paywalled, malformed, or failed retrieval is an honest typed status, not invented content.

## 5. Analyst experience

- Run shows pending / running / completed / partial / failed, with per-collector progress (existing SSE).
- Source exclusions and retrieval failures are shown with reasons (existing excluded/collector-status surfaces); a held or unverified article source reads "held", not a fake result.
- Evidence and its provenance are shown **before** any analysis claims success; the exact-article evidence is visibly labelled distinctly from publisher-wide GDELT evidence.
- Claims and report statements cite back to the stored article evidence (existing citation model).
- Unsupported capabilities stay explicitly "not available / not yet implemented" (existing NotBuilt surfaces).

## 6. Offline verification (deterministic; no live publisher)

Through the existing offline fixture harness (declared host → loopback fixture server; unmatched request fails), add fixtures and tests for: successful extraction; empty/no-article content; malformed HTML; a valid on-host redirect **and** an off-host/private-address redirect that is refused; an oversized response (size cap); a blocked destination (private/loopback/metadata IP); a duplicate submission (idempotency + content-hash dedup); and an extraction/paywall failure (typed status, no fabricated text). Add API and UI tests proving the **exact submitted URL's evidence is distinguishable from publisher-wide GDELT results** (distinct collector/source, distinct `source_url`, distinct extraction status).

## 7. Milestones (small, independently testable)

| # | Scope | Acceptance | Depends on |
|---|---|---|---|
| **M0 (human, blocking)** | Owner reads the terms and records a verdict for the chosen path: either `jina-reader` (Option B, incl. the third-party-sharing decision), or the open-host per-publisher/per-tenant policy (Option A). Legal review of robots/paywall/licence. | A recorded `audited()` verdict (or an explicit decision to stay blocked). **No code.** | — |
| **M1** (Option A only) | Open-host network declaration in the fetcher: the allowed host derives from the validated target URL, under the current SSRF/redirect/public-address rules; per-host rate limit. | Fixtures: a declared on-host fetch succeeds; a private/loopback/metadata host and an off-host redirect are refused; size/timeout caps hold. | M0 |
| **M2** | The exact-article collector (`URL` target) with a strict `resultSchema`; deterministic extraction (title/published/author/body/status); typed outcomes (FOUND / NOT_FOUND / FAILED / NEEDS_CREDENTIALS / UNAVAILABLE / REFUSED). | Fixture tests: a recorded article → FOUND with url/published/collected/hash/status; empty/malformed/paywalled/oversized → typed failure, no fabricated text. | M1 (A) or M0 (B) |
| **M3** | Fusion extractor + canonical evidence persistence: URL/DOMAIN entities, `published_by`, REPORTED claims (title/published/author) citing the article evidence; body stored as evidence; distinct from GDELT. | Tests: every claim cites the article evidence row; the article evidence is distinguishable from GDELT evidence; append-only + content-hash dedup hold. | M2 |
| **M4** | API/UI: the run surfaces exact-article evidence distinctly, with status, provenance, citations, and honest failure/partial states; the URL target's evidence is distinguishable from the domain search in the workspace. | API + UI tests per §6, incl. the "exact URL ≠ publisher-wide GDELT" distinction. | M3 |
| **M5 (optional)** | Cited LLM synthesis over the retrieved article text via the existing pipeline (every statement → an article evidence id; retry-once-then-fail). | A synthesis whose every sentence resolves to an article evidence id; honest "no provider" when unconfigured. | M4, an LLM provider |

Implementation (M1–M5) is separate from the human decision (M0). Nothing proceeds past a point its source verdict does not permit; the person gate, SSRF protections, tenant isolation, and evidence integrity are preserved throughout.

## What is verified vs blocked (today)

- **Verified now:** a pasted article URL runs GDELT news for the publisher **domain** (metadata-level coverage, drawn into the graph) and is validated correctly as a URL or a DOMAIN (the news-URL fix). Full suite green.
- **Blocked on a human decision (M0):** exact-article retrieval. It needs an owner to record a source verdict (and, for the no-third-party path, to approve the open-host model), plus a robots/paywall/licence review. No exact-article collector exists, and none may run until then.
- **Next recommended milestone:** M0 (owner verdict + policy decision), then M1 (open-host fetch, if Option A) — the smallest step that unblocks a deterministic, fixture-tested exact-article collector without touching any security gate.

## M5 synthesis canary — runbook (fixture-only, opt-in; NOT RUN by default)

**Purpose and scope.** The one bounded, metered first run of M5's cited synthesis against a **real open-weight provider**, over a **synthetic in-repo article run** — never a real publisher. It confirms the M5 acceptance against a live model: a synthesis whose every statement resolves to an article evidence id, honest "no provider" when unconfigured. It is the test `packages/osint-engine/test/m5-synthesis-canary.test.ts`, which is **skipped by default** and makes no external request unless explicitly opted in. The article is a `LOCAL_ANALYSIS` synthetic collector (no network) plus a seeded grounded `article_statements` claim — the real `article` collector, the SSRF fetcher, and all publishers are never invoked.

**Required opt-in flag.** `M5_SYNTHESIS_CANARY=1`. Without it the real-provider block is skipped. With it but **no `READY` provider**, the test fails loudly — it never falls back to the scripted provider.

**Required provider configuration (names only — never record a key value).** Synthesis uses the **LARGE** model.
- `LLM_HOSTED_BASE_URL` — https, OpenAI-compatible, non-Azure, up to but not including `/chat/completions`.
- `LLM_HOSTED_API_KEY` — the platform's hosted-provider key (platform-owned; never logged or committed).
- `LLM_LARGE_MODEL` — one allowlisted LARGE id from `packages/config/src/llm.ts`: `Qwen/Qwen3-32B` (default) · `openai/gpt-oss-120b` · `mistralai/Mistral-Small-3.1-24B-Instruct-2503`.
- Optional: `LLM_SMALL_MODEL` (default `Qwen/Qwen3-8B`; extraction only), `LLM_HOSTED_STRUCTURED_OUTPUT` (`none`|`json_schema`|`json_object`), `LLM_MODEL_NAMES` (if served under different names), `LLM_REQUEST_TIMEOUT_MS`.
- Self-hosted alternative: `LLM_PROFILE=vllm` **and** `LLM_VLLM_ENABLED=true` (+ `LLM_VLLM_BASE_URL`, optional `LLM_VLLM_API_KEY`). A non-allowlisted / Llama / Gemini model, an Azure host, or a base URL set without a key is refused by `resolveLlmConfiguration`.

**Prerequisites.** `docker compose up -d --wait` (Postgres + Redis for the engine suite). The usual application secrets to boot are `AUTH_SECRET` and `VAULT_MASTER_KEY` — set them in the environment; do not read or reproduce their values.

**Exact command — NOT RUN here (run once, deliberately, with a provider configured):**

```
docker compose up -d --wait
M5_SYNTHESIS_CANARY=1 \
  LLM_HOSTED_BASE_URL=<https OpenAI-compatible base, non-Azure> \
  LLM_HOSTED_API_KEY=<platform key> \
  LLM_LARGE_MODEL=Qwen/Qwen3-32B \
  pnpm --filter @repo/osint-engine exec vitest run test/m5-synthesis-canary.test.ts
```

**Expected assertions (opt-in block; verified only against the real provider):**
- **Synthesis:** `synthesis.status === "GENERATED"`.
- **Evidence citation:** every statement cites ≥1 source number present in the report, and — the article being the only source — every citation resolves to the **article evidence id**.
- **Strength:** every statement's strength ∈ {`CORRELATED`, `INFERRED`, `HYPOTHESIS`} (never `OBSERVED`/`REPORTED`/`DERIVED`).
- **Metering (exactly once):** one `LLM_INPUT_TOKEN` usage row and one `LLM_OUTPUT_TOKEN` row for the report, each `quantity > 0` — charged once per unit, never double-charged (a validation retry stays within the same usage row). The client runs with no cache, so the model is genuinely called.
- **Provenance:** `synthesis.model.id ===` the configured `LLM_LARGE_MODEL`, its licence ∈ {Apache-2.0, MIT}, `endpointHost ===` the configured host, `regionHeaders` an array copied as received.

**Expected no-provider degradation (always on; verified offline, no request):** with no `LLM_HOSTED_BASE_URL`, `resolveLlmConfiguration` → `NOT_CONFIGURED` and `createLlmClient` → `{ unavailable }`; a synthesis request then returns the honest `SYNTHESIS_UNAVAILABLE`/`NOT_REQUESTED` path, and deterministic reports still generate.

**Restrictions (invariant).** No real publisher is fetched; no collector/SSRF path is invoked. Authorization, tenant isolation (RLS), the person gate, SSRF protections, the citation validator, and evidence integrity are unchanged. No secret is logged or committed. The canary **never** falls back to the scripted provider when opted in with invalid configuration — it fails loudly instead.

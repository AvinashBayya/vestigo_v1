# M1 — direct article fetching (Option A): status report

Date: 2026-10-22. Decision in effect: Option A (free, locally-executed, direct fetching of explicitly authorised article URLs; **no** Jina Reader or any third-party extraction service). Branch `milestone/vestigo-days-1-3-osint-addendum`; **nothing committed**, no source verdict changed, no source enabled, **no real publisher fetched**.

Status legend: **Implemented + verified** · **Fail-closed by construction** · **Human decision required**.

## Executive summary

The secure exact-article path is now **implemented end to end and verified against local fixtures**, in three small auditable stages:

1. **Exact-domain authorisation** — a URL target is cleared by an in-force **DOMAIN** scope authorisation for its **exact** host (no parent/subdomain widening), reusing the proven `scope_authorisations` primitive. No migration.
2. **Secure open-host fetch** — the SSRF-hardened fetcher can be bound to the one authorised host instead of a static host list, with every SSRF rule and every redirect hop unchanged; fixed-host collectors are untouched.
3. **Collector + evidence** — a minimal `article` collector fetches over that path, extracts with the existing `extractArticle()`, and records canonical evidence distinct from GDELT.

It remains **fail-closed in every direction**: the source is **UNVERIFIED**, so no deployment runs it until an owner records a per-publisher verdict; and even then it runs only for a target with an in-force scope authorisation. The path was proven **entirely offline** against synthetic fixtures — **no real publisher was contacted**, and no third-party extraction service is involved.

**What this means in one line:** the exact-article path works e2e with local fixtures; **no real publisher is enabled**; the remaining work before live use is human approvals plus one infra-level persistence test (below).

## Stage 1 — exact-domain authorisation (Implemented + verified)

- **`packages/osint-engine/src/scope.ts`** — `resolveScopeClearance(scopeAuthorisations, target)`. Exact `(type, value)` authorisations match as before. A **URL** target is additionally cleared by an in-force **DOMAIN** authorisation for the URL's **exact** host (`parseTarget("DOMAIN", url)`): a direct fetch reaches the publisher (ACTIVE) and is authorised **per publisher domain, not per article URL**. There is **no** parent-domain or subdomain widening; a malformed URL (no host) is denied (fail-closed); and an authorisation **never** overrides SSRF.
- The one shared gate: used **identically** at planning (`planner.ts` via `scopeFor` in `runs.ts` and `apps/api/.../estimates.ts`) and at collection (`executor.ts`), so admission and the collect-time re-check agree and a revoked authorisation fails closed everywhere. The in-force window, revocation, tenant isolation and authz are the existing `scope_authorisations` behaviour (unchanged; **no migration**).
- **Defect found and fixed during this stage.** The resolver previously returned the DOMAIN-shaped authorisation for a URL→DOMAIN match, but the collectors runtime's admission gate is a single **exact-target** check (`scope.targetType === target.type && scope.target === target.value`). A DOMAIN-shaped clearance would therefore have been **refused at collection time** for every URL target — a latent gap that Stage 1's resolver-only unit tests did not catch, and that Stage 3 (the first ACTIVE URL collector) would have hit. Fixed by shaping the returned clearance to the **URL** it clears, carrying the DOMAIN authorisation's id for the audit trail. The widening lives only in the shared resolver; the runtime stays a generic exact-target gate.
- Tests (`packages/osint-engine/test/scope.test.ts`): exact match; URL cleared by a DOMAIN authorisation for its exact host (now asserted URL-shaped); **no widening** (a subdomain or parent is denied); deny when the host has no authorisation; deny a malformed URL; an exact URL authorisation still matches; deny with no authorisation at all; **plus** a runtime-composition test proving `resolveScopeClearance(DOMAIN auth) → runtime.admit("article", URL)` **admits**, and refuses with `SCOPE_AUTHORISATION_REQUIRED` without one.

## Stage 2 — secure open-host fetch (Implemented + verified)

- **`SourceNetwork.openHost`** (`source.ts`): an optional flag. `validateNetwork` requires an open-host source to use **https**, declare **no** static hosts, and name **no** operators (its host varies per target). Static sources are unchanged.
- **`checkDestination(rawUrl, network, allowedHosts = network.hosts)`** (`fetcher/destination.ts`): the host is checked against `allowedHosts`, defaulting to the source's declared hosts (static path **unchanged**). An open-host source passes the one authorised host. Every other rule is identical for both: https/scheme, no credentials in the URL, default port only, and Instagram/Facebook/X refused **by host** as a backstop (CLAUDE.md §3).
- **`fetcher.ts`**: a new `allowedHosts?` option, threaded into the destination check on the initial request **and on every redirect hop**, so a chain cannot leave the authorised host. The private-address / DNS-rebinding defence (public-address check on resolved answers, connection pinned to the checked address) is in the fetcher's resolver step and is **source-agnostic**, so it covers the open-host path with no change.
- **`runtime.ts`**: for an open-host source, the runtime binds `allowedHosts` to the **authorised target's own host** (`parseTarget("DOMAIN", target.value)`). The target was validated at admission and its host resolved for the scope authorisation, so this parse succeeds; an invalid target is a typed failure, **never an empty allowlist** (which would read as "no host").
- **`registry.ts`** — `deepFreezeSource` now carries `openHost` through to the frozen `Source` (it was previously dropped; no registered source had the flag, so it had never been exercised — fixed here before registering the first one).
- Arbitrary-host fetching stays **unavailable to ordinary clients**: it exists only inside the authenticated collector pipeline, gated by admission + the UNVERIFIED verdict. No proxy rotation or evasion; robots/paywalls/blocks surface as typed failures.
- Tests (`packages/collectors/test/fetcher/destination.test.ts`): static default hosts accept/refuse; open-host accepts the one authorised host over https; refuses any other host and an off-host redirect; https-only; refuses credentials and a non-default port; refuses IG/FB/X even if somehow in the allowed set. The full fetcher SSRF suite is unregressed.

## Stage 3 — collector and evidence (Implemented + verified)

- **Source** (`catalogue.ts`, `direct-article`): the one open-host source — https, `openHost: true`, no static hosts, no operators, self-imposed 1 req/s. **UNVERIFIED** (no blanket commercial-use verdict covers every publisher), so it **never runs in a deployment** until an owner records a per-publisher verdict.
- **Collector** (`platform/article.ts`, id `article`): ACTIVE, `targetTypes: ["URL"]`, discipline MEDIAINT, `claimStrength: REPORTED`. It fetches the exact URL via `ctx.fetch`, maps the HTTP status honestly (2xx proceeds; 404/410 → not found; 429/5xx → retryable UNAVAILABLE; 401/403 → refused; anything else → typed response error), requires an **HTML** content type (a non-HTML 200 is a typed failure, not an article), then calls `extractArticle()`.
- **What is observed vs derived.** The raw bytes the publisher served are the evidence (content-hashed by the store). The one **REPORTED** value is `headline` — the first `<title>`'s inner text, trimmed but **not** decoded, so it is a verbatim fragment of the bytes and satisfies the runtime's "a reported value appears in the cited bytes" check. **Everything `extractArticle()` produces is a parse of those bytes and lives under `derived`** (a DERIVED claim): decoded title, author, language, ISO publication time, declared canonical URL, outlet host, dedup key, extraction status. A page with no `<title>` or nothing extractable is reported **not found**, never a false FOUND.
- **Canonical evidence** (via the single `evidenceDrafts` path the executor uses): the article URL (`sourceUrl`), the **stated** publication time (`observedAt`, null when none), the raw bytes (`payload`, whose hash is the content-addressed key), `collectedAt` (retrieval time), and the registry's own **source label** ("Direct article fetch") — never a publisher-supplied string. The dedup key is the article URL with its fragment removed.
- **Distinct from GDELT.** The fusion extractor (`osint-engine/src/fusion/extractors.ts`, `article`) draws the article URL as the subject entity, its publisher host as a `published_by` DOMAIN entity, and the fields as `article_*` claims — its own attribute namespace and its own evidence, so a direct fetch and GDELT's listing of the same URL stay separable on the one shared URL entity. No entity is ever made from a headline or author name.
- **Harness** (`testing.ts`): now resolves a fixture's host (not only a declared source host) to the placeholder public address, so an open-host collector can reach the host its authorised target names — still never contacted (the socket goes to the loopback fixture server). The provenance test exempts open-host-collector fixtures from the declared-host rule while still forbidding IG/FB/X hosts.
- **Fail-closed, proven four ways** (`packages/collectors/test/platform/article.test.ts`): no scope authorisation → `REFUSED: SCOPE_AUTHORISATION_REQUIRED` with **nothing fetched**; a scope authorisation for a **different** URL → refused (the gate binds the exact target); the UNVERIFIED source → `REFUSED: UNVERIFIED_SOURCE_NOT_ALLOWED` **even with** a scope authorisation (never runs in a deployment); and an off-host redirect → `FAILED: DESTINATION_REFUSED` **without ever connecting** to the off-host target. Plus the happy path (FOUND with the exact extracted fields and canonical evidence), a non-HTML 200 → failure, and a non-readable page → not found. The fusion extractor is unit-tested (headline REPORTED, everything parsed DERIVED, `published_by` the outlet) and runs in the engine's generic extractor suite.

## Tests and outcomes (exact commands)

| Command | Result |
|---|---|
| `pnpm --filter @repo/collectors exec vitest run test/platform/article.test.ts` | **7 passed** (collector e2e) |
| `pnpm --filter @repo/collectors exec vitest run test/fetcher/destination.test.ts` | **7 passed** (open-host gate) |
| `pnpm --filter @repo/collectors test` | **26 files, 622 passed** (no regression; +4 files, +14 tests vs the extractor-only baseline) |
| `pnpm --filter @repo/collectors build` / `lint` | typecheck exit 0; ESLint clean |
| `pnpm --filter @repo/osint-engine exec vitest run test/scope.test.ts test/units.test.ts` | **65 passed** (resolver, admit-composition, article extractor + FOUND case) |
| `pnpm --filter @repo/osint-engine exec vitest run test/pipeline.test.ts` | **29 passed** (RELEASE-BLOCKING e2e, unregressed) |
| `pnpm --filter @repo/osint-engine` (coverage, collection, case-analysis×4, gdelt, enqueue, reports) | all passed |
| `pnpm --filter @repo/osint-engine build` / `lint`; `@repo/api` typecheck | clean |
| `pnpm --filter @repo/config test` (fabrication, person-gate, boundaries, exports guards) | **273 passed** |

No external extraction service and no API key are involved. No fixture fetches a real publisher; every fixture is synthetic, on the reserved `example.com` documentation domain, with bracketed/obviously-placeholder values.

## Extraction core (unchanged from the prior increment)

`extractArticle(html)` (`platform/article-extract.ts`) remains a pure, dependency-free, ReDoS-conscious parser (single bounded forward passes, no DOM library). It draws only what the document states, invents nothing (absent → null, no body → `""`), parses a stated date strictly to ISO (never the collection time), and reports an honest FULL_TEXT / METADATA_ONLY / NO_CONTENT status. Its 9 offline tests stand.

## Evidence behaviour (how it differs from GDELT)

A direct-article evidence row carries the registry source label **"Direct article fetch"** and collector id **`article`**; a GDELT row carries **"GDELT news coverage"** and collector id `news`. Their claims use disjoint attribute namespaces (`article_*` vs `news_*`). The URL entity may be shared when both reference the same article, which is correct fusion — each source's claims keep their own strength and evidence, so the two are never conflated into one unattributed statement.

## What is NOT done

- **No real publisher is enabled or fetched.** The source is UNVERIFIED and default-deny.
- **Through-persistence DB e2e.** The collector e2e proves the path through the **FOUND evidence boundary** (the exact `evidenceDrafts` the executor persists). The executor's single `persistEvidence` write path is **collector-agnostic** and is exercised for registered collectors by the RELEASE-BLOCKING `pipeline.test.ts` (which passes). A dedicated pipeline-level test that runs the `article` collector through real Postgres with an in-force DOMAIN scope authorisation to assert the persisted row is the remaining test to add; it belongs with the release-blocking infra suite and was not added here to avoid destabilising it in a session-tail run.

## Remaining approvals and decisions (before any real article can be collected)

1. **Owner (per-publisher verdict):** change the `direct-article` source (or a per-publisher source) to **PERMITTED** with an `audited()` reference, only after checking that publisher's terms. Default-deny until then. This is a deliberate code change; no automation sets it.
2. **Tenant (authorisation + licensing basis):** an authorised member records an in-force **DOMAIN** scope authorisation for the exact publisher host, with its basis — never the platform on their behalf.
3. **Legal:** review robots/paywall/terms handling for direct fetching (fetches respect these as typed failures; none is bypassed).
4. **Sign-up gating unchanged:** this work ships no new client surface; the existing no-sign-up-before-email rule stands.

## Manual steps to activate a genuinely approved source (once the approvals above are made)

1. Owner records the per-publisher verdict in `catalogue.ts` (PERMITTED, with `audited()`), and the deployment enables the `open` method (already default).
2. An authorised tenant member records an in-force DOMAIN scope authorisation for the exact publisher host.
3. Submit the article URL as a URL target. The planner admits the `article` collector (its DOMAIN authorisation clears the URL's host); the collector fetches over the SSRF-hardened open-host path bound to that host, extracts with `extractArticle`, and persists canonical evidence (article URL, publisher host, retrieval time, stated publication time, content hash, dedup key, extraction status) distinct from GDELT.

## Conclusion

- **The exact-article path works end to end against local fixtures:** admit (DOMAIN authorisation clears the URL) → SSRF-hardened open-host fetch → `extractArticle` → canonical evidence → fusion, all offline and fail-closed.
- **No real publisher is enabled; no source verdict changed; no real publisher fetched; nothing committed.** The source is UNVERIFIED and never runs in a deployment.
- **Before the first real article can be collected:** the owner records a per-publisher PERMITTED verdict, a tenant records an in-force DOMAIN authorisation, legal reviews robots/paywall handling, and the pipeline-level DB persistence test is added. Each step is sequenced and fail-closed; nothing proceeds past a point its verdict or authorisation does not permit.

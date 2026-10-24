# News-URL investigation fix

Date: 2026-10-21. Symptom: pasting a real Hindustan Times article URL, with URL detected/selected, showed **"Not a valid domain: The DOMAIN target is invalid (malformed)."** and **SOURCES THAT WOULD RUN (0)**. Branch: `milestone/vestigo-days-1-3-osint-addendum`.

Status legend: **Verified** (ran and read the output) · **Fixture-tested** (recorded fixtures/offline harness, no live publisher) · **Not implemented / out of scope**.

## Confirmed root causes (with evidence)

1. **A full URL was handed to the domain validator (the visible bug).** Detection offers `DOMAIN` as an *alternate* for any URL ([packages/core/src/target-detection.ts:82](packages/core/src/target-detection.ts#L82): `URL_SCHEME` → `{ primaryType: "URL", alternateTypes: ["DOMAIN"] }`). The planner validates each candidate type with `parseTarget` ([planner.ts:107-116](packages/osint-engine/src/planner.ts#L107-L116)). `parseTarget("DOMAIN", "https://www.hindustantimes.com/…")` ran `domain()` ([packages/collectors/src/target.ts](packages/collectors/src/target.ts)), which built `http://https://www.hindustantimes.com/…/`, whose hostname is `"https"`, failing `DNS_NAME` → `InvalidTargetError(DOMAIN, MALFORMED)` → message **"The DOMAIN target is invalid (malformed)."** ([errors.ts:39](packages/collectors/src/errors.ts#L39)), rendered at [Search.tsx:314](apps/web/src/screens/Search.tsx#L314). **Confirmed** by reading the code and by a reproducing unit test.
2. **That made the useful collector ineligible → zero sources.** Because the DOMAIN candidate was invalid, it never entered the planner's `valid` list, so GDELT news (`news`, accepts `DOMAIN`/`TOPIC`, source `gdelt-doc` = **PERMITTED**) was excluded as `TARGET_TYPE_NOT_ACCEPTED` (it does not accept URL). The only URL-accepting collector is `wayback` (source UNVERIFIED → `UNVERIFIED_SOURCE_NOT_ALLOWED`). Net: **0 runnable sources** for a URL. **Confirmed** from `planner.ts:120-153` + the collector catalogue.
3. **There is no direct article-URL collector.** News collection is by `DOMAIN` or `TOPIC` through GDELT's search API; nothing fetches a specific article URL and extracts its text. So a pasted article URL had no runnable collector at all. **Confirmed** (no collector in `packages/collectors/src/platform` accepts a URL except `wayback`, which is a CDX/archive lookup, not article extraction, and is UNVERIFIED).

The screenshot's error was therefore accurate about one thing (the full URL is not a domain) but the behaviour was wrong: the DOMAIN *alternate* should mean "investigate the publisher's domain", i.e. use the URL's host — not re-validate the whole URL as a domain.

## The fix (files / functions changed)

**`packages/collectors/src/target.ts`** — a new `domainTarget(value)` used only by the `DOMAIN` case of `normalise()`:
- a full `http(s)` URL resolves to its **host** (`new URL(value).hostname`), so `parseTarget("DOMAIN", articleURL)` → the publisher domain;
- a URL carrying credentials, or whose host is an IP/`[ipv6]`, is refused (returns null → `MALFORMED`), matching the URL/host rules;
- anything else is validated as a domain exactly as before.
- `domain()` itself is **unchanged and still strict**, so an email address's domain part cannot be a URL (guarded by a test). Backend validation stays authoritative; no frontend change was needed (the UI already renders only `invalid` targets, and GDELT now appears as a runnable source).

This is the smallest architecture-consistent change: it adds no collector, no source, no dependency, and **changes no source verdict**.

## Behaviour before vs after (a valid news article URL)

| | Before | After |
|---|---|---|
| Target card | "Not a valid domain: … (malformed)." | Detected **URL**, alternate **DOMAIN**; both valid, no error |
| Treat as URL | 0 sources (only `wayback`, held UNVERIFIED) | 0 sources — now truthfully, with `wayback` listed held and no spurious error |
| Treat as DOMAIN | not reachable (candidate invalid) | **GDELT news runs** on the host (e.g. `www.hindustantimes.com`), MEDIAINT, not person-gated → evidence |
| Evidence/graph | none | article URL entities + outlet DOMAIN + `published_by` + REPORTED/DERIVED claims (the Day-2 extractor), on a started run |

## Source-verdict and publisher-access limitations (honest scope)

- GDELT news returns **coverage for the publisher domain**, not the specific pasted article's full text. The exact article is **not** fetched. Nothing is fabricated: the evidence is whatever GDELT returns for that domain.
- A direct article-fetch (full text of the pasted URL) would need a new collector **and** a source with a recorded commercial-use verdict. `jina-reader` and `wayback` exist in the catalogue but are **UNVERIFIED** and never run; a generic "fetch any publisher URL" collector does not fit the one-source-one-verdict catalogue model and would be subject to each publisher's terms/robots/paywall. **No such collector was built and no verdict was changed.**
- GDELT uses the host as given: a `www.` host may match fewer GDELT records than the apex domain. This is GDELT's own behaviour, surfaced honestly.
- The person gate, SSRF protections, tenant isolation, and source verdicts are all unchanged. GDELT's endpoint is fixed, so extracting the host (a query parameter) introduces no SSRF surface.

## Tests and results

- **New** `packages/collectors/test/target.test.ts` (9 tests) — the DOMAIN rule across the audited edge cases: bare domain (lower-cased, trailing dot dropped); **article URL → host**; a URL with a **port and path** (host kept, port dropped); non-domain/non-URL and non-http(s) scheme → MALFORMED; a URL with **credentials** or an **IPv4/IPv6-literal host** → refused; the URL rule (full href kept; no-scheme/non-http(s) refused); type-switching (same URL → full href as URL, host as DOMAIN); and the **email regression guard** (a URL in an email's domain part is still invalid). → **Verified** (`pnpm --filter @repo/collectors exec vitest run test/target.test.ts` → 9 passed, exit 0).
- **New** planner regression in `packages/osint-engine/test/units.test.ts` ("treats a pasted article URL as a URL and as its publisher domain …") — a URL input yields valid URL **and** DOMAIN(host) candidates and plans a domain collector on the host. → **Verified** (units.test.ts: 55 passed, after rebuilding the collectors dependency).
- `pnpm --filter @repo/collectors exec vitest run test/target.test.ts test/runtime.test.ts` → **57 passed** (SSRF/admission/source-label/verdict tests unchanged).
- Full suite (`pnpm turbo test --continue --force`, 0 cached, all fresh, 5m15s): **27/27 tasks green, exit 0** — collectors 23 files (incl. the new `target.test.ts`), osint-engine 12, api 29, web 23, db 19, config 12, case-engine 4, integrations 9, llm 6, access 6, ui 5, core 4, worker 1. The release-blocking gates (fabrication-check, check-exports, person-gate guard, cross-tenant isolation) pass. (An earlier `pnpm test` run aborted on a vitest worker-spawn timeout in `@repo/ui` under machine contention; `ui` passes 96/96 in isolation and is unrelated to this change — an environmental flake, not a regression.) **Verified.**
- No existing test pinned the old URL-as-domain-invalid behaviour (searched), so nothing was weakened or skipped.

The end-to-end path "news URL → DOMAIN(host) → GDELT news → evidence/graph" is proven by composition: the DOMAIN-host rule (target.test.ts), the planner planning a domain collector for a URL (units.test.ts), and the existing Day-2 GDELT→graph integration test (`pipeline.test.ts`, "a topic run on GDELT … draws its articles into the graph") which exercises the news collector → fusion → entities/claims path against a recorded GDELT fixture.

## Known remaining gaps

- **No full-text article extraction** of the specific pasted URL (needs a permitted article collector + an owner verdict). Out of scope; documented.
- **Monitoring/RSS collectors** that could cover a publisher directly are UNVERIFIED and have checked-only extractors (draw nothing) — unchanged.
- Treating the URL **as a URL** still yields 0 runnable sources until an owner records a verdict for a URL-capable source (e.g. `wayback`); this is now shown truthfully.

## Manual verification (developer, running the app)

1. `docker compose up -d` (Postgres+Redis); export `AUTH_SECRET`/`VAULT_MASTER_KEY`; `pnpm dev`. (Free port 3000 or set `API_PORT`.)
2. Sign in, enrol MFA, pick the org.
3. On the search dashboard paste a news article URL. Expect: no "malformed" error; the Target card shows **URL (detected)** with a **DOMAIN** option.
4. Choose **Treat it as: Domain** → "Sources that would run" lists **GDELT news coverage (as domain)**; start the run → entities (article URLs + outlet domain), graph edges (`published_by`), evidence with provenance, and (with an LLM provider configured) a cited report.
5. Choose **URL** → "Sources that would run (0)", with `wayback` shown held (UNVERIFIED) and the reason — a truthful empty result, not an error.

## Summary

A direct news URL now produces **real, metadata-level news intelligence**: treated as its publisher **domain**, the PERMITTED GDELT news collector runs on the host and its articles become evidence/entities/claims in the graph. It does **not** fetch the specific article's full text (no permitted direct-article collector exists; building one needs an owner source-verdict decision). Treated as a URL, the app now truthfully reports that no permitted source can run, instead of a misleading "malformed domain" error. **Only recorded fixtures were tested — no live publisher request was made and no live publisher verification is claimed.**

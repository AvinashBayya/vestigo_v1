# Audit report

**Repository:** `D:\social-media-ai-agents-v2-main\social-media-ai-agents-v2-main` (package name `sentinel-ai`, product name "Sentinel AI").
**Audit date:** 2026-09-23. **Git:** one commit, `ebfe83b` "Baseline: Sentinel AI as received"; branches `master` and `transform/pulselens` both point at it; three files modified and nine untracked in the working tree.
**Method:** every claim below comes from reading the code or running a command on this machine. Where the code and the documentation disagree, the code wins and the disagreement is stated. Where nothing could be established, the word is UNKNOWN and the item is in [QUESTIONS.md](QUESTIONS.md).

Companion files: [INVENTORY.md](INVENTORY.md) (module-by-module verdicts), [COLLECTORS.md](COLLECTORS.md) (every external integration), [DEPENDENCIES.md](DEPENDENCIES.md), [QUESTIONS.md](QUESTIONS.md).

---

## 1. What the system actually is

Despite the repository name, nothing here posts to social media. It is an OSINT (open-source intelligence) analysis workbench: an analyst types a target (a domain, a person, a username, a topic), and 33 pages fan out to roughly 60 public data sources, run deterministic and LLM-backed analysis over what comes back, and let the analyst pin selected items into a "case" and generate a cited PDF report.

It was built for an Indian Air Force procurement programme (ADITI 4.0 / iDEX Problem Statement 18). That origin is visible throughout: PS-18 module numbering in code comments and page titles, a compliance console page, "UNCLASSIFIED // DEMONSTRATOR" banners, 15 Indian-language translations, an Indian vehicle-registration lookup, and legal gates written around India's DPDP Act 2023.

Four stacks share one flat root:

| Area | Lines | Runtime | Status |
|---|---|---|---|
| `src/` (TanStack Start: UI **and** backend) | 52,117 utils + 28,306 routes + 13,571 components + 5,733 i18n + 3,454 other | Node 22 in production, Bun for tests | The mature core. 81 `createServerFn` server functions are the entire API. |
| `tests/` | 23,420 | Bun | 103 files, 2,096 tests, 10 failing. |
| `app/` (Python FastAPI, yt-dlp) | 586 | Python ≥3.10 | Runs; **no code in `src/` calls it**. |
| `ai-service/` (Python FastAPI, vision) | 1,537 + 947 tests + 469 scripts | Python 3.11 + optional CUDA | Called from the browser. 4 of 13 endpoints are 501 stubs. |
| `osint-workers/` | 283 | Docker | Compose stack; no evidence any of it was ever run against this app. |
| `scripts/`, `eslint-rules/`, `docs/`, root governance docs | 1,254 + 514 + 4,359 + ~2,276 | | Mixed: real gates, plus 404 KB of session notes. |

### 1.1 Feature by feature, from the code

**Source credibility (`/sources`).** Seven-factor scoring in [src/utils/credibility.ts](../src/utils/credibility.ts) (982 lines, 43 tests): domain tier, corroboration, source diversity, recency, emotive load, absolutism, sensationalism, with per-factor evidence strings and analyst-adjustable weights. A seventh, model-backed "linguistic markers" factor sits in [credibility-llm.ts](../src/utils/credibility-llm.ts) and is opt-in per article. Weight profiles persist to a single server file, `./data/credibility-profiles.json`. This is the most solid analytical module in the repository.

**Content analysis (`/entities`, `/trends`, `/sentiment`, `/news`).** [analysis.ts](../src/utils/analysis.ts) does tokenisation, title-similarity clustering and TF-IDF deterministically (41 tests); [analysis-llm.ts](../src/utils/analysis-llm.ts) adds summaries, entity extraction and cluster framing comparison through the LLM. Clusters are shared between the credibility and news layers, so a corroboration count and a "4 sources reporting this" group cannot disagree.

**Social (`/social`, `/network`, `/live`).** Real collection from Bluesky (a browser-side Jetstream firehose plus the public AppView), Mastodon (hashtag timelines keyless, full-text search with a token), Telegram (scraping `t.me/s/<channel>` preview pages) and Reddit (OAuth client credentials). Coordinated-inauthentic-behaviour signals in [cib.ts](../src/utils/cib.ts) (886 lines, 84 tests) are presented as signals for review with per-signal evidence, never a verdict. Instagram and Facebook are declared uncollectable in the UI, and an "analyst-attested manual capture" path exists instead.

**Imagery and video (`/images`, `/videos`).** All in-browser: EXIF via exifr, C2PA Content Credentials, a hand-written DCT perceptual hash, near-duplicate matching against a local corpus, Tesseract OCR in 14 languages, keyframe extraction and scene-cut detection, and FFT spectral analysis of the audio track ([audio-frequency.ts](../src/utils/audio-frequency.ts), 1,478 lines, 51 tests). Heavier models (object detection, captioning, face matching, sound-event classification) run in `ai-service`. The project explicitly refuses to ship a deepfake classifier and documents why.

**Document forensics.** [file-provenance.ts](../src/utils/file-provenance.ts) (2,715 lines, 152 tests) parses PDF, OOXML, ODF and video containers for embedded metadata, hidden content and digital signatures, including a hand-rolled CMS/PKCS#7 verifier, plus OCSP/CRL revocation checking through a SSRF-guarded server proxy. This is the single strongest body of code in the repository.

**OSINT collector framework (`/recon`, `/osint`, `/crawlers`).** A proper contract (`Collector` with `execute`/`normalize`/`healthCheck`, a common `InvestigationResult` zod schema, an error model that distinguishes timeout / unavailable / no-credential / rate-limited / invalid-target), a registry, a query planner, a synchronous orchestrator, a pollable job system, cross-collector entity resolution and a passive-only policy gate. 21 collectors are registered. Genuinely good architecture.

**Cases, graph, timeline, reports (`/investigations`, `/graph`, `/timeline`, `/reports`, `/exports`, `/vault`).** An analyst pins evidence from News, Social, Images and the Vault into a case; the case derives its own metrics; Module 5 generates an intelligence product where every judgement must cite a numbered source, citations are re-validated against the real source list after generation, and a failure retries once then throws. PDF export carries a provenance footer naming the model on every page.

**GIS (`/gis`).** Leaflet map with coordinate-honesty rules: no record is plotted without a real coordinate, `0,0` is rejected as a missing-value sentinel, precision is rendered as a dashed uncertainty circle, and unplaceable records are counted and reported rather than dropped.

### 1.2 What the code does that the documentation denies, and vice versa

| Documentation says | Code does |
|---|---|
| README: "Tests: 653 JS/TS unit tests passing · `tsc --noEmit` clean" | 2,096 tests, **10 failing**; `tsc` reports **1 error**; `eslint` reports **4,452 problems**. |
| CLAUDE.md: the v1 scraper scripts "were deleted on 2026-08-10" | [scripts/agent-scraper.js](../scripts/agent-scraper.js) and [scripts/agent_scraper.py](../scripts/agent_scraper.py) are still present, still read `data/credentials.json`, and still fabricate Instagram/Facebook posts with `Math.random()` engagement. |
| `recon-sources.ts` header: crt.sh gets "one retry, not a loop — a second failure is reported, never buried" | On any failure **and on a genuine zero result**, it silently queries HackerTarget and AlienVault OTX and labels the rows `source: "crtsh"`. Two tests fail because of this. |
| `searxng.ts` header: a missing `SEARXNG_URL` "is reported as a configuration state, not as no results" | It falls back to Google News RSS and returns results labelled `engine: "Google Web Index"`. Three tests fail because of this. |
| `presence-image.ts` tests: the collector is "deliberately, permanently unavailable (DPDP Act 2023)" | It performs a GitHub avatar HEAD request and reports `completed`. Four tests fail. |
| `/osint` header: "Mode: 100% Live Keyless OSINT" ([osint.tsx:1845](../src/routes/osint.tsx#L1845)) | UCDP requires a token, and the page's own panel says so. |
| `/social` header: "Autonomous scraper agents ingest Instagram, Facebook, X, Reddit, YouTube & Telegram feeds" ([social.tsx:591](../src/routes/social.tsx#L591)) | The same page's policy table says Instagram, Facebook and X cannot be collected at all. |
| `/login` footer: "All access attempts and activity are monitored and logged" | Nothing logs access. `/youtube` states the opposite in its own text: "nothing in this system keeps an audit trail". |
| CLAUDE.md: "no database, all state is localStorage, no auth, no backend" | Accurate. |

---

## 2. Build health (measured on this machine, 2026-09-23)

| Gate | Command | Result |
|---|---|---|
| Unit tests | `bun test` | **2,086 pass, 10 fail**, 0 skipped, 6,526 assertions, 103 files, 59.18 s. Exit 1. |
| Type check | `tsc --noEmit -p tsconfig.json` | **1 error**. Exit 2. |
| Lint | `eslint .` | **4,452 problems: 4,378 errors, 74 warnings**. Exit 1. |
| Export integrity | `bun scripts/check-exports.ts` | **PASS** — 210 symbols across 29 files. |
| Fabrication gate | `bun scripts/fabrication-check.ts` | **FAIL — 136 matches across 3 patterns.** |
| Python `app/` tests | `pytest tests_py` | **5 passed** (one test makes a live YouTube request). |
| Python `ai-service` tests | `pytest ai-service/tests` | **8 collection errors** — `ModuleNotFoundError: pytesseract`; the pins need Python ≥3.11 and this machine has 3.9.6. Not a code defect; the service is untestable here. |
| Lockfile | `bun install --frozen-lockfile --dry-run` | Clean in 97 ms. |
| Production build | not run | `.output/nitro.json` records a successful build on 2026-09-21. Whether the current tree builds is UNKNOWN. |

### 2.1 The 10 failing tests

| # | Test file and name | Apparent cause |
|---|---|---|
| 1 | `tests/collectors-existing-shodan-internetdb.test.ts` — "a 404 (not scanned) is a completed run with scanned:false, never a failure" | Stale expectation. `HostSurface` gained `devices: {cctvOrWebcam, detectedDevices, iotOrIndustrial, routerOrGateway}` and `shodanUrl` in [attack-surface.ts](../src/utils/attack-surface.ts); the test's `toEqual` still expects the old shape. Test debt, not a bug. |
| 2 | `tests/collectors-external-searxng.test.ts` — "no SEARXNG_URL reports unavailable, not an empty result" | Real defect. With `SEARXNG_URL` deleted the collector fell through to the Google News fallback at [searxng.ts:178-195](../src/utils/collectors/external/searxng.ts#L178-L195) and returned 10 live Google News articles instead of `raw: null`. The test also reached the public internet (1.44 s). |
| 3 | `tests/collectors-external-searxng.test.ts` — "HTTP 403 is reported as the JSON format being disabled" | Same defect: the 403 is swallowed by `catch {}` at line 173, the fallback runs, and `execution.error` is `undefined`, so `.toContain("search.formats")` fails on a non-string. |
| 4 | `tests/collectors-external-searxng.test.ts` — "HTTP 429 is classified as rate-limited" | Same defect: `execution.error?.reason` is `undefined` instead of `"rate-limited"`. |
| 5 | `tests/collectors-person-presence-image.test.ts` — "execute always fails with reason unavailable" | Real divergence. The collector returns `{foundImages: []}` and status `completed`; the test expects `raw: null`. |
| 6 | `tests/collectors-person-presence-image.test.ts` — "the failure message cites DPDP Act 2023" | Same: there is no error object, so `.toContain` gets `undefined`. |
| 7 | `tests/collectors-person-presence-image.test.ts` — "healthCheck reports unavailable, not ready" | Same: [presence-image.ts:100-106](../src/utils/collectors/person/presence-image.ts#L100-L106) returns `state: "ready"`. |
| 8 | `tests/person-investigation-flow.test.ts` — "presence.image … executes cleanly (image is deliberately, permanently unavailable)" | Same root cause: expects `"failed"`, gets `"completed"`. |
| 9 | `tests/recon.test.ts` — "two failures surface the failure — it is never buried" | Real defect. Expects 2 fetch calls, got **6**: the 502 triggers `fallbackSubdomains()`, which makes two more calls, and the catch path calls it again. |
| 10 | `tests/recon.test.ts` — "a 429 is NOT retried — retrying a rate limit makes it worse" | Same: expects 1 call, got **5**. The 429 path now calls the fallbacks, so a rate limit is answered by hitting two more services. |

Three tests also print live network errors (`ECONNRESET`, `SyntaxError: Failed to parse JSON` from HackerTarget/OTX), confirming the suite is not hermetic.

### 2.2 The single type error

```
src/utils/collectors/person/presence-image.ts(69,9): error TS2322: Type '"media"' is not assignable to type
'"image" | "video" | "location" | "email" | "article" | "url" | "organization" | "username" | "person" | "domain" | "phone" | "ip" | "social_account'
```

The same file as failures 5-8. It emits an entity type the frozen contract does not define, so any record it produces would be rejected by `InvestigationResultSchema.parse` at runtime.

### 2.3 Lint breakdown

| Rule | Count | Severity |
|---|---|---|
| `prettier/prettier` | 3,789 | error |
| `@typescript-eslint/no-explicit-any` | 585 | error |
| `react-refresh/only-export-components` | 35 | warning |
| **`sentinel/no-fabricated-fallback`** | **31** | warning |
| `react-hooks/exhaustive-deps` | 7 | warning |
| `prefer-const` | 4 | error |

The 3,789 formatting errors are noise from an unformatted tree (158 of 199 files; `src` 3,464, `tests` 314, `scripts` 11) and clear with `prettier --write`. The 585 `any` annotations are concentrated in [file-provenance-client.ts](../src/utils/file-provenance-client.ts) (60), [routes/osint.tsx](../src/routes/osint.tsx) (35), [youtube-collector.ts](../src/utils/youtube-collector.ts) (30), [social.ts](../src/utils/social.ts) (27) and [routes/index.tsx](../src/routes/index.tsx) (25). The 31 fabrication warnings are the important ones and are itemised in §4.

Seven `react-hooks/exhaustive-deps` warnings sit on data-loading effects in `/agents`, `/gis`, `/graph`, `/index`, `/investigations`, `/osint` and `/reports` — each is a stale-closure risk on a page that loads live data.

---

## 3. The ten most serious problems, worst first

### 1. There is no authentication, no user identity and no tenant boundary anywhere

All 81 `createServerFn` endpoints are callable by anyone who can reach the process. The only gate, `DemoGate` in [__root.tsx:161-184](../src/routes/__root.tsx#L161-L184), is a client-side localStorage check whose own comment says "This is a UX flow, NOT a security boundary… the ~30 server functions remain callable by a crafted request". The login page compares `admin@` / `admin@123` in the browser and prints both on screen. Server-side state is a handful of global files with no owner column. **Commercially:** this is not a gap to close at the edges; every read and write path in the product needs an owner, and nothing in the current code carries one.

### 2. Anonymous callers can add, overwrite and delete credentials, and make the server call out with them

The vault is `./data/credentials.json` in **cleartext** ([credential-vault.ts:553](../src/utils/credential-vault.ts#L553)). Writes are guarded by `requireOperator`, which, when `SENTINEL_OPERATOR_TOKEN` is unset — the default, and it is not in `.env.example` — **logs a warning once and permits the call** ([operator-auth.ts:130-153](../src/utils/operator-auth.ts#L130-L153)). So an unauthenticated caller can add or delete any provider credential and fire `verifyCredential`, which makes the server send a stored bearer token to a host recorded in the entry. Only `revealCredential` fails closed. **Commercially:** a shared static token is not a credential system, and plaintext secrets on disk will fail the first security review.

### 3. A page presents fabricated Instagram and Facebook engagement as collected data

[social.tsx:672-682](../src/routes/social.tsx#L672-L682) renders two hard-coded green badges, "Active Agent Vault: Instagram (@akhil_agent_ai)" and "Facebook (Uno AI)", implying live Meta collection. [Lines 873-874](../src/routes/social.tsx#L873-L874) render `Likes: {p.likes ?? 12}` and `Shares: {p.shares ?? 3}` — invented engagement numbers for any post that carries none. Every pinned social item is stamped `credibilityRationale: "Scraped social signal captured by Sentinel AI agents."` ([line 863](../src/routes/social.tsx#L863)). The page header claims agents ingest Instagram, Facebook and X while the policy table on the same page says they cannot be collected. **Commercially:** invented engagement metrics attributed to real platforms is the kind of defect that ends a pilot.

### 4. Two collectors silently substitute a different source and mislabel the provenance

`collectCrtShSubdomains` falls back to HackerTarget and AlienVault OTX on failure, on rate limit **and on a genuine zero result**, then labels every row `source: "crtsh"` ([recon-sources.ts:143-203, 289-297](../src/utils/recon-sources.ts#L143-L203)). The SearXNG collector falls back to Google News RSS and labels results `engine: "Google Web Index"` ([searxng.ts:178-195](../src/utils/collectors/external/searxng.ts#L178-L195)). Five of the ten failing tests are the codebase detecting its own regression. **Commercially:** an OSINT product's evidence chain is its product; a result that names the wrong source is worse than no result.

### 5. Several integrations cannot be used commercially as built

Shodan InternetDB is free "for non-commercial use" and needs an enterprise licence to make money with (Shodan's own page). InsightFace's `buffalo_l` models, behind `/ai/faces`, are "for non-commercial research purposes only". C2IntelFeeds, rendered in the `/osint` IOC table, is CC BY-NC-SA 4.0. YouTube's ToS prohibits automated access and downloading, and both the TypeScript InnerTube collector and the Python yt-dlp service do exactly that. HIBP requires visible attribution that the UI does not render. Full detail and a dozen more UNKNOWNs are in [COLLECTORS.md](COLLECTORS.md).

### 6. All analyst work product lives in the browser and is lost on a cleared profile

Cases, pinned evidence, the evidence vault, graph and timeline snapshots, watchlists, bookmarks, generated products, the image-hash corpus and social monitors are all localStorage (§6). Nothing is shared between two analysts, nothing survives a different browser, and nothing is backed up. **Commercially:** this is the single largest piece of missing infrastructure.

### 7. A route file is also the backend, and three of its server functions are dead

[news.tsx](../src/routes/news.tsx) (2,402 lines) defines six server functions used across the app, including the RDAP/DNS/crt.sh/GitHub/Wikidata profile builder. [osint.tsx](../src/routes/osint.tsx) (2,900 lines) defines six more. `fetchReviews`, `fetchSearchIntelligence` and `fetchMediaIntelligence` have **zero call sites** anywhere (§ question 2), yet `fetchReviews` alone contains 300 lines of rating-and-takeaway generation with templated text and a `rating = 3` default. Backend logic inside a page file cannot be unit-tested in this project at all — route files call `createFileRoute` at module load, which is why `src/utils/` exists.

### 8. `/live` presents one Google News query as a live multi-platform stream, and swallows its failures

[live.tsx:36](../src/routes/live.tsx#L36) substitutes the query `"ISRO Chandrayaan"` when none is supplied. The handler's `catch` returns `{streams: []}` ([lines 121-124](../src/routes/live.tsx#L121-L124)), so an upstream failure renders as "The feed returned no items" rather than an error. Every non-positive item is tagged `"alert"` ([line 113](../src/routes/live.tsx#L113)). A reveal timer drips the one-shot result in over time so it reads as a feed. `/subjects` has the same shape: its "matching corpus" is four fixed queries — `"intel"`, `"threat"`, `"c2"`, `"OSINT"` — unrelated to the watchlist being matched ([subjects.tsx:83-86](../src/routes/subjects.tsx#L83-L86)).

### 9. A server function scans the host's own network on anonymous request

`getLocalNetworkDevices` ([local-network.ts:656](../src/utils/local-network.ts#L656)) writes a PowerShell script to temp and executes it with `-ExecutionPolicy Bypass`, runs `netsh wlan`, pings every address `.1`-`.254` of the server's subnet and reads the ARP cache. It is unauthenticated like every other server function. On a hosted deployment this scans the hosting provider's network. It is also Windows-only, so it silently returns nothing on the Linux production image.

### 10. The programme's own quality gates are red and the documentation is stale

`bun scripts/fabrication-check.ts` — the repo's own anti-fabrication gate, which CLAUDE.md requires to exit 0 — fails with 136 matches. The README claims 653 passing tests and a clean type check. `.claude/rules/memory-and-preservation.md` instructs every AI session to run `bun test` and confirm "415+ tests pass cleanly without regression"; they do not. The two scraper scripts documented as deleted are still present. A rebuild that trusts these documents will inherit false assumptions; `PROJECT_MEMORY.md` alone is 404 KB of session narrative.

---

## 4. Fabricated, guessed and defaulted data (highest priority category)

Three classes, per the repo's own taxonomy. I have separated genuine fabrications from honest absence markers and from loop accumulators; only the first class is a defect.

### 4.1 Values that would read to an analyst as a measurement

| File:line | Code | Why it is a fabrication |
|---|---|---|
| [src/routes/social.tsx:873](../src/routes/social.tsx#L873) | `Likes: {p.likes ?? 12}` | Invents an engagement count for a real post. |
| [src/routes/social.tsx:874](../src/routes/social.tsx#L874) | `Shares: {p.shares ?? 3}` | Same. |
| [src/routes/social.tsx:676-681](../src/routes/social.tsx#L676-L681) | Hard-coded badges "Instagram (@akhil_agent_ai)", "Facebook (Uno AI)" | Asserts two live Meta integrations that do not exist. |
| [src/routes/social.tsx:863](../src/routes/social.tsx#L863) | `credibilityRationale: "Scraped social signal captured by Sentinel AI agents."` | Written into pinned evidence as a rationale for a score that was never computed. |
| [src/routes/social.tsx:853](../src/routes/social.tsx#L853) | `<Tone tone={p.tone || "medium"} />` | Unassessed tone renders as a measured "medium". |
| [src/routes/social.tsx:324](../src/routes/social.tsx#L324) | `tone: m.tone || "neutral"` | Same, into the hashtag aggregate. |
| [src/routes/social.tsx:910](../src/routes/social.tsx#L910) | `{(h.v / 1000).toFixed(0)}K monitored hits` | A raw count divided by 1,000 and labelled "K monitored hits". |
| [src/routes/social.tsx:336-351](../src/routes/social.tsx#L336-L351) | Synthesised `#word` hashtags from frequent words when a post carries none | Invents hashtags attributed to real posts. |
| [src/utils/vehicle-osint.ts:393](../src/utils/vehicle-osint.ts#L393) | `make: make \|\| "RTO Registry Record"` | A manufacturer field filled with a non-manufacturer. |
| [src/utils/vehicle-osint.ts:394](../src/utils/vehicle-osint.ts#L394) | `model: model \|\| (vehicleClass ? ... : "Motor Vehicle")` | Invents a model. |
| [src/utils/vehicle-osint.ts:395-397](../src/utils/vehicle-osint.ts#L395-L397) | `vehicleClass \|\| "Motor Vehicle (LMV / Two-Wheeler)"`, `fuelType \|\| "Petrol / Diesel / EV"` | Both render as the vehicle's attributes. |
| [src/utils/vehicle-osint.ts:398](../src/utils/vehicle-osint.ts#L398) | `stateOrRegion: stateName \|\| "National Vehicle Registry"` | A place field filled with an organisation. |
| [src/utils/vehicle-osint.ts:399](../src/utils/vehicle-osint.ts#L399) | `rtoLocation: rtoLocation \|\| \`${stateCode} Transport Authority\`` | Invents an office. |
| [src/utils/vehicle-osint.ts:401](../src/utils/vehicle-osint.ts#L401) | `source: ... : "Open License Plate Index"` | Names a source that does not exist; the real source was a DuckDuckGo HTML scrape keyword-matched at [lines 322-375](../src/utils/vehicle-osint.ts#L322-L375). |
| [src/routes/recon.tsx:936](../src/routes/recon.tsx#L936), [948](../src/routes/recon.tsx#L948) | Renders those two vehicle defaults | Second surface for the same values. |
| [src/routes/recon.tsx:758](../src/routes/recon.tsx#L758) | `data.connectedWifi?.ssid \|\| "Your Wi-Fi Network"` | Renders as a measured SSID. |
| [src/routes/recon.tsx:797](../src/routes/recon.tsx#L797) | `n.deviceCategory \|\| "Connected Client"` | Device classification asserted for an unclassified device. |
| [src/utils/local-network.ts:414](../src/utils/local-network.ts#L414), [467](../src/utils/local-network.ts#L467) | `ssid: name \|\| "Hidden Network"` | A parse failure becomes a finding about the network. |
| [src/routes/news.tsx:1260-1265](../src/routes/news.tsx#L1260-L1265) | `corporateData = { status: "Active", jurisdiction, fileNo, hq }` for any Wikidata hit | Asserts a live corporate registration from an encyclopaedia match. |
| [src/routes/news.tsx:1239](../src/routes/news.tsx#L1239) | `fileNo = lei \|\| entityId` | A Wikidata QID rendered as a company file number. |
| [src/routes/news.tsx:1258](../src/routes/news.tsx#L1258) | `hq = cityMap[hqId] \|\| entity.descriptions?.en?.value \|\| "Registered Address Undisclosed"` | Falls back to a free-text description in an address field. |
| [src/routes/news.tsx:1067-1069](../src/routes/news.tsx#L1067-L1069), [1084](../src/routes/news.tsx#L1084) | `\|\| (isRegistered ? "Registered (WHOIS Privacy)" : "Unknown")`, `"Registered (WHOIS Protected)"` | Asserts a privacy service where the registrar was simply not parsed. |
| [src/routes/news.tsx:952](../src/routes/news.tsx#L952) | `Registrar: "Querying registry..."` as an initial value | A status string in a data field. |
| [src/routes/news.tsx:1305,1316-1319](../src/routes/news.tsx#L1305) | `displayUrl = "google.com"` and `snippet: \`Search index entry for ${q} published on ${displayUrl}.\`` | Invents both a publisher and a snippet. |
| [src/routes/news.tsx:1451-1494](../src/routes/news.tsx#L1451-L1494), [1722-1771](../src/routes/news.tsx#L1722-L1771) | Labels "Verified Wikidata Profile", "Verified Agent Match", "Verified Subreddit Match" | "Verified" applied to a regex or name match. Compounded by `generateHandleVariations` ([1341-1368](../src/routes/news.tsx#L1341-L1368)), which strips digits and underscores, so `taraka_nadh_253` probes `tarakanadh` and any hit is reported as a "Nearest Match" profile for the searched person. |
| [src/routes/news.tsx:1595](../src/routes/news.tsx#L1595) | `pubDate: safeIsoDate(new Date().toISOString())` for Telegram items | **Timestamp invention:** stamps fetch time as publication time. |
| [src/routes/news.tsx:751,815-856](../src/routes/news.tsx#L751) | `let rating = 3` plus templated "takeaways" including "based on … verified news & media sources" | Invented rating and prose in `fetchReviews` (dead code, but it renders if ever wired). |
| [src/routes/news.tsx:881-889](../src/routes/news.tsx#L881-L889) | `catch` returns zeroed counts | A failed collection reads as a measured zero. |
| [src/routes/news.tsx:1660](../src/routes/news.tsx#L1660) | `url: item.link \|\| "https://youtube.com"` | A bare domain as an item URL. |
| [src/routes/news.tsx:513](../src/routes/news.tsx#L513) + [2190-2192](../src/routes/news.tsx#L2190-L2192) | `countryCode: feedInfo.region` ("Global"/"US") rendered beside a map pin | Publisher region rendered as an event location. |
| [src/routes/news.tsx:446,461](../src/routes/news.tsx#L446) | `category = "general"`, `threatLevel = "low"` defaults driving tone badges | An unclassified article renders as assessed low threat. |
| [src/routes/news.tsx:2231](../src/routes/news.tsx#L2231), [src/routes/sentiment.tsx:133](../src/routes/sentiment.tsx#L133) | `lead.category \|\| "general"`, `s.category \|\| "general"` | Same. |
| [src/routes/live.tsx:36](../src/routes/live.tsx#L36) | `data?.query \|\| data?.q \|\| "ISRO Chandrayaan"` | An unrequested subject collected and displayed. |
| [src/routes/live.tsx:113](../src/routes/live.tsx#L113) | `tags: [sentiment === "positive" ? "growth" : "alert"]` | Every non-positive item labelled an alert. |
| [src/routes/live.tsx:121-124](../src/routes/live.tsx#L121-L124) | `catch { return { streams: [] } }` | Collection failure rendered as an empty result. |
| [src/routes/subjects.tsx:83-86](../src/routes/subjects.tsx#L83-L86) | Watchlist matching runs against `"intel"`, `"threat"`, `"c2"`, `"OSINT"` | The displayed "matches" have no relationship to the watchlist. |
| [src/routes/network.tsx:123-140](../src/routes/network.tsx#L123-L140) | A synthetic post (`text: ""`, `createdAt: profile.createdAt ?? ""`) fed to `accountMaturity` when an account has no posts | A fabricated input to a signal that is then displayed. |
| [src/routes/network.tsx:190-194](../src/routes/network.tsx#L190-L194) | `confidence: 1` hard-coded on graph nodes | Maximum confidence asserted, not measured. |
| [src/routes/agents.tsx:375-383](../src/routes/agents.tsx#L375-L383) | Static terminal lines "[SYS] Fetching workspace telemetry…", "[CRAWLER] Case: …" | Theatre: no such operations run. |
| [src/routes/agents.tsx:442](../src/routes/agents.tsx#L442), [468](../src/routes/agents.tsx#L468) | Invented model context, e.g. `` `Senior command brief for subject ${activeTarget}.` `` and `` `${activeTarget} military cyber infrastructure activity` `` | Fabricated input sent to the model, whose output is then shown as analysis. |
| [src/routes/osint.tsx:1845](../src/routes/osint.tsx#L1845) | "Mode: 100% Live Keyless OSINT" | Contradicted by the token-gated UCDP panel on the same page. |
| [src/routes/osint.tsx:2298](../src/routes/osint.tsx#L2298) | A pulsing green dot rendered beside every IOC row, including `status: null` | Implies "live" for an indicator with no reported status. |
| [src/routes/osint.tsx:500](../src/routes/osint.tsx#L500) | `apiQuery = query ? … : "military conflict"` | Unrequested default subject. |
| [src/routes/osint.tsx:330](../src/routes/osint.tsx#L330) | Five hard-coded Telegram channels scraped on every query | Results attributed to the analyst's search. |
| [src/utils/geo.ts:418](../src/utils/geo.ts#L418) | `title: String(p.title ?? p.place ?? "Seismic event")` | Label on a plotted marker. |
| [src/utils/geo.ts:487](../src/utils/geo.ts#L487) | `?? "Conflict event"` | Same. |
| [src/utils/geo.ts:538](../src/utils/geo.ts#L538) | `source: String(article?.domain ?? "GDELT")` | Names the aggregator as the publisher. |
| [src/utils/geo.ts:765](../src/utils/geo.ts#L765) | `?? "Crisis"` | Disaster type invented. |
| [src/utils/geo.ts:769](../src/utils/geo.ts#L769) | `url: String(fields.url_alias ?? "https://reliefweb.int")` | A site root as a record URL. |
| [src/utils/geo.ts:889](../src/utils/geo.ts#L889) | `source: image.camera \|\| "EXIF GPS"` | A camera field filled with a technique name. |
| [src/utils/graph-view.ts:238](../src/utils/graph-view.ts#L238) | `typeId: e?.type ?? "person"` | An unknown entity is typed as a **person** in a graph about people. |
| [src/utils/graph-view.ts:321](../src/utils/graph-view.ts#L321) | `typeId: n?.type ?? "OTHER"` | Lower severity, same class. |
| [src/utils/cases/case-intelligence-breakdown.ts:410](../src/utils/cases/case-intelligence-breakdown.ts#L410) | `count(ctx.input.geointHypotheses ?? 0)` | **Zero flattening:** an unreported hypothesis count renders as a measured 0. |
| [src/utils/collectors/passive-policy.ts:188](../src/utils/collectors/passive-policy.ts#L188) | `collectionMode: cap?.collectionMode ?? "ACTIVE"` | Deliberate fail-closed choice; flagged because it writes a mode nobody declared. Defensible. |
| [src/utils/geoint/geolocation-hypothesis.ts:150](../src/utils/geoint/geolocation-hypothesis.ts#L150) | `discoveredBy: input.discoveredBy ?? "MANUAL_ASSISTED"` | Attributes a discovery method that was not recorded. |
| [src/utils/dorks.ts:312](../src/utils/dorks.ts#L312) | `source: source \|\| "Unknown publisher"` | Borderline; reads as a label, not a finding. |
| [src/utils/transcription.ts:226](../src/utils/transcription.ts#L226) | `file.name \|\| "upload.bin"` | Filename only; harmless. |
| [src/utils/leaflet-client.ts:110](../src/utils/leaflet-client.ts#L110) | `env.VITE_GIS_TILE_ID \|\| "custom"` | Config label; harmless. |
| [src/utils/investigations-store.ts:137-138](../src/utils/investigations-store.ts#L137-L138) | `target.trim() \|\| "Unnamed subject"` | Honest placeholder. |
| [src/utils/watchlist-store.ts:180-181](../src/utils/watchlist-store.ts#L180-L181) | `name \|\| "New Watchlist"`, `description \|\| "Intel monitoring filter."` | Honest placeholders. |
| [src/utils/operational-error.ts:121](../src/utils/operational-error.ts#L121) | `return "no-id"` from `newCorrelationId` on crypto failure | Documented deliberate marker. |
| [src/utils/operational-error.ts:206](../src/utils/operational-error.ts#L206), [220](../src/utils/operational-error.ts#L220) | `e.provider ?? "the configured"`, `e.platform ?? "the source"` | Prose in an error message. Fine. |
| [src/routes/index.tsx:537](../src/routes/index.tsx#L537) | `String(s.id ?? s.primaryLink ?? "0")` | A record id, not a measurement. |
| [src/routes/sources.tsx:689](../src/routes/sources.tsx#L689) | `activeProfile?.name ?? "custom"` | Correct label for an unsaved profile. |
| [src/routes/social.tsx:932,935](../src/routes/social.tsx#L932) | `status?.state ?? "initialising"`, `?? "Opening the socket…"` | Genuine UI states. |

### 4.2 Seeded and hard-coded records that render as data

| File:line | What |
|---|---|
| [src/utils/watchlist-store.ts:59-88, 144-149](../src/utils/watchlist-store.ts#L59-L88) | Two `[SAMPLE]` watchlists written to storage on first load, naming fictional organisations (Vector-17, Aviation Security, Aster Motors, Meridian Capital, Northwind Logistics). `/watchlists` shows a banner; **`/subjects` renders them with no banner** and computes tiles from them. |
| [src/routes/index.tsx:197-198, 726, 764-771](../src/routes/index.tsx#L197-L198) | Dashboard opens on `"GOOGLE.COM"` as the active target and offers presets "Tesla", "OpenAI", "google.com", "Elon Musk", "#ElectionIntegrity", "Cyber Attack". |
| [src/utils/active-target.ts:5,12](../src/utils/active-target.ts#L5) | The default target for the entire application is the literal string `"google.com"`. |
| [src/routes/tasks.tsx:95-101, 191](../src/routes/tasks.tsx#L95-L101) | Probe article with `url: "https://www.reuters.com/probe"` and `pubDate: now`; `https://${domain}.com` invented for a bare domain. Labelled as a probe. |
| [scripts/agent-scraper.js:119-140](../scripts/agent-scraper.js#L119-L140) | Two hard-coded Instagram/Facebook posts with `Math.floor(Math.random() * 900)` likes, `pubDate: new Date()`. Still in the tree. |
| [scripts/agent_scraper.py:68-77](../scripts/agent_scraper.py#L68-L77) | Google News items relabelled as Instagram/Facebook with `likes: hash(title) % 500`, author `@{query}_user`, and `datetime.utcnow()` when no date. Reads `data/credentials.json` and logs into Instagram with it. Still in the tree. |

### 4.3 Patterns checked and found clean

The `|| new Date()` timestamp-invention pattern is **absent from live code**: all six greps in `src/` are comments recording where it used to be, plus two legitimate `options.now ?? Date.now()` injection points. The Telegram case at [news.tsx:1595](../src/routes/news.tsx#L1595) is the one live instance and is listed above. `Math.random()` appears in live code only in `app-shell.tsx:309` (a DOM key) and `audio-fingerprint-store.ts:92` (an id); everything else is a comment. Of the 86 `?? 0` / `|| 0` occurrences in `src/utils` and `src/routes`, all but the two listed above are loop accumulators, array-index guards, sort comparators or layout values.

---

## 5. Secrets and credential handling

**No hard-coded secret was found in the source tree.** Greps for OpenAI/Google/GitHub/Slack/AWS key shapes, private-key headers and JWTs across `src/`, `app/`, `ai-service/`, `osint-workers/`, `scripts/`, `tests/`, `docs/` and the root Markdown files returned nothing. No `.env`, `data/`, `*.pem` or `credentials.json` exists in the working tree, and `git log --diff-filter=A` shows none was ever committed.

Three findings remain:

1. **Plaintext credential storage.** [credential-vault.ts:577-605](../src/utils/credential-vault.ts#L577-L605) writes `./data/credentials.json` as pretty-printed JSON, `chmod 0600` on a best-effort basis (a no-op on Windows), plus a full second copy at `./data/credentials.prev.json`. No encryption at rest, no KMS, no envelope. The file is gitignored and excluded from the Docker build context.
2. **The write path is open by default** (problem 2 above): `SENTINEL_OPERATOR_TOKEN` is undocumented in `.env.example` and, when unset, `requireOperator` permits the call.
3. **Two published demo credentials**: `DEMO_OPERATOR = "admin@"` / `DEMO_PASSWORD = "admin@123"` in [demo-session.ts:23-24](../src/utils/demo-session.ts#L23-L24), shipped in the client bundle and printed on the login screen. Deliberate and disclosed, but it must not survive. `osint-workers/searxng/settings.yml:14` carries `secret_key: "CHANGE_ME_generate_with_openssl_rand_hex_32"`.

**Environment variables.** 33 distinct `process.env` reads in `src/`. Three are read but undocumented in `.env.example`: `PERSON_INVESTIGATION_ENABLED`, `PERSON_AUDIT_LOG_PATH`, `SHERLOCK_WORKER_URL`. Also undocumented: `SENTINEL_OPERATOR_TOKEN`, `BRAVE_SEARCH_API_KEY`, `HIBP_API_KEY`, `CSP_MODE`, `MASTODON_EXTRA_INSTANCES`. Seven documented variables are never read directly (`LLM_FALLBACK_MODEL` and the six `RATE_LIMIT_*_LIMIT` entries) because they are composed dynamically at [llm.ts:52](../src/utils/llm.ts#L52) and in the rate-limit tier reader — not a defect.

**Credentials cross into logs and errors carefully.** [start.ts:59-70](../src/start.ts#L59-L70) sanitises every server-function throw behind a correlation id, and only `message` crosses to the browser (measured by the original developer, documented in the file). `verifyProviderCredential` blocks private/loopback hosts before sending a Mastodon token, closing a real SSRF-with-credential-forwarding hole.

---

## 6. Where state lives, and what is lost on restart

| Store | Mechanism | Holds | Lost when |
|---|---|---|---|
| `sentinel_investigations` (+`_version`) | localStorage | **Cases and all pinned evidence** | Browser data cleared; never shared between browsers or users |
| `sentinel_evidence` (+`_version`) | localStorage | Evidence vault records (hashes, metadata, provenance) | Same |
| `sentinel_graph_snapshot` (+`_version`, + per-case keys) | localStorage | Graph snapshots | Same |
| `sentinel_timeline_snapshot` (+`_version`, + per-case keys) | localStorage | Timeline snapshots | Same |
| `sentinel_case_runs` (+`_version`) | localStorage | Case↔OSINT-run joins | Same |
| `sentinel_snapshot_evictions` | localStorage | Which snapshots were evicted at the cap | Same |
| `sentinel_watchlists` (+`_version`) | localStorage | Watchlists (seeded with two `[SAMPLE]` rows) | Same |
| `sentinel_bookmarks` (+`_version`) | localStorage | `/live` shortlist | Same |
| `sentinel_products` | localStorage | Generated intelligence products (cap 25) | Same |
| `sentinel_image_hashes` | localStorage | Perceptual-hash corpus for near-duplicate matching | Same |
| `sentinel_audio_references` | localStorage | Saved audio fingerprints | Same |
| `sentinel_social_monitors` | localStorage | Keyword monitors | Same |
| `sentinel_active_target` / `_type` / `sentinel_recent_targets` | localStorage | Current subject (default `"google.com"`) | Same |
| `sentinel_demo_session` | localStorage | The fake session | Same |
| `sentinel_credibility_profiles`, `sentinel_domain_overrides`, `sentinel_active_credibility_config` | localStorage | Module 1 weights and overrides | Same |
| `sentinel_theme`, `sentinel_lang`, `sentinel_nav_groups` | localStorage | UI preferences | Same |
| `./data/credentials.json` + `.prev.json` | Server file, cleartext | All provider credentials | Container restart without a volume; excluded from the image |
| `./data/credibility-profiles.json` | Server file | Custom weight profiles | Same |
| `data/person-investigation-audit.jsonl` | Server file, append-only | Person-investigation lawful-basis audit | Same |
| `data/jobs.sqlite` | `bun:sqlite`, opt-in via `JOB_STORE_PATH` | OSINT jobs | Same — **and it cannot load at all** under the Node production runtime or the dev server (documented in [person-audit-store.ts:11-26](../src/utils/osint/person-audit-store.ts#L11-L26)) |
| OSINT job store (default) | Process memory | Every job and its results | **Every restart** |
| LLM cache (500 entries) + call log (200) | Process memory | Cached completions, token/latency stats | **Every restart** |
| Rate-limit counters and strikes | Process memory | Abuse state | **Every restart**; also per replica, so N replicas permit N× every limit |
| Bluesky session JWT, Reddit access token, profile/feed caches | Process memory | Auth tokens and 2-10 min caches | **Every restart** |
| Geocode cache, FFT/DCT basis caches, parse caches | Process memory | Derived values | **Every restart** |
| `ai-service` model registry and `/ai/stats` counter | Process memory | Loaded models, call count | **Every restart** (by design) |
| File hand-off between pages | Module-scope memory | An uploaded `File` | Page reload |
| Bluesky Jetstream buffer | Browser memory, 2,000-post ring | Live posts | Tab close |

There is **no database**. Nothing is shared between two people using the product.

---

## 7. Dead code, duplication and abandoned experiments

**Dead modules** (imported by no route, component or utility): [cyber-intel.ts](../src/utils/cyber-intel.ts), [telegram-intel.ts](../src/utils/telegram-intel.ts), [focal-point.ts](../src/utils/focal-point.ts), [social-velocity.ts](../src/utils/social-velocity.ts), [osint/person-query-planner.ts](../src/utils/osint/person-query-planner.ts), [osint/index.ts](../src/utils/osint/index.ts), [src/components/report-blocks.tsx](../src/components/report-blocks.tsx). Four of them have tests, which is why they went unnoticed.

**Dead server functions** (no call site anywhere): `fetchReviews`, `fetchSearchIntelligence`, `fetchMediaIntelligence` (all in `news.tsx`), `socialBlueskySearch`, `socialMastodonSearch` (in `social.ts`), `readPersonInvestigationAuditServer`, and `getCredentials`/`saveCredentials` in `settings.tsx` (superseded by `listCredentials`/`addCredential`; they remain exported and callable). `fetchReviews` alone is ~300 lines.

**Dead imports**: `agents.tsx:27-28` imports `fetchNews`, `fetchSocialIntelligence` and `fetchCyberThreats` and calls none. `osint.tsx:23-24` imports `NotImplementedPanel` and `OSINT_NOT_IMPLEMENTED` and never renders them.

**Duplicated implementations**:

- **RSS/news collection exists four times**: `fetchNews` (news.tsx), `fetchLiveMonitoring` (live.tsx), `fetchRSSAggregator` (osint.tsx) and `news-aggregation.ts`. All parse feeds; all differ in shape.
- **RDAP twice**: inline in `news.tsx:1023-1034` and in `collectors/existing/rdap.ts`.
- **DNS-over-HTTPS three times**: `attack-surface.ts`, `news.tsx:960`, `contact-email.ts:136`.
- **YouTube collection twice**: `src/utils/youtube-collector.ts` (InnerTube) and the whole `app/` Python service (yt-dlp). See question 1.
- **Image forensics twice by design**: browser `imaging.ts` and Python `ai-service/app/forensics.py` implement EXIF, pHash and C2PA independently. Documented as deliberate.
- **Two graph sources** converged into `graph-view.ts`, which the file's own header describes as a collision of two features that each thought they owned `/graph`.
- **Two case-attachment paths**: `PinButton`/`pinToInvestigation` (used by 6 pages) and `case-attach.ts`/`social-attach.ts` (used only by the verification script).

**Abandoned experiments**: the `scripts/agent-scraper.js` / `agent_scraper.py` pair (documented as deleted, still present); `osint/job-store-sqlite.ts` (266 lines and a test for a store that cannot load in any real runtime); `collectors/external/sherlock.ts` (459 lines of client for a worker that does not exist); the `whisper` and `llm` entries in the ai-service model registry (permanent `not_loaded` stubs); `/ai/video`, `/ai/transcribe`, `/ai/translate`, `/ai/chat` (501 stubs with full response schemas defined); `worldmonitor` and 14 other unused npm dependencies.

**Documentation as dead weight**: `PROJECT_MEMORY.md` (404 KB), `ANTIGRAVITY_TASK.md` (43 KB, header says its contents are already implemented), `docs/OSINT-INTEGRATION-PLAN.md` (104 KB), plus CLAUDE.md and `.claude/rules/` — all written for AI sessions on the defence programme.

---

## 8. What is production-quality and worth keeping as-is

Ranked by how much would have to be rebuilt otherwise.

1. **[file-provenance.ts](../src/utils/file-provenance.ts) + client + revocation** (2,715 + 1,797 + 418 lines, 152 + ~40 tests). Multi-format container forensics, a hand-rolled CMS verifier written only after confirming node-forge's was a stub, and an OCSP/CRL path whose design was driven by two live-verified findings. Nothing in it assumes a tenant.
2. **The collector framework** ([types.ts](../src/utils/collectors/types.ts), [result.ts](../src/utils/collectors/result.ts), [registry.ts](../src/utils/collectors/registry.ts), [errors.ts](../src/utils/collectors/errors.ts), [passive-policy.ts](../src/utils/collectors/passive-policy.ts), [query-planner.ts](../src/utils/osint/query-planner.ts), [merge.ts](../src/utils/osint/merge.ts), [entity-resolution.ts](../src/utils/osint/entity-resolution.ts)). A clean contract with a zod-validated result model and an error taxonomy that refuses to collapse "failed" into "zero results".
3. **[credibility.ts](../src/utils/credibility.ts) and [analysis.ts](../src/utils/analysis.ts)** (1,612 lines, 84 tests). Deterministic, synchronous, no network, no `Math.random()`, per-factor evidence strings. The clearest commercial differentiator in the repository.
4. **[imaging.ts](../src/utils/imaging.ts) and [audio-frequency.ts](../src/utils/audio-frequency.ts)** (2,762 lines, 129 tests). Pure signal processing with an explicit, argued refusal to ship a deepfake score.
5. **[cib.ts](../src/utils/cib.ts)** (886 lines, 84 tests). Signals with evidence, `null` where a signal cannot be computed, never a verdict.
6. **[reports.ts](../src/utils/reports.ts) + [report-pdf.ts](../src/utils/report-pdf.ts)** (1,422 lines, 45 tests). Citation validation after generation, retry-then-throw, no partial products, provenance on every PDF page.
7. **The security middleware**: [start.ts](../src/start.ts) (CSRF, error sanitiser, rate limiter), [security-headers.ts](../src/utils/security-headers.ts), [client-ip.ts](../src/utils/client-ip.ts) (trusted-proxy parsing done right), [validation.ts](../src/utils/validation.ts) (real runtime contracts replacing identity-function validators), [rate-limit.ts](../src/utils/rate-limit.ts) (pure, injected clock, no hard lockout). Needs a shared store, not a redesign.
8. **[geo.ts](../src/utils/geo.ts)'s coordinate-honesty core** and the precision/uncertainty model, once the six label fallbacks are fixed.
9. **`ai-service`'s structure**: typed JSON error envelopes, a load-once model registry, air-gapped vendored-weights-only loading, and honest framing of YAMNet's uncalibrated scores. The InsightFace licence is the blocker, not the code.
10. **The UI layer**: 46 vendored shadcn primitives, a consistent console aesthetic across 33 pages, `NotImplementedPanel` / `SampleDataBanner` / `CredentialNotice` as reusable honesty components, and the custom `no-fabricated-fallback` ESLint rule plus `smoke.mjs` / `dead-controls.mjs`, which catch defects no unit test can see.

---

## 9. The specific questions

**1. Does the Python `app/` YouTube service do anything the TypeScript collector does not?**

**No. It is fully redundant, and nothing calls it.** A grep for `/osint/youtube`, port 8001, `yt-dlp` or any Python-backend reference across `src/` returns one unrelated comment. Feature comparison:

| Capability | `app/` (yt-dlp) | `src/utils/youtube-collector.ts` (InnerTube) |
|---|---|---|
| Metadata | yes, plus an oEmbed fallback that fabricates a caption track (`available_subtitles: [{code:'en', isAuto:true}]`) and thumbnail dimensions (480×360) it never measured ([youtube.py:151-163](../app/collectors/youtube.py#L151-L163)) | yes, across four spoofed clients, naming which client answered in `provenance.model` |
| Captions | VTT parsing | VTT **and** YouTube's `timedtext` XML, which is what the endpoint actually returns |
| Download | downloads the file to server disk under `data/youtube_downloads` | returns a direct muxed MP4 URL to the browser |
| Search | no | yes (`searchYoutubeVideos`) |
| Comments | no | yes, via the official Data API v3 with five distinguishable failure states |
| Audit | one `logger.info` line hard-coded to `User: analyst` ([youtube.py:325](../app/collectors/youtube.py#L325)) | none |
| ffmpeg | bundled via imageio-ffmpeg | none needed |

The only thing `app/` has that the TypeScript side lacks is server-side file download with ffmpeg merging of adaptive streams. Both approaches conflict with YouTube's ToS. Recommendation implied by the evidence: delete `app/`, `tests_py/`, the root `requirements.txt` and the root `Dockerfile`'s Python assumptions.

**2. Which features are referenced in the UI but not implemented, or implemented but never called?**

*Referenced but not implemented (honestly declared):* `/alerts` (no alert pipeline, and the top-bar bell is inert), `/threats` (no threat index), `/profile` ("password change, MFA, security keys, device management and the access audit log — none is implemented"), `/tasks` Module 3 and 4 tabs (static "Not Implemented"), `/agents` `FOCAL_POINT` (returns fixed "Not run" text) and 12 of its 13 capabilities (badged "case metadata only"), `/watchlists` scheduling, `ai-service` `/ai/video`, `/ai/transcribe`, `/ai/translate`, `/ai/chat` (501), `/osint` GPS and OREF cards (permanently `null`/`[]`), the `whisper` and `llm` model-registry entries.

*Referenced and misleading:* `/osint`'s Geopolitical tab says "No GPS-interference feed is wired" while the GPS tab on the same page fetches one. `/youtube` says "audio transcription is not implemented — Whisper needs GPU inference" while `/videos` transcribes through Sarvam. `/youtube` requests `quality: "720p"` and names the file `_720p.mp4` while its own text says the artifact is 360p.

*Implemented but never called:* the eight server functions in §7; `case-attach.ts` and `social-attach.ts` (only `osint/verification.ts` uses them, so no page can attach a standalone finding to a case); the entire Sherlock collector; `SqliteJobStore`; the seven dead modules; `NotImplementedPanel` on `/osint`.

**3. Can results from the individual tool pages be saved into a case?**

**Partially, and the split is the product's biggest structural seam.**

Six pages can pin into a case through `PinButton` → `pinToInvestigation`: `/news` (lead stories), `/social` (mentions and live posts), `/live` (shortlist items), `/images` (analysed images), `/vault` (evidence records, via `pinToInvestigationWithId`), and `/agents` (a generated briefing as a note). `/investigations` owns the case record. `ManualCapturePanel` pins attested captures. `CaseRunsPanel` records OSINT runs against a case and writes case-scoped graph snapshots. `/images` can attach GEOINT findings to a case's snapshots.

**The OSINT results cannot.** `/recon`'s investigation panel and `/osint`'s Person Investigation both write the **unscoped** "latest" graph slot with no `caseId` ([recon.tsx:1158-1164](../src/routes/recon.tsx#L1158-L1164), [osint.tsx:976-982](../src/routes/osint.tsx#L976-L982)). The module that would fix this, `case-attach.ts`, exists and is tested-by-use only in the verification script. So the two pages that produce the richest structured evidence — entities, relationships, provenanced evidence records — are disconnected from the case model. `/graph` can save a case-scoped snapshot but writes no evidence to the case record. `/reports` reads case snapshots but saves its product only to the global `sentinel_products` key. `/entities`, `/trends`, `/sentiment`, `/network`, `/videos`, `/gis`, `/crawlers`, `/sources`, `/subjects` and `/timeline` have no path into a case at all.

**4. Where is state stored today?** See §6. Summary: no database; 20 localStorage keys hold all analyst work; 4 server-side files hold credentials, profiles and an audit log; everything else is process memory and dies on restart.

**5. Is there any authentication or user separation at all?**

**No.** Three mechanisms exist and none is authentication:

- `DemoGate` ([__root.tsx:161-184](../src/routes/__root.tsx#L161-L184)) redirects to `/login` when a localStorage key is absent. Its own comment: "a UX flow, NOT a security boundary… bypassed by anyone who sets the key by hand or simply disables JavaScript. Nothing behind it is protected."
- `/login` compares `admin@` / `admin@123` in the browser against constants shipped in the client bundle and printed on the page. No request, no cookie, no session. The session profile is a constant: displayName "Administrator", email "admin@sentinel.local", role "Administrator".
- `requireOperator` ([operator-auth.ts](../src/utils/operator-auth.ts)) compares one shared token, in constant time, on four credential-vault server functions. When the token is unset it permits the call. `revealCredential` alone fails closed.

Everything else — all 81 server functions, every collector, the LAN scanner, the LLM, the job system — is anonymous. There is no user table, no role check, no per-record owner, no audit of who did what. The codebase records that a real auth system (Prisma, SQLite, Argon2id, sessions, RBAC) was built and then reverted at commit `214f0df` on a branch that does not exist in this repository.

**6. How are API keys and credentials stored and read?**

Two sources, environment first. `resolveCredential(providerId)` ([credential-vault.ts:641-674](../src/utils/credential-vault.ts#L641-L674)) reads the provider's env var; if empty it reads `./data/credentials.json` and picks the first entry that has a secret, is not `rejected`, and has an identifier when one is required. Collectors call `resolveCredential` and then `recordCredentialUse` to stamp `lastUsed`. The vault file is cleartext JSON with a `.prev.json` backup, `chmod 0600` best-effort. `listCredentials` returns masked entries plus the last four characters; `revealCredential` is the single path that returns a secret and it requires the operator token unconditionally. Fifteen providers are registered, each declaring what it unlocks and which code path reads it; two (Instagram, Facebook) are permanently `unusable`. Verification makes a real call to each provider and stores the provider's own words with a timestamp — a credential is never "Active" because someone saved it.

**7. What happens when a collector fails?**

**It depends which layer you are in, and the difference is the problem.**

Inside the collector framework, failures are modelled properly: `CollectorError` carries `collector`, `reason` (timeout / unavailable / no-credential / invalid-target / rate-limited / upstream-error / cancelled / unknown) and a message; `execute()` returns `raw: null` with that error; `normalizeGuard` produces an empty result carrying the error; the UI shows the reason. This is correct and is the model to keep.

Outside it, failures are frequently swallowed. `/live`'s handler returns `{streams: []}` on any error, so the page says "the feed returned no items". `fetchReviews` returns zeroed counts in its catch. Five checks in `contact-email.ts` return `null` on failure, making "lookup failed" identical to "nothing found". `presence-image.ts` catches a failed HEAD request and returns `completed` with an empty array. The crt.sh and SearXNG fallbacks are the worst case: a failure is not merely swallowed, it is answered with data from a different source under the original source's name. Thirty-six `catch { return [] / null / {} }` sites exist across `src/utils` and `src/routes`.

Where the codebase gets it right it is emphatic: `/osint` throws when both threat feeds fail rather than showing an empty threat landscape, UCDP's 401 is surfaced as a missing credential rather than as a peaceful world, and SearXNG's `unresponsiveEngines` warning exists specifically so a CAPTCHA does not read as "nothing matched".

**8. How long can a request run before it times out, and what breaks?**

Nothing in the repository configures an HTTP server timeout. The production entry is `node .output/server/index.mjs`, so Node's defaults apply: **`requestTimeout` 300 s**, `headersTimeout` 60 s, `keepAliveTimeout` 5 s (measured on Node 24 here; Node 22 is the same). Every collector sets its own `AbortSignal.timeout`, ranging from 2 s to 50 s. Worst realistic cases:

| Path | Budget |
|---|---|
| crt.sh: 50 s × 2 attempts, then two 6 s fallbacks, and the catch path can run the fallbacks again | up to ~124 s |
| SpiderFoot: 15 s per request, 5 s poll, `DEFAULT_MAX_WAIT_MS` 120 s | ~135 s |
| Sarvam transcription upload | 120 s |
| OSINT job outer cap (`JOB_TIMEOUT_MS`) | 60 s |
| LLM call | 45 s |
| Wi-Fi scan (`execAsync` timeout) | 20 s, plus a ping sweep of 254 addresses |
| GDELT events zip | 40 s |
| `runInvestigation` (synchronous orchestrator) | **no overall cap** — the sum of every collector in the plan |

So the effective ceiling is 300 s and the longest single collector chain is about 135 s. What actually breaks: a platform that imposes a shorter edge timeout (30 s or 60 s is common) would cut `/recon` investigations, SpiderFoot scans and long crt.sh retries mid-flight, and because job state is process memory the work is simply lost. `cancelJob` marks a job cancelled but cannot abort the in-flight fetch: the P0 `Collector.execute()` contract takes no `AbortSignal`, which the code documents as a known limit. A scale-to-zero or restarting host loses every running job, the LLM cache and all rate-limit state.

**9. Which parts assume a single user or single tenant?**

Everything that stores anything. Specifically: all 20 localStorage keys (§6) are unscoped — two analysts in the same browser profile share one case list; the same analyst in two browsers shares nothing. `./data/credentials.json` is one global credential set for the whole deployment. `./data/credibility-profiles.json` is one global profile set. The person-investigation audit log is one global append-only file. `SCAN_AUTHORISATIONS` is one process-wide env var, so an authorisation granted for one customer's target authorises it for everyone. `SENTINEL_OPERATOR_TOKEN` is one shared secret. The LLM cache is keyed on `sha256(model + system + prompt)` with no tenant dimension, so one customer's cached completion can be served to another. Rate-limit counters are per process and per IP, not per account. The OSINT job store is a process-global map with no owner on a job, so `pollOsintInvestigationJob(id)` returns anyone's job to anyone who guesses the id. The Bluesky session JWT and Reddit access token are process singletons. `getActiveTarget()` is a single global "current subject". The collector registry is a process singleton mutated by `registerExistingCollectors()` on each request. The Jetstream socket is per browser tab by design. `ai-service` holds one model registry and one call counter for all callers, with no auth.

**10. Roughly how many lines of code per area?**

| Area | Lines | Notes |
|---|---|---|
| `src/utils/` | 52,117 | 153 files. Largest: file-provenance 2,715; social 2,388; file-provenance-client 1,797; audio-frequency 1,478; credential-vault 1,383; imaging 1,284; youtube-collector 1,247; geo 1,148; reports 1,067 |
| `src/routes/` | 28,306 | 33 files. Largest: osint 2,900; news 2,402; images 1,834; social 1,726; recon 1,511; reports 1,457 |
| `tests/` | 23,420 | 103 files, 2,096 tests |
| `src/components/` | 13,571 | 9,194 app components + 4,377 vendored shadcn |
| `src/i18n/` | 5,733 | 5,090 in 15 locale files |
| `docs/` | 4,359 | 6 files |
| `src/data/geo-map.ts` | 2,796 | Coordinate tables |
| Root governance docs | 2,276 | PROJECT_MEMORY 898 (404 KB), ANTIGRAVITY_TASK 754, CLAUDE 498, README 126 |
| `ai-service/` | 2,953 | app 1,537 + tests 947 + scripts 469 |
| `scripts/` | 1,254 | Includes 378 lines of the two scraper scripts |
| `src/routeTree.gen.ts` | 724 | Generated |
| `src/types/` | 658 | Frozen contracts |
| `app/` (Python) | 586 | Plus 47 test lines |
| `eslint-rules/` | 514 | Custom fabrication rule |
| `osint-workers/` | 283 | Compose + wrapper |
| `src/lib/`, `src/hooks/` | 82 | |
| **Total hand-written code** | **~137,000** | Excluding `src/assets/` (31,857 lines of OUI and CA-bundle data), `public/data/` and `bun.lock` |

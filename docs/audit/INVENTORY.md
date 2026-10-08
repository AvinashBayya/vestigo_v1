# Module inventory

Audit date: 2026-09-23. Scope: every file in `src/utils/`, `src/routes/`, `app/` and `ai-service/`. Line counts are `wc -l`. "Tests" names the test files under `tests/` (or `ai-service/tests/`, `tests_py/`) that import the module; the import graph was computed by script over all `import`/`require` statements.

Verdicts:

- **KEEP**: reusable as it stands (pure logic, no tenancy or programme assumptions).
- **ADAPT**: sound logic, but bound to per-browser localStorage, a global server file, process memory, a single env-var credential, an unverified upstream, or programme-specific wording. Needs boundary work, not a rewrite.
- **REWRITE**: fabricates or mislabels data, is structurally unsuitable for a hosted multi-tenant product, or depends on a source that cannot be used commercially as built.
- **DROP**: dead, redundant, a stub, or programme-specific with no commercial purpose.

Importer counts exclude tests. "0 src importers" means no route, component or utility imports the module.

**`src/utils/cases/`: see `docs/reclamation/R1-INVENTORY.md`.** Its 15 rows below are superseded by that inventory, which classifies every export of every `cases/` file (owner ruling D-17, 2026-10-08). Where the two differ, R1-INVENTORY.md governs.

## 1. `src/utils/` (153 files, 52,117 lines)

| Path | Lines | What it does (from the code) | Tests | Verdict | Reason |
|---|---|---|---|---|---|
| active-target.ts | 108 | Global "active target" in localStorage + `?q=`; defaults to `"google.com"` (lines 5, 12) | active-target.test | ADAPT | Real company domain as the default subject; global key. |
| ai-service-client.ts | 245 | Browser client for ai-service detect/describe/faces/ocr-vlm/audio | audio-events.test, imaging.test | ADAPT | Browser calls the model service directly with no auth. |
| analysis-llm.ts | 364 | LLM summaries, entity extraction, cluster comparison (server fns) | none | ADAPT | No tests; depends on llm.ts env config. |
| analysis.ts | 630 | Deterministic tokenisation, clustering, TF-IDF, story identity | analysis.test (41 tests) | KEEP | Pure, tested; note `minutesAfterFirst ?? 0` at 614. |
| attack-surface.ts | 307 | Cloudflare DoH resolve + Shodan InternetDB lookup | shodan-internetdb.test, recon.test | ADAPT | InternetDB is non-commercial (COLLECTORS row 6). |
| audio-events.ts | 130 | Types, gaps and grouping for YAMNet results | audio-events.test | KEEP | Pure. |
| audio-extract-client.ts | 197 | Web Audio decode → 16-bit PCM WAV | audio-extract.test | KEEP | Browser-only, tested. |
| audio-fingerprint-store.ts | 112 | Saved spectral fingerprints in localStorage | audio-fingerprint-store.test | ADAPT | Per-browser store. |
| audio-frequency.ts | 1,478 | FFT spectral analysis, onsets, harmonic ratio (pure) | audio-frequency.test (51), audio-fingerprint-store.test | KEEP | Pure, tested. |
| bookmark-store.ts | 197 | Live-monitoring shortlist in localStorage | bookmark-store.test | ADAPT | Per-browser store. |
| cases/case-analysis.ts | 609 | Grounded case Q&A over evidence with citation validation; server fn `llmAnalyseCaseGrounded` | none | ADAPT | No tests; LLM-bound. |
| cases/case-attach.ts | 285 | Merge collector results into a case's graph/timeline snapshots | none | ADAPT | Used only by osint/verification.ts; no route wires it. |
| cases/case-claims.ts | 188 | Project MEDIAINT claims onto a case | none | KEEP | Pure; untested. |
| cases/case-context.ts | 495 | Build the context object a case analysis reasons over | none | ADAPT | Reads localStorage snapshots. |
| cases/case-contradictions.ts | 302 | Case-level contradiction detection | none | KEEP | Pure; untested. |
| cases/case-delete.ts | 138 | Cascade-delete a case across localStorage stores | none | ADAPT | Store-bound. |
| cases/case-entities.ts | 169 | Resolved entities for a case | none | KEEP | Pure. |
| cases/case-geoint.ts | 335 | Attach GEOINT records to a case (snapshots) | none | ADAPT | Store-bound. |
| cases/case-intelligence-breakdown.ts | 464 | Per-discipline coverage breakdown | none | ADAPT | `geointHypotheses ?? 0` at 410 renders an unreported count as 0. |
| cases/case-report-build.ts | 229 | Build report sources from case snapshots | none | KEEP | Pure; untested. |
| cases/case-report.ts | 424 | Case report model and completeness counts | none | KEEP | Pure; untested. |
| cases/case-runs.ts | 387 | Join between cases and OSINT runs (localStorage) | none | ADAPT | Store-bound. |
| cases/case-scope.ts | 455 | Case-scoped snapshot keys, caps, eviction | none | ADAPT | Store-bound. |
| cases/case-snapshot-selection.ts | 185 | Which snapshot a page shows | none | KEEP | Pure. |
| cases/cross-intelligence.ts | 597 | Cross-discipline correlations | none | KEEP | Pure; untested. |
| cib.ts | 886 | Coordinated-inauthentic-behaviour signals (pure) | cib.test (84) | KEEP | Pure, tested, honest nulls. |
| client-ip.ts | 253 | Trusted-proxy client IP for rate limiting | client-ip.test, rate-limit-runtime.test | KEEP | Pure, tested. |
| collection-policy.ts | 330 | Legal-basis matrix per platform (cites DPDP Act 2023) | collection-policy.test | ADAPT | India-specific legal wording. |
| collector-health.ts | 462 | Live reachability probes for `/crawlers` | none | ADAPT | Probes Shodan/Reddit/etc.; no tests. |
| collectors/capability-report.ts | 82 | Server fn over `capabilityMatrix()` | none | KEEP | Thin wrapper. |
| collectors/errors.ts | 100 | Collector error model | collectors-errors.test | KEEP | |
| collectors/existing/crtsh.ts | 155 | Adapter over recon-sources crt.sh | collectors-existing-crtsh.test | ADAPT | Inherits the fallback misattribution (REPORT §4). |
| collectors/existing/dns.ts | 161 | Adapter over DoH resolution | collectors-existing-dns.test | KEEP | |
| collectors/existing/dorks.ts | 169 | Adapter over news-scope dorks | collectors-existing-dorks.test | ADAPT | Google News RSS terms UNKNOWN. |
| collectors/existing/index.ts | 50 | Registration list | none | KEEP | |
| collectors/existing/news.ts | 166 | Adapter over GDELT DOC | collectors-existing-news.test | KEEP | GDELT permits commercial use. |
| collectors/existing/rdap.ts | 230 | RDAP lookup adapter | collectors-existing-rdap.test | KEEP | |
| collectors/existing/shared.ts | 85 | Execution clock, error classification, normalize guard | none | KEEP | Message-sniffing classifier is approximate by its own admission. |
| collectors/existing/shodan-internetdb.ts | 181 | Adapter over InternetDB | collectors-existing-shodan-internetdb.test (1 failing) | DROP | Non-commercial source; test stale. |
| collectors/existing/social.ts | 250 | Adapter over Bluesky/Telegram/Reddit fetchers | collectors-existing-social.test, person-investigation-flow.test | ADAPT | Platform terms UNKNOWN. |
| collectors/existing/wayback.ts | 415 | Wayback CDX adapter | none | ADAPT | Untested; terms UNKNOWN. |
| collectors/external/index.ts | 45 | Registration list | none | KEEP | |
| collectors/external/ivre.ts | 415 | IVRE client behind scan-authorisation gate | collectors-external-ivre.test | ADAPT | GPL tool as separate process; env-global authorisation. |
| collectors/external/jina-reader.ts | 239 | r.jina.ai full-text extraction | collectors-external-jina-reader.test | ADAPT | Third-party SaaS, terms UNKNOWN. |
| collectors/external/searxng.ts | 321 | SearXNG client with Google News fallback | collectors-external-searxng.test (3 failing) | REWRITE | Fallback fabricates provenance ("Google Web Index") and hides missing config. |
| collectors/external/sherlock.ts | 459 | Client for a Sherlock worker | none | DROP | No worker exists anywhere in the repo. |
| collectors/external/spiderfoot.ts | 377 | SpiderFoot scan start/poll/results | collectors-external-spiderfoot.test | ADAPT | Endpoint names never validated live (repo's own words). |
| collectors/external/theharvester.ts | 370 | theHarvester worker client | collectors-external-theharvester.test | ADAPT | GPL worker; worker image installs a PyPI stub. |
| collectors/index.ts | 12 | Barrel | none | KEEP | |
| collectors/passive-policy.ts | 203 | Passive-only enforcement and capability matrix | none | KEEP | Fail-closed; untested. |
| collectors/person/contact-domain.ts | 184 | Tech-stack fingerprint by fetching the target site | collectors-person-contact-domain.test | ADAPT | Contacts the target while declared passive. |
| collectors/person/contact-email.ts | 524 | Syntax, MX, Gravatar, GitHub commit search, OpenPGP | collectors-person-contact-email.test | ADAPT | Five failure paths return null (indistinguishable from "not found"). |
| collectors/person/contact-hibp.ts | 182 | HIBP breach flag | collectors-person-contact-hibp.test | ADAPT | Paid key; attribution + AUP obligations. |
| collectors/person/contact-phone.ts | 134 | libphonenumber metadata, no network | collectors-person-contact-phone.test | KEEP | |
| collectors/person/identity-websearch.ts | 406 | Brave search + readability + LLM | collectors-person-identity-websearch.test, person-investigation-flow.test | ADAPT | Brave terms UNKNOWN. |
| collectors/person/index.ts | 90 | Registration gated by `PERSON_INVESTIGATION_ENABLED` | collectors-person-index.test | KEEP | |
| collectors/person/presence-image.ts | 107 | HEAD request for a GitHub avatar | presence-image.test (3 failing), person-investigation-flow.test (1 failing) | REWRITE | Swallows failure as `completed`; emits invalid entity type `"media"` (the `tsc` error); contradicts its own tests. |
| collectors/person/presence-username.ts | 316 | Username sweep across GitHub/Reddit/HN/dev.to/Telegram/Medium | collectors-person-presence-username.test, person-investigation-flow.test | ADAPT | Platform terms UNKNOWN. |
| collectors/registry.ts | 58 | In-memory collector registry | 5 test files | KEEP | |
| collectors/result.ts | 430 | Common result model with zod schema | 11 test files | KEEP | The load-bearing contract. |
| collectors/types.ts | 207 | Collector contract, disciplines, capability model | 16 test files | KEEP | |
| credential-vault.ts | 1,383 | Provider registry, plaintext JSON vault, live verification probes, server fns | credential-vault.test (42), credential-exposure.test | ADAPT | Registry and probes reusable; file store and shared-token gate must be replaced (REPORT §5). |
| credibility-llm.ts | 132 | LLM linguistic-marker factor | credibility.test | ADAPT | LLM-bound. |
| credibility-profiles.ts | 164 | Weight profiles persisted to `./data/credibility-profiles.json` | none | ADAPT | Global server file. |
| credibility.ts | 982 | Seven-factor source credibility scoring (pure core) | credibility.test (43), analysis.test, cib.test, reports.test | KEEP | Pure core; the localStorage helpers at 225-971 need moving. |
| cyber-intel.ts | 69 | CISA KEV parser | none | DROP | 0 src importers, no tests. |
| demo-session.ts | 134 | Client-side demo login, password `admin@123` | demo-session.test | DROP | Not authentication by its own header. |
| dorks.ts | 326 | Dork templates; news-scope execution via Google News RSS | recon.test | ADAPT | Google terms UNKNOWN. |
| environmental-sources.ts | 110 | NASA EONET + NOAA SWPC fetchers (server fns) | environmental-sources.test | ADAPT | **Untracked in git.** |
| environmental.ts | 224 | Pure mapping of EONET/SWPC records | environmental.test | KEEP | **Untracked in git.** |
| evidence-store.ts | 295 | Evidence vault records in localStorage | evidence-store.test | ADAPT | Per-browser store. |
| evidence.ts | 71 | SHA-256 of a file (SubtleCrypto) | manual-evidence.test | KEEP | |
| file-handoff.ts | 29 | In-memory File hand-off between pages | none | KEEP | |
| file-provenance-client.ts | 1,797 | Browser layer for PDF/OOXML/ODF/video provenance | file-provenance-hidden-content.test, file-provenance-signature.test | KEEP | 60 `any` types; otherwise solid. |
| file-provenance.ts | 2,715 | Pure PDF/Office/video container forensics incl. CMS signature verification | file-provenance.test (152), file-provenance-hidden-content.test | KEEP | Largest tested pure module. |
| focal-point.ts | 100 | Spatio-temporal clustering | threat-classifier.test only | DROP | 0 src importers. |
| geo-sources.ts | 704 | GIS collectors: USGS, UCDP, GDELT DOC+Events, ReliefWeb, OpenSky, Nominatim | none | ADAPT | No tests; several source terms UNKNOWN. |
| geo.ts | 1,148 | Coordinate-honesty layer, record mappers | gis.test (42), reports.test, timeline.test, environmental.test, collectors-existing-news.test | ADAPT | Label fallbacks at 418, 487, 538, 765, 769, 889; **uncommitted edits**. |
| geoint/evidence.ts | 373 | GEOINT → collector evidence projection | none | KEEP | Pure. |
| geoint/geolocation-hypothesis.ts | 204 | Visual geolocation hypothesis model | none | ADAPT | `discoveredBy ?? "MANUAL_ASSISTED"` at 150. |
| geoint/image-match.ts | 265 | Reverse-image match model (hypothesis only) | none | KEEP | Pure. |
| geoint/metadata.ts | 244 | Metadata GEOINT (reads imaging.ts output) | none | KEEP | Pure. |
| geoint/providers.ts | 241 | Provider registry (link-outs only) | none | KEEP | |
| gps-interference.ts | 228 | GPSJam CSV processing | gps-interference.test, collector-health-gpsjam.test | ADAPT | Source licence UNKNOWN. |
| gpsjam-url.ts | 48 | Feed URL constant | none | KEEP | |
| graph-build.ts | 495 | Entity co-occurrence graph (deterministic) | graph-build.test (32), graph-view.test | KEEP | |
| graph-layout.ts | 289 | BFS-ring layout | graph-layout.test | KEEP | |
| graph-store.ts | 268 | Graph snapshots in localStorage (unscoped + case-scoped) | graph-store.test, graph-view.test | ADAPT | Per-browser store. |
| graph-view.ts | 455 | Unified view model for both graphs | graph-view.test | ADAPT | `e?.type ?? "person"` at 238 types unknown entities as people. |
| highlight.tsx | 47 | Query highlighting | highlight.test | KEEP | |
| image-sources.ts | 313 | GDELT/Wikipedia/Openverse image lists (server fns) | image-sources.test | ADAPT | Source terms UNKNOWN. |
| imaging-client.ts | 687 | Browser WASM: Tesseract, C2PA, video frames, image corpus | none | ADAPT | Depends on the deprecated `c2pa` package; corpus in localStorage. |
| imaging.ts | 1,284 | Pure EXIF/pHash/C2PA interpretation, `NOT_IMPLEMENTED` gaps | imaging.test (78), no-overclaims.test | KEEP | |
| investigations-store.ts | 348 | Case model and pinning in localStorage | investigations.test | ADAPT | Model is sound; storage is per-browser. |
| leaflet-client.ts | 326 | Self-hosted Leaflet; tile provider from `VITE_GIS_TILE_*` | none | ADAPT | Tile provider terms UNKNOWN. |
| live-filters.ts | 84 | Date-window predicate | live-filters.test | KEEP | |
| llm.ts | 824 | OpenAI-compatible client, zod-validated JSON, in-memory LRU cache and call log, 9 server fns | category-summary.test, credibility.test, operational-error.test | ADAPT | Design is good; cache/log are process memory; keys from env only. |
| local-id.ts | 26 | Collision-resistant ids without Math.random | none | KEEP | |
| local-network.ts | 660 | Executes PowerShell/netsh/ping/arp on the server host to scan its LAN | local-network.test | DROP | Unauthenticated server-side host scan; Windows-only; wrong layer for a hosted product. |
| maltego-export.ts | 128 | Entities/relationships → Maltego CSV | maltego-export.test | KEEP | |
| manual-evidence.ts | 279 | Analyst-attested capture model | manual-evidence.test | KEEP | |
| mediaint/claim-conflicts.ts | 168 | Claim conflict detection | none | KEEP | Pure; untested. |
| mediaint/claims.ts | 646 | Deterministic claim extraction | none | KEEP | Pure; untested. |
| news-aggregation.ts | 222 | Server-side multi-feed RSS reader | news-aggregation.test, timeline.test | ADAPT | Feed terms UNKNOWN; one of four RSS pipelines. |
| operational-error.ts | 300 | Sanitised error shape, correlation ids | operational-error.test, operator-auth.test, rate-limit-runtime.test | KEEP | `"no-id"` fallback at 121 is a label. |
| operator-auth.ts | 173 | Single shared operator token for vault writes | operator-auth.test | DROP | Not a user system by its own header; superseded by real auth. |
| osint-summary.ts | 210 | Pure summary for `/osint` | osint-summary.test | KEEP | |
| osint/contradictions.ts | 256 | Contradiction engine | none | KEEP | Pure. |
| osint/entity-resolution.ts | 296 | Cross-collector entity merge | osint-entity-resolution.test | KEEP | |
| osint/gaps.ts | 60 | Declared OSINT gaps (text) | none | ADAPT | Programme-specific wording. |
| osint/index.ts | 18 | Barrel | none | DROP | 0 importers. |
| osint/job-store-sqlite.ts | 266 | `bun:sqlite` job store | osint-job-store-sqlite.test | DROP | Unusable under the Node production runtime and under the dev server (documented in person-audit-store.ts and jobs.ts). |
| osint/job-store.ts | 174 | Job store interface + in-memory implementation | none (via osint-jobs.test) | KEEP | |
| osint/jobs.ts | 413 | Pollable jobs, 60 s outer cap, 3 server fns | osint-jobs.test | ADAPT | Process memory; no owner on jobs; cancellation cannot abort fetches. |
| osint/merge.ts | 95 | Exact-id dedupe | osint-merge.test | KEEP | |
| osint/orchestrator.ts | 170 | Synchronous run of a plan; `runOsintInvestigation` server fn | osint-orchestrator.test | ADAPT | No overall timeout; registers into the global registry. |
| osint/person-audit-store.ts | 81 | Append-only JSONL audit log | person-audit-store.test | ADAPT | One global file. |
| osint/person-investigation.ts | 395 | Feature flag, lawful-basis gate (DPDP), audit, seed entities; 3 server fns | person-audit-store.test, person-investigation-flow.test, person-investigation.test | ADAPT | Jurisdiction-specific gate; `readPersonInvestigationAuditServer` never called. |
| osint/person-query-planner.ts | 101 | Person dork planner | person-investigation-flow.test | DROP | 0 src importers. |
| osint/query-planner.ts | 133 | Target typing and collector selection | osint-query-planner.test | KEEP | |
| osint/timeline.ts | 389 | Evidence timeline (observed-at vs collected-at) | none | KEEP | Pure. |
| osint/verification.ts | 341 | End-to-end live verification run | none | ADAPT | Dev/QA tool exposed as a page; runs live collectors. |
| pdf-revocation-client.ts | 234 | OCSP/CRL via pkijs (browser) | pdf-revocation-e2e.test | KEEP | |
| pdf-revocation-server.ts | 102 | SSRF-guarded OCSP/CRL proxy server fn | pdf-revocation-e2e.test, pdf-revocation-server.test | KEEP | |
| pdf-revocation.ts | 82 | Result interpretation | pdf-revocation.test | KEEP | |
| radiation.ts | 138 | Safecast readings | none | ADAPT | No tests; Safecast is CC0. |
| rate-limit-runtime.ts | 192 | Process-wide limiter state and decision | rate-limit-runtime.test | ADAPT | In-process counters. |
| rate-limit-tiers.ts | 118 | Server-fn name → tier map | rate-limit.test | ADAPT | Name-keyed; lists dead functions. |
| rate-limit.ts | 537 | Sliding window + strike backoff (pure) | rate-limit.test, rate-limit-runtime.test | KEEP | |
| recon-sources.ts | 388 | crt.sh subdomains with HackerTarget/OTX fallback; `RECON_NOTES` | recon.test (2 failing) | REWRITE | Fallback rows mislabelled `source: "crtsh"`; fires on zero results. |
| report-pdf.ts | 355 | pdf-lib product renderer with classification banners | none | ADAPT | "UNCLASSIFIED" banner wording; untested. |
| reports.ts | 1,067 | Product generation with citation validation | reports.test (45), investigations.test | ADAPT | Good core; PS-18 wording in prompts/labels. |
| rss-source.ts | 94 | Recover publisher from Google News redirect | rss-source.test | KEEP | |
| scan-authorization.ts | 335 | Active-scan authorisation gate from `SCAN_AUTHORISATIONS` env | scan-authorization.test | ADAPT | Mechanism sound; env-global; IAF example wording. |
| search.ts | 303 | Shared query parser/matcher | search.test | KEEP | |
| security-headers.ts | 169 | CSP/HSTS/framing headers | security-headers.test | KEEP | |
| social-attach.ts | 61 | Direct-lookup posts → collector result | none | ADAPT | Only used by verification.ts. |
| social-credibility.ts | 300 | Social posts through Module 1 scoring | cib.test | KEEP | |
| social-velocity.ts | 149 | Velocity/spike engine | social-velocity.test | DROP | 0 src importers. |
| social.ts | 2,388 | Bluesky/Reddit/Mastodon/Telegram ingestion, Jetstream parsing, monitors, 9 server fns | 8 test files | ADAPT | Platform terms UNKNOWN; in-memory caches/tokens; `socialBlueskySearch`/`socialMastodonSearch` never called. |
| source-cache.ts | 67 | TTL cache for environmental sources | source-cache.test, environmental-ui.test | KEEP | **Untracked in git.** |
| supply-demand-sources.ts | 158 | Kpler client (paid) | none | ADAPT | Requires commercial subscription. |
| telegram-intel.ts | 96 | Telegram topic classifier | none | DROP | 0 src importers, no tests. |
| theme.ts | 37 | Theme preference | theme.test | KEEP | |
| threat-classifier.ts | 162 | Keyword taxonomy severity | threat-classifier.test | KEEP | Deterministic; labelled as such. |
| timeline-store.ts | 182 | Timeline snapshots in localStorage | none | ADAPT | Per-browser store. |
| timeline.ts | 71 | Chronology from real records | timeline.test | KEEP | |
| transcription.ts | 393 | Sarvam speech-to-text (sync + job API) | transcription.test | ADAPT | Single-vendor; `"upload.bin"` default at 226. |
| validation.ts | 372 | Runtime input contracts for server fns | validation.test (30), operational-error.test | KEEP | |
| vehicle-osint.ts | 412 | Indian RTO tables, NHTSA VIN, DuckDuckGo scrape | vehicle-osint.test | REWRITE | Fabricated make/fuel/class/source fields (393-404); India-specific. |
| watchlist-store.ts | 418 | Watchlists in localStorage, seeded `[SAMPLE]` entries | watchlist-store.test, watchlist-timeline.test | ADAPT | Seeded fictional organisations written on first load (59-88, 144-149). |
| youtube-collector.ts | 1,247 | InnerTube metadata/captions/search/download URL, Data API comments, 5 server fns | youtube-collector.test (29) | ADAPT | Data API path is fine; InnerTube and download conflict with YouTube ToS (COLLECTORS row 47). |

## 2. `src/routes/` (33 files, 28,306 lines)

Every route except `login.tsx` is linked from the sidebar in `src/components/app-shell.tsx:108-175`; every sidebar link resolves to an existing file. Route files cannot be imported by `bun test` (they call `createFileRoute` at load), so none has direct tests except `news.tsx`, whose pure helper `generateHandleVariations` is imported by `tests/social-agent-search.test.ts`.

| Path | Lines | What it does | Server fns defined here | Tests | Verdict | Reason |
|---|---|---|---|---|---|---|
| __root.tsx | 216 | Root layout, head, theme script, `DemoGate` redirect to /login | 0 | none | ADAPT | Gate is client-side only (150-155). |
| agents.tsx | 1,017 | "AI Assistant": 13 capability buttons over case metadata; grounded Q&A; pin briefing | 0 | none | ADAPT | Synthetic console log lines (375-383), invented prompt context (442, 468); 12 of 13 capabilities are metadata-only. |
| alerts.tsx | 117 | Static explanation that no alert pipeline exists | 0 | none | DROP | Stub. |
| crawlers.tsx | 329 | Collector reachability probe + capability matrix | 0 | none | ADAPT | Real probes; probes non-commercial endpoints. |
| entities.tsx | 533 | News corpus → LLM entity extraction → aggregation | 0 | none | ADAPT | Depends on global target default. |
| exports.tsx | 376 | Export stored products as PDF/MD/JSON/CSV | 0 | none | ADAPT | Reads `sentinel_products` localStorage. |
| gis.tsx | 1,149 | Leaflet map of GIS layers, EONET, Kpler, EXIF images, timeline | 0 | none | ADAPT | **Uncommitted edits**; consent-gated tiles. |
| graph.tsx | 1,231 | Knowledge graph: investigation snapshots or article co-occurrence; Maltego export | 0 | none | ADAPT | Store-bound. |
| images.tsx | 1,834 | Related images, upload analysis (EXIF/pHash/C2PA/OCR), GEOINT panel, AI panel | 0 | none | ADAPT | Very large route; pin path exists. |
| index.tsx | 1,254 | Dashboard: target search, tiles, executive brief, module cards | 0 | none | ADAPT | Starts on "GOOGLE.COM" (197-198, 726); static "LIVE GENERATION" badge (943); module descriptions claim uncomputed capabilities (106, 130). |
| investigations.tsx | 947 | Case workspace: create, panels, product generation, notes, cascade delete | 0 | none | ADAPT | Owns the localStorage case model. |
| live.tsx | 843 | One Google News feed polled every 25 s, drip-revealed as a "live" stream | 1 (`fetchLiveMonitoring`) | none | REWRITE | Default query "ISRO Chandrayaan" (36); failures returned as empty (121-124); every non-positive item tagged "alert" (113). |
| login.tsx | 293 | Client-side demo sign-in, credentials printed on screen | 0 | none | DROP | Not authentication; footer falsely claims activity is logged (275-276). |
| network.tsx | 500 | Bluesky account maturity + CIB clustering | 0 | none | ADAPT | Synthetic empty post fed to maturity signal (123-140). |
| news.tsx | 2,402 | Six server functions (news, reviews, OSINT profile, search, social sweep, media) plus the News page | 6 (`fetchNews`, `fetchReviews`, `fetchOSINT`, `fetchSearchIntelligence`, `fetchSocialIntelligence`, `fetchMediaIntelligence`) | social-agent-search.test (one helper) | REWRITE | Backend logic inside a route file; three of six server fns never called; many fabricated defaults (REPORT §4). |
| osint-verification.tsx | 137 | Button that runs the live verification suite | 1 | none | DROP | Developer tool exposed as a page. |
| osint.tsx | 2,900 | Six server functions (cyber threats, Telegram, GPSJam, radiation, geopolitical, RSS) plus tabs incl. Person Investigation | 6 | none | REWRITE | Backend in a route file; "100% Live Keyless OSINT" (1845); hard-coded Telegram channels (330); full-globe OpenSky (557). |
| profile.tsx | 138 | Shows the demo session; "Not available in this build" panel | 0 | none | DROP | Stub over fake session. |
| recon.tsx | 1,511 | Investigation panel, attack surface, subdomains, dorks, LAN scan, vehicle lookup | 0 | none | ADAPT | Investigation/dork panels usable; LAN and vehicle panels should go. |
| reports.tsx | 1,457 | Subject/case report generation with source budget | 0 | none | ADAPT | Products saved only to localStorage. |
| sentiment.tsx | 457 | Volume-per-day and per-article LLM sentiment | 0 | none | ADAPT | `category || "general"` (133). |
| settings.tsx | 828 | Credential vault UI; defines `getCredentials`/`saveCredentials`/`credentialAuthStatus` | 3 | none | ADAPT | Two of its three server fns are never called. |
| social.tsx | 1,726 | "Agent scraper" tab over `fetchSocialIntelligence`; Bluesky firehose tab, monitors, CIB, manual capture | 0 | none | REWRITE | Hard-coded "Active Agent Vault: Instagram (@akhil_agent_ai) / Facebook (Uno AI)" badges (672-682); invented `Likes ?? 12`/`Shares ?? 3` (873-874); header claims Instagram/Facebook/X ingestion (591). |
| sources.tsx | 790 | Credibility workbench with weights, overrides, profiles | 0 | none | ADAPT | Profiles in a global server file. |
| subjects.tsx | 625 | Watchlist "matching" against four fixed feeds | 0 | none | REWRITE | Corpus is the fixed queries "intel", "threat", "c2", "OSINT" (83-86), unrelated to the watchlist. |
| tasks.tsx | 686 | "PS18 Compliance Console" with self-test | 0 | none | DROP | Programme-specific; Module 3/4 tabs are static "Not Implemented". |
| threats.tsx | 78 | Static "no threat index" text | 0 | none | DROP | Stub. |
| timeline.tsx | 469 | Evidence timeline from snapshots; case activity log | 0 | none | ADAPT | Store-bound. |
| trends.tsx | 307 | TF-IDF terms, widest clusters, language mix | 0 | none | ADAPT | Honest; global target. |
| vault.tsx | 837 | Evidence vault with SHA-256, case link, export | 0 | none | ADAPT | Per-browser store; "up to 50MB" claim without a check (450). |
| videos.tsx | 970 | Keyframes, pHash, OCR, Sarvam transcription, audio panels | 0 | none | ADAPT | Solid browser-side analysis; vendor-bound transcription. |
| watchlists.tsx | 283 | Watchlist CRUD with sample banner | 0 | none | ADAPT | Seeded samples. |
| youtube.tsx | 1,066 | Metadata, embed, download link, captions, translation, report, comments | 0 | none | ADAPT | ToS exposure via InnerTube; 720p naming for a 360p artifact (359, 364, 710-711). |

## 3. `app/` — Python YouTube service (586 lines + 47 test lines)

| Path | Lines | What it does | Tests | Verdict | Reason |
|---|---|---|---|---|---|
| app/main.py | 50 | FastAPI app, CORS `*` with credentials, exception handlers, `/health` | tests_py (indirect) | DROP | Nothing in `src/` calls this service; CORS misconfigured. |
| app/config.py | 21 | Download dir (`data/youtube_downloads`), ffmpeg path | — | DROP | |
| app/routers/youtube.py | 92 | `/osint/youtube/metadata`, `/subtitles`, `/download` | — | DROP | Provenance always says `yt-dlp` even for the oEmbed fallback (23-28). |
| app/schemas/youtube.py | 76 | Pydantic models | — | DROP | Same shapes as the TS types. |
| app/collectors/youtube.py | 343 | yt-dlp metadata/subtitles/download; oEmbed fallback | tests_py/test_youtube.py (5 tests, pass; one hits live YouTube) | DROP | oEmbed fallback fabricates a caption track and thumbnail size (151-163); download to disk conflicts with YouTube ToS; redundant with `src/utils/youtube-collector.ts` (REPORT question 1). |
| app/__init__.py, collectors/__init__.py, routers/__init__.py, schemas/__init__.py | 0-4 | Package markers | — | DROP | |
| tests_py/test_youtube.py | 47 | URL validation, VTT parsing, live invalid-id | — | DROP with the service | |

## 4. `ai-service/` — Python vision/forensics service (app 1,537 lines; tests 947; scripts 469)

| Path | Lines | What it does | Tests | Verdict | Reason |
|---|---|---|---|---|---|
| app/main.py | 286 | FastAPI endpoints: detect, faces, ocr, ocr/vlm, forensics, phash/compare, audio/events, describe, stats, health; 501 stubs for video/transcribe/translate/chat | test_skeleton.py | ADAPT | No authentication; CORS allowlist from env; four stub endpoints. |
| app/config.py | 55 | pydantic-settings (device, thresholds, CORS, TESSDATA_PREFIX) | — | KEEP | |
| app/errors.py | 48 | Typed JSON error envelopes | test_skeleton.py | KEEP | |
| app/stats.py | 28 | In-process call counter | test_skeleton.py | KEEP | Trivial; lost on restart by design. |
| app/loaders.py | 213 | Load-once registry for Grounding DINO, Florence-2, InsightFace, YAMNet, Tesseract | fixtures in tests | ADAPT | InsightFace models are non-commercial; `whisper`/`llm` entries are permanent stubs. |
| app/schemas.py | 174 | Pydantic response models | — | KEEP | |
| app/forensics.py | 179 | EXIF (piexif), DCT pHash, C2PA best-effort | test_forensics.py | KEEP | Pure; `_rational_to_float` returns 0.0 on a zero denominator (19). |
| app/detect.py | 85 | Grounding DINO per-prompt detection | test_detect.py | KEEP | Documented false-positive limitation must stay in the UI. |
| app/faces.py | 81 | InsightFace detection + 1:N match against caller-supplied references | test_faces.py (fixtures gitignored) | REWRITE | Model licence blocks commercial use; logic itself is small. |
| app/ocr.py | 40 | Tesseract via pytesseract | test_ocr.py | KEEP | |
| app/ocr_vlm.py | 66 | Florence-2 `<OCR>` task | test_ocr_vlm.py | ADAPT | Florence-2 licence not verified; `trust_remote_code=True`. |
| app/describe.py | 52 | Florence-2 captioning | test_describe.py | ADAPT | Same. |
| app/audio_events.py | 229 | YAMNet windows → merged intervals, coverage, closest-below-threshold | test_audio_events.py | KEEP | Honest framing; pure given the session. |
| app/__init__.py | 0 | | | KEEP | |
| tests/ (8 files, 947 lines) + fixtures | | Skeleton, forensics, detect, faces, ocr, ocr_vlm, describe, audio | — | ADAPT | Could not be run here (Python 3.9, no torch/pytesseract); two face fixtures are gitignored for rights reasons. |
| scripts/vendor_yamnet.py + yamnet_src/* | 469 | One-time TF→ONNX conversion of Google's YAMNet | — | KEEP | Vendored Apache-2.0 source. |
| Dockerfile, docker-compose.yml, .env.example | | CUDA 12.1 image on Python 3.11; optional GPU reservation | — | ADAPT | |

## 5. Other top-level code (for completeness)

| Path | Lines | What it is | Verdict | Reason |
|---|---|---|---|---|
| src/components/*.tsx (non-ui) | 9,194 | App shell, case panels, AI panel, GEOINT panel, pin button, etc. | ADAPT | Not line-audited beyond what REPORT.md cites; `report-blocks.tsx` has no importer (DROP). |
| src/components/ui/*.tsx | 4,377 | Vendored shadcn primitives (46) | KEEP | |
| src/i18n/ | 5,733 | 15 Indian-language dictionaries + English, DOM translation | ADAPT | Language set is programme-specific. |
| src/types/core.ts, core-adapters.ts | 658 | "Frozen" inter-developer contracts with zod | KEEP | The freeze itself was a programme arrangement. |
| src/data/geo-map.ts | 2,796 | Undersea cables, nuclear facilities, economic centres (coordinates) | ADAPT | Provenance and licence undocumented. |
| src/server.ts, src/start.ts, src/router.tsx | 70 / 132 / 16 | SSR entry with security headers; CSRF, sanitiser and rate-limit middleware | KEEP | |
| src/lib/error-capture.ts, error-page.ts, utils.ts | 63 | Error page plumbing | KEEP | |
| scripts/agent-scraper.js, scripts/agent_scraper.py | 160 / 218 | Instagram/Facebook "scraper agents" that invent posts and engagement | DROP | Documented as deleted on 2026-08-10 but still present. |
| scripts/check-exports.ts, fabrication-check.ts, smoke.mjs, dead-controls.mjs, verify-osint.ts | 876 | Repo gates and browser smoke tools | KEEP | fabrication-check currently fails (136 matches). |
| eslint-rules/no-fabricated-fallback.js | 514 | Custom lint rule for fabrication patterns | KEEP | |
| osint-workers/ | 283 | Compose stack: SpiderFoot, theHarvester wrapper, SearXNG, IVRE+MongoDB | ADAPT | Licence and stub-install issues (COLLECTORS rows 9-13). |
| docs/ (6 files, 4,359 lines) + PROJECT_MEMORY.md (404 KB) + ANTIGRAVITY_TASK.md + CLAUDE.md | | Plans, decision logs, AI-session protocols | DROP as product docs | Historical; several statements contradict the code (REPORT §3). |

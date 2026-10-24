# 05 — Collectors, Scrapers & Data Sources

Scope: `packages/collectors`. Evidence is `file:line`.

---

## 1. Collector SDK

A collector is a `CollectorDeclaration` (`contract.ts:24-57`): `id`, `version` (recorded on every evidence row), `displayName` (**the** human source label), `discipline`, `targetTypes`, `collectionMode`, `source` (catalogue id of its one upstream), `credentials`, `claimStrength` (OBSERVED/REPORTED/DERIVED), `timeoutMs`, `resultSchema` (Zod), optional `emptyAnswersUnreliable`. There is deliberately **no source-label field** — the label comes from the registry entry, not the collector.

The implementation is `(RunContext) => Promise<CollectorReturn>` (`contract.ts:133-135`). `RunContext` hands the collector only `target`, `credentials`, a source-bound `fetch`, an `AbortSignal`, and the legal return constructors `found()/notFound()/emptyUnconfirmed()/record()`. `CollectorReturn` is **branded with a module-private symbol** so a collector cannot fabricate a return; implementations are stashed in a module-private `WeakMap` and never exported from the package entry (`contract.ts:146-196`, `index.ts:1-6`). A **BLOCKED** collector's implementation is discarded and never stored (`registry.ts:354-356`) — no code path can run it.

The **registry** (`registry.ts:170-389`) validates the whole set at construction: unique source/collector ids and **unique displayName labels** (evidence sources must be distinguishable, `:198-205`), that each collector reaches its source only via a method the source declares, that a vault id belongs to exactly one source, claimStrength↔mode coupling (DERIVED iff LOCAL_ANALYSIS), and that every non-local result schema has a top-level `derived` block. Availability is computed as `AVAILABLE | UNVERIFIED | BLOCKED | NOT_IMPLEMENTED`; the runtime runs **only AVAILABLE** (`runtime.ts:290-301`).

---

## 2. The registry — what actually ships

- **~268 catalogue sources** (`catalogue.ts`), most declared only so they appear with a licence verdict (no collector).
- **231 registered collectors**: 14 named + 217 RSS.
- **Only 3 are runnable (AVAILABLE / PERMITTED):** `contact.phone` (local-only), `wikidata`, `news` (GDELT). All others are **UNVERIFIED** — code-complete but frozen off until an owner records licence terms (the intended default-deny posture). None registered is BLOCKED or NOT_IMPLEMENTED.

### 14 named collectors

| id | label (= evidence source) | source | discipline | mode | person? | avail |
|---|---|---|---|---|---|---|
| `contact.phone` | Phone number analysis (libphonenumber) | libphonenumber-js | PERSON | LOCAL_ANALYSIS | **yes (PERSON)** | **AVAILABLE** |
| `wikidata` | Wikidata entity search | wikidata | SOCMINT | PASSIVE_API | no | **AVAILABLE** |
| `news` | GDELT news coverage | gdelt-doc | — | PASSIVE_API | **when target=TOPIC** | **AVAILABLE** |
| `crtsh` | crt.sh Certificate Transparency | crtsh | TECHINT | PASSIVE_API | no | UNVERIFIED |
| `dns` | DNS over HTTPS (Cloudflare) | cloudflare-doh | TECHINT | PASSIVE_API | no | UNVERIFIED |
| `rdap` | RDAP registration data | rdap | TECHINT | PASSIVE_API | no | UNVERIFIED |
| `wayback` | Wayback Machine captures | wayback-cdx | MEDIAINT | PASSIVE_DATASET | no | UNVERIFIED |
| `github` | GitHub public profile | github-api | SOCMINT | PASSIVE_API | no | UNVERIFIED |
| `hackernews` | Hacker News account (HN API + Algolia) | hacker-news | SOCMINT | PASSIVE_API | no | UNVERIFIED |
| `devto` | DEV Community profile | devto | SOCMINT | PASSIVE_API | no | UNVERIFIED |
| `commoncrawl` | Common Crawl URL index | commoncrawl | TECHINT | PASSIVE_API | no | UNVERIFIED |
| `bluesky.search` | Bluesky post search | bluesky | SOCMINT | PASSIVE_API | person (TOPIC) | UNVERIFIED |
| `reddit.search` | Reddit post search | reddit-api | SOCMINT | PASSIVE_API | person (TOPIC) | UNVERIFIED |
| `article` | Direct article fetch | direct-article | MEDIAINT | **ACTIVE** | no | UNVERIFIED |

### 217 RSS collectors
Generated from `RSS_PUBLISHERS` (`data/rss-feeds.ts`, 217 publishers / 239 feeds). Uniformly discipline MEDIAINT, target TOPIC, mode PASSIVE_PUBLIC_WEB, OBSERVED, `emptyAnswersUnreliable:true`, no credential, licence UNVERIFIED (so never run in a deployment) and person-gated because the target is always TOPIC.

### Declared-but-no-collector (listing/verdict only)
13 BLOCKED (e.g. `c2intelfeeds` CC-BY-NC-SA, `insightface-buffalo-l`, `youtube-*`, `duckduckgo-html`, `local-network-scan`, `google-news-rss`, `hackertarget`, `alienvault-otx`, `ucdp`, `reliefweb`, `opensky`); ~31 other UNVERIFIED (hibp, brave-search, nominatim, wikipedia, youtube-data-api, theharvester, spiderfoot, searxng, ivre, …); and 2 PERMITTED-but-unwired (`gdelt-events`, `safecast`).

**Person classification:** only discipline `PERSON` → the plan+vetting-gated `PERSON_INVESTIGATION` module; additionally any collector run on a `TOPIC` target is person-gated whatever its discipline (`PERSON_TARGET_TYPES = ["TOPIC"]`). Note USERNAME/EMAIL/PHONE are **not** person target types today — only TOPIC.

---

## 3. The outbound fetcher / SSRF protection (`src/fetcher`)

The **single** egress path (`createUpstreamFetch` → `fetcher.ts:231-454`); the only place a socket opens. A collector's `ctx.fetch` is bound to it, per source. Controls:

1. **Pre-send + per-redirect destination check** (`destination.ts:15-48`, called at `fetcher.ts:417` and each redirect `:440`): rejects non-URLs, wrong scheme (must equal the source's declared protocol), URL userinfo (credentials-in-URL), host not in the **exact-hostname** allowlist (IP literals never match a DNS allowlist), forbidden platform domains, and any explicit port.
2. **DNS resolution + anti-rebinding** (`fetcher.ts:307-332`): resolves the host and **refuses outright if any answer is non-public** ("a mixed answer is how DNS rebinding looks"); the connection is then **pinned to the exact checked address** with `agent: undefined` so Node can't take a second path; TLS still verifies against the declared host. No TOCTOU gap.
3. **Private/metadata/reserved IP blocking** (`address.ts`): IPv4 `NON_PUBLIC_V4` covers 0/8, 10/8, 100.64/10 (CGNAT incl. Alibaba `100.100.100.200`), 127/8, **169.254/16 (AWS/GCP metadata 169.254.169.254)**, 172.16/12, 192.0.0/24, TEST-NETs, 6to4 anycast, 192.168/16, multicast, reserved/broadcast; IPv6 permits only global unicast 2000::/3 and refuses ULA `fc00::/7` (incl. `fd00:ec2::254`) and link-local. Parsing is strict/canonical; decimal/hex/octal IP forms and zone-ids are caught (fail closed).
4. **Redirect cap** `MAX_REDIRECTS=5`, GET/HEAD only, each to a re-checked URL.
5. **Header hardening** (forbidden/collector-set headers rejected, control chars rejected, Host/UA/Accept-Encoding forced) + **size cap** (default 5 MiB, max 50 MiB, enforced during streaming and decompression → decompression-bomb guard).
6. **Rate limiter fails closed** (`RateLimiterUnavailableError`).
7. **Forbidden platforms** (Instagram/Facebook/X + CDNs): `FORBIDDEN_PLATFORM_DOMAINS` (`source.ts:137-154`) enforced at declaration *and* as a fetch-time backstop, including open-host.

**Minor notes:** `http` is allowed only if a source declares it — none does (all https). The allowlist is exact-hostname (strict/safe); the RDAP redirect set depends on the IANA bootstrap snapshot being complete (**UNKNOWN — requires runtime access** whether current). URL secret-scrubbing only redacts secrets ≥4 chars (`fetcher.ts:257`) — a very short credential in a captured URL would not be redacted (minor).

---

## 4. Target detection (`src/target.ts`)

`parseTarget(type, raw)` trims, rejects empty / >2048 chars, normalises per type, throws `InvalidTargetError` whose message never repeats the value. DOMAIN (bare or URL host, IDN→ASCII, IP rejected), IP_ADDRESS, EMAIL_ADDRESS, PHONE_NUMBER (**E.164 regex, not libphonenumber** — that's used only inside `contact.phone`), USERNAME (Unicode), ORGANIZATION/TOPIC (free text), URL (http(s), no userinfo), FILE (`sha256:…`). Interactive type *detection* (offering alternates) lives in `@repo/core/target-detection.ts`.

---

## 5. Article extraction (`src/platform/article-extract.ts`)

Pure, dependency-free, **no network**. `extractArticle(html)` returns `{title, publishedAt, author, language, text, status}` via a single-forward-pass regex parser (explicitly no DOM library / no backtracking). It **strips `script/style/noscript/template/svg/head` wholesale** then keeps only text from `p/h1-3/li/blockquote`; dates come only from stated fields (strict `Date.parse`, else null — never collection time); entity decoding rejects surrogate/overlong code points. It extracts text, it does **not** sanitise for re-display; nothing is executed or fetched. In the `article` collector, all extractor output is placed under `derived` (a DERIVED claim); only the raw `<title>` is a REPORTED value. Any LLM handling of this text is downstream in `packages/llm` (delimited/validated).

---

## 6. Source labelling (CLAUDE.md "Source labelling") — structurally enforced

Evidence label = the registry entry's `displayName`; there is no label field in the declaration, and labels must be unique across collectors. A collector's `source` is a single catalogue id, and its label must name **every operator** of the hosts it reads (why the HN label names both YC and Algolia). **A fallback is a distinct registered collector/source** — `ctx.fetch` can reach only the collector's own source's hosts, so a different provider is a different `SourceDeclaration` with its own id/licence/operator and a different label. The crt.sh rewrite note records that the legacy code silently queried two other upstreams under crt.sh's name and that "there is no fallback here, and none can be added" (`crtsh.ts:16-23`).

---

## 7. Collection safety (CLAUDE.md §3)

- **No Instagram/Facebook/X scrapers** — confirmed; the only matches for those hosts are the denylist and the `twitter_username` *data field* returned by GitHub/dev.to APIs (reported, not contacted). The 217-publisher RSS list contains none of them.
- **No shell execution** — there is **no `child_process`/`exec`/shell call anywhere** in `packages/collectors/src`; targets are passed only via `URLSearchParams`/`encodeURIComponent`. The CLAUDE.md "targets to tool containers as args" rule has no in-repo container execution yet (tool containers are deferred — `theharvester/spiderfoot/searxng/ivre/local-network-scan` are declared sources with no code).
- **Active-scan scope authorisation enforced** — only `article` is ACTIVE; `runtime.admit` refuses it without an in-force `scopeAuthorisation` matching the exact target type+value (`runtime.ts:412-421`). Everything else is passive and never contacts the target.

---

## 8. The news-providers research doc

`Vestigo_Global_News_Providers_and_APIs.md` (519 lines, 2026-10-21) is an **explicitly aspirational** catalog ("a broad starting catalog, not a guarantee… Verify all URLs, access conditions, and licenses before integration"). **Wired in code:** GDELT DOC 2.0 (`news`), Common Crawl, Wayback, Wikidata, and many of its §11 RSS endpoints (as UNVERIFIED RSS collectors). **Documented only / not wired:** GDELT Cloud, NewsAPI.org, The News API, World News API, Mediastack, Currents, Event Registry, AYLIEN, Webz.io, LexisNexis/Factiva/Meltwater, Google Fact Check API, Media Cloud, Europeana, LoC, Bing/Google News API, and all licensed wire agencies (Reuters/AP/AFP/Bloomberg/…). Google News is explicitly **BLOCKED**. The doc's example evidence JSON is illustrative; the real shapes are the per-collector Zod schemas.

---

## 9. Provenance & anti-fabrication in collection

Absent values are `null` (never placeholders/0); dates come only from stated fields; computed values are forced under a `derived` block checked by a provenance "unread value" scan; `isEmptyResult` forbids an empty FOUND; GDELT/RSS/Bluesky/Reddit set `emptyAnswersUnreliable:true` so an empty answer is `EMPTY_UNCONFIRMED`, never a zero. **Evidence can only cite responses captured by the fetcher for *this run*** (branded captures, checked in `runtime.#check`). Each rewritten collector's header lists the exact legacy fabrication defect it fixes. No `TODO`/`FIXME`/stub returning fake data was found in `packages/collectors/src`.

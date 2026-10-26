# Collector review — current catalogue (Vestigo)

Date: 2026-10-21. Scope: the CURRENT Vestigo catalogue and registry (`packages/collectors`), not the legacy V2 audit in [COLLECTORS.md](COLLECTORS.md) (a different repository). Method: read from code only, with `file:line` references. **No verdict was changed by producing this review** — a verdict is an owner decision made by reading a source's terms and recording `audited(row, url)` in `catalogue.ts`; this document only states the current status and the next action each source needs. Verdicts remain fail-closed: `UNVERIFIED` and `BLOCKED` never run, in any environment.

## How admission works (so the table reads correctly)

Runtime refusal order (`packages/collectors/src/runtime.ts` `#refusal`): **licence first** — `BLOCKED` → `LICENCE_BLOCKED`; `UNVERIFIED` (not a test replay) → `UNVERIFIED_SOURCE_NOT_ALLOWED`; then no enabled access method → `ACCESS_METHOD_NOT_ENABLED`; then no implementation → `NOT_IMPLEMENTED`. Only `PERMITTED` runs. Default enabled methods are `open, official, licensed` (never `operator`), so `ACCESS_METHOD_NOT_ENABLED` never fires by default; the operative exclusions are the licence verdict and "no collector". A `TOPIC` target is person data whatever the collector (`PERSON_TARGET_TYPES = ["TOPIC"]`), so a topic run needs the person module + approved vetting. No shipped collector is `ACTIVE` (so no scope-authorisation gate is triggered by the shipped set).

**Headline:** of 14 registered collectors, only **3 run by default** (their source is `PERMITTED`): `wikidata`, `news` (gdelt-doc), `contact.phone`. Eight more are fully implemented with real fusion extractors but gated by an `UNVERIFIED` verdict; three (`bluesky.search`, `reddit.search`, RSS) are gated *and* have "checked-only" extractors (draw nothing even if un-gated).

## A. Registered collectors (the backlog)

| Collector id | Source | Impl path | Verdict | Access | Targets | Extractor | Runs by default? | Exclusion reason | Creds / infra | Source-policy review needed | Recommended next action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| wikidata | wikidata | platform/wikidata.ts | PERMITTED | open | ORGANIZATION | real | **yes** | — | none | done | none — runs |
| news | gdelt-doc | platform/news.ts | PERMITTED | open | DOMAIN, TOPIC | real (Day 2) | **yes** (TOPIC person-gated) | — | none | done (GDELT allows commercial use, cite on redistribution) | none — runs; draws the article graph (Day 2) |
| contact.phone | libphonenumber-js | platform/contact-phone.ts | PERMITTED | open (local) | PHONE_NUMBER | real | **yes** (person-gated) | — | none (offline) | done | none — runs for a vetted person plan |
| crtsh | crtsh | platform/crtsh.ts | UNVERIFIED | open | DOMAIN | real | no | UNVERIFIED_SOURCE_NOT_ALLOWED | none | **yes** — read crt.sh / CT log terms | owner records verdict; then runs with no other change |
| dns | cloudflare-doh | platform/dns.ts | UNVERIFIED | open | DOMAIN | real | no | UNVERIFIED_SOURCE_NOT_ALLOWED | none | **yes** — Cloudflare public resolver terms | owner records verdict; then runs |
| rdap | rdap | platform/rdap.ts | UNVERIFIED | open | DOMAIN | real | no | UNVERIFIED_SOURCE_NOT_ALLOWED | none | **yes** — RDAP/registry terms | owner records verdict; then runs |
| wayback | wayback-cdx | platform/wayback.ts | UNVERIFIED | open | DOMAIN, URL | real | no | UNVERIFIED_SOURCE_NOT_ALLOWED | none | **yes** — archive.org terms | owner records verdict; then runs |
| commoncrawl | commoncrawl | platform/commoncrawl.ts | UNVERIFIED | open | DOMAIN | real | no | UNVERIFIED_SOURCE_NOT_ALLOWED | none | **yes** — Common Crawl terms (CC) | owner records verdict; then runs |
| github | github-api | platform/github.ts | UNVERIFIED | open/official | USERNAME | real | no | UNVERIFIED_SOURCE_NOT_ALLOWED | `github` vault id (optional; runsWithout) | **yes** — GitHub API terms | owner records verdict; runs keyless or with a tenant key |
| hackernews | hacker-news | platform/hackernews.ts | UNVERIFIED | open | USERNAME | real | no | UNVERIFIED_SOURCE_NOT_ALLOWED | none | **yes** — Y Combinator/Firebase HN API terms | owner records verdict; then runs |
| devto | devto | platform/devto.ts | UNVERIFIED | open | USERNAME | real | no | UNVERIFIED_SOURCE_NOT_ALLOWED | none | **yes** — Forem/DEV API terms | owner records verdict; then runs |
| bluesky.search | bluesky | platform/bluesky.ts | UNVERIFIED | open/official | TOPIC | **checked-only** | no | UNVERIFIED_SOURCE_NOT_ALLOWED | `bluesky` vault (optional) | **yes** — Bluesky API terms | verdict AND an item extractor (Track M) before it adds to the graph; keyless public search returned 403 (recorded) |
| reddit.search | reddit-api | platform/reddit.ts | UNVERIFIED | open/official | TOPIC | **checked-only** | no | UNVERIFIED_SOURCE_NOT_ALLOWED | `reddit-api` vault (optional) | **yes** — Reddit Data API terms (may end BLOCKED) | verdict AND an item extractor; highest licence risk |
| rss.&lt;publisher&gt; (×217) | rss.&lt;domain&gt; | platform/rss.ts, data/rss-feeds.ts | UNVERIFIED | open | TOPIC | **checked-only** | no | UNVERIFIED_SOURCE_NOT_ALLOWED | none | **yes** — per publisher | per-publisher verdict AND an item extractor (Track M) |

**"checked-only"** (`packages/osint-engine/src/fusion/extractors.ts`): the extractor validates the result and draws no entities/relationships/claims. So `bluesky.search`, `reddit.search` and RSS are doubly inert — gated by verdict *and* contributing nothing to fusion until Track M's item extractors land. Un-gating them alone would store evidence but not populate the graph.

## B. PERMITTED sources with no collector

| Source | Verdict | What it needs |
|---|---|---|
| gdelt-events | PERMITTED | only a collector + extractor (GEOINT events; would introduce LOCATION-entity handling). Verdict already allows it. |
| safecast | PERMITTED | only a collector + extractor (CC0 radiation readings). Verdict already allows it. |

These are the lowest-policy-risk candidates for a *new* collector (no verdict decision needed), but each is a new collector+extractor+fixtures (a Track-R slice), out of scope here.

## C. Catalogue-only and policy-blocked entries (§5 classification)

Classes: EXECUTABLE+WIRED · IMPLEMENTED+GATED · CATALOGUE-ONLY (source listed, no collector) · BLOCKED-BY-POLICY · ABSENT.

| Entry | Class | To become runnable |
|---|---|---|
| spiderfoot, theharvester, searxng, ivre | CATALOGUE-ONLY (`network: null`, "Phase 4") | a bounded adapter collector **and** an external container **and** a recorded verdict (GPL/AGPL review for theHarvester/SearXNG; IVRE scans are ACTIVE → scope-auth). See the adapter design in the implementation report. |
| hibp, brave-search, youtube-data-api | CATALOGUE-ONLY | a collector + an official API key (from the tenant vault) + a recorded verdict |
| jina-reader, gravatar, openpgp-keyserver, telegram-preview, usgs-earthquakes, nominatim, nasa-eonet, noaa-swpc, cisa-kev, feodo-tracker, wikipedia, openverse, nhtsa-vpic | CATALOGUE-ONLY | a collector + a recorded verdict (nominatim: self-host per OSMF policy) |
| kpler | CATALOGUE-ONLY | a collector + a **licensed** paid account + a recorded verdict |
| shodan-internetdb | BLOCKED-BY-POLICY | non-commercial only without an enterprise licence — stays blocked unless licensed |
| youtube-innertube, youtube-ytdlp, duckduckgo-html | BLOCKED-BY-POLICY | blocked by platform ToS — not to be un-blocked as a shortcut |
| local-network-scan | BLOCKED-BY-POLICY | active unauthorised host scan — stays blocked |
| google-news-rss | BLOCKED-BY-POLICY | undocumented Google feed — stays blocked (direct RSS publishers used instead) |
| c2intelfeeds, alienvault-otx, hackertarget, ucdp, reliefweb, opensky | BLOCKED-BY-POLICY | each needs its terms read and a verdict recorded before any collector is added (several are non-commercial or need an agreement/token) |
| (google) dorks | ABSENT | not in the current catalogue (legacy only) |

## Recommended activation order (owner-gated)

1. **Lowest-policy-risk, highest-value, zero new code:** record verdicts for the open, keyless, already-built TECHINT/SOCMINT collectors whose terms you confirm — `crtsh`, `dns` (cloudflare-doh), `rdap`, `wayback-cdx`, `commoncrawl`, `hacker-news`, `devto` (and `github-api`, keyless). Each flip to `PERMITTED` (one `audited(row, url)` line) makes a fully-tested collector run with a real fusion extractor — so a DOMAIN/USERNAME investigation gains a rich live graph with no engineering.
2. **Monitoring sources** (`bluesky`, `reddit`, RSS): need a verdict *and* Track M item extractors before they add to the graph.
3. **Tool containers / keyed / licensed / blocked sources:** defer to a dedicated phase (adapter + container + licence review, or leave blocked).

Nothing in this review authorises a verdict change; the owner records each one against the source's terms.

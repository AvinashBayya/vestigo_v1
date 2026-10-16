# Track M plan: social-media and news monitoring

M-0, 2026-10-13. A plan only: nothing is built by this stage. It turns the reference
capability (the kind of investigation [thedisinfolab.org](https://thedisinfolab.org/) publishes:
narrative tracking, cross-platform account and outlet networks, timelines, coordination signals,
source credibility) into a continuous, automatic pipeline inside Vestigo, reusing what the
platform already has and porting the legacy analysis that was scheduled as "R2" in
`docs/MASTER-BUILD-SEQUENCE.md`.

It rests on a full read of the current code (2026-10-11, at commit `d3baa8c`), on
`docs/reclamation/LEGACY-RECLAMATION-AUDIT.md` §4, and on the owner's four rulings below.
Every item that changes a rule, a package list, a vocabulary or a schema waits for the owner
(Decisions for the owner, §9).

## Owner's rulings (2026-10-13)

- **Roadmap:** Track M starts now, as its own track, alongside R1-c..f. It touches
  `packages/collectors`, a new pure package, `packages/osint-engine` job code, `packages/db`,
  `apps/api`, `apps/worker` and new web screens. It does not touch `packages/case-engine` or any
  R1 file.
- **Sources, first slice:** all eight: GDELT, RSS/Atom, Bluesky, Mastodon, Brave (web and
  news), Telegram public channels, Reddit Data API, YouTube Data API. Instagram, Facebook and X
  stay forbidden (CLAUDE.md §3).
- **Freshness:** scheduled polling, every 5–15 minutes, through the existing job system. The
  Bluesky live stream (Jetstream) is deferred to M7.
- **Analysis:** all three layers, in this order: deterministic scoring (credibility, coordination
  signals, spikes, story clustering), then the allow-listed open-weight LLM for text (cited
  summaries, entity and claim extraction, labelled classification), then embeddings in
  `pgvector` for cross-language narrative clustering. Each is its own slice (M4, M5, M6).

---

## 1. What exists, and what is missing

### Already built and reused as-is

| Capability | Where | How Track M uses it |
|---|---|---|
| Run → jobs → evidence → fusion → entities/relationships/claims | `packages/osint-engine/src/{runs,executor,fusion}`, `packages/db/src/schema/{work,evidence,entities}.ts` | **A monitor tick is a run.** Every tick creates a normal run, so collection, bulkheads, circuit breakers, retries, dead letters, metering, replay and the SSE progress stream all come for free. |
| Collector SDK, provenance rule, source labelling, SSRF-safe fetcher, per-source rate limit | `packages/collectors/src/{contract,runtime,provenance,fetcher}` | Every new source is one collector, declared the same way. |
| Source catalogue with licence verdicts | `packages/collectors/src/catalogue.ts` | `bluesky`, `reddit-api`, `telegram-preview`, `brave-search`, `youtube-data-api`, `gdelt-doc` are already declared. RSS and Mastodon are added. |
| GDELT collector (registered on Track M Day 2) | `packages/collectors/src/platform/news.ts` | Un-held for `DOMAIN` and `TOPIC` on Day 2, ahead of M2a: an empty answer is unconfirmed, after a canary that shows GDELT is up (§4.2, D-M4). |
| `monitors` and `alerts` tables + repositories | `packages/db/src/schema/operations.ts`, `repositories/operations.ts` | Extended, not replaced (§5). |
| Graph store and `/graph`, `/timeline` | `packages/core/src/graph.ts`, `packages/db/src/repositories/graph.ts`, `apps/api/src/routes/explore.ts` | Narratives, accounts, outlets and amplification edges appear in the existing graph. |
| Cytoscape graph tab | `apps/web/src/workspace/graph/CytoscapeGraph.tsx` | New edge kinds render without new graph code. |
| LLM provider, router, citation validator, guards, injection scanner, metering | `packages/llm/src/*` | The `extraction` and `classification` tasks exist with no caller; M5 is their first caller. |
| Credential vault + `/api/v1/credentials` | `packages/integrations/src/vault`, `apps/api/src/routes` | Brave, YouTube and Reddit keys are tenant credentials. No env variable, ever. |
| `usage_events`, `tenant_quotas` | `operations.ts` | Monitoring requests are metered per tenant; plan quotas cap them (M7). |
| Report pipeline and exports (PDF/JSON/CSV/Maltego) | `packages/osint-engine/src/reports`, `packages/integrations/src/exports` | A narrative report reuses it (M7). |
| `pgvector` extension | `infra/postgres/init/01-bootstrap.sql`, docker image | Installed, no column uses it. M6 adds the first. |

### Missing, and built by this track

- No way to watch a **topic**: `TARGET_TYPES` has no query/phrase/hashtag type.
- Collectors receive **no parameters** (`RunContext` has `target`, `credentials`, `fetch`,
  `signal` only; `jobs.params` is always `{}`), so there is no "since last check" or "this query".
- **No scheduler** of any kind: no repeatable jobs, no cron, no `setInterval`.
- No **content record**: posts and articles have no table; evidence is a raw payload.
- No **narrative**, **credibility**, **coordination**, **spike** or **embedding** concept
  anywhere in backend code (zero hits).
- No alert delivery, no monitoring UI, no credentials UI (the API exists; the web never calls it).

### Legacy modules this track ports (all REWRITE through the fabrication gate)

| Legacy | Lines | Into | Slice |
|---|---|---|---|
| `social.ts` §2 keyword monitors: `monitorMatches`, `bucketise`, `assessSpike`, `readMonitor` | ~190 | `packages/signal-engine/src/spike.ts`, `match.ts` | M3 |
| `social.ts` Bluesky AppView, Reddit OAuth, Telegram preview, Mastodon fetchers and `*ToPost` mappers | ~1,500 | one collector each in `packages/collectors/src/platform/` | M2 |
| `cib.ts` five signals + `CIB_CAVEAT` | 886 | `packages/signal-engine/src/cib/` | M4 |
| `credibility.ts`, `credibility-profiles.ts`, `social-credibility.ts` | ~1,450 | `packages/signal-engine/src/credibility/` | M4 |
| `credibility-llm.ts` (linguistic markers factor) | 132 | `packages/osint-engine` job calling `packages/llm` | M5 |
| `analysis.ts` story identity (tokens, title similarity, `clusterStories`) | 630 | `packages/signal-engine/src/stories.ts` | M4 |
| `analysis-llm.ts` | 364 | M5 prompts, through `packages/llm` only | M5 |
| `news-aggregation.ts` feed reader shape (per-feed status envelope) | 222 | `rss` collector | M2a |
| `threat-classifier.ts` | 162 | M5 classification labels, as a configurable taxonomy, defence taxonomy dropped | M5 |

Legacy's Jetstream consumer (`social.ts` §1, browser-side) is **not** ported in M1–M6 (ruling:
polling first). Legacy's tests under `legacy/tests/` for these modules come across with them.

---

## 2. The reference capability, mapped

What a DisinfoLab-style investigation needs, and where each need lands.

| Need | How Vestigo does it | Slice |
|---|---|---|
| Watch a narrative or hashtag across platforms, continuously | A monitor with a `TOPIC` target, polled on a schedule, one run per tick | M1, M3 |
| Watch an outlet, a channel or an account | A monitor with a `DOMAIN`, `URL` (feed) or `USERNAME` target (account monitors are person-gated: D-M6) | M3 |
| See volume over time and be told when it surges | Per-tick readings with per-minute/per-tick buckets and the rolling-baseline spike test (three-valued: spiking / not / not enough history) | M3 |
| Group posts and articles that tell the same story | Deterministic story clustering (title tokens + shingles) → narratives; embeddings upgrade it across languages | M4, M6 |
| Who posted first, who amplified, which outlets picked it up | Items carry reported `published_at`; the timeline orders them; `amplifies`, `links_to`, `published_by`, `posted_by` edges in the graph. "First observed" is labelled as observed coverage, never asserted as origin | M4 |
| Is this cluster of accounts coordinated? | The five CIB signals, each with the accounts and timings it was computed from, the caveat rendered verbatim, never a verdict | M4 |
| How credible is this source / article? | Seven configurable factors with a per-factor auditable breakdown; tenant-editable source tiers and factor weights | M4 (+ M5 for the LLM factor) |
| Which people, organisations, places, claims appear? | LLM extraction over delimited untrusted text, schema-validated, stored as INFERRED claims (D-27 ceiling), linked to the item's evidence | M5 |
| A readable summary of a narrative | LLM synthesis with every sentence cited to item evidence ids; the citation validator applies unchanged | M5 |
| The infrastructure behind an outlet (WHOIS, certificates, archives) | **Already built:** pivot from an outlet `DOMAIN` entity to the existing `rdap`, `crtsh`, `dns`, `wayback`, `commoncrawl` collectors | M4 (a pivot button) |
| Pull monitoring findings into a case | `case_pins` gains an `item` kind and a `narrative` kind; the case analysis then covers them | M4 |
| Export the investigation | Narrative report through the existing report pipeline and exports | M7 |

---

## 3. Shape of the work

```
packages/core            + TOPIC target type; + NARRATIVE, HASHTAG entity kinds (additive)
packages/collectors      + params in RunContext; + open-host network declaration (SSRF-bound)
                         + rss, bluesky.*, mastodon.*, telegram.channel, brave.web, brave.news,
                           youtube.*, reddit.search; news (GDELT) un-held
packages/signal-engine   NEW, pure (core only): match, spike, stories, credibility, cib, cluster
packages/llm             + EmbeddingProvider + embedding allowlist (M6)
packages/db              monitors extended; + items, item_matches, monitor_readings,
                         narratives, narrative_members, assessments, alert extensions,
                         credibility_profiles, source_tiers, item_embeddings (M6)
packages/access          + monitor:*, alert:*, narrative:read permissions; + MONITORING module
packages/osint-engine    + MonitorScheduler, tick processor, item extractors, reading/assess/
                           summarise/embed processors, queues
apps/worker              wires the new processors and pools
apps/api                 + monitors, alerts, items, narratives, assessments, settings routes
apps/web                 + Monitoring, Narratives, Alerts screens; credentials UI; panels
```

`packages/signal-engine` copies `packages/case-engine`'s constraints exactly: depends only on
`@repo/core`, no I/O, no clock, no randomness, a purity test, and it can never cause collection.
Its processors live in `packages/osint-engine/src/jobs`, as R1-b ruled for case analysis.

---

## 4. Collectors

### 4.1 Contract additions (M1)

- **Parameters.** `CollectorDeclaration` gains an optional `paramsSchema` (Zod, strict; default
  `z.strictObject({})`), and `RunContext` gains `params`. The planner validates `jobs.params`
  against it before admitting the job. `params` is already part of the idempotency key
  (`jobIdempotencyKey`), so two ticks with different windows are different jobs and a retry of
  one tick never collects twice. Existing collectors declare nothing and are unchanged.
- **Monitoring params**, one shape for every monitoring collector:
  `{ query: string | null, since: ISO | null, until: ISO | null, cursor: string | null,
  limit: number }`. A collector whose upstream cannot honour `since` says so in `derived.search`
  (what was actually asked for), exactly as `news.ts` does today.
- **Open-host sources.** RSS feeds and Mastodon instances are user-supplied hosts. A new network
  declaration `tenantHosts(kind)` lets a source's allowed hosts come from the tenant's own
  configuration (feed URLs, instance list) instead of the catalogue, with the fetcher's private
  address and metadata-endpoint refusal applied unchanged, no redirects off the declared host, and
  the host recorded on the evidence. This needs the owner's approval (D-M3).
- **Media are URLs only.** No collector fetches or stores media bytes (legacy rule, DPDP).
  `media: []` means the extractor ran and found none; `media: null` means not extracted.

### 4.2 The collectors

Each row is one collector in `packages/collectors/src/platform/`, with fixtures under
`test/platform/`, tests for provenance, `NOT_FOUND` versus failure, and `Retry-After`. A source
whose empty answers are unreliable reports one as `EMPTY_UNCONFIRMED`, never `NOT_FOUND`, and
declares it (`emptyAnswersUnreliable`; built on Track M Day 2).

| Collector id | Source (catalogue) | Targets | Credential (vault id) | Notes |
|---|---|---|---|---|
| `rss` | `rss-feed` (new, open-host) | `URL` | none | Feed parsed server-side; per-feed status envelope; `published_at` from the item, never the fetch time. |
| `news` (un-held, Track M Day 2) | `gdelt-doc` | `DOMAIN`, `TOPIC` | none | **Built on Day 2** (`docs/PLAN.md`, Track M Day 2), as the owner ruled it, which changed this row's canary: on `{}` (or an empty list) the collector issues one search that always has articles, in the same window and the same shared limit. Articles back mean GDELT is up, and the empty answer is `EMPTY_UNCONFIRMED`, never `NOT_FOUND`: a passing canary means GDELT is up, not that any query found something. An empty canary is `UNAVAILABLE`. A full list is the newest 250 only, and no figure in the result counts coverage. `query`, `since/until` (GDELT `startdatetime/enddatetime`) wait for M1's parameters. |
| `bluesky.search` | `bluesky` | `TOPIC` | none | `app.bsky.feed.searchPosts` with `since/until/cursor`. |
| `bluesky.profile` | `bluesky` | `USERNAME` | none | `getProfile` + `getAuthorFeed`; account age and counts null when absent, never 0. |
| `mastodon.tag` | `mastodon` (new, open-host: tenant's instance list) | `TOPIC` (hashtag only) | none | `api/v1/timelines/tag/:tag` with `since_id`. Full-text search is instance-local and often requires auth; stated in the result. |
| `mastodon.account` | `mastodon` | `USERNAME` (`@user@instance`) | none | `lookup` + `statuses`. |
| `telegram.channel` | `telegram-preview` | `USERNAME` | none | `t.me/s/{channel}` HTML; message ids as cursor; brittle by nature, so a schema drift is a typed `UpstreamResponseError`, never an empty success. |
| `brave.web` | `brave-search` | `TOPIC`, `DOMAIN` (`site:`), `URL` | `brave-search` | `/res/v1/web/search`, `freshness` from `since`. Attribution recorded per Brave's terms. |
| `brave.news` | `brave-search` | `TOPIC`, `DOMAIN` | `brave-search` | `/res/v1/news/search`. |
| `youtube.search` | `youtube-data-api` | `TOPIC` | `youtube-data-api` | `search.list` (`publishedAfter`), then `videos.list` for statistics. 100 quota units per search. |
| `youtube.channel` | `youtube-data-api` | `USERNAME`, `URL` | `youtube-data-api` | `channels.list` + uploads playlist. |
| `reddit.search` | `reddit-api` | `TOPIC`, `USERNAME` (`r/`, `u/`) | `reddit-api` (client id + secret) | OAuth client-credentials; `oauth.reddit.com/search`. Built last (M2b), may end BLOCKED (§8). |

Display names must name every operator (`operatorsMissingFrom`) and be unique: for example
"Bluesky post search (Bluesky public API)", "Brave news search (Brave Search API)".

### 4.3 Licence verdicts the owner must record before production

Every source but GDELT is `UNVERIFIED`; in production an unverified source is refused unless
`COLLECTORS_ALLOW_UNVERIFIED` allows it. Nothing in code can change a verdict; the owner reads the
terms and records the verdict in `catalogue.ts` with the `audited(row, url)` reference.

| Source | Terms to read | Known constraints |
|---|---|---|
| `bluesky` | Bluesky's API terms and developer guidelines | Open protocol; rate limits per IP on the public AppView |
| `mastodon` | Per instance (each instance has its own rules and `about` page) | Tenants configure instances; the default list is the owner's call |
| `telegram-preview` | Telegram terms of service | A web page, not an API |
| `reddit-api` | `https://redditinc.com/policies/data-api-terms` (catalogue row 7) | Commercial use needs approval; the terms restrict surveillance-type use. Highest risk; may end BLOCKED |
| `youtube-data-api` | YouTube API Services Terms of Service and Developer Policies | Default 10,000 units/day per project; search costs 100 units; data retention and display rules |
| `brave-search` | `https://brave.com/search/api/` (catalogue row 15) and its terms | Metered billing; a monthly credit tied to public attribution |
| `rss-feed` | Per publisher | Feeds are published for syndication; the tenant attests when adding one |

### 4.4 Quotas at scale

What happens when a source runs out: the collector returns `UNAVAILABLE` with the upstream's
`Retry-After`, the job backs off, the per-source circuit breaker opens, and the monitor's reading
shows that source as *not covered since [time]*. Never a silent zero. Built on top of that:

1. **Bring-your-own-key per tenant** (the vault already works this way): each tenant's key is
   its own quota.
2. **Tiered sourcing:** keyless sources (GDELT, RSS, Bluesky, Mastodon, Telegram) do the
   continuous watching; keyed, quota-bound sources (Brave, YouTube, Reddit) run on a per-monitor
   budget, shown in the UI.
3. **Adaptive polling (M7):** a quiet monitor polls every 15–30 min; a spiking one every 2–5 min,
   within its budget.
4. **Since-cursors and dedupe:** ask only for what is new; `items` is unique per (collector,
   external id), so a re-seen item is counted, not duplicated.
5. **Plan quotas (M7):** new usage units `MONITOR_TICK` and `UPSTREAM_REQUEST` (exists) per
   tenant per period in `tenant_quotas`; a bigger customer buys a bigger plan and the owner buys the
   matching paid tiers.

---

## 5. Data

All new tables carry `tenant_id`, forced RLS with the canonical policy, composite foreign keys,
least-privilege grants to `app_runtime`, and a drizzle-generated migration followed by a
hand-written `_security` migration, exactly as 0021/0022/0023 did. Cross-tenant isolation tests
cover every new table.

| Table | Purpose | Key columns |
|---|---|---|
| `monitors` (extend) | A saved watch | + `target_type`, `collector_ids` (jsonb), `interval_minutes`, `params` (jsonb), `last_tick_at`, `next_tick_at`, `paused_at`, `paused_reason`, `case_id` (nullable), `budget_requests_per_day` (nullable). `schedule_cron` stays and is validated at the API. |
| `runs` (extend) | A tick is a run | + `monitor_id` (nullable), `window_from`, `window_to`; unique (`tenant_id`, `monitor_id`, `window_from`) so a duplicate tick cannot collect twice. |
| `items` | A post, article, video or message, normalised | `evidence_id`, `collector_id`, `external_id` (unique with collector), `kind` (POST/ARTICLE/VIDEO/MESSAGE), `url`, `author_entity_id` (SOCIAL_ACCOUNT, nullable), `outlet_domain`, `title`, `text`, `langs` (as reported), `published_at` (reported, nullable), `observed_at`, `links`, `media` (URLs only, nullable), `engagement` (as reported, nullable fields), `first_seen_run_id`, `last_seen_run_id`, `seen_count`, `content_hash`. |
| `item_matches` | Which monitor tick an item matched, and on what | `item_id`, `monitor_id`, `run_id`, `basis` (QUERY/FEED/ACCOUNT/HASHTAG). |
| `monitor_readings` | One per tick, append-only | `monitor_id`, `run_id`, `window_from/to`, `counts_by_collector` (jsonb; null = not covered, with reason), `buckets`, `spike` (the three-valued assessment, with its reason text), `engine_version`. |
| `narratives` | A cluster of items about one story | `label` (null until named), `first_observed_at`, `last_observed_at`, `status`, `basis` (SHINGLE/EMBEDDING/ANALYST), `engine_version`. |
| `narrative_members` | Item ↔ narrative | `similarity`, `basis`, `added_by` (RULE/ANALYST). Reversible, like `entity_merges`. |
| `assessments` | A scored thing, written once per input | `subject_kind` (ITEM/NARRATIVE/ACCOUNT/OUTLET), `subject_id`, `kind` (CREDIBILITY/CIB/CLASSIFICATION/SUMMARY), `input_hash`, `document` (jsonb), `engine_version`, `model_call` (nullable, for M5). One row per (subject, kind, input hash), as `case_analyses` does. |
| `alerts` (extend) | Something to look at | + `kind` (SPIKE/NEW_NARRATIVE/CIB_REVIEW/KEYWORD_HIT/SOURCE_UNAVAILABLE), `reading_id`, `narrative_id`, `dedupe_key` (unique while open), `resolved_at`. No severity column: severity is a verdict. |
| `credibility_profiles` | Per-tenant factor weights and switches | `name`, `factors` (jsonb), `is_default`. |
| `source_tiers` | Per-tenant outlet tier table | `domain`, `tier`, `type`, `note`, `set_by_user_id`. |
| `item_embeddings` (M6) | Vector per item per model | `item_id`, `model_id`, `embedding vector(n)`, HNSW index. |

Retention and deletion (CLAUDE.md §9) extend to `items`, `assessments`, `narratives` and
`item_embeddings`: deleting a tenant removes them with its evidence. `items` text is third-party
content: served to the UI as data, rendered as text, never as HTML.

---

## 6. Vocabulary and access

- **Target type `TOPIC`** (additive to `TARGET_TYPES`; `ALTER TYPE target_type ADD VALUE`,
  forward-only). Detection: `#word` → TOPIC; a quoted phrase → TOPIC; a multi-word string keeps
  ORGANIZATION as primary and gains TOPIC as an alternate. A monitor's form sets the type
  explicitly, so detection is a convenience, not the gate. Owner approval: D-M1.
- **Entity kinds `NARRATIVE`, `HASHTAG`** (additive to `ENTITY_KINDS`). Authors are the existing
  `SOCIAL_ACCOUNT` (identifier `platform:stable-id`, for example `bluesky:did:plc:…`); outlets are
  `DOMAIN`; videos and articles are `URL`. Posts are **items**, not entities, so the graph stays
  readable. Owner approval: D-M2.
- **Relationship kinds** (free text already): `posted_by`, `published_by`, `links_to`,
  `mentions`, `amplifies`, `uses_hashtag`, `member_of_narrative`, `co_posted_with` (CIB,
  HYPOTHESIS).
- **Claim strengths:** collector data is REPORTED; everything the engine computes (spike,
  credibility factors, CIB signals, shingle clusters, embedding neighbours) is DERIVED under a
  `derived` block; anything the model writes is INFERRED at most (D-27), with the model call
  recorded on the assessment.
- **Permissions** (in `packages/access/src/permissions.ts`): `monitor:read`, `monitor:write`,
  `alert:read`, `alert:write`, `narrative:read`. Viewer: the reads; analyst: + writes; admin: +
  credibility profile and source tier settings (`organization:update` covers settings PUTs).
- **Module `MONITORING`** in `entitlements.ts`, included in both existing plans for now so nothing
  locks out before Phase 7 prices it. Owner approval: D-M5.
- **Person gate.** Since D-M1 was ruled (Track M Day 1), every TOPIC is person data whatever
  collects it, so a topic or hashtag monitor needs the person plan and approved vetting, and its
  runs are refused whole without them; a GDELT-only topic run is too (Day 2). Domain and feed
  monitors rest on no person data. A monitor whose
  target is an individual's account, watched continuously, is treated as person data and refused
  through the shared `personGate` (fail closed), until the owner rules otherwise (D-M6). CIB
  output names accounts; it is DERIVED from public posts in the window and carries the caveat; the
  reads that return it go through `requirePersonAccess` with a probe over the items' collectors.

---

## 7. Processing

```
scheduler ─► tick ─► run (plan → collect.* → fusion) ─► items + entities ─► reading
                                                                 │               │
                                                                 ├─► assess ─────┼─► alerts
                                                                 ├─► summarise   │
                                                                 └─► embed ──────┘
```

- **`MonitorScheduler`** (M3): BullMQ job schedulers on a new `monitors` queue, one per enabled
  monitor, keyed by monitor id, upserted when a monitor is created, changed, paused or resumed, and
  reconciled from Postgres when a worker pool starts (Postgres is the truth; Redis only delivers).
  Interval from `interval_minutes` (5–1440), or `schedule_cron` when set.
- **Tick processor** (M3): locks the monitor, computes the window (`last_tick_at` or
  `created_at` → now, capped to a maximum catch-up window), creates the run under the unique
  (monitor, window_from) key, builds per-collector params, and hands the run to
  `RunCoordinator.plan`. A monitor over its daily budget records a reading with the reason and
  collects nothing.
- **Item extractors** (M1/M2): one `EXTRACTORS` entry per monitoring collector
  (`fusion/extractors.ts` pattern) emits items, `SOCIAL_ACCOUNT`/`DOMAIN`/`URL`/`HASHTAG` entities
  and the edges above. Exact-identifier resolution as today; nothing is merged by name
  (D-13/D-23 apply).
- **Reading processor** (M3): after a monitor run's fusion: counts per collector (null with reason
  for an uncovered one), buckets since the monitor started, `assessSpike`, alerts with dedupe keys
  (an ongoing spike is one open alert, not one per tick).
- **Assess processor** (M4): per window: story clustering → narratives (new or extended),
  credibility for new ARTICLE/VIDEO items against the window's corpus and the tenant's profile,
  CIB over the window's POST items (account profiles from `bluesky.profile`/`mastodon.account`
  evidence already held; a missing profile makes that signal null, never 0).
- **Summarise processor** (M5): `extraction` (entities, places, organisations, claims) and
  `synthesis` (narrative summary) through `packages/llm` with delimited untrusted input, schema
  validation, the citation validator, retry once then fail, token metering per tenant
  (`AccumulatingMeter`, as reports do). `classification` tags topic labels from a configurable
  taxonomy; a label is an INFERRED claim with the model named.
- **Embed processor** (M6): `EmbeddingProvider` (OpenAI-compatible `/v1/embeddings`, hosted or
  vLLM profile), allowlist in `packages/config/src/llm.ts` limited to Apache-2.0/MIT models
  (candidates: `BAAI/bge-m3`, `intfloat/multilingual-e5-large`, `nomic-ai/nomic-embed-text-v1.5`;
  the owner picks, D-M7), vectors in `item_embeddings`, cosine neighbours over `pgvector` to
  propose narrative membership across languages. A proposal above the threshold joins with
  `basis = EMBEDDING` and `similarity` recorded; the analyst can remove it (reversible).

Every processor: its own queue and bulkhead, a per-job timeout, dead letters on final failure with
`failUnrecorded`-style cleanup, exactly as `queues.ts` does for reports and case analyses.

---

## 8. API and UI

### Routes (`apps/api/src/routes/`)

| File | Routes | Permission | Gated / snapshot |
|---|---|---|---|
| `monitors.ts` | `POST/GET /monitors`, `GET/PATCH /monitors/:id`, `POST /monitors/:id/{pause,resume,tick}`, `GET /monitors/:id/readings`, `GET /monitors/:id/items`, `GET /monitors/:id/events` (SSE, same per-read re-check as `/runs/:id/events`) | `monitor:*` | reads snapshot; account monitors gated |
| `alerts.ts` | `GET /alerts`, `POST /alerts/:id/{acknowledge,resolve}` | `alert:*` | — |
| `items.ts` | `GET /items/:id`, `GET /items?monitorId|narrativeId&since` | `evidence:read` | snapshot; gated by probe |
| `narratives.ts` | `GET /narratives?monitorId`, `GET /narratives/:id` (members, timeline, summary, credibility distribution, CIB), `POST/DELETE /narratives/:id/members/:itemId` | `narrative:read`, `case:write` | snapshot; gated |
| `assessments.ts` | `GET /items/:id/credibility`, `GET /narratives/:id/cib`, `GET /narratives/:id/summary` | `narrative:read` | snapshot; gated |
| `settings.ts` (extend) | `GET/PUT /settings/credibility-profile`, `GET/PUT /settings/source-tiers`, `GET/PUT /settings/mastodon-instances` | `tenant:read` / `organization:update` | — |
| `cases.ts` (extend) | pin kinds `item`, `narrative` | `case:write` | gated |

Each route: `config.access` declared, classified in `ROUTE_GATING`
(`packages/config/scripts/person-gate-guard.ts`), spec regenerated
(`pnpm --filter @repo/api build`), client regenerated (`pnpm --filter @repo/web generate`).

### Screens (`apps/web`)

Each is specified in `docs/DESIGN-SYSTEM.md` §9 first and shown in the dev gallery in every state
(the D-11 rule), with tokens only (the design-system guard).

- **Monitoring** (`/monitors`): list with state, last tick, open alerts; **create** form: target
  type, target, sources with licence badge and "needs credential" badge, interval, budget, case.
- **Monitor** (`/monitors/$id`): live reading via SSE: volume sparkline, spike state (three
  states, with its reason), coverage per source (covered / not covered since / needs credential /
  over budget), latest items, open alerts, run history (reuses the run view).
- **Narratives** (`/narratives`, `/narratives/$id`): clusters by monitor; a narrative's timeline,
  members by platform, cited summary (marked model-written), credibility distribution, CIB signals
  with `CIB_CAVEAT` verbatim, graph (existing tab), "pivot outlet domain" to the existing
  collectors, pin to case.
- **Alerts** (`/alerts`): inbox; acknowledge, resolve, open the reading.
- **Settings**: credentials (Brave, YouTube, Reddit, the first UI over `/credentials`),
  credibility profile editor (weights and switches, per factor), source tiers, Mastodon instances.
- `packages/ui`: a sparkline/buckets primitive (SVG, tokens only); a factor-breakdown list; a
  signal card. Charts follow the `dataviz` guidance when built.

---

## 9. Decisions for the owner

| Id | Decision | Recommendation |
|---|---|---|
| D-M1 | Add `TOPIC` to `TARGET_TYPES` (additive; pg enum value) | **Ruled 2026-10-15 (Day 1), built:** accepted, and every TOPIC run is person data whatever collects it, failing closed on the target type with no name detector (`docs/PLAN.md`, Track M Day 1) |
| D-M2 | Add `NARRATIVE`, `HASHTAG` entity kinds; posts/articles are items, not entities | Accept |
| D-M3 | Open-host sources (RSS feeds, Mastodon instances) with tenant-declared hosts under the same SSRF rules | Accept, with the host recorded on evidence and no redirects off-host |
| D-M4 | Un-hold GDELT with the canary test for a false-empty answer | **Ruled 2026-10-15 (Day 2), built:** un-held, with the owner's change to the canary: an empty answer is unconfirmed (`EMPTY_UNCONFIRMED`) whatever the canary says, and a passing canary shows only that GDELT is up (`docs/PLAN.md`, Track M Day 2) |
| D-M5 | New `MONITORING` module, included in both plans until Phase 7 | Accept |
| D-M6 | Continuous monitoring of an individual's account is person data: refused unless the tenant has PERSON_INVESTIGATION and vetting | Accept (fail closed); refine with an organisation-account exception later (verified via Wikidata id) |
| D-M7 | Embedding model allowlist (Apache-2.0/MIT only) and which one to run first | `BAAI/bge-m3` (MIT, multilingual) on the vLLM profile; hosted alternative named in config |
| D-M8 | Reddit: build, or wait for the terms reading | Build last in M2b; ship only with a recorded verdict |
| D-M9 | Alert delivery beyond in-app (webhook, email) | M7, with Phase 7's webhooks; in-app + SSE in M3 |
| D-M10 | Bluesky Jetstream pool | M7, after polling proves the data model |
| D-M11 | Monitoring usage units and plan quotas | `MONITOR_TICK` per period; requests already metered as `UPSTREAM_REQUEST` |

---

## 10. The slices

Each slice: one reviewed stage, tests green before the next, recorded in `docs/PLAN.md` like
R1-a/b. Sizes are estimates (source + tests), confidence stated.

| Slice | Scope | Size | Confidence | Depends on |
|---|---|---|---|---|
| **M0** | This plan recorded; ADR amendments for D-M1..M7; licence task list to the owner | docs | high | — |
| **M1** | `TOPIC` type + detection; collector `params`; open-host declaration; `runs.monitor_id`/window; `monitors` extension; `items` + `item_matches` tables, repositories, extractor hook; `packages/signal-engine` skeleton with purity test; `MONITORING` module and permissions | 1,200 + 1,400 | medium | D-M1, D-M2, D-M3, D-M5 |
| **M2a** | Keyless collectors: `rss`, `news` un-held (done ahead, on Track M Day 2), `bluesky.search`, `bluesky.profile`, `mastodon.tag`, `mastodon.account`, `telegram.channel`; extractors; fixtures | 1,800 + 2,000 | medium | M1, D-M4 |
| **M2b** | Keyed collectors: `brave.web`, `brave.news`, `youtube.search`, `youtube.channel`, `reddit.search`; credentials UI | 1,300 + 1,400 | medium | M1, D-M8 |
| **M3** | Scheduler, tick processor, readings, spike, alerts (in-app), `monitors`/`alerts` routes + SSE, Monitoring and Alerts screens. **"It monitors."** | 2,000 + 2,200 | medium-low | M1, M2a |
| **M4** | Story clustering → narratives; credibility (profiles, tiers); CIB; graph edges; item/narrative pins; Narratives screen; credibility and CIB panels; outlet pivot | 2,400 + 2,600 | medium | M3 |
| **M5** | LLM extraction, narrative summary, classification; metering; eval fixtures; summary panel | 900 + 1,100 | medium | M4, `packages/llm` |
| **M6** | Embedding provider + allowlist; `item_embeddings`; embed queue; semantic membership proposals; "similar across languages" UI | 900 + 1,000 | medium-low | M4, D-M7 |
| **M7** | Adaptive polling, budgets, plan quotas; webhook delivery; narrative report export (with the D-34 re-check); Bluesky Jetstream pool | 1,500 + 1,500 | low-medium | M3–M5, Phase 7 pieces |

About 12,000 lines of source and 13,000 of tests in all. Several weeks per pair of slices,
with M3 as the first demonstrable milestone.

---

## 11. Verification, per slice

- **Gates that already run:** `pnpm turbo run fabrication-check`, `check-exports`,
  `boundaries.test.ts` (signal-engine added to the pure list), `person-gate-guard.test.ts`
  (every new route classified), `design-system-guard`, `env-example.test.ts`,
  `route-access.test.ts`.
- **Unit:** signal-engine golden tests ported from `legacy/tests/` (spike, CIB, credibility,
  story clustering) plus the fabrication-defect regressions the audit names; collector fixture
  replays through `@repo/collectors/testing`; provenance tests for every collector.
- **Integration (docker Postgres + Redis):** tick → run → items → reading → alert; a duplicate
  tick collects nothing; a source returning 429 leaves a *not covered* reading and an open circuit;
  a monitor over budget records why; cross-tenant isolation on every new table; the SSE stream
  closes with `locked` when access is lost.
- **Live checkpoint for M3:** one real monitor on a current topic over GDELT + RSS + Bluesky +
  Mastodon in development (`COLLECTORS_ALLOW_UNVERIFIED`), run for an hour; the reading, the
  buckets and the first alert inspected against the raw evidence payloads.
- **Live checkpoint for M5:** a narrative summary against the configured model, every sentence
  resolving to an item evidence id; where no model is configured, the honest "not configured".

---

## 12. Risks stated plainly

- **Reddit** may be unusable commercially; the plan does not depend on it.
- **Telegram previews** are an HTML page; a markup change breaks the collector loudly (typed
  error), and Telegram's terms are unchecked.
- **YouTube's default quota** (100 searches/day per key) means YouTube monitors poll hourly, not
  every 5 minutes, unless a quota increase is granted.
- **Brave costs money per request** and requires attribution for the credit.
- **GDELT's false-empty behaviour** is reported as unconfirmed, never as no coverage, and the
  canary that tells "GDELT is up" from "GDELT is not answering" costs one extra request per empty
  answer. GDELT is also under strain: it answered most requests from the development address on
  2026-10-15 with 429, and asks on its blog (2026-06-30) that searches move to its ngram files
  while its search infrastructure is migrated. Its one live answer recorded that day covered two
  and a half hours of the three months asked for (`docs/PLAN.md`, Track M Day 2).
- **DPDP:** items are public posts by identifiable people. Text and URLs are stored; media bytes
  never; retention applies; account monitors are person-gated. Nothing here changes CLAUDE.md §9.
- **Scale:** per-tenant keys and tiered sourcing carry the first customers; plan quotas and
  adaptive polling (M7) carry the next ones. True firehose scale is a later decision.

---

## Appendix A: provenance of the reference material (for the record)

- The legacy codebase (`legacy/`, "Sentinel AI", from `D:\social-media-ai-agents-v2-main`,
  branch `transform/pulselens`, commit `ebfe83b`) is the only source codebase; it has no recorded
  repository URL. Its social, CIB, credibility, analysis and news-aggregation modules are what this
  track ports; its collectors and case logic were ported in Phases 3–5 and R1.
- 46 legacy files were themselves ported from a teammate's fork (`social-media-ai-agents-2.3-main`),
  which is not in this repository.
- External repositories reviewed for VA/PT (`docs/vapt/VAPT-REFERENCES.md`) contributed no code.
- Brave Search: catalogued (`brave-search`, UNVERIFIED), chosen as the web-search backend in
  `docs/ARCHITECTURE-DECISIONS.md` §11, never built; `BRAVE_SEARCH_API_KEY` was deliberately
  removed from the env schema because collector credentials live in the tenant vault.

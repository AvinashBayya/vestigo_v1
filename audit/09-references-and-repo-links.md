# 09 — References, Repo Links & Provenance

## 1. Git

| Item | Value |
|---|---|
| Remote (`origin`) | `https://github.com/AvinashBayya/vestigo_v1.git` (fetch + push) |
| Default branch | `main` |
| Audited branch | `milestone/vestigo-days-1-3-osint-addendum` (HEAD `156952f`) |
| Other local branches | `backup/final-tree-2026-10-07`, `backup/pre-split-2026-10-07`, `d35-probe`, `d38-statement-cancelled`, two `worktree-wf_*` (workflow worktrees) |
| Commits | 77 (2026-09-25 → 2026-10-21) |
| Contributors | 1 — `avina <whhoohh@gmail.com>` |
| Tags | none |
| Submodules | none (`.gitmodules` absent) |
| Vendored code | none |
| `.env` in history | **never committed** (`git log --all -- .env` empty) |
| `origin/main` state | last pushed 2026-10-15 (`51a7576`); local milestone branch is ahead |

Commit style is conventional-ish with project-specific prefixes (`R1-a/b`, `U1-*`, `feat`, `docs`, `build`, plus descriptive "Track M Day N" messages).

## 2. Internal package references

Workspace packages reference each other only through `@repo/*` entry points (never deep paths), enforced by `boundaries.test.ts`. The dependency DAG is in [02-architecture.md](02-architecture.md) §3.

## 3. External services referenced in code (wired)

- **GDELT DOC 2.0** — `api.gdeltproject.org` (`news` collector).
- **Wikidata** — `www.wikidata.org/w/api.php` (`wikidata` collector).
- **Datastores:** Postgres (`pgvector/pgvector:0.8.6-pg17-trixie`), Redis (`redis:8`).
- **Identity:** Better-Auth (self-hosted, no external IdP).
- **LLM:** configurable OpenAI-compatible endpoint (self-hosted vLLM `vllm/vllm-openai@sha256:…` or a hosted https endpoint). No AI-vendor SaaS SDK.

Collector upstreams that are coded but frozen (`UNVERIFIED`): crt.sh, Cloudflare DoH, rdap.org + IANA bootstrap hosts, Internet Archive Wayback, Common Crawl, GitHub API, Hacker News (Firebase + Algolia), dev.to, Bluesky, Reddit, 217 RSS publishers, direct-article. Full table in [03](03-external-services-and-apis.md) §A.3.

## 4. Referenced-but-not-wired (documented only)

From `Vestigo_Global_News_Providers_and_APIs.md` (519-line research catalog, explicitly "a starting catalog, not a guarantee"): GDELT Cloud, NewsAPI.org, The News API, World News API, Mediastack, Currents, Event Registry, AYLIEN, Webz.io, LexisNexis/Factiva/Meltwater, Google Fact Check Tools API, Media Cloud, Europeana, Library of Congress, Bing/Google News API, Reuters/AP/AFP/Bloomberg/BBC/Al Jazeera/DW wire services. Google News is explicitly BLOCKED in code.

Other catalogue sources declared for licence-verdict listing but unwired: shodan-internetdb, c2intelfeeds, insightface (non-commercial licence), youtube-*, hibp, brave-search, gravatar, nominatim, wikipedia, usgs-earthquakes, nasa-eonet, noaa-swpc, kpler, cisa-kev, feodo-tracker, openverse, nhtsa-vpic, theharvester, spiderfoot, searxng, ivre, safecast, gdelt-events.

## 5. Datasets / local data

- `data/content-store/` and `apps/worker/data/content-store/` — content-addressed evidence/report stores (gitignored); hold real collected JSON/HTML/PDF payloads plus placeholdered seed payloads.
- `packages/collectors/src/data/rss-feeds.ts` (217 publishers), `rdap-registry-hosts.ts` (IANA RDAP bootstrap snapshot).
- `packages/integrations/assets/fonts/` — NotoSerif TTFs for PDF rendering.
- `docs/design/mockups/` — 15 `.dc.html` sources + 15 PNG screenshots + `canvas.json`/`tokens.json`.

## 6. Documentation set (`docs/`)

- **Settled architecture:** `ARCHITECTURE-DECISIONS.md` (12 ADRs + D-XX/R1 amendments: D-23 no name-only location merge, D-28 case-analysis gate-first, D-30 replay meets the gate, D-32 snapshot reads, D-33 graph indexes, D-34 report-gen gate, R1-b case-analysis-as-derived-data + 50k-record cap).
- **Plans/trackers:** `PLAN.md` (4559-line living tracker), `PROJECT-BRIEF.md`, `BUILD-PHASES.md`, `MASTER-BUILD-SEQUENCE.md`, `EXACT_ARTICLE_INTELLIGENCE_PLAN.md`, `M1_DIRECT_ARTICLE_FETCH_REPORT.md`, `NEWS_URL_INVESTIGATION_FIX_REPORT.md`, `OSINT_ADDENDUM_IMPLEMENTATION_REPORT.md`, `SOURCE_ACCESS_POLICY.md` (M0), the `DAY_1/2/3_AUDIT_REPORT.md` trio (the recent OSINT-addendum work).
- **Design:** `DESIGN-SYSTEM.md` + `docs/design/` mockups (+ `officer-mockups/`).
- **Audits of the legacy codebase:** `docs/audit/INVENTORY.md` (KEEP/ADAPT/REWRITE/DROP verdicts on the prior "Sentinel AI" repo — many REWRITE reasons cite fabrication, e.g. `searxng.ts` fabricating provenance "Google Web Index", `recon-sources.ts` mislabelling fallbacks as `source:"crtsh"`, `vehicle-osint.ts` inventing fields), plus `COLLECTOR-REVIEW.md`, `COLLECTORS.md`, `DEPENDENCIES.md`, `QUESTIONS.md`, `REPORT.md`.
- **Tracks:** `docs/monitoring/` (Track M), `docs/reclamation/` (R1 case-analysis), `docs/vapt/` (deferred active VA/PT capability).

## 7. The legacy/ reference

Gitignored, ~7.7 MB / 475 files, 0 tracked. Previous codebase internally "Sentinel AI" / `sentinel-ai` (~130 modules): a TypeScript `src/` app, a Python `ai-service/` (GPU vision/forensics FastAPI — the origin of the planned-but-absent `services/vision`), `eslint-rules/`, `scripts/`, `tests/`. Read-only porting reference per CLAUDE.md; never imported at runtime; the fabrication check must pass on any module before it enters the new repo.

## 8. Standards / RFCs referenced by the implementation

RFC-9457 (problem+json), RFC-4180 (CSV), RFC-2606 / RFC-5737 (reserved example domains/IPs in fixtures and seeds), E.164 (phone), UUIDv7 (evidence ids), WCAG 2.1 AA (UI contrast guard). No academic papers or blog posts are cited in code comments.

## 9. Accounts / cloud projects implied

- A **GitHub account** (`AvinashBayya`) hosting the repo.
- For production: a Postgres host, a Redis host, a content-store volume (or the unbuilt S3), and — only if LLM synthesis is enabled — either a GPU host for vLLM or a hosted OpenAI-compatible endpoint + key. Optional per-tenant collector credentials (`github`, `bluesky`, `reddit-api`) are supplied through the in-app vault, not env.
- No AWS/GCP/Azure/Supabase/Vercel/etc. project is required by the current code.

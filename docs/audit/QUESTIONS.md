# Open questions and decisions for a human

Audit date: 2026-09-23. Everything here is either something the code cannot answer or a decision the rebuild owner has to make. Nothing below was guessed in the other audit files; where the other files say UNKNOWN, the reason is here.

## A. Licences and terms that could not be confirmed

Each of these is used by working code today. "Fetched" means a terms page was read on 2026-09-23; the rest were not reachable or say nothing.

1. **Reddit Data API** (search via OAuth; user-page fetches). Both Reddit terms URLs were blocked to this audit's fetcher. Need: whether a commercial OSINT product may use the Data API without a separate agreement, and whether Reddit's terms bar use for research on individuals. Files: `src/utils/social.ts:1316-1522`, `src/utils/collectors/person/presence-username.ts:119-121`.
2. **OpenSky Network** (two call sites, one full-globe). Terms URLs returned HTTP 403. Need the current commercial-use position. Files: `src/utils/geo-sources.ts:349`, `src/routes/osint.tsx:557`.
3. **Google News RSS** (14 references). No Google terms page confirmed. This is the backbone of `/news`, `/live`, `/sentiment`, `/sources`, dorks and the SearXNG fallback.
4. **YouTube**: the ToS (fetched) prohibits automated access and downloading. Decision needed: keep any InnerTube-based feature (metadata, captions, search, download URL) and the Python yt-dlp service, or restrict to the Data API v3 path. Files: `src/utils/youtube-collector.ts`, `app/`.
5. **Telegram `t.me/s/` scraping** (three call sites, hard-coded default channels). Telegram terms not checked.
6. **Bluesky** (public AppView, Jetstream firehose in the browser, app-password search): terms not checked.
7. **Shodan InternetDB**: page says commercial use needs an enterprise licence. Decision: buy it, or drop `/recon` attack surface, the `shodan-internetdb` collector and the `/crawlers` probe.
8. **HIBP**: CC BY 4.0 attribution must be rendered wherever breach data appears (it is not today) and the acceptable-use policy must be assessed for a persons-OSINT product.
9. **C2IntelFeeds** is CC BY-NC-SA 4.0. Decision: remove from `/osint` or obtain permission.
10. **InsightFace `buffalo_l`** models are non-commercial research only; `/ai/faces` cannot ship commercially as built. Decision: licence from InsightFace, replace the model, or drop face matching.
11. **Florence-2**, **Grounding DINO**, **YAMNet**: licences are stated only in repo comments; verify against the actual weight files that will be vendored (none are in the repo).
12. **GPL/AGPL containers** (theHarvester GPL-2.0-only, IVRE GPL-3.0, SearXNG AGPL-3.0). They run as separate processes over HTTP. Whether that satisfies counsel for a commercial SaaS, and whether AGPL's network clause applies to an unmodified SearXNG image you host, is a legal question.
13. **Nominatim**: public service allows 1 req/s and bans applications whose primary function is geocoding. Decision: self-host or use a commercial geocoder before any multi-tenant load.
14. **UCDP** tokens are issued on describing a research project; **ReliefWeb** appnames are pre-approved and the repo's own text says the registration is "for non-commercial use". Both need a commercial-use answer.
15. **Jina Reader**, **Brave Search free tier**, **HackerTarget**, **AlienVault OTX**, **abuse.ch Feodo Tracker**, **GPSJam**, **Wayback CDX**, **crt.sh**, **Cloudflare DoH**, **Gravatar**, **GitHub API**, **Hacker News**, **dev.to**, **Medium feeds**, **Openverse API**, **CARTO basemap tiles**, **publisher RSS feeds** (BBC, Al Jazeera, PIB, Defense One, USNI, Breaking Defense, Ars Technica, NPR, Foreign Policy, Krebs, DarkReading, War on the Rocks, CSIS, Yahoo Finance, CNBC, CISA advisories): no terms confirmed.
16. **Kpler**: `docs/OpenApiSpec-Supply & Demand-v2.json` is Kpler's client API spec. Confirm whether it may be redistributed in the repo.
17. **Bundled data**: `src/assets/ieee-oui.txt` (IEEE registry), `public/data/*.json` (world geometry, source not recorded), `src/data/geo-map.ts` (2,796 lines of undersea cables, nuclear facilities and economic centres with no provenance). Where did these come from and under what licence?
18. **npm and PyPI licences** were not scanned. Is a licence scan required before reuse?

## B. Product decisions the code cannot make

19. **Authentication and tenancy**: there is none. The rebuild architecture is decided elsewhere; the audit only records that every one of the 81 server functions is anonymous today and that every store is either per-browser or process-global (REPORT §6, question 5 and 9).
20. **What happens to per-browser data?** Cases, evidence, graphs, timelines, watchlists, bookmarks, products, image corpora and monitors live only in localStorage. Is any of it to be migrated, or is it treated as demo data?
21. **YouTube scope** (see A.4). Also: the Python `app/` service is unreferenced by the frontend; confirm it can be deleted along with `tests_py/` and the root `requirements.txt`/`Dockerfile` pairing.
22. **Local network scanner** (`src/utils/local-network.ts`, the `/recon` LAN panel): executes PowerShell on the server host and sweeps its subnet, unauthenticated. Confirm removal.
23. **Vehicle OSINT** (`src/utils/vehicle-osint.ts`): India-specific RTO tables plus a DuckDuckGo scrape that invents make/fuel/class. Confirm removal or a real data source.
24. **Person Investigation suite**: gated by `PERSON_INVESTIGATION_ENABLED` and a lawful-basis form written around India's DPDP Act 2023. Which jurisdictions will the product serve, and what lawful-basis capture is required?
25. **Collection policy matrix** (`src/utils/collection-policy.ts`) and **scan authorisation** (`src/utils/scan-authorization.ts`, `SCAN_AUTHORISATIONS` naming an authorising officer): keep the mechanisms, but the wording and legal bases are programme-specific. Who owns the commercial policy text?
26. **Active collection**: `contact.domain` fetches the target's own website while declared passive. Is any target-contacting collection acceptable in the product?
27. **LLM providers and model policy**: the "no Llama, open-weights only, Sarvam/Groq" rules were defence-programme constraints. Which providers and model licences apply commercially? Sarvam is also the only speech-to-text vendor wired in.
28. **Languages**: the i18n layer covers English plus 15 Indian languages. Which locales does the product need?
29. **Classification banners** ("UNCLASSIFIED // DEMONSTRATOR" on the dashboard, login and PDFs) and PS-18/iDEX wording (`/tasks`, reports prompts, login footer): confirm removal.
30. **Default subject**: every page starts on `"google.com"` and the dashboard presets name Tesla, OpenAI and Elon Musk. Confirm that a rebuilt product starts empty.
31. **Seeded sample watchlists** naming fictional organisations (Vector-17, Aster Motors, Meridian Capital, Northwind Logistics) are written to storage on first load. Confirm removal.
32. **Data retention**: YouTube comments are fetched "for display and analysis on request and are not bulk-persisted" citing DPDP. What retention rules apply to collected posts, comments, breach flags and audit logs commercially?
33. **Which pages survive**: `/alerts`, `/threats`, `/profile`, `/tasks`, `/osint-verification` and `/login` are stubs or programme artefacts (INVENTORY §2). `/live` is a single Google News feed presented as a live stream; `/subjects` matches against fixed queries. Decide per page.
34. **Report products**: `reports.ts` enforces "every finding cites a numbered source" and re-validates after generation. Is that the intended commercial behaviour, and is a 12-source budget acceptable?
35. **Rate limiting**: tiers are keyed by server-function name and counters are per process. Any commercial limit needs a shared store; the tier design itself may be reusable.

## C. Technical unknowns

36. **Does `ai-service` work?** Its 8 test modules could not run here (Python 3.9, no torch/pytesseract). The repo says `/health` reported all four models loaded on the original developer's GPU machine on 2026-08-28. No weights are in the repo. Someone with a Python 3.11 CUDA or CPU environment and the vendored weights needs to run `pytest` and exercise `/ai/detect`, `/ai/describe`, `/ai/faces`, `/ai/audio/events`.
37. **Do the OSINT worker images build and run?** `osint-workers/theharvester/Dockerfile` installs a 2019 PyPI stub named `theHarvester`. The SpiderFoot adapter's endpoint names were never checked against a live instance (the compose file says so). No verification of any of the four services was possible here.
38. **`SqliteJobStore`**: the repo documents that `bun:sqlite` fails under the Node production runtime and under the Vite dev server. Is there any environment where `JOB_STORE_PATH` works? If not, the file is dead.
39. **Tests that need the internet**: `tests/collectors-external-searxng.test.ts` (fallback reaches Google News), `tests/recon.test.ts` (fallbacks reach HackerTarget/OTX), `tests_py/test_youtube.py::test_invalid_video_id_raises_video_unavailable` (live YouTube). Results will differ offline. Was the suite ever green offline?
40. **`bun run build`**, `bun run smoke` and `bun run smoke:controls` were not run (they write `.output/` or need a running server). `.output/nitro.json` shows a successful build on 2026-09-21 with `nitro 3.0.260603-beta`. Whether the current tree (with uncommitted `gis.tsx`/`geo.ts` changes and four untracked modules) builds is UNKNOWN.
41. **Uncommitted work**: `src/routes/gis.tsx`, `src/utils/geo.ts` (modified) and `src/utils/environmental*.ts`, `src/utils/source-cache.ts`, `src/components/environmental-context.tsx`, four tests and `public/osiris-license.txt` (untracked) implement NASA EONET / NOAA layers modelled on the MIT-licensed `osiris` project (a sibling `osiris-reference/` folder exists outside the repo). Is this work to be kept? The `PROJECT_MEMORY.md` diff is also uncommitted.
42. **Git history**: the repo has one commit ("Baseline: Sentinel AI as received"); `master` and `transform/pulselens` point at the same commit. The docs refer to `backup/pre-auth-rollback` (a Prisma/SQLite/Argon2id auth system at commit `214f0df`) and to `origin/main`. Neither exists here. Is the earlier history available, and is that auth code wanted as reference?
43. **Secrets to rotate**: `PROJECT_MEMORY.md` records a real Sarvam key and a Groq key in a local `.env`, and `.gitignore` describes a sibling folder that held "a real (live-format) Gemini API key" and "a real plaintext Instagram/Facebook credential pair". None of these files is in this tree. Have those keys been rotated?
44. **`worldmonitor`** (npm) and 14 other declared dependencies are never imported. What was `worldmonitor` for?
45. **`undici` exact pin 7.29.0** with no import: why is it pinned, and does anything rely on it?
46. **`c2pa-python`** is unpinned and installed best-effort. Does the code's `c2pa.Reader(stream=...)` API match the current 0.37.x release?
47. **`@distube/ytdl-core`** is kept as a fallback the code itself describes as unable to decipher stream URLs. Is it worth keeping at all?
48. **Bun vs Node**: tests run under Bun, production under Node 22, local Node is 24. The repo records one production-only bug from this split. Which runtime is the target?
49. **Node request timeout**: nothing configures it; Node's default is 300 s for the whole request. Long collectors (crt.sh up to ~112 s, SpiderFoot up to 135 s, transcription upload 120 s, orchestrator with no overall cap) fit under it only by accident. Confirm the intended ceiling.
50. **Frozen contracts** (`src/types/core.ts`, "Dev 1/2/3", freeze date 2026-08-06): is that arrangement still binding, or can the types change?
51. **Documentation drift**: README/CLAUDE.md claim "653 tests passing, tsc clean" and that the scraper scripts were deleted; today there are 2,096 tests with 10 failing, one type error, a red lint, and both scraper scripts present. Which document, if any, is authoritative going forward?
52. **`src/components/`** (9,194 non-ui lines) was not line-audited beyond the components cited in REPORT.md; the route audit covered what they render. A component-level fabrication pass has not been done.

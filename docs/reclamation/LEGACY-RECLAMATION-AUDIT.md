# Vestigo — Legacy Reclamation Audit

The complete accounting of the legacy codebase (`legacy/`, internal name "Sentinel AI", ~130 modules)
against what Vestigo has ported so far. Its purpose: make sure nothing reusable is left behind a
second time.

**Why this exists.** Vestigo's Phases 3–5 ported the *collection* layer — 10 collectors plus phone
analysis — and left most of the *analysis* layer in the folder, because the work proceeded
collector-by-collector and never reached it. The old product's value was never the collectors; it was
what it did with results: cases, cross-intelligence, contradictions, credibility, provenance, and the
person/geoint/mediaint disciplines. That is roughly **25,000+ lines of analytical functionality**
still unported.

**The important finding from reading the code:** most of the unported analysis is *high quality* and
already aligned with Vestigo's rules. `cib.ts` produces "signals warranting review, never a verdict."
`credibility.ts` makes configurability the deliverable with a per-factor auditable breakdown.
`file-provenance.ts` uses the same absence-vs-unreadable discipline Vestigo enforces. This is not junk
— it is good logic wearing PS-18 framing. So the dominant verdict is **REWRITE (port the logic, strip
the PS-18/defence framing, replace the I/O, pass the fabrication gate)**, not DROP.

---

## Verdict key

- **PORTED** — already in Vestigo; ignore.
- **PORT** — pure/low-risk logic; bring across under KEEP (imports only) or light adaptation.
- **REWRITE** — the logic is valuable but the data path fabricates, uses a blocked source, or carries
  PS-18 framing. Port the logic, fix the data path, add a regression test for the specific defect.
- **DROP** — fake-data feature, blocked source with no clean version, or UI/dead code superseded by
  Vestigo.
- **DEFER** — port only when the feature is on the roadmap (heavy, feature-specific).

Every PORT/REWRITE goes through the fabrication gate. "Pure" is not assumed clean until the gate says
so.

---

## 1. The analysis layer — the biggest gap (`src/utils/cases/`, ~5,500 lines)

The analytical heart of the old product. Vestigo built cases as *pins*; the legacy had a full
case-analysis engine. This is the single most valuable unported subsystem. It belongs in a new package
`packages/case-engine`, mirroring `packages/osint-engine`.

| Module | Lines | Verdict | Notes |
|---|---|---|---|
| `case-analysis.ts` | 609 | REWRITE | Core case analysis. Strip PS-18 framing; evidence/claim model already matches Vestigo. |
| `cross-intelligence.ts` | 597 | REWRITE | Cross-discipline correlation — the "fuse TECHINT+SOCMINT+GEOINT" logic. High value. |
| `case-context.ts` | 495 | REWRITE | Case context assembly. |
| `case-intelligence-breakdown.ts` | 464 | REWRITE | Per-discipline breakdown for a case. |
| `case-scope.ts` | 455 | REWRITE | Scope checking before reporting — maps onto Vestigo's gates. |
| `case-report.ts` | 424 | REWRITE | Case reporting — reconcile with Vestigo's Phase 5 report pipeline, don't duplicate. |
| `case-runs.ts` | 387 | REWRITE | Run association to cases. |
| `case-geoint.ts` | 335 | REWRITE | GEOINT within a case — depends on the geoint discipline (§3). |
| `case-contradictions.ts` | 302 | REWRITE | Contradiction surfacing at case level — pairs with `osint/contradictions.ts`. |
| `case-attach.ts` | 285 | REWRITE | Attaching evidence/media to a case. |
| `case-report-build.ts` | 229 | REWRITE | Report assembly — reconcile with Phase 5. |
| `case-claims.ts` | 188 | REWRITE | Claim handling at case level. |
| `case-snapshot-selection.ts` | 185 | REWRITE | Graph/timeline snapshot selection. |
| `case-entities.ts` | 169 | REWRITE | Entity handling at case level — reconcile with Vestigo's entities endpoints. |
| `case-delete.ts` | 138 | REWRITE | Case deletion — Vestigo needs real deletion anyway (DPDP). |

**Reconciliation warning:** Vestigo already has cases, entities, and a report pipeline. This subsystem
must be *merged with* those, not bolted alongside. The logic (cross-intel, contradictions,
breakdowns) is what's new; the case/entity/report plumbing already exists.

---

## 2. The OSINT orchestration engine (`src/utils/osint/`, ~3,200 lines)

Vestigo ported target detection, planning, fusion and merge in Phase 4. Several analytical pieces were
left behind.

| Module | Lines | Verdict | Notes |
|---|---|---|---|
| `jobs.ts` | 413 | PORTED | Superseded by Vestigo's BullMQ jobs. Ignore. |
| `person-investigation.ts` | 395 | REWRITE | Person-investigation orchestration — PERSON-gated. Depends on §3 person collectors. |
| `timeline.ts` | 389 | REWRITE | Timeline construction — reconcile with Vestigo's timeline endpoint. |
| `verification.ts` | 341 | REWRITE | Claim verification logic — valuable, pairs with the citation validator. |
| `entity-resolution.ts` | 296 | PORTED | Vestigo did exact-identifier resolution in Phase 4. Cross-check for anything extra. |
| `job-store-sqlite.ts` / `job-store.ts` | 266 / 174 | DROP | localStorage/SQLite job store — superseded by Postgres + BullMQ. |
| `contradictions.ts` | 256 | REWRITE | Contradiction detection across evidence — high value, pairs with `case-contradictions`. |
| `orchestrator.ts` | 170 | PORTED | Superseded by Vestigo's orchestrator. Cross-check. |
| `query-planner.ts` | 133 | PORTED | Superseded. Cross-check for target types Vestigo doesn't plan for. |
| `person-query-planner.ts` | 101 | REWRITE | Person-specific planning — PERSON-gated. |
| `merge.ts` | 95 | PORTED | Superseded by Vestigo's merge. |
| `person-audit-store.ts` | 81 | REWRITE | Person-investigation audit — Vestigo's audit log supersedes the store, but the person-specific fields may be worth keeping. |
| `gaps.ts` | 60 | REWRITE | "What's missing from this investigation" — pairs with Vestigo's coverage section. |

---

## 3. Missing collector disciplines

### 3a. Person (`src/utils/collectors/person/`, ~1,800 lines) — Vestigo kept only `contact-phone`

All PERSON-discipline, so all behind the entitlement + vetting gate. The audit already flagged some of
these with fabrication defects (contact-email's `catch { return null }`, presence-image's DPDP issue)
— those are REWRITE with the specific fix.

| Module | Lines | Verdict | Notes |
|---|---|---|---|
| `contact-email.ts` | 524 | REWRITE | Email discovery. Audit found 5 `catch { return null }` sites making "failed" indistinguishable from "not found". Fix that. |
| `identity-websearch.ts` | 406 | REWRITE | Identity via web search — reconcile with the dork backend decision (Brave/Common Crawl). |
| `presence-username.ts` | 316 | REWRITE | Username presence — overlaps Sherlock (§6 tool container). |
| `contact-domain.ts` | 184 | REWRITE | Domain-to-contact. |
| `contact-hibp.ts` | 182 | REWRITE | HIBP — already UNVERIFIED in Vestigo. Reconcile with the existing verdict. |
| `contact-phone.ts` | 134 | PORTED | Done in Vestigo. |
| `presence-image.ts` | 107 | REWRITE | Image presence — the audit flagged a DPDP concern and a non-existent entity type. Fix both, or DROP if face-adjacent. |

### 3b. GEOINT (`src/utils/geoint/`, ~1,300 lines) — NONE in Vestigo

| Module | Lines | Verdict | Notes |
|---|---|---|---|
| `evidence.ts` | 373 | REWRITE | GEOINT evidence model — align to Vestigo's evidence path. |
| `image-match.ts` | 265 | DEFER | Image matching — depends on media forensics (§5). |
| `metadata.ts` | 244 | REWRITE | Geo metadata extraction (EXIF GPS etc.). The audit found a `0.0` fake-zero GPS bug — fix it. |
| `providers.ts` | 241 | REWRITE | Geo data providers — check each source's licence (several were UNKNOWN/blocked). |
| `geolocation-hypothesis.ts` | 204 | REWRITE | Location hypothesis from evidence — good "hypothesis not fact" framing. |

### 3c. MEDIAINT (`src/utils/mediaint/`, ~800 lines)

| Module | Lines | Verdict | Notes |
|---|---|---|---|
| `claims.ts` | 646 | REWRITE | Media-intelligence claim logic. |
| `claim-conflicts.ts` | 168 | REWRITE | Conflicting-claim detection — pairs with contradictions. |

---

## 4. Major analytical modules (`src/utils/`, top level)

| Module | Lines | Verdict | Notes |
|---|---|---|---|
| `social.ts` | 2,388 | REWRITE | Social media intelligence (Bluesky firehose, Mastodon, Telegram, Reddit OAuth). Excellent code; Bluesky Jetstream is the real open feed. Strip PS-18; reconcile Reddit with its commercial terms. Big win. |
| `cib.ts` | 886 | REWRITE | Coordinated Inauthentic Behaviour detection. "Signals warranting review, never a verdict" — already Vestigo-aligned. High value, genuinely differentiating. |
| `credibility.ts` | 982 | REWRITE | Source credibility, configurable per-factor with auditable breakdown. Six of seven factors deterministic; the LLM factor ships disabled. Port nearly as-is, strip PS-18. |
| `social-credibility.ts` | 300 | REWRITE | Social-specific credibility. |
| `credibility-profiles.ts` | 164 | REWRITE | Credibility factor profiles. |
| `credibility-llm.ts` | 132 | REWRITE | The opt-in LLM credibility factor — route through Vestigo's `packages/llm`. |
| `cross-intelligence` (see §1) | — | REWRITE | Listed under cases. |
| `analysis.ts` | 630 | REWRITE | Article/content analysis. |
| `analysis-llm.ts` | 364 | REWRITE | LLM-backed analysis — route through `packages/llm`. |
| `news-aggregation.ts` | 222 | REWRITE | RSS/news aggregation — reconcile with GDELT (already ported). |
| `osint-summary.ts` | 210 | REWRITE | Investigation summary — pairs with report pipeline. |
| `threat-classifier.ts` | 162 | REWRITE | Threat classification (military/cyber/geopolitical/unrest/infra). Defence-flavoured; keep as a configurable classifier, drop the defence taxonomy if selling commercially. |
| `search.ts` | 303 | REWRITE | Search orchestration. |

---

## 5. Media forensics (DEFER as a block — real, heavy, GPU-adjacent)

Vestigo deferred this deliberately. Port when media analysis is on the roadmap. All REWRITE-quality,
not DROP.

| Module | Lines | Verdict |
|---|---|---|
| `file-provenance.ts` + `file-provenance-client.ts` | 2,715 + 1,797 | DEFER → REWRITE. Document (PDF/OOXML/ODF/video) provenance forensics. Largest module; same discipline as Vestigo's C2PA/EXIF work. |
| `imaging.ts` + `imaging-client.ts` | 1,284 + 687 | DEFER → REWRITE. Image forensics. |
| `audio-frequency.ts` + `audio-events.ts` + `audio-extract-client.ts` + `audio-fingerprint-store.ts` | ~1,900 | DEFER → REWRITE. Audio signal processing. |
| `transcription.ts` | 393 | DEFER → REWRITE. Speech-to-text (Sarvam STT) — route through `packages/llm`. |
| `pdf-revocation*.ts` | ~420 | DEFER → REWRITE. PDF certificate revocation checking. |
| `focal-point.ts` | 100 | DEFER. Image focal point. |

---

## 6. Tool-container collectors (`src/utils/collectors/external/`) — the VA/PT spine

Covered in `VAPT-REFERENCES.md` Part 1a. Summary: `spiderfoot`, `theharvester`, `ivre`, `searxng`,
`sherlock`, `jina-reader` — all REWRITE, as the container-over-HTTP tool-runner pattern for OSINT tool
containers now and VA/PT engines later.

---

## 7. Specialised intelligence modules (`src/utils/`)

Niche, domain-specific. PORT the pure ones; REWRITE or DROP the rest by whether the feature is wanted
commercially.

| Module | Lines | Verdict | Notes |
|---|---|---|---|
| `graph-build.ts` + `graph-view.ts` + `graph-layout.ts` + `graph-store.ts` | ~1,300 | REWRITE | The graph engine. Vestigo has a GraphStore interface + Postgres adapter and a graph endpoint; reconcile — the layout/build logic is the reusable part. |
| `vehicle-osint.ts` | 412 | DROP | The audit found it fabricates fuel/class from a DuckDuckGo scrape of a non-existent "Open License Plate Index". Do not port. |
| `cyber-intel.ts` | 69 | REWRITE | CVE/vulnerability intel — feeds directly into VA's `cve-match` (see VAPT plan). Small, useful. |
| `attack-surface.ts` | 307 | REWRITE | Attack-surface logic (private-IP detection etc.) — feeds VA's ASM discipline. The `isPrivateIPv4` helper is pure and reusable immediately. |
| `threat-classifier.ts` | (see §4) | REWRITE | — |
| `radiation.ts` | 138 | DEFER | Radiation-station feed — niche GEOINT; port only if wanted. |
| `gps-interference.ts` + `gpsjam-url.ts` | 276 | DEFER | GPS-jamming (GPSJam ADS-B) — niche; check the data licence. |
| `supply-demand-sources.ts` | 158 | DEFER | Supply/demand signals — niche. |
| `vehicle-osint`, `radiation`, `gps-interference` | — | — | All were specialised PS-18 GEOINT; keep only what a commercial buyer wants. |

---

## 8. Infrastructure / utility modules — mostly PORTED or superseded

| Module | Lines | Verdict | Notes |
|---|---|---|---|
| `credential-vault.ts` | 1,383 | PORTED | Vestigo rebuilt this properly (envelope encryption, per-tenant). The legacy cleartext version is the thing Vestigo replaced. Ignore. |
| `llm.ts` + related | 824 | PORTED | Vestigo's `packages/llm` supersedes it. |
| `reports.ts` + `report-pdf.ts` | 1,067 + 355 | PORTED | Vestigo's Phase 5 report pipeline supersedes. Cross-check `report-pdf` for layout ideas. |
| `rate-limit*.ts` | ~850 | PORTED | Vestigo rebuilt rate limiting (Redis sliding window). `rate-limit-tiers.ts` definitions may be worth a look. |
| `evidence-store.ts` + `evidence.ts` + `manual-evidence.ts` | ~600 | PARTIAL | Vestigo has the evidence path; `manual-evidence.ts` (analyst-entered evidence) is a feature not yet in Vestigo — REWRITE that one. |
| `validation.ts` | 372 | PORT | Pure input validation — harvest. |
| `maltego-export.ts` | 128 | PORTED | Done in Phase 5. |
| `security-headers.ts` | 169 | PORTED | Vestigo has security headers. |
| `scan-authorization.ts` | 335 | PORTED | Superseded by the `scope_authorisations` table; read for the model. |
| `collection-policy.ts` | 330 | REWRITE | Passive/active policy — reconcile with Vestigo's collection modes and the VA/PT scope gate. |
| `collector-health.ts` | 462 | REWRITE | Collector health reporting — feeds the in-product health panel. |
| `watchlist-store.ts` + `bookmark-store.ts` + `timeline-store.ts` + `investigations-store.ts` | ~1,150 | DROP | All localStorage stores — superseded by Postgres. The *features* (watchlists, bookmarks) may be worth rebuilding, but not from this code. |
| `operator-auth.ts` + `demo-session.ts` | ~310 | DROP | Superseded by Better Auth. |
| `client-ip.ts` + `operational-error.ts` + `local-id.ts` + `file-handoff.ts` + `theme.ts` + `highlight.tsx` + `live-filters.ts` + `focal-point.ts` + `active-target.ts` + `social-attach.ts` | ~900 | DROP/PORT | Small UI/util helpers — mostly superseded; harvest any pure ones the classification pass flags. |
| `leaflet-client.ts` | 326 | DROP | Leaflet UI — Vestigo uses MapLibre. |
| `local-network.ts` | 660 | DROP | Local network/Wi-Fi scanner — the audit flagged it as active, unauthenticated, executes PowerShell. Never port. |

---

## 9. The product pages (`src/routes/`, 33 pages)

The old product exposed 33 pages: agents, alerts, crawlers, entities, exports, gis, graph, images,
investigations, live, news, osint-verification, osint, recon, reports, sentiment, social, sources,
subjects, tasks, threats, timeline, trends, vault, videos, watchlists, youtube, and more.

Vestigo has built ~4 screens. These pages are **reference for the frontend roadmap**, not code to port
(they're TanStack Start routes; Vestigo is a Vite SPA). Use them to decide *which* screens the
commercial product needs, restyled into Vestigo's design tokens. Many (sentiment, trends, threats,
subjects) correspond to the analysis modules above — build the screen when its analysis is ported.

---

## 10. How to execute this reclamation

This is large — comparable to another two or three phases. It runs AFTER Phase 6b and alongside or
before VA/PT, because VA/PT's value multiplies on a fully-reclaimed OSINT platform. Suggested order:

1. **Run the automated classification pass first** (`VAPT-REFERENCES.md` Part 1d) across all ~130
   modules, producing `docs/reclamation/legacy-classification.md`. This confirms PURE vs FABRICATION-FLAGGED vs
   IO-BOUND vs DEAD per function, under the gate — ground truth beneath this module-level audit.
2. **Reclaim in value order:**
   - **R1 — The analysis layer** (§1 cases + §2 osint analytical pieces): `packages/case-engine`.
     Cross-intelligence, contradictions, verification, gaps. The biggest value.
   - **R2 — The credibility + CIB + social cluster** (§4): the differentiating analysis. `social.ts`
     and `cib.ts` are the standout wins.
   - **R3 — The missing disciplines** (§3): person, geoint, mediaint collectors.
   - **R4 — Media forensics** (§5): when the roadmap wants it; GPU-adjacent.
   - **R5 — Specialised + remaining** (§7, §8): cherry-pick by commercial need.
3. **Each module: REWRITE through the fabrication gate**, strip PS-18/defence framing, replace
   localStorage/SQLite I/O with Postgres repositories, route LLM calls through `packages/llm`,
   reconcile with the Vestigo subsystem that already exists (don't duplicate cases, entities, reports,
   graph). Bring tests across; add a regression test for each audit-flagged defect.
4. **Reconcile, never duplicate.** Vestigo already has cases, entities, reports, graph, evidence,
   credential vault, rate limiting, LLM, auth. The reclamation adds the *analysis* on top of that
   plumbing — it does not re-lay the plumbing.

---

## 11. The honest bottom line

Vestigo is a clean, trustworthy, ~90%-complete *core*: collection, evidence, jobs, reports, access,
tenancy. What it is missing is most of the old product's *analysis* layer — the thing that made it an
intelligence product rather than a collection tool. That layer is ~25,000 lines of mostly
high-quality, Vestigo-aligned logic still sitting in `legacy/`, left behind only because the port went
collector-first and stopped.

Reclaiming it is a real body of work (R1–R5), but it is *reclamation*, not reinvention: the hard
thinking is already in the code, and most of it needs the PS-18 framing stripped and the data path
cleaned rather than a rewrite from scratch. Do the automated classification pass, then reclaim in value
order, reconciling with what Vestigo already built. VA/PT then lands on a complete platform instead of
a partial one.

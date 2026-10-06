# Vestigo VA/PT — References: what to reuse, and what never to

Companion to `VAPT-PLAN.md`. This is the source-of-truth for where code and ideas come from. Two
rules sit above everything here:

- **Nothing is vendored wholesale.** Every external repo below was evaluated and rejected as a
  dependency. What gets reused is a *service list*, a *shape*, or an *idea* — re-implemented inside
  Vestigo's own rules.
- **Legacy code is ported, never copied.** The `legacy/` folder holds the previous codebase as
  read-only reference. Porting means: read the audit verdict, then KEEP / REWRITE / DROP, through the
  fabrication gate, with the module's tests brought across. A function that invents a value is
  rewritten or dropped, never carried.

---

## Part 1 — The legacy folder (`legacy/`, already in the repo)

51,653 lines across 85 util modules plus a Python vision service. Most is OSINT already ported in
Phases 3–5. For VA/PT specifically, these are the pieces worth harvesting.

### 1a. The VA/PT spine — tool-container wrappers

These are the passive-recon tool integrations that become the VA/PT tool-runner pattern. They already
speak the "call a container over HTTP, parse structured output" shape V2/V3 need. Port the shape and
the parsing; replace the I/O with the new fetcher and the one evidence path.

| Legacy file | Lines | Reuse as |
|---|---|---|
| `src/utils/collectors/external/spiderfoot.ts` | 377 | Template for the container-tool runner (scan start, poll, parse) |
| `src/utils/collectors/external/theharvester.ts` | 370 | Same pattern; recon data parsing |
| `src/utils/collectors/external/ivre.ts` | 415 | Network-recon result parsing — closest existing thing to Nmap output handling |
| `src/utils/collectors/external/searxng.ts` | 321 | Container-over-HTTP pattern reference |
| `src/utils/collectors/external/sherlock.ts` | 459 | Username-presence; PERSON-gated pattern |
| `src/utils/scan-authorization.ts` | 335 | The ORIGINAL scope-authorisation logic — predecessor of the `scope_authorisations` table. Read it for the authorisation model; the table is the canonical version now |

### 1b. Pure utilities worth lifting (low fabrication risk — deterministic transforms)

These take inputs and transform them; they invent nothing. Port under KEEP where they still fit.
Always re-run the fabrication gate; do not assume "pure" means "clean".

| Legacy file | Lines | What it is |
|---|---|---|
| `src/utils/validation.ts` | 372 | Input validation / target parsing |
| `src/utils/rate-limit-tiers.ts` | 118 | Rate-limit tier definitions |
| `src/utils/maltego-export.ts` | 128 | Maltego graph export (already ported in Phase 5 — cross-check before re-porting) |
| `src/utils/threat-classifier.ts` | 162 | Classification logic |
| `src/utils/graph-layout.ts` | 289 | Graph layout maths |
| `src/utils/social-velocity.ts` | 149 | Scoring maths |

### 1c. Large analytical modules — port only if the feature is wanted

Heavy, useful, but feature-specific. Do not port speculatively; port when the feature is on the
roadmap. Each must go through the fabrication gate — the audit found defects in this layer.

| Legacy file | Lines | Feature |
|---|---|---|
| `src/utils/credibility.ts` | 982 | Source-credibility scoring |
| `src/utils/imaging.ts` | 1284 | Image forensics |
| `src/utils/audio-frequency.ts` | 1478 | Audio signal processing |
| `src/utils/geo.ts` | 1132 | Geospatial maths |

### 1d. The automated classification pass (do this first, for Stage C onward)

Before porting anything from `legacy/` by hand, run a classification script that walks every exported
function and bins it:

- **PURE** — no I/O, no clock, no network; deterministic. The harvest list.
- **FABRICATION-FLAGGED** — the fabrication gate fires. Quarantine; rewrite only if needed.
- **IO-BOUND** — hits network/disk/DB. Port the logic, replace the I/O.
- **UI/DEAD** — React, localStorage, or nothing imports it. Drop.

Output a table (path, export, bin, one-line reason) into `docs/legacy-classification.md`. This gives a
harvest list before any human judgement, and is the correct reading of "reuse the useful functions
automatically" — extract 100% of the *reusable* ones, leave the *fabricating* ones behind.

---

## Part 2 — External reference repos (all REJECTED as dependencies)

Verdicts are final. Re-evaluate only on a material change (new release, licence change, maintainer
change). Confirm the current state of any repo before relying on it; these verdicts were set at review
time, not continuously.

| # | Repo | Licence / health at review | Verdict | What to actually take |
|---|---|---|---|---|
| 1 | `alpkeskin/mosint` | MIT, Go, ~6k★, no release since Jan 2023 | **Mine the service list, not the code** | The list of backing services (hunter.io, emailrep, IntelX, BreachDirectory, HIBP, psbdmp, holehe/socialscan). Each becomes its own registered collector with its own licence verdict and vault-only key. Code is thin glue — nothing to port. |
| 2 | `0x0be/yesitsme` | No LICENSE, Python, 1 commit, ~2.8k★ | **Hard no** | Nothing. Logs into Instagram with a session cookie and scrapes — violates the locked no-Instagram/Facebook/X rule. No licence means no right to reuse regardless. |
| 3 | `osintambition/Social-Media-OSINT-Tools-Collection` | GPL-3.0, awesome-list | **Reference only** | Use it to spot gaps in collector coverage. Not integrable code — a link list, mostly hosted services or platform scrapers that can't ship commercially. |
| 4 | `SepJs/aegis-guard` | Rust/Go/Tauri, v0.9, "personal use" | **Not relevant** | Nothing. Desktop host IDS — different product category. |
| 5 | `CyberWardion/ai-pentest-agent` | Python, solo | **Design AGAINST it** | Nothing to take. It finds and exploits with Tor routing for attribution-hiding. This is the exact unauthorised-attack profile to design against — the anti-goal in `VAPT-PLAN.md` §5. If a design starts to resemble it, stop. |
| 6 | `Arunava-27/vapt-toolkit` | Could not conclusively verify at review | **Shape only, verify first** | The generic "thin orchestrator around Nmap/Nuclei/Burp → report" shape, which is the right V2 pipeline shape. The upstream engines matter, not this wrapper. Re-confirm the repo before relying on anything beyond the pattern. |

**Net:** reuse (a) mosint's service list as a checklist, and (b) the generic recon →
structured-findings → report shape every VAPT wrapper follows. Nothing else.

---

## Part 3 — The "Sentinel" prototype (ideas only, not code)

A separate, independently-built prototype (internal name "Sentinel", Python/FastAPI + MongoDB) was
reviewed for structural ideas only. **This is NOT the Sentinel AI that became Vestigo** — it is an
unrelated prototype that happens to share the name; note that so no future reader confuses them. Its
OSINT/VA-PT logic is not working (it wires to Shodan and Google CSE, both ruled out by Vestigo's
licence audit). **Do not reuse its code.**

Keep as ideas, re-implemented in Vestigo's stack:

- **Platform Core vs Product Module split** — `platform.view` / `platform.manage` permissions, module
  gating by entitlement, admin surface hidden from workspace users. Maps onto `packages/access`
  (`decideModuleAccess`) + the Better Auth org plugin. Mostly a missing UI layer, not new infra.
- **Per-tool `quota_cost` + JSON-schema-driven run forms** in the registry — lets the frontend render
  a run form generically per collector instead of hand-building one each. Ties into pre-dispatch
  usage metering.
- **Investigation workspace layout** (tabbed panels, split list+map, code-split heavy libs) — a UX
  pattern, restyled into Vestigo's design tokens.

---

## Part 4 — Upstream engines and data sources (what actually matters)

The tool choice that matters is the upstream engine/data-source per collector, not any wrapper repo.

**V1 data sources (passive, mostly already catalogued):**
- NVD (National Vulnerability Database) — CVE data. Confirm commercial-use terms; record the URL.
- CISA KEV — known-exploited catalogue. Tier A, US federal public domain, already in the catalogue.
- Common Crawl CDX, GitHub code search — already registered.

**V2 engines (active, separate containers over HTTP):**
- Nmap — host/service discovery. The foundation.
- Nuclei — template-based vulnerability scanning. Modern default.
- (candidates, owner to decide) OpenVAS/Greenbone, Nikto, testssl.sh.

**V3 engines (assisted exploitation, separate containers, GPL — never linked):**
- Metasploit-class framework.
- (candidates) sqlmap, ZAP.

Every engine and data source gets its own licence verdict recorded before it runs, same as every
collector. GPL/AGPL tools run only as separate containers over HTTP — the pattern already used for
SpiderFoot/theHarvester.

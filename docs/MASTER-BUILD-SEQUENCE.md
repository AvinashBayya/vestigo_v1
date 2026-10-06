# Vestigo — Master Build Sequence

The single roadmap that threads everything together: the remaining UI, the OSINT analysis reclamation
(`docs/reclamation/`), and VA/PT (`docs/vapt/`). Its job is to make sure nothing you planned is left
as an unused document — every item below has a place in line, what it depends on, and the UI that
ships with it.

**The rule that governs all of it:** backend capability and its UI ship together, in small reviewed
stages. A capability with no screen is invisible; a screen with no capability is a lie. Nothing is
built in one giant pass — that is what produced the unsellable monolith. One stage per session,
reviewed, committed.

---

## Where you are now

- **Core backend:** ~90% — collection, evidence, jobs, reports, access, tenancy. Solid, ~1,600 tests.
- **Frontend:** auth, search, run view, workspace shell (6b-4) built; report view (6b-5) not yet.
- **In docs, built into nothing yet:** the analysis layer (~25,000 lines to reclaim), all of VA/PT.

The gap is the whole *analysis* and *scanning* value. The sequence below closes it.

---

## The shape of the road

```
NOW ─ Finish the shell (6b-5)                         [days]
  │
  ├─ Track 1: OSINT ANALYSIS RECLAMATION               [the old product's intelligence value]
  │    R1 cases + cross-intelligence + contradictions
  │    R2 credibility + CIB + social
  │    R3 person / geoint / mediaint disciplines
  │    R4 media forensics (GPU-adjacent)
  │    R5 specialised + remaining
  │
  ├─ Track 2: VA/PT                                     [the new scanning capability]
  │    Stage A vuln-engine skeleton + ASM discipline
  │    Stage B scope-authorisation extension
  │    Stage C V1 passive ASM collectors
  │    Stage D V1 breach/identity collectors
  │    Stage E V2 active scan (Nmap/Nuclei)
  │    Stage F V3 assisted PT (gated, legal-blocked)
  │
  └─ Track 3: COMMERCIAL + OPS                          [to actually sell and run it]
       Phase 7 plans, vetting UI, onboarding, billing
       Phase 8 cloud, CI, observability
       Phase 9 hardening, vision-service repair, licences
```

The two engineering tracks (1 and 2) can run in either order, or interleave. Track 3 can start its
non-engineering parts (legal) in parallel immediately. Each item below carries its own UI — that is
why the frontend keeps growing rather than "finishing".

---

## Step 0 — Finish the shell (6b-5) — do this regardless

The report view. Days. It completes what already exists so the current product is fully usable, and
it is a prerequisite for showing any later capability's output. Build it first whatever order you pick
for the tracks.

Also in this step: **verify pinning works end-to-end** (the "nothing shows" question). If pinning is
broken, fix it here; if the workspace is just empty until pinned, confirm that.

---

## Track 1 — OSINT Analysis Reclamation

This is what turns Vestigo from a *collection tool* back into an *intelligence product*. The logic
already exists in `legacy/`, mostly high quality, needing the PS-18 framing stripped and the data path
cleaned. Source of truth: `docs/reclamation/LEGACY-RECLAMATION-AUDIT.md`.

**R0 — the automated classification pass (cheap, do first).** A script bins every legacy export as
PURE / FABRICATION-FLAGGED / IO-BOUND / DEAD. Produces the harvest list. A day. No UI.

**R1 — the case analysis engine.** `packages/case-engine`. Cross-intelligence correlation,
contradiction detection, case scope, intelligence breakdown, gaps. The single biggest value.
- *Backend:* ~5,500 lines of `cases/` logic + the analytical pieces of `osint/` (contradictions,
  verification, gaps), REWRITE through the fabrication gate, reconciled with Vestigo's existing cases.
- *UI:* the case workspace gains real analysis tabs — contradictions, cross-intelligence findings, a
  populated overview. This is where the empty tabs you just saw get their content.
- *Several weeks.*

**R2 — credibility, CIB, social.** The differentiating analysis.
- *Backend:* `credibility.ts` (configurable per-factor scoring), `cib.ts` (coordinated-behaviour
  signals), `social.ts` (the Bluesky firehose + Mastodon/Telegram/Reddit). All REWRITE.
- *UI:* credibility breakdown panels, CIB signal views, a social-intelligence surface. New screens.
- *Several weeks.*

**R3 — the missing disciplines.** person (~1,800 lines, only phone exists today), geoint (~1,300
lines, none today), mediaint. All PERSON-discipline work goes behind the vetting gate.
- *UI:* a GIS/map tab (MapLibre), person-investigation surfaces, media claim views.
- *Weeks.*

**R4 — media forensics.** file-provenance, imaging, audio, transcription (~9,000 lines). GPU-adjacent;
deferred until the roadmap wants it.
- *UI:* a media tab with forensic panels.

**R5 — specialised + remaining.** cyber-intel (feeds VA's cve-match), attack-surface (feeds VA's ASM),
graph engine reconciliation, watchlists, manual evidence, cherry-picked by commercial need.

---

## Track 2 — VA/PT

The new scanning capability. Source of truth: `docs/vapt/` (VAPT-PLAN, VAPT-REFERENCES,
VAPT-AGENT-OPERATIONS, VA-PT-ARCHITECTURE). Note R5's cyber-intel and attack-surface feed directly
into this, so a little reclamation helps VA.

**Stage A — `packages/vuln-engine` skeleton + `ASM` discipline.** No collectors; the frame. No UI yet.

**Stage B — scope-authorisation extension.** The gate that makes active work structurally impossible
without authorisation. *UI:* a scope-authorisation surface (declare target, prove ownership).

**Stage C — V1 passive ASM collectors.** cve-match, subdomain-takeover, secrets-exposure, tls-hygiene.
*UI:* findings surfaced as evidence in the existing workspace — severity, CVE links, all gated.

**Stage D — V1 breach/identity collectors** (from mosint's service list). *UI:* person-gated results.

**Stage E — V2 active scan.** Nmap + Nuclei as containers. *UI:* a scan-launch surface behind the
scope gate, live scan progress (reuses the run view), findings as evidence.

**Stage F — V3 assisted PT.** Human-in-the-loop exploitation. *Blocked on legal* (ToS, AUP, vetting
procedure, insurance). *UI:* the approval workflow, per-exploit consent.

---

## Track 3 — Commercial + Operations (to sell and run it)

**Phase 7 — the commercial layer.** Plans/entitlements (enforcement exists; the surface doesn't),
the vetting signup flow (the "Vetting not submitted" badge you saw needs a screen behind it),
onboarding, usage/billing UI, webhooks, data export/deletion. *This is what makes it sellable at all.*

**Phase 8 — infrastructure.** Cloud deploy, CI pipeline, OpenTelemetry. Deferred for budget; needed
before real customers.

**Phase 9 — hardening.** Security review, repair the Python vision service (the invalid insightface
pin etc.), resolve the open licence verdicts, load-test the scan engine.

**Non-engineering, start now in parallel:** the legal surface (ToS, AUP, vetting procedure, DPDP,
insurance). Longest lead time; gates VA/PT V3 and parts of Phase 7 regardless of code speed.

---

## Three honest realities

1. **This is months, not days.** Core backend is 90% done, but the *analysis* and *scanning* value —
   the reason anyone buys it — is mostly still in the docs. Tracks 1 and 2 are each several weeks.
   That is not slowness; it is the real size of what you planned.
2. **The UI grows with each capability.** It cannot "finish" before the capabilities exist, because
   each one brings its own screens. The shell (through 6b-5) is the frame; R1/R2/VA fill it.
3. **The discipline is the asset.** One reviewed stage at a time is why there are 1,600 passing tests
   and an honest product instead of the monolith you abandoned. Going faster by abandoning it would
   recreate exactly the thing you are rebuilding away from.

---

## The decision in front of you

After Step 0 (finish the shell), pick the order of the two engineering tracks:

- **Track 1 first (recommended if the buyer wants intelligence):** reclaim cases/credibility/CIB. This
  is the old product's proven value, the logic already exists, and it fills the empty workspace tabs
  with real analysis. Lowest risk, highest "it's actually a product" return.
- **Track 2 first (if the buyer wants VA/PT specifically):** build the scanning capability. Newer,
  higher legal surface, needs the legal work started immediately.
- **Interleave:** R0 + R1 to make the product real, then VA Stage A–C, alternating. Keeps both moving.

Track 3's legal work starts in parallel no matter what you choose.

My recommendation: **Step 0 → R0 → R1**, because R1 is what makes the thing you just built in 6b-4
actually do something — the empty case tabs become real analysis — and it is the lowest-risk path to a
product that demos as an intelligence tool rather than a collection tool. VA/PT (Track 2) follows,
with its legal work started now.

Tell me the order you want, and I will write the first stage's prompt.

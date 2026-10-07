# Screen designs

The reference designs for the web app: 15 screens drawn by the owner in claude.ai.

- **The canvas:** "OSINT Platform — Dashboard & Workspace Mockups",
  https://claude.ai/artifact/2rFbohJRepk8MFxBzp3z5v (version of 2026-10-03).
- **Its design system:** https://claude.ai/artifact/5aoHSLvKvkJrL5rt9eEYCZ. Its tokens are
  `docs/DESIGN-SYSTEM.md` and `packages/ui/src/tokens.css`. `mockups/tokens.json` matches that
  document exactly (33 colour tokens, every spacing, radius and shadow token; checked
  2026-10-05). On 2026-10-07 (U1-a) the document was reconciled with the mockups' HTML itself,
  value by value, and now holds many tokens `tokens.json` does not: the drawn surfaces, tints,
  links, type styles, quarter-step spacing, radii and sizes, and the entity-class colours.
  `DESIGN-SYSTEM.md` §12 lists every place a mockup is not followed and why.

These files were brought into the repo on 2026-10-05, after Phase 6b steps 1 to 3 had been built
without them. Until then they existed only in claude.ai. Read this page before building or
changing any screen.

## What is here

| Path | What it is |
|---|---|
| `mockups/screenshots/<Screen>.png` | What each design looks like. Open these to look at a design |
| `mockups/<Screen>.dc.html` | The design sources. They render only inside the claude.ai canvas (they need its runtime); read them for exact layout, sizes and wording |
| `mockups/canvas.json` | The canvas index: each artboard's title and the canvas notes |
| `mockups/tokens.json` | The design system's tokens as the canvas holds them |

These are reference only: never imported, built or shipped. In the copies, the product name
reads `[PRODUCT NAME]`, as in the other mockups (CLAUDE.md, "Product name"); two screenshots
still show it.

## How to use them

1. **Layout, hierarchy, spacing and wording come from the mockup.** Colours, type and spacing
   come from the tokens; never copy a hex or pixel value out of a mockup file.
2. **Data comes only from the API.** Mockup text such as `[CASE NAME]`, `148`, `18/21 ok` or
   `42 credits` is placeholder. A value the API does not give is not shown, or is an em dash
   with its reason (CLAUDE.md §1).
3. **Unbuilt features are hidden, not drawn** (owner's decision, 2026-10-05). A menu item,
   panel or button for something that does not exist yet stays out until it is built. Examples:
   Monitors, the Collectors page, Usage, the credits card, attaching a file, the command
   palette.
4. **Mockup copy that would be false today is corrected in the app** (list below), never
   shipped as drawn. The canvas itself is left as the owner made it.

## Each screen: what can be built today

Audited against `apps/api/openapi.json` on 2026-10-05.
- **Built:** in the app now.
- **API:** needs a small addition in `apps/api`.
- **Backend:** needs new backend work, or a feature that does not exist.

| Screen | Status | Notes |
|---|---|---|
| SignIn (sign-in and MFA challenge) | Built to the design (2026-10-05) | Lost-device line corrected (below) |
| MfaEnrol | Built to the design (2026-10-05) | Backup codes come before the final step, because confirming leaves the page. "Invited to [ORG] as [ROLE]" needs the invitation in the enrolment state (API), so it is not shown |
| Main, Dashboard-dark | Built to the design (2026-10-05); dark theme from the account menu | Side navigation shows Search and Cases (2026-10-06). Recent cases open their workspace. Recent cases show pins and the created date (cases record no updated time). Collector health comes from `GET /api/v1/collectors`. Monitors, credits, attach and command palette are Backend, so hidden |
| RunLive (the run view against the collectors that exist) | Built to the design (2026-10-05) | Duration estimate, claims per source, per-run cost, pause and "Open case" are Backend: not shown, or an em dash with its reason |
| Run (an earlier run view) | Superseded by RunLive | Shows collectors that do not exist (SpiderFoot, theHarvester, Shodan, HIBP, Brave) |
| Evidence | Built (step 4, 2026-10-06), for a run and for a case | From the timeline read, the only evidence list: at most 500 records, said to be partial beyond that. No claim text or hash column (the list carries neither; both are in the provenance drawer). Selection, saved views, Re-verify and Cite in report are Backend, so hidden |
| Workspace, Overview, Entities, Timeline | Built (step 4, 2026-10-06) | A run's results and a case's pins share the tabs; a case is labelled "Pinned items only" (cases and runs are not linked). Overview is composed from existing reads. The runs rail, discipline filters, case summary paragraph, contradictions, merge actions, bulk actions and saved views are Backend or not built, so hidden. The timeline's range brush is not built |
| Report, ReportPDF | Built (step 5, 2026-10-06) as a run's Report tab | The report as stored, in its own wording, beside the stored PDF. Editing, regenerating a section, review state and case reports are Backend, so hidden |
| Media, Map | Later | Not built: no upload, media forensics, geo layers or external feeds |

## Copy corrections: mockup, then what ships

| Screen | Mockup says | Ships as | Why |
|---|---|---|---|
| SignIn | "An administrator in your organisation can reset your second factor" | "Lost your device? Use one of your backup codes." | No reset exists, and turning MFA off is forbidden |
| MfaEnrol | "Enrolment link verified" | "Enrolment link received" until step 1 succeeds | No separate check of the token exists |
| Run, RunLive | "Recording to case [CASE ID]", "Results stream into the case" | Not shown | Runs are not linked to cases; the audit log is tenant-wide |
| Run, RunLive, Report | Residency "In-region" | Not shown | Region headers are recorded, never interpreted |
| RunLive | "A failed collector is charged for the attempts it made" | Not shown until metering exists | Upstream requests are counted against quota; nothing is charged |
| RunLive | Common Crawl as MEDIAINT; "alternates: url" for a domain; Wikidata running for a domain | Shown as the API gives them | Common Crawl is TECHINT; a bare domain has no alternates; Wikidata takes organisations only |
| Workspace, Evidence, Timeline | crt.sh, DNS and Wayback evidence as OBSERVED | The strength the API gives (REPORTED) | Strength comes from the registry entry |
| Overview, Entities | "Merging requires a second independent identifier" | "A merge is recorded with its reason and can be undone" | A person may merge on name alone; only automatic name-only merges are refused |
| Entities | "Shared: display name, city" | The match signals the API gives | Candidates are matched on name only |
| Evidence | "Open stored copy" | "Download raw payload" | Payloads are only ever served as a download (CLAUDE.md §9) |
| Workspace | Graph nodes in the claim-strength colours | The entity-class tokens (DESIGN-SYSTEM §2, added 2026-10-06) | In the graph a colour says what a node is; strength is said by the edge and in words |
| Entities | "First seen" | "Recorded" | The date is when the platform recorded the entity, not when it was first seen anywhere |
| Overview | "Coverage" by discipline with counts | Each source's status, and the gaps with their reasons | Evidence is not counted by discipline anywhere in the API |
| Report | "cannot cite pinned evidence" | "cannot cite this run's evidence" | Citations are checked against the run's evidence |
| ReportPDF | "Case [CASE ID]", "Independent sources" | The run and investigation; "Sources" | Reports are per run; independence of sources is not established |
| Map | "Conflict events: Needs key" | Licence-blocked | The source is blocked by its licence |
| Media | "Faces" analysis | Not shown | The face model is licence-blocked |

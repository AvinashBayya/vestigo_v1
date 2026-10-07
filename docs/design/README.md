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
| SignIn (sign-in and MFA challenge) | Rebuilt from the component library (U1-c, 2026-10-07) | Lost-device line corrected (below). The challenge is its own route on the raised ground. Primary buttons stay enabled; an empty field is refused with its error |
| MfaEnrol | Rebuilt from the component library (U1-c, 2026-10-07) | Backup codes come before the final step, because confirming leaves the page. "Invited to [ORG] as [ROLE]" needs the invitation in the enrolment state (API), so it is not shown. The link state is a tag, not a pill |
| Main, Dashboard-dark | Rebuilt from the component library (U1-c, 2026-10-07); dark theme from the account menu's Light/Dark pair | Side navigation: Search, Cases, Members, Settings (only built destinations). The organisation's name is in the header (not drawn: tenant isolation). Credits: an em dash with "credit metering is not built", no bar. Monitor alerts: a Not built card. Command palette: pages and cases (no tenant-wide runs endpoint). Collector health lists the sources that run here, the held ones behind a disclosure with their count. Attach and Manage are not shown |
| RunLive (the run view against the collectors that exist) | Rebuilt from the component library (U1-c, 2026-10-07), full-bleed with the account menu at the header's end | Duration estimate, claims per source, per-run cost, model, pause and "Open case" are Backend: not shown, or an em dash with its reason. A lock withholds everything the stream had sent |
| Run (an earlier run view) | Superseded by RunLive | Shows collectors that do not exist (SpiderFoot, theHarvester, Shodan, HIBP, Brave) |
| Evidence | Rebuilt from the component library (U1-c, 2026-10-07), for a run and for a case | From the timeline read: at most 500 records, said to be partial beyond that. No claim text or hash column (the list carries neither; both are in the provenance drawer). Selection, saved views, Re-verify and Cite in report are Backend, so hidden |
| Workspace, Overview, Entities, Timeline, Graph | Rebuilt from the component library (U1-c, 2026-10-07), full-bleed, tabs in the drawn order (D6) | A run's results and a case's pins share the tabs; a case is labelled "Pinned items only" (cases and runs are not linked). The runs rail is on the Graph tab, as drawn. The written summary, contradictions and merge candidates are Not built cards; merge and replay actions are not built in U1-c. The timeline's range brush is not built (said on the tab) |
| Report, ReportPDF | Rebuilt from the component library (U1-c, 2026-10-07) as a run's Report tab | The report as stored, in its own wording, as one continuous document card with a sections rail and a citation rail, beside the stored PDF. The citation check is a Not built card. Editing, regenerating a section and review state are Backend, so hidden. A case's Report tab is a Not built card (case reports do not exist) |
| Media, Map | Not built cards (U1-c, 2026-10-07) | No upload, media forensics, coordinates, geo layers or external feeds |

## Copy corrections: mockup, then what ships

| Screen | Mockup says | Ships as | Why |
|---|---|---|---|
| SignIn | "An administrator in your organisation can reset your second factor" | "Lost your device? Use one of your backup codes." | No reset exists, and turning MFA off is forbidden |
| MfaEnrol | Rebuilt from the component library (U1-c, 2026-10-07) | Backup codes come before the final step, because confirming leaves the page. "Invited to [ORG] as [ROLE]" needs the invitation in the enrolment state (API), so it is not shown. The link state is a tag, not a pill |
| Run, RunLive | "Recording to case [CASE ID]", "Results stream into the case" | Not shown | Runs are not linked to cases; the audit log is tenant-wide |
| Run, RunLive, Report | Residency "In-region" | Not shown | Region headers are recorded, never interpreted |
| RunLive | "A failed collector is charged for the attempts it made" | Not shown until metering exists | Upstream requests are counted against quota; nothing is charged |
| RunLive | Common Crawl as MEDIAINT; "alternates: url" for a domain; Wikidata running for a domain | Shown as the API gives them | Common Crawl is TECHINT; a bare domain has no alternates; Wikidata takes organisations only |
| Workspace, Evidence, Timeline | crt.sh, DNS and Wayback evidence as OBSERVED | The strength the API gives (REPORTED) | Strength comes from the registry entry |
| Overview, Entities | "Merging requires a second independent identifier" | "A merge is recorded with its reason and can be undone" | A person may merge on name alone; only automatic name-only merges are refused |
| Entities | "Shared: display name, city" | The match signals the API gives | Candidates are matched on name only |
| Evidence | Rebuilt from the component library (U1-c, 2026-10-07), for a run and for a case | From the timeline read: at most 500 records, said to be partial beyond that. No claim text or hash column (the list carries neither; both are in the provenance drawer). Selection, saved views, Re-verify and Cite in report are Backend, so hidden |
| Workspace | Graph nodes in the claim-strength colours | The entity-class tokens (DESIGN-SYSTEM §2, added 2026-10-06) | In the graph a colour says what a node is; strength is said by the edge and in words |
| Entities | "First seen" | "Recorded" | The date is when the platform recorded the entity, not when it was first seen anywhere |
| Overview | "Coverage" by discipline with counts | Each source's status, and the gaps with their reasons | Evidence is not counted by discipline anywhere in the API |
| Report | "cannot cite pinned evidence" | "cannot cite this run's evidence" | Citations are checked against the run's evidence |
| ReportPDF | "Case [CASE ID]", "Independent sources" | The run and investigation; "Sources" | Reports are per run; independence of sources is not established |
| Map | "Conflict events: Needs key" | Licence-blocked | The source is blocked by its licence |
| Media | "Faces" analysis | Not shown | The face model is licence-blocked |
| Main | "Detects automatically: domain ip email phone username org image" | "Sources here run for:" with the target types the sources here accept | It lists what can run, from the registry; no upload exists, so no "image" |
| Main | Search placeholder "… or drop an image or document" | "Domain, IP, email, phone, username, company or URL" | No upload exists |
| Main | Collector health "Manage" | Not shown | No collector settings page exists |
| Main | (no caption) | "As the registry declares them. Live health is not measured." | The chips are the registry's availability, not a live check |
| MfaEnrol | "Invitation accepted"; "This link can enrol one device, once"; codes "expire after 30 seconds" | "Account setup"; "It stops working once enrolment is finished."; codes "change every 30 seconds" | What the token and TOTP actually do |
| Evidence | "Collector" column and facet | "Source" | The value is the registry's label; the collector id is in the drawer |
| Evidence | "Search evidence text, source or hash" | "Search source, URL or id" | The list carries no claim text or hash |
| Evidence | "Rows are never deleted; evidence is append-only." | "Evidence is append-only." | Retention and tenant deletion do remove evidence |
| Report | "Preview PDF" | "View PDF" | The panel shows the stored file, not a preview |
| RunLive | "Does not apply to a domain target" | The same sentence, built from the type's word | Unchanged in meaning; never the raw enum |

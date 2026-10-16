# Design System

The design language for Vestigo. Build every screen from these tokens and rules. If a screen needs something not defined here, add it here first rather than inventing it in a component.

**The 15 mockups in [design/mockups/](design/README.md) are the binding visual specification** (owner, 2026-10-06), as `legacy/` is for porting. Layout, hierarchy, spacing and wording come from the mockup; every value comes from this document. On 2026-10-06 (U1-a) every value here was reconciled against the mockups' HTML, read to exact values and checked against the PNG renders. Where a mockup breaks a rule that does not bend (accessibility, honesty, colour meaning), the rule wins and §12 records the deviation.

One goal governs everything: **a reader must be able to tell, at a glance, how strongly a claim is supported and whether a value was actually measured.** A design that makes weak evidence look strong is a defect, not a style choice.

---

## 1. Content rules

These are product rules, not writing suggestions. They are enforced in code elsewhere; the UI must not undo them.

- **Never fabricate.** A missing value renders as an em dash (`—`) with its reason, said where the reader can get it (an accessible name, not a hover-only tooltip). Never `0`, never `"N/A"`, never an empty string, never a plausible guess. `0` means measured and the count was zero.
- **Name the source.** Any claim, number or attribute opens the provenance drawer listing the evidence behind it.
- **Failures stay visible.** A collector that failed shows as failed, with its reason, beside the ones that succeeded. Partial results are labelled partial.
- **Two timestamps, always distinguished.** `observedAt` (when the thing happened) and `collectedAt` (when we saw it). A null `observedAt` renders as an em dash, never as the collection time.
- **Derived values are visibly distinct** from values a source stated. Anything inside an evidence record's `derived` block was computed by the platform.
- **Mockup numbers are placeholders.** A count, duration, credit figure or collector name drawn in a mockup is never shipped; every value comes from the API (design/README.md).
- **Voice:** plain, specific, unexcited. "Rate limited by provider, retrying in 40s" rather than "Something went wrong". No exclamation marks. Never congratulate the analyst on finding something.

---

## 2. Colour tokens

Define as CSS variables on `:root`, with a `[data-theme="dark"]` override. Light is primary; the dark dashboard mockup defines the dark values, and the rest are derived to the same contrast.

### Surfaces and chrome

| Token | Light | Dark | Use |
|---|---|---|---|
| `surface-page` | `#F5F5F1` | `#14161B` | App background behind all panels |
| `surface-raised` | `#FFFFFF` | `#1A1D23` | Cards, rails, headers, tab bars, docked drawers |
| `surface-sunken` | `#FCFCFA` | `#1F232B` | Graph canvas, workspace inputs, table header row, code and key blocks |
| `surface-hover` | `#F8F8F5` | `#22262E` | Selected table row, running collector row |
| `surface-field` | `#FFFFFF` | `#1F232B` | Auth inputs, the hero search shell, detect tags |
| `surface-control` | `#F5F5F1` | `#262B34` | Square icon controls at rest: the search bar's attach button, the account avatar |
| `surface-muted` | `#ECEBE4` | `#2A2E36` | Meter and progress tracks, media placeholders |
| `surface-map` | `#F1F0EA` | `#1F232B` | The map container's ground, under the basemap |
| `border-subtle` | `#EFEEE8` | `#24282F` | Dividers inside a card, table rules; never a card edge |
| `border-default` | `#E3E2DB` | `#2A2E36` | Card and panel edges, header and tab-bar rules, mini-progress track |
| `border-strong` | `#D6D5CC` | `#333944` | Inputs, secondary buttons, interactive at rest, dashed notes |
| `border-control` | `#E3E2DB` | `#333944` | Tags and the attach button: lighter than a button in light, as strong as one in dark |
| `border-input` | `#85878D` | `#757A84` | An edge that must be seen: every text input's border, and the vetting pill's outline. 3:1 or more against every ground in its theme (WCAG 1.4.11; §12, R2) |
| `ink-primary` | `#15171C` | `#ECECE7` | Headings, values, interface text |
| `ink-body` | `#24262C` | `#ECECE7` | Reading text: summaries, claim sentences, the report document, evidence cards |
| `ink-secondary` | `#3C3E45` | `#B6B8BF` | Secondary labels, inactive navigation and tabs' neighbours, collector names in tables |
| `ink-muted` | `#5E6066` | `#9A9DA5` | Captions, metadata, source lines, placeholders. The lightest permitted text colour; never below 11px |
| `accent` | `#22355B` | `#7B94C8` | Primary buttons, active tab underline, focus ring, meter fill, the selected graph node's outline |
| `accent-hover` | `#16233C` | `#A8BEE4` | A primary button under the pointer |
| `accent-soft` | `#E8ECF4` | `#26303F` | Selected navigation and runs, filter chips, the active density segment, neutral pills |
| `accent-ink` | `#22355B` | `#C8D8F2` | Text and icons on `accent-soft`; the active tab's label |
| `on-accent` | `#FFFFFF` | `#14161B` | Text on a filled accent button |
| `link` | `#22355B` | `#A8BEE4` | Standalone links: "All cases", "Cases", "Manage" |
| `link-hover` | `#16233C` | `#C8D8F2` | A link under the pointer |

### Claim strength

Six labels, in descending order of support. Each has a fill (background), an ink (text) and a mark (dot, ring, edge, timeline bar).

| Label | Meaning | fill (L/D) | ink (L/D) | mark (L/D) |
|---|---|---|---|---|
| `OBSERVED` | Seen directly by the platform | `#E7F1EA` / `#1D3227` | `#17543A` / `#8FD5AE` | `#1F6F4A` / `#55B183` |
| `REPORTED` | Stated by the cited source, unverified | `#E8ECF4` / `#232C3A` | `#1E4577` / `#A8BEE4` | `#2B5C9E` / `#7B94C8` |
| `DERIVED` | Computed by the platform from recorded values | `#EFE9F6` / `#2A2338` | `#523579` / `#C3AEE4` | `#6A4A9E` / `#9A7BD0` |
| `CORRELATED` | A link across independent cited sources | `#E7EFEF` / `#1B2C2C` | `#0F4F4F` / `#84CACA` | `#196B6B` / `#84CACA` |
| `INFERRED` | Analytic inference, no source stated it | `#F6EEDD` / `#33291A` | `#6B4510` / `#E0B872` | `#8A5A12` / `#C79A4E` |
| `HYPOTHESIS` | A possibility the evidence permits | `#ECEBE4` / `#272B33` | `#4A4C52` / `#B6B8BF` | `#808288` / `#7C8089` |

**Always render the word, never the colour alone.** Roughly one in twelve men has some colour vision deficiency, and that is this product's buyer demographic. Colour is a second channel.

Inferred content also carries a lighter treatment in context: a dashed edge in the graph, a tinted card (below), a 3px `claim-inferred-mark` rule beside report prose. Where an inference is shown, say what it was inferred from, in the words INFERRED and "from …", never borrowing another strength's word.

| Token | Light | Dark | Use |
|---|---|---|---|
| `claim-inferred-tint` | `#FDFAF3` | `#221E16` | The ground of an INFERRED evidence card, report paragraph or citation card |
| `claim-inferred-border` | `#F0E4CB` | `#4A3C22` | Its edge |

### Failure and collector status inks

| Token | Light | Dark | Use |
|---|---|---|---|
| `status-failed-fill` | `#F6E6E1` | `#33211C` | The Failed chip; error banner chip |
| `status-failed-ink` | `#7A2E1E` | `#E9A48F` | Failure text, including the reason and the code |
| `status-failed-mark` | `#A33F27` | `#C4644A` | Failure dot, error icon |
| `status-failed-tint` | `#FDF7F5` | `#241A18` | The ground of a failed row, an error alert, a coverage-limitation callout |
| `status-failed-border` | `#F0DCD5` | `#4A2A22` | Its edge |
| `status-needs-key-ink` | `#8A5A12` | `#E0B872` | The Needs key chip's word, on `claim-inferred-fill`: distinct from the INFERRED badge's darker ink |

### Entity class (added in Phase 6b)

The ring and fill of a node in the graph, by the class of entity it stands for. Used **only** for entity class, and always with the class written inside or beside the node (§6): colour is the second channel, never the only one.

Four families, as the screen designs group them: infrastructure (greens), contact (blues), person (purple), account (ambers), plus organisation (rose) and location (cyan). Within a family the classes step in lightness, so they differ in lightness and not hue alone (§7). Every ring meets 3:1 against `surface-sunken` in its theme. The Workspace mockup draws classes in the claim palettes; that is not followed (§12): in the graph, colour says what a node is, and claim strength is said by the edge and in words.

| Token | Light | Dark | Use |
|---|---|---|---|
| `entity-domain-ring` | `#1D6B47` | `#55B183` | Domain node ring (infrastructure) |
| `entity-domain-fill` | `#E5F0E9` | `#1D3227` | Domain node fill |
| `entity-ip-ring` | `#2E8A5E` | `#7FCFA3` | IP address node ring (infrastructure, lighter) |
| `entity-ip-fill` | `#E9F4EE` | `#1F3A2C` | IP address node fill |
| `entity-url-ring` | `#134A33` | `#3E9468` | URL node ring (infrastructure, darker) |
| `entity-url-fill` | `#E1ECE5` | `#18291F` | URL node fill |
| `entity-email-ring` | `#2A5CA0` | `#7B9DD6` | Email address node ring (contact) |
| `entity-email-fill` | `#E7EDF6` | `#232C3A` | Email address node fill |
| `entity-phone-ring` | `#1B3F70` | `#5A7FBF` | Phone number node ring (contact, darker) |
| `entity-phone-fill` | `#E3E9F3` | `#1E2633` | Phone number node fill |
| `entity-person-ring` | `#6A4A9E` | `#9A7BD0` | Person node ring |
| `entity-person-fill` | `#EFE9F6` | `#2A2338` | Person node fill |
| `entity-username-ring` | `#8A5A12` | `#C79A4E` | Username node ring (account) |
| `entity-username-fill` | `#F6EEDD` | `#33291A` | Username node fill |
| `entity-account-ring` | `#6B4510` | `#A87A32` | Social account node ring (account, darker) |
| `entity-account-fill` | `#F3EAD8` | `#2E2416` | Social account node fill |
| `entity-organisation-ring` | `#9A2F63` | `#D07AA6` | Organisation node ring |
| `entity-organisation-fill` | `#F5E6EE` | `#35212C` | Organisation node fill |
| `entity-location-ring` | `#0F5E66` | `#5BB5BD` | Location node ring |
| `entity-location-fill` | `#E3F0F1` | `#1A2E30` | Location node fill |

Node labels are `ink-primary` on the fill. The run's or case's seed entities are drawn with a wider ring of their own class colour. The selected node gets an `accent` outline outside its ring, so it never loses its class colour (the mockup's accent-filled focal node is not followed, §12).

### QR code (added in Phase 6b)

| Token | Light | Dark | Use |
|---|---|---|---|
| `qr-module` | `#15171C` | `#15171C` | The dark modules of the MFA enrolment QR code |
| `qr-ground` | `#FFFFFF` | `#FFFFFF` | Its background and quiet zone |

The same in both themes, deliberately: authenticator apps scan dark-on-light reliably and an inverted code unreliably. The mockup's `#FCFCFA` frame is not followed; pure white scans best.

### Colour discipline

Chrome is neutral. Colour means **claim strength, collector or run status, or entity class in the graph** (the `entity-*` tokens) — nothing else (ARCHITECTURE-DECISIONS §9). Anything decorative that borrows a semantic colour is a bug. Error alerts use the failure palette (a failure is a status). Everything else that a mockup tints — vetting, settings, review state, contradictions, map layers — is neutral or classed by entity (§12).

---

## 3. Collector and run status

The same vocabulary everywhere a collector appears. Statuses are pills (§9, status chip), always with their word.

| Status | Meaning | Chip (ink on fill · dot) |
|---|---|---|
| **Ready** | Before any run: it can run in this deployment (implemented, and its licence permits it or the deployment allows unverified sources) | `claim-observed-ink` on `claim-observed-fill` · `claim-observed-mark` |
| **Needs key** | No tenant credential configured | `status-needs-key-ink` on `claim-inferred-fill` · `claim-inferred-mark` |
| **Unavailable** | Registered and permitted, but it cannot run here now: a service it needs is not attached (the GPU media worker), or its source is cut off by an open circuit breaker. Say which | `claim-hypothesis-ink` on `claim-hypothesis-fill` · `claim-hypothesis-mark` |
| **Ran** | Finished, results attached | observed, as Ready |
| **Partial** | Finished, but some sub-queries were unsupported or dropped — say which | observed, as Ran; only the word differs |
| **Running** | In progress; a determinate bar where the source reports progress | `accent-ink` on `accent-soft` · `accent`; row ground `surface-hover` |
| **Queued** | Planned, waiting for a worker or for its next attempt (say when) | hypothesis, as Unavailable |
| **Failed** | With the reason, the code, the attempts and the retry or dead-letter state | `status-failed-ink` on `status-failed-fill` · `status-failed-mark`; row `status-failed-tint` with `status-failed-border` |
| **Skipped** | Policy or plan prevented the run (e.g. active scan without scope authorisation) | hypothesis |
| **Held** | Registered but not enabled (licence unverified, or held pending verification) | hypothesis |
| **Cancelled** | Stopped before it finished; nothing more will be collected | hypothesis |
| **Found nothing** | Ran, and the source had nothing for the target: a measured nothing, not a failure and not missing evidence (added in U1-b, D7) | hypothesis |
| **Unconfirmed** | Ran, and the source answered with nothing, but its empty answers are unreliable (GDELT): whether it holds anything is not known. Say what came back empty; never "Found nothing", never a count of zero, and it is a gap (added in Track M Day 2, D9) | hypothesis |
| **Locked** | Access to the run was withdrawn while it was open (the run stream's `locked` event): its reason, the code a fresh request would get, and how often access was checked while the stream was open (added in U1-b, D7) | hypothesis |

Eight statuses share the hypothesis grey (Unavailable, Queued, Skipped, Held, Cancelled, Found nothing, Unconfirmed, Locked) and differ by word alone. That is deliberate: none of them produced a result, and the word, never the colour, carries which.

**Run status** is a separate vocabulary on the run's own chip: QUEUED, RUNNING, SUCCEEDED (shown "Ran"), CANCELLED and FAILED as above, and **PARTIAL** in `claim-inferred-ink` on `claim-inferred-fill`, written in capitals as the run mockup draws it.

**Locked reasons** (the run stream's `reason`), each shown with its heading, the API's `detail` as sent, the code, and "Refused at …; access was checked every n s while the stream was open" (the stream closed with the lock, so nothing is re-checked after it): `CREDENTIAL_REVOKED` "Session or key no longer valid", `MEMBERSHIP_REVOKED` "No longer a member", `PERMISSION_LOST` "Role no longer allows this", `MODULE_NOT_IN_PLAN` "Person data not in the plan", `VETTING_NOT_APPROVED` "Vetting not approved". A lock belongs to the run, not to one collector: in a collector list it leads the list. A collector's Partial (green) and a run's PARTIAL (amber) are different words in different places and must not be confused.

A failed collector and a collector that found nothing must look obviously different: a failed row is tinted, its dot is the failure mark, its line is in failure ink and states the code.

---

## 4. Typography

| Family | Stack | Use |
|---|---|---|
| `sans` | `"IBM Plex Sans", "Segoe UI", system-ui, sans-serif` | All interface text |
| `mono` | `"IBM Plex Mono", ui-monospace, monospace` | Anything an analyst might copy, compare or verify: domains, hashes, IPs, identifiers, counts, timestamps |
| `serif` | `"IBM Plex Serif", Georgia, serif` | Reports: the printed page and the report document card in the app (Report.dc.html) — nowhere else in the UI |

Monospace is a signal that a value is literal data. Use it deliberately. An em dash inside a mono cell is set in `sans`, so it reads as a dash and not a hyphen.

Interface styles run at about 1.3× line height, as the mockups render; `prose` styles at 1.5–1.6× for reading.

| Style | Size / line height | Weight | Notes |
|---|---|---|---|
| `display` | 30 / 39 | 600 | `letter-spacing: -0.5px`. The dashboard question |
| `heading-auth` | 26 / 34 | 600 | `letter-spacing: -0.4px`. Sign-in title |
| `heading-page` | 24 / 31 | 600 | `letter-spacing: -0.4px`. Enrolment title |
| `heading-step` | 22 / 29 | 600 | `letter-spacing: -0.3px`. MFA challenge title |
| `title` | 20 / 26 | 600 | Page titles inside the app (Cases) |
| `heading` | 16 / 21 | 600 | Inspector entity name |
| `subtitle` | 15 / 20 | 600 | Run summary title, enrolment step titles |
| `wordmark` | 15 / 20 | 700 | `letter-spacing: -0.2px`. Product name beside the logo |
| `body` | 14 / 18 | 400 | Navigation, inputs, interface text |
| `body-strong` | 14 / 18 | 600 | Active navigation, case titles, primary buttons on auth and dashboard |
| `prose` | 14 / 22 | 400 | Reading text: summaries |
| `prose-lead` | 13.5 / 21 | 400 | Auth and enrolment leads |
| `ui` | 13 / 17 | 400 | Tabs, back links, collector names, stat labels |
| `ui-strong` | 13 / 17 | 600 | Active tab, alert titles, buttons at 34px |
| `section-label` | 13 / 17 | 600 | `letter-spacing: 0.4px`, uppercase card headings (Recent cases, Collectors) |
| `small` | 12.5 / 16 | 400 | Table cells in comfortable density, rail text, key-value rows |
| `small-strong` | 12.5 / 16 | 600 | Field labels, buttons at 32 and 36px, gap titles |
| `prose-small` | 12.5 / 19 | 400 | Notes, callouts, dashed honesty cards |
| `meta` | 12 / 16 | 400 | Meta lines, compact table cells, drawer values, card links |
| `meta-strong` | 12 / 16 | 600 | The vetting pill, filter chips |
| `caption` | 11.5 / 15 | 400 | Row meta, footers, legends |
| `caption-prose` | 11.5 / 17 | 400 | Footnotes, drop-zone text |
| `eyebrow` | 11 / 14 | 600 | `letter-spacing: 0.5px`, uppercase section labels |
| `overline` | 11 / 14 | 600 | `letter-spacing: 0.6px`, uppercase meter labels |
| `chip` | 11 / 14 | 600 | Status chips and count chips |
| `th` | 11 / 14 | 600 | `letter-spacing: 0.5px`, uppercase table headers (drawn 10.5px; raised so `ink-muted` stays at 11px or more) |
| `badge` | 10.5 / 14 | 600 | Claim badges in tables, cards, timeline, map and report (claim inks only, never `ink-muted`) |
| `mono-target` | 14 / 18 | 500 | Mono. The run's target in its header |
| `mono-value` | 14 / 18 | 400 | Mono. Stat and cost values |
| `mono-body` | 13 / 17 | 400 | Mono. Counts, ranges, keys |
| `mono-small` | 12.5 / 16 | 400 | Mono. Attribute values, entity identifiers, dates |
| `mono-meta` | 12 / 16 | 400 | Mono. Detect tags, table hashes and times, drawer values, keycaps |
| `mono-caption` | 11.5 / 15 | 400 | Mono. Counts in rails and legends, citation numbers |
| `mono-otp` | 22 / 29 | 400 | Mono. `letter-spacing: 7px`. One-time code input |
| `metric` | 21 / 27 | 500 | Mono. Large single numbers |
| `serif-title` | 23 / 30 | 600 | Serif. Report document section title |
| `serif-body` | 14.5 / 25 | 400 | Serif. Report document body |

Print (the PDF) has its own type in points (`packages/integrations`), not tokens: body 12pt/1.65 justified, headings 19pt and 13pt, labels as bracketed capitals for greyscale.

---

## 5. Spacing, radius, shadow, sizes

**Spacing.** The mockups step in single pixels, so the scale has quarter steps of 4px (`space-2.25` is 9px; the class is `p-2.25`). Rhythm: a title to its meta line 2–5px; inside a card 12–14px; between cards 16–20px; section to section 26–34px; page gutters `space-10` on workspace and run screens, `space-16` on the dashboard.

| Token | Value | Use |
|---|---|---|
| `space-0` | 0px | Flush edges (`top-0`, `right-0`) and `min-w-0` letting a flex child shrink |
| `space-0.25` | 1px | Badge vertical padding, optical offsets |
| `space-0.5` | 2px | Tab gap, navigation list gap, keycap and small badge vertical padding |
| `space-0.75` | 3px | Chip vertical padding, text-stack gaps |
| `space-1` | 4px | Icon-to-label gaps, unmeasured caption gap |
| `space-1.25` | 5px | Title to meta, vetting pill vertical padding, eyebrow to heading |
| `space-1.5` | 6px | Small badge horizontal padding, compact cell gaps |
| `space-1.75` | 7px | Label to input, pill dot gap, key-value gap, toolbar gaps |
| `space-2` | 8px | Chip rows, button pairs, small badge row gap |
| `space-2.25` | 9px | Status chip horizontal padding, case-header right cluster gap |
| `space-2.5` | 10px | Navigation item padding, table cell horizontal, toolbar vertical |
| `space-2.75` | 11px | Navigation icon gap, vetting pill horizontal, nested card padding |
| `space-3` | 12px | Table cell horizontal (comfortable), meter box padding, card inner gaps |
| `space-3.25` | 13px | Tab horizontal padding, secondary button and input horizontal padding |
| `space-3.5` | 14px | Navigation horizontal padding, card-header margin, overlay offsets |
| `space-3.75` | 15px | Primary button horizontal padding, alert horizontal padding |
| `space-4` | 16px | Docked drawer section padding, rail padding, list gaps |
| `space-4.5` | 18px | Card padding, Evidence content padding and gap |
| `space-5` | 20px | Card horizontal padding on run cards, grid gutters (dashboard, overview) |
| `space-5.5` | 22px | App header horizontal padding, run view column gap |
| `space-6` | 24px | Enrolment step padding, run view grid gap |
| `space-6.5` | 26px | Navigation column gap, auth block gap |
| `space-7` | 28px | Entities body horizontal padding |
| `space-8` | 32px | Section separation |
| `space-8.5` | 34px | Dashboard hero to grid, report document padding |
| `space-9` | 36px | Run view horizontal page padding |
| `space-10` | 40px | Workspace page gutters |
| `space-13.5` | 54px | Dashboard content top |
| `space-14` | 56px | Enrolment frame vertical padding |
| `space-16` | 64px | Dashboard content horizontal padding |

| Token | Value | Use |
|---|---|---|
| `radius-bar` | 3px | Progress and meter bars (half their height); not a pill |
| `radius-xs` | 5px | Claim badges, the ⌘K keycap |
| `radius-sm` | 6px | Tags, icon buttons in rows, backup-code cells |
| `radius-md` | 8px | Buttons, inputs, navigation rows, run and collector rows, logo tile |
| `radius-inner` | 9px | Cards nested in a card, legends, alerts, the hero search's buttons |
| `radius-box` | 10px | The credits box, the QR frame, the map's floating card |
| `radius-lg` | 12px | Cards and panels |
| `radius-xl` | 14px | The hero search bar |
| `radius-pill` | 999px | Status chips, count chips, the vetting pill, dots and avatars **only** — a pill that is not a status is wrong |

| Token | Value | Use |
|---|---|---|
| `shadow-card` | `0 1px 2px rgba(21,23,28,0.05)` | The dashboard's hero search bar. Nothing else is raised |
| `shadow-overlay` | `0 8px 24px rgba(21,23,28,0.12)` | The command palette, popovers and the account menu (floating layers only). In dark, overlays also carry a `border-default` edge, because the shadow does not show |

**Sizes.**

| Token | Value | Use |
|---|---|---|
| `target-min` | 44px | Smallest hit area of any interactive control (§7) |
| `control-sm` | 32px | Visual height of workspace header buttons, filter chips and workspace inputs; the hit area extends to `target-min` |
| `control-md` | 36px | Visual height of drawer, rail and callout buttons; the hit area extends to `target-min` |
| `row-compact` | 44px | Table row height in compact density (the mockups' 31–39px rows cannot hold 44px targets, §12) |
| `row-comfortable` | 52px | Table and collector row pitch in comfortable density |
| `focus-ring-width` | 2px | The focus outline (§7) |
| `focus-ring-offset` | 2px | Gap between a control and its focus outline (§7) |
| `tab-indicator-width` | 2px | The active tab's underline |
| `dot` | 9px | Status and legend dots |
| `dot-sm` | 8px | Alert and gap dots |
| `dot-xs` | 7px | The vetting pill's dot |
| `bar-lg` | 6px | Run progress bar |
| `bar-md` | 5px | Credits meter bar |
| `bar-sm` | 4px | A row's mini progress |
| `icon-sm` | 15px | Icons in buttons and inline |
| `icon` | 17px | Navigation icons |
| `icon-lg` | 19px | Search and hero icons |
| `avatar` | 34px | The account avatar (inside a 44px button) |
| `logo-tile` | 30px | The product mark's tile |
| `otp-height` | 52px | One-time code input |
| `mini-progress-width` | 190px | A running row's progress bar |
| `timeline-date-col` | 132px | The timeline's date column |
| `layout-header-height` | 56px | The app header (dashboard, run view) |
| `layout-case-header-height` | 54px | The case header (workspace screens) |
| `layout-tabbar-height` | 44px | The workspace tab bar |
| `layout-form-width` | 500px | Single-column forms: sign-in, MFA challenge |
| `layout-page-width` | 880px | A single-column page wider than a form: MFA enrolment |
| `layout-nav-width` | 216px | The side navigation |
| `layout-search-width` | 780px | The dashboard's search bar |
| `layout-drawer-width` | 350px | The docked inspector and provenance drawer (one component, §9) |
| `layout-runs-rail-width` | 232px | The workspace runs rail |
| `layout-side-rail-width` | 330px | The Entities rail and the report's citation rail |
| `layout-report-nav-width` | 226px | The report's section navigation |
| `layout-map-rail-width` | 280px | The map's layers rail |
| `layout-media-rail-width` | 300px | The media rail |
| `layout-document-width` | 680px | The report document card's text column |
| `layout-palette-width` | 560px | The command palette (not drawn; sized to the search bar's proportions) |
| `qr-size` | 150px | The MFA enrolment QR code |
| `qr-frame` | 188px | Its frame |

**Density.** Two modes. *Comfortable*: `row-comfortable` rows, `small` cells, `space-3` cell padding. *Compact*: `row-compact` rows, `meta` cells, `space-2.5` cell padding. Compact is the default in the Evidence grid. Rows never go below `row-compact`, because they hold 44px targets.

---

## 6. Iconography

Line icons (lucide), 1.9px stroke, 24px grid, rendered at `icon-sm`, `icon` or `icon-lg`, inheriting `currentColor`. No filled icons, no two-tone, **no emoji anywhere in the product**. Icon-only buttons always carry an `aria-label`. Entity classes in the graph are distinguished by ring colour **and** a text label inside the node.

---

## 7. Accessibility

- Text meets 4.5:1 against its surface in both themes (every pair in this document is computed). `ink-muted` is the lightest permitted text colour and is never set below 11px. Placeholders are `ink-muted`.
- **Targets.** Every interactive control has a hit area of at least `target-min` (44px) in both dimensions. A control drawn smaller (`control-sm`, `control-md`, a 26–28px icon button) keeps its drawn look and extends its hit area invisibly to 44px, provided the extension overlaps no neighbouring target; where it would, the control grows instead. Rows that hold targets are at least `row-compact`.
- **No interactive links inside running prose.** A link that would sit inside a sentence is set after it as a standalone link with its own 44px hit area (WCAG's inline-link exemption is not taken, §12).
- Focus is visible on every control: `accent`, `focus-ring-width`, with `focus-ring-offset`.
- Every control is a real `<button>`, `<a href>` or labelled `<input>`. Nothing interactive is a `div`. Toggles carry `aria-pressed`; the workspace tabs are links with `aria-current="page"`; a removable chip's name says "Remove filter …".
- Selection and state are never carried by a row tint alone (the tints are 1.06–1.18:1): the selected row also changes weight or carries `aria-selected`, and the running row its word.
- The graph and map canvases have an equivalent list that can be reached and used by keyboard.
- Entity and status distinctions differ in lightness, not hue alone.
- Every form input has a label, visible or screen-reader-only.

---

## 8. Required states

Every data surface designs these explicitly. None may be left to a default spinner.

| State | Requirement | Design |
|---|---|---|
| **Empty** | Says what would appear here and how to get it. First-run empty states are onboarding. | A card (`surface-raised`, `border-default`, `radius-lg`, `space-4.5`): `ui-strong` title, `prose-small` sentence in `ink-secondary`, and the one action that fills it |
| **Not built** | A tab or panel whose analysis does not exist yet. | The empty card, titled with what the tab will show, saying plainly that it is not built yet and what it needs. No sample data, no greyed fake content |
| **Loading** | Skeletons matching the real layout, not a centred spinner. | `surface-sunken` blocks in the layout's shape, with a `role="status"` line saying what is being read |
| **Partial** | Says what is missing and why. Never presents partial data as complete. | A notice (`accent-soft`, `accent-ink`): bold "Partial: n of N …" and the reason |
| **Failed** | The reason, the code, the retry state, and what the user can do. | An alert (`status-failed-tint`, `status-failed-border`, `radius-inner`): a `status-failed-mark` dot, `ui-strong` title in `status-failed-ink`, the reason in `prose-small` `ink-secondary`, the code in `mono-caption`, and the action |
| **Stale** | When data was read, where that matters. | "Read at" with the time in `mono-meta`, and Refresh |
| **Locked** | What the module does, why it is off (plan or vetting), and the next step. Sells, never scolds. | A neutral notice: eyebrow "Locked", what the module does, what was withheld and why, the next step in `body-strong`, the reason code in `mono-caption` |

---

## 9. Patterns and components

Exact values from the mockups; tokens from §2–§5. Each names the mockup it matches.

**App header row** (Main, Dashboard-dark). `layout-header-height`, `surface-raised`, `border-default` bottom, padding 0 `space-5.5`. Left: the command-palette button. Right, gap `space-3.5`: the vetting pill, then the account button. Narrower than both groups need (phone width, not drawn), it wraps as the case header does, with `space-1.25` above and below and a `space-2` row gap, and the organisation's name truncates; nothing overlaps.

**Command-palette button and palette** (Main). The button: a `⌘K` keycap (`mono-meta`, `ink-muted`, 1px `border-default`, `radius-xs`, padding `space-0.5` `space-1.5`; "Ctrl K" off Apple platforms) and "Command palette" in `meta` `ink-muted`, gap `space-2.25`, hit area 44px. The palette (not drawn): a floating layer `layout-palette-width` wide, `shadow-overlay`, `radius-lg`; a 44px input; result rows 44px; arrow keys move, Enter opens, Escape closes and returns focus; empty, loading and no-results states as §8.

**Account menu.** The account button: an `avatar` circle (`surface-control`, 1px `border-default`, initials `ui-strong` `ink-secondary`) inside a 44px button named "Account". The menu: a popover (`shadow-overlay`, `radius-lg`, `space-4`), rows 44px: the person, Switch organisation, the theme as a radio pair (Light, Dark), Sign out.

**Vetting pill** (Main). An outlined pill: `meta-strong` in `ink-secondary`, padding `space-1.25` `space-2.75`, a 1px `border-input` edge, **no fill and no dot**, its word from the tenant's vetting status: Verified tenant, Vetting pending, Vetting not submitted, Vetting rejected, Vetting suspended. Every status chip is filled, so the outline alone tells vetting from a status, without colour (§12, D1 and R3).

**Credits meter** (Main). A box (`border-default`, `radius-box`, `space-3`) at the foot of the navigation: `overline` "Credits this month", the figure in `metric` with "of [limit]" in `meta` `ink-muted`, a `bar-md` bar (`surface-muted` track, `accent` fill, `radius-bar`), `role="meter"`. **No credit metering exists**: until it does the figure is an em dash with its reason and there is no bar (a bar at any width would be a fabricated value).

**Navigation** (Main). `layout-nav-width`, padding `space-5` `space-3.5`, gap `space-6.5`. Product mark: `logo-tile` `accent` tile (`radius-md`) and `wordmark`. Items: 44px, padding `space-2.5`, gap `space-2.75`, `radius-md`, `body`; inactive `ink-secondary`, active `accent-soft` with `body-strong` `accent-ink`; `icon` icons. Only built destinations are listed. Below `md` (not drawn) the side navigation is not shown; the same destinations are a plain row of tab links under the app header (the tab bar's look, `aria-current` and the underline on the current one). It is not a navigation sheet: that stays raised (U1-c).

**Case header and tabs** (Workspace and the six tab mockups). Header `layout-case-header-height`: "Cases" link (`ui-strong`, `link`), a divider (1px `border-default`), the case name in `body-strong`, right cluster gap `space-2.25`. Tab bar `layout-tabbar-height`, `surface-raised`, `border-default` bottom, padding 0 `space-4`, gap `space-0.5`. Tabs in the drawn order — Overview, Entities, Graph, Timeline, Evidence, Media, Map, Report — padding 0 `space-3.25`, `ui` `ink-muted`; the active tab `ui-strong` `accent-ink` with a `tab-indicator-width` `accent` underline.

**Card** (all). `surface-raised`, 1px `border-default`, `radius-lg`, no shadow, padding `space-4.5` (run cards `space-4.5` `space-5`). Header row: `section-label` in `ink-muted`, a standalone link or count chip right. Inner dividers `border-subtle`. A nested card: 1px `border-subtle`, `radius-inner`, padding `space-2.75`–`space-3`. A dashed note: 1px dashed `border-strong`, `radius-lg`, `prose-small` `ink-secondary`.

**Status chip** (Main, Run, RunLive). A pill: `chip`, padding `space-0.75` `space-2.25`, no border, no icon, about 20px tall, ink and fill from §3. In a row it pairs with a `dot` of the matching mark. A count chip ("6 ran") is the same shape.

**Claim badge** (Workspace, Entities, Evidence, Timeline, Map, Report). Literal capitals. *md*: `chip`, padding `space-0.75` `space-2`, `radius-xs`. *sm*: `badge`, padding `space-0.5` `space-1.5`, `radius-xs`. Ink on fill from §2. Never a pill.

**Tag** (Main: "domain", "ip"…). `mono-meta`, padding `space-0.75` `space-2`, `radius-sm`, 1px `border-control`, `surface-field`. Not a status, so not a pill.

**Removable filter chip** (Evidence). A `<button>`, `control-sm` visual, padding 0 `space-2.75`, `radius-md`, 1px `accent` border, `accent-soft`, `meta-strong` `accent-ink`, label "Facet: value ×", accessible name "Remove filter Facet: value"; the whole chip removes. The add chip: 1px dashed `border-strong`, `surface-raised`, `meta` `ink-secondary`, "+ Filter". When chips wrap, the row gap is at least `space-3` so hit areas do not overlap. A filter offered on or off (a toggle chip, not drawn) is the same shape with `aria-pressed`: on as the removable chip, off as a secondary control (`border-strong`, `surface-raised`, `ink-secondary`), `meta-strong` either way so the chip never changes width.

**Data table — the Evidence grid** (Evidence; Entities). A card with no padding; at phone width the table scrolls sideways inside it, never the page. Toolbar: padding `space-2.5` `space-3.5`, `border-subtle` bottom, gap `space-2`, wraps; search input `control-sm`, `surface-sunken`, a 1px `border-input` edge, a visually hidden label. Header row: `surface-sunken`; `th` in `ink-muted`, padding `space-2` `space-2.5`, `border-subtle` bottom; sortable headers are buttons with `aria-sort` and an `icon-sm` chevron (`ink-muted`, `ink-secondary` when active). Rows `row-compact` or `row-comfortable`, `border-subtle` rules; claim text `ink-primary`, collector `ink-secondary`, times and hash in `mono-meta` (observed `ink-secondary`, collected and hash `ink-muted`), hash shortened 4…3 with the whole hash in the drawer. Selection column: native checkboxes, `accent` accent colour, "Select row n" / "Select all rows". Per-row action column: a 26px pin button (`radius-sm`) with a 44px hit area — unpinned `border-strong` "+", pinned `accent` border on `accent-soft` "✓", `aria-pressed`, "Pin row n to case". Footer: padding `space-2.5` `space-3.5`, `caption` `ink-muted`: "n selected · n of N rows" left, "Rows are never deleted; evidence is append-only." right. Density toggle (Entities): a segmented pair, `control-sm`, 1px `border-strong`, `radius-md`; off `ink-muted` on `surface-raised`, on `small-strong` `accent-ink` on `accent-soft`, `aria-pressed`.

**Inspector and provenance drawer** (Workspace, Evidence). **One component**: docked right, `layout-drawer-width`, full height, `surface-raised`, `border-default` left, no shadow. A title row (eyebrow, a close button with a 44px hit area). Sections padded `space-4` `space-4.5`, divided by `border-subtle`: the subject (`heading`, badges, Pin), a key-value list (gap `space-2.25`; keys `meta` `ink-muted`, values `mono-meta` right-aligned; a missing value is an em dash with its reason), lists. Provenance shows collector and version, run, observed and collected apart, content hash, source URL, and the raw payload as a download ("Download raw payload": an attachment, never opened in the app, CLAUDE.md §9). A footer action pair pinned to the bottom: gap `space-2`, both equal width, `control-md` visual, secondary then primary — only actions that exist.

**Metric and cost card** (RunLive). A card, padding `space-4.5` `space-5`, gap `space-3`: rows label (`ui` `ink-muted`) and value (`mono-value` `ink-primary`), baseline-aligned; a footnote in `caption-prose` `ink-muted`. **Cost shown twice**: "Estimated before the run" and "Spent so far"; each is an em dash with its reason while the API records neither per run.

**"Arriving now" list** (RunLive). A card, gap `space-3.25`: rows label (`ui` `ink-primary`) and value (`mono-value`), `border-subtle` between rows. An unmeasured value is an em dash with, under it, a `caption` line: "Not measured — <cause>", in `status-failed-ink` when a failure is the cause and `ink-muted` when the platform simply does not record it (colour means status, §2).

**Run view** (RunLive). Header `layout-header-height`: back link, divider, `mono-target`, the detected-type tag, alternates in `caption` `ink-muted`; right, the run's status chip. Body padding `space-6` `space-9`, a 12-column grid, gap `space-5.5`, split 8/4; cards stack gap `space-4`. Collector rows: `row-comfortable` pitch, padding `space-2.25` `space-3`, `radius-md`, a `dot`, name in `ui-strong`, meta in `caption`, the chip right; a running row adds a `bar-sm` mini progress `mini-progress-width` wide (track `border-default`, fill `accent`).

**Graph shell** (Workspace). The canvas fills its area on `surface-sunken`. A toolbar overlay top-left (`space-4`, `space-3.5`), gap `space-1.75`: Layout, hops, Hide inferred (`aria-pressed`) — `control-sm` buttons with 44px hit areas. A legend overlay bottom-left: `surface-raised`, 1px `border-default`, `radius-inner`, padding `space-2.5` `space-3`, gap `space-3.5`: every entity class present (dot and word) and the edge key in words (solid: stated or derived; dashed: inferred or hypothesis). Edges `border`-weight lines in `claim-hypothesis-mark`; weak edges (every claim inferred or hypothesis) dashed with their word, and amber (`claim-inferred-mark`) only where every claim is INFERRED: a hypothesis edge stays neutral.

**Runs rail** (Workspace). `layout-runs-rail-width`, padding `space-4` `space-3`, gap `space-4.5`. Run rows: real buttons, 44px, padding `space-2.25` `space-2.5`, `radius-md`; target `mono-meta` (selected `accent-ink` on `accent-soft`), meta `caption` `ink-muted`. Discipline filters: 44px label rows, a checkbox, the discipline word in `small` `ink-secondary`, its count in `mono-caption` right — counts only where measured. "Pinned to case" at the foot, `border-subtle` above.

**Evidence card** (Workspace). 1px `border-subtle`, `radius-inner`, padding `space-3`, gap `space-1.75`: a top row with the sm claim badge and a pin button (44px hit area); the text in `prose-small` `ink-body`; a source line in `caption` `ink-muted`: "source · observed … · collected … · hash …" (the hash shortened 4…3; added in U1-b so a card can be matched to its record). A collector that ran and found nothing has its own neutral card with the Found nothing chip, never an empty evidence card. INFERRED cards on `claim-inferred-tint` with `claim-inferred-border`, saying what they were inferred from.

**Map shell** (Map). Layers rail `layout-map-rail-width`, padding `space-4` `space-3.5`: 44px rows with a checkbox, a `dot` in the layer's entity class, the name in `small`, a mono count right. The container `surface-map`, MapLibre filling it. A legend bottom-left as the graph's. A floating selected-point card top-right: `radius-box`, padding `space-3.5` `space-4`, key-value rows, a full-width secondary button. Point colours are entity classes, never claim colours (§12).

**Buttons.** *Primary*: `accent`, `on-accent`, hover `accent-hover`, `radius-md`, weight 600. *Secondary*: `surface-raised`, 1px `border-strong`, `ink-secondary`, weight 600. Visual heights: 44 (auth and dashboard, `body-strong`, padding 0 `space-5`), `control-md` 36 and `control-sm` 32 (`small-strong`, padding 0 `space-3.25` secondary, `space-3.75` primary) — every one with a 44px hit area.

**Inputs.** Every text input's edge is 1px `border-input` (3:1, §12 R2), whatever the mockup draws. Auth: 44px, padding 0 `space-3.25`, `radius-md`, `surface-field`, `body`. One-time code: `otp-height`, `surface-sunken`, `mono-otp`. Workspace search and filters: `control-sm`, `surface-sunken`, `meta`. Hero search shell: `layout-search-width`, `surface-field`, 1px `border-input` (R2; the mockup's `border-strong` is 1.43:1), `radius-xl`, padding `space-3.5` `space-4`, `shadow-card`, a borderless input and 44px buttons (`radius-inner`; the attach button `surface-control` with `border-control`). Labels `small-strong` `ink-secondary`, gap `space-1.75`.

**Report document card** (Report). The run's report as stored, on a card with the text column `layout-document-width`: `serif-title`, `serif-body` in `ink-body`, citation markers as superscript numbers in the prose, opened from a row of standalone 44px citation buttons after the paragraph (D8); INFERRED sentences with a 3px `claim-inferred-mark` rule on `claim-inferred-tint`; coverage limitations in a failed-tint callout. A section rail `layout-report-nav-width` and a citation rail `layout-side-rail-width`.

**Pin-to-case.** Present on **every** result surface, including direct tool panels. The predecessor's worst structural flaw was that tool panels could not feed a case.

**Cost shown twice.** Estimated before a run starts, actual after it finishes. Surprise bills lose customers.

**Evidence as a grid, not cards.** Cards suit the inspector; the Evidence tab is a sortable, filterable grid, compact by default.

**Attribution.** Sources that require attribution (GDELT: citation on redistribution; HIBP: visible link) must have it rendered wherever their data appears. A source requiring attribution with nowhere to render it is a bug.

---

## 10. White-labelling

Per-tenant themes may override `accent`, `accent-hover`, `on-accent`, `link`, `link-hover` and the `surface-*` family **only**. The claim, status and entity families are fixed, because their meaning must not vary between tenants.

---

## 11. Implementation

Tailwind with shadcn/ui, mapping these tokens to CSS variables at the theme layer. Components never hard-code a hex value, a pixel spacing or a font stack — everything comes from a token. A pull request introducing a raw colour is a review failure. The guard (`packages/config/scripts/design-system-guard.test.ts`) holds `tokens.css` to this document value for value, and `apps/web/scripts/tailwind-classes.test.ts` fails on any class that generates no CSS.

**The component library** (U1-b) is in `packages/ui`, one file per §9 component, presentational only: components take props and the screens supply data. The review surface is the dev-only gallery at `/dev/gallery` (every component in every state, labelled with its mockup, in light, dark, or both side by side); it is not in a production build.

- **Hit areas.** A control drawn smaller than `target-min` carries the `hit-area` utility (`packages/ui/src/components.css`): an invisible box centred on it, at least `target-min` in both dimensions. Rows that hold targets are at least `row-compact`.
- **No raw hex.** `packages/ui/scripts/no-raw-hex.ts` runs before every build of the package and in its tests; a hex colour anywhere in its source but `tokens.css` fails the build.
- **Serif scope.** `ReportSurface` (`report-surface.tsx`) is the only component that applies the serif, and only to the report's own title and prose, so a badge or citation marker inside stays sans. `packages/ui/src/serif-scope.test.ts` fails if the serif appears in any other source file.
- **Graph theme.** `graphStylesheet` builds the Cytoscape style from tokens read where the graph is drawn, so a region with its own `data-theme` draws in that theme.

---

## 12. Where the mockups yield, and decisions for the owner

The mockups are binding; these are the only places they are not followed, each because a rule that does not bend wins, or because the mockup draws data the API does not have (design/README.md lists those).

**Accessibility and honesty (rule wins):**

| Mockup draws | Rule | Built as |
|---|---|---|
| Controls 26–40px (header and toolbar buttons, chips, inputs, pin and close buttons, pagination, density segments) | 44px targets | Drawn look kept; hit area extended to 44px, or the control grows where an extension would overlap |
| Table rows 31px (Entities) and 39px (Evidence) holding pin buttons and checkboxes | 44px targets | `row-compact` 44px |
| Checkbox and run rows 16–37px with 9–11px gaps (rails, layers, recent cases, key entities, report sections) | 44px targets | 44px rows |
| Links inside sentences ("review", "Compare sources") | 44px targets | Standalone links after the sentence (owner decision D2) |
| Table headers at 10.5px in `ink-muted` | `ink-muted` never below 11px | `th` 11px |
| Placeholder colour not set (browser default 4.49:1) | 4.5:1 | `ink-muted` |
| Graph edges `#CFCEC6` and `#B79C6A` (1.54 and 2.56:1) | Non-text 3:1 | `claim-hypothesis-mark` and `claim-inferred-mark` |
| The hypothesis grey dot `#8E9096` (2.70–2.92:1 on the page, `accent-soft`, `surface-muted` and `surface-map`) | Non-text 3:1 on every ground a dot sits on (U1-b review) | Light `claim-hypothesis-mark` `#808288` (3.21:1 or more on every light ground) |
| Credits "[N] of [PLAN LIMIT]" with a filled bar | Never fabricate (no credit metering exists) | An em dash with its reason, no bar |
| Mono em dashes reading as hyphens | Never fabricate (an unmeasured value must read as unmeasured) | The dash set in `sans` |
| Input borders in `border-strong`/`#D6D5CC` (1.43:1 light, 1.46:1 dark against the input ground) | Non-text 3:1: an input's edge identifies it (WCAG 1.4.11) | `border-input`, 3:1 or more on every ground in both themes (R2, owner 2026-10-07) |
| Key-value rows about 24px apart, an absent value a bare dash | 44px targets (the dash is a control: it gives its reason) | A row holding an em dash is 44px tall; the others keep their pitch |
| Citation markers inline and adjacent ("[2][3]") in 25px leading | 44px targets without overlap | Markers are text; a row of standalone 44px citation buttons follows the paragraph (D8) |
| A table header row of about 35px holding the select-all checkbox and sort buttons | 44px targets | The header row is `row-compact` |

**Colour discipline (ARCHITECTURE-DECISIONS §9, rule wins):**

| Mockup draws | Built as |
|---|---|
| Graph nodes in the claim palettes; the focal node filled `accent` | `entity-*` classes; the selected node outlined in `accent` (D3) |
| Map layers in claim colours ("Reported event" amber) | Points by entity class (D5) |
| Run settings pills green and navy ("Passive only", "In-region") | Neutral tags |
| Contradiction callouts in inferred amber | Neutral callouts titled "Contradiction"; amber only on an INFERRED item |
| Report "Unreviewed" amber pill; citation check in green | Neutral (and not built: no review state exists) |
| Non-status pills ("Detected: domain", "3 runs") | `radius-sm` tags |
| Run progress with an unlabelled amber segment | One `accent` fill with the count in words |
| Timeline bars coloured by strength without words | A legend with the strength words |
| Media status chips at `radius-sm` | Pills |

**Decisions for the owner** (the default, rule-compliant choice is built; say if you want the mockup instead):

- **D1. Vetting pill colour.** The mockup draws "Verified tenant" green. Vetting is not one of the three meanings colour may carry, so it is built neutral. Since U1-b (R3) it is told from a status by shape, an outline with no fill and no dot, because its first neutral form (`accent-ink` on `accent-soft`, `accent` dot) was the Running chip's three tokens.
- **D2. Inline links.** Built as standalone links. The alternative is to adopt WCAG 2.5.8's exemption for links inside sentences.
- **D3. Focal graph node.** Built with its class colour and an `accent` outline. The alternative is the mockup's filled accent node, which hides its class.
- **D4. Serif in the app.** Adopted from the mockup for the report document card (§4). This changes the previous "printed reports only" rule; say if you want the card in sans.
- **D5. Map point colours.** Built by entity class. The alternative is a fourth colour meaning, "map layer".
- **D6. Tab order.** The drawn order (Overview, Entities, Graph, Timeline, Evidence, Media, Map, Report) is adopted; the app currently orders Evidence before Graph.
- **D7. Found nothing and Locked** (added in U1-b). Both are drawn in the hypothesis grey with their word: neither produced a result, as with the five grey statuses before them (§3). The alternatives are green for Found nothing (it ran successfully, and the nothing is measured) or a neutral `accent-soft` chip for Locked (as §8's Locked notice is neutral).
- **D8. Citations in the report** (added in U1-b). Markers sit side by side in prose leading, so 44px hit areas on each would overlap (§7). Built as D2 does for links: the markers are text, and the citations open from a row of standalone 44px buttons after the paragraph. The alternative is WCAG 2.5.8's inline exemption, keeping the markers as the controls.
- **D9. Unconfirmed** (added in Track M Day 2, for the owner's review). Drawn in the hypothesis grey with its word, as Found nothing (D7): it produced no result. Its row says what came back empty in the collector's words, never "0 evidence records", and the Overview lists it as a gap. The alternative is the Needs key amber, to set it apart from a measured nothing by colour as well as word.

**Raised at U1-b, decided by the owner on 2026-10-07.** D7, D8, R1, R4–R7, R10 and the dark avatar's `border-default` edge on `surface-control` (1.04:1; its initials identify the button) are **accepted as built**. R2 and R3 were **fixed** (above, and §9). R8 and R9 are **deferred** (R8: IBM Plex Serif to be self-hosted later; R9: MapLibre GL arrives with GEOINT).

- **R1. Small icon buttons.** The pin and drawer-close buttons are drawn 26px (Evidence) and 28px with a lucide pin glyph (Workspace cards); no token is 26px. Built at `control-sm` (32px) with a "+"/"✓" and "×" glyph and a 44px hit area. Add a 26px icon-button token, or keep 32px.
- **R2. Input borders. Fixed.** `border-strong` was 1.43:1 (light) and 1.46:1 (dark) against the input ground, and the workspace search input's only edge once its placeholder is gone. Every text input now takes `border-input` (§2), 3:1 or more on every ground in both themes; the deviation from the mockups is recorded above.
- **R3. Vetting pill and the Running chip. Fixed.** D1's first neutral pill was the Running chip's three tokens. It is now told apart by shape, not colour: an outline (`border-input`), no fill, no dot (§9). A test holds it apart from every status chip.
- **R4. Report card width.** §9 makes the text column `layout-document-width` (680); the Report mockup makes the whole card 680, centred, padded 34 by 40. Built as §9 says.
- **R5. The run chip's size.** Run.dc.html draws chips at `space-0.75` `space-2.25`; RunLive.dc.html draws the run's PARTIAL at 4px by 11px. Built at the §9 size everywhere.
- **R6. Map selected-point card width.** Drawn 250px; no token is 250. Built at `layout-side-rail-width` (330).
- **R7. Card headings.** RunLive draws card headings at 12px with 0.5px tracking; §9 Card names `section-label` (13px, 0.4px). Built as §9 says.
- **R8. Deferred.** The IBM Plex Serif face is not loaded (it would be a new dependency, `@fontsource/ibm-plex-serif`); the report card falls back to Georgia until it is.
- **R9. Deferred** to GEOINT. MapLibre GL is not installed (a new runtime dependency); MapShell takes the map as a slot and draws nothing in its place.
- **R10. Graph edges** are drawn at `focus-ring-width` (2px) with arrowheads, where the mockup draws 1.4px lines with none: direction is information the relationship carries.

**U1-c, the screens rebuilt from the component library (2026-10-07).** Where a screen yields to a rule or to the data, built as follows; each is listed in the U1-c checkpoint.

| Mockup draws | Rule or fact | Built as |
|---|---|---|
| The hero search shell's edge in `border-strong` (1.43:1) | Non-text 3:1 (R2): the shell is the borderless input's only edge | `border-input` |
| No organisation name in the app header | Tenant isolation: the analyst must see which tenant they are in | The organisation's name before the vetting pill |
| Run view and workspace with no account menu | The theme toggle, organisation and sign-out stay reachable everywhere | The account button at the context header's end |
| Report sections one per card | The stored report is read whole, and its tests read it whole | One continuous document card; the sections rail jumps within it |
| Report "Unreviewed" pill, "Regenerate section", the citation check figure | No review state or per-section regeneration exists; no citation check is recorded | Hidden actions; the citation check is a Not built card |
| Monitor alerts, contradictions, the written summary, merge candidates, Media, Map, a case's Report | No endpoint or analysis backs them | Not built cards, never hidden and never a number |
| Credits "[N] of [PLAN LIMIT]" | No credit metering exists | The em dash with "credit metering is not built", no bar |
| A run's lock leaving earlier rows on screen | A read resting on person data is refused whole (CLAUDE.md §9); the web app never decides what is person data | Any lock withholds everything the stream had sent |
| Tab bar with a "Progress" tab (the app's, not drawn) | D6 draws eight tabs | The run's live view is reached from the run header |
| Mockup sizes with no token (SignIn's 32px tile, 16px wordmark, 40/38px secondary buttons, 7px key radius, 48px OTP, 250px map card) | Tokens only | The nearest token, as R1 |
| Graph labels at fitted zoom | `ink-muted` never below 11px | The graph pans rather than shrink a label below its token size |

**Raised at U1-c, not built** (the nearest existing component stands in, or the item waits for an endpoint):
- **Components §9 does not specify, or no mockup draws:** a count chip (StatusChip with words), the §8 Partial, Locked and Stale notices as library components (the app's own stand in), a gaps list, a strength badge with a count, a timeline event row, a report sections nav and citation card, a generic segmented toggle, an inspector frame, a mobile navigation sheet (below `md` the side nav is not drawn; since R1-0's pre-flight a plain row of the same links stands in).
- **Endpoints that do not exist:** a tenant-wide runs list (the palette lists pages and cases only); `GET` of the report handling marking (Settings shows an em dash); per-entity evidence (the entity inspector shows no evidence cards); per-run cost, credits, monitors, media and coordinates.
- **Backed but new state-changing features, not built in U1-c:** entity merges and undo, job replay, member invite, role change and removal, retention and marking edits, API keys, credentials, scope authorisations, usage.
- **Members and Settings have no mockup:** built provisionally from existing components in the standard page shell, read-only, labelled "Provisional: no screen design yet".
- **The report's PDF panel** keeps `h-screen` (no page-height token).
- **Small library gaps found in U1-c:** `HeroSearch` has no `error` prop (the dashboard's empty-submit message is an alert line under it, not tied to the input); `RunRailItem.meta` is text, so the graph rail's run times use the shared text form rather than the `Instant` element.
- **Account menu:** "Switch organisation" is shown only when there is another organisation to switch to (hidden, not disabled); the service's health line sits in the menu's footer (not drawn).

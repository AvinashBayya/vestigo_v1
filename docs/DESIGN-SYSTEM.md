# Design System

The design language for Vestigo. Build every screen from these tokens and rules. If a screen needs something not defined here, add it here first rather than inventing it in a component.

The screens themselves are drawn in the reference designs: [design/README.md](design/README.md). They take their layout and wording from there, and every value from this document.

One goal governs everything: **a reader must be able to tell, at a glance, how strongly a claim is supported and whether a value was actually measured.** A design that makes weak evidence look strong is a defect, not a style choice.

---

## 1. Content rules

These are product rules, not writing suggestions. They are enforced in code elsewhere; the UI must not undo them.

- **Never fabricate.** A missing value renders as an em dash (`—`) with a tooltip saying why. Never `0`, never `"N/A"`, never an empty string, never a plausible guess. `0` means measured and the count was zero.
- **Name the source.** Any claim, number or attribute can be clicked to open the provenance drawer listing the evidence behind it.
- **Failures stay visible.** A collector that failed shows as failed, with its reason, beside the ones that succeeded. Partial results are labelled partial.
- **Two timestamps, always distinguished.** `observedAt` (when the thing happened) and `collectedAt` (when we saw it). A null `observedAt` renders as an em dash, never as the collection time.
- **Derived values are visibly distinct** from values a source stated. Anything inside an evidence record's `derived` block was computed by the platform.
- **Voice:** plain, specific, unexcited. "Rate limited by provider, retrying in 40s" rather than "Something went wrong". No exclamation marks. Never congratulate the analyst on finding something.

---

## 2. Colour tokens

Define as CSS variables on `:root`, with a `[data-theme="dark"]` override. Light is primary; dark is fully supported.

### Surfaces and chrome

| Token | Light | Dark | Use |
|---|---|---|---|
| `surface-page` | `#F5F5F1` | `#14161B` | App background behind all panels |
| `surface-raised` | `#FFFFFF` | `#1A1D23` | Cards, rails, headers, inspector panels |
| `surface-sunken` | `#FCFCFA` | `#1F232B` | Graph and map canvases, inputs, code blocks |
| `surface-hover` | `#F8F8F5` | `#22262E` | Row hover, selected list rows |
| `border-subtle` | `#EFEEE8` | `#24282F` | Dividers inside a card; never a card edge |
| `border-default` | `#E3E2DB` | `#2A2E36` | Card and panel edges, table rules |
| `border-strong` | `#D6D5CC` | `#333944` | Inputs, secondary buttons, interactive at rest |
| `ink-primary` | `#15171C` | `#ECECE7` | Headings, values, body text |
| `ink-secondary` | `#3C3E45` | `#C4C6CC` | Secondary labels, inactive navigation |
| `ink-muted` | `#5E6066` | `#9A9DA5` | Captions, metadata, source lines. The lightest permitted text colour; never below 12px |
| `accent` | `#22355B` | `#7B94C8` | Primary buttons, active tab underline, focus ring, key graph node |
| `accent-soft` | `#E8ECF4` | `#26303F` | Selected navigation, accent chips, active run row |
| `accent-ink` | `#22355B` | `#C8D8F2` | Text and icons on `accent-soft` |
| `on-accent` | `#FFFFFF` | `#14161B` | Text on a filled accent button |

### Claim strength

Six labels, in descending order of support. Each has a fill (background), an ink (text) and, where it appears as a dot or ring, a mark.

| Label | Meaning | fill (L/D) | ink (L/D) | mark (L/D) |
|---|---|---|---|---|
| `OBSERVED` | Seen directly by the platform | `#E7F1EA` / `#1D3227` | `#17543A` / `#8FD5AE` | `#1F6F4A` / `#55B183` |
| `REPORTED` | Stated by the cited source, unverified | `#E8ECF4` / `#232C3A` | `#1E4577` / `#A8BEE4` | `#2B5C9E` / `#7B94C8` |
| `DERIVED` | Computed by the platform from recorded values | `#EFE9F6` / `#2A2338` | `#523579` / `#C3AEE4` | `#6A4A9E` / `#9A7BD0` |
| `CORRELATED` | A link across independent cited sources | `#E7EFEF` / `#1B2C2C` | `#0F4F4F` / `#84CACA` | — |
| `INFERRED` | Analytic inference, no source stated it | `#F6EEDD` / `#33291A` | `#6B4510` / `#E0B872` | `#8A5A12` / `#C79A4E` |
| `HYPOTHESIS` | A possibility the evidence permits | `#ECEBE4` / `#272B33` | `#4A4C52` / `#B6B8BF` | — |

**Always render the word, never the colour alone.** Roughly one in twelve men has some colour vision deficiency, and that is this product's buyer demographic. Colour is a second channel.

Inferred content also carries a lighter treatment in context: a dashed edge in the graph, a tinted card in the inspector. Where an inference is shown, say what it was inferred from.

### Failure

| Token | Light | Dark | Use |
|---|---|---|---|
| `status-failed-fill` | `#F6E6E1` | `#33211C` | Failed collector rows, error banners |
| `status-failed-ink` | `#7A2E1E` | `#E9A48F` | Failure text, including the reason |
| `status-failed-mark` | `#A33F27` | `#C4644A` | Failure dot, error icon |

### Entity class (added in Phase 6b)

The ring and fill of a node in the graph, by the class of entity it stands for. Used **only** for entity class, and always with the class written inside or beside the node (§6): colour is the second channel, never the only one.

Four families, as the screen designs group them: infrastructure (greens), contact (blues), person (purple), account (ambers), plus organisation (rose) and location (cyan). Within a family the classes step in lightness, so they differ in lightness and not hue alone (§7). Every ring meets 3:1 against `surface-sunken` in its theme. These deliberately do not reuse the claim tokens: in the graph, colour says what a node is, and claim strength is said by the edge (§2, Claim strength) and in words.

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

Node labels are `ink-primary` on the fill. The run's or case's seed entities are drawn with a wider ring of their own class colour. The selected node, the "key graph node" of `accent` (§2), gets an `accent` outline outside its ring, so it never loses its class colour.

### QR code (added in Phase 6b)

| Token | Light | Dark | Use |
|---|---|---|---|
| `qr-module` | `#15171C` | `#15171C` | The dark modules of the MFA enrolment QR code |
| `qr-ground` | `#FFFFFF` | `#FFFFFF` | Its background and quiet zone |

The same in both themes, deliberately: authenticator apps scan dark-on-light reliably and an inverted code unreliably.

### Colour discipline

Chrome is neutral. Colour means **claim strength, collector status, or entity class in the graph** (the `entity-*` tokens) — nothing else. Anything decorative that borrows a semantic colour is a bug.

---

## 3. Collector status

The same vocabulary everywhere a collector appears. Reuse the claim tokens:

| Status | Meaning | Tokens |
|---|---|---|
| **Ran** | Finished, results attached | `claim-observed-*` |
| **Running** | In progress; determinate bar where the source reports progress | `accent` |
| **Partial** | Finished, but some sub-queries were unsupported or dropped — say which | `claim-observed-*` |
| **Failed** | With the reason and the retry state | `status-failed-*` |
| **Needs key** | No tenant credential configured | `claim-inferred-*` |
| **Skipped** | Policy or plan prevented the run (e.g. active scan without scope authorisation) | `claim-hypothesis-*` |
| **Held** | Registered but not enabled (licence unverified, or held pending verification) | `claim-hypothesis-*` |
| **Queued** | Planned, waiting for a worker to start it, or waiting for its next attempt (say when) (added in Phase 6b) | `claim-hypothesis-*` |
| **Cancelled** | Stopped before it finished; nothing more will be collected (added in Phase 6b) | `claim-hypothesis-*` |
| **Ready** | Before any run: it can run in this deployment (implemented, and its licence permits it or the deployment allows unverified sources). Added from the screen designs | `claim-observed-*` |

A failed collector and a collector that found nothing must look obviously different.

---

## 4. Typography

| Family | Stack | Use |
|---|---|---|
| `sans` | `"IBM Plex Sans", "Segoe UI", system-ui, sans-serif` | All interface text |
| `mono` | `"IBM Plex Mono", ui-monospace, monospace` | Anything an analyst might copy, compare or verify: domains, hashes, IPs, identifiers, counts, timestamps |
| `serif` | `"IBM Plex Serif", Georgia, serif` | Printed reports only — never in the UI |

Monospace is a signal that a value is literal data. Use it deliberately.

| Style | Size / line height | Weight | Notes |
|---|---|---|---|
| `display` | 30 / 36 | 600 | `letter-spacing: -0.5px` |
| `title` | 20 / 26 | 600 | |
| `body` | 14 / 21 | 400 | |
| `body-strong` | 14 / 21 | 600 | |
| `small` | 12.5 / 19 | 400 | Replaces `body` in compact tables |
| `caption` | 11.5 / 17 | 400 | |
| `eyebrow` | 11 / 14 | 600 | `letter-spacing: 0.5px`, uppercase section labels |
| `mono-body` | 13 / 20 | 400 | |
| `mono-caption` | 11.5 / 17 | 400 | |
| `metric` | 21 / 26 | 500 | Mono. Large single numbers |

---

## 5. Spacing, radius, shadow

| Token | Value | Use |
|---|---|---|
| `space-1` | 4px | Badge padding, icon-to-label gaps |
| `space-2` | 8px | Chip rows, tight button groups |
| `space-3` | 12px | Compact density row padding |
| `space-4` | 16px | Default card padding, list gaps |
| `space-5` | 20px | Comfortable card padding |
| `space-6` | 24px | Grid gutters between panels |
| `space-8` | 32px | Section separation |
| `space-10` | 40px | Page margins |

| Token | Value | Use |
|---|---|---|
| `radius-sm` | 6px | Badges, small icon buttons |
| `radius-md` | 8px | Buttons, navigation rows, inputs |
| `radius-lg` | 12px | Cards and panels |
| `radius-pill` | 999px | Status chips **only** — a pill that is not a status is wrong |

| Token | Value | Use |
|---|---|---|
| `shadow-card` | `0 1px 2px rgba(21,23,28,0.05)` | The search bar and floating graph controls. Nothing else is raised |
| `shadow-overlay` | `0 8px 24px rgba(21,23,28,0.12)` | Command palette, popovers, provenance drawer |

**Sizes** (added in Phase 6b, for the first screens):

| Token | Value | Use |
|---|---|---|
| `target-min` | 44px | Smallest dimension of any interactive control (§7). Buttons and inputs are at least this tall |
| `focus-ring-width` | 2px | The focus outline (§7) |
| `focus-ring-offset` | 2px | Gap between a control and its focus outline (§7) |
| `layout-form-width` | 500px | Maximum width of a single-column form: sign-in, MFA challenge (the sign-in design's column; was 400px) |
| `layout-page-width` | 880px | Maximum width of a single-column page wider than a form: MFA enrolment (added from the screen designs) |
| `layout-nav-width` | 216px | The side navigation of the signed-in app (added from the screen designs) |
| `layout-search-width` | 780px | The dashboard's search bar (added from the screen designs) |
| `layout-drawer-width` | 400px | The provenance drawer (§9), from the right edge (added in Phase 6b) |
| `qr-size` | 176px | The MFA enrolment QR code, large enough to scan from a screen |

**Density.** Two modes. *Comfortable*: `space-5` card padding, 11px row padding, `body` in tables. *Compact*: `space-3`, 7px, `small` in tables. All spacing comes from tokens, so the swap is mechanical. Compact is the default in the Evidence grid.

---

## 6. Iconography

Line icons, 1.9px stroke, 24px grid, rendered at 15–19px, inheriting `currentColor`. No filled icons, no two-tone, **no emoji anywhere in the product**. Icon-only buttons always carry an `aria-label`. Entity classes in the graph are distinguished by ring colour **and** a text label inside the node.

---

## 7. Accessibility

- Body and caption text meet 4.5:1 against their surface in both themes. `ink-muted` is the lightest permitted text colour.
- Interactive targets are at least 44px in their smallest dimension.
- Focus is visible on every control: `accent`, `focus-ring-width`, with `focus-ring-offset`.
- Every control is a real `<button>`, `<a href>` or labelled `<input>`. Nothing interactive is a `div`.
- Entity and status distinctions differ in lightness, not hue alone.
- Every form input has a label, visible or screen-reader-only.

---

## 8. Required states

Every data surface designs these explicitly. None may be left to a default spinner.

| State | Requirement |
|---|---|
| **Empty** | Says what would appear here and how to get it. First-run empty states are onboarding. |
| **Loading** | Skeletons matching the real layout, not a centred spinner. |
| **Partial** | Says what is missing and why. Never presents partial data as complete. |
| **Failed** | The reason, the retry state, and what the user can do. |
| **Stale** | When data was collected, where that matters. |
| **Locked** | What the module does, why it is off (plan or vetting), and the next step. Sells, never scolds. |

---

## 9. Patterns

**Provenance drawer.** Opens from any number, claim or attribute. Shows collector and version, run id, `observedAt` and `collectedAt` separately, content hash, source URL, and a link to the stored raw payload. One component, reused everywhere.

**Pin-to-case.** Present on **every** result surface, including direct tool panels. The predecessor's worst structural flaw was that tool panels could not feed a case.

**Cost shown twice.** Estimated before a run starts, actual after it finishes. Surprise bills lose customers.

**Evidence as a grid, not cards.** Cards suit the inspector; the Evidence tab is a sortable, filterable grid with saved views and compact density by default.

**Attribution.** Sources that require attribution (GDELT: citation on redistribution; HIBP: visible link) must have it rendered wherever their data appears. A source requiring attribution with nowhere to render it is a bug.

---

## 10. White-labelling

Per-tenant themes may override `accent`, `on-accent` and the `surface-*` family **only**. The claim and status families are fixed, because their meaning must not vary between tenants.

---

## 11. Implementation

Tailwind with shadcn/ui, mapping these tokens to CSS variables at the theme layer. Components never hard-code a hex value, a pixel spacing or a font stack — everything comes from a token. A pull request introducing a raw colour is a review failure.

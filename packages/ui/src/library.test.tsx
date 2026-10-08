/**
 * The U1-b component library: a render test for each component, and
 * behaviour tests for the honest states (CLAUDE.md §1, DESIGN-SYSTEM §8).
 * Fixture values are bracketed placeholders: nothing here is a real source,
 * count or date.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AccountMenu,
  AppHeader,
  VETTING_LABEL,
  VETTING_STATUSES,
  VettingPill,
} from "./app-header.tsx";
import {
  CommandPalette,
  CommandPaletteButton,
  CommandPalettePanel,
  useCommandPaletteShortcut,
  type PaletteGroup,
} from "./command-palette.tsx";
import { DataTable, type DataTableColumn } from "./data-table.tsx";
import { EvidenceCard } from "./evidence-card.tsx";
import { AddFilterChip, FilterChip, FilterToggle } from "./filter-chip.tsx";
import { GraphShell, graphStylesheet } from "./graph-shell.tsx";
import { InspectorDrawer, NO_OBSERVED_AT, type Provenance } from "./inspector-drawer.tsx";
import { MapShell } from "./map-shell.tsx";
import { ArrivingNow, MetricCard } from "./metric-card.tsx";
import {
  CitationMarker,
  Citations,
  CoverageLimitation,
  InferredPassage,
  ReportProse,
  ReportSectionHeading,
  ReportSurface,
} from "./report-surface.tsx";
import {
  CollectorList,
  LOCK_REASONS,
  LOCK_REASON_TITLE,
  LockDetail,
  recheckInterval,
  RunsRail,
  type RunRailItem,
} from "./runs-rail.tsx";
import {
  COLLECTOR_STATUSES,
  COLLECTOR_STATUS_LABEL,
  RUN_STATUSES,
  RunStatusChip,
  StatusChip,
  StatusDot,
} from "./status-chip.tsx";
import { CLAIM_STRENGTH_LABELS, StrengthBadge, StrengthKey } from "./strength-badge.tsx";
import { Button } from "./button.tsx";
import { Card, DashedNote, NestedCard } from "./card.tsx";
import { ContextHeader } from "./context-header.tsx";
import { CreditsMeter } from "./credits-meter.tsx";
import { DensityToggle } from "./density-toggle.tsx";
import { Field, Input, ToolbarInput } from "./field.tsx";
import { HeroSearch } from "./hero-search.tsx";
import { PinButton } from "./pin-button.tsx";
import { ProductMark } from "./product-mark.tsx";
import { NavItem, SideNav } from "./side-nav.tsx";
import { FailedAlert } from "./states.tsx";
import { KeyValueList } from "./key-value.tsx";
import { TabBar, TabLink } from "./tab-bar.tsx";
import { Tag, TagList } from "./tag.tsx";
import { BackLink, TextLink } from "./text-link.tsx";

afterEach(() => {
  cleanup();
});

/** §7: every control's hit area is at least target-min, by its own size or the hit-area extension. */
const TARGET =
  /\b(?:min-h-target|size-target|h-target|hit-area|min-h-row-compact|min-h-row-comfortable)\b/;
function expectTargets(container: HTMLElement) {
  const controls = container.querySelectorAll("button, a[href], input, [role='option']");
  expect(controls.length).toBeGreaterThan(0);
  for (const control of controls) {
    const own = control.getAttribute("class") ?? "";
    // A native checkbox or radio takes its hit area from the label around it.
    const label = control.closest("label")?.getAttribute("class") ?? "";
    expect(`${own} ${label}`, control.outerHTML).toMatch(TARGET);
  }
}

const PROVENANCE: Provenance = {
  sourceLabel: "[SOURCE LABEL]",
  collectorVersion: "[VERSION]",
  runId: "[RUN ID]",
  observedAt: null,
  collectedAt: "[COLLECTED AT]",
  contentHash: "a41f00000000000000000000000000000000000000000000000000000000f9c2",
  sourceUrl: null,
  payloadHref: "/[payload]",
};

describe("CommandPalette", () => {
  const groups: PaletteGroup[] = [
    { label: "Runs", items: [{ id: "r1", label: "[TARGET ONE]", hint: "[RUN]" }] },
    {
      label: "Pages",
      items: [
        { id: "p1", label: "Cases" },
        { id: "p2", label: "Search" },
      ],
    },
  ];

  it("is closed until opened, and the button names the shortcut", () => {
    const onOpen = vi.fn();
    render(<CommandPaletteButton onOpen={onOpen} apple={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    const button = screen.getByRole("button", { name: /Command palette/ });
    expect(button.textContent).toContain("Ctrl K");
    expect(button.getAttribute("aria-keyshortcuts")).toBe("Control+K");
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("opens on Ctrl K", () => {
    const onOpen = vi.fn();
    function Harness() {
      useCommandPaletteShortcut(onOpen);
      return null;
    }
    render(<Harness />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("groups results, filters as you type, and says so when nothing matches", () => {
    render(<CommandPalettePanel groups={groups} onSelect={vi.fn()} />);
    expect(
      screen.getAllByRole("group").map((group) => group.getAttribute("aria-labelledby")),
    ).toHaveLength(2);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "case" } });
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Cases"]);
    fireEvent.change(input, { target: { value: "[nothing like this]" } });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain(
      "Nothing matches “[nothing like this]”",
    );
  });

  it("moves with the arrow keys and opens with Enter, focus staying in the input", () => {
    const onSelect = vi.fn();
    render(<CommandPalettePanel groups={groups} onSelect={onSelect} />);
    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const active = input.getAttribute("aria-activedescendant") ?? "";
    expect(document.getElementById(active)?.textContent).toBe("Cases");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("p1");
  });

  it("closes on Escape as a dialog, and selecting closes it", () => {
    const onOpenChange = vi.fn();
    const onSelect = vi.fn();
    render(<CommandPalette open onOpenChange={onOpenChange} groups={groups} onSelect={onSelect} />);
    const dialog = screen.getByRole("dialog", { name: "Command palette" });
    fireEvent.keyDown(within(dialog).getByRole("combobox"), { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByRole("option", { name: /Search/ }));
    expect(onSelect).toHaveBeenCalledWith("p2");
    expectTargets(dialog);
  });
});

describe("App header row", () => {
  it("wraps rather than overlaps when it is narrower than both groups (phone width)", () => {
    // REGRESSION (R1-0 pre-flight 0.4): a fixed-height row whose right group could not
    // shrink. At phone width the organisation, the vetting pill and the account button slid over
    // the product mark and the palette button, so neither could be tapped.
    const { container } = render(
      <AppHeader
        start={<CommandPaletteButton onOpen={vi.fn()} />}
        end={<VettingPill status="NOT_SUBMITTED" />}
      />,
    );
    const header = container.querySelector("header");
    expect(header?.className).toMatch(/(^|\s)flex-wrap(\s|$)/);
    expect(header?.className).toMatch(/(^|\s)min-h-header(\s|$)/);
    expect(header?.className).not.toMatch(/(^|\s)h-header(\s|$)/);
    // Both groups may shrink, so the organisation's name truncates instead of overflowing.
    const groups = [...(header?.children ?? [])];
    expect(groups).toHaveLength(2);
    for (const group of groups) expect(group.className).toMatch(/(^|\s)min-w-0(\s|$)/);
  });

  it("shows every vetting status in words, neutral (D1)", () => {
    render(
      <>
        {VETTING_STATUSES.map((status) => (
          <VettingPill key={status} status={status} />
        ))}
      </>,
    );
    for (const word of [
      "Verified tenant",
      "Vetting pending",
      "Vetting not submitted",
      "Vetting rejected",
      "Vetting suspended",
    ]) {
      expect(screen.getByText(word).className).not.toMatch(/claim-|status-|accent/);
    }
  });

  it("is told from every status chip by shape: an outline, no fill, no dot (R3)", () => {
    // REGRESSION (U1-b review, R3): the pill was accent-ink on accent-soft with an
    // accent dot, the Running chip's three tokens, so "Verified tenant" read as a status.
    const { container } = render(
      <>
        {VETTING_STATUSES.map((status) => (
          <VettingPill key={status} status={status} />
        ))}
        {COLLECTOR_STATUSES.map((status) => (
          <StatusChip key={status} status={status} />
        ))}
        {RUN_STATUSES.map((status) => (
          <RunStatusChip key={status} status={status} />
        ))}
      </>,
    );
    const background = (element: HTMLElement) =>
      element.className.split(/\s+/).filter((name) => name.startsWith("bg-"));
    for (const status of VETTING_STATUSES) {
      const pill = screen.getByText(VETTING_LABEL[status]);
      expect(background(pill)).toEqual([]);
      expect(pill.className).toMatch(/(^|\s)border(\s|$)/);
      expect(pill.className).toContain("border-border-input");
      // No dot: the word is the pill's only content.
      expect(pill.children).toHaveLength(0);
    }
    // Every status chip is filled and has no outline: the shapes never coincide.
    const pills = new Set(
      VETTING_STATUSES.map((status) => screen.getByText(VETTING_LABEL[status])),
    );
    const chips = [...container.querySelectorAll<HTMLElement>("span.rounded-pill")].filter(
      (element) => !pills.has(element),
    );
    expect(chips).toHaveLength(COLLECTOR_STATUSES.length + RUN_STATUSES.length);
    for (const chip of chips) {
      expect(background(chip)).toHaveLength(1);
      expect(chip.className).not.toMatch(/(^|\s)border(\s|$)/);
    }
  });

  it("the account menu offers the theme as a radio pair", () => {
    const onThemeChange = vi.fn();
    render(
      <AppHeader
        start={<CommandPaletteButton onOpen={vi.fn()} />}
        end={
          <AccountMenu
            initials="[AB]"
            name="[NAME]"
            email="[EMAIL]"
            organisation="[ORGANISATION]"
            theme="light"
            onThemeChange={onThemeChange}
            onSignOut={vi.fn()}
          />
        }
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(onThemeChange).toHaveBeenCalledWith("dark");
    // No switch is offered when there is nothing to switch to.
    expect(screen.queryByRole("button", { name: "Switch organisation" })).toBeNull();
  });
});

describe("StatusChip", () => {
  it("says every status in words", () => {
    render(
      <>
        {COLLECTOR_STATUSES.map((status) => (
          <StatusChip key={status} status={status} />
        ))}
      </>,
    );
    for (const status of COLLECTOR_STATUSES) {
      expect(screen.getByText(COLLECTOR_STATUS_LABEL[status]).className).toContain("rounded-pill");
    }
    // The six the brief names: running, done, failed, found nothing, needs key, locked.
    for (const word of ["Running", "Ran", "Failed", "Found nothing", "Needs key", "Locked"]) {
      expect(screen.getByText(word)).toBeTruthy();
    }
  });

  it("colours only by status: a failure looks nothing like a nothing found", () => {
    render(
      <>
        <StatusChip status="FAILED" />
        <StatusChip status="FOUND_NOTHING" />
        <StatusDot status="FAILED" />
      </>,
    );
    expect(screen.getByText("Failed").className).toContain("bg-status-failed-fill");
    expect(screen.getByText("Found nothing").className).toContain("bg-claim-hypothesis-fill");
  });

  it("a run's PARTIAL is amber, not a collector's green Partial (§3)", () => {
    render(
      <>
        <RunStatusChip status="PARTIAL" />
        <StatusChip status="PARTIAL" />
      </>,
    );
    expect(screen.getByText("PARTIAL").className).toContain("bg-claim-inferred-fill");
    expect(screen.getByText("Partial").className).toContain("bg-claim-observed-fill");
  });
});

describe("StrengthBadge", () => {
  it("renders all six strengths as words, never a pill", () => {
    render(
      <>
        {CLAIM_STRENGTH_LABELS.map((strength) => (
          <StrengthBadge key={strength} strength={strength} size="sm" />
        ))}
      </>,
    );
    for (const strength of CLAIM_STRENGTH_LABELS) {
      const badge = screen.getByText(strength);
      expect(badge.className).toContain(`bg-claim-${strength.toLowerCase()}-fill`);
      expect(badge.className).toContain("rounded-xs");
      expect(badge.className).not.toContain("rounded-pill");
    }
  });

  it("its key pairs each mark with its word", () => {
    const { container } = render(<StrengthKey />);
    const items = container.querySelectorAll("li");
    expect([...items].map((item) => item.textContent)).toEqual([...CLAIM_STRENGTH_LABELS]);
    for (const [index, item] of [...items].entries()) {
      const strength = CLAIM_STRENGTH_LABELS[index] ?? "";
      expect(item.querySelector("[aria-hidden='true']")?.className).toContain(
        `bg-claim-${strength.toLowerCase()}-mark`,
      );
    }
  });
});

describe("FilterChip", () => {
  it("removes the whole chip, and its name says what it removes", () => {
    const onRemove = vi.fn();
    const { container } = render(
      <FilterChip facet="Collector" value="[SOURCE]" onRemove={onRemove} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove filter Collector: [SOURCE]" }));
    expect(onRemove).toHaveBeenCalledOnce();
    expectTargets(container);
  });

  it("toggles on and off with aria-pressed, and the add chip is a button", () => {
    const onPressedChange = vi.fn();
    const { container } = render(
      <>
        <FilterToggle pressed={false} onPressedChange={onPressedChange}>
          [FACET VALUE]
        </FilterToggle>
        <FilterToggle pressed onPressedChange={vi.fn()}>
          [ON]
        </FilterToggle>
        <AddFilterChip onClick={vi.fn()} />
      </>,
    );
    const off = screen.getByRole("button", { name: "[FACET VALUE]" });
    expect(off.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(off);
    expect(onPressedChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole("button", { name: "[ON]" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Add filter" })).toBeTruthy();
    expectTargets(container);
  });
});

describe("DataTable", () => {
  const columns: DataTableColumn[] = [
    { id: "claim", header: "Claim", sortable: true, kind: "primary" },
    { id: "hash", header: "Hash", kind: "mono-muted" },
  ];

  it("with no rows shows the designed Not built state, never a blank table", () => {
    render(
      <DataTable
        caption="Evidence"
        columns={columns}
        rows={[]}
        empty={{ kind: "not-built", title: "Evidence grid", needs: "[WHAT IT NEEDS]" }}
      />,
    );
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("heading", { name: "Evidence grid" })).toBeTruthy();
    expect(screen.getByText(/Not built yet\. \[WHAT IT NEEDS\]/)).toBeTruthy();
  });

  it("while loading says what it reads, in the table's shape", () => {
    render(
      <DataTable
        caption="Evidence"
        columns={columns}
        rows={[]}
        loading="Reading the evidence."
        empty={{ kind: "empty", title: "[T]", body: "[B]" }}
      />,
    );
    expect(screen.getByRole("status").textContent).toBe("Reading the evidence.");
  });

  it("keeps a header's visually hidden label inside the table's own scrolling", () => {
    // REGRESSION (R1-0 pre-flight 0.4): the selection and pin headers' labels are sr-only,
    // absolutely placed. With no positioned ancestor they escaped the scroll container and
    // widened the Evidence and Entities pages well past a phone's width.
    render(
      <DataTable
        caption="Evidence"
        columns={columns}
        rows={[{ id: "a", cells: { claim: "[CLAIM A]", hash: "[HASH A]" } }]}
        empty={{ kind: "empty", title: "[T]", body: "[B]" }}
        selection={{ selected: new Set(), onToggle: vi.fn(), onToggleAll: vi.fn() }}
        pins={{ pinned: new Set(), onToggle: vi.fn() }}
      />,
    );
    const scroller = screen.getByRole("table").parentElement;
    expect(scroller?.className).toMatch(/(^|\s)overflow-x-auto(\s|$)/);
    expect(scroller?.className).toMatch(/(^|\s)relative(\s|$)/);
  });

  it("rows are at least target-min, the header at the th size, the selected row says so, pins say which row", () => {
    const onToggle = vi.fn();
    const onSortChange = vi.fn();
    const { container } = render(
      <DataTable
        caption="Evidence"
        columns={columns}
        rows={[
          { id: "a", cells: { claim: "[CLAIM A]", hash: "[HASH A]" } },
          { id: "b", cells: { claim: "[CLAIM B]", hash: "[HASH B]" } },
        ]}
        empty={{ kind: "empty", title: "[T]", body: "[B]" }}
        sort={{ column: "claim", direction: "ascending" }}
        onSortChange={onSortChange}
        selection={{ selected: new Set(["a"]), onToggle: vi.fn(), onToggleAll: vi.fn() }}
        pins={{ pinned: new Set(["b"]), onToggle }}
      />,
    );
    const rows = within(screen.getByRole("table")).getAllByRole("row");
    for (const row of rows.slice(1)) expect(row.className).toMatch(/h-row-(compact|comfortable)/);
    expect(screen.getByRole("columnheader", { name: /Claim/ }).getAttribute("aria-sort")).toBe(
      "ascending",
    );
    expect(screen.getByRole("columnheader", { name: /Claim/ }).className).toContain("text-th");
    expect(rows[1]?.getAttribute("aria-selected")).toBe("true");
    expect(rows[2]?.getAttribute("aria-selected")).toBe("false");
    expect(
      screen.getByRole("button", { name: "Pin row 2 to case" }).getAttribute("aria-pressed"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Pin row 1 to case" }));
    expect(onToggle).toHaveBeenCalledWith("a");
    fireEvent.click(screen.getByRole("button", { name: /Claim/ }));
    expect(onSortChange).toHaveBeenCalledWith("claim");
    expectTargets(container);
  });
});

describe("InspectorDrawer", () => {
  it("evidence: the registry source, observed and collected apart (a null observed stays null), hash, strength", () => {
    const onClose = vi.fn();
    const { container } = render(
      <InspectorDrawer
        subject={{
          kind: "evidence",
          title: "[EVIDENCE TITLE]",
          strength: "OBSERVED",
          provenance: PROVENANCE,
        }}
        onClose={onClose}
        actions={{ primary: { label: "[PRIMARY]", onClick: vi.fn() } }}
      />,
    );
    const drawer = screen.getByRole("complementary", { name: "Provenance" });
    expect(drawer.className).toContain("w-drawer");
    expect(within(drawer).getByText("[SOURCE LABEL]")).toBeTruthy();
    expect(within(drawer).getByText("[VERSION]")).toBeTruthy();
    expect(within(drawer).getByText("OBSERVED")).toBeTruthy();
    // The null observedAt is an em dash with its reason; the collection time is not put in its place.
    expect(
      within(drawer).getByRole("button", { name: `Not measured. ${NO_OBSERVED_AT}` }),
    ).toBeTruthy();
    expect(within(drawer).getAllByText("[COLLECTED AT]")).toHaveLength(1);
    // The drawer is where the whole hash is read and compared (§9).
    expect(within(drawer).getByText(PROVENANCE.contentHash ?? "")).toBeTruthy();
    expect(
      within(drawer).getByRole("link", { name: "Download raw payload" }).hasAttribute("download"),
    ).toBe(true);
    // Only the actions that exist: no secondary was given, so none is drawn.
    expect(
      within(drawer)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).not.toContain("[SECONDARY]");
    fireEvent.click(within(drawer).getByRole("button", { name: "Close provenance" }));
    expect(onClose).toHaveBeenCalledOnce();
    expectTargets(container);
  });

  it("claim, entity and relationship variants each say what they are", () => {
    const { rerender } = render(
      <InspectorDrawer
        subject={{
          kind: "claim",
          text: "[CLAIM TEXT]",
          strength: "REPORTED",
          provenance: PROVENANCE,
        }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("complementary", { name: "Claim" })).toBeTruthy();
    expect(screen.getByText("REPORTED")).toBeTruthy();

    rerender(
      <InspectorDrawer
        subject={{
          kind: "entity",
          entityClass: "ORGANIZATION",
          name: "[ENTITY NAME]",
          strengths: ["OBSERVED", "INFERRED"],
          attributes: [
            { key: "[KEY]", value: "[VALUE]" },
            { key: "[UNMEASURED KEY]", value: null, reason: "[WHY]" },
          ],
          evidence: [],
        }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("complementary", { name: "Entity" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Not measured. [WHY]" })).toBeTruthy();
    expect(screen.getByText("No evidence is recorded for this.")).toBeTruthy();

    rerender(
      <InspectorDrawer
        subject={{
          kind: "relationship",
          relation: "[RELATION]",
          from: { entityClass: "DOMAIN", name: "[FROM]" },
          to: { entityClass: "IP_ADDRESS", name: "[TO]" },
          strengths: [],
          evidence: [],
        }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("complementary", { name: "Relationship" })).toBeTruthy();
    expect(screen.getByText("No claims, so no strength.")).toBeTruthy();
  });
});

describe("MetricCard", () => {
  it("an unavailable value is an em dash with its reason: never 0, never N/A, never a bar", () => {
    const { container } = render(
      <MetricCard
        title="Cost"
        rows={[
          {
            label: "Estimated before run",
            value: { kind: "unavailable", reason: "[WHY NOT]", cause: "not-recorded" },
          },
          { label: "Spent so far", value: { kind: "value", value: "[N]" } },
        ]}
      />,
    );
    const card = screen.getByRole("region", { name: "Cost" });
    expect(card.textContent).toContain("—");
    expect(card.textContent).toContain("Not measured — [WHY NOT]");
    expect(card.textContent).not.toMatch(/\b0\b|N\/A/);
    expect(container.querySelector("[role='meter'], [role='progressbar'], progress")).toBeNull();
    expect(screen.getByText("[N]")).toBeTruthy();
  });

  it("a failure-caused absence is in failure ink; Not built replaces the rows", () => {
    const { rerender } = render(
      <ArrivingNow
        rows={[
          {
            label: "[COUNT]",
            value: { kind: "unavailable", reason: "[COLLECTOR] failed", cause: "failed" },
          },
        ]}
      />,
    );
    expect(
      screen.getByText("Not measured — [COLLECTOR] failed", {
        selector: "span[aria-hidden='true']",
      }).className,
    ).toContain("text-status-failed-ink");
    rerender(<MetricCard title="Cost" rows={[]} notBuilt="[WHAT IT NEEDS]" />);
    expect(screen.getByText(/Not built yet\./).textContent).toContain("[WHAT IT NEEDS]");
  });

  it("headings are h3 by default and h2 when titleLevel is 2", () => {
    const { rerender } = render(<MetricCard title="[TITLE]" rows={[]} />);
    expect(screen.getByRole("heading", { name: "[TITLE]", level: 3 })).toBeTruthy();
    rerender(<MetricCard title="[TITLE]" rows={[]} titleLevel={2} />);
    expect(screen.getByRole("heading", { name: "[TITLE]", level: 2 })).toBeTruthy();
    rerender(<ArrivingNow title="[TITLE]" rows={[]} />);
    expect(screen.getByRole("heading", { name: "[TITLE]", level: 3 })).toBeTruthy();
    rerender(<ArrivingNow title="[TITLE]" rows={[]} titleLevel={2} />);
    expect(screen.getByRole("heading", { name: "[TITLE]", level: 2 })).toBeTruthy();
  });
});

describe("GraphShell", () => {
  it("empty: the designed state, no canvas; the equivalent list is always there", () => {
    render(
      <GraphShell
        label="Graph"
        classes={[]}
        state={{ kind: "empty", title: "[EMPTY TITLE]", body: "[EMPTY BODY]" }}
        list={<ul aria-label="Graph as a list" />}
      />,
    );
    expect(screen.getByRole("heading", { name: "[EMPTY TITLE]" })).toBeTruthy();
    expect(screen.getByRole("list", { name: "Graph as a list" })).toBeTruthy();
  });

  it("the legend names every class present, and the edge key in words", () => {
    render(
      <GraphShell
        label="Graph"
        classes={["DOMAIN", "PERSON"]}
        state={{ kind: "ready", renderer: <div /> }}
        list={<ul />}
      />,
    );
    const legend = screen.getByRole("list", { name: "Entity classes" });
    expect(legend.textContent).toBe("DomainPerson");
    const edgeKey = screen.getByRole("list", { name: "Edges" }).textContent;
    expect(edgeKey).toContain("Dashed: hypothesis");
    expect(edgeKey).toContain("Dashed amber: INFERRED");
  });

  it("themes nodes by entity class; the selected node keeps its class and gains an accent outline (D3); edges are neutral", () => {
    const rules = graphStylesheet((name) => `[${name}]`);
    const rule = (selector: string) =>
      rules.find((candidate) => candidate.selector === selector)?.style;
    expect(rule("node")?.["background-color"]).toBe("data(fill)");
    expect(rule("node")?.["border-color"]).toBe("data(ring)");
    expect(rule("node:selected")?.["background-color"]).toBe("data(fill)");
    expect(rule("node:selected")?.["outline-color"]).toBe("[accent]");
    expect(rule("edge")?.["line-color"]).toBe("[claim-hypothesis-mark]");
    expect(rule("edge[?weak]")?.["line-style"]).toBe("dashed");
    // REGRESSION (U1-b re-check): a hypothesis edge took INFERRED's amber.
    // Only an all-INFERRED edge is amber; the weak rule sets no colour.
    expect(rule("edge[?weak]")?.["line-color"]).toBeUndefined();
    expect(rule("edge[?inferred]")?.["line-color"]).toBe("[claim-inferred-mark]");
  });

  it("never draws a label below its token size: smaller than that, Cytoscape hides it", () => {
    // REGRESSION (U1-c review): a fitted graph scaled its labels under their token size.
    const sizes: Record<string, string> = { "type-mono-caption-size": "11.5" };
    const rules = graphStylesheet((name) => sizes[name] ?? "1");
    const labelled = rules.filter((rule) => rule.style["label"] !== undefined);
    expect(labelled.map((rule) => rule.selector)).toEqual(["node", "edge"]);
    for (const rule of labelled) {
      expect(rule.style["font-size"]).toBe(11.5);
      expect(rule.style["min-zoomed-font-size"]).toBe(rule.style["font-size"]);
    }
  });
});

describe("RunsRail", () => {
  const lock = (reason: (typeof LOCK_REASONS)[number]): RunRailItem => ({
    id: reason,
    target: `[TARGET ${reason}]`,
    meta: "[META]",
    status: "RUNNING",
    lock: {
      reason,
      code: reason,
      detail: `[DETAIL ${reason}]`,
      locked:
        reason === "MODULE_NOT_IN_PLAN" || reason === "VETTING_NOT_APPROVED"
          ? { moduleSummary: "[MODULE]", withheld: "[WITHHELD]", nextStep: `[NEXT STEP ${reason}]` }
          : null,
      recheckIntervalMs: 5_000,
      checkedAt: "[TIME]",
    },
  });

  it("every one of the five locked reasons shows its reason, its code and the re-check interval", () => {
    const { container } = render(
      <RunsRail runs={LOCK_REASONS.map(lock)} selectedId={null} onSelect={vi.fn()} />,
    );
    for (const reason of LOCK_REASONS) {
      const row = screen.getByRole("button", { name: new RegExp(`\\[TARGET ${reason}\\]`) });
      expect(row.textContent).toContain("Locked");
      // The lock sits beside the button (a button holds phrasing content only), described by it.
      const detail = document.getElementById(row.getAttribute("aria-describedby") ?? "");
      expect(row.contains(detail)).toBe(false);
      expect(detail?.textContent).toContain(LOCK_REASON_TITLE[reason]);
      expect(detail?.textContent).toContain(`[DETAIL ${reason}]`);
      expect(detail?.textContent).toContain(reason);
      // The stream closed with the lock: the interval is how often it WAS checked.
      expect(detail?.textContent).toContain(
        "access was checked every 5 s while the stream was open",
      );
      expect(detail?.textContent).not.toMatch(/is re-checked/);
    }
    // Where person data is the reason, the API's next step is shown.
    expect(screen.getByText("[NEXT STEP VETTING_NOT_APPROVED]")).toBeTruthy();
    expectTargets(container);
  });

  it("each run says its own status; a PARTIAL run is labelled partial (§3)", () => {
    render(
      <RunsRail
        runs={[
          { id: "1", target: "[T1]", meta: "[M]", status: "RUNNING" },
          { id: "2", target: "[T2]", meta: "[M]", status: "SUCCEEDED" },
          { id: "3", target: "[T3]", meta: "[M]", status: "FAILED", failureCode: "[CODE]" },
          { id: "4", target: "[T4]", meta: "[M]", status: "PARTIAL" },
        ]}
        selectedId="2"
        onSelect={vi.fn()}
        disciplines={[
          {
            id: "t",
            label: "TECHINT",
            count: { value: null, reason: "[WHY]" },
            checked: true,
            onChange: vi.fn(),
          },
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: /\[T1\]/ }).textContent).toContain("Running");
    expect(screen.getByRole("button", { name: /\[T2\]/ }).getAttribute("aria-current")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: /\[T2\]/ }).textContent).toContain("Ran");
    expect(screen.getByRole("button", { name: /\[T3\]/ }).textContent).toContain("[CODE]");
    expect(screen.getByText("PARTIAL").className).toContain("bg-claim-inferred-fill");
    // An unmeasured count is an em dash with its reason, never 0.
    expect(screen.getByRole("button", { name: "Not measured. [WHY]" })).toBeTruthy();
  });

  it("collector rows: running, done, failed, found nothing; a failure is tinted with its code; no progress, no bar", () => {
    render(
      <CollectorList
        items={[
          {
            id: "f",
            label: "[FAILED]",
            status: "FAILED",
            failure: { code: "[CODE]", message: "[MESSAGE]" },
          },
          { id: "d", label: "[DONE]", status: "RAN", meta: "[META]" },
          { id: "r", label: "[RUNNING]", status: "RUNNING", progress: null },
          { id: "p", label: "[REPORTING]", status: "RUNNING", progress: 0.5 },
          { id: "n", label: "[NOTHING]", status: "FOUND_NOTHING", meta: "[META]" },
        ]}
      />,
    );
    const failed = screen.getByText("[FAILED]").closest("li");
    expect(failed?.className).toContain("bg-status-failed-tint");
    expect(failed?.textContent).toContain("[CODE] · [MESSAGE]");
    expect(screen.getByText("[DONE]").closest("li")?.textContent).toContain("Ran");
    expect(screen.queryByRole("progressbar", { name: "[RUNNING] progress" })).toBeNull();
    expect(screen.getByRole("progressbar", { name: "[REPORTING] progress" })).toBeTruthy();
    const nothing = screen.getByText("[NOTHING]").closest("li");
    expect(nothing?.textContent).toContain("Found nothing");
    expect(nothing?.className).not.toContain("status-failed");
  });

  it("re-check intervals read in words", () => {
    expect(recheckInterval(5_000)).toBe("every 5 s");
    expect(recheckInterval(120_000)).toBe("every 2 min");
    expect(recheckInterval(1_500)).toBe("every 1500 ms");
  });
});

describe("EvidenceCard", () => {
  it("found: badge, claim, registry source, both times apart, hash", () => {
    render(
      <EvidenceCard
        id="e"
        kind="found"
        strength="OBSERVED"
        text="[CLAIM TEXT]"
        sourceLabel="[SOURCE LABEL]"
        observedAt={null}
        collectedAt="[COLLECTED AT]"
        contentHash="a41f0000000000000000f9c2"
        pin={{ pinned: false, onToggle: vi.fn() }}
      />,
    );
    const card = screen.getByRole("article");
    expect(card.textContent).toContain(
      "[SOURCE LABEL] · observed — (the source gave no date) · collected [COLLECTED AT]",
    );
    expect(card.textContent).toContain("a41f…9c2");
    expect(screen.getByText("OBSERVED")).toBeTruthy();
  });

  it("an INFERRED card is tinted and says what it was inferred from", () => {
    render(
      <EvidenceCard
        id="i"
        kind="found"
        strength="INFERRED"
        inferredFrom="[TWO CITED ITEMS]"
        text="[INFERENCE]"
        sourceLabel="[SOURCE]"
        observedAt="[OBSERVED AT]"
        collectedAt="[COLLECTED AT]"
        contentHash={null}
      />,
    );
    const card = screen.getByRole("article");
    expect(card.className).toContain("bg-claim-inferred-tint");
    expect(card.textContent).toContain("INFERRED from [TWO CITED ITEMS]");
    expect(card.textContent).toContain("hash — (none recorded)");
  });

  it("found nothing is its own card: neutral, not a failure, not evidence", () => {
    render(
      <EvidenceCard
        id="n"
        kind="nothing-found"
        sourceLabel="[SOURCE]"
        collectedAt="[COLLECTED AT]"
        detail={null}
      />,
    );
    const card = screen.getByRole("article");
    expect(card.textContent).toContain("[SOURCE] ran and found nothing for this target.");
    expect(card.className).not.toMatch(/failed|inferred/);
    expect(screen.queryByText(/OBSERVED|REPORTED/)).toBeNull();
  });
});

describe("MapShell", () => {
  it("a point with no coordinates is listed with an em dash and why, never placed", () => {
    render(
      <MapShell
        renderer={<div />}
        layers={[
          {
            id: "l",
            label: "[LAYER]",
            entityClass: "LOCATION",
            count: { value: null, reason: "[WHY NO COUNT]" },
            checked: true,
            onChange: vi.fn(),
          },
        ]}
        points={[
          {
            id: "a",
            label: "[PLACED]",
            entityClass: "LOCATION",
            position: { lat: 1.5, lon: -2.25 },
          },
          {
            id: "b",
            label: "[UNPLACED]",
            entityClass: "ORGANIZATION",
            position: null,
            reason: "[NO COORDINATES BECAUSE]",
          },
        ]}
      />,
    );
    const on = screen.getByRole("region", { name: "Points on the map" });
    const off = screen.getByRole("region", { name: "Points not on the map" });
    expect(on.textContent).toContain("1.5, -2.25");
    expect(on.textContent).not.toContain("[UNPLACED]");
    expect(off.textContent).toContain("[UNPLACED]");
    expect(off.textContent).toContain("[NO COORDINATES BECAUSE]");
    expect(within(off).getByText("—")).toBeTruthy();
    expect(off.textContent).toContain("No coordinates.");
    expect(screen.getByRole("button", { name: "Not measured. [WHY NO COUNT]" })).toBeTruthy();
    // The legend keys what is drawn: the unplaced organisation is not on it.
    expect(screen.getByRole("list", { name: "Legend" }).textContent).toBe("Location");
  });
});

describe("ReportSurface", () => {
  it("the serif is on the report's own text; what sits inside stays sans", () => {
    render(
      <ReportSurface title="[SECTION TITLE]">
        <ReportProse>
          [SENTENCE.]
          <CitationMarker n={1} />
        </ReportProse>
        <InferredPassage from="[WHAT IT RESTS ON]">[INFERENCE.]</InferredPassage>
      </ReportSurface>,
    );
    expect(screen.getByRole("heading", { name: "[SECTION TITLE]" }).className).toContain(
      "font-serif",
    );
    expect(screen.getByRole("article").className).not.toContain("serif");
    expect(screen.getByText("INFERRED").className).toContain("font-sans");
    // An inference says, in words, what it rests on (§2).
    expect(screen.getByText("from [WHAT IT RESTS ON]")).toBeTruthy();
  });

  it("citations open from standalone target-min controls after the prose, never overlapping inline ones (D8)", () => {
    const onOpen = vi.fn();
    const { container } = render(
      <>
        <ReportProse>
          [SENTENCE.]
          <CitationMarker n={2} />
          <CitationMarker n={3} />
        </ReportProse>
        <Citations numbers={[2, 3]} onOpen={onOpen} />
      </>,
    );
    // The inline markers are text, not controls.
    expect(container.querySelector("p button")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Citation 3: open the cited evidence" }));
    expect(onOpen).toHaveBeenCalledWith(3);
    for (const button of screen.getAllByRole("button")) {
      // Each is a full target-min box of its own, so neighbours cannot overlap.
      expect(button.className).toContain("size-target");
      expect(button.className).not.toContain("hit-area");
    }
  });

  it("names each citation for its source, keeps the underline, and says a number no source matches in words, not as a control", () => {
    const onOpen = vi.fn();
    render(
      <Citations
        numbers={[1, 9]}
        onOpen={onOpen}
        labels={new Map([[1, "[SOURCE LABEL]"]])}
        missing={(n) => `${String(n)}. [NO SUCH SOURCE]`}
      />,
    );
    const button = screen.getByRole("button", { name: "Source 1: [SOURCE LABEL]" });
    expect(button.className).toContain("underline");
    expect(button.className).toContain("size-target");
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledWith(1);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByText("9. [NO SUCH SOURCE]").tagName).toBe("SPAN");
  });

  it("a section heading is serif-title in ink-primary, at the level asked for; a limitation callout can sit under it", () => {
    render(
      <ReportSurface title="[TITLE]">
        <ReportSectionHeading id="[id]">[SECTION]</ReportSectionHeading>
        <ReportSectionHeading level={4}>[SUB]</ReportSectionHeading>
        <CoverageLimitation title="[LIMIT]" level={4}>
          [WHY]
        </CoverageLimitation>
      </ReportSurface>,
    );
    const heading = screen.getByRole("heading", { level: 3, name: "[SECTION]" });
    expect(heading.className).toContain("font-serif");
    expect(heading.className).toContain("text-serif-title");
    expect(heading.className).toContain("text-ink-primary");
    expect(heading.id).toBe("[id]");
    expect(screen.getByRole("heading", { level: 4, name: "[SUB]" })).toBeTruthy();
    const limit = screen.getByRole("heading", { level: 4, name: "[LIMIT]" });
    expect(limit.className).not.toContain("serif");
  });
});

describe("U1-b review regressions", () => {
  const groups: PaletteGroup[] = [
    { label: "Recent runs", items: [{ id: "a b", label: "[RUN]" }] },
    { label: "Pages", items: [{ id: "p", label: "Cases" }] },
  ];

  it("Escape returns focus to what had it when the palette opened", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <CommandPaletteButton
            apple={false}
            onOpen={() => {
              setOpen(true);
            }}
          />
          <CommandPalette open={open} onOpenChange={setOpen} groups={groups} onSelect={vi.fn()} />
        </>
      );
    }
    render(<Harness />);
    const button = screen.getByRole("button", { name: /Command palette/ });
    button.focus();
    fireEvent.click(button);
    const input = screen.getByRole("combobox");
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    // Radix restores focus on the next tick, as a browser would see it.
    await waitFor(() => {
      expect(document.activeElement).toBe(button);
    });
  });

  it("while loading, nothing is listed and Enter chooses nothing", () => {
    const onSelect = vi.fn();
    render(<CommandPalettePanel groups={groups} onSelect={onSelect} loading="[READING]" />);
    const input = screen.getByRole("combobox");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(input.hasAttribute("aria-controls")).toBe(false);
    expect(input.hasAttribute("aria-activedescendant")).toBe(false);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("group and option ids carry no spaces, so every group keeps its name", () => {
    render(<CommandPalettePanel groups={groups} onSelect={vi.fn()} />);
    for (const group of screen.getAllByRole("group")) {
      const id = group.getAttribute("aria-labelledby") ?? "";
      expect(id).not.toMatch(/\s/);
      expect(document.getElementById(id)?.textContent).not.toBe("");
    }
    expect(screen.getByRole("group", { name: "Recent runs" })).toBeTruthy();
    for (const option of screen.getAllByRole("option")) expect(option.id).not.toMatch(/\s/);
  });

  it("the table's header row holds targets, so it is a row-compact row; aria-sort only with a control", () => {
    render(
      <DataTable
        caption="[TABLE]"
        columns={[{ id: "a", header: "A", sortable: true }]}
        rows={[{ id: "r", cells: { a: "[A]" } }]}
        empty={{ kind: "empty", title: "[T]", body: "[B]" }}
        selection={{ selected: new Set(), onToggle: vi.fn(), onToggleAll: vi.fn() }}
      />,
    );
    const [header] = within(screen.getByRole("table")).getAllByRole("row");
    expect(header?.className).toContain("h-row-compact");
    // Sortable, but no onSortChange: no button, so no aria-sort.
    expect(screen.getByRole("columnheader", { name: "A" }).hasAttribute("aria-sort")).toBe(false);
  });

  it("a null collector version is an em dash with its reason, not silently dropped", () => {
    render(
      <InspectorDrawer
        subject={{
          kind: "claim",
          text: "[CLAIM]",
          strength: "OBSERVED",
          provenance: { ...PROVENANCE, collectorVersion: null },
        }}
        onClose={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", {
        name: "Not measured. The registry entry records no version for this collector.",
      }),
    ).toBeTruthy();
  });

  it("the map's point lists choose a point by keyboard (§7)", () => {
    const onSelect = vi.fn();
    render(
      <MapShell
        renderer={<div />}
        layers={[]}
        selectedId="b"
        onSelect={onSelect}
        points={[
          { id: "a", label: "[A]", entityClass: "LOCATION", position: { lat: 1, lon: 2 } },
          { id: "b", label: "[B]", entityClass: "LOCATION", position: null, reason: "[WHY]" },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /\[A\]/ }));
    expect(onSelect).toHaveBeenCalledWith("a");
    expect(screen.getByRole("button", { name: /\[B\]/ }).getAttribute("aria-pressed")).toBe("true");
  });
});

/*
 * U1-c: the components the rebuilt screens need (U1-c DECISIONS, "New library
 * components"), each with its honest states.
 */
describe("U1-c: Button sizes", () => {
  it("lg is the target height; md and sm are drawn smaller with a hit area; no size keeps the earlier look", () => {
    const { container } = render(
      <>
        <Button size="lg">[LG]</Button>
        <Button size="md" variant="secondary">
          [MD]
        </Button>
        <Button size="sm">[SM]</Button>
        <Button variant="secondary">[UNSIZED]</Button>
      </>,
    );
    const lg = screen.getByRole("button", { name: "[LG]" }).className;
    expect(lg).toContain("min-h-target");
    expect(lg).toContain("px-5");
    expect(lg).toContain("text-body-strong");
    const md = screen.getByRole("button", { name: "[MD]" }).className;
    expect(md).toContain("hit-area");
    expect(md).toContain("h-control-md");
    expect(md).toContain("px-3.25");
    expect(md).toContain("text-small-strong");
    expect(md).toContain("text-ink-secondary");
    const sm = screen.getByRole("button", { name: "[SM]" }).className;
    expect(sm).toContain("hit-area");
    expect(sm).toContain("h-control-sm");
    expect(sm).toContain("px-3.75");
    expect(sm).toContain("hover:bg-accent-hover");
    // A caller that passes no size is not restyled under it (unrebuilt screens do not shift).
    const unsized = screen.getByRole("button", { name: "[UNSIZED]" }).className;
    expect(unsized).toContain("min-h-target");
    expect(unsized).toContain("px-4");
    expect(unsized).toContain("text-ink-primary");
    expectTargets(container);
  });
});

describe("U1-c: TextLink and BackLink", () => {
  it("a standalone link in the link tokens with a hit area; the back link's chevron is not in its name", () => {
    const { container } = render(
      <>
        <TextLink href="/all" size="meta">
          [ALL]
        </TextLink>
        <BackLink href="/cases">Cases</BackLink>
        <BackLink asChild chevron={false}>
          <a href="/search">Search</a>
        </BackLink>
      </>,
    );
    const all = screen.getByRole("link", { name: "[ALL]" });
    expect(all.className).toContain("hit-area");
    expect(all.className).toContain("text-link");
    expect(all.className).toContain("text-meta-strong");
    const back = screen.getByRole("link", { name: "Cases" });
    expect(back.getAttribute("href")).toBe("/cases");
    expect(back.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(back.className).toContain("text-ui-strong");
    // asChild: the child link takes the look; with no chevron its text is its words alone.
    const search = screen.getByRole("link", { name: "Search" });
    expect(search.className).toContain("hit-area");
    expect(search.querySelector("svg")).toBeNull();
    expectTargets(container);
  });

  it("asChild keeps the chevron inside the child link", () => {
    render(
      <BackLink asChild>
        <a href="/cases">Cases</a>
      </BackLink>,
    );
    const link = screen.getByRole("link", { name: "Cases" });
    expect(link.textContent).toBe("Cases");
    expect(link.querySelector("svg")).not.toBeNull();
  });
});

describe("U1-c: Tag", () => {
  it("is one string, radius-sm with the control edge: never a pill, never a meaning colour", () => {
    render(
      <>
        <Tag>Detected: domain</Tag>
        <Tag mono={false}>[SETTING]</Tag>
        <TagList label="Detects automatically:" tags={["[TYPE A]", "[TYPE B]"]} />
      </>,
    );
    const tag = screen.getByText("Detected: domain");
    expect(tag.className).toContain("rounded-sm");
    expect(tag.className).toContain("border-border-control");
    expect(tag.className).toContain("font-mono");
    expect(tag.className).not.toMatch(/rounded-pill|claim-|status-|accent/);
    expect(screen.getByText("[SETTING]").className).toContain("text-meta-strong");
    const list = screen.getByRole("list", { name: "Detects automatically:" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["[TYPE A]", "[TYPE B]"]);
  });
});

describe("U1-c: ProductMark, SideNav and NavItem", () => {
  it("the mark's text is the name it is given; the current item says so in aria-current and weight; the foot is outside the landmark", () => {
    const { container } = render(
      <SideNav mark={<ProductMark name="[PRODUCT]" />} foot={<p>[FOOT]</p>}>
        <NavItem href="/" current icon={<svg />}>
          Search
        </NavItem>
        <NavItem href="/cases" current={false}>
          Cases
        </NavItem>
      </SideNav>,
    );
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(nav.textContent).toBe("[PRODUCT]SearchCases");
    expect(within(nav).queryByText("[FOOT]")).toBeNull();
    expect(screen.getByText("[FOOT]")).toBeTruthy();
    const current = screen.getByRole("link", { name: "Search" });
    expect(current.getAttribute("aria-current")).toBe("page");
    expect(current.className).toContain("text-body-strong");
    expect(current.className).toContain("bg-accent-soft");
    const other = screen.getByRole("link", { name: "Cases" });
    expect(other.hasAttribute("aria-current")).toBe(false);
    expect(other.className).toContain("text-body");
    expect(other.className).not.toContain("text-body-strong");
    expectTargets(container);
  });

  it("asChild: the router's link takes the look and the icon; the rail size is ui", () => {
    render(
      <ul>
        <NavItem asChild current size="rail" icon={<svg data-testid="icon" />}>
          <a href="/x">[SECTION]</a>
        </NavItem>
      </ul>,
    );
    const link = screen.getByRole("link", { name: "[SECTION]" });
    expect(link.getAttribute("aria-current")).toBe("page");
    expect(link.className).toContain("text-ui-strong");
    expect(within(link).getByTestId("icon")).toBeTruthy();
  });
});

describe("U1-c: CreditsMeter", () => {
  it("unmeasured: one em dash whose name says why, the reason in words, no bar, no meter role, no number", () => {
    const { container } = render(
      <CreditsMeter
        used={{ value: null, reason: "[WHY NO CREDITS]" }}
        limit={{ value: null, reason: "[WHY NO LIMIT]" }}
      />,
    );
    const box = screen.getByRole("region", { name: "Credits this month" });
    const dashes = within(box).getAllByRole("button");
    expect(dashes).toHaveLength(1);
    expect(dashes[0]?.textContent).toBe("—");
    expect(dashes[0]?.getAttribute("aria-label")).toBe("Not measured. [WHY NO CREDITS]");
    expect(box.textContent).toContain("Not measured — [WHY NO CREDITS]");
    expect(box.textContent).not.toMatch(/\d|N\/A|of /);
    expect(
      container.querySelector("[role='meter'], meter, progress, [role='progressbar']"),
    ).toBeNull();
    expectTargets(container);
  });

  it("measured: the figure, of the limit, and a native meter; no bar when the limit is unmeasured or zero", () => {
    const { rerender, container } = render(
      <CreditsMeter used={{ value: 3 }} limit={{ value: 10 }} />,
    );
    const meter = screen.getByRole("meter", { name: "Credits this month" });
    expect(meter.getAttribute("min")).toBe("0");
    expect(meter.getAttribute("max")).toBe("10");
    expect(meter.getAttribute("value")).toBe("3");
    expect(screen.getByText("of 10")).toBeTruthy();

    rerender(<CreditsMeter used={{ value: 3 }} limit={{ value: null, reason: "[WHY]" }} />);
    expect(container.querySelector("meter")).toBeNull();
    expect(screen.getByRole("button", { name: "Not measured. [WHY]" })).toBeTruthy();

    rerender(<CreditsMeter used={{ value: 3 }} limit={{ value: 0 }} />);
    expect(container.querySelector("meter")).toBeNull();
  });
});

describe("U1-c: ContextHeader", () => {
  it("case and run headers: the way back, the title as the page heading, meta and actions", () => {
    const { rerender } = render(
      <ContextHeader
        kind="case"
        back={<BackLink href="/cases">Cases</BackLink>}
        title="[CASE NAME]"
        actions={<Button size="sm">[ACTION]</Button>}
        account={<button type="button">Account</button>}
      />,
    );
    const header = screen.getByRole("banner");
    expect(header.className).toContain("min-h-case-header");
    expect(screen.getByRole("heading", { level: 1, name: "[CASE NAME]" }).className).toContain(
      "text-body-strong",
    );
    expect(header.textContent).toBe("Cases[CASE NAME][ACTION]Account");

    rerender(
      <ContextHeader
        kind="run"
        back={<BackLink href="/">Search</BackLink>}
        title="[TARGET]"
        meta={<Tag>Detected: domain</Tag>}
      />,
    );
    expect(screen.getByRole("banner").className).toContain("min-h-header");
    expect(screen.getByRole("heading", { level: 1, name: "[TARGET]" }).className).toContain(
      "font-mono",
    );
    expect(screen.getByText("Detected: domain")).toBeTruthy();
  });
});

describe("U1-c: TabBar and TabLink", () => {
  it("links (never role=tab), aria-current only on the current one, which also changes weight and carries the underline", () => {
    const { container } = render(
      <TabBar label="Workspace">
        <TabLink href="/o" current>
          Overview
        </TabLink>
        <TabLink href="/e" current={false}>
          Entities
        </TabLink>
      </TabBar>,
    );
    const bar = screen.getByRole("navigation", { name: "Workspace" });
    expect(within(bar).queryByRole("tab")).toBeNull();
    const links = within(bar).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["Overview", "Entities"]);
    expect(links[0]?.getAttribute("aria-current")).toBe("page");
    expect(links[0]?.className).toContain("tab-indicator-current");
    expect(links[0]?.className).toContain("text-ui-strong");
    expect(links[1]?.hasAttribute("aria-current")).toBe(false);
    expect(links[1]?.className).not.toContain("tab-indicator-current");
    expect(links[1]?.className).toContain("tab-indicator");
    expectTargets(container);
  });
  it("the current tab's underline is not clipped: the bar's content box holds a whole target-sized tab", () => {
    render(
      <TabBar label="Workspace">
        <TabLink href="/o" current>
          Overview
        </TabLink>
      </TabBar>,
    );
    const bar = screen.getByRole("navigation", { name: "Workspace" });
    const link = within(bar).getByRole("link");
    // REGRESSION (U1-c review): a border-box bar of the tab's own height lost its rule's width to its
    // rule, the tab overflowed, and the bar's overflow-x scrolling clipped the underline.
    // Content-box: the rule is drawn outside the tab bar's height, never inside it.
    expect(bar.className).toContain("box-content");
    expect(bar.className).not.toContain("box-border");
    expect(bar.className).toContain("h-tabbar");
    expect(bar.className).toContain("border-b");
    // The tab fills the bar's height and carries the underline as its own bottom edge.
    expect(link.className).toContain("tab-indicator-current");
    expect(link.className).toContain("h-full");
    // And that height is the target size, so a whole tab fits inside the content box.
    const tokens = readFileSync(join(import.meta.dirname, "tokens.css"), "utf8");
    const value = (name: string) => new RegExp(`--ds-${name}:\\s*([^;]+);`).exec(tokens)?.[1];
    expect(value("layout-tabbar-height")).toBeDefined();
    expect(value("layout-tabbar-height")).toBe(value("target-min"));
  });
});

describe("U1-c: Card, NestedCard and DashedNote", () => {
  it("a card is named by its section-label title, with its end slot; a nested card and a dashed note", () => {
    render(
      <>
        <Card
          title="[RECENT]"
          end={
            <TextLink href="/all" size="meta">
              [ALL]
            </TextLink>
          }
        >
          <NestedCard>[NESTED]</NestedCard>
          <NestedCard tone="inferred">[INFERRED ITEM]</NestedCard>
        </Card>
        <DashedNote icon={<svg />}>[NOTE]</DashedNote>
      </>,
    );
    const card = screen.getByRole("region", { name: "[RECENT]" });
    expect(screen.getByRole("heading", { level: 2, name: "[RECENT]" }).className).toContain(
      "text-section-label",
    );
    expect(within(card).getByRole("link", { name: "[ALL]" })).toBeTruthy();
    expect(screen.getByText("[NESTED]").className).toContain("border-border-subtle");
    expect(screen.getByText("[INFERRED ITEM]").className).toContain("bg-claim-inferred-tint");
    const note = screen.getByRole("note");
    expect(note.textContent).toBe("[NOTE]");
    expect(note.className).toContain("border-dashed");
  });
});

describe("U1-c: DensityToggle", () => {
  it("two buttons named in words, aria-pressed on the chosen one, no clipping of their hit areas", () => {
    const onChange = vi.fn();
    const { container } = render(<DensityToggle value="compact" onChange={onChange} />);
    const group = screen.getByRole("group", { name: "Row density" });
    expect(group.className).not.toContain("overflow-hidden");
    const comfortable = screen.getByRole("button", { name: "Comfortable" });
    const compact = screen.getByRole("button", { name: "Compact" });
    expect(comfortable.getAttribute("aria-pressed")).toBe("false");
    expect(compact.getAttribute("aria-pressed")).toBe("true");
    expect(compact.className).toContain("text-small-strong");
    expect(comfortable.className).toContain("text-small");
    expect(comfortable.className).not.toContain("text-small-strong");
    fireEvent.click(comfortable);
    expect(onChange).toHaveBeenCalledWith("comfortable");
    expectTargets(container);
  });
});

describe("U1-c: inputs", () => {
  it("every variant is labelled, edged in border-input, and the toolbar input sits in a target-tall label", () => {
    const onChange = vi.fn();
    const { container } = render(
      <>
        <Field label="Work email" variant="auth" />
        <Field label="Code" variant="otp" />
        <ToolbarInput label="Filter entities" placeholder="[FILTER]" value="" onChange={onChange} />
      </>,
    );
    const email = screen.getByLabelText("Work email");
    expect(email.className).toContain("h-target");
    expect(email.className).toContain("bg-surface-field");
    const code = screen.getByLabelText("Code");
    expect(code.className).toContain("h-otp");
    expect(code.className).toContain("text-mono-otp");
    expect(code.getAttribute("autocomplete")).toBe("one-time-code");
    const filter = screen.getByLabelText("Filter entities");
    expect(filter.className).toContain("h-control-sm");
    expect(filter.closest("label")?.className).toContain("min-h-target");
    fireEvent.change(filter, { target: { value: "[X]" } });
    expect(onChange).toHaveBeenCalledWith("[X]");
    for (const input of container.querySelectorAll("input")) {
      expect(input.className).toContain("border-border-input");
    }
    // The auth label is small-strong in ink-secondary (§9).
    expect(screen.getByText("Work email").className).toContain("text-small-strong");
    expectTargets(container);
  });

  it("REGRESSION: a Field's className styles its input, never its label", () => {
    render(<Field label="[LABEL]" className="font-mono" />);
    expect(screen.getByLabelText("[LABEL]").className).toContain("font-mono");
    expect(screen.getByText("[LABEL]").className).not.toContain("font-mono");
    expect(screen.getByText("[LABEL]").parentElement?.className).not.toContain("font-mono");
  });

  it("the default input is unchanged for screens not yet rebuilt", () => {
    render(<Input aria-label="[DEFAULT]" />);
    const input = screen.getByRole("textbox", { name: "[DEFAULT]" });
    expect(input.className).toContain("min-h-target");
    expect(input.className).toContain("bg-surface-sunken");
  });
});

describe("U1-c: HeroSearch", () => {
  it("a search landmark with a labelled input edged in border-input; submit is a real button that waits for a value", () => {
    const onSubmit = vi.fn();
    function Harness() {
      const [value, setValue] = useState("");
      return (
        <HeroSearch
          label="Target to investigate"
          placeholder="[PLACEHOLDER]"
          value={value}
          onValueChange={setValue}
          onSubmit={onSubmit}
          submitLabel="Investigate"
          submitDisabled={value === ""}
        />
      );
    }
    const { container } = render(<Harness />);
    const form = screen.getByRole("search");
    expect(form.className).toContain("border-border-input");
    expect(form.className).not.toContain("border-border-strong");
    const submit = screen.getByRole("button", { name: "Investigate" });
    expect(submit.hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText("Target to investigate"), {
      target: { value: "[TARGET]" },
    });
    expect(submit.hasAttribute("disabled")).toBe(false);
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledOnce();
    expectTargets(container);
  });

  it("while submitting the button is busy and disabled, with the caller's words", () => {
    render(
      <HeroSearch
        label="[LABEL]"
        placeholder=""
        value="[V]"
        onValueChange={vi.fn()}
        onSubmit={vi.fn()}
        submitLabel="[STARTING]"
        submitting
      />,
    );
    const submit = screen.getByRole("button", { name: "[STARTING]" });
    expect(submit.getAttribute("aria-busy")).toBe("true");
    expect(submit.hasAttribute("disabled")).toBe(true);
  });
});

describe("U1-c: extensions to U1-b components", () => {
  it("FailedAlert writes the code as Code: X, and invents none when there is none", () => {
    const { rerender } = render(
      <FailedAlert
        title="[TITLE]"
        reason="[REASON]"
        code="[CODE]"
        action={<Button size="sm">Try again</Button>}
      />,
    );
    expect(screen.getByRole("alert").textContent).toBe("[TITLE][REASON]Code: [CODE]Try again");
    rerender(<FailedAlert title="[TITLE]" code={null} />);
    expect(screen.getByRole("alert").textContent).toBe("[TITLE]");
  });

  it("PinButton: an unknown pinned state asserts nothing; it spreads props, so it can be a trigger", () => {
    const onClick = vi.fn();
    render(
      <>
        <PinButton pinned={null} label="[UNKNOWN]" onClick={onClick} aria-expanded={false} />
        <PinButton pinned label="[PINNED]" />
      </>,
    );
    const unknown = screen.getByRole("button", { name: "[UNKNOWN]" });
    expect(unknown.hasAttribute("aria-pressed")).toBe(false);
    expect(unknown.getAttribute("aria-expanded")).toBe("false");
    expect(unknown.textContent).toBe("+");
    fireEvent.click(unknown);
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "[PINNED]" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("DataTable: a pin column header named by the caller, a pin rendered per row, the active row marked beyond its tint", () => {
    const { container } = render(
      <DataTable
        caption="[TABLE]"
        columns={[
          { id: "source", header: "Source" },
          { id: "time", header: "Time", kind: "mono" },
        ]}
        rows={[
          { id: "a", cells: { source: "[A]", time: "[T A]" } },
          { id: "b", cells: { source: "[B]", time: "[T B]" } },
        ]}
        empty={{ kind: "empty", title: "[T]", body: "[B]" }}
        activeRowId="b"
        pins={{
          header: "[PIN HEADER]",
          render: (row) => <PinButton pinned={null} label={`[PIN ${row.id}]`} />,
        }}
      />,
    );
    expect(screen.getByRole("columnheader", { name: "[PIN HEADER]" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "[PIN a]" })).toBeTruthy();
    const rows = within(screen.getByRole("table")).getAllByRole("row");
    expect(rows[1]?.hasAttribute("aria-current")).toBe(false);
    expect(rows[2]?.getAttribute("aria-current")).toBe("true");
    expect(screen.getByText("[B]").className).toContain("text-meta-strong");
    expect(screen.getByText("[A]").className).not.toContain("text-meta-strong");
    expectTargets(container);
  });

  it("InspectorDrawer: the caller's pin control in place of the toggle; the footer pair at control-md", () => {
    const { container } = render(
      <InspectorDrawer
        subject={{ kind: "claim", text: "[CLAIM]", strength: "OBSERVED", provenance: PROVENANCE }}
        onClose={vi.fn()}
        pin={{ slot: <PinButton pinned={null} label="[PIN THE CLAIM]" /> }}
        actions={{
          secondary: { label: "[SECONDARY]", onClick: vi.fn() },
          primary: { label: "[PRIMARY]", onClick: vi.fn() },
        }}
      />,
    );
    expect(screen.getByRole("button", { name: "[PIN THE CLAIM]" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Pin to case" })).toBeNull();
    for (const name of ["[SECONDARY]", "[PRIMARY]"]) {
      expect(screen.getByRole("button", { name }).className).toContain("h-control-md");
    }
    expectTargets(container);
  });

  it("MetricCard: rows that share a label stay apart by id", () => {
    render(
      <MetricCard
        title="[CARD]"
        rows={[
          { id: "one", label: "[SAME]", value: { kind: "value", value: "[ONE]" } },
          { id: "two", label: "[SAME]", value: { kind: "value", value: "[TWO]" } },
        ]}
      />,
    );
    expect(screen.getByText("[ONE]")).toBeTruthy();
    expect(screen.getByText("[TWO]")).toBeTruthy();
  });

  it("GraphShell: the toolbar is a group (it has no roving focus to be a toolbar)", () => {
    render(
      <GraphShell
        label="Graph"
        classes={[]}
        state={{ kind: "ready", renderer: <div /> }}
        toolbar={<button type="button">[HOPS]</button>}
        list={<ul />}
      />,
    );
    expect(screen.queryByRole("toolbar")).toBeNull();
    expect(screen.getByRole("group", { name: "Graph controls" })).toBeTruthy();
  });
});

describe("U1-c: LockDetail", () => {
  it("the check time can be the caller's own element (a <time> with its instant)", () => {
    render(
      <LockDetail
        lock={{
          reason: "PERMISSION_LOST",
          code: "[CODE]",
          detail: "[DETAIL]",
          locked: null,
          recheckIntervalMs: 5_000,
          checkedAt: <time dateTime="[ISO]">[LOCAL TIME]</time>,
        }}
      />,
    );
    expect(screen.getByText("[LOCAL TIME]").tagName).toBe("TIME");
  });
});

describe("U1-c review: wrapping, the unmeasured credit figure, the palette", () => {
  it("KeyValueList breaks a mono value anywhere, but prose only between words", () => {
    render(
      <KeyValueList
        rows={[
          { key: "[MONO KEY]", value: "[MONO VALUE]" },
          { key: "[PROSE KEY]", value: "[PROSE VALUE]", mono: false },
        ]}
      />,
    );
    const mono = screen.getByText("[MONO VALUE]");
    expect(mono.className).toContain("break-all");
    expect(mono.className).toContain("font-mono");
    const prose = screen.getByText("[PROSE VALUE]");
    expect(prose.className).toContain("break-words");
    expect(prose.className).not.toContain("break-all");
    expect(prose.className).not.toContain("font-mono");
  });

  it("CreditsMeter draws the unmeasured em dash at the figure's size, in sans", () => {
    render(
      <CreditsMeter
        used={{ value: null, reason: "[WHY NO CREDITS]" }}
        limit={{ value: null, reason: "[WHY NO LIMIT]" }}
      />,
    );
    const dash = screen.getByRole("button", { name: "Not measured. [WHY NO CREDITS]" });
    expect(dash.className).toContain("text-metric");
    expect(dash.className).not.toContain("text-ui");
    expect(dash.className).toContain("font-sans");
  });

  it("the account menu wraps a long email between words, never mid-word", () => {
    render(
      <AccountMenu
        initials="[AB]"
        name="[NAME]"
        email="[EMAIL]"
        organisation={null}
        theme="light"
        onThemeChange={vi.fn()}
        onSignOut={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    const email = screen.getByText("[EMAIL]");
    expect(email.className).toContain("break-words");
    expect(email.className).not.toContain("break-all");
  });

  it("a palette hint may hold markup; the filter matches its words through hintText", () => {
    render(
      <CommandPalettePanel
        groups={[
          {
            label: "[GROUP]",
            items: [
              {
                id: "a",
                label: "[LABEL A]",
                hint: (
                  <>
                    [WORDS A] <time dateTime="2026-01-01T00:00:00.000Z">[TIME]</time>
                  </>
                ),
                hintText: "[WORDS A]",
              },
              { id: "b", label: "[LABEL B]", hint: "[WORDS B]" },
            ],
          },
        ]}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText("[TIME]").tagName).toBe("TIME");
    const input = screen.getByRole("combobox");
    // The input has its own inner padding, so the focus ring does not sit on the text.
    expect(input.className).toContain("px-2");
    fireEvent.change(input, { target: { value: "words a" } });
    expect(screen.getAllByRole("option").map((option) => option.firstChild?.textContent)).toEqual([
      "[LABEL A]",
    ]);
    fireEvent.change(input, { target: { value: "words b" } });
    expect(screen.getAllByRole("option").map((option) => option.firstChild?.textContent)).toEqual([
      "[LABEL B]",
    ]);
  });

  it("the open palette sits over a neutral scrim from the surface tokens", () => {
    render(<CommandPalette open onOpenChange={vi.fn()} groups={[]} onSelect={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "Command palette" })).toBeTruthy();
    const scrim = [...document.querySelectorAll("div")].find((node) =>
      node.classList.contains("bg-surface-page/70"),
    );
    expect(scrim).not.toBeNull();
    expect(scrim?.className).toContain("fixed");
  });
});

/**
 * The U1-b component library: a render test for each component, and
 * behaviour tests for the honest states (CLAUDE.md §1, DESIGN-SYSTEM §8).
 * Fixture values are bracketed placeholders: nothing here is a real source,
 * count or date.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  InferredPassage,
  ReportProse,
  ReportSurface,
} from "./report-surface.tsx";
import {
  CollectorList,
  LOCK_REASONS,
  LOCK_REASON_TITLE,
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

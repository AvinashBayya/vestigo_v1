import {
  AccountMenu,
  AddFilterChip,
  AppHeader,
  ArrivingNow,
  BackLink,
  Button,
  Card,
  CitationMarker,
  Citations,
  CLAIM_STRENGTH_LABELS,
  cn,
  COLLECTOR_STATUSES,
  CollectorList,
  CommandPalette,
  CommandPaletteButton,
  CommandPalettePanel,
  ContextHeader,
  CoverageLimitation,
  CreditsMeter,
  DashedNote,
  DataTable,
  DensityToggle,
  ENTITY_CLASS_LABEL,
  EvidenceCard,
  FailedAlert,
  Field,
  FilterChip,
  FilterChipRow,
  FilterToggle,
  GraphShell,
  GraphToolbarButton,
  HeroSearch,
  InferredPassage,
  InspectorDrawer,
  MapShell,
  MetricCard,
  NavItem,
  NestedCard,
  NO_OBSERVED_AT,
  PinButton,
  ProductMark,
  ReportProse,
  ReportSectionHeading,
  ReportSurface,
  RUN_STATUSES,
  RunsRail,
  RunStatusChip,
  SelectedPointCard,
  SideNav,
  Skeleton,
  StatusChip,
  StatusDot,
  StrengthBadge,
  StrengthKey,
  TabBar,
  TableSearch,
  TabLink,
  Tag,
  TagList,
  TextLink,
  ToolbarInput,
  Unmeasured,
  useCommandPaletteShortcut,
  VETTING_STATUSES,
  VettingPill,
  type DataTableColumn,
  type DataTableRow,
  type Density,
  type MapPoint,
  type ThemeChoice,
} from "@repo/ui";
import { FolderOpen, Info, Search } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { applyTheme, initialTheme } from "../theme.ts";
import { CytoscapeGraph } from "../workspace/graph/CytoscapeGraph.tsx";
import type { GraphSelection } from "../workspace/graph/types.ts";
import {
  EVIDENCE_CARDS,
  GRAPH_EDGES,
  GRAPH_NODES,
  LOCKS,
  NOTHING_FOUND_CARD,
  PALETTE_GROUPS,
  PROVENANCE,
  PROVENANCE_GAPS,
} from "./fixtures.ts";

type Mode = ThemeChoice | "both";

const ModeContext = createContext<Mode>("light");

const ignore = () => undefined;

/**
 * One state of one component. In "both" mode it is drawn twice: in the page's
 * light theme and inside a region set to dark (the tokens switch on
 * data-theme, so a region can carry its own). Overlays that render outside
 * the region (tooltips, menus) take the page's theme.
 */
function Specimen({
  label,
  wide = false,
  children,
}: {
  readonly label: string;
  readonly wide?: boolean;
  readonly children: ReactNode;
}) {
  const mode = useContext(ModeContext);
  const frame = (theme: ThemeChoice | null) => (
    <div
      {...(theme === "dark" && mode === "both" ? { "data-theme": "dark" } : {})}
      className="flex min-w-0 flex-col gap-3 rounded-lg border border-border-default bg-surface-page p-4 text-ink-primary"
    >
      <p className="text-caption text-ink-muted">
        {label}
        {theme === null ? "" : ` · ${theme}`}
      </p>
      {children}
    </div>
  );
  if (mode !== "both") return frame(null);
  return (
    <div className={cn("grid gap-4", !wide && "xl:grid-cols-2")}>
      {frame("light")}
      {frame("dark")}
    </div>
  );
}

function Section({
  id,
  index,
  name,
  mockup,
  children,
}: {
  readonly id: string;
  readonly index: string;
  readonly name: string;
  /** The mockup it matches, as named in DESIGN-SYSTEM §9. */
  readonly mockup: string;
  readonly children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="flex scroll-mt-16 flex-col gap-4">
      <div className="flex flex-col gap-1.25 border-b border-border-default pb-3">
        <h2 id={`${id}-title`} className="text-title text-ink-primary">
          {index}. {name}
        </h2>
        <p className="text-meta text-ink-muted">
          Matches <span className="font-mono text-mono-meta">{mockup}</span> in docs/design/mockups
          (HTML and PNG)
        </p>
      </div>
      {children}
    </section>
  );
}

const SECTIONS: readonly (readonly [string, string])[] = [
  ["header", "Header row"],
  ["palette", "Command palette"],
  ["status", "Status chip"],
  ["strength", "Strength badge"],
  ["filter", "Filter chip"],
  ["table", "Data table"],
  ["drawer", "Inspector drawer"],
  ["metric", "Metric card"],
  ["graph", "Graph shell"],
  ["rail", "Runs rail"],
  ["evidence", "Evidence card"],
  ["map", "Map shell"],
  ["report", "Report surface"],
  ["buttons", "Buttons (sizes)"],
  ["links", "Text and back links"],
  ["tags", "Tag"],
  ["navigation", "Side navigation"],
  ["context-header", "Case and run header"],
  ["tabbar", "Tab bar"],
  ["card", "Card"],
  ["density", "Density toggle"],
  ["inputs", "Inputs"],
  ["hero", "Hero search"],
  ["extensions", "Failed, pins, active row"],
];

function HeaderRowSection() {
  const [theme, setTheme] = useState<ThemeChoice>(initialTheme);
  return (
    <Section
      id="header"
      index="0"
      name="App header row and vetting pill"
      mockup="Main, Dashboard-dark"
    >
      <Specimen label="Header row" wide>
        <AppHeader
          start={<CommandPaletteButton onOpen={ignore} />}
          end={
            <>
              <VettingPill status="APPROVED" />
              <AccountMenu
                initials="[AB]"
                name="[NAME]"
                email="[EMAIL]"
                organisation="[ORGANISATION]"
                theme={theme}
                onThemeChange={(next) => {
                  applyTheme(next);
                  setTheme(next);
                }}
                onSwitchOrganisation={ignore}
                onSignOut={ignore}
              />
            </>
          }
        />
      </Specimen>
      <Specimen label="Vetting pill, every status (neutral, D1)">
        <div className="flex flex-wrap gap-3">
          {VETTING_STATUSES.map((status) => (
            <VettingPill key={status} status={status} />
          ))}
        </div>
      </Specimen>
    </Section>
  );
}

function PaletteSection() {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const openPalette = useCallback(() => {
    setOpen(true);
  }, []);
  useCommandPaletteShortcut(openPalette);
  return (
    <Section
      id="palette"
      index="1"
      name="Command palette"
      mockup="Main (button); palette not drawn"
    >
      <Specimen label="Closed: the header button. Press Ctrl K or ⌘K, or click, to open the live palette">
        <div className="flex flex-wrap items-center gap-3">
          <CommandPaletteButton onOpen={openPalette} />
          <p className="text-caption text-ink-muted">
            {picked === null ? "Nothing chosen yet." : `Last chosen: ${picked}`}
          </p>
        </div>
        <CommandPalette
          open={open}
          onOpenChange={setOpen}
          groups={PALETTE_GROUPS}
          onSelect={setPicked}
        />
      </Specimen>
      <Specimen label="Open, grouped results (arrow keys move, Enter opens)">
        <CommandPalettePanel groups={PALETTE_GROUPS} onSelect={setPicked} />
      </Specimen>
      <Specimen label="Query typed">
        <CommandPalettePanel groups={PALETTE_GROUPS} onSelect={setPicked} initialQuery="case" />
      </Specimen>
      <Specimen label="No results">
        <CommandPalettePanel
          groups={PALETTE_GROUPS}
          onSelect={setPicked}
          initialQuery="[nothing like this]"
        />
      </Specimen>
      <Specimen label="Loading">
        <CommandPalettePanel
          groups={PALETTE_GROUPS}
          onSelect={setPicked}
          loading="Reading runs and cases."
        />
      </Specimen>
      <Specimen label="Empty (nothing to open yet)">
        <CommandPalettePanel groups={[]} onSelect={setPicked} />
      </Specimen>
    </Section>
  );
}

function StatusSection() {
  return (
    <Section id="status" index="2" name="Status chip" mockup="Main, Run, RunLive">
      <Specimen label="Every collector status, with its dot">
        <ul className="flex flex-wrap gap-x-5 gap-y-3">
          {COLLECTOR_STATUSES.map((status) => (
            <li key={status} className="inline-flex items-center gap-2">
              <StatusDot status={status} />
              <StatusChip status={status} />
            </li>
          ))}
        </ul>
      </Specimen>
      <Specimen label="Run status (separate vocabulary; a run's PARTIAL is amber)">
        <div className="flex flex-wrap gap-3">
          {RUN_STATUSES.map((status) => (
            <RunStatusChip key={status} status={status} />
          ))}
        </div>
      </Specimen>
      <Specimen label="Count chips">
        <div className="flex flex-wrap gap-3">
          <StatusChip status="RAN">[N] ran</StatusChip>
          <StatusChip status="RUNNING">[N] running</StatusChip>
          <StatusChip status="FAILED">[N] failed</StatusChip>
          <StatusChip status="QUEUED">[N] not run</StatusChip>
        </div>
      </Specimen>
    </Section>
  );
}

function StrengthSection() {
  return (
    <Section
      id="strength"
      index="3"
      name="Strength badge"
      mockup="Workspace, Entities, Evidence, Timeline, Map, Report"
    >
      <Specimen label="md (inspector)">
        <div className="flex flex-wrap gap-2">
          {CLAIM_STRENGTH_LABELS.map((strength) => (
            <StrengthBadge key={strength} strength={strength} />
          ))}
        </div>
      </Specimen>
      <Specimen label="sm (tables, cards, timeline, map, report)">
        <div className="flex flex-wrap gap-2">
          {CLAIM_STRENGTH_LABELS.map((strength) => (
            <StrengthBadge key={strength} strength={strength} size="sm" />
          ))}
        </div>
      </Specimen>
      <Specimen label="Key: each mark with its word">
        <StrengthKey />
      </Specimen>
    </Section>
  );
}

function FilterSection() {
  const [on, setOn] = useState(true);
  const [off, setOff] = useState(false);
  const [removed, setRemoved] = useState<string[]>([]);
  return (
    <Section id="filter" index="4" name="Filter chip" mockup="Evidence">
      <Specimen label="Removable (applied), active, inactive, and the add chip (drawn at control-sm, hit area target-min)">
        <FilterChipRow label="Evidence filters">
          {["Collector", "Strength"]
            .filter((facet) => !removed.includes(facet))
            .map((facet) => (
              <FilterChip
                key={facet}
                facet={facet}
                value={facet === "Strength" ? "OBSERVED" : "[SOURCE]"}
                onRemove={() => {
                  setRemoved([...removed, facet]);
                }}
              />
            ))}
          <FilterToggle pressed={on} onPressedChange={setOn}>
            [ACTIVE FACET VALUE]
          </FilterToggle>
          <FilterToggle pressed={off} onPressedChange={setOff}>
            [INACTIVE FACET VALUE]
          </FilterToggle>
          <AddFilterChip
            onClick={() => {
              setRemoved([]);
            }}
          />
        </FilterChipRow>
      </Specimen>
    </Section>
  );
}

const COLUMNS: readonly DataTableColumn[] = [
  { id: "claim", header: "Claim", sortable: true, kind: "primary" },
  { id: "strength", header: "Strength" },
  { id: "collector", header: "Collector", sortable: true },
  { id: "observed", header: "Observed", sortable: true, kind: "mono" },
  { id: "collected", header: "Collected", sortable: true, kind: "mono-muted" },
  { id: "hash", header: "Hash", kind: "mono-muted" },
];

function rowsFor(): DataTableRow[] {
  return EVIDENCE_CARDS.map((card) => ({
    id: card.id,
    cells:
      card.kind === "found"
        ? {
            claim: card.text,
            strength: <StrengthBadge strength={card.strength} size="sm" />,
            collector: card.sourceLabel,
            observed: card.observedAt ?? (
              <Unmeasured reason={NO_OBSERVED_AT} className="justify-start" />
            ),
            collected: card.collectedAt,
            hash:
              card.contentHash === null ? (
                <Unmeasured
                  reason="No content hash was recorded for this item."
                  className="justify-start"
                />
              ) : (
                `${card.contentHash.slice(0, 4)}…${card.contentHash.slice(-3)}`
              ),
          }
        : {},
  }));
}

function TableSection() {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set(["e-observed"]));
  const [pinned, setPinned] = useState<ReadonlySet<string>>(new Set(["e-observed"]));
  const [sort, setSort] = useState<{ column: string; direction: "ascending" | "descending" }>({
    column: "collected",
    direction: "descending",
  });
  const [query, setQuery] = useState("");
  const [density, setDensity] = useState<"compact" | "comfortable">("compact");
  const rows = rowsFor();
  const toggle = (set: ReadonlySet<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };
  return (
    <Section id="table" index="5" name="Data table (the Evidence grid)" mockup="Evidence; Entities">
      <Specimen label="Rows: sortable headers, one row selected, one pinned" wide>
        <DataTable
          caption="Evidence"
          columns={COLUMNS}
          rows={rows}
          density={density}
          empty={{ kind: "empty", title: "[EMPTY]", body: "[EMPTY]" }}
          sort={sort}
          onSortChange={(column) => {
            setSort({
              column,
              direction:
                sort.column === column && sort.direction === "ascending"
                  ? "descending"
                  : "ascending",
            });
          }}
          selection={{
            selected,
            onToggle: (id) => {
              setSelected(toggle(selected, id));
            },
            onToggleAll: () => {
              setSelected(
                selected.size === rows.length ? new Set() : new Set(rows.map((row) => row.id)),
              );
            },
          }}
          pins={{
            pinned,
            onToggle: (id) => {
              setPinned(toggle(pinned, id));
            },
          }}
          toolbar={
            <>
              <TableSearch
                label="Search evidence"
                placeholder="Search evidence text, source or hash"
                value={query}
                onChange={setQuery}
              />
              <FilterChip facet="Strength" value="OBSERVED" onRemove={ignore} />
              <AddFilterChip onClick={ignore} />
              <FilterToggle
                pressed={density === "comfortable"}
                onPressedChange={(pressed) => {
                  setDensity(pressed ? "comfortable" : "compact");
                }}
              >
                Comfortable density
              </FilterToggle>
            </>
          }
          footer={{
            start: `${String(selected.size)} selected · ${String(rows.length)} of [N] rows`,
            end: "Rows are never deleted; evidence is append-only.",
          }}
        />
      </Specimen>
      <Specimen label="Loading" wide>
        <DataTable
          caption="Evidence"
          columns={COLUMNS}
          rows={[]}
          loading="Reading the evidence."
          empty={{ kind: "empty", title: "[EMPTY]", body: "[EMPTY]" }}
        />
      </Specimen>
      <Specimen label="Empty" wide>
        <DataTable
          caption="Evidence"
          columns={COLUMNS}
          rows={[]}
          empty={{
            kind: "empty",
            title: "No evidence yet",
            body: "Evidence appears here when a run collects it, or when you pin it to the case.",
          }}
        />
      </Specimen>
      <Specimen label="Not built" wide>
        <DataTable
          caption="Media"
          columns={COLUMNS}
          rows={[]}
          empty={{
            kind: "not-built",
            title: "Media in this case",
            needs: "It needs the media endpoints, which the API does not have.",
          }}
        />
      </Specimen>
    </Section>
  );
}

function DrawerSection() {
  const [pinned, setPinned] = useState(true);
  return (
    <Section
      id="drawer"
      index="6"
      name="Inspector and provenance drawer (layout-drawer-width)"
      mockup="Workspace, Evidence"
    >
      <div className="grid gap-4 xl:grid-cols-2">
        <Specimen label="Evidence: provenance in full">
          <InspectorDrawer
            className="h-auto"
            subject={{
              kind: "evidence",
              title: "[EVIDENCE TITLE]",
              strength: "OBSERVED",
              provenance: PROVENANCE,
              usedIn: [{ label: "Entity: [DOMAIN]", href: "#drawer" }],
            }}
            onClose={ignore}
            pin={{
              pinned,
              onToggle: () => {
                setPinned(!pinned);
              },
            }}
            actions={{ primary: { label: "[PRIMARY ACTION]", onClick: ignore } }}
          />
        </Specimen>
        <Specimen label="Evidence: no observed time, hash, URL or payload (each null kept null)">
          <InspectorDrawer
            className="h-auto"
            subject={{
              kind: "evidence",
              title: "[EVIDENCE TITLE]",
              strength: null,
              provenance: PROVENANCE_GAPS,
            }}
            onClose={ignore}
          />
        </Specimen>
        <Specimen label="Entity">
          <InspectorDrawer
            className="h-auto"
            subject={{
              kind: "entity",
              entityClass: "ORGANIZATION",
              name: "[ENTITY NAME]",
              strengths: ["OBSERVED", "REPORTED", "DERIVED", "INFERRED"],
              attributes: [
                { key: "Registered", value: "[DATE]" },
                { key: "Jurisdiction", value: "[COUNTRY]" },
                { key: "Employee count", value: null, reason: "No source in this case states it." },
              ],
              evidence: EVIDENCE_CARDS,
              evidenceSummary: "[N] items · [N] sources",
            }}
            onClose={ignore}
            pin={{ pinned: false, onToggle: ignore }}
          />
        </Specimen>
        <Specimen label="Claim">
          <InspectorDrawer
            className="h-auto"
            subject={{
              kind: "claim",
              text: "[THE CLAIM AS RECORDED]",
              strength: "REPORTED",
              provenance: PROVENANCE,
            }}
            onClose={ignore}
            actions={{
              secondary: { label: "[SECONDARY]", onClick: ignore },
              primary: { label: "[PRIMARY]", onClick: ignore },
            }}
          />
        </Specimen>
        <Specimen label="Relationship">
          <InspectorDrawer
            className="h-auto"
            subject={{
              kind: "relationship",
              relation: "[RELATION]",
              from: { entityClass: "DOMAIN", name: "[DOMAIN]" },
              to: { entityClass: "IP_ADDRESS", name: "[IP ADDRESS]" },
              strengths: ["OBSERVED"],
              evidence: EVIDENCE_CARDS.slice(0, 1),
            }}
            onClose={ignore}
          />
        </Specimen>
      </div>
    </Section>
  );
}

function MetricSection() {
  return (
    <Section id="metric" index="7" name="Metric card and arriving now" mockup="RunLive">
      <div className="grid gap-4 xl:grid-cols-2">
        <Specimen label="Value present">
          <MetricCard
            title="Cost"
            rows={[
              { label: "Estimated before run", value: { kind: "value", value: "[N]" } },
              { label: "Spent so far", value: { kind: "value", value: "[N]" } },
            ]}
            footnote="A failed collector is charged for the attempts it made."
          />
        </Specimen>
        <Specimen label="Value unavailable: an em dash and its reason (as the API is today)">
          <MetricCard
            title="Cost"
            rows={[
              {
                label: "Estimated before run",
                value: {
                  kind: "unavailable",
                  reason: "this run stores no cost estimate",
                  cause: "not-recorded",
                },
              },
              {
                label: "Spent so far",
                value: {
                  kind: "unavailable",
                  reason: "per-run cost metering is not built",
                  cause: "not-recorded",
                },
              },
            ]}
          />
        </Specimen>
        <Specimen label="Not built">
          <MetricCard
            title="Credits"
            rows={[]}
            notBuilt="It needs credit metering, which does not exist yet."
          />
        </Specimen>
        <Specimen label="Arriving now: one value unmeasured because its collector failed">
          <ArrivingNow
            rows={[
              { label: "Claims", value: { kind: "value", value: "[N]" } },
              { label: "Evidence items", value: { kind: "value", value: "[N]" } },
              {
                label: "[COUNT]",
                value: { kind: "unavailable", reason: "[SOURCE] failed", cause: "failed" },
              },
            ]}
          />
        </Specimen>
      </div>
    </Section>
  );
}

function GraphSection() {
  const [selected, setSelected] = useState<GraphSelection | null>({ kind: "node", id: "n-org" });
  const [hideInferred, setHideInferred] = useState(false);
  const edges = hideInferred
    ? GRAPH_EDGES.filter((edge) => !edge.strengths.includes("INFERRED"))
    : GRAPH_EDGES;
  const classes = [...new Set(GRAPH_NODES.map((node) => node.kind))];
  const list = (
    <ul aria-label="The graph as a list" className="flex flex-col text-small text-ink-secondary">
      {GRAPH_NODES.map((node) => (
        <li key={node.id}>
          <button
            type="button"
            aria-pressed={selected?.id === node.id}
            onClick={() => {
              setSelected({ kind: "node", id: node.id });
            }}
            className="min-h-target cursor-pointer text-left hover:text-ink-primary"
          >
            {ENTITY_CLASS_LABEL[node.kind]} · {node.displayName}
          </button>
        </li>
      ))}
    </ul>
  );
  const toolbar = (
    <>
      <GraphToolbarButton onClick={ignore}>Layout</GraphToolbarButton>
      <GraphToolbarButton onClick={ignore}>[N] hops</GraphToolbarButton>
      <GraphToolbarButton
        pressed={hideInferred}
        onClick={() => {
          setHideInferred(!hideInferred);
        }}
      >
        Hide inferred
      </GraphToolbarButton>
    </>
  );
  return (
    <Section id="graph" index="8" name="Graph shell (Cytoscape.js)" mockup="Workspace">
      <Specimen
        label="Ready: nodes by entity class, the selected node outlined in accent (D3), edges neutral"
        wide
      >
        <GraphShell
          className="h-screen"
          label="Graph"
          classes={classes}
          toolbar={toolbar}
          state={{
            kind: "ready",
            renderer: (
              <CytoscapeGraph
                className="min-h-0 w-full grow"
                nodes={GRAPH_NODES}
                edges={edges}
                selected={selected}
                onSelect={setSelected}
              />
            ),
          }}
          list={list}
        />
      </Specimen>
      <div className="grid gap-4 xl:grid-cols-2">
        <Specimen label="Loading">
          <GraphShell
            className="aspect-video"
            label="Graph"
            classes={[]}
            state={{ kind: "loading", what: "Reading the graph." }}
            list={null}
          />
        </Specimen>
        <Specimen label="Empty">
          <GraphShell
            className="aspect-video"
            label="Graph"
            classes={[]}
            state={{
              kind: "empty",
              title: "No entities yet",
              body: "Entities appear here once a run finds them, or when you pin one to the case.",
            }}
            list={null}
          />
        </Specimen>
      </div>
    </Section>
  );
}

function RailSection() {
  const [selected, setSelected] = useState<string | null>("run-SUCCEEDED");
  const [disciplines, setDisciplines] = useState<Readonly<Record<string, boolean>>>({
    TECHINT: true,
    SOCMINT: true,
    GEOINT: false,
  });
  return (
    <Section
      id="rail"
      index="9"
      name="Runs rail and collector rows"
      mockup="Workspace (runs rail), RunLive (collector rows)"
    >
      <div className="grid gap-4 xl:grid-cols-2">
        <Specimen label="Runs rail: every run status (a PARTIAL run is labelled partial), and each of the five locked reasons">
          <RunsRail
            selectedId={selected}
            onSelect={setSelected}
            runs={[
              ...RUN_STATUSES.map((status) => ({
                id: `run-${status}`,
                target: "[TARGET]",
                meta: "[MODE] · [TIME] · [N]/[N] ok",
                status,
                ...(status === "FAILED" ? { failureCode: "[ERROR CODE]" } : {}),
              })),
              ...LOCKS.map((lock) => ({
                id: `run-${lock.reason}`,
                target: "[TARGET]",
                meta: "[MODE] · [TIME]",
                status: "RUNNING" as const,
                lock,
              })),
            ]}
            disciplines={Object.entries(disciplines).map(([id, checked]) => ({
              id,
              label: id,
              count:
                id === "GEOINT"
                  ? { value: null, reason: "Not counted: no GEOINT collector ran." }
                  : { value: "[N]" },
              checked,
              onChange: (next: boolean) => {
                setDisciplines({ ...disciplines, [id]: next });
              },
            }))}
            pinned={
              <>
                <p>[N] evidence items</p>
                <p>[N] entities</p>
              </>
            }
          />
        </Specimen>
        <Specimen label="Collector rows: ran, running (with and without reported progress), failed, found nothing, and the rest">
          <CollectorList
            items={[
              {
                id: "c1",
                label: "[COLLECTOR]",
                status: "RAN",
                meta: "[DISCIPLINE] · [N] claims · [DURATION]",
              },
              { id: "c2", label: "[COLLECTOR]", status: "RUNNING", progress: 0.5 },
              {
                id: "c3",
                label: "[COLLECTOR]",
                status: "RUNNING",
                progress: null,
                meta: "The source does not report progress.",
              },
              {
                id: "c4",
                label: "[COLLECTOR]",
                status: "FAILED",
                failure: {
                  code: "[ERROR CODE]",
                  message: "[THE API'S MESSAGE] · [N] attempts · dead-lettered",
                },
              },
              {
                id: "c5",
                label: "[COLLECTOR]",
                status: "FOUND_NOTHING",
                meta: "Ran and found nothing for this target.",
              },
              {
                id: "c6",
                label: "[COLLECTOR]",
                status: "NEEDS_KEY",
                meta: "No credential is configured.",
              },
              { id: "c7", label: "[COLLECTOR]", status: "HELD", meta: "[THE REGISTRY'S REASON]" },
              {
                id: "c8",
                label: "[COLLECTOR]",
                status: "SKIPPED",
                meta: "[WHY IT DOES NOT APPLY]",
              },
            ]}
          />
        </Specimen>
        <Specimen label="Collector rows when the run's stream is locked">
          <CollectorList
            lock={LOCKS[3]}
            items={[{ id: "c1", label: "[COLLECTOR]", status: "LOCKED", meta: "[META]" }]}
          />
        </Specimen>
      </div>
    </Section>
  );
}

function EvidenceSection() {
  const [pinned, setPinned] = useState<ReadonlySet<string>>(new Set());
  return (
    <Section id="evidence" index="10" name="Evidence card" mockup="Workspace">
      <div className="grid gap-4 xl:grid-cols-2">
        {EVIDENCE_CARDS.map((card) => (
          <Specimen
            key={card.id}
            label={
              card.kind === "found" && card.observedAt === null
                ? `Found, ${card.strength}: no observed time or hash`
                : `Found, ${card.kind === "found" ? card.strength : ""}`
            }
          >
            <EvidenceCard
              {...card}
              {...(card.kind === "found"
                ? {
                    pin: {
                      pinned: pinned.has(card.id),
                      onToggle: () => {
                        const next = new Set(pinned);
                        if (next.has(card.id)) next.delete(card.id);
                        else next.add(card.id);
                        setPinned(next);
                      },
                    },
                  }
                : {})}
            />
          </Specimen>
        ))}
        <Specimen label="Found nothing">
          <EvidenceCard {...NOTHING_FOUND_CARD} />
        </Specimen>
      </div>
    </Section>
  );
}

const POINTS: readonly MapPoint[] = [
  { id: "p1", label: "[SITE]", entityClass: "LOCATION", position: { lat: 0.5, lon: 0.5 } },
  {
    id: "p2",
    label: "[ORGANISATION]",
    entityClass: "ORGANIZATION",
    position: { lat: 0.25, lon: 0.75 },
  },
  {
    id: "p3",
    label: "[PLACE NAME ONLY]",
    entityClass: "LOCATION",
    position: null,
    reason: "The source named a place but gave no coordinates; nothing is placed by guessing.",
  },
];

function MapSection() {
  const [layers, setLayers] = useState<Readonly<Record<string, boolean>>>({
    entities: true,
    orgs: true,
  });
  const [selectedId, setSelectedId] = useState<string>("p1");
  const selected = POINTS.find((point) => point.id === selectedId);
  return (
    <Section id="map" index="11" name="Map shell (MapLibre GL slot)" mockup="Map">
      <Specimen
        label="Layers, legend, selected point, and a point without coordinates. The coordinates are [FIXTURE] numbers, not a place"
        wide
      >
        <MapShell
          className="h-screen"
          layers={[
            {
              id: "entities",
              label: "Locations",
              entityClass: "LOCATION",
              count: { value: "[N]" },
              checked: layers["entities"] === true,
              onChange: (checked) => {
                setLayers({ ...layers, entities: checked });
              },
            },
            {
              id: "orgs",
              label: "Organisations",
              entityClass: "ORGANIZATION",
              count: {
                value: null,
                reason: "Not counted: the API has no coordinates endpoint yet.",
              },
              checked: layers["orgs"] === true,
              onChange: (checked) => {
                setLayers({ ...layers, orgs: checked });
              },
            },
          ]}
          points={POINTS}
          selectedId={selectedId}
          onSelect={setSelectedId}
          note="Points are drawn only where a source supplied coordinates. Nothing is placed by guessing from a place name."
          renderer={
            <div className="flex grow items-center justify-center p-8">
              <p className="max-w-form rounded-lg border border-dashed border-border-strong p-4 text-prose-small text-ink-secondary">
                The map renderer (MapLibre GL) mounts here. It is not installed yet: adding it is a
                new runtime dependency, raised at the U1-b checkpoint. The shell draws nothing in
                its place.
              </p>
            </div>
          }
          selected={
            selected === undefined ? undefined : (
              <SelectedPointCard
                point={selected}
                strength={selected.position === null ? null : "REPORTED"}
                rows={[
                  { key: "Accuracy", value: "[ACCURACY]" },
                  { key: "Source", value: "[SOURCE LABEL]", mono: false },
                ]}
                action={{ label: "Pin to case", onClick: ignore }}
              />
            )
          }
        />
      </Specimen>
    </Section>
  );
}

function ReportSection() {
  const [opened, setOpened] = useState<number | null>(null);
  return (
    <Section id="report" index="12" name="Report surface (the only serif)" mockup="Report">
      <Specimen label="Section with citations, an inference and a coverage limitation" wide>
        <ReportSurface title="[REPORT TITLE]">
          <ReportSectionHeading>[SECTION TITLE]</ReportSectionHeading>
          <ReportProse>
            [SUMMARY SENTENCE ONE.]
            <CitationMarker n={1} /> [SUMMARY SENTENCE TWO, DESCRIBING WHAT WAS OBSERVED DIRECTLY.]
            <CitationMarker n={2} />
            <CitationMarker n={3} />
          </ReportProse>
          <Citations numbers={[1, 2, 3]} onOpen={setOpened} />
          <InferredPassage from="[WHAT IT RESTS ON]">
            [SENTENCE CARRYING AN INFERENCE.]
            <CitationMarker n={4} />
          </InferredPassage>
          <Citations numbers={[4]} onOpen={setOpened} />
          <ReportProse>
            [SENTENCE FOUR.]
            <CitationMarker n={5} />
          </ReportProse>
          <Citations numbers={[5]} onOpen={setOpened} />
          <ReportProse>
            [SENTENCE CITING A NAMED SOURCE AND A NUMBER NO SOURCE MATCHES.]
            <CitationMarker n={6} />
            <CitationMarker n={7} />
          </ReportProse>
          <Citations
            numbers={[6, 7]}
            onOpen={setOpened}
            labels={new Map([[6, "[SOURCE LABEL]"]])}
            missing={(n) => `${String(n)}. [NO SOURCE MATCHES THIS NUMBER.]`}
          />
          <CoverageLimitation title="Coverage limitation carried into the report">
            [WHAT WAS NEVER COLLECTED, AND WHY.] This section says so rather than describing the
            target as having none.
          </CoverageLimitation>
        </ReportSurface>
        <p role="status" className="text-caption text-ink-muted">
          {opened === null
            ? "No citation opened."
            : `Citation ${String(opened)} would open its evidence.`}
        </p>
      </Specimen>
    </Section>
  );
}

/*
 * U1-c: the components the rebuilt screens are made of. Each is drawn in every
 * state it has, labelled with the mockup it matches. Values are bracketed
 * placeholders; a measured figure is never drawn with a made-up number.
 */

const NO_CREDITS = "Not measured: credit metering is not built.";

function ButtonSection() {
  return (
    <Section
      id="buttons"
      index="13"
      name="Buttons at three sizes"
      mockup="SignIn, MfaEnrol (lg); Overview, Entities (md); Workspace header, Entities (sm)"
    >
      {(["lg", "md", "sm"] as const).map((size) => (
        <Specimen key={size} label={`${size}: primary, secondary, quiet, disabled, pending`}>
          <div className="flex flex-wrap items-center gap-3">
            <Button size={size}>[PRIMARY]</Button>
            <Button size={size} variant="secondary">
              [SECONDARY]
            </Button>
            <Button size={size} variant="quiet">
              [QUIET]
            </Button>
            <Button size={size} disabled>
              [DISABLED]
            </Button>
            <Button size={size} variant="secondary" disabled aria-busy>
              [WORKING]…
            </Button>
          </div>
        </Specimen>
      ))}
      <Specimen label="No size: the U1-b look, kept for screens not yet rebuilt">
        <div className="flex flex-wrap items-center gap-3">
          <Button>[PRIMARY]</Button>
          <Button variant="secondary">[SECONDARY]</Button>
        </div>
      </Specimen>
    </Section>
  );
}

function LinkSection() {
  return (
    <Section
      id="links"
      index="14"
      name="Standalone link and back link (D2)"
      mockup="Main (card header links); Workspace, Timeline (Cases); RunLive (Search)"
    >
      <Specimen label="TextLink at ui and at meta; BackLink with and without its chevron">
        <div className="flex flex-wrap items-center gap-5">
          <TextLink href="#links">[LINK AT UI]</TextLink>
          <TextLink href="#links" size="meta">
            [LINK AT META]
          </TextLink>
          <BackLink href="#links">Cases</BackLink>
          <BackLink href="#links" chevron={false}>
            Cases
          </BackLink>
        </div>
      </Specimen>
    </Section>
  );
}

function TagSection() {
  return (
    <Section id="tags" index="15" name="Tag (never a pill)" mockup="Main (detect tags), RunLive">
      <Specimen label="Literal data in mono; words in sans">
        <div className="flex flex-wrap items-center gap-2">
          <Tag>Detected: [TYPE]</Tag>
          <Tag mono={false}>[SETTING IN WORDS]</Tag>
        </div>
      </Specimen>
      <Specimen label="A caption and its tags">
        <TagList label="Detects automatically:" tags={["[TYPE A]", "[TYPE B]", "[TYPE C]"]} />
      </Specimen>
    </Section>
  );
}

function NavigationSection() {
  const [current, setCurrent] = useState<"search" | "cases">("search");
  return (
    <Section
      id="navigation"
      index="16"
      name="Product mark, side navigation and credits meter"
      mockup="Main, Dashboard-dark"
    >
      <Specimen label="Side navigation: current item, other item, the credits meter outside the landmark">
        <div className="flex h-auto">
          <SideNav
            label="Gallery navigation"
            mark={<ProductMark name="[PRODUCT NAME]" />}
            foot={
              <CreditsMeter
                used={{ value: null, reason: NO_CREDITS }}
                limit={{ value: null, reason: NO_CREDITS }}
              />
            }
          >
            <NavItem
              href="#navigation"
              current={current === "search"}
              icon={<Search className="size-icon" strokeWidth={1.9} />}
              onClick={() => {
                setCurrent("search");
              }}
            >
              Search
            </NavItem>
            <NavItem
              href="#navigation"
              current={current === "cases"}
              icon={<FolderOpen className="size-icon" strokeWidth={1.9} />}
              onClick={() => {
                setCurrent("cases");
              }}
            >
              Cases
            </NavItem>
          </SideNav>
        </div>
      </Specimen>
      <Specimen label="Section rail rows (size rail; Report)">
        <ul className="flex max-w-report-nav flex-col gap-0.5">
          <NavItem href="#navigation" current size="rail">
            [CURRENT SECTION]
          </NavItem>
          <NavItem href="#navigation" current={false} size="rail">
            [OTHER SECTION]
          </NavItem>
        </ul>
      </Specimen>
      <Specimen label="Credits meter, unmeasured (no credit metering exists: em dash and reason, no bar, no meter role). The measured state is not drawn here, because any figure would be invented">
        <div className="max-w-nav">
          <CreditsMeter
            used={{ value: null, reason: NO_CREDITS }}
            limit={{ value: null, reason: NO_CREDITS }}
          />
        </div>
      </Specimen>
    </Section>
  );
}

function ContextHeaderSection() {
  return (
    <Section
      id="context-header"
      index="17"
      name="Case header and run header"
      mockup="Workspace, Timeline (case); RunLive (run)"
    >
      <Specimen label="Case header: Cases link, divider, name, sm actions, the account button" wide>
        <ContextHeader
          kind="case"
          back={<BackLink href="#context-header">Cases</BackLink>}
          title="[CASE NAME]"
          actions={
            <>
              <Button size="sm" variant="secondary">
                [SECONDARY ACTION]
              </Button>
              <Button size="sm">[PRIMARY ACTION]</Button>
            </>
          }
          account={
            <AccountMenu
              initials="[AB]"
              name="[NAME]"
              email="[EMAIL]"
              organisation="[ORGANISATION]"
              theme="light"
              onThemeChange={ignore}
              onSwitchOrganisation={ignore}
              onSignOut={ignore}
            />
          }
        />
      </Specimen>
      <Specimen label="Case header while the name is read" wide>
        <ContextHeader
          kind="case"
          back={<BackLink href="#context-header">Cases</BackLink>}
          title={<Skeleton className="h-4.5 w-mini-progress" />}
        />
      </Specimen>
      <Specimen
        label="Run header: Search link, mono target, detected tag, alternates, run status"
        wide
      >
        <ContextHeader
          kind="run"
          back={<BackLink href="#context-header">Search</BackLink>}
          title="[TARGET]"
          meta={
            <>
              <Tag>Detected: [TYPE]</Tag>
              <span className="text-caption text-ink-muted">[ALTERNATES]</span>
            </>
          }
          actions={<RunStatusChip status="RUNNING" />}
        />
      </Specimen>
    </Section>
  );
}

const D6_TABS = ["Overview", "Entities", "Graph", "Timeline", "Evidence", "Media", "Map", "Report"];

function TabBarSection() {
  const [current, setCurrent] = useState("Overview");
  return (
    <Section id="tabbar" index="18" name="Workspace tab bar" mockup="Workspace and the tab mockups">
      <Specimen
        label="Tabs in the D6 order; the current one is aria-current, strong and underlined"
        wide
      >
        <TabBar label="Gallery tabs">
          {D6_TABS.map((tab) => (
            <TabLink
              key={tab}
              href="#tabbar"
              current={current === tab}
              onClick={(event) => {
                event.preventDefault();
                setCurrent(tab);
              }}
            >
              {tab}
            </TabLink>
          ))}
        </TabBar>
      </Specimen>
    </Section>
  );
}

function CardSection() {
  return (
    <Section
      id="card"
      index="19"
      name="Card, nested card and dashed note"
      mockup="Main, Overview, Entities, RunLive"
    >
      <div className="grid gap-4 xl:grid-cols-2">
        <Specimen label="Card with a section-label header and a standalone link">
          <Card
            title="[CARD TITLE]"
            end={
              <TextLink href="#card" size="meta">
                [ALL]
              </TextLink>
            }
          >
            <p className="text-prose-small text-ink-secondary">[CARD BODY]</p>
          </Card>
        </Specimen>
        <Specimen label="Run card padding, a count chip at the end, nested cards (neutral, INFERRED)">
          <Card
            title="[RUN CARD]"
            padding="run"
            end={<StatusChip status="RAN">[N] ran</StatusChip>}
          >
            <div className="flex flex-col gap-3">
              <NestedCard>[NESTED ITEM]</NestedCard>
              <NestedCard tone="inferred">[INFERRED ITEM]</NestedCard>
            </div>
          </Card>
        </Specimen>
        <Specimen label="Not built inside a card">
          <Card title="[WHAT IT WILL SHOW]">
            <p className="text-prose-small text-ink-secondary">Not built yet. [WHAT IT NEEDS]</p>
          </Card>
        </Specimen>
        <Specimen label="Dashed note, with and without an icon">
          <div className="flex flex-col gap-3">
            <DashedNote icon={<Info className="size-icon-lg" strokeWidth={1.9} />}>
              [A NOTE THAT IS TRUE TODAY.]
            </DashedNote>
            <DashedNote>[A NOTE WITHOUT AN ICON.]</DashedNote>
          </div>
        </Specimen>
      </div>
    </Section>
  );
}

function DensitySection() {
  const [density, setDensity] = useState<Density>("comfortable");
  return (
    <Section id="density" index="20" name="Density toggle" mockup="Entities">
      <Specimen label="Segmented pair, aria-pressed (click to switch)">
        <DensityToggle value={density} onChange={setDensity} />
      </Specimen>
    </Section>
  );
}

function InputSection() {
  const [filter, setFilter] = useState("");
  return (
    <Section
      id="inputs"
      index="21"
      name="Inputs (every edge border-input)"
      mockup="SignIn, MfaEnrol (auth and one-time code); Entities, Evidence (toolbar)"
    >
      <div className="grid gap-4 xl:grid-cols-2">
        <Specimen label="Auth: empty, filled, refused, disabled">
          <div className="flex max-w-form flex-col gap-4">
            <Field variant="auth" label="Work email" placeholder="[PLACEHOLDER]" />
            <Field variant="auth" label="[FILLED]" defaultValue="[VALUE]" />
            <Field
              variant="auth"
              label="[REFUSED]"
              defaultValue="[VALUE]"
              error="[WHY IT IS REFUSED]"
            />
            <Field variant="auth" label="[DISABLED]" disabled />
          </div>
        </Specimen>
        <Specimen label="One-time code, with its hint">
          <div className="flex max-w-form flex-col gap-4">
            <Field variant="otp" label="[CODE LABEL]" hint="[HINT]" />
          </div>
        </Specimen>
        <Specimen label="Workspace toolbar input (control-sm, inside a target-tall label)">
          <ToolbarInput
            label="Filter entities"
            placeholder="[FILTER PLACEHOLDER]"
            value={filter}
            onChange={setFilter}
          />
        </Specimen>
      </div>
    </Section>
  );
}

function HeroSearchSection() {
  const [value, setValue] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);
  return (
    <Section id="hero" index="22" name="Hero search shell (edge border-input, R2)" mockup="Main">
      <Specimen label="Ready (submit waits for a value)" wide>
        <HeroSearch
          label="Target to investigate"
          placeholder="[PLACEHOLDER]"
          value={value}
          onValueChange={setValue}
          onSubmit={() => {
            setSubmitted(value);
          }}
          submitLabel="Investigate"
          submitDisabled={value.trim() === ""}
        />
        <p role="status" className="text-caption text-ink-muted">
          {submitted === null ? "Nothing submitted." : `Submitted: ${submitted}`}
        </p>
      </Specimen>
      <Specimen label="Submitting" wide>
        <HeroSearch
          label="[LABEL WHILE SUBMITTING]"
          placeholder=""
          value="[TARGET]"
          onValueChange={ignore}
          onSubmit={ignore}
          submitLabel="[STARTING]…"
          submitting
        />
      </Specimen>
    </Section>
  );
}

function ExtensionSection() {
  const [pinned, setPinned] = useState(false);
  return (
    <Section
      id="extensions"
      index="23"
      name="Failed alert, pin states, active row and pin column"
      mockup="Evidence, Workspace (§8 Failed has no mockup)"
    >
      <div className="grid gap-4 xl:grid-cols-2">
        <Specimen label="Failed: title, reason, code, retry">
          <FailedAlert
            title="[WHAT FAILED]"
            reason="[WHY, IN PLAIN WORDS]"
            code="[CODE]"
            action={
              <Button size="sm" variant="secondary">
                Try again
              </Button>
            }
          />
        </Specimen>
        <Specimen label="Failed with no code (an unexpected failure: none is invented)">
          <FailedAlert title="[WHAT FAILED, IN PLAIN WORDS]" />
        </Specimen>
        <Specimen label="Pin: state unknown (no aria-pressed), not pinned, pinned">
          <div className="flex items-center gap-3">
            <PinButton pinned={null} label="Pin [ITEM] to a case" />
            <PinButton
              pinned={pinned}
              label="Pin [OTHER ITEM] to case"
              onToggle={() => {
                setPinned(!pinned);
              }}
            />
            <PinButton pinned label="Pin [PINNED ITEM] to case" />
          </div>
        </Specimen>
      </div>
      <Specimen
        label="Data table: the row whose provenance is open (aria-current and weight), a named pin column with the caller's pin per row"
        wide
      >
        <DataTable
          caption="[TABLE]"
          columns={[
            { id: "source", header: "Source", kind: "text" },
            { id: "collected", header: "Collected", kind: "mono-muted" },
          ]}
          rows={[
            { id: "a", cells: { source: "[SOURCE A]", collected: "[COLLECTED AT]" } },
            { id: "b", cells: { source: "[SOURCE B, OPEN]", collected: "[COLLECTED AT]" } },
          ]}
          activeRowId="b"
          empty={{ kind: "empty", title: "[EMPTY]", body: "[EMPTY]" }}
          pins={{
            header: "Pin to a case",
            render: (row) => (
              <PinButton pinned={null} label={`Pin evidence to a case: ${row.id}`} />
            ),
          }}
        />
      </Specimen>
    </Section>
  );
}

/**
 * The U1-b review surface (dev only, never in a production build): every
 * shared component in every state, labelled with the mockup it matches, in
 * light, dark, or both side by side.
 */
export function Gallery() {
  const [mode, setMode] = useState<Mode>(initialTheme);
  useEffect(() => {
    if (mode === "both") document.documentElement.dataset["theme"] = "light";
    else applyTheme(mode);
  }, [mode]);

  return (
    <ModeContext.Provider value={mode}>
      <div className="min-h-screen bg-surface-page text-ink-primary">
        <header className="sticky top-0 z-20 flex flex-wrap items-center gap-4 border-b border-border-default bg-surface-raised px-5.5 py-2">
          <h1 className="text-subtitle text-ink-primary">Component gallery (U1-b, dev only)</h1>
          <fieldset className="ml-auto flex items-center gap-1">
            <legend className="sr-only">Theme</legend>
            {(["light", "dark", "both"] as const).map((choice) => (
              <label
                key={choice}
                className={cn(
                  "flex min-h-target cursor-pointer items-center gap-1.75 rounded-md px-2.5 text-small",
                  mode === choice
                    ? "bg-accent-soft text-small-strong text-accent-ink"
                    : "text-ink-secondary",
                )}
              >
                <input
                  type="radio"
                  name="gallery-theme"
                  checked={mode === choice}
                  onChange={() => {
                    setMode(choice);
                  }}
                  className="accent-accent"
                />
                {choice === "light" ? "Light" : choice === "dark" ? "Dark" : "Both, side by side"}
              </label>
            ))}
          </fieldset>
        </header>
        <div className="flex">
          <nav
            aria-label="Components"
            className="sticky top-16 hidden h-screen w-nav shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border-default bg-surface-raised px-3 py-4 lg:flex"
          >
            {SECTIONS.map(([id, name]) => (
              <a
                key={id}
                href={`#${id}`}
                className="flex min-h-target items-center rounded-md px-2.5 text-small text-ink-secondary hover:bg-surface-hover"
              >
                {name}
              </a>
            ))}
          </nav>
          <main className="flex min-w-0 grow flex-col gap-14 px-10 py-8">
            <p className="max-w-page text-prose-small text-ink-secondary">
              Every value below is a bracketed placeholder: nothing here is a real source, count,
              date or hash (the hash shows only the shape the grid shortens). Overlays (tooltips,
              menus, the live palette) take the page theme even in side-by-side mode.
            </p>
            <HeaderRowSection />
            <PaletteSection />
            <StatusSection />
            <StrengthSection />
            <FilterSection />
            <TableSection />
            <DrawerSection />
            <MetricSection />
            <GraphSection />
            <RailSection />
            <EvidenceSection />
            <MapSection />
            <ReportSection />
            <ButtonSection />
            <LinkSection />
            <TagSection />
            <NavigationSection />
            <ContextHeaderSection />
            <TabBarSection />
            <CardSection />
            <DensitySection />
            <InputSection />
            <HeroSearchSection />
            <ExtensionSection />
          </main>
        </div>
      </div>
    </ModeContext.Provider>
  );
}

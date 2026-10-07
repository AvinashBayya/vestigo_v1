import {
  AccountMenu,
  AddFilterChip,
  AppHeader,
  ArrivingNow,
  CitationMarker,
  Citations,
  CLAIM_STRENGTH_LABELS,
  cn,
  COLLECTOR_STATUSES,
  CollectorList,
  CommandPalette,
  CommandPaletteButton,
  CommandPalettePanel,
  CoverageLimitation,
  DataTable,
  ENTITY_CLASS_LABEL,
  EvidenceCard,
  FilterChip,
  FilterChipRow,
  FilterToggle,
  GraphShell,
  GraphToolbarButton,
  InferredPassage,
  InspectorDrawer,
  MapShell,
  MetricCard,
  NO_OBSERVED_AT,
  ReportProse,
  ReportSurface,
  RUN_STATUSES,
  RunsRail,
  RunStatusChip,
  SelectedPointCard,
  StatusChip,
  StatusDot,
  StrengthBadge,
  StrengthKey,
  TableSearch,
  Unmeasured,
  useCommandPaletteShortcut,
  VETTING_STATUSES,
  VettingPill,
  type DataTableColumn,
  type DataTableRow,
  type MapPoint,
  type ThemeChoice,
} from "@repo/ui";
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
        <ReportSurface title="[SECTION TITLE]">
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
          </main>
        </div>
      </div>
    </ModeContext.Provider>
  );
}

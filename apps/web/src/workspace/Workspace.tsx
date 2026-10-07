import {
  BackLink,
  Button,
  ContextHeader,
  DensityToggle,
  EmptyState,
  Notice,
  NotBuilt,
  RunStatusChip,
  Skeleton,
  TabBar,
  TabLink,
  Tag,
  TextLink,
  Unmeasured,
  type Density,
} from "@repo/ui";
import {
  notifyManager,
  useIsFetching,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  createContext,
  useCallback,
  useContext,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { AccountButton } from "../components/Account.tsx";
import { CommandPaletteHost } from "../components/CommandPaletteHost.tsx";
import { ProblemNotice } from "../components/ProblemNotice.tsx";
import { Instant } from "../components/Values.tsx";
import { sessionQuery } from "../session.ts";
import { EntitiesTab } from "./EntitiesTab.tsx";
import { EvidenceTab } from "./EvidenceTab.tsx";
import { GraphTab } from "./GraphTab.tsx";
import { MapTab } from "./MapTab.tsx";
import { MediaTab } from "./MediaTab.tsx";
import { OverviewTab } from "./OverviewTab.tsx";
import { ProvenanceProvider } from "./Provenance.tsx";
import { caseQuery, runQuery, scopeKeys, type RunRead, type Scope } from "./queries.ts";
import { ReportTab } from "./report/ReportTab.tsx";
import { TimelineTab } from "./TimelineTab.tsx";

/**
 * The workspace tabs, in the D6 order every workspace mockup draws. Media and
 * Map have no endpoint yet: their tabs say so (Not built). A case's Report tab
 * says so too, because reports are per run.
 */
export const WORKSPACE_TABS = [
  "overview",
  "entities",
  "graph",
  "timeline",
  "evidence",
  "media",
  "map",
  "report",
] as const;
/** A run has the same tabs; its Report tab is the run's report (6b-5). */
export const RUN_TABS = WORKSPACE_TABS;
export type WorkspaceTab = (typeof WORKSPACE_TABS)[number];

export const TAB_TEXT: Readonly<Record<WorkspaceTab, string>> = {
  overview: "Overview",
  entities: "Entities",
  graph: "Graph",
  timeline: "Timeline",
  evidence: "Evidence",
  media: "Media",
  map: "Map",
  report: "Report",
};

/** "Overview, Entities, …, Map and Report", for the sentence an unknown tab gets. */
export const TAB_LIST_WORDS = `${WORKSPACE_TABS.slice(0, -1)
  .map((tab) => TAB_TEXT[tab])
  .join(", ")} and ${TAB_TEXT.report}`;

/**
 * The frame's side columns, filled by a tab through a portal: the runs rail at
 * the left of the tab bar (Graph, as Workspace.dc.html draws it) and the docked
 * inspector at the right (Graph and Entities).
 */
interface Slots {
  readonly rail: HTMLElement | null;
  readonly inspector: HTMLElement | null;
}
const SlotsContext = createContext<Slots>({ rail: null, inspector: null });

/**
 * The runs rail column (Workspace.dc.html): left of the tab bar, the body's
 * full height, `runs-rail` wide, `surface-raised` with a `border-default` rule.
 * Hidden below lg, where the run's status stays in the header. Render it from
 * a tab; its children (a RunsRail) are drawn in the frame's rail column.
 */
export function WorkspaceRail({ children }: { readonly children: ReactNode }) {
  const { rail } = useContext(SlotsContext);
  if (rail === null) return null;
  return createPortal(
    <div className="hidden w-runs-rail shrink-0 flex-col gap-4.5 overflow-y-auto border-r border-border-default bg-surface-raised px-3 py-4 lg:flex">
      {children}
    </div>,
    rail,
  );
}

/**
 * The docked inspector column: right of the tab content, the body's full
 * height, `drawer` wide; below lg it stacks under the content at full width.
 * Render it from a tab; its child (the inspector's aside, which draws its own
 * left rule) is drawn in the frame's inspector column.
 */
export function WorkspaceInspector({ children }: { readonly children: ReactNode }) {
  const { inspector } = useContext(SlotsContext);
  if (inspector === null) return null;
  return createPortal(
    <div className="flex w-full shrink-0 flex-col lg:w-drawer">{children}</div>,
    inspector,
  );
}

/**
 * The case workspace (docs/design/mockups/Workspace.dc.html and the tab
 * mockups), over one run's results or one case's pins. Full-bleed: the
 * context header replaces the app header, and its account button keeps the
 * theme, organisation and sign-out reachable. Every tab reads through the
 * generated client; every value opens its provenance; every result can be
 * pinned.
 */
export function Workspace({ scope, tab }: { readonly scope: Scope; readonly tab: WorkspaceTab }) {
  const [density, setDensity] = useState<Density>("compact");
  return (
    <WorkspaceFrame
      scope={scope}
      tab={tab}
      headerExtra={
        tab === "entities" ? (
          <DensityToggle value={density} onChange={setDensity} label="Row density" />
        ) : null
      }
    >
      <TabBody scope={scope} tab={tab} density={density} />
    </WorkspaceFrame>
  );
}

/**
 * A tab the workspace does not have, said plainly inside the frame, with the
 * tabs it does have.
 */
export function UnknownTab({ scope, tab }: { readonly scope: Scope; readonly tab: string }) {
  return (
    <WorkspaceFrame scope={scope} tab={null}>
      <div className="px-10 py-6">
        <EmptyState title="No such tab" className="max-w-page">
          There is no <span className="font-mono text-mono-meta">{tab}</span> tab. The workspace has{" "}
          {TAB_LIST_WORDS}.
        </EmptyState>
      </div>
    </WorkspaceFrame>
  );
}

function WorkspaceFrame({
  scope,
  tab,
  headerExtra,
  children,
}: {
  readonly scope: Scope;
  readonly tab: WorkspaceTab | null;
  readonly headerExtra?: ReactNode;
  readonly children: ReactNode;
}) {
  // The session check the app frame makes: nothing is drawn for a session that is not signed in.
  const { data: session } = useSuspenseQuery(sessionQuery);
  const [rail, setRail] = useState<HTMLElement | null>(null);
  const [inspector, setInspector] = useState<HTMLElement | null>(null);
  if (session.state !== "SIGNED_IN") return null;
  return (
    <ProvenanceProvider>
      <SlotsContext.Provider value={{ rail, inspector }}>
        <div className="flex min-h-screen flex-col bg-surface-page">
          {/* Ctrl/⌘K opens the palette here too; the header has no palette button. */}
          <CommandPaletteHost button={false} />
          {scope.kind === "run" ? (
            <RunHeader scope={scope} extra={headerExtra} />
          ) : (
            <CaseHeader scope={scope} extra={headerExtra} />
          )}
          <div className="flex min-h-0 grow flex-col lg:flex-row">
            <div ref={setRail} className="contents" />
            <div className="flex min-w-0 grow flex-col">
              <WorkspaceTabs scope={scope} tab={tab} />
              <StillCollecting scope={scope} />
              <main className="flex min-w-0 grow flex-col">{children}</main>
            </div>
            <div ref={setInspector} className="contents" />
          </div>
        </div>
      </SlotsContext.Provider>
    </ProvenanceProvider>
  );
}

/**
 * The workspace's tab bar, in D6 order. A run's live view is not a result
 * tab: it is reached from the run header ("Live progress"), so `progress`
 * (the run screen's own use) marks no tab current.
 */
export function WorkspaceTabs({
  scope,
  tab,
}: {
  readonly scope: Scope;
  readonly tab: WorkspaceTab | "progress" | null;
}) {
  return (
    <TabBar label="Workspace">
      {WORKSPACE_TABS.map((value) => (
        <TabLink key={value} asChild current={tab === value}>
          {scope.kind === "run" ? (
            <Link to="/runs/$runId/$tab" params={{ runId: scope.id, tab: value }}>
              {TAB_TEXT[value]}
            </Link>
          ) : (
            <Link to="/cases/$caseId/$tab" params={{ caseId: scope.id, tab: value }}>
              {TAB_TEXT[value]}
            </Link>
          )}
        </TabLink>
      ))}
    </TabBar>
  );
}

function TabBody({
  scope,
  tab,
  density,
}: {
  readonly scope: Scope;
  readonly tab: WorkspaceTab;
  readonly density: Density;
}): ReactNode {
  switch (tab) {
    case "overview":
      return <OverviewTab scope={scope} />;
    case "entities":
      return <EntitiesTab scope={scope} density={density} />;
    case "graph":
      return <GraphTab scope={scope} />;
    case "timeline":
      return <TimelineTab scope={scope} />;
    case "evidence":
      return <EvidenceTab scope={scope} />;
    case "media":
      return <MediaTab />;
    case "map":
      return <MapTab />;
    case "report":
      return scope.kind === "run" ? <ReportTab runId={scope.id} /> : <CaseReportTab />;
  }
}

/**
 * A case's Report tab (D6 draws it in every case mockup): reports are
 * generated from a run, and no case-level report exists yet.
 */
export function CaseReportTab() {
  return (
    <div className="px-10 py-6">
      <NotBuilt
        title="Case report"
        needs="Reports are generated from a run; a case report needs a case-level report endpoint. Open the run a result came from to read or generate its report."
        className="max-w-page"
      />
    </div>
  );
}

/**
 * The oldest time any of the scope's reads was answered, from the query cache
 * (`dataUpdatedAt`): when what is on screen was actually read. Null until a
 * read has succeeded; never the time the screen mounted (CLAUDE.md §1).
 */
export function useReadAt(scope: Scope): number | null {
  const cache = useQueryClient().getQueryCache();
  const subscribe = useCallback(
    (onChange: () => void) => cache.subscribe(notifyManager.batchCalls(onChange)),
    [cache],
  );
  const read = () => {
    let oldest: number | null = null;
    for (const queryKey of scopeKeys(scope)) {
      for (const query of cache.findAll({ queryKey })) {
        const at = query.state.dataUpdatedAt;
        if (query.state.status !== "success" || at === 0) continue;
        if (oldest === null || at < oldest) oldest = at;
      }
    }
    return oldest;
  };
  return useSyncExternalStore(subscribe, read, read);
}

/** When the screen's data was read (§8 Stale), and a refresh that reads it again. */
function Freshness({ scope }: { readonly scope: Scope }) {
  const queryClient = useQueryClient();
  const readAt = useReadAt(scope);
  const fetching = useIsFetching();
  const refresh = () =>
    Promise.all(scopeKeys(scope).map((queryKey) => queryClient.invalidateQueries({ queryKey })));
  return (
    <div className="flex flex-wrap items-center gap-2">
      {readAt === null ? (
        <p role="status" className="text-meta text-ink-muted">
          Reading…
        </p>
      ) : (
        <p className="text-meta text-ink-muted">
          Read at <Instant iso={new Date(readAt).toISOString()} />
        </p>
      )}
      <Button variant="secondary" size="sm" disabled={fetching > 0} onClick={() => void refresh()}>
        Refresh
      </Button>
    </div>
  );
}

/** A run that is not settled says so under the tab bar: what is shown will grow. */
function StillCollecting({ scope }: { readonly scope: Scope }) {
  const run = useQuery({ ...runQuery(scope.id), enabled: scope.kind === "run" });
  const readAt = useReadAt(scope);
  if (scope.kind !== "run" || run.data === undefined || run.data.settled) return null;
  return (
    <div className="px-4 pt-4">
      <Notice>
        This run is still collecting, so these results are not final.{" "}
        {readAt === null ? null : (
          <>
            What is shown is as read at <Instant iso={new Date(readAt).toISOString()} />;{" "}
          </>
        )}
        refresh to read again.
      </Notice>
    </div>
  );
}

/** The run's input, or why there is none: a plan that failed, or no plan yet. */
function RunTitle({ run }: { readonly run: RunRead }) {
  const { plan } = run;
  if (plan !== null && "input" in plan) return <span className="font-mono">{plan.input}</span>;
  return (
    <span className="inline-flex items-center gap-1">
      Run
      <Unmeasured
        reason={
          plan === null
            ? "This run has no plan yet, so its target is not known."
            : `The run's plan could not be made: ${plan.error.message} (${plan.error.code})`
        }
      />
    </span>
  );
}

function RunHeader({ scope, extra }: { readonly scope: Scope; readonly extra: ReactNode }) {
  const run = useQuery(runQuery(scope.id));
  const plan = run.data?.plan;
  return (
    <>
      <ContextHeader
        kind="case"
        back={
          <BackLink asChild>
            <Link to="/">Search</Link>
          </BackLink>
        }
        title={
          run.data === undefined ? (
            run.isError ? (
              "Run"
            ) : (
              <span role="status" className="inline-flex">
                <span className="sr-only">Reading the run</span>
                <Skeleton className="h-target w-form max-w-full" />
              </span>
            )
          ) : (
            <span className="font-mono text-mono-target">
              <RunTitle run={run.data} />
            </span>
          )
        }
        meta={
          run.data === undefined ? null : (
            <>
              <RunStatusChip status={run.data.status} />
              {run.data.status === "FAILED" &&
              plan !== undefined &&
              plan !== null &&
              "error" in plan ? (
                <span className="font-mono text-mono-caption text-ink-muted">
                  {plan.error.code}
                </span>
              ) : null}
            </>
          )
        }
        actions={
          <>
            <TextLink asChild>
              <Link to="/runs/$runId" params={{ runId: scope.id }} activeOptions={{ exact: true }}>
                Live progress
              </Link>
            </TextLink>
            {extra}
            <Freshness scope={scope} />
          </>
        }
        account={<AccountButton />}
      />
      {run.isError ? (
        <div className="px-5 pt-4">
          <ProblemNotice error={run.error} />
        </div>
      ) : null}
    </>
  );
}

function CaseHeader({ scope, extra }: { readonly scope: Scope; readonly extra: ReactNode }) {
  const caseRow = useQuery(caseQuery(scope.id));
  const archivedAt = caseRow.data?.archivedAt ?? null;
  return (
    <>
      <ContextHeader
        kind="case"
        back={
          <BackLink asChild>
            <Link to="/cases">Cases</Link>
          </BackLink>
        }
        title={
          caseRow.data === undefined ? (
            caseRow.isError ? (
              "Case"
            ) : (
              <span role="status" className="inline-flex">
                <span className="sr-only">Reading the case</span>
                <Skeleton className="h-target w-form max-w-full" />
              </span>
            )
          ) : (
            caseRow.data.title
          )
        }
        meta={
          <>
            <Tag mono={false}>Pinned items only</Tag>
            {archivedAt === null ? null : (
              <span className="text-meta text-ink-muted">
                Archived <Instant iso={archivedAt} />: it takes no new pins.
              </span>
            )}
          </>
        }
        actions={
          <>
            {extra}
            <Freshness scope={scope} />
          </>
        }
        account={<AccountButton />}
      />
      {caseRow.isError ? (
        <div className="px-5 pt-4">
          <ProblemNotice error={caseRow.error} />
        </div>
      ) : null}
    </>
  );
}

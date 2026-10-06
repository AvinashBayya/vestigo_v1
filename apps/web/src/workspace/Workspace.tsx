import { Button, cn, Notice, Skeleton, StatusChip } from "@repo/ui";
import { useIsFetching, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { AppShell } from "../components/AppShell.tsx";
import { ProblemNotice } from "../components/ProblemNotice.tsx";
import { Instant } from "../components/Values.tsx";
import { EntitiesTab } from "./EntitiesTab.tsx";
import { EvidenceTab } from "./EvidenceTab.tsx";
import { GraphTab } from "./GraphTab.tsx";
import { OverviewTab } from "./OverviewTab.tsx";
import { ProvenanceProvider } from "./Provenance.tsx";
import { caseQuery, runQuery, scopeKeys, type Scope } from "./queries.ts";
import { TimelineTab } from "./TimelineTab.tsx";

/** The workspace tabs that have endpoints (owner's brief, 6b-4). Media, map and monitors come later. */
export const WORKSPACE_TABS = ["overview", "entities", "evidence", "graph", "timeline"] as const;
export type WorkspaceTab = (typeof WORKSPACE_TABS)[number];

const TAB_TEXT: Readonly<Record<WorkspaceTab, string>> = {
  overview: "Overview",
  entities: "Entities",
  evidence: "Evidence",
  graph: "Graph",
  timeline: "Timeline",
};

const TAB_CLASS = (active: boolean) =>
  cn(
    "inline-flex min-h-target items-center border-b-2 px-3 text-body",
    active
      ? "border-accent text-body-strong text-ink-primary"
      : "border-transparent text-ink-secondary hover:text-ink-primary",
  );

/**
 * The case workspace (docs/design/mockups/Workspace.dc.html), over one run's
 * results or one case's pins. Every tab reads through the generated client;
 * every value opens its provenance; every result can be pinned.
 */
export function Workspace({ scope, tab }: { readonly scope: Scope; readonly tab: WorkspaceTab }) {
  return (
    <AppShell>
      <ProvenanceProvider>
        <div className="flex flex-col gap-6">
          {scope.kind === "run" ? <RunHeading id={scope.id} /> : <CaseHeading id={scope.id} />}
          <WorkspaceTabs scope={scope} tab={tab} />
          <Freshness scope={scope} />
          <TabBody scope={scope} tab={tab} />
        </div>
      </ProvenanceProvider>
    </AppShell>
  );
}

/**
 * The workspace's tab bar. A run also has its live progress, as the first tab;
 * a case has only the result tabs.
 */
export function WorkspaceTabs({
  scope,
  tab,
}: {
  readonly scope: Scope;
  readonly tab: WorkspaceTab | "progress";
}) {
  return (
    <nav aria-label="Workspace" className="flex flex-wrap border-b border-border-default">
      {scope.kind === "run" ? (
        <Link
          to="/runs/$runId"
          params={{ runId: scope.id }}
          aria-current={tab === "progress" ? "page" : undefined}
          className={TAB_CLASS(tab === "progress")}
        >
          Progress
        </Link>
      ) : null}
      {WORKSPACE_TABS.map((value) =>
        scope.kind === "run" ? (
          <Link
            key={value}
            to="/runs/$runId/$tab"
            params={{ runId: scope.id, tab: value }}
            aria-current={tab === value ? "page" : undefined}
            className={TAB_CLASS(tab === value)}
          >
            {TAB_TEXT[value]}
          </Link>
        ) : (
          <Link
            key={value}
            to="/cases/$caseId/$tab"
            params={{ caseId: scope.id, tab: value }}
            aria-current={tab === value ? "page" : undefined}
            className={TAB_CLASS(tab === value)}
          >
            {TAB_TEXT[value]}
          </Link>
        ),
      )}
    </nav>
  );
}

function TabBody({ scope, tab }: { readonly scope: Scope; readonly tab: WorkspaceTab }): ReactNode {
  switch (tab) {
    case "overview":
      return <OverviewTab scope={scope} />;
    case "entities":
      return <EntitiesTab scope={scope} />;
    case "evidence":
      return <EvidenceTab scope={scope} />;
    case "graph":
      return <GraphTab scope={scope} />;
    case "timeline":
      return <TimelineTab scope={scope} />;
  }
}

/**
 * When the screen was read (§8 Stale), and a refresh. A run still collecting
 * says so: what is shown will grow.
 */
function Freshness({ scope }: { readonly scope: Scope }) {
  const queryClient = useQueryClient();
  const [readAt, setReadAt] = useState(() => new Date().toISOString());
  const fetching = useIsFetching();
  const run = useQuery({ ...runQuery(scope.id), enabled: scope.kind === "run" });
  const collecting = scope.kind === "run" && run.data !== undefined && !run.data.settled;

  const refresh = async () => {
    await Promise.all(
      scopeKeys(scope).map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    );
    setReadAt(new Date().toISOString());
  };

  return (
    <div className="flex flex-col gap-2">
      {collecting ? (
        <Notice>
          This run is still collecting, so these results are not final. What is shown is as read at{" "}
          <Instant iso={readAt} />; refresh to read again.
        </Notice>
      ) : null}
      <div className="flex flex-wrap items-center gap-3 text-small text-ink-secondary">
        <span>
          Read at <Instant iso={readAt} />
        </span>
        <Button variant="secondary" disabled={fetching > 0} onClick={() => void refresh()}>
          Refresh
        </Button>
      </div>
    </div>
  );
}

function RunHeading({ id }: { readonly id: string }) {
  const run = useQuery(runQuery(id));
  const plan = run.data?.plan;
  const input = plan !== undefined && plan !== null && "input" in plan ? plan.input : null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="quiet" asChild>
          <Link to="/">Search</Link>
        </Button>
        <h1 className="text-title text-ink-primary">
          Results{" "}
          {input === null ? null : <span className="font-mono text-mono-body">{input}</span>}
        </h1>
        {run.data === undefined ? null : (
          <StatusChip
            className="ml-auto"
            status={
              run.data.status === "SUCCEEDED"
                ? "RAN"
                : run.data.status === "PARTIAL"
                  ? "PARTIAL"
                  : run.data.status
            }
          />
        )}
      </div>
      {run.isError ? <ProblemNotice error={run.error} /> : null}
    </div>
  );
}

function CaseHeading({ id }: { readonly id: string }) {
  const caseRow = useQuery(caseQuery(id));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="quiet" asChild>
          <Link to="/cases">Cases</Link>
        </Button>
        {caseRow.data === undefined ? (
          <Skeleton className="h-target w-1/3" />
        ) : (
          <h1 className="text-title text-ink-primary">{caseRow.data.title}</h1>
        )}
        {caseRow.data?.archivedAt == null ? null : (
          <span className="text-small text-ink-muted">
            Archived <Instant iso={caseRow.data.archivedAt} />: it takes no new pins.
          </span>
        )}
      </div>
      <p className="self-start rounded-md border border-border-strong px-3 py-1 text-small text-ink-primary">
        <span className="text-body-strong">Pinned items only.</span> A case holds what has been
        pinned to it, and what those pins stand on. It is not linked to the runs they came from.
      </p>
      {caseRow.data?.description == null ? null : (
        <p className="text-body text-ink-secondary">{caseRow.data.description}</p>
      )}
      {caseRow.isError ? <ProblemNotice error={caseRow.error} /> : null}
    </div>
  );
}

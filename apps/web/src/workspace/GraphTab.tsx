import {
  Button,
  ENTITY_CLASSES,
  EntityClassName,
  GraphShell,
  GraphToolbarButton,
  Notice,
  Skeleton,
  StrengthBadge,
  type GraphShellState,
} from "@repo/ui";
import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ProblemNotice } from "../components/ProblemNotice.tsx";
import { plural } from "../components/Values.tsx";
import { EntityPanel } from "./EntityPanel.tsx";
import { GraphRail } from "./graph/GraphRail.tsx";
import type { GraphSelection } from "./graph/types.ts";
import { PinButton, usePinState } from "./Pin.tsx";
import {
  ProvenanceInspector,
  ProvenanceLink,
  useProvenance,
  useProvenanceCurrent,
  useProvenanceReset,
} from "./Provenance.tsx";
import { graphQuery, LIST_LIMIT, type Graph, type GraphEdge, type Scope } from "./queries.ts";
import { WorkspaceInspector, WorkspaceRail } from "./Workspace.tsx";

const HOPS = [0, 1, 2, 3] as const;
const NO_NODES: Graph["nodes"] = [];
const NO_EDGES: Graph["edges"] = [];

/** "Hide inferred" hides an edge only when every claim behind it is INFERRED (an edge with none is kept). */
const allInferred = (edge: GraphEdge) =>
  edge.strengths.length > 0 && edge.strengths.every((strength) => strength === "INFERRED");

/**
 * The renderer, and Cytoscape with it, is downloaded only where a graph is
 * drawn: no other tab or route carries it. A failed download is thrown where
 * the graph is drawn, to the router's error component.
 */
const loadRenderer = () => import("./graph/CytoscapeGraph.tsx");
const CytoscapeGraph = lazy(() =>
  loadRenderer().then((module) => ({ default: module.CytoscapeGraph })),
);

/** While the renderer downloads: the canvas's shape, as the shell draws loading (§8), never a spinner. */
function RendererPending() {
  return (
    <div className="flex aspect-video w-full flex-col gap-3 p-4 pt-16" aria-busy="true">
      <p role="status" className="text-caption text-ink-muted">
        Preparing to draw the graph.
      </p>
      <Skeleton className="grow" />
    </div>
  );
}

/**
 * The Graph tab (docs/design/mockups/Workspace.dc.html, centre and right):
 * the graph shell around the Cytoscape canvas, with the hop reach and "Hide
 * inferred" over it, the legend in words, the same graph as a list under it
 * (§7), the runs rail on the left, and the inspector docked on the right:
 * an entity's inspector for a node, a relationship's provenance for an edge.
 */
export function GraphTab({ scope }: { readonly scope: Scope }) {
  const [hops, setHops] = useState<number>(1);
  const [hideInferred, setHideInferred] = useState(false);
  const graph = useQuery(graphQuery(scope, hops));
  useEffect(() => {
    // The renderer downloads alongside the graph's read, not after it. Nothing is
    // lost on a failure here: the lazy import meets it again where the graph is drawn.
    loadRenderer().catch(() => undefined);
  }, []);
  const open = useProvenance();
  const resetProvenance = useProvenanceReset();
  const current = useProvenanceCurrent();
  const pinState = usePinState(scope);
  // The entity open in the inspector; provenance opened from it takes its place until closed.
  const [entityId, setEntityId] = useState<string | null>(null);
  const entityOpener = useRef<HTMLElement | null>(null);
  const openEntity = useCallback(
    (id: string) => {
      const active = document.activeElement;
      entityOpener.current = active instanceof HTMLElement ? active : null;
      resetProvenance();
      setEntityId(id);
    },
    [resetProvenance],
  );
  const closeEntity = () => {
    setEntityId(null);
    const returnTo = entityOpener.current;
    entityOpener.current = null;
    if (returnTo?.isConnected === true) returnTo.focus();
  };

  const nodes = graph.data?.nodes ?? NO_NODES;
  const edges = graph.data?.edges ?? NO_EDGES;
  const shownEdges = useMemo(
    () => (hideInferred ? edges.filter((edge) => !allInferred(edge)) : edges),
    [edges, hideInferred],
  );
  const hidden = edges.length - shownEdges.length;
  const names = useMemo(() => new Map(nodes.map((node) => [node.id, node.displayName])), [nodes]);
  const present = ENTITY_CLASSES.filter((entityClass) =>
    nodes.some((node) => node.kind === entityClass),
  );

  // The canvas shows what the inspector shows: a relationship as its edge, else the entity as its node.
  const currentKind = current?.kind;
  const currentId = current?.id;
  const selected = useMemo<GraphSelection | null>(
    () =>
      currentId !== undefined && currentKind === "relationship"
        ? { kind: "edge", id: currentId }
        : currentId === undefined && entityId !== null
          ? { kind: "node", id: entityId }
          : null,
    [currentKind, currentId, entityId],
  );
  const onSelect = useCallback(
    (selection: GraphSelection) => {
      if (selection.kind === "node") openEntity(selection.id);
      else open({ kind: "relationship", id: selection.id });
    },
    [open, openEntity],
  );

  const edgeWords = (edge: GraphEdge) =>
    `${names.get(edge.sourceEntityId) ?? edge.sourceEntityId} ${edge.kind} ${names.get(edge.targetEntityId) ?? edge.targetEntityId}`;

  const toolbar = (
    <>
      <div role="group" aria-label="Hops" className="flex gap-1.75">
        {HOPS.map((value) => (
          <GraphToolbarButton
            key={value}
            pressed={hops === value}
            onClick={() => {
              setHops(value);
            }}
          >
            {value === 0 ? "Only these" : plural(value, "hop")}
          </GraphToolbarButton>
        ))}
      </div>
      <GraphToolbarButton
        pressed={hideInferred}
        onClick={() => {
          setHideInferred((now) => !now);
        }}
      >
        Hide inferred
      </GraphToolbarButton>
    </>
  );

  let state: GraphShellState;
  if (graph.isPending) state = { kind: "loading", what: "Reading the graph." };
  else if (nodes.length === 0) {
    state = {
      kind: "empty",
      title: "No entities to draw",
      body:
        scope.kind === "run"
          ? "This run recorded no entities, so there is no graph to draw."
          : "Nothing pinned to this case names an entity yet, so there is no graph to draw.",
    };
  } else {
    state = {
      kind: "ready",
      renderer: (
        <Suspense fallback={<RendererPending />}>
          <CytoscapeGraph
            nodes={nodes}
            edges={shownEdges}
            selected={selected}
            onSelect={onSelect}
            className="aspect-video w-full"
          />
        </Suspense>
      ),
    };
  }

  return (
    <>
      <WorkspaceRail>
        <GraphRail scope={scope} />
      </WorkspaceRail>
      <ProvenanceInspector>
        {(dock) => {
          const body =
            dock ??
            (entityId === null ? null : (
              <EntityPanel key={entityId} id={entityId} onClose={closeEntity} />
            ));
          return body === null ? null : <WorkspaceInspector>{body}</WorkspaceInspector>;
        }}
      </ProvenanceInspector>
      <div className="flex flex-col gap-4 px-6 py-4.5">
        {graph.isError ? (
          <ProblemNotice error={graph.error} onRetry={() => void graph.refetch()} />
        ) : (
          <>
            {graph.data?.truncated === true ? (
              <Notice className="flex flex-col gap-1">
                <p className="text-small-strong">
                  Partial: the graph was cut at {String(LIST_LIMIT)} entities.
                </p>
                <p className="text-small">
                  Entities further out, and their relationships, are not drawn. Reach fewer hops to
                  see a complete slice.
                </p>
              </Notice>
            ) : null}
            {hideInferred && graph.data !== undefined ? (
              <Notice className="flex flex-wrap items-center gap-3">
                <p className="text-small">
                  {hidden === 0
                    ? "No relationship is hidden: none rests on INFERRED claims alone."
                    : `${plural(hidden, "relationship")} hidden: every claim behind ${
                        hidden === 1 ? "it" : "them"
                      } is INFERRED.`}
                </p>
                {hidden === 0 ? null : (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setHideInferred(false);
                    }}
                  >
                    Show them
                  </Button>
                )}
              </Notice>
            ) : null}
            <GraphShell
              label="Graph"
              state={state}
              classes={present}
              toolbar={toolbar}
              list={
                state.kind === "ready" ? (
                  <div className="flex flex-col rounded-lg border border-border-default bg-surface-raised p-4.5">
                    <section className="flex flex-col gap-2 border-b border-border-subtle pb-4">
                      <h2 className="text-eyebrow text-ink-muted uppercase">
                        Entities ({String(nodes.length)})
                      </h2>
                      <ul className="flex flex-col">
                        {nodes.map((node) => (
                          <li
                            key={node.id}
                            className="flex min-h-target flex-wrap items-center gap-x-3 border-b border-border-subtle last:border-b-0"
                          >
                            <button
                              type="button"
                              aria-pressed={selected?.kind === "node" && selected.id === node.id}
                              className="min-h-target flex-1 cursor-pointer text-left text-ui break-all text-ink-primary underline decoration-border-strong underline-offset-4 hover:bg-surface-hover"
                              onClick={() => {
                                openEntity(node.id);
                              }}
                            >
                              {node.displayName}
                            </button>
                            <EntityClassName
                              entityClass={node.kind}
                              className="text-caption text-ink-muted"
                            />
                            <span className="text-caption text-ink-muted">
                              {node.hop === 0 ? "in scope" : `${plural(node.hop, "hop")} out`}
                            </span>
                            {node.mergedIntoEntityId === null ? null : (
                              <span className="text-caption text-ink-muted">
                                merged into another entity
                              </span>
                            )}
                            <PinButton
                              target={{ type: "entity", id: node.id }}
                              what={node.displayName}
                              pinned={pinState({ type: "entity", id: node.id })}
                            />
                          </li>
                        ))}
                      </ul>
                    </section>
                    <section className="flex flex-col gap-2 pt-4">
                      <h2 className="text-eyebrow text-ink-muted uppercase">
                        Relationships ({String(shownEdges.length)})
                      </h2>
                      {shownEdges.length === 0 ? (
                        <p className="text-small text-ink-muted">
                          {hidden === 0
                            ? "No relationship joins these entities."
                            : "Every relationship here is hidden: see above."}
                        </p>
                      ) : (
                        <ul className="flex flex-col">
                          {shownEdges.map((edge) => (
                            <li
                              key={edge.id}
                              className="flex min-h-target flex-wrap items-center gap-x-3 border-b border-border-subtle last:border-b-0"
                            >
                              <ProvenanceLink
                                target={{ kind: "relationship", id: edge.id }}
                                label={`Provenance of the relationship: ${edgeWords(edge)}`}
                                className="flex-1 font-mono text-mono-meta break-all text-ink-primary"
                              >
                                {edgeWords(edge)}
                              </ProvenanceLink>
                              {edge.strengths.length === 0 ? (
                                <span className="text-caption text-ink-muted">no claims</span>
                              ) : (
                                <span className="flex flex-wrap items-center gap-1">
                                  <span className="text-caption text-ink-muted">
                                    {plural(edge.claimCount, "claim")}
                                  </span>
                                  {edge.strengths.map((strength) => (
                                    <StrengthBadge key={strength} strength={strength} size="sm" />
                                  ))}
                                </span>
                              )}
                              <PinButton
                                target={{ type: "relationship", id: edge.id }}
                                what={edgeWords(edge)}
                                pinned={pinState({ type: "relationship", id: edge.id })}
                              />
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  </div>
                ) : null
              }
            />
          </>
        )}
      </div>
    </>
  );
}

import { Button, cn, ENTITY_CLASSES, EntityClassName, Notice, Panel } from "@repo/ui";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { Heading, plural } from "../components/Values.tsx";
import { EntityPanel } from "./EntityPanel.tsx";
import { CytoscapeGraph } from "./graph/CytoscapeGraph.tsx";
import type { GraphSelection } from "./graph/types.ts";
import { PinButton } from "./Pin.tsx";
import { ProvenanceLink, useProvenance } from "./Provenance.tsx";
import { graphQuery, LIST_LIMIT, type Graph, type Scope } from "./queries.ts";
import { Loaded, TableSkeleton } from "./states.tsx";

const HOPS = [0, 1, 2, 3] as const;

/** The Graph tab (docs/design/mockups/Workspace.dc.html): entities and relationships, to a hop limit. */
export function GraphTab({ scope }: { readonly scope: Scope }) {
  const [hops, setHops] = useState<number>(1);
  const graph = useQuery(graphQuery(scope, hops));
  return (
    <div className="flex flex-col gap-4">
      <div role="group" aria-label="Hops" className="flex flex-wrap items-center gap-2">
        <span className="text-small text-ink-secondary">
          Reach from the {scope.kind === "run" ? "run's" : "case's"} entities
        </span>
        {HOPS.map((value) => (
          <Button
            key={value}
            variant="secondary"
            aria-pressed={hops === value}
            className={cn(hops === value ? "bg-accent-soft text-accent-ink" : null)}
            onClick={() => {
              setHops(value);
            }}
          >
            {value === 0 ? "Only these" : plural(value, "hop")}
          </Button>
        ))}
      </div>
      <Loaded query={graph} loading={<TableSkeleton label="Reading the graph" rows={3} />}>
        {(data) => <GraphBody key={hops} data={data} scope={scope} />}
      </Loaded>
    </div>
  );
}

function GraphBody({ data, scope }: { readonly data: Graph; readonly scope: Scope }) {
  const [selected, setSelected] = useState<GraphSelection | null>(null);
  const openProvenance = useProvenance();
  const names = useMemo(
    () => new Map(data.nodes.map((node) => [node.id, node.displayName])),
    [data.nodes],
  );
  const present = ENTITY_CLASSES.filter((entityClass) =>
    data.nodes.some((node) => node.kind === entityClass),
  );
  const onSelect = useCallback(
    (selection: GraphSelection) => {
      setSelected(selection);
      if (selection.kind === "edge") openProvenance({ kind: "relationship", id: selection.id });
    },
    [openProvenance],
  );

  if (data.nodes.length === 0) {
    return (
      <Panel className="text-body text-ink-secondary">
        {scope.kind === "run"
          ? "This run recorded no entities, so there is no graph to draw."
          : "Nothing pinned to this case names an entity yet, so there is no graph to draw."}
      </Panel>
    );
  }

  const edgeWords = (edge: Graph["edges"][number]) =>
    `${names.get(edge.sourceEntityId) ?? edge.sourceEntityId} ${edge.kind} ${names.get(edge.targetEntityId) ?? edge.targetEntityId}`;

  return (
    <div className="grid gap-6 lg:grid-cols-12">
      <div className="flex flex-col gap-4 lg:col-span-8">
        {data.truncated ? (
          <Notice className="flex flex-col gap-1">
            <p className="text-body-strong">
              Partial: the graph was cut at {String(LIST_LIMIT)} entities.
            </p>
            <p className="text-small">
              Entities further out, and their relationships, are not drawn. Reach fewer hops to see
              a complete slice.
            </p>
          </Notice>
        ) : null}
        <CytoscapeGraph
          nodes={data.nodes}
          edges={data.edges}
          selected={selected}
          onSelect={onSelect}
        />
        <ul aria-label="Legend" className="flex flex-wrap gap-4 text-small text-ink-secondary">
          {present.map((entityClass) => (
            <li key={entityClass}>
              <EntityClassName entityClass={entityClass} />
            </li>
          ))}
          <li className="text-ink-muted">
            Dashed line: only inferred or hypothetical claims behind it
          </li>
        </ul>
        <Panel className="flex flex-col gap-4">
          <section className="flex flex-col gap-2">
            <Heading>Entities ({String(data.nodes.length)})</Heading>
            <ul className="flex flex-col">
              {data.nodes.map((node) => (
                <li
                  key={node.id}
                  className="flex items-center gap-3 border-b border-border-subtle py-1"
                >
                  <button
                    type="button"
                    aria-pressed={selected?.kind === "node" && selected.id === node.id}
                    className="min-h-target flex-1 cursor-pointer text-left text-body break-all underline decoration-border-strong underline-offset-4 hover:bg-surface-hover"
                    onClick={() => {
                      setSelected({ kind: "node", id: node.id });
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
                  <PinButton target={{ type: "entity", id: node.id }} what={node.displayName} />
                </li>
              ))}
            </ul>
          </section>
          <section className="flex flex-col gap-2">
            <Heading>Relationships ({String(data.edges.length)})</Heading>
            {data.edges.length === 0 ? (
              <p className="text-small text-ink-muted">No relationship joins these entities.</p>
            ) : (
              <ul className="flex flex-col">
                {data.edges.map((edge) => (
                  <li
                    key={edge.id}
                    className="flex items-center gap-3 border-b border-border-subtle py-1"
                  >
                    <ProvenanceLink
                      target={{ kind: "relationship", id: edge.id }}
                      label={`Provenance of the relationship: ${edgeWords(edge)}`}
                      className="flex-1 font-mono text-mono-caption break-all"
                    >
                      {edgeWords(edge)}
                    </ProvenanceLink>
                    <span className="text-caption text-ink-muted">
                      {plural(edge.claimCount, "claim")}
                    </span>
                    <PinButton
                      target={{ type: "relationship", id: edge.id }}
                      what={edgeWords(edge)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </Panel>
      </div>
      <div className="lg:col-span-4">
        {selected?.kind === "node" ? (
          <EntityPanel
            key={selected.id}
            id={selected.id}
            onClose={() => {
              setSelected(null);
            }}
          />
        ) : (
          <Panel className="text-small text-ink-secondary">
            Choose an entity to see what is claimed about it, or a relationship to see what asserts
            it.
          </Panel>
        )}
      </div>
    </div>
  );
}

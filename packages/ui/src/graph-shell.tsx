import type { ReactNode } from "react";
import { cn } from "./cn.ts";
import { EntityClassName, type EntityClass } from "./entity-class.tsx";
import { Skeleton } from "./panel.tsx";
import { EmptyState } from "./states.tsx";

/**
 * A toolbar control over the canvas (§9 graph shell): drawn at `control-sm`,
 * hit area `target-min`. A toggle ("Hide inferred") carries `aria-pressed`.
 */
export function GraphToolbarButton({
  children,
  onClick,
  pressed,
}: {
  readonly children: string;
  readonly onClick: () => void;
  readonly pressed?: boolean | undefined;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "hit-area inline-flex h-control-sm cursor-pointer items-center rounded-md border px-3.25 whitespace-nowrap",
        pressed === true
          ? "border-accent bg-accent-soft text-small-strong text-accent-ink"
          : "border-border-strong bg-surface-raised text-small-strong text-ink-secondary hover:bg-surface-hover",
      )}
    >
      {children}
    </button>
  );
}

/** What the shell shows in place of the canvas. */
export type GraphShellState =
  | { readonly kind: "ready"; readonly renderer: ReactNode }
  | { readonly kind: "loading"; readonly what: string }
  | { readonly kind: "empty"; readonly title: string; readonly body: string };

/**
 * The legend (§9): every entity class present, dot AND word, and the edge
 * key in words. Colour is never the only channel.
 */
export function GraphLegend({
  classes,
  className,
}: {
  readonly classes: readonly EntityClass[];
  readonly className?: string | undefined;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3.5 gap-y-2 rounded-inner border border-border-default bg-surface-raised px-3 py-2.5",
        className,
      )}
    >
      <h3 className="sr-only">Legend</h3>
      <ul className="flex flex-wrap items-center gap-x-3.5 gap-y-2" aria-label="Entity classes">
        {classes.map((entityClass) => (
          <li key={entityClass}>
            <EntityClassName
              entityClass={entityClass}
              className="text-caption text-ink-secondary"
            />
          </li>
        ))}
      </ul>
      <ul className="flex flex-wrap items-center gap-x-3.5 gap-y-2" aria-label="Edges">
        <li className="inline-flex items-center gap-1.75 text-caption text-ink-secondary">
          <span aria-hidden="true" className="w-4 border-t-2 border-claim-hypothesis-mark" />
          Solid: stated or derived
        </li>
        <li className="inline-flex items-center gap-1.75 text-caption text-ink-secondary">
          <span
            aria-hidden="true"
            className="w-4 border-t-2 border-dashed border-claim-hypothesis-mark"
          />
          Dashed: hypothesis
        </li>
        <li className="inline-flex items-center gap-1.75 text-caption text-ink-secondary">
          <span
            aria-hidden="true"
            className="w-4 border-t-2 border-dashed border-claim-inferred-mark"
          />
          Dashed amber: INFERRED
        </li>
      </ul>
    </div>
  );
}

/**
 * The graph shell (§9, Workspace): the canvas on `surface-sunken` filling its
 * area, a toolbar overlay top-left, the legend bottom-left. The renderer
 * (Cytoscape.js, ARCHITECTURE-DECISIONS §8) is passed in, so this package
 * takes no graph dependency; `graphStylesheet` themes it. The equivalent list
 * (§7) is required: the canvas is never the only way to reach the graph.
 */
export function GraphShell({
  label,
  state,
  classes,
  toolbar,
  list,
  className,
}: {
  readonly label: string;
  readonly state: GraphShellState;
  /** The entity classes present, for the legend. */
  readonly classes: readonly EntityClass[];
  readonly toolbar?: ReactNode;
  /** The same graph as a list, reachable and usable by keyboard (§7). */
  readonly list: ReactNode;
  readonly className?: string | undefined;
}) {
  return (
    <section aria-label={label} className={cn("flex min-h-0 flex-col gap-4", className)}>
      <div className="relative flex min-h-0 grow flex-col overflow-hidden bg-surface-sunken">
        {toolbar !== undefined && (
          <div
            role="toolbar"
            aria-label="Graph controls"
            className="absolute top-3.5 left-4 z-10 flex gap-1.75"
          >
            {toolbar}
          </div>
        )}
        {state.kind === "ready" && <div className="flex grow flex-col">{state.renderer}</div>}
        {state.kind === "loading" && (
          <div className="flex grow flex-col gap-3 p-4 pt-16" aria-busy="true">
            <p role="status" className="text-caption text-ink-muted">
              {state.what}
            </p>
            <Skeleton className="grow" />
          </div>
        )}
        {state.kind === "empty" && (
          <div className="flex grow items-center justify-center p-4 pt-16">
            <EmptyState title={state.title} className="max-w-form">
              {state.body}
            </EmptyState>
          </div>
        )}
        {state.kind === "ready" && classes.length > 0 && (
          <GraphLegend classes={classes} className="absolute bottom-3.5 left-4 z-10 max-w-full" />
        )}
      </div>
      {list}
    </section>
  );
}

/** A design token's current value, as the page resolves it. */
export type TokenReader = (name: string) => string;

/** One Cytoscape style rule, typed loosely so this package needs no Cytoscape types. */
export interface GraphStyleRule {
  readonly selector: string;
  readonly style: Readonly<Record<string, string | number>>;
}

/**
 * The graph's theme, from tokens only (§2, §9, §12): nodes in their entity
 * class's fill and ring (`data(fill)`, `data(ring)`), labelled in words;
 * a seed with a doubled ring; the SELECTED node keeps its class colours and
 * gains an `accent` outline outside its ring (D3), never a recolour; a
 * selected edge likewise keeps its colour under an accent underlay. Edges
 * are neutral `claim-hypothesis-mark` (3:1 on the canvas); weak edges
 * (`data(weak)`: every claim inferred or hypothesis) are dashed, and only an
 * all-INFERRED edge (`data(inferred)`) takes `claim-inferred-mark`.
 */
export function graphStylesheet(token: TokenReader): GraphStyleRule[] {
  const px = (name: string) => Number.parseFloat(token(name));
  const line = px("focus-ring-width");
  return [
    {
      selector: "node",
      style: {
        shape: "ellipse",
        width: "label",
        height: "label",
        padding: `${String(px("space-3"))}px`,
        label: "data(label)",
        "text-wrap": "wrap",
        "text-valign": "center",
        "text-halign": "center",
        "font-family": token("font-mono"),
        "font-size": px("type-mono-caption-size"),
        color: token("ink-primary"),
        "background-color": "data(fill)",
        "border-color": "data(ring)",
        "border-width": line,
      },
    },
    { selector: "node[?seed]", style: { "border-width": line * 2 } },
    {
      selector: "node:selected",
      style: {
        "background-color": "data(fill)",
        "border-color": "data(ring)",
        "outline-color": token("accent"),
        "outline-width": px("focus-ring-width"),
        "outline-offset": px("focus-ring-offset"),
      },
    },
    {
      selector: "edge",
      style: {
        width: line,
        "curve-style": "bezier",
        "target-arrow-shape": "triangle",
        "line-color": token("claim-hypothesis-mark"),
        "target-arrow-color": token("claim-hypothesis-mark"),
        label: "data(label)",
        "font-family": token("font-mono"),
        "font-size": px("type-mono-caption-size"),
        color: token("ink-muted"),
        "text-background-color": token("surface-sunken"),
        "text-background-opacity": 1,
      },
    },
    { selector: "edge[?weak]", style: { "line-style": "dashed" } },
    {
      // Amber is INFERRED's colour and no other strength's (§2): only an edge
      // whose every claim is INFERRED takes it.
      selector: "edge[?inferred]",
      style: {
        "line-color": token("claim-inferred-mark"),
        "target-arrow-color": token("claim-inferred-mark"),
        color: token("claim-inferred-ink"),
      },
    },
    {
      // A selected edge keeps its colour (D3, as a node does) and gains an accent underlay.
      selector: "edge:selected",
      style: {
        "underlay-color": token("accent"),
        "underlay-padding": px("focus-ring-offset"),
        "underlay-opacity": 1,
      },
    },
  ];
}

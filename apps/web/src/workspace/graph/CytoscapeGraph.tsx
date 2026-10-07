import { cn, ENTITY_CLASS_LABEL, ENTITY_CLASS_TOKEN, graphStylesheet } from "@repo/ui";
import cytoscape, { type Core, type EventObject, type StylesheetJson } from "cytoscape";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { GraphRendererProps } from "./types.ts";

/**
 * A design token's current value, read where the graph is drawn, so the theme
 * in force there applies (a region may set its own data-theme).
 */
function tokenAt(element: Element, name: string): string {
  return getComputedStyle(element).getPropertyValue(`--ds-${name}`).trim();
}

/** Strength is said by the edge: the weakest kinds (§2: inferred, hypothesis) are dashed, with their word. */
const WEAK = new Set(["INFERRED", "HYPOTHESIS"]);

/** The shared graph theme (packages/ui graphStylesheet), read from the tokens in force at an element. */
const stylesheet = (element: Element): StylesheetJson =>
  graphStylesheet((name) => tokenAt(element, name));

/** The page's theme attribute, watched, so the graph redraws in the theme in force. */
function subscribeTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => {
    observer.disconnect();
  };
}
const readTheme = () => document.documentElement.dataset["theme"] ?? "";

/**
 * Whether the page's fonts have loaded. Labels are measured in the mono face;
 * measured in a fallback, they clip once the real face arrives.
 */
function useFontsReady(): boolean {
  const [ready, setReady] = useState(
    () => !("fonts" in document) || document.fonts.status === "loaded",
  );
  useEffect(() => {
    if (ready || !("fonts" in document)) return;
    let live = true;
    void document.fonts.ready.then(() => {
      if (live) setReady(true);
    });
    return () => {
      live = false;
    };
  }, [ready]);
  return ready;
}

/** Whether this browser can draw on a canvas at all (a test DOM cannot). */
function canDraw(): boolean {
  try {
    return document.createElement("canvas").getContext("2d") !== null;
  } catch {
    return false;
  }
}

/**
 * The graph drawn with Cytoscape.js, behind GraphRendererProps so it can be
 * swapped (ARCHITECTURE-DECISIONS §8). Every node carries its class as text
 * as well as its colour (§6). Where no canvas exists, the list beside it is
 * the whole graph.
 */
export function CytoscapeGraph({
  nodes,
  edges,
  selected,
  onSelect,
  className,
}: GraphRendererProps & {
  /** How the canvas is sized and framed; by default a framed 16:9 panel (the tab as it is today). */
  readonly className?: string | undefined;
}) {
  const container = useRef<HTMLDivElement>(null);
  const cy = useRef<Core | null>(null);
  const drawable = canDraw();
  const theme = useSyncExternalStore(subscribeTheme, readTheme);
  const fontsReady = useFontsReady();

  useEffect(() => {
    const element = container.current;
    if (!drawable || element === null) return;
    const token = (name: string) => tokenAt(element, name);
    const ring = (kind: keyof typeof ENTITY_CLASS_TOKEN) =>
      token(`entity-${ENTITY_CLASS_TOKEN[kind]}-ring`);
    const fill = (kind: keyof typeof ENTITY_CLASS_TOKEN) =>
      token(`entity-${ENTITY_CLASS_TOKEN[kind]}-fill`);
    // Concentric by hop: the seed at the centre and each hop a ring around it,
    // as the Workspace mockup draws the focal entity. Deterministic, so a
    // redraw (theme or fonts) puts every node where it was.
    const maxHop = Math.max(0, ...nodes.map((node) => node.hop));
    const layout = () => ({
      name: "concentric" as const,
      animate: false,
      nodeDimensionsIncludeLabels: true,
      concentric: (node: cytoscape.NodeSingular) => maxHop - Number(node.data("hop")),
      levelWidth: () => 1,
      // Enough to clear the toolbar and legend overlays the shell draws over the canvas.
      padding: Number.parseFloat(token("space-16")),
      spacingFactor: 1.2,
      minNodeSpacing: Number.parseFloat(token("space-10")),
    });
    const instance = cytoscape({
      container: element,
      elements: [
        ...nodes.map((node) => ({
          group: "nodes" as const,
          data: {
            id: node.id,
            kind: node.kind,
            label: `${ENTITY_CLASS_LABEL[node.kind]}\n${node.displayName}`,
            ring: ring(node.kind),
            fill: fill(node.kind),
            seed: node.hop === 0,
            hop: node.hop,
          },
        })),
        ...edges.map((edge) => {
          const weak =
            edge.strengths.length > 0 && edge.strengths.every((strength) => WEAK.has(strength));
          return {
            group: "edges" as const,
            data: {
              id: edge.id,
              source: edge.sourceEntityId,
              target: edge.targetEntityId,
              kind: edge.kind,
              // A weak edge says its strength in words, not by its dashes alone (§9).
              label: weak ? `${edge.kind} · ${edge.strengths.join(" / ")}` : edge.kind,
              weak,
              // Amber is INFERRED's alone: a hypothesis edge stays neutral (§2).
              inferred:
                edge.strengths.length > 0 &&
                edge.strengths.every((strength) => strength === "INFERRED"),
            },
          };
        }),
      ],
      style: stylesheet(element),
      // Nodes are sized to their labels, so the layout must count the labels or
      // nodes land on each other and hide their names (seen in the live check).
      layout: layout(),
      selectionType: "single",
    });
    // The tapped element: Cytoscape types an event's target loosely.
    const tapped = (event: EventObject) => (event.target as cytoscape.SingularElementArgument).id();
    instance.on("tap", "node", (event) => {
      onSelect({ kind: "node", id: tapped(event) });
    });
    instance.on("tap", "edge", (event) => {
      onSelect({ kind: "edge", id: tapped(event) });
    });
    cy.current = instance;

    return () => {
      instance.destroy();
      cy.current = null;
    };
    // The theme and the fonts are dependencies: restyling in place keeps
    // Cytoscape's label measurements from before, and labels clip (seen in
    // the U1-b review), so the graph is drawn afresh instead.
  }, [drawable, nodes, edges, onSelect, theme, fontsReady]);

  useEffect(() => {
    const instance = cy.current;
    if (instance === null) return;
    instance.elements().unselect();
    if (selected !== null) instance.getElementById(selected.id).select();
    // After a rebuild (new data, theme or fonts) the selection is applied again.
  }, [selected, drawable, nodes, edges, onSelect, theme, fontsReady]);

  if (!drawable) {
    return (
      <p className="rounded-lg border border-dashed border-border-strong p-4 text-small text-ink-secondary">
        This browser cannot draw the graph. Every node and relationship is listed beside it.
      </p>
    );
  }
  return (
    <div
      ref={container}
      role="img"
      aria-label={`Graph of ${String(nodes.length)} entities and ${String(edges.length)} relationships. The same graph is listed in words beside it.`}
      className={cn(
        className ?? "aspect-video w-full rounded-lg border border-border-default",
        "bg-surface-sunken",
      )}
    />
  );
}

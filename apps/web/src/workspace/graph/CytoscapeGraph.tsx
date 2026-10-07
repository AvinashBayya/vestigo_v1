import { ENTITY_CLASS_LABEL, ENTITY_CLASS_TOKEN } from "@repo/ui";
import cytoscape, { type Core, type EventObject, type StylesheetJson } from "cytoscape";
import { useEffect, useRef } from "react";
import type { GraphRendererProps } from "./types.ts";

/** A design token's current value, read from the page so the theme in force applies. */
function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(`--ds-${name}`).trim();
}

/** Strength is said by the edge: the weakest kinds (§2: inferred, hypothesis) are dashed. */
const WEAK = new Set(["INFERRED", "HYPOTHESIS"]);

function stylesheet(): StylesheetJson {
  const px = (name: string) => Number.parseFloat(token(name));
  // Rings and lines take the focus ring's width; a seed's ring is twice that.
  const line = px("focus-ring-width");
  return [
    {
      selector: "node",
      style: {
        shape: "round-rectangle",
        width: "label",
        height: "label",
        padding: `${String(px("space-2"))}px`,
        label: "data(label)",
        "text-wrap": "wrap",
        "text-valign": "center",
        "text-halign": "center",
        "font-family": token("font-sans"),
        "font-size": px("type-caption-size"),
        color: token("ink-primary"),
        "background-color": "data(fill)",
        "border-color": "data(ring)",
        "border-width": line,
      },
    },
    // A seed (the run's or case's own entity) keeps its class colour, with a wider ring.
    { selector: "node[?seed]", style: { "border-width": line * 2 } },
    {
      selector: "node:selected",
      style: {
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
        "line-color": token("border-strong"),
        "target-arrow-color": token("border-strong"),
        label: "data(kind)",
        "font-family": token("font-mono"),
        "font-size": px("type-mono-caption-size"),
        color: token("ink-muted"),
        "text-background-color": token("surface-sunken"),
        "text-background-opacity": 1,
      },
    },
    { selector: "edge[?weak]", style: { "line-style": "dashed" } },
    {
      selector: "edge:selected",
      style: { "line-color": token("accent"), "target-arrow-color": token("accent") },
    },
  ];
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
export function CytoscapeGraph({ nodes, edges, selected, onSelect }: GraphRendererProps) {
  const container = useRef<HTMLDivElement>(null);
  const cy = useRef<Core | null>(null);
  const drawable = canDraw();

  useEffect(() => {
    if (!drawable || container.current === null) return;
    const ring = (kind: keyof typeof ENTITY_CLASS_TOKEN) =>
      token(`entity-${ENTITY_CLASS_TOKEN[kind]}-ring`);
    const fill = (kind: keyof typeof ENTITY_CLASS_TOKEN) =>
      token(`entity-${ENTITY_CLASS_TOKEN[kind]}-fill`);
    const instance = cytoscape({
      container: container.current,
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
          },
        })),
        ...edges.map((edge) => ({
          group: "edges" as const,
          data: {
            id: edge.id,
            source: edge.sourceEntityId,
            target: edge.targetEntityId,
            kind: edge.kind,
            weak:
              edge.strengths.length > 0 && edge.strengths.every((strength) => WEAK.has(strength)),
          },
        })),
      ],
      style: stylesheet(),
      // Nodes are sized to their labels, so the layout must count the labels or
      // nodes land on each other and hide their names (seen in the live check).
      layout: {
        name: "cose",
        animate: false,
        randomize: false,
        nodeDimensionsIncludeLabels: true,
        padding: Number.parseFloat(token("space-8")),
        componentSpacing: Number.parseFloat(token("space-10")),
        nodeOverlap: Number.parseFloat(token("space-6")),
        idealEdgeLength: () => Number.parseFloat(token("space-10")) * 3,
        nodeRepulsion: () => 1_000_000,
      },
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

    // The theme switches tokens on data-theme: redraw the colours when it changes.
    const observer = new MutationObserver(() => {
      instance.nodes().forEach((node) => {
        const kind = node.data("kind") as keyof typeof ENTITY_CLASS_TOKEN;
        node.data({ ring: ring(kind), fill: fill(kind) });
      });
      instance.style(stylesheet());
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => {
      observer.disconnect();
      instance.destroy();
      cy.current = null;
    };
  }, [drawable, nodes, edges, onSelect]);

  useEffect(() => {
    const instance = cy.current;
    if (instance === null) return;
    instance.elements().unselect();
    if (selected !== null) instance.getElementById(selected.id).select();
  }, [selected]);

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
      className="aspect-video w-full rounded-lg border border-border-default bg-surface-sunken"
    />
  );
}

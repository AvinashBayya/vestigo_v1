import type { GraphEdge, GraphNode } from "../queries.ts";

/** What is selected in the graph: a node (an entity) or an edge (a relationship). */
export type GraphSelection = { readonly kind: "node" | "edge"; readonly id: string };

/**
 * What any graph renderer takes (ARCHITECTURE-DECISIONS §8: Cytoscape.js
 * behind a swappable component). The renderer draws; the tab owns the data,
 * the selection and the accessible list.
 */
export interface GraphRendererProps {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly selected: GraphSelection | null;
  readonly onSelect: (selection: GraphSelection) => void;
}

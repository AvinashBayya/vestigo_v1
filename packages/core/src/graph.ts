import type { ClaimStrength, EntityKind } from "./vocabulary.ts";

/**
 * The graph read interface (ARCHITECTURE-DECISIONS §5). The Postgres adapter
 * is the only one built; a graph database is deferred behind this same
 * interface. Every call is already tenant-scoped by whoever constructed the
 * store, so nothing here takes a tenant.
 */

/** The deepest a neighbourhood may reach from its seeds. */
export const MAX_GRAPH_HOPS = 3;
/** The most nodes one slice returns; a larger neighbourhood is cut and says so. */
export const MAX_GRAPH_NODES = 500;

export interface GraphNode {
  readonly id: string;
  readonly kind: EntityKind;
  readonly displayName: string;
  /** The entity's normalised identifier, or null when it has none. */
  readonly identifier: string | null;
  /** Distance in relationships from the nearest seed; 0 for a seed. */
  readonly hop: number;
  /** Claims about this entity (measured: zero means none). */
  readonly claimCount: number;
  /**
   * The surviving entity this one is currently merged into, or null when it is
   * not merged. The node and its edges are still returned as stored; folding
   * them onto the survivor is the reader's choice, and an undone merge simply
   * stops appearing here.
   */
  readonly mergedIntoEntityId: string | null;
}

export interface GraphEdge {
  readonly id: string;
  readonly sourceEntityId: string;
  readonly targetEntityId: string;
  readonly kind: string;
  /** Claims about this relationship (measured). */
  readonly claimCount: number;
  /** The distinct strengths of those claims, strongest first. */
  readonly strengths: readonly ClaimStrength[];
}

export interface GraphSlice {
  readonly nodes: readonly GraphNode[];
  /** Only edges whose two ends are both in `nodes`. */
  readonly edges: readonly GraphEdge[];
  /** The hop limit that was applied. */
  readonly maxHops: number;
  /** True when nodes were cut at the node cap: the slice is partial. */
  readonly truncated: boolean;
  /** Seed ids that named no entity in this tenant; absent, never an error. */
  readonly unknownSeedIds: readonly string[];
}

export interface GraphNeighbourhoodQuery {
  readonly seedEntityIds: readonly string[];
  /** 0 returns only the seeds; at most MAX_GRAPH_HOPS. */
  readonly maxHops: number;
  /** At most MAX_GRAPH_NODES. */
  readonly maxNodes: number;
}

export interface GraphStore {
  neighbourhood(query: GraphNeighbourhoodQuery): Promise<GraphSlice>;
}

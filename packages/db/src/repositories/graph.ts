import {
  MAX_GRAPH_HOPS,
  MAX_GRAPH_NODES,
  type ClaimStrength,
  type EntityKind,
  type GraphEdge,
  type GraphNeighbourhoodQuery,
  type GraphNode,
  type GraphSlice,
  type GraphStore,
} from "@repo/core";
import { sql } from "drizzle-orm";
import { claims, entities, entityMerges, entityRelationships } from "../schema/index.ts";
import { requireUuid, TenantRepository } from "./base.ts";
import { sortStrengths } from "./exploration.ts";

interface NodeRow extends Record<string, unknown> {
  id: string;
  kind: EntityKind;
  display_name: string;
  identifier: string | null;
  hop: number;
  claim_count: string;
  merged_into: string | null;
}

interface EdgeRow extends Record<string, unknown> {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  kind: string;
  claim_count: string;
  strengths: string[];
}

/**
 * The Postgres adapter of GraphStore: a recursive query over
 * entity_relationships, treated as undirected for reach. Fine for case-sized
 * graphs; a graph database replaces this behind the same interface when the
 * triggers in ARCHITECTURE-DECISIONS §5 are met.
 */
export class PostgresGraphStore extends TenantRepository implements GraphStore {
  async neighbourhood(query: GraphNeighbourhoodQuery): Promise<GraphSlice> {
    const { maxHops, maxNodes } = query;
    if (!Number.isInteger(maxHops) || maxHops < 0 || maxHops > MAX_GRAPH_HOPS) {
      throw new RangeError(`maxHops must be an integer from 0 to ${String(MAX_GRAPH_HOPS)}`);
    }
    if (!Number.isInteger(maxNodes) || maxNodes < 1 || maxNodes > MAX_GRAPH_NODES) {
      throw new RangeError(`maxNodes must be an integer from 1 to ${String(MAX_GRAPH_NODES)}`);
    }
    const seeds = [...new Set(query.seedEntityIds.map(requireUuid))];
    if (seeds.length === 0) {
      return { nodes: [], edges: [], maxHops, truncated: false, unknownSeedIds: [] };
    }
    if (seeds.length > MAX_GRAPH_NODES) {
      throw new RangeError(`at most ${String(MAX_GRAPH_NODES)} seed entities`);
    }
    const seedList = sql.join(
      seeds.map((id) => sql`${id}::uuid`),
      sql`, `,
    );

    return this.run(async (tx) => {
      const nodeRows = await tx.execute<NodeRow>(sql`
        with recursive reach(entity_id, hop) as (
          select e.id, 0 from ${entities} e
            where e.tenant_id = ${this.tenantId} and e.id in (${seedList})
          union
          select case when r.source_entity_id = reach.entity_id
                      then r.target_entity_id else r.source_entity_id end,
                 reach.hop + 1
          from reach
          join ${entityRelationships} r on r.tenant_id = ${this.tenantId}
            and (r.source_entity_id = reach.entity_id or r.target_entity_id = reach.entity_id)
          where reach.hop < ${maxHops}
        ), nearest as (
          select entity_id, min(hop) as hop from reach group by entity_id
        )
        select e.id, e.kind, e.display_name, e.identifier, n.hop,
          (select count(*) from ${claims} c
             where c.tenant_id = e.tenant_id and c.entity_id = e.id) as claim_count,
          (select m.surviving_entity_id from ${entityMerges} m
             where m.tenant_id = e.tenant_id and m.merged_entity_id = e.id and m.reverted_at is null) as merged_into
        from nearest n
        join ${entities} e on e.tenant_id = ${this.tenantId} and e.id = n.entity_id
        order by n.hop, e.created_at, e.id
        limit ${maxNodes + 1}`);

      const truncated = nodeRows.rows.length > maxNodes;
      const kept = nodeRows.rows.slice(0, maxNodes);
      const nodes: GraphNode[] = kept.map((row) => ({
        id: row.id,
        kind: row.kind,
        displayName: row.display_name,
        identifier: row.identifier,
        hop: row.hop,
        claimCount: Number(row.claim_count),
        mergedIntoEntityId: row.merged_into,
      }));
      const found = new Set(nodes.map((node) => node.id));
      const unknownSeedIds = seeds.filter((id) => !found.has(id));

      let edges: GraphEdge[] = [];
      if (nodes.length > 0) {
        const idList = sql.join(
          nodes.map((node) => sql`${node.id}::uuid`),
          sql`, `,
        );
        const edgeRows = await tx.execute<EdgeRow>(sql`
          select r.id, r.source_entity_id, r.target_entity_id, r.kind,
            (select count(*) from ${claims} c
               where c.tenant_id = r.tenant_id and c.relationship_id = r.id) as claim_count,
            (select coalesce(array_agg(distinct c.strength::text), '{}') from ${claims} c
               where c.tenant_id = r.tenant_id and c.relationship_id = r.id) as strengths
          from ${entityRelationships} r
          where r.tenant_id = ${this.tenantId}
            and r.source_entity_id in (${idList}) and r.target_entity_id in (${idList})
          order by r.created_at, r.id`);
        edges = edgeRows.rows.map((row) => ({
          id: row.id,
          sourceEntityId: row.source_entity_id,
          targetEntityId: row.target_entity_id,
          kind: row.kind,
          claimCount: Number(row.claim_count),
          strengths: sortStrengths(row.strengths) satisfies ClaimStrength[],
        }));
      }
      return { nodes, edges, maxHops, truncated, unknownSeedIds };
    });
  }
}

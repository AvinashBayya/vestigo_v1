import { sql, type SQL } from "drizzle-orm";
import { entityRelationships } from "../schema/index.ts";

/**
 * The one walk the graph store and the person probe share (owner ruling on
 * D-36), so the graph a read shows and the set the probe checks are always
 * the same entities: a reach difference can never let one show what the other
 * refuses.
 *
 * Undirected, to the hop limit. A step from an entity follows every
 * relationship it is at either end of, as two index lookups: one by source,
 * through the unique key (tenant_id, source_entity_id, target_entity_id, kind),
 * and one by target, through entity_relationships_target_idx (migration 0024).
 * Each step reads only the relationships of the entities it steps from, never
 * the whole table. Measured in docs/PLAN.md, D-35 and D-36.
 *
 * `seeds` selects one column of entity ids. The CTE is `reach(entity_id, hop)`;
 * an entity may appear at more than one hop, and its distance is min(hop).
 * The caller validates `maxHops`.
 */
export function reachCte(tenantId: string, seeds: SQL, maxHops: number): SQL {
  return sql`reach(entity_id, hop) as (
    select seed.id, 0 from (${seeds}) as seed(id)
    union
    select step.id, reach.hop + 1
    from reach
    cross join lateral (
      select r.target_entity_id as id from ${entityRelationships} r
        where r.tenant_id = ${tenantId} and r.source_entity_id = reach.entity_id
      union all
      select r.source_entity_id from ${entityRelationships} r
        where r.tenant_id = ${tenantId} and r.target_entity_id = reach.entity_id
    ) as step
    where reach.hop < ${maxHops}
  )`;
}

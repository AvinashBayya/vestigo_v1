/**
 * RELEASE-BLOCKING. Catalog invariants that keep isolation true as the schema
 * grows: every table carries tenant_id, forces row-level security with exactly
 * the one tenant policy, keys every unique constraint and foreign key by
 * tenant, and the roles cannot bypass any of it.
 */
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_DATABASE } from "./config.ts";
import { rawClient } from "./support.ts";

let owner: pg.Client;

beforeAll(async () => {
  owner = await rawClient(TEST_DATABASE.ownerUrl);
});

afterAll(async () => {
  await owner.end();
});

async function rows<T extends pg.QueryResultRow>(sql: string): Promise<T[]> {
  return (await owner.query<T>(sql)).rows;
}

const PUBLIC_TABLES = `
  select c.oid, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p')`;

const CANONICAL_POLICY = "(tenant_id = ( SELECT app.current_tenant_id() AS current_tenant_id))";

describe("schema invariants (RELEASE-BLOCKING)", () => {
  it("every table has a NOT NULL uuid tenant_id", async () => {
    const missing = await rows<{ relname: string }>(`
      with t as (${PUBLIC_TABLES})
      select t.relname from t
      where not exists (
        select 1 from pg_attribute a
        where a.attrelid = t.oid and a.attname = 'tenant_id' and a.attnotnull
          and a.atttypid = 'uuid'::regtype and not a.attisdropped)`);
    expect(missing).toEqual([]);
  });

  it("every table enables and forces row-level security", async () => {
    const weak = await rows<{ relname: string }>(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')
        and not (c.relrowsecurity and c.relforcerowsecurity)`);
    expect(weak).toEqual([]);
  });

  it("every table has exactly one policy: the tenant policy, for all commands, both directions", async () => {
    const policies = await rows<{ tablename: string; n: string; ok: boolean }>(`
      with t as (${PUBLIC_TABLES})
      select t.relname as tablename, count(p.policyname)::text as n,
        coalesce(bool_and(p.policyname = 'tenant_isolation' and p.permissive = 'PERMISSIVE'
          and p.cmd = 'ALL' and p.roles = '{public}'
          and p.qual = '${CANONICAL_POLICY}' and p.with_check = '${CANONICAL_POLICY}'), false) as ok
      from t left join pg_policies p on p.schemaname = 'public' and p.tablename = t.relname
      group by t.relname`);
    for (const policy of policies) {
      expect({ table: policy.tablename, policies: policy.n, canonical: policy.ok }).toEqual({
        table: policy.tablename,
        policies: "1",
        canonical: true,
      });
    }
  });

  it("every unique constraint or index starts with tenant_id, so a conflict cannot reveal another tenant's row", async () => {
    const offenders = await rows<{ index: string }>(`
      with t as (${PUBLIC_TABLES})
      select i.indexrelid::regclass::text as index
      from pg_index i join t on t.oid = i.indrelid
      where i.indisunique
        and (select a.attname from pg_attribute a where a.attrelid = i.indrelid and a.attnum = i.indkey[0]) <> 'tenant_id'`);
    expect(offenders).toEqual([]);
  });

  it("the graph walk's two indexes exist, tenant first (D-33)", async () => {
    // The walk steps from a relationship's target as often as from its source,
    // and counts each returned edge's claims; without these, a three-hop read of
    // a large tenant times out (docs/PLAN.md, D-33).
    const found = await rows<{ index: string; columns: string }>(`
      select i.indexrelid::regclass::text as index,
        string_agg(a.attname, ',' order by k.ordinality) as columns
      from pg_index i
      join lateral unnest(i.indkey) with ordinality as k(attnum, ordinality) on true
      join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
      where i.indexrelid::regclass::text in ('entity_relationships_target_idx', 'claims_relationship_idx')
      group by i.indexrelid order by 1`);
    expect(found).toEqual([
      { index: "claims_relationship_idx", columns: "tenant_id,relationship_id" },
      { index: "entity_relationships_target_idx", columns: "tenant_id,target_entity_id" },
    ]);
  });

  it("every foreign key is composite on tenant_id, so no row can reference another tenant's", async () => {
    const offenders = await rows<{ constraint: string }>(`
      with t as (${PUBLIC_TABLES})
      select c.conname as constraint from pg_constraint c join t on t.oid = c.conrelid
      where c.contype = 'f'
        and not (
          (select attname from pg_attribute where attrelid = c.conrelid and attnum = c.conkey[1]) = 'tenant_id'
          and (select attname from pg_attribute where attrelid = c.confrelid and attnum = c.confkey[1]) = 'tenant_id')`);
    expect(offenders).toEqual([]);
  });

  it("neither role is a superuser or can bypass row-level security", async () => {
    const roles = await rows<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>(`
      select rolname, rolsuper, rolbypassrls from pg_roles
      where rolname in ('app_owner', 'app_runtime') order by rolname`);
    expect(roles).toEqual([
      { rolname: "app_owner", rolsuper: false, rolbypassrls: false },
      { rolname: "app_runtime", rolsuper: false, rolbypassrls: false },
    ]);
  });

  it("the application role owns nothing and is a member of no role", async () => {
    const owned = await rows<{ relname: string }>(`
      select relname from pg_class where relowner = 'app_runtime'::regrole`);
    const memberships = await rows<{ roleid: string }>(`
      select roleid::regrole::text as roleid from pg_auth_members where member = 'app_runtime'::regrole`);
    expect(owned).toEqual([]);
    expect(memberships).toEqual([]);
  });

  it("the application role holds no TRUNCATE, REFERENCES or TRIGGER privilege anywhere", async () => {
    const grants = await rows<{ table_name: string; privilege_type: string }>(`
      select table_name, privilege_type from information_schema.table_privileges
      where grantee = 'app_runtime' and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')`);
    expect(grants).toEqual([]);
  });

  it("append-only tables grant the application role SELECT and INSERT only", async () => {
    const grants = await rows<{ table_name: string; privileges: string }>(`
      select table_name, string_agg(privilege_type, ',' order by privilege_type) as privileges
      from information_schema.role_table_grants
      where grantee = 'app_runtime'
        and table_name in ('audit_log', 'evidence', 'claims', 'entity_relationships', 'usage_events',
                           'case_analyses', 'case_analysis_events')
      group by table_name order by table_name`);
    expect(grants).toEqual(
      [
        "audit_log",
        "case_analyses",
        "case_analysis_events",
        "claims",
        "entity_relationships",
        "evidence",
        "usage_events",
      ].map((table_name) => ({
        table_name,
        privileges: "INSERT,SELECT",
      })),
    );
    const columnUpdates = await rows<{ table_name: string }>(`
      select distinct table_name from information_schema.column_privileges
      where grantee = 'app_runtime' and privilege_type = 'UPDATE'
        and table_name in ('audit_log', 'evidence', 'claims', 'entity_relationships', 'usage_events',
                           'case_analyses', 'case_analysis_events')`);
    expect(columnUpdates).toEqual([]);
  });

  it("no update grant anywhere lets the application role change a tenant_id or an id", async () => {
    const grants = await rows<{ table_name: string; column_name: string }>(`
      select table_name, column_name from information_schema.column_privileges
      where grantee = 'app_runtime' and privilege_type = 'UPDATE'
        and column_name in ('tenant_id', 'id')`);
    expect(grants).toEqual([]);
  });

  it("the application role has no privilege on the evidence partition schema", async () => {
    const result = await rows<{ usage: boolean }>(`
      select has_schema_privilege('app_runtime', 'evidence_partitions', 'USAGE') as usage`);
    expect(result).toEqual([{ usage: false }]);
  });

  it("evidence is range-partitioned on id, with the current month's partition present", async () => {
    const partitioning = await rows<{ strategy: string; key: string }>(`
      select p.partstrat as strategy, a.attname as key
      from pg_partitioned_table p join pg_attribute a on a.attrelid = p.partrelid and a.attnum = p.partattrs[0]
      where p.partrelid = 'public.evidence'::regclass`);
    expect(partitioning).toEqual([{ strategy: "r", key: "id" }]);
    const current = await rows<{ present: boolean }>(`
      select to_regclass('evidence_partitions.evidence_' || to_char(now() at time zone 'UTC', 'YYYY_MM')) is not null as present`);
    expect(current).toEqual([{ present: true }]);
  });

  it("pgvector is enabled", async () => {
    expect(await rows(`select extname from pg_extension where extname = 'vector'`)).toEqual([
      { extname: "vector" },
    ]);
  });

  it("claim strength is a first-class enum with exactly the six labels", async () => {
    const labels = await rows<{ label: string }>(`
      select e.enumlabel as label from pg_enum e
      where e.enumtypid = 'claim_strength'::regtype order by e.enumsortorder`);
    expect(labels.map((row) => row.label)).toEqual([
      "OBSERVED",
      "REPORTED",
      "DERIVED",
      "CORRELATED",
      "INFERRED",
      "HYPOTHESIS",
    ]);
  });
});

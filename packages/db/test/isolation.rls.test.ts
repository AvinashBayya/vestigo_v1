/**
 * RELEASE-BLOCKING. Row-level security on its own, beneath the repositories:
 * raw SQL as the application role, with the repositories' own tenant filters
 * out of the picture. Tables are read from the catalog, not from a list, so a
 * table added later without row-level security, a policy or fixture coverage
 * fails here.
 */
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../src/database.ts";
import { REPOSITORY_TABLES } from "../src/repositories/index.ts";
import { TEST_DATABASE } from "./config.ts";
import {
  asTenant,
  createTenantFixture,
  openDatabase,
  rawClient,
  sqlStateOf,
  type TenantFixture,
} from "./support.ts";

const INSUFFICIENT_PRIVILEGE = "42501";
const TENANT_CONTEXT_MISSING = "TNT01";

let db: Database;
let runtime: pg.Client;
let owner: pg.Client;
let a: TenantFixture;
let b: TenantFixture;
let tables: string[];

beforeAll(async () => {
  db = openDatabase();
  a = await createTenantFixture(db, "a");
  b = await createTenantFixture(db, "b");
  runtime = await rawClient(TEST_DATABASE.runtimeUrl);
  owner = await rawClient(TEST_DATABASE.ownerUrl);
  const result = await owner.query<{ relname: string }>(
    `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p') order by c.relname`,
  );
  tables = result.rows.map((row) => row.relname);
});

afterAll(async () => {
  await runtime.end();
  await owner.end();
  await db.close();
});

const q = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;

async function count(client: pg.Client, sql: string, params: unknown[] = []): Promise<number> {
  const result = await client.query<{ n: string }>(sql, params);
  return Number(result.rows[0]?.n);
}

/** Columns the application role may UPDATE on a table (column-level grants). */
async function updatableColumns(table: string): Promise<string[]> {
  const result = await owner.query<{ column_name: string }>(
    `select column_name from information_schema.column_privileges
     where table_schema = 'public' and table_name = $1 and grantee = 'app_runtime' and privilege_type = 'UPDATE'
     order by column_name`,
    [table],
  );
  return result.rows.map((row) => row.column_name);
}

async function hasTablePrivilege(table: string, privilege: string): Promise<boolean> {
  const result = await owner.query<{ ok: boolean }>(
    "select has_table_privilege('app_runtime', $1, $2) as ok",
    [`public.${table}`, privilege],
  );
  return result.rows[0]?.ok === true;
}

/**
 * Columns of a table the application role may insert (not generated, and
 * covered by a table- or column-level INSERT grant), so a refused insert is
 * refused by row-level security rather than by a missing column grant.
 */
async function insertableColumns(table: string): Promise<string[]> {
  const result = await owner.query<{ attname: string }>(
    `select a.attname from pg_attribute a
     where a.attrelid = $1::regclass and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
       and has_column_privilege('app_runtime', a.attrelid, a.attnum, 'INSERT')
     order by a.attnum`,
    [`public.${table}`],
  );
  return result.rows.map((row) => row.attname);
}

/**
 * The columns an insert probe names: those the application may insert, or,
 * for a table it may only read (tenant_quotas), every column, so the probe is
 * still a real insert and is refused on privilege rather than never sent.
 */
async function probeColumns(table: string): Promise<string[]> {
  const insertable = await insertableColumns(table);
  if (insertable.length > 0) return insertable;
  const result = await owner.query<{ attname: string }>(
    `select a.attname from pg_attribute a
     where a.attrelid = $1::regclass and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
     order by a.attnum`,
    [`public.${table}`],
  );
  return result.rows.map((row) => row.attname);
}

describe("row-level security, raw SQL as the application role (RELEASE-BLOCKING)", () => {
  it("covers every table in the schema, and every table has a repository", () => {
    expect(tables.length).toBeGreaterThan(0);
    expect([...tables].sort()).toEqual(Object.values(REPOSITORY_TABLES).sort());
  });

  it("every table has fixture rows for both tenants, so the checks below are not vacuous", async () => {
    for (const table of tables) {
      for (const tenant of [a, b]) {
        const n = await asTenant(runtime, tenant.tenantId, () =>
          count(runtime, `select count(*) as n from public.${q(table)}`),
        );
        expect(n, `${table} rows for tenant ${tenant.tenantId}`).toBeGreaterThan(0);
      }
    }
  });

  it("SELECT sees only the current tenant's rows", async () => {
    for (const table of tables) {
      const foreign = await asTenant(runtime, a.tenantId, () =>
        count(runtime, `select count(*) as n from public.${q(table)} where tenant_id <> $1`, [
          a.tenantId,
        ]),
      );
      expect(foreign, `${table}: rows of another tenant visible`).toBe(0);
    }
  });

  it("UPDATE of another tenant's rows affects nothing (or is not granted at all)", async () => {
    for (const table of tables) {
      const [column] = await updatableColumns(table);
      await asTenant(runtime, a.tenantId, async () => {
        if (column === undefined) {
          const state = await sqlStateOf(() =>
            runtime.query(`savepoint s; update public.${q(table)} set tenant_id = tenant_id`),
          );
          await runtime.query("rollback to savepoint s");
          expect(state, `${table}: UPDATE should not be granted`).toBe(INSUFFICIENT_PRIVILEGE);
          return;
        }
        const result = await runtime.query(
          `update public.${q(table)} set ${q(column)} = ${q(column)} where tenant_id = $1`,
          [b.tenantId],
        );
        expect(result.rowCount, `${table}: rows of another tenant updated`).toBe(0);
      });
    }
  });

  it("DELETE of another tenant's rows affects nothing (or is not granted at all)", async () => {
    for (const table of tables) {
      const granted = await hasTablePrivilege(table, "DELETE");
      await asTenant(runtime, a.tenantId, async () => {
        await runtime.query("savepoint s");
        try {
          const result = await runtime.query(
            `delete from public.${q(table)} where tenant_id = $1`,
            [b.tenantId],
          );
          expect(granted, `${table}: DELETE succeeded without a grant`).toBe(true);
          expect(result.rowCount, `${table}: rows of another tenant deleted`).toBe(0);
        } catch (error) {
          expect(granted, `${table}: DELETE refused although granted`).toBe(false);
          expect((error as { code?: string }).code).toBe(INSUFFICIENT_PRIVILEGE);
        } finally {
          await runtime.query("rollback to savepoint s");
        }
      });
    }
  });

  it("INSERT of a row carrying another tenant's id is refused by row-level security", async () => {
    for (const table of tables) {
      // Copy one of A's own rows, change only tenant_id to B, and let every
      // defaulted id regenerate. Row-level security must reject it before any
      // unique or foreign-key check could reveal whether B's rows exist.
      const columns = (await probeColumns(table)).filter((column) => column !== "id");
      const select = columns
        .map((column) => (column === "tenant_id" ? "$1::uuid" : q(column)))
        .join(", ");
      const state = await asTenant(runtime, a.tenantId, () =>
        sqlStateOf(() =>
          runtime.query(
            `insert into public.${q(table)} (${columns.map(q).join(", ")})
             select ${select} from public.${q(table)} where tenant_id = $2 limit 1`,
            [b.tenantId, a.tenantId],
          ),
        ),
      );
      expect(state, `${table}: insert with a foreign tenant_id`).toBe(INSUFFICIENT_PRIVILEGE);
    }
  });

  it("an insert reusing an existing tenant's id reports row-level security, not a key conflict", async () => {
    const message = await asTenant(runtime, a.tenantId, async () => {
      try {
        await runtime.query(
          `insert into public.tenants (tenant_id, name, region) values ($1, '[x]', 'IN')`,
          [b.tenantId],
        );
        return "inserted";
      } catch (error) {
        return (error as Error).message;
      }
    });
    expect(message).toContain("row-level security");
  });

  it("with no tenant context, any query that reaches a row fails instead of returning rows", async () => {
    for (const table of tables) {
      await runtime.query("begin");
      try {
        const state = await sqlStateOf(() =>
          runtime.query(`select * from public.${q(table)} limit 1`),
        );
        expect(state, `${table}: query without tenant context`).toBe(TENANT_CONTEXT_MISSING);
      } finally {
        await runtime.query("rollback");
      }
    }
  });

  it("the tenant context is transaction-local and does not leak to the next transaction", async () => {
    await asTenant(runtime, a.tenantId, async () => {
      const inside = await runtime.query<{ v: string }>(
        "select current_setting('app.tenant_id', true) as v",
      );
      expect(inside.rows[0]?.v).toBe(a.tenantId);
    });
    const after = await runtime.query<{ v: string | null }>(
      "select current_setting('app.tenant_id', true) as v",
    );
    expect(after.rows[0]?.v ?? "").toBe("");
  });

  it("evidence partitions cannot be reached directly, bypassing the parent's policy", async () => {
    const partition = await owner.query<{ name: string }>(
      `select c.relname as name from pg_inherits i join pg_class c on c.oid = i.inhrelid
       where i.inhparent = 'public.evidence'::regclass order by 1 limit 1`,
    );
    const name = partition.rows[0]?.name;
    expect(name).toBeDefined();
    const state = await asTenant(runtime, a.tenantId, () =>
      sqlStateOf(() => runtime.query(`select * from evidence_partitions.${q(String(name))}`)),
    );
    expect(state).toBe(INSUFFICIENT_PRIVILEGE);
  });
});

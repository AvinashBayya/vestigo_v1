/**
 * RELEASE-BLOCKING. The application role cannot read the identity provider's
 * auth schema, and what stops it is the database's grants, not the
 * application's habits. The auth tables carry no tenant_id and no row-level
 * security (CLAUDE.md §2's one exception), so the grants are the only thing
 * between app_runtime and every password hash, TOTP secret and session token.
 *
 * Every read here is raw SQL on a plain connection as app_runtime, the role
 * the API and worker connect as, so no application code takes part. The wall
 * has three layers, each checked on its own so the loss of one cannot hide
 * behind another:
 *   1. app_runtime has no USAGE on the auth schema, so nothing in it can be named;
 *   2. no object in auth grants app_runtime, or PUBLIC, anything, down to a single column;
 *   3. there is no indirect way in: no role membership (pg_read_all_data
 *      included), no default privilege for future tables, no view or
 *      definer-rights function that reads auth with its owner's rights, and no
 *      second connection.
 */
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AUTH_TABLE_NAMES } from "../src/schema/auth.ts";
import { TEST_DATABASE } from "./config.ts";
import { asTenant, newTenantId, rawClient, sqlStateOf } from "./support.ts";

const INSUFFICIENT_PRIVILEGE = "42501";
const RUNTIME_ROLE = new URL(TEST_DATABASE.runtimeUrl).username;
const AUTH_ROLE = new URL(TEST_DATABASE.authUrl).username;

type AuthTable = (typeof AUTH_TABLE_NAMES)[number];

/** Placeholder expiry for seeded rows; the value is never read as data. */
const FAR_EXPIRY = "2030-01-01T00:00:00Z";

let owner: pg.Client;
let runtime: pg.Client;
let identity: pg.Client;
const tenantId = newTenantId();
const tag = randomUUID();

/** The id of the one row seeded into each auth table, so no refusal is vacuous. */
const seeded: Record<AuthTable, string> = {
  account: randomUUID(),
  invitation: randomUUID(),
  member: randomUUID(),
  organization: randomUUID(),
  rate_limit: randomUUID(),
  session: randomUUID(),
  two_factor: randomUUID(),
  user: randomUUID(),
  verification: randomUUID(),
};

/** Writes one row to every auth table as the identity role. Placeholder values only. */
async function seedIdentityRows(client: pg.Client): Promise<void> {
  await client.query(
    `insert into auth."user" (id, name, email) values ($1, '[Separation user]', $2)`,
    [seeded.user, `separation-${tag}@example.com`],
  );
  await client.query(
    `insert into auth.organization (id, name, slug) values ($1, '[Separation org]', $2)`,
    [seeded.organization, `separation-${tag}`],
  );
  await client.query(
    `insert into auth.account (id, account_id, provider_id, user_id, password)
     values ($1, $2, 'credential', $3, '[password hash]')`,
    [seeded.account, `[account ${tag}]`, seeded.user],
  );
  await client.query(
    `insert into auth.session (id, token, user_id, expires_at, active_organization_id)
     values ($1, $2, $3, $4, $5)`,
    [seeded.session, `[token ${tag}]`, seeded.user, FAR_EXPIRY, seeded.organization],
  );
  await client.query(
    `insert into auth.two_factor (id, secret, backup_codes, user_id)
     values ($1, '[totp secret]', '[backup codes]', $2)`,
    [seeded.two_factor, seeded.user],
  );
  await client.query(
    `insert into auth.member (id, organization_id, user_id, role) values ($1, $2, $3, 'viewer')`,
    [seeded.member, seeded.organization, seeded.user],
  );
  await client.query(
    `insert into auth.invitation (id, organization_id, email, role, expires_at, inviter_id)
     values ($1, $2, $3, 'viewer', $4, $5)`,
    [seeded.invitation, seeded.organization, `invitee-${tag}@example.com`, FAR_EXPIRY, seeded.user],
  );
  await client.query(
    `insert into auth.verification (id, identifier, value, expires_at)
     values ($1, $2, '[verification value]', $3)`,
    [seeded.verification, `[identifier ${tag}]`, FAR_EXPIRY],
  );
  await client.query(
    `insert into auth.rate_limit (id, key, count, last_request) values ($1, $2, 1, $3)`,
    [seeded.rate_limit, `[rate limit ${tag}]`, Date.parse(FAR_EXPIRY)],
  );
}

/**
 * A real tenant, created with the application role's own column grant. Raw SQL
 * rather than the Database handle, whose role check would refuse to start
 * before this suite's assertions could say why.
 */
async function provisionTenant(client: pg.Client): Promise<void> {
  await client.query("begin");
  try {
    await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    await client.query(
      `insert into public.tenants (tenant_id, name, region)
       values ($1, '[Tenant auth separation]', 'IN')`,
      [tenantId],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

beforeAll(async () => {
  owner = await rawClient(TEST_DATABASE.ownerUrl);
  runtime = await rawClient(TEST_DATABASE.runtimeUrl);
  identity = await rawClient(TEST_DATABASE.authUrl);
  await provisionTenant(runtime);
  await seedIdentityRows(identity);
});

afterAll(async () => {
  // Deleting the user and the organisation cascades to every row that refers to them.
  await identity.query(`delete from auth."user" where id = $1`, [seeded.user]);
  await identity.query(`delete from auth.organization where id = $1`, [seeded.organization]);
  await identity.query(`delete from auth.verification where id = $1`, [seeded.verification]);
  await identity.query(`delete from auth.rate_limit where id = $1`, [seeded.rate_limit]);
  await identity.end();
  await runtime.end();
  await owner.end();
});

async function rows<T extends pg.QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return (await owner.query<T>(sql, params)).rows;
}

async function columnsOf(table: AuthTable): Promise<string[]> {
  const result = await rows<{ attname: string }>(
    `select a.attname from pg_attribute a
     where a.attrelid = format('auth.%I', $1::text)::regclass and a.attnum > 0 and not a.attisdropped
     order by a.attnum`,
    [table],
  );
  return result.map((row) => row.attname);
}

/**
 * Every privilege the given roles hold on anything in the auth schema: each
 * relation, each column, each sequence and each function. The has_*_privilege
 * functions report effective privilege, so grants to PUBLIC and to any role
 * the grantee belongs to are counted too.
 */
async function privilegesInAuth(grantees: readonly string[]): Promise<string[]> {
  const result = await rows<{ privilege: string }>(
    `with grantee(name) as (select unnest($1::text[])),
          rel as (select oid, relname::text as name, relkind from pg_class
                  where relnamespace = 'auth'::regnamespace
                    and relkind in ('r', 'p', 'v', 'm', 'f', 'S'))
     select g.name || ': ' || p.kind || ' on ' || rel.name as privilege
       from grantee g, rel,
            unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p(kind)
      where case when rel.relkind = 'S' then false
                 else has_table_privilege(g.name, rel.oid, p.kind) end
     union all
     select g.name || ': ' || p.kind || ' on sequence ' || rel.name
       from grantee g, rel, unnest(array['USAGE', 'SELECT', 'UPDATE']) p(kind)
      where case when rel.relkind = 'S' then has_sequence_privilege(g.name, rel.oid, p.kind)
                 else false end
     union all
     select g.name || ': ' || p.kind || ' on column ' || rel.name || '.' || a.attname
       from grantee g, rel
            join pg_attribute a on a.attrelid = rel.oid and a.attnum > 0 and not a.attisdropped,
            unnest(array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) p(kind)
      where case when rel.relkind = 'S' then false
                 else has_column_privilege(g.name, rel.oid, a.attnum, p.kind) end
     union all
     select g.name || ': EXECUTE on function ' || f.oid::regprocedure::text
       from grantee g, pg_proc f
      where f.pronamespace = 'auth'::regnamespace and has_function_privilege(g.name, f.oid, 'EXECUTE')
     order by 1`,
    [grantees],
  );
  return result.map((row) => row.privilege);
}

describe("the application role cannot read the auth schema (RELEASE-BLOCKING)", () => {
  it.each([...AUTH_TABLE_NAMES])(
    "auth.%s: the identity role reads its row; the application role is refused the table and every column, with or without a tenant",
    async (table) => {
      const everything = `select * from auth."${table}" limit 1`;
      // The control: the row exists, and the identical statement succeeds for the identity role.
      const own = await identity.query(`select id from auth."${table}" where id = $1`, [
        seeded[table],
      ]);
      expect(own.rows).toEqual([{ id: seeded[table] }]);
      expect(await sqlStateOf(() => identity.query(everything))).toBeNull();

      expect(await sqlStateOf(() => runtime.query(everything))).toBe(INSUFFICIENT_PRIVILEGE);
      // Auth tables have no row-level security, so a tenant context changes nothing: the grants decide.
      expect(
        await asTenant(runtime, tenantId, () => sqlStateOf(() => runtime.query(everything))),
      ).toBe(INSUFFICIENT_PRIVILEGE);

      // A column-level grant would open that one column while `select *` stays refused.
      const columns = await columnsOf(table);
      expect(columns).toContain("id");
      const outcomes: { column: string; state: string | null }[] = [];
      for (const column of columns) {
        const state = await sqlStateOf(() =>
          runtime.query(`select "${column}" from auth."${table}" limit 1`),
        );
        outcomes.push({ column, state });
      }
      expect(outcomes).toEqual(
        columns.map((column) => ({ column, state: INSUFFICIENT_PRIVILEGE })),
      );
    },
  );

  it("the application role cannot write the auth schema either: insert, update, delete and truncate are refused on every table", async () => {
    const outcomes: { statement: string; state: string | null }[] = [];
    for (const table of AUTH_TABLE_NAMES) {
      for (const statement of [
        `insert into auth."${table}" (id) values (gen_random_uuid())`,
        `update auth."${table}" set id = id`,
        `delete from auth."${table}"`,
        `truncate auth."${table}"`,
      ]) {
        outcomes.push({ statement, state: await sqlStateOf(() => runtime.query(statement)) });
      }
    }
    expect(outcomes).toEqual(
      outcomes.map(({ statement }) => ({ statement, state: INSUFFICIENT_PRIVILEGE })),
    );
    expect(outcomes).toHaveLength(AUTH_TABLE_NAMES.length * 4);
  });
});

describe("the separation is enforced by grants, layer by layer (RELEASE-BLOCKING)", () => {
  it("app_runtime is not a superuser and belongs to no role, so it holds only what is granted to it or PUBLIC", async () => {
    // A superuser ignores grants altogether; membership of app_auth, app_owner
    // or a predefined role such as pg_read_all_data would carry their reach.
    expect(await rows(`select rolsuper from pg_roles where rolname = $1`, [RUNTIME_ROLE])).toEqual([
      { rolsuper: false },
    ]);
    expect(
      await rows(
        `select rolname from pg_roles
         where rolname <> $1 and pg_has_role($1, oid, 'MEMBER') order by 1`,
        [RUNTIME_ROLE],
      ),
    ).toEqual([]);
  });

  it("layer 1: neither app_runtime nor PUBLIC has USAGE or CREATE on the auth schema", async () => {
    const held = await rows(
      `select g.name as grantee, p.kind as privilege
       from unnest($1::text[]) g(name), unnest(array['USAGE', 'CREATE']) p(kind)
       where has_schema_privilege(g.name, 'auth', p.kind)`,
      [[RUNTIME_ROLE, "public"]],
    );
    expect(held).toEqual([]);
    // The control: the same check sees the identity role's access.
    expect(
      await rows(`select has_schema_privilege($1, 'auth', 'USAGE') as usage`, [AUTH_ROLE]),
    ).toEqual([{ usage: true }]);
  });

  it("layer 2: no table, column, sequence or function in auth grants app_runtime or PUBLIC anything", async () => {
    expect(await privilegesInAuth([RUNTIME_ROLE, "public"])).toEqual([]);
    // The control: the same query finds the identity role's grant on every table.
    expect(await privilegesInAuth([AUTH_ROLE])).toEqual(
      expect.arrayContaining(AUTH_TABLE_NAMES.map((table) => `${AUTH_ROLE}: SELECT on ${table}`)),
    );
  });

  it("layer 3: no default privilege would hand a future auth table, sequence or function to app_runtime or PUBLIC", async () => {
    const defaults = await rows(
      `select pg_get_userbyid(d.defaclrole) as creator,
              coalesce(n.nspname, '(every schema)') as schema,
              d.defaclobjtype as kind,
              case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee,
              a.privilege_type
       from pg_default_acl d
       left join pg_namespace n on n.oid = d.defaclnamespace
       cross join lateral aclexplode(d.defaclacl) a
       where (d.defaclnamespace = 0 or n.nspname = 'auth')
         and d.defaclobjtype in ('r', 'S', 'f')
         and has_schema_privilege(d.defaclrole, 'auth', 'CREATE')
         and (a.grantee = 0 or a.grantee = $1::regrole)`,
      [RUNTIME_ROLE],
    );
    expect(defaults).toEqual([]);
  });

  it("layer 3: no view or materialized view outside auth reads an auth table, since it would read with its owner's rights", async () => {
    const views = await rows(
      `select distinct v.oid::regclass::text as view, t.oid::regclass::text as reads
       from pg_rewrite r
       join pg_class v on v.oid = r.ev_class
       join pg_depend d on d.classid = 'pg_rewrite'::regclass and d.objid = r.oid
                       and d.refclassid = 'pg_class'::regclass
       join pg_class t on t.oid = d.refobjid
       where t.relnamespace = 'auth'::regnamespace and v.relnamespace <> 'auth'::regnamespace`,
    );
    expect(views).toEqual([]);
  });

  it("layer 3: no definer-rights function runs with the rights of a role that can read auth", async () => {
    // Trigger functions run without an EXECUTE check on the caller, so this
    // covers every such function, not only those app_runtime can call.
    const functions = await rows(
      `select f.oid::regprocedure::text as function, pg_get_userbyid(f.proowner) as runs_as
       from pg_proc f join pg_namespace n on n.oid = f.pronamespace
       where f.prosecdef and n.nspname not in ('pg_catalog', 'information_schema')
         and has_schema_privilege(f.proowner, 'auth', 'USAGE')`,
    );
    expect(functions).toEqual([]);
  });

  it("layer 3: no extension, foreign server or wrapper lets app_runtime open a second connection as another role", async () => {
    const routes = await rows(
      `select 'extension ' || extname as route from pg_extension
         where extname in ('dblink', 'postgres_fdw')
       union all
       select 'server ' || srvname from pg_foreign_server
         where has_server_privilege($1, oid, 'USAGE')
       union all
       select 'wrapper ' || fdwname from pg_foreign_data_wrapper
         where has_foreign_data_wrapper_privilege($1, oid, 'USAGE')`,
      [RUNTIME_ROLE],
    );
    expect(routes).toEqual([]);
  });
});

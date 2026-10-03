/**
 * RELEASE-BLOCKING. The identity exemption stays exactly as narrow as
 * CLAUDE.md §2 allows, the three database roles stay disjoint, and a tenant
 * can never grant itself a plan or approve its own vetting. That the
 * application role cannot reach the auth schema is proved separately, layer by
 * layer, in isolation.auth-schema.test.ts.
 */
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuthStore, UnsafeAuthRoleError } from "../src/auth-store.ts";
import type { Database } from "../src/database.ts";
import { AUTH_TABLE_NAMES } from "../src/schema/auth.ts";
import { TEST_DATABASE } from "./config.ts";
import {
  asTenant,
  createTenantFixture,
  newTenantId,
  openDatabase,
  rawClient,
  sqlStateOf,
  type TenantFixture,
} from "./support.ts";

const INSUFFICIENT_PRIVILEGE = "42501";

let db: Database;
let owner: pg.Client;
let runtime: pg.Client;
let tenant: TenantFixture;

beforeAll(async () => {
  db = openDatabase();
  tenant = await createTenantFixture(db, "identity");
  owner = await rawClient(TEST_DATABASE.ownerUrl);
  runtime = await rawClient(TEST_DATABASE.runtimeUrl);
});

afterAll(async () => {
  await owner.end();
  await runtime.end();
  await db.close();
});

async function rows<T extends pg.QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return (await owner.query<T>(sql, params)).rows;
}

describe("the tenant_id exemption is exactly the identity tables (RELEASE-BLOCKING)", () => {
  it("every table in every schema carries tenant_id, except the listed identity tables and the migration journal", async () => {
    const withoutTenant = await rows<{ table: string }>(`
      select n.nspname || '.' || c.relname as table
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p')
        and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg_toast%'
        and not exists (
          select 1 from pg_attribute a
          where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped)
      order by 1`);
    expect(withoutTenant.map((row) => row.table)).toEqual(
      ["drizzle.__drizzle_migrations", ...AUTH_TABLE_NAMES.map((name) => `auth.${name}`)].sort(),
    );
  });

  it("the auth schema holds exactly the listed tables", async () => {
    const tables = await rows<{ relname: string }>(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'auth' and c.relkind in ('r', 'p') order by 1`);
    expect(tables.map((row) => row.relname)).toEqual([...AUTH_TABLE_NAMES].sort());
  });
});

describe("the three database roles have disjoint reach (RELEASE-BLOCKING)", () => {
  it("app_auth is not a superuser, cannot bypass RLS, owns nothing and is a member of no role", async () => {
    expect(
      await rows(`select rolsuper, rolbypassrls from pg_roles where rolname = 'app_auth'`),
    ).toEqual([{ rolsuper: false, rolbypassrls: false }]);
    expect(await rows(`select relname from pg_class where relowner = 'app_auth'::regrole`)).toEqual(
      [],
    );
    expect(
      await rows(`select roleid from pg_auth_members where member = 'app_auth'::regrole`),
    ).toEqual([]);
  });

  it("app_auth has no privilege on any tenant table, partition or tenant function", async () => {
    const reachable = await rows<{ table: string }>(`
      select n.nspname || '.' || c.relname as table
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('public', 'evidence_partitions') and c.relkind in ('r', 'p')
        and (has_table_privilege('app_auth', c.oid, 'SELECT')
          or has_table_privilege('app_auth', c.oid, 'INSERT')
          or has_table_privilege('app_auth', c.oid, 'UPDATE')
          or has_table_privilege('app_auth', c.oid, 'DELETE'))`);
    expect(reachable).toEqual([]);
    expect(await rows(`select has_schema_privilege('app_auth', 'app', 'USAGE') as usage`)).toEqual([
      { usage: false },
    ]);
  });

  // The other direction, app_runtime's lack of any reach into auth, is
  // isolation.auth-schema.test.ts.

  it("the identity store accepts app_auth", async () => {
    const store = createAuthStore({
      connectionString: TEST_DATABASE.authUrl,
      onConnectionError: () => undefined,
    });
    try {
      await expect(store.verifyRole()).resolves.toBeUndefined();
    } finally {
      await store.close();
    }
  });

  it.each([
    ["the application role, which can reach tenant data", TEST_DATABASE.runtimeUrl],
    ["a superuser", TEST_DATABASE.superuserUrl],
  ])("the identity store refuses %s", async (_label, url) => {
    const store = createAuthStore({ connectionString: url, onConnectionError: () => undefined });
    try {
      await expect(store.verifyRole()).rejects.toBeInstanceOf(UnsafeAuthRoleError);
    } finally {
      await store.close();
    }
  });
});

describe("plan and vetting are never writable by the application (RELEASE-BLOCKING)", () => {
  it("a new tenant starts on the default plan with vetting not submitted", async () => {
    const created = await db.provisionTenant({ name: "[Defaults tenant]", region: "IN" });
    expect(created.plan).toBe("TECHINT");
    expect(created.vettingStatus).toBe("NOT_SUBMITTED");
  });

  it.each([
    ["an approved vetting status", "vetting_status", "APPROVED"],
    ["a person-investigation plan", "plan", "TECHINT_AND_PERSON"],
  ])("the application role cannot insert a tenant with %s", async (_label, column, value) => {
    const tenantId = newTenantId();
    const state = await asTenant(runtime, tenantId, () =>
      sqlStateOf(() =>
        runtime.query(
          `insert into public.tenants (tenant_id, name, region, ${column}) values ($1, '[x]', 'IN', $2)`,
          [tenantId, value],
        ),
      ),
    );
    expect(state).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it.each([
    ["approve its own vetting", "vetting_status = 'APPROVED'"],
    ["upgrade its own plan", "plan = 'TECHINT_AND_PERSON'"],
  ])("the application role cannot %s", async (_label, assignment) => {
    const state = await asTenant(runtime, tenant.tenantId, () =>
      sqlStateOf(() => runtime.query(`update public.tenants set ${assignment}`)),
    );
    expect(state).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it("an operator change is audited with the before and after values, whoever makes it", async () => {
    await owner.query("begin");
    try {
      await owner.query("select set_config('app.tenant_id', $1, true)", [tenant.tenantId]);
      await owner.query(
        `update public.tenants set plan = 'TECHINT_AND_PERSON', vetting_status = 'PENDING'`,
      );
      const audit = await owner.query<{ action: string; actor_kind: string; details: unknown }>(
        `select action, actor_kind, details from public.audit_log
         where action = 'tenant.entitlement_change' order by recorded_at desc limit 1`,
      );
      expect(audit.rows).toEqual([
        {
          action: "tenant.entitlement_change",
          actor_kind: "SYSTEM",
          details: {
            plan: { from: "TECHINT", to: "TECHINT_AND_PERSON" },
            vetting_status: { from: "NOT_SUBMITTED", to: "PENDING" },
            database_role: "app_owner",
          },
        },
      ]);
    } finally {
      await owner.query("rollback");
    }
  });
});

describe("API keys and member profiles", () => {
  it("a key is usable until revoked or expired, judged by the database clock", async () => {
    await db.withTenant(tenant.tenantId, async ({ repos }) => {
      const make = (name: string) =>
        repos.apiKeys.create({
          id: randomUUID(),
          name,
          keyPrefix: `ak_${randomUUID().slice(0, 8)}`,
          keyHash: "a".repeat(64),
          createdByUserId: null,
          expiresAt: null,
          permissions: ["investigation:read"],
          rotatedFromId: null,
        });
      const live = await make("[live]");
      const revoked = await make("[revoked]");
      const expired = await make("[expired]");
      await repos.apiKeys.revoke(revoked.id);
      await repos.apiKeys.expireBy(expired.id, new Date(Date.parse("2000-01-01T00:00:00Z")));

      expect((await repos.apiKeys.findUsable(live.id))?.permissions).toEqual([
        "investigation:read",
      ]);
      expect(await repos.apiKeys.findUsable(revoked.id)).toBeNull();
      expect(await repos.apiKeys.findUsable(expired.id)).toBeNull();
    });
  });

  it("expireBy only ever brings an expiry forward", async () => {
    await db.withTenant(tenant.tenantId, async ({ repos }) => {
      const soon = new Date(Date.parse("2030-01-01T00:00:00Z"));
      const key = await repos.apiKeys.create({
        id: randomUUID(),
        name: "[expiring]",
        keyPrefix: `ak_${randomUUID().slice(0, 8)}`,
        keyHash: "b".repeat(64),
        createdByUserId: null,
        expiresAt: soon,
        permissions: [],
        rotatedFromId: null,
      });
      const later = await repos.apiKeys.expireBy(
        key.id,
        new Date(Date.parse("2040-01-01T00:00:00Z")),
      );
      expect(later?.expiresAt?.toISOString()).toBe(soon.toISOString());
    });
  });

  it("a key's scope must be well-formed permission names", async () => {
    await expect(
      db.withTenant(tenant.tenantId, ({ repos }) =>
        repos.apiKeys.create({
          id: randomUUID(),
          name: "[bad scope]",
          keyPrefix: `ak_${randomUUID().slice(0, 8)}`,
          keyHash: "c".repeat(64),
          createdByUserId: null,
          expiresAt: null,
          permissions: ["ALL" as never],
          rotatedFromId: null,
        }),
      ),
    ).rejects.toMatchObject({ code: "CONSTRAINT_VIOLATION" });
  });

  it("ensureMember creates a profile with the identity's id, idempotently, and reactivates one", async () => {
    const identity = randomUUID();
    await db.withTenant(tenant.tenantId, async ({ repos }) => {
      const first = await repos.users.ensureMember({
        userId: identity,
        email: "Joiner@Example.com",
        displayName: "[Joiner]",
      });
      expect(first).toMatchObject({ id: identity, email: "joiner@example.com", status: "ACTIVE" });
      await repos.users.disable(identity);
      const again = await repos.users.ensureMember({
        userId: identity,
        email: "joiner@example.com",
        displayName: "[Joiner]",
      });
      expect(again.status).toBe("ACTIVE");
      expect(
        (await repos.users.list({ limit: 1000 })).filter((u) => u.id === identity),
      ).toHaveLength(1);
    });
  });
});

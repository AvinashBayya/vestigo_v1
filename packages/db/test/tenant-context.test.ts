/**
 * RELEASE-BLOCKING. A repository cannot run without a tenant context, and the
 * application refuses to run on a role that would bypass row-level security.
 */
import type { TenantId } from "@repo/core";
import { InvalidTenantIdError } from "@repo/core";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { UnsafeDatabaseRoleError, type Database } from "../src/database.ts";
import { TenantContextError } from "../src/errors.ts";
import { UsersRepository, type Repositories } from "../src/repositories/index.ts";
import { TenantScope } from "../src/scope.ts";
import { TEST_DATABASE } from "./config.ts";
import { createTenantFixture, openDatabase, type TenantFixture } from "./support.ts";

/**
 * The repository layer's own refusal. The database refuses too, with "the
 * transaction has no tenant set"; matching this message proves the refusal
 * came from the repository, before a query could reach a pooled connection
 * that may by then be serving another request.
 */
const ENDED = /its transaction has ended/;

/** Text of every statement sent through a spied pg.Client#query. */
function statementsOf(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls.map(([query]) => {
    if (typeof query === "string") return query;
    if (
      typeof query === "object" &&
      query !== null &&
      "text" in query &&
      typeof query.text === "string"
    ) {
      return query.text;
    }
    return "";
  });
}

let db: Database;
let tenant: TenantFixture;

beforeAll(async () => {
  db = openDatabase();
  tenant = await createTenantFixture(db, "ctx");
});

afterAll(async () => {
  await db.close();
});

describe("tenant context is required (RELEASE-BLOCKING)", () => {
  it("does not compile without a scope", () => {
    // @ts-expect-error -- a repository cannot be constructed without a TenantScope
    expect(() => new UsersRepository()).toThrow(TenantContextError);
  });

  it("refuses a scope that withTenant() did not issue", () => {
    const forged = new TenantScope(tenant.tenantId);
    expect(() => new UsersRepository(forged)).toThrow(TenantContextError);
  });

  it("refuses a non-scope smuggled past the type system", () => {
    const smuggled = { tenantId: tenant.tenantId } as unknown as TenantScope;
    expect(() => new UsersRepository(smuggled)).toThrow(TenantContextError);
  });

  it("refuses a repository used after its transaction ended", async () => {
    let escaped: Repositories | undefined;
    await db.withTenant(tenant.tenantId, ({ repos }) => {
      escaped = repos;
      return Promise.resolve();
    });
    if (escaped === undefined) throw new TypeError("withTenant did not run its callback");
    const leaked = escaped;
    // Refused by the repository itself, before any query is sent. (The
    // database would also refuse, having no tenant set; that layer is tested
    // separately in isolation.rls.test.ts.)
    const sent = vi.spyOn(pg.Client.prototype, "query");
    try {
      await expect(leaked.users.list({ limit: 10 })).rejects.toThrow(ENDED);
      await expect(leaked.evidence.findById(tenant.evidenceId)).rejects.toThrow(ENDED);
      expect(sent).not.toHaveBeenCalled();
    } finally {
      sent.mockRestore();
    }
  });

  it("sets the tenant for the transaction only, so it cannot outlive it on a pooled connection", async () => {
    const sent = vi.spyOn(pg.Client.prototype, "query");
    try {
      await db.withTenant(tenant.tenantId, ({ repos }) => repos.users.list({ limit: 1 }));
      const tenantStatements = statementsOf(sent).filter((text) => text.includes("app.tenant_id"));
      expect(tenantStatements).toEqual(["select set_config('app.tenant_id', $1, true)"]);
    } finally {
      sent.mockRestore();
    }
  });

  it("refuses a scope whose transaction failed", async () => {
    let escaped: Repositories | undefined;
    await expect(
      db.withTenant(tenant.tenantId, ({ repos }) => {
        escaped = repos;
        return Promise.reject(new RangeError("deliberate failure"));
      }),
    ).rejects.toBeInstanceOf(RangeError);
    if (escaped === undefined) throw new TypeError("withTenant did not run its callback");
    const leaked = escaped;
    const sent = vi.spyOn(pg.Client.prototype, "query");
    try {
      await expect(leaked.cases.list({ limit: 1 })).rejects.toThrow(ENDED);
      expect(sent).not.toHaveBeenCalled();
    } finally {
      sent.mockRestore();
    }
  });

  it("rejects a tenant id that is not a UUID, before touching the database", async () => {
    await expect(
      db.withTenant("tenant-a'; --" as TenantId, () => Promise.resolve()),
    ).rejects.toBeInstanceOf(InvalidTenantIdError);
  });

  it("refuses to run as a superuser, since row-level security would not apply", async () => {
    const unsafe = openDatabase(TEST_DATABASE.superuserUrl);
    try {
      await expect(
        unsafe.withTenant(tenant.tenantId, () => Promise.resolve()),
      ).rejects.toBeInstanceOf(UnsafeDatabaseRoleError);
    } finally {
      await unsafe.close();
    }
  });
});

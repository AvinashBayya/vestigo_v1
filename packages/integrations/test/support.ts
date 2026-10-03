import { randomUUID } from "node:crypto";
import { parseTenantId, type TenantId } from "@repo/core";
import { createDatabase, type Database } from "@repo/db";
import { expect } from "vitest";
import { TEST_CONFIG } from "./config.ts";

export function openDatabase(): Database {
  return createDatabase({
    connectionString: TEST_CONFIG.databaseUrl,
    onConnectionError: (error) => {
      console.error("database connection error", error);
    },
  });
}

export function newTenantId(): TenantId {
  return parseTenantId(randomUUID());
}

/** Provisions a fresh tenant. Names are bracketed placeholders (CLAUDE.md §1). */
export async function provisionTenant(db: Database, tag: string): Promise<TenantId> {
  const tenantId = newTenantId();
  await db.provisionTenant({ tenantId, name: `[Tenant ${tag}]`, region: "IN" });
  return tenantId;
}

/** The error `run` rejects with. Fails the test if it resolves. */
export async function rejectionOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  return expect.unreachable("expected the operation to fail, but it succeeded");
}

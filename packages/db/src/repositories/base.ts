import type { TenantId } from "@repo/core";
import { eq, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { DatabaseError, InvalidIdentifierError, translateDatabaseError } from "../errors.ts";
import { requireLiveTransaction, type TenantScope, type TenantTransaction } from "../scope.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireUuid(id: string): string {
  if (!UUID.test(id)) throw new InvalidIdentifierError();
  return id;
}

export interface ListOptions {
  /** Required, so no caller receives a silently truncated list. 1 to 1000. */
  readonly limit: number;
}

export function limitOf(options: ListOptions): number {
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 1000) {
    throw new RangeError("list limit must be an integer from 1 to 1000");
  }
  return options.limit;
}

/** The single row an INSERT ... RETURNING produced. */
export function onlyRow<T>(rows: readonly T[]): T {
  const [row] = rows;
  if (row === undefined || rows.length !== 1) {
    throw new DatabaseError(null, `expected exactly one row, received ${String(rows.length)}`);
  }
  return row;
}

export function firstRow<T>(rows: readonly T[]): T | null {
  const [row] = rows;
  return row === undefined ? null : row;
}

interface TenantKeyed {
  readonly tenantId: PgColumn;
  readonly id: PgColumn;
}

/**
 * Base of every repository. It cannot be constructed, or called, without a
 * live tenant scope from withTenant(): the constructor and every query check
 * the scope, so a repository that outlives its transaction throws
 * TenantContextError instead of running a query.
 *
 * Queries filter on tenant_id explicitly as well as relying on row-level
 * security. The two are independent; the isolation tests exercise each.
 */
export abstract class TenantRepository {
  readonly #scope: TenantScope;

  constructor(scope: TenantScope) {
    requireLiveTransaction(scope);
    this.#scope = scope;
  }

  protected get tenantId(): TenantId {
    requireLiveTransaction(this.#scope);
    return this.#scope.tenantId;
  }

  /** Runs a query on the scope's transaction and translates driver errors. */
  protected async run<T>(query: (tx: TenantTransaction) => Promise<T>): Promise<T> {
    const tx = requireLiveTransaction(this.#scope);
    try {
      return await query(tx);
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }

  /** `tenant_id = <this tenant>` for a table. */
  protected inTenant(table: { readonly tenantId: PgColumn }): SQL {
    return eq(table.tenantId, this.tenantId);
  }

  /** `tenant_id = <this tenant> and id = <id>` for a (tenant_id, id) table. */
  protected owned(table: TenantKeyed, id: string): SQL {
    return sql`${eq(table.tenantId, this.tenantId)} and ${eq(table.id, requireUuid(id))}`;
  }
}

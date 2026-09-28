import type { TenantId } from "@repo/core";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { NodePgTransaction } from "drizzle-orm/node-postgres";
import { TenantContextError } from "./errors.ts";

/** A Drizzle transaction on which the tenant context has been set. */
export type TenantTransaction = NodePgTransaction<
  Record<string, never>,
  ExtractTablesWithRelations<Record<string, never>>
>;

/**
 * The transactions currently open inside withTenant(), keyed by their scope.
 * A scope is live only while it is in this map: from the moment withTenant()
 * has set the tenant on the transaction until that transaction ends.
 */
const liveTransactions = new WeakMap<TenantScope, TenantTransaction>();

/**
 * Proof that code is running inside a tenant transaction. Repositories take
 * one in their constructor and re-check it on every call, so a repository
 * cannot be used without a tenant context:
 *   - there is no public way to open a transaction except withTenant();
 *   - a scope constructed any other way is never registered, and is refused;
 *   - a scope kept after its transaction ended is unregistered, and refused.
 */
export class TenantScope {
  readonly tenantId: TenantId;

  constructor(tenantId: TenantId) {
    this.tenantId = tenantId;
  }
}

/** Called by withTenant() once the tenant has been set on `tx`. */
export function openScope(tenantId: TenantId, tx: TenantTransaction): TenantScope {
  const scope = new TenantScope(tenantId);
  liveTransactions.set(scope, tx);
  return scope;
}

/** Called by withTenant() when the transaction ends, however it ends. */
export function closeScope(scope: TenantScope): void {
  liveTransactions.delete(scope);
}

/** The scope's transaction, or a TenantContextError if the scope is not live. */
export function requireLiveTransaction(scope: unknown): TenantTransaction {
  if (!(scope instanceof TenantScope)) {
    throw new TenantContextError("a repository was given no tenant scope");
  }
  const tx = liveTransactions.get(scope);
  if (tx === undefined) {
    throw new TenantContextError(
      "the tenant scope was not issued by withTenant(), or its transaction has ended",
    );
  }
  return tx;
}

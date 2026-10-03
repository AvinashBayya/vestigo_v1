import { randomUUID } from "node:crypto";
import { AppError, parseTenantId, type TenantId, type TenantRegion } from "@repo/core";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { reportConnectionErrors } from "./connection-errors.ts";
import { connectionLostAsTyped, translateDatabaseError } from "./errors.ts";
import { createRepositories, type Repositories, type Tenant } from "./repositories/index.ts";
import { closeScope, openScope, type TenantScope } from "./scope.ts";

export interface DatabaseOptions {
  /** Must be the application role. A superuser or BYPASSRLS role is refused. */
  readonly connectionString: string;
  /**
   * Receives an error from any pooled connection that fails outside a query:
   * idle in the pool (a server restart), or checked out between statements
   * (the server ending an idle transaction, a terminated backend). The pool
   * discards the broken connection, only the work using it fails, and the
   * process carries on; this is where the host process logs it.
   */
  readonly onConnectionError: (error: Error) => void;
  readonly maxConnections?: number;
  /** Server-side cap on any single statement. Default 15 s. */
  readonly statementTimeoutMs?: number;
  /** Cap on acquiring a connection from the pool. Default 5 s. */
  readonly connectionTimeoutMs?: number;
}

export interface TenantContext {
  readonly tenantId: TenantId;
  readonly scope: TenantScope;
  readonly repos: Repositories;
}

export interface Database {
  /**
   * Runs `work` in one transaction with the tenant set for that transaction
   * only (set_config is_local), so the setting cannot leak to the next user of
   * the pooled connection. This is the only way to reach tenant data.
   */
  withTenant<T>(tenantId: TenantId, work: (context: TenantContext) => Promise<T>): Promise<T>;
  /** Creates a tenant. Its row is written inside that tenant's own context. */
  provisionTenant(input: {
    readonly tenantId?: TenantId;
    readonly name: string;
    readonly region: TenantRegion;
  }): Promise<Tenant>;
  close(): Promise<void>;
}

export class UnsafeDatabaseRoleError extends AppError {
  readonly code = "DB_ROLE_UNSAFE";

  constructor(role: string) {
    super(
      `Refusing to run as database role "${role}": it is a superuser or has BYPASSRLS, ` +
        "so row-level security would not apply (CLAUDE.md §2).",
    );
    this.name = "UnsafeDatabaseRoleError";
  }
}

const DEFAULT_STATEMENT_TIMEOUT_MS = 15_000;
const DEFAULT_CONNECTION_TIMEOUT_MS = 5_000;

export function createDatabase(options: DatabaseOptions): Database {
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 10,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? DEFAULT_CONNECTION_TIMEOUT_MS,
    statement_timeout: options.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS,
    idle_in_transaction_session_timeout: options.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS,
    application_name: "app-runtime",
  });
  reportConnectionErrors(pool, options.onConnectionError);
  const db = drizzle({ client: pool });

  let roleChecked: Promise<void> | null = null;
  const checkRole = async (): Promise<void> => {
    const result = await pool.query<{ role: string; unsafe: boolean }>(
      "select current_user as role, (rolsuper or rolbypassrls) as unsafe from pg_roles where rolname = current_user",
    );
    const row = result.rows[0];
    if (row === undefined || row.unsafe) throw new UnsafeDatabaseRoleError(row?.role ?? "unknown");
  };

  const withTenant: Database["withTenant"] = async (tenantId, work) => {
    // Re-validated at runtime for callers that bypassed the type system.
    const id = parseTenantId(tenantId);
    roleChecked ??= checkRole().catch((error: unknown) => {
      roleChecked = null;
      throw error;
    });
    await roleChecked;

    try {
      return await db.transaction(async (tx) => {
        try {
          await tx.execute(sql`select set_config('app.tenant_id', ${id}, true)`);
        } catch (error) {
          throw translateDatabaseError(error);
        }
        const scope = openScope(id, tx);
        try {
          return await work({ tenantId: id, scope, repos: createRepositories(scope) });
        } finally {
          closeScope(scope);
        }
      });
    } catch (error) {
      // A lost connection also fails the rollback, and that driver error is
      // what leaves the transaction: it is typed here like any other.
      throw connectionLostAsTyped(error);
    }
  };

  return {
    withTenant,
    async provisionTenant(input) {
      const tenantId = input.tenantId ?? parseTenantId(randomUUID());
      return withTenant(tenantId, ({ repos }) =>
        repos.tenants.create({ name: input.name, region: input.region }),
      );
    },
    async close() {
      await pool.end();
    },
  };
}

import { AppError } from "@repo/core";
import { and, eq, gt, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { authTables } from "./schema/auth.ts";

export class UnsafeAuthRoleError extends AppError {
  readonly code = "DB_AUTH_ROLE_UNSAFE";

  constructor(role: string, reason: string) {
    super(`Refusing to use "${role}" for the identity store: ${reason}.`);
    this.name = "UnsafeAuthRoleError";
  }
}

export interface AuthStore {
  /** Drizzle over the auth schema only, for the identity provider's adapter. */
  readonly db: NodePgDatabase<typeof authTables>;
  readonly tables: typeof authTables;
  /** Whether an unexpired, pending invitation exists for this email, in any tenant. */
  hasPendingInvitation(email: string): Promise<boolean>;
  /** The role string of a membership, or null when the identity is not a member. */
  findMemberRole(organizationId: string, userId: string): Promise<string | null>;
  /** Checks the connecting role before first use; throws UnsafeAuthRoleError. */
  verifyRole(): Promise<void>;
  close(): Promise<void>;
}

export interface AuthStoreOptions {
  /** The identity role (app_auth): the auth schema only. */
  readonly connectionString: string;
  readonly onIdleClientError: (error: Error) => void;
  readonly maxConnections?: number;
  readonly statementTimeoutMs?: number;
  readonly connectionTimeoutMs?: number;
}

/**
 * The identity provider's database access. This is the one database handle
 * that reaches tables without tenant_id, so it refuses a role that could also
 * reach tenant data: identity and investigations must stay in separate
 * blast radii.
 */
export function createAuthStore(options: AuthStoreOptions): AuthStore {
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 5,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 5_000,
    statement_timeout: options.statementTimeoutMs ?? 10_000,
    idle_in_transaction_session_timeout: options.statementTimeoutMs ?? 10_000,
    application_name: "app-auth",
  });
  pool.on("error", options.onIdleClientError);

  const db = drizzle({ client: pool, schema: authTables });
  return {
    db,
    tables: authTables,
    async hasPendingInvitation(email) {
      const rows = await db
        .select({ id: authTables.invitation.id })
        .from(authTables.invitation)
        .where(
          and(
            eq(authTables.invitation.email, email.toLowerCase()),
            eq(authTables.invitation.status, "pending"),
            gt(authTables.invitation.expiresAt, sql`now()`),
          ),
        )
        .limit(1);
      return rows.length > 0;
    },
    async findMemberRole(organizationId, userId) {
      const rows = await db
        .select({ role: authTables.member.role })
        .from(authTables.member)
        .where(
          and(
            eq(authTables.member.organizationId, organizationId),
            eq(authTables.member.userId, userId),
          ),
        )
        .limit(1);
      const [row] = rows;
      return row === undefined ? null : row.role;
    },
    async verifyRole() {
      const result = await pool.query<{
        role: string;
        unsafe: boolean;
        tenant_data: boolean;
      }>(
        `select current_user as role,
                (select rolsuper or rolbypassrls from pg_roles where rolname = current_user) as unsafe,
                has_table_privilege('public.tenants', 'SELECT')
                  or has_table_privilege('public.evidence', 'SELECT')
                  or has_schema_privilege('app', 'USAGE') as tenant_data`,
      );
      const row = result.rows[0];
      if (row === undefined) throw new UnsafeAuthRoleError("unknown", "the role could not be read");
      if (row.unsafe) {
        throw new UnsafeAuthRoleError(row.role, "it is a superuser or has BYPASSRLS");
      }
      if (row.tenant_data) {
        throw new UnsafeAuthRoleError(row.role, "it can reach tenant data");
      }
    },
    async close() {
      await pool.end();
    },
  };
}

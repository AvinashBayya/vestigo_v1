import { AppError } from "@repo/core";
import { and, desc, eq, gt, isNotNull, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { reportConnectionErrors } from "./connection-errors.ts";
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
  /** Records the enrolment token issued with an invitation (its hash). */
  setInvitationEnrolmentToken(invitationId: string, tokenHash: string): Promise<void>;
  /**
   * Gives a user a new enrolment token, if the user exists and has not
   * enrolled in MFA yet (provisioning, or a re-invitation). Returns whether
   * one was set.
   */
  setUnenrolledUserToken(
    match: { readonly userId: string } | { readonly email: string },
    tokenHash: string,
    expiresAt: Date,
  ): Promise<boolean>;
  /** At sign-up: takes over the token of the newest pending invitation for the email. */
  adoptInvitationEnrolmentToken(userId: string, email: string): Promise<boolean>;
  /** Whether this is the user's current, unexpired enrolment token, and the user has not enrolled. */
  hasValidEnrolmentToken(userId: string, tokenHash: string): Promise<boolean>;
  /** Clears the token once the user has enrolled: it can never be used again. */
  clearEnrolmentTokenIfEnrolled(userId: string): Promise<void>;
  /** The role string of a membership, or null when the identity is not a member. */
  findMemberRole(organizationId: string, userId: string): Promise<string | null>;
  /** Checks the connecting role before first use; throws UnsafeAuthRoleError. */
  verifyRole(): Promise<void>;
  close(): Promise<void>;
}

export interface AuthStoreOptions {
  /** The identity role (app_auth): the auth schema only. */
  readonly connectionString: string;
  readonly onConnectionError: (error: Error) => void;
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
  reportConnectionErrors(pool, options.onConnectionError);

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
    async setInvitationEnrolmentToken(invitationId, tokenHash) {
      await db
        .update(authTables.invitation)
        .set({ enrolmentTokenHash: tokenHash })
        .where(eq(authTables.invitation.id, invitationId));
    },
    async setUnenrolledUserToken(match, tokenHash, expiresAt) {
      const rows = await db
        .update(authTables.user)
        .set({ mfaEnrolmentTokenHash: tokenHash, mfaEnrolmentTokenExpiresAt: expiresAt })
        .where(
          and(
            "userId" in match
              ? eq(authTables.user.id, match.userId)
              : eq(authTables.user.email, match.email.toLowerCase()),
            eq(authTables.user.twoFactorEnabled, false),
          ),
        )
        .returning({ id: authTables.user.id });
      return rows.length === 1;
    },
    async adoptInvitationEnrolmentToken(userId, email) {
      const [invitation] = await db
        .select({
          hash: authTables.invitation.enrolmentTokenHash,
          expiresAt: authTables.invitation.expiresAt,
        })
        .from(authTables.invitation)
        .where(
          and(
            eq(authTables.invitation.email, email.toLowerCase()),
            eq(authTables.invitation.status, "pending"),
            gt(authTables.invitation.expiresAt, sql`now()`),
            isNotNull(authTables.invitation.enrolmentTokenHash),
          ),
        )
        .orderBy(desc(authTables.invitation.createdAt))
        .limit(1);
      if (invitation?.hash === undefined || invitation.hash === null) return false;
      await db
        .update(authTables.user)
        .set({
          mfaEnrolmentTokenHash: invitation.hash,
          mfaEnrolmentTokenExpiresAt: invitation.expiresAt,
        })
        .where(and(eq(authTables.user.id, userId), eq(authTables.user.twoFactorEnabled, false)));
      return true;
    },
    async hasValidEnrolmentToken(userId, tokenHash) {
      const rows = await db
        .select({ id: authTables.user.id })
        .from(authTables.user)
        .where(
          and(
            eq(authTables.user.id, userId),
            eq(authTables.user.twoFactorEnabled, false),
            eq(authTables.user.mfaEnrolmentTokenHash, tokenHash),
            gt(authTables.user.mfaEnrolmentTokenExpiresAt, sql`now()`),
          ),
        )
        .limit(1);
      return rows.length === 1;
    },
    async clearEnrolmentTokenIfEnrolled(userId) {
      await db
        .update(authTables.user)
        .set({ mfaEnrolmentTokenHash: null, mfaEnrolmentTokenExpiresAt: null })
        .where(and(eq(authTables.user.id, userId), eq(authTables.user.twoFactorEnabled, true)));
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

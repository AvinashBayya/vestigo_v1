import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { idColumn, tenantIdColumn } from "./columns.ts";
import { auditActorKind, auditOutcome, authMethod } from "./enums.ts";
import { tenants } from "./tenancy.ts";

/**
 * Append-only record of who did what, when, under whose authorisation.
 * The application role holds only SELECT and INSERT on it, and a trigger
 * rejects UPDATE, DELETE and TRUNCATE from any role (CLAUDE.md §9).
 *
 * Actor and target ids deliberately carry no foreign keys: an audit entry must
 * outlive the user, key or record it describes.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
    actorKind: auditActorKind("actor_kind").notNull(),
    actorUserId: uuid("actor_user_id"),
    actorApiKeyId: uuid("actor_api_key_id"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    details: jsonb("details"),
    /** How the actor was authenticated for this action. */
    authMethod: authMethod("auth_method"),
    /** The permission the action required and exercised. */
    permission: text("permission"),
    outcome: auditOutcome("outcome"),
    sessionId: uuid("session_id"),
    requestId: text("request_id"),
  },
  (t) => [
    primaryKey({ name: "audit_log_pk", columns: [t.tenantId, t.id] }),
    foreignKey({
      name: "audit_log_tenant_fk",
      columns: [t.tenantId],
      foreignColumns: [tenants.tenantId],
    }),
    check("audit_log_action_format", sql`${t.action} ~ '^[a-z][a-z_]*(\\.[a-z][a-z_]*)+$'`),
    check(
      "audit_log_actor_consistent",
      sql`(${t.actorKind} = 'USER' and ${t.actorUserId} is not null and ${t.actorApiKeyId} is null)
        or (${t.actorKind} = 'API_KEY' and ${t.actorApiKeyId} is not null and ${t.actorUserId} is null)
        or (${t.actorKind} = 'SYSTEM' and ${t.actorUserId} is null and ${t.actorApiKeyId} is null)`,
    ),
    check("audit_log_target_consistent", sql`(${t.targetType} is null) = (${t.targetId} is null)`),
    check(
      "audit_log_outcome_has_authorisation",
      sql`${t.outcome} is null or ${t.authMethod} is not null`,
    ),
    check(
      "audit_log_permission_format",
      sql`${t.permission} is null or ${t.permission} ~ '^[a-z][a-z_]*:[a-z][a-z_]*$'`,
    ),
    check(
      "audit_log_session_matches_method",
      sql`${t.sessionId} is null or ${t.authMethod} = 'SESSION'`,
    ),
  ],
);

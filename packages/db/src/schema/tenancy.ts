import { sql } from "drizzle-orm";
import { check, foreignKey, pgTable, primaryKey, text, unique, uuid } from "drizzle-orm/pg-core";
import { createdAtColumn, idColumn, optionalTimestamp, tenantIdColumn } from "./columns.ts";
import { tenantPlan, tenantRegion, userStatus, vettingStatus } from "./enums.ts";

/**
 * One row per tenant. Its primary key is named tenant_id like every other
 * table's tenant column, so one row-level security policy shape covers all.
 */
export const tenants = pgTable(
  "tenants",
  {
    tenantId: uuid("tenant_id").primaryKey(),
    name: text("name").notNull(),
    region: tenantRegion("region").notNull(),
    /**
     * The plan and the customer-vetting state gate modules. The application
     * role cannot write either: it may only insert name and region, so a new
     * tenant always starts on the defaults, and it has no UPDATE on these.
     */
    plan: tenantPlan("plan").notNull().default("TECHINT"),
    vettingStatus: vettingStatus("vetting_status").notNull().default("NOT_SUBMITTED"),
    createdAt: createdAtColumn(),
    /**
     * The handling marking printed on every page of this tenant's reports
     * (Phase 5), or null to use the platform's. Tenant administrators set it.
     */
    reportHandlingMarking: text("report_handling_marking"),
  },
  (t) => [
    check("tenants_name_not_blank", sql`length(btrim(${t.name})) > 0`),
    check(
      "tenants_report_handling_marking_format",
      sql`${t.reportHandlingMarking} is null or (${t.reportHandlingMarking} = btrim(${t.reportHandlingMarking}) and length(${t.reportHandlingMarking}) between 1 and 80 and ${t.reportHandlingMarking} !~ '[[:cntrl:]]')`,
    ),
  ],
);

export const users = pgTable(
  "users",
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    email: text("email").notNull(),
    displayName: text("display_name"),
    status: userStatus("status").notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    primaryKey({ name: "users_pk", columns: [t.tenantId, t.id] }),
    foreignKey({
      name: "users_tenant_fk",
      columns: [t.tenantId],
      foreignColumns: [tenants.tenantId],
    }),
    unique("users_email_key").on(t.tenantId, t.email),
    check(
      "users_email_normalised",
      sql`${t.email} = lower(${t.email}) and ${t.email} like '_%@_%'`,
    ),
  ],
);

/**
 * API keys are stored hashed; the plaintext is shown once and never persisted.
 * Each key carries its own permission scope, fixed at creation; to change a
 * scope, create a new key. A rotated key records the key it replaced.
 */
export const apiKeys = pgTable(
  "api_keys",
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    name: text("name").notNull(),
    keyPrefix: text("key_prefix").notNull(),
    keyHash: text("key_hash").notNull(),
    createdByUserId: uuid("created_by_user_id"),
    createdAt: createdAtColumn(),
    lastUsedAt: optionalTimestamp("last_used_at"),
    expiresAt: optionalTimestamp("expires_at"),
    revokedAt: optionalTimestamp("revoked_at"),
    // Default empty: a key with no scope can do nothing, so pre-existing rows stay safe.
    permissions: text("permissions")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    rotatedFromId: uuid("rotated_from_id"),
  },
  (t) => [
    primaryKey({ name: "api_keys_pk", columns: [t.tenantId, t.id] }),
    foreignKey({
      name: "api_keys_tenant_fk",
      columns: [t.tenantId],
      foreignColumns: [tenants.tenantId],
    }),
    foreignKey({
      name: "api_keys_created_by_fk",
      columns: [t.tenantId, t.createdByUserId],
      foreignColumns: [users.tenantId, users.id],
    }),
    unique("api_keys_prefix_key").on(t.tenantId, t.keyPrefix),
    check("api_keys_prefix_format", sql`${t.keyPrefix} ~ '^[A-Za-z0-9_-]{6,32}$'`),
    check("api_keys_hash_present", sql`length(${t.keyHash}) >= 32`),
    foreignKey({
      name: "api_keys_rotated_from_fk",
      columns: [t.tenantId, t.rotatedFromId],
      foreignColumns: [t.tenantId, t.id],
    }),
    check(
      "api_keys_permissions_format",
      sql`array_to_string(${t.permissions}, ',') ~ '^([a-z][a-z_]*:[a-z][a-z_]*(,[a-z][a-z_]*:[a-z][a-z_]*)*)?$'`,
    ),
    check("api_keys_not_rotated_from_self", sql`${t.rotatedFromId} is distinct from ${t.id}`),
  ],
);

import { sql } from "drizzle-orm";
import { check, foreignKey, pgTable, primaryKey, text, unique, uuid } from "drizzle-orm/pg-core";
import { createdAtColumn, idColumn, optionalTimestamp, tenantIdColumn } from "./columns.ts";
import { tenantRegion, userStatus } from "./enums.ts";

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
    createdAt: createdAtColumn(),
  },
  (t) => [check("tenants_name_not_blank", sql`length(btrim(${t.name})) > 0`)],
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

export const roles = pgTable(
  "roles",
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    name: text("name").notNull(),
    description: text("description"),
    createdAt: createdAtColumn(),
  },
  (t) => [
    primaryKey({ name: "roles_pk", columns: [t.tenantId, t.id] }),
    foreignKey({
      name: "roles_tenant_fk",
      columns: [t.tenantId],
      foreignColumns: [tenants.tenantId],
    }),
    unique("roles_name_key").on(t.tenantId, t.name),
    check("roles_name_not_blank", sql`length(btrim(${t.name})) > 0`),
  ],
);

/**
 * A permission granted to a role. Access checks test permissions such as
 * `investigation:create`, never role names (ARCHITECTURE-DECISIONS §4).
 */
export const permissions = pgTable(
  "permissions",
  {
    tenantId: tenantIdColumn(),
    roleId: uuid("role_id").notNull(),
    permission: text("permission").notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    primaryKey({ name: "permissions_pk", columns: [t.tenantId, t.roleId, t.permission] }),
    foreignKey({
      name: "permissions_tenant_fk",
      columns: [t.tenantId],
      foreignColumns: [tenants.tenantId],
    }),
    foreignKey({
      name: "permissions_role_fk",
      columns: [t.tenantId, t.roleId],
      foreignColumns: [roles.tenantId, roles.id],
    }).onDelete("cascade"),
    check("permissions_key_format", sql`${t.permission} ~ '^[a-z][a-z_]*:[a-z][a-z_]*$'`),
  ],
);

export const memberships = pgTable(
  "memberships",
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    userId: uuid("user_id").notNull(),
    roleId: uuid("role_id").notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    primaryKey({ name: "memberships_pk", columns: [t.tenantId, t.id] }),
    foreignKey({
      name: "memberships_tenant_fk",
      columns: [t.tenantId],
      foreignColumns: [tenants.tenantId],
    }),
    foreignKey({
      name: "memberships_user_fk",
      columns: [t.tenantId, t.userId],
      foreignColumns: [users.tenantId, users.id],
    }),
    foreignKey({
      name: "memberships_role_fk",
      columns: [t.tenantId, t.roleId],
      foreignColumns: [roles.tenantId, roles.id],
    }),
    unique("memberships_user_role_key").on(t.tenantId, t.userId, t.roleId),
  ],
);

/** API keys are stored hashed; the plaintext is shown once and never persisted. */
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
  ],
);

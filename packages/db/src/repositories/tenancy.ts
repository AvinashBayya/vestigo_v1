import type { TenantRegion } from "@repo/core";
import { and, asc, eq, sql } from "drizzle-orm";
import { apiKeys, memberships, permissions, roles, tenants, users } from "../schema/index.ts";
import {
  firstRow,
  limitOf,
  onlyRow,
  requireUuid,
  TenantRepository,
  type ListOptions,
} from "./base.ts";

export type Tenant = typeof tenants.$inferSelect;
export type User = typeof users.$inferSelect;
export type Role = typeof roles.$inferSelect;
export type Permission = typeof permissions.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;

/** The current tenant's own row. A tenant can never see another tenant's row. */
export class TenantsRepository extends TenantRepository {
  /** Inserts the row for the scope's tenant. Used when provisioning. */
  async create(input: { readonly name: string; readonly region: TenantRegion }): Promise<Tenant> {
    return this.run(async (tx) =>
      onlyRow(
        await tx
          .insert(tenants)
          .values({ tenantId: this.tenantId, ...input })
          .returning(),
      ),
    );
  }

  async current(): Promise<Tenant | null> {
    return this.run(async (tx) =>
      firstRow(await tx.select().from(tenants).where(eq(tenants.tenantId, this.tenantId))),
    );
  }

  /** Looks up a tenant by id. Returns null for any tenant but the current one. */
  async findById(tenantId: string): Promise<Tenant | null> {
    return this.run(async (tx) =>
      firstRow(
        await tx
          .select()
          .from(tenants)
          .where(
            and(eq(tenants.tenantId, this.tenantId), eq(tenants.tenantId, requireUuid(tenantId))),
          ),
      ),
    );
  }

  async rename(name: string): Promise<Tenant | null> {
    return this.run(async (tx) =>
      firstRow(
        await tx
          .update(tenants)
          .set({ name })
          .where(eq(tenants.tenantId, this.tenantId))
          .returning(),
      ),
    );
  }
}

export interface NewUser {
  readonly email: string;
  readonly displayName: string | null;
  readonly status: User["status"];
}

export class UsersRepository extends TenantRepository {
  async create(input: NewUser): Promise<User> {
    return this.run(async (tx) =>
      onlyRow(
        await tx
          .insert(users)
          .values({ tenantId: this.tenantId, ...input })
          .returning(),
      ),
    );
  }

  async findById(id: string): Promise<User | null> {
    return this.run(async (tx) =>
      firstRow(await tx.select().from(users).where(this.owned(users, id))),
    );
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.run(async (tx) =>
      firstRow(
        await tx
          .select()
          .from(users)
          .where(and(this.inTenant(users), eq(users.email, email.toLowerCase()))),
      ),
    );
  }

  async list(options: ListOptions): Promise<User[]> {
    return this.run((tx) =>
      tx
        .select()
        .from(users)
        .where(this.inTenant(users))
        .orderBy(asc(users.createdAt))
        .limit(limitOf(options)),
    );
  }

  async update(
    id: string,
    patch: Partial<Pick<NewUser, "email" | "displayName" | "status">>,
  ): Promise<User | null> {
    return this.run(async (tx) =>
      firstRow(await tx.update(users).set(patch).where(this.owned(users, id)).returning()),
    );
  }
}

export class RolesRepository extends TenantRepository {
  async create(input: {
    readonly name: string;
    readonly description: string | null;
  }): Promise<Role> {
    return this.run(async (tx) =>
      onlyRow(
        await tx
          .insert(roles)
          .values({ tenantId: this.tenantId, ...input })
          .returning(),
      ),
    );
  }

  async findById(id: string): Promise<Role | null> {
    return this.run(async (tx) =>
      firstRow(await tx.select().from(roles).where(this.owned(roles, id))),
    );
  }

  async list(options: ListOptions): Promise<Role[]> {
    return this.run((tx) =>
      tx
        .select()
        .from(roles)
        .where(this.inTenant(roles))
        .orderBy(asc(roles.name))
        .limit(limitOf(options)),
    );
  }

  async update(
    id: string,
    patch: { readonly name?: string; readonly description?: string | null },
  ): Promise<Role | null> {
    return this.run(async (tx) =>
      firstRow(await tx.update(roles).set(patch).where(this.owned(roles, id)).returning()),
    );
  }

  /** Deletes the role and its permission grants. Fails while members hold it. */
  async delete(id: string): Promise<boolean> {
    return this.run(async (tx) => {
      const rows = await tx.delete(roles).where(this.owned(roles, id)).returning({ id: roles.id });
      return rows.length === 1;
    });
  }
}

/** Permission grants to roles. Checks test these keys, never role names. */
export class PermissionsRepository extends TenantRepository {
  async grant(roleId: string, permission: string): Promise<Permission> {
    return this.run(async (tx) =>
      onlyRow(
        await tx
          .insert(permissions)
          .values({ tenantId: this.tenantId, roleId: requireUuid(roleId), permission })
          .returning(),
      ),
    );
  }

  async revoke(roleId: string, permission: string): Promise<boolean> {
    return this.run(async (tx) => {
      const rows = await tx
        .delete(permissions)
        .where(
          and(
            this.inTenant(permissions),
            eq(permissions.roleId, requireUuid(roleId)),
            eq(permissions.permission, permission),
          ),
        )
        .returning({ roleId: permissions.roleId });
      return rows.length === 1;
    });
  }

  async listForRole(roleId: string): Promise<Permission[]> {
    return this.run((tx) =>
      tx
        .select()
        .from(permissions)
        .where(and(this.inTenant(permissions), eq(permissions.roleId, requireUuid(roleId))))
        .orderBy(asc(permissions.permission)),
    );
  }

  async list(options: ListOptions): Promise<Permission[]> {
    return this.run((tx) =>
      tx
        .select()
        .from(permissions)
        .where(this.inTenant(permissions))
        .orderBy(asc(permissions.roleId), asc(permissions.permission))
        .limit(limitOf(options)),
    );
  }
}

export class MembershipsRepository extends TenantRepository {
  async create(input: { readonly userId: string; readonly roleId: string }): Promise<Membership> {
    return this.run(async (tx) =>
      onlyRow(
        await tx
          .insert(memberships)
          .values({
            tenantId: this.tenantId,
            userId: requireUuid(input.userId),
            roleId: requireUuid(input.roleId),
          })
          .returning(),
      ),
    );
  }

  async findById(id: string): Promise<Membership | null> {
    return this.run(async (tx) =>
      firstRow(await tx.select().from(memberships).where(this.owned(memberships, id))),
    );
  }

  async list(options: ListOptions): Promise<Membership[]> {
    return this.run((tx) =>
      tx
        .select()
        .from(memberships)
        .where(this.inTenant(memberships))
        .orderBy(asc(memberships.createdAt))
        .limit(limitOf(options)),
    );
  }

  async delete(id: string): Promise<boolean> {
    return this.run(async (tx) => {
      const rows = await tx
        .delete(memberships)
        .where(this.owned(memberships, id))
        .returning({ id: memberships.id });
      return rows.length === 1;
    });
  }
}

export interface NewApiKey {
  readonly name: string;
  readonly keyPrefix: string;
  /** A hash of the key. The plaintext key is never stored. */
  readonly keyHash: string;
  readonly createdByUserId: string | null;
  readonly expiresAt: Date | null;
}

export class ApiKeysRepository extends TenantRepository {
  async create(input: NewApiKey): Promise<ApiKey> {
    return this.run(async (tx) =>
      onlyRow(
        await tx
          .insert(apiKeys)
          .values({ tenantId: this.tenantId, ...input })
          .returning(),
      ),
    );
  }

  async findById(id: string): Promise<ApiKey | null> {
    return this.run(async (tx) =>
      firstRow(await tx.select().from(apiKeys).where(this.owned(apiKeys, id))),
    );
  }

  async list(options: ListOptions): Promise<ApiKey[]> {
    return this.run((tx) =>
      tx
        .select()
        .from(apiKeys)
        .where(this.inTenant(apiKeys))
        .orderBy(asc(apiKeys.createdAt))
        .limit(limitOf(options)),
    );
  }

  async rename(id: string, name: string): Promise<ApiKey | null> {
    return this.run(async (tx) =>
      firstRow(await tx.update(apiKeys).set({ name }).where(this.owned(apiKeys, id)).returning()),
    );
  }

  /** Stamps the moment of use, as measured by the database clock. */
  async recordUse(id: string): Promise<ApiKey | null> {
    return this.run(async (tx) =>
      firstRow(
        await tx
          .update(apiKeys)
          .set({ lastUsedAt: sql`now()` })
          .where(this.owned(apiKeys, id))
          .returning(),
      ),
    );
  }

  async revoke(id: string): Promise<ApiKey | null> {
    return this.run(async (tx) =>
      firstRow(
        await tx
          .update(apiKeys)
          .set({ revokedAt: sql`now()` })
          .where(and(this.owned(apiKeys, id), sql`${apiKeys.revokedAt} is null`))
          .returning(),
      ),
    );
  }
}

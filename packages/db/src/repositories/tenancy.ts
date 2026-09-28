import type { Permission } from "@repo/access";
import type { TenantRegion } from "@repo/core";
import { and, asc, eq, sql } from "drizzle-orm";
import { apiKeys, tenants, users } from "../schema/index.ts";
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
export type ApiKey = typeof apiKeys.$inferSelect;

/** The current tenant's own row. A tenant can never see another tenant's row. */
export class TenantsRepository extends TenantRepository {
  /**
   * Inserts the row for the scope's tenant. Used when provisioning. Only name
   * and region can be given: plan and vetting status always start on their
   * defaults, and the application role has no privilege to set them.
   * (Explicit SQL, because an ORM insert would list the defaulted columns too.)
   */
  async create(input: { readonly name: string; readonly region: TenantRegion }): Promise<Tenant> {
    return this.run(async (tx) => {
      await tx.execute(
        sql`insert into ${tenants} (tenant_id, name, region) values (${this.tenantId}, ${input.name}, ${input.region})`,
      );
      return onlyRow(await tx.select().from(tenants).where(eq(tenants.tenantId, this.tenantId)));
    });
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

  /**
   * Makes sure an identity has an active profile in this tenant, with the same
   * id as the identity. Called when someone joins; reactivates a profile
   * disabled when they previously left. Profiles are never deleted, because
   * the tenant's records keep referring to who did what.
   */
  async ensureMember(input: {
    readonly userId: string;
    readonly email: string;
    readonly displayName: string | null;
  }): Promise<User> {
    const id = requireUuid(input.userId);
    return this.run(async (tx) => {
      await tx
        .insert(users)
        .values({
          tenantId: this.tenantId,
          id,
          email: input.email.toLowerCase(),
          displayName: input.displayName,
          status: "ACTIVE",
        })
        .onConflictDoUpdate({ target: [users.tenantId, users.id], set: { status: "ACTIVE" } });
      return onlyRow(await tx.select().from(users).where(this.owned(users, id)));
    });
  }

  /** Marks a profile disabled, when its identity leaves the tenant. */
  async disable(id: string): Promise<User | null> {
    return this.run(async (tx) =>
      firstRow(
        await tx.update(users).set({ status: "DISABLED" }).where(this.owned(users, id)).returning(),
      ),
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

export interface NewApiKey {
  /** Chosen by the caller, because the key's id is part of the key itself. */
  readonly id: string;
  readonly name: string;
  readonly keyPrefix: string;
  /** A hash of the key. The plaintext key is never stored. */
  readonly keyHash: string;
  readonly createdByUserId: string | null;
  readonly expiresAt: Date | null;
  /** The key's scope. Fixed for its lifetime. */
  readonly permissions: readonly Permission[];
  /** The key this one replaced, when created by rotation. */
  readonly rotatedFromId: string | null;
}

export class ApiKeysRepository extends TenantRepository {
  async create(input: NewApiKey): Promise<ApiKey> {
    return this.run(async (tx) =>
      onlyRow(
        await tx
          .insert(apiKeys)
          .values({
            ...input,
            tenantId: this.tenantId,
            id: requireUuid(input.id),
            permissions: [...input.permissions],
            rotatedFromId: input.rotatedFromId === null ? null : requireUuid(input.rotatedFromId),
          })
          .returning(),
      ),
    );
  }

  async findById(id: string): Promise<ApiKey | null> {
    return this.run(async (tx) =>
      firstRow(await tx.select().from(apiKeys).where(this.owned(apiKeys, id))),
    );
  }

  /**
   * The key if it can be used right now: not revoked and not expired, judged
   * by the database clock. Null otherwise.
   */
  async findUsable(id: string): Promise<ApiKey | null> {
    return this.run(async (tx) =>
      firstRow(
        await tx
          .select()
          .from(apiKeys)
          .where(
            and(
              this.owned(apiKeys, id),
              sql`${apiKeys.revokedAt} is null`,
              sql`(${apiKeys.expiresAt} is null or ${apiKeys.expiresAt} > now())`,
            ),
          ),
      ),
    );
  }

  /** Brings a key's expiry forward (never later), e.g. to end a rotation overlap. */
  async expireBy(id: string, at: Date): Promise<ApiKey | null> {
    return this.run(async (tx) =>
      firstRow(
        await tx
          .update(apiKeys)
          .set({ expiresAt: sql`least(coalesce(${apiKeys.expiresAt}, ${at}), ${at})` })
          .where(and(this.owned(apiKeys, id), sql`${apiKeys.revokedAt} is null`))
          .returning(),
      ),
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

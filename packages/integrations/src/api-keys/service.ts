import {
  generateApiKey,
  grantableApiKeyScope,
  isPermission,
  secretMatches,
  type ParsedApiKey,
  type Permission,
} from "@repo/access";
import type { TenantId } from "@repo/core";
import type { ApiKey, TenantContext } from "@repo/db";
import { ApiKeyAuthenticationError, ApiKeyInputError, ApiKeyNotFoundError } from "./errors.ts";

/** What the service says about a key. Never its hash or its secret. */
export interface ApiKeyMetadata {
  readonly id: string;
  readonly name: string;
  /** Safe to display; identifies the key to its owner. */
  readonly keyPrefix: string;
  /** Exactly as stored. */
  readonly permissions: readonly string[];
  readonly createdByUserId: string | null;
  readonly createdAt: Date;
  /** Null: no use has been recorded. */
  readonly lastUsedAt: Date | null;
  /** Null: the key does not expire. */
  readonly expiresAt: Date | null;
  readonly revokedAt: Date | null;
  readonly rotatedFromId: string | null;
}

/** A newly issued key. `plaintext` is returned here and nowhere else, ever. */
export interface IssuedApiKey {
  readonly key: ApiKeyMetadata;
  readonly plaintext: string;
}

export interface CreateApiKeyInput {
  readonly name: string;
  readonly permissions: readonly string[];
  readonly createdByUserId: string | null;
  readonly expiresAt: Date | null;
  /** What the creating principal holds. A key's scope must be a subset of it. */
  readonly grantorPermissions: ReadonlySet<Permission>;
}

export interface RotateApiKeyInput {
  /** Until when the old key keeps working. Null revokes it immediately. */
  readonly overlapUntil: Date | null;
  readonly createdByUserId: string | null;
  readonly grantorPermissions: ReadonlySet<Permission>;
}

/** An authenticated API key. */
export interface ApiKeyPrincipal {
  readonly tenantId: TenantId;
  readonly apiKeyId: string;
  readonly permissions: ReadonlySet<Permission>;
}

const MAX_NAME_LENGTH = 200;

function toMetadata(row: ApiKey): ApiKeyMetadata {
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.keyPrefix,
    permissions: [...row.permissions],
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    rotatedFromId: row.rotatedFromId,
  };
}

function requireName(name: string): void {
  if (name.trim().length === 0) throw new ApiKeyInputError("name", "must not be blank");
  if (name.length > MAX_NAME_LENGTH) {
    throw new ApiKeyInputError("name", `must be at most ${String(MAX_NAME_LENGTH)} characters`);
  }
}

function requireValidDate(field: "expiresAt" | "overlapUntil", value: Date | null): void {
  if (value !== null && Number.isNaN(value.getTime())) {
    throw new ApiKeyInputError(field, "must be a valid date or null");
  }
}

/**
 * API keys: scoped, rotatable, hashed at rest (ARCHITECTURE-DECISIONS §4).
 * This is their storage and lifecycle; the rules (format, hashing, secret
 * verification, what a scope may contain) are @repo/access's. Every method
 * runs inside the caller's tenant context.
 */
export class ApiKeyService {
  async create(ctx: TenantContext, input: CreateApiKeyInput): Promise<IssuedApiKey> {
    requireName(input.name);
    requireValidDate("expiresAt", input.expiresAt);
    const permissions = grantableApiKeyScope(input.permissions, input.grantorPermissions);
    return this.#issue(ctx, {
      name: input.name,
      permissions,
      createdByUserId: input.createdByUserId,
      expiresAt: input.expiresAt,
      rotatedFromId: null,
    });
  }

  /**
   * Replaces a usable key with a new one of the same name and scope. The new
   * key keeps the old key's expiry: rotation replaces the secret, it never
   * extends a key's lifetime. The old key is revoked now, or expires at
   * `overlapUntil` (never later than it already would).
   */
  async rotate(ctx: TenantContext, keyId: string, input: RotateApiKeyInput): Promise<IssuedApiKey> {
    requireValidDate("overlapUntil", input.overlapUntil);
    const old = await ctx.repos.apiKeys.findUsable(keyId);
    if (old === null) throw new ApiKeyNotFoundError();
    const permissions = grantableApiKeyScope(old.permissions, input.grantorPermissions);

    const issued = await this.#issue(ctx, {
      name: old.name,
      permissions,
      createdByUserId: input.createdByUserId,
      expiresAt: old.expiresAt,
      rotatedFromId: old.id,
    });
    if (input.overlapUntil === null) await ctx.repos.apiKeys.revoke(old.id);
    else await ctx.repos.apiKeys.expireBy(old.id, input.overlapUntil);
    return issued;
  }

  /** Revokes a key. Null if it does not exist here or is already revoked. */
  async revoke(ctx: TenantContext, keyId: string): Promise<ApiKeyMetadata | null> {
    const row = await ctx.repos.apiKeys.revoke(keyId);
    return row === null ? null : toMetadata(row);
  }

  async list(ctx: TenantContext, options: { readonly limit: number }): Promise<ApiKeyMetadata[]> {
    const rows = await ctx.repos.apiKeys.list(options);
    return rows.map(toMetadata);
  }

  /**
   * Authenticates a parsed key. The caller has already opened the tenant
   * context the key names. Every failure is the same ApiKeyAuthenticationError;
   * database failures propagate as themselves, so an outage is never reported
   * as a bad key.
   */
  async authenticate(ctx: TenantContext, parsed: ParsedApiKey): Promise<ApiKeyPrincipal> {
    if (ctx.tenantId !== parsed.tenantId) throw new ApiKeyAuthenticationError();
    const row = await ctx.repos.apiKeys.findUsable(parsed.keyId);
    const matches = secretMatches(parsed.secret, row === null ? null : row.keyHash);
    if (row === null || !matches) throw new ApiKeyAuthenticationError();
    await ctx.repos.apiKeys.recordUse(row.id);
    return {
      tenantId: ctx.tenantId,
      apiKeyId: row.id,
      permissions: new Set(row.permissions.filter(isPermission)),
    };
  }

  async #issue(
    ctx: TenantContext,
    input: {
      readonly name: string;
      readonly permissions: readonly Permission[];
      readonly createdByUserId: string | null;
      readonly expiresAt: Date | null;
      readonly rotatedFromId: string | null;
    },
  ): Promise<IssuedApiKey> {
    const generated = generateApiKey(ctx.tenantId);
    const row = await ctx.repos.apiKeys.create({
      id: generated.id,
      name: input.name,
      keyPrefix: generated.keyPrefix,
      keyHash: generated.keyHash,
      createdByUserId: input.createdByUserId,
      expiresAt: input.expiresAt,
      permissions: input.permissions,
      rotatedFromId: input.rotatedFromId,
    });
    return { key: toMetadata(row), plaintext: generated.plaintext };
  }
}

/**
 * API keys against a real database: scoped issuance, rotation, revocation and
 * authentication with no oracle, per tenant (CLAUDE.md §2).
 */
import { setTimeout as sleep } from "node:timers/promises";
import {
  ApiKeyScopeError,
  generateApiKey,
  parseApiKey,
  ROLE_PERMISSIONS,
  type Permission,
} from "@repo/access";
import type { TenantId } from "@repo/core";
import type { ApiKey, Database } from "@repo/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ApiKeyAuthenticationError,
  ApiKeyInputError,
  ApiKeyNotFoundError,
  ApiKeyService,
  type IssuedApiKey,
} from "../src/index.ts";
import { openDatabase, provisionTenant, rejectionOf } from "./support.ts";

const ADMIN = new Set<Permission>(ROLE_PERMISSIONS.admin);
const ANALYST = new Set<Permission>(ROLE_PERMISSIONS.analyst);
const SCOPE: readonly Permission[] = ["investigation:read", "case:read"];

const METADATA_KEYS = [
  "createdAt",
  "createdByUserId",
  "expiresAt",
  "id",
  "keyPrefix",
  "lastUsedAt",
  "name",
  "permissions",
  "revokedAt",
  "rotatedFromId",
];

let db: Database;
let tenantA: TenantId;
let tenantB: TenantId;
const service = new ApiKeyService();

beforeAll(async () => {
  db = openDatabase();
  tenantA = await provisionTenant(db, "keys-a");
  tenantB = await provisionTenant(db, "keys-b");
});

afterAll(async () => {
  await db.close();
});

async function issue(
  tenantId: TenantId,
  overrides: { readonly expiresAt?: Date | null; readonly permissions?: readonly string[] } = {},
): Promise<IssuedApiKey> {
  return db.withTenant(tenantId, (ctx) =>
    service.create(ctx, {
      name: "[test key]",
      permissions: overrides.permissions === undefined ? SCOPE : overrides.permissions,
      createdByUserId: null,
      expiresAt: overrides.expiresAt === undefined ? null : overrides.expiresAt,
      grantorPermissions: ADMIN,
    }),
  );
}

/** The real flow: parse, open the tenant the key names (or the one given), authenticate. */
async function authenticate(plaintext: string, contextTenant?: TenantId) {
  const parsed = parseApiKey(plaintext);
  if (parsed === null) return expect.unreachable("the presented key must parse");
  const tenant = contextTenant === undefined ? parsed.tenantId : contextTenant;
  return db.withTenant(tenant, (ctx) => service.authenticate(ctx, parsed));
}

async function storedRow(tenantId: TenantId, id: string): Promise<ApiKey> {
  const row = await db.withTenant(tenantId, ({ repos }) => repos.apiKeys.findById(id));
  if (row === null) return expect.unreachable("the key row is missing");
  return row;
}

describe("create", () => {
  it("issues a key whose plaintext is returned once and whose metadata carries no hash", async () => {
    const issued = await issue(tenantA);
    const row = await storedRow(tenantA, issued.key.id);

    expect(parseApiKey(issued.plaintext)?.keyId).toBe(issued.key.id);
    expect(issued.key).toMatchObject({
      name: "[test key]",
      keyPrefix: row.keyPrefix,
      permissions: SCOPE,
      createdByUserId: null,
      expiresAt: null,
      revokedAt: null,
      lastUsedAt: null,
      rotatedFromId: null,
    });
    expect(Object.keys(issued.key).sort()).toEqual(METADATA_KEYS);

    const listed = await db.withTenant(tenantA, (ctx) => service.list(ctx, { limit: 1000 }));
    const secret = issued.plaintext.slice(-43);
    for (const serialized of [JSON.stringify(issued.key), JSON.stringify(listed)]) {
      expect(serialized).not.toContain(row.keyHash);
      expect(serialized).not.toContain("keyHash");
      expect(serialized).not.toContain(secret);
    }
    for (const entry of listed) expect(Object.keys(entry).sort()).toEqual(METADATA_KEYS);
    expect(row.keyHash).not.toContain(secret);
  });

  it("de-duplicates the requested scope", async () => {
    const issued = await issue(tenantA, { permissions: ["case:read", "case:read", "tenant:read"] });
    expect(issued.key.permissions).toEqual(["case:read", "tenant:read"]);
  });

  it("refuses a scope the grantor does not hold, naming the permissions", async () => {
    const error = await rejectionOf(() =>
      db.withTenant(tenantA, (ctx) =>
        service.create(ctx, {
          name: "[test key]",
          permissions: ["case:read", "api_key:manage", "audit:read"],
          createdByUserId: null,
          expiresAt: null,
          grantorPermissions: ANALYST,
        }),
      ),
    );
    expect(error).toBeInstanceOf(ApiKeyScopeError);
    expect(error).toMatchObject({
      code: "API_KEY_SCOPE_INVALID",
      problem: "EXCEEDS_GRANTOR",
      permissions: ["api_key:manage", "audit:read"],
    });
    expect((error as Error).message).toContain("api_key:manage");
  });

  it("refuses unknown permissions", async () => {
    const error = await rejectionOf(() => issue(tenantA, { permissions: ["case:read", "case:*"] }));
    expect(error).toMatchObject({
      code: "API_KEY_SCOPE_INVALID",
      problem: "UNKNOWN_PERMISSION",
      permissions: ["case:*"],
    });
  });

  it("refuses an empty scope", async () => {
    const error = await rejectionOf(() => issue(tenantA, { permissions: [] }));
    expect(error).toMatchObject({ code: "API_KEY_SCOPE_INVALID", problem: "EMPTY" });
  });

  it("refuses a blank name and an invalid expiry", async () => {
    const blank = await rejectionOf(() =>
      db.withTenant(tenantA, (ctx) =>
        service.create(ctx, {
          name: "  ",
          permissions: SCOPE,
          createdByUserId: null,
          expiresAt: null,
          grantorPermissions: ADMIN,
        }),
      ),
    );
    expect(blank).toBeInstanceOf(ApiKeyInputError);
    expect(blank).toMatchObject({ code: "API_KEY_INPUT_INVALID", field: "name" });
    const invalidDate = await rejectionOf(() =>
      issue(tenantA, { expiresAt: new Date(Number.NaN) }),
    );
    expect(invalidDate).toMatchObject({ code: "API_KEY_INPUT_INVALID", field: "expiresAt" });
  });
});

describe("authenticate", () => {
  it("authenticates a fresh key and records its use", async () => {
    const issued = await issue(tenantA);
    const principal = await authenticate(issued.plaintext);
    expect(principal.tenantId).toBe(tenantA);
    expect(principal.apiKeyId).toBe(issued.key.id);
    expect([...principal.permissions].sort()).toEqual([...SCOPE].sort());
    expect((await storedRow(tenantA, issued.key.id)).lastUsedAt).toBeInstanceOf(Date);
  });

  it("fails identically for every kind of bad key, with no oracle", async () => {
    const good = await issue(tenantA);
    const parsed = parseApiKey(good.plaintext);
    if (parsed === null) return expect.unreachable("the issued key must parse");
    const tenantAHex = tenantA.replaceAll("-", "");
    const tenantBHex = tenantB.replaceAll("-", "");

    const wrongSecret = `${good.plaintext.slice(0, -43)}${generateApiKey(tenantA).plaintext.slice(-43)}`;

    const revoked = await issue(tenantA);
    await db.withTenant(tenantA, (ctx) => service.revoke(ctx, revoked.key.id));

    const expired = await issue(tenantA, { expiresAt: new Date(Date.now() - 60_000) });

    const rotatedAway = await issue(tenantA);
    await db.withTenant(tenantA, (ctx) =>
      service.rotate(ctx, rotatedAway.key.id, {
        overlapUntil: null,
        createdByUserId: null,
        grantorPermissions: ADMIN,
      }),
    );

    const neverStored = generateApiKey(tenantA).plaintext;
    const relabelledTenant = good.plaintext.replace(`ak_${tenantAHex}_`, `ak_${tenantBHex}_`);

    const failures = [
      await rejectionOf(() => authenticate(wrongSecret)),
      await rejectionOf(() => authenticate(revoked.plaintext)),
      await rejectionOf(() => authenticate(expired.plaintext)),
      await rejectionOf(() => authenticate(rotatedAway.plaintext)),
      await rejectionOf(() => authenticate(neverStored)),
      // Tenant A's key, with its tenant segment rewritten to tenant B.
      await rejectionOf(() => authenticate(relabelledTenant)),
      // Tenant A's key presented inside tenant B's context.
      await rejectionOf(() => authenticate(good.plaintext, tenantB)),
    ];
    for (const failure of failures) {
      expect(failure).toBeInstanceOf(ApiKeyAuthenticationError);
      expect(failure).toMatchObject({
        code: "API_KEY_INVALID",
        message: "The API key is invalid.",
      });
      expect(Object.keys(failure as object).sort()).toEqual(["code", "name"]);
    }

    // The good key still works, and none of the failures recorded a use on it.
    expect((await storedRow(tenantA, good.key.id)).lastUsedAt).toBeNull();
    expect((await authenticate(good.plaintext)).apiKeyId).toBe(good.key.id);
  });

  it("drops stored permissions that are not in the catalogue", async () => {
    // A permission retired from the catalogue must grant nothing.
    const legacy = await db.withTenant(tenantA, async ({ repos }) => {
      const generated = generateApiKey(tenantA);
      await repos.apiKeys.create({
        id: generated.id,
        name: "[legacy key]",
        keyPrefix: generated.keyPrefix,
        keyHash: generated.keyHash,
        createdByUserId: null,
        expiresAt: null,
        permissions: ["case:read", "retired:permission"] as unknown as Permission[],
        rotatedFromId: null,
      });
      return generated;
    });
    const principal = await authenticate(legacy.plaintext);
    expect([...principal.permissions]).toEqual(["case:read"]);
  });
});

describe("rotate", () => {
  it("without overlap: revokes the old key at once and issues its replacement", async () => {
    const old = await issue(tenantA, { expiresAt: new Date(Date.now() + 86_400_000) });
    const rotated = await db.withTenant(tenantA, (ctx) =>
      service.rotate(ctx, old.key.id, {
        overlapUntil: null,
        createdByUserId: null,
        grantorPermissions: ADMIN,
      }),
    );
    expect(rotated.key.id).not.toBe(old.key.id);
    expect(rotated.key).toMatchObject({
      name: old.key.name,
      permissions: old.key.permissions,
      rotatedFromId: old.key.id,
      expiresAt: old.key.expiresAt,
    });
    expect((await storedRow(tenantA, old.key.id)).revokedAt).toBeInstanceOf(Date);
    expect(await rejectionOf(() => authenticate(old.plaintext))).toBeInstanceOf(
      ApiKeyAuthenticationError,
    );
    expect((await authenticate(rotated.plaintext)).apiKeyId).toBe(rotated.key.id);
  });

  it("with overlap: keeps the old key usable until the overlap ends, then refuses it", async () => {
    const old = await issue(tenantA);
    const overlapUntil = new Date(Date.now() + 1_500);
    const rotated = await db.withTenant(tenantA, (ctx) =>
      service.rotate(ctx, old.key.id, {
        overlapUntil,
        createdByUserId: null,
        grantorPermissions: ADMIN,
      }),
    );
    const oldRow = await storedRow(tenantA, old.key.id);
    expect(oldRow.revokedAt).toBeNull();
    expect(oldRow.expiresAt?.getTime()).toBe(overlapUntil.getTime());

    expect((await authenticate(old.plaintext)).apiKeyId).toBe(old.key.id);
    expect((await authenticate(rotated.plaintext)).apiKeyId).toBe(rotated.key.id);

    await sleep(overlapUntil.getTime() - Date.now() + 250);
    expect(await rejectionOf(() => authenticate(old.plaintext))).toBeInstanceOf(
      ApiKeyAuthenticationError,
    );
    expect((await authenticate(rotated.plaintext)).apiKeyId).toBe(rotated.key.id);
  });

  it("never extends the old key's existing expiry", async () => {
    const soon = new Date(Date.now() + 60_000);
    const old = await issue(tenantA, { expiresAt: soon });
    await db.withTenant(tenantA, (ctx) =>
      service.rotate(ctx, old.key.id, {
        overlapUntil: new Date(Date.now() + 86_400_000),
        createdByUserId: null,
        grantorPermissions: ADMIN,
      }),
    );
    expect((await storedRow(tenantA, old.key.id)).expiresAt?.getTime()).toBe(soon.getTime());
  });

  it("refuses a revoked, unknown or other tenant's key", async () => {
    const revoked = await issue(tenantA);
    await db.withTenant(tenantA, (ctx) => service.revoke(ctx, revoked.key.id));
    const other = await issue(tenantB);
    const input = { overlapUntil: null, createdByUserId: null, grantorPermissions: ADMIN };

    for (const keyId of [revoked.key.id, other.key.id, generateApiKey(tenantA).id]) {
      const error = await rejectionOf(() =>
        db.withTenant(tenantA, (ctx) => service.rotate(ctx, keyId, input)),
      );
      expect(error).toBeInstanceOf(ApiKeyNotFoundError);
      expect(error).toMatchObject({ code: "API_KEY_NOT_FOUND" });
    }
    expect((await authenticate(other.plaintext)).apiKeyId).toBe(other.key.id);
  });

  it("refuses when the rotating principal no longer holds the key's scope, leaving the key intact", async () => {
    const old = await issue(tenantA, { permissions: ["case:read", "audit:read"] });
    const error = await rejectionOf(() =>
      db.withTenant(tenantA, (ctx) =>
        service.rotate(ctx, old.key.id, {
          overlapUntil: null,
          createdByUserId: null,
          grantorPermissions: ANALYST,
        }),
      ),
    );
    expect(error).toMatchObject({ code: "API_KEY_SCOPE_INVALID", permissions: ["audit:read"] });
    expect((await authenticate(old.plaintext)).apiKeyId).toBe(old.key.id);
  });
});

describe("revoke and list", () => {
  it("revokes once, and only within the key's own tenant", async () => {
    const issued = await issue(tenantA);
    expect(await db.withTenant(tenantB, (ctx) => service.revoke(ctx, issued.key.id))).toBeNull();
    expect((await authenticate(issued.plaintext)).apiKeyId).toBe(issued.key.id);

    const revoked = await db.withTenant(tenantA, (ctx) => service.revoke(ctx, issued.key.id));
    expect(revoked?.id).toBe(issued.key.id);
    expect(revoked?.revokedAt).toBeInstanceOf(Date);
    expect(await db.withTenant(tenantA, (ctx) => service.revoke(ctx, issued.key.id))).toBeNull();
  });

  it("lists only the tenant's own keys", async () => {
    const inA = await issue(tenantA);
    const inB = await issue(tenantB);
    const listedA = await db.withTenant(tenantA, (ctx) => service.list(ctx, { limit: 1000 }));
    const listedB = await db.withTenant(tenantB, (ctx) => service.list(ctx, { limit: 1000 }));
    expect(listedA.map((key) => key.id)).toContain(inA.key.id);
    expect(listedA.map((key) => key.id)).not.toContain(inB.key.id);
    expect(listedB.map((key) => key.id)).toContain(inB.key.id);
    expect(listedB.map((key) => key.id)).not.toContain(inA.key.id);
  });
});

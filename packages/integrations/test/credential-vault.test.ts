/**
 * The credential vault against a real database: envelope encryption at rest,
 * binding of every envelope to its tenant and credential, audited reads and
 * tenant isolation (CLAUDE.md §2, §9).
 */
import { randomBytes, randomUUID } from "node:crypto";
import type { TenantId } from "@repo/core";
import type { Credential, Database, TenantContext } from "@repo/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CredentialDecryptionError,
  CredentialInputError,
  CredentialNotFoundError,
  CredentialRevokedError,
  CredentialVault,
  MasterKey,
  MasterKeyMismatchError,
  SecretValue,
  type RevealRequest,
} from "../src/index.ts";
import { unwrapDataKey, wrapDataKey } from "../src/vault/master-key.ts";
import { openDatabase, provisionTenant, rejectionOf } from "./support.ts";

const KEY_ID = "test-master-key-a";
const PROVIDER = "test-provider";

const SYSTEM_REQUEST: RevealRequest = {
  purpose: "[test purpose]",
  actor: { kind: "SYSTEM" },
  authorization: { method: "SYSTEM", permission: null, sessionId: null },
  requestId: null,
};

const METADATA_KEYS = [
  "createdAt",
  "id",
  "label",
  "lastUsedAt",
  "masterKeyVersion",
  "provider",
  "revokedAt",
];

let db: Database;
let tenantA: TenantId;
let tenantB: TenantId;
let keyBase64: string;
let vault: CredentialVault;

beforeAll(async () => {
  db = openDatabase();
  tenantA = await provisionTenant(db, "vault-a");
  tenantB = await provisionTenant(db, "vault-b");
  keyBase64 = randomBytes(32).toString("base64");
  vault = new CredentialVault(new MasterKey({ keyId: KEY_ID, keyBase64 }));
});

afterAll(async () => {
  await db.close();
});

function newSecret(): string {
  return `[secret ${randomUUID()}]`;
}

async function storeIn(tenantId: TenantId, secret: string, provider: string = PROVIDER) {
  return db.withTenant(tenantId, (ctx) =>
    vault.store(ctx, { provider, label: "[test label]", secret }),
  );
}

async function rowOf(tenantId: TenantId, id: string): Promise<Credential> {
  const row = await db.withTenant(tenantId, ({ repos }) => repos.credentials.findById(id));
  if (row === null) return expect.unreachable("the stored credential row is missing");
  return row;
}

async function reveal(
  tenantId: TenantId,
  id: string,
  using: CredentialVault = vault,
): Promise<string> {
  const secret = await db.withTenant(tenantId, (ctx) => using.reveal(ctx, id, SYSTEM_REQUEST));
  return secret.expose();
}

/** Inserts a credential row directly: already-encrypted material, as an attacker with DB write might. */
async function insertRow(
  ctx: TenantContext,
  row: Pick<Credential, "ciphertext" | "encryptedDataKey" | "masterKeyVersion" | "provider"> & {
    readonly id: string;
  },
): Promise<void> {
  await ctx.repos.credentials.create({
    id: row.id,
    provider: row.provider,
    label: "[moved label]",
    ciphertext: row.ciphertext,
    encryptedDataKey: row.encryptedDataKey,
    masterKeyVersion: row.masterKeyVersion,
  });
}

function flipped(bytes: Uint8Array, index: number): Buffer {
  const copy = Buffer.from(bytes);
  copy[index] = copy.readUInt8(index) ^ 0x80;
  return copy;
}

describe("storing and revealing", () => {
  it("round-trips a secret and returns metadata", async () => {
    const secret = newSecret();
    const stored = await storeIn(tenantA, secret);
    expect(stored.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(stored.provider).toBe(PROVIDER);
    expect(stored.label).toBe("[test label]");
    expect(stored.masterKeyVersion).toBe(KEY_ID);
    expect(stored.createdAt).toBeInstanceOf(Date);
    expect(stored.lastUsedAt).toBeNull();
    expect(stored.revokedAt).toBeNull();

    const revealed = await db.withTenant(tenantA, (ctx) =>
      vault.reveal(ctx, stored.id, SYSTEM_REQUEST),
    );
    expect(revealed).toBeInstanceOf(SecretValue);
    expect(revealed.expose()).toBe(secret);
  });

  it("round-trips non-ASCII secrets exactly", async () => {
    const secret = `[secret ${randomUUID()}] é中\u{1f511}`;
    const stored = await storeIn(tenantA, secret);
    expect(await reveal(tenantA, stored.id)).toBe(secret);
  });

  it("stores only ciphertext, in the documented format", async () => {
    const secret = newSecret();
    const stored = await storeIn(tenantA, secret);
    const row = await rowOf(tenantA, stored.id);
    const ciphertext = Buffer.from(row.ciphertext);
    const wrappedKey = Buffer.from(row.encryptedDataKey);
    const plaintext = Buffer.from(secret, "utf8");
    const master = Buffer.from(keyBase64, "base64");

    for (const blob of [ciphertext, wrappedKey]) {
      expect(blob.includes(plaintext)).toBe(false);
      expect(blob.includes(Buffer.from(secret.slice(1, 17), "utf8"))).toBe(false);
      expect(blob.includes(master)).toBe(false);
      expect(blob.toString("latin1")).not.toContain(keyBase64);
      expect(blob[0]).toBe(0x01);
    }
    expect(ciphertext.byteLength).toBe(1 + 12 + 16 + plaintext.byteLength);
    expect(wrappedKey.byteLength).toBe(1 + 12 + 16 + 32);
    expect(row.masterKeyVersion).toBe(KEY_ID);
  });

  it("produces different ciphertext and data keys for the same secret stored twice", async () => {
    const secret = newSecret();
    const first = await rowOf(tenantA, (await storeIn(tenantA, secret)).id);
    const second = await rowOf(tenantA, (await storeIn(tenantA, secret)).id);
    expect(Buffer.from(first.ciphertext).equals(Buffer.from(second.ciphertext))).toBe(false);
    expect(Buffer.from(first.encryptedDataKey).equals(Buffer.from(second.encryptedDataKey))).toBe(
      false,
    );
  });

  it("returns metadata only from store and list: no secret, no ciphertext, no data key", async () => {
    const secret = newSecret();
    const stored = await storeIn(tenantA, secret);
    const listed = await db.withTenant(tenantA, (ctx) => vault.list(ctx, { limit: 1000 }));
    const listedEntry = listed.find((entry) => entry.id === stored.id);
    expect(listedEntry).toEqual(stored);

    const row = await rowOf(tenantA, stored.id);
    const forbidden = [
      secret,
      Buffer.from(row.ciphertext).toString("base64"),
      Buffer.from(row.ciphertext).toString("hex"),
      Buffer.from(row.encryptedDataKey).toString("base64"),
      Buffer.from(row.encryptedDataKey).toString("hex"),
      "ciphertext",
      "encryptedDataKey",
    ];
    for (const serialized of [JSON.stringify(stored), JSON.stringify(listed)]) {
      for (const needle of forbidden) expect(serialized).not.toContain(needle);
    }
    expect(Object.keys(stored).sort()).toEqual(METADATA_KEYS);
    for (const entry of listed) expect(Object.keys(entry).sort()).toEqual(METADATA_KEYS);
  });
});

describe("envelope binding: ciphertext moved or altered is refused", () => {
  it("refuses a row copied to another credential id", async () => {
    const original = await rowOf(tenantA, (await storeIn(tenantA, newSecret())).id);
    const error = await rejectionOf(() =>
      db.withTenant(tenantA, async (ctx) => {
        const movedId = randomUUID();
        await insertRow(ctx, { ...original, id: movedId });
        return vault.reveal(ctx, movedId, SYSTEM_REQUEST);
      }),
    );
    expect(error).toBeInstanceOf(CredentialDecryptionError);
  });

  it("refuses the sealed secret under another credential id even with a correctly re-wrapped data key", async () => {
    const master = new MasterKey({ keyId: KEY_ID, keyBase64 });
    const original = await rowOf(tenantA, (await storeIn(tenantA, newSecret())).id);
    const movedId = randomUUID();
    const dataKey = unwrapDataKey(
      master,
      original.encryptedDataKey,
      `data-key:v1:${tenantA}:${original.id}:${KEY_ID}`,
    );
    const rewrapped = wrapDataKey(master, dataKey, `data-key:v1:${tenantA}:${movedId}:${KEY_ID}`);
    const error = await rejectionOf(() =>
      db.withTenant(tenantA, async (ctx) => {
        await insertRow(ctx, { ...original, id: movedId, encryptedDataKey: rewrapped });
        return vault.reveal(ctx, movedId, SYSTEM_REQUEST);
      }),
    );
    expect(error).toBeInstanceOf(CredentialDecryptionError);
    expect((error as CredentialDecryptionError).stage).toBe("SECRET");
  });

  it("refuses the sealed secret under another provider", async () => {
    const original = await rowOf(tenantA, (await storeIn(tenantA, newSecret())).id);
    const error = await rejectionOf(() =>
      db.withTenant(tenantA, async (ctx) => {
        // Same id is impossible in one tenant, so re-bind the data key to a new id
        // and change only the provider on top of that.
        const master = new MasterKey({ keyId: KEY_ID, keyBase64 });
        const movedId = randomUUID();
        const dataKey = unwrapDataKey(
          master,
          original.encryptedDataKey,
          `data-key:v1:${tenantA}:${original.id}:${KEY_ID}`,
        );
        await insertRow(ctx, {
          ...original,
          id: movedId,
          provider: "other-provider",
          encryptedDataKey: wrapDataKey(
            master,
            dataKey,
            `data-key:v1:${tenantA}:${movedId}:${KEY_ID}`,
          ),
        });
        return vault.reveal(ctx, movedId, SYSTEM_REQUEST);
      }),
    );
    expect(error).toBeInstanceOf(CredentialDecryptionError);
    expect((error as CredentialDecryptionError).stage).toBe("SECRET");
  });

  it("refuses a row copied into another tenant under the same id", async () => {
    const original = await rowOf(tenantA, (await storeIn(tenantA, newSecret())).id);
    const error = await rejectionOf(() =>
      db.withTenant(tenantB, async (ctx) => {
        await insertRow(ctx, original);
        return vault.reveal(ctx, original.id, SYSTEM_REQUEST);
      }),
    );
    expect(error).toBeInstanceOf(CredentialDecryptionError);
  });

  it("refuses a flipped byte anywhere in either envelope", async () => {
    const original = await rowOf(tenantA, (await storeIn(tenantA, newSecret())).id);
    const lastCipherByte = original.ciphertext.byteLength - 1;
    const lastKeyByte = original.encryptedDataKey.byteLength - 1;
    const cases = [
      ...[0, 1, 12, 13, 28, 29, lastCipherByte].map((index) => ({
        ciphertext: flipped(original.ciphertext, index),
        encryptedDataKey: Buffer.from(original.encryptedDataKey),
      })),
      ...[0, 1, 12, 13, 28, 29, lastKeyByte].map((index) => ({
        ciphertext: Buffer.from(original.ciphertext),
        encryptedDataKey: flipped(original.encryptedDataKey, index),
      })),
    ];
    for (const tampered of cases) {
      const error = await rejectionOf(() =>
        db.withTenant(tenantA, async (ctx) => {
          const id = randomUUID();
          await insertRow(ctx, { ...original, ...tampered, id });
          return vault.reveal(ctx, id, SYSTEM_REQUEST);
        }),
      );
      expect(error).toBeInstanceOf(CredentialDecryptionError);
    }
  });

  it("refuses a different master key under the same key id", async () => {
    const stored = await storeIn(tenantA, newSecret());
    const impostor = new CredentialVault(
      new MasterKey({ keyId: KEY_ID, keyBase64: randomBytes(32).toString("base64") }),
    );
    const error = await rejectionOf(() => reveal(tenantA, stored.id, impostor));
    expect(error).toBeInstanceOf(CredentialDecryptionError);
    expect((error as CredentialDecryptionError).stage).toBe("DATA_KEY");
  });

  it("reports a different master key id as a mismatch, before any decryption", async () => {
    const stored = await storeIn(tenantA, newSecret());
    const rotated = new CredentialVault(new MasterKey({ keyId: "test-master-key-b", keyBase64 }));
    const error = await rejectionOf(() => reveal(tenantA, stored.id, rotated));
    expect(error).toBeInstanceOf(MasterKeyMismatchError);
    expect(error).toMatchObject({
      code: "VAULT_MASTER_KEY_MISMATCH",
      storedKeyId: KEY_ID,
      currentKeyId: "test-master-key-b",
    });
  });
});

describe("every read is audited", () => {
  async function credentialReads(tenantId: TenantId, credentialId: string) {
    const entries = await db.withTenant(tenantId, ({ repos }) =>
      repos.auditLog.list({ limit: 1000 }),
    );
    return entries.filter(
      (entry) => entry.action === "credential.read" && entry.targetId === credentialId,
    );
  }

  it("writes exactly one credential.read entry per reveal, without the secret", async () => {
    const secret = newSecret();
    const stored = await storeIn(tenantA, secret);
    expect(await credentialReads(tenantA, stored.id)).toHaveLength(0);

    const userId = randomUUID();
    const sessionId = randomUUID();
    const requestId = `[request ${randomUUID()}]`;
    const revealed = await db.withTenant(tenantA, (ctx) =>
      vault.reveal(ctx, stored.id, {
        purpose: "[verify provider connection]",
        actor: { kind: "USER", userId },
        authorization: { method: "SESSION", permission: "credential:read", sessionId },
        requestId,
      }),
    );
    expect(revealed.expose()).toBe(secret);

    const entries = await credentialReads(tenantA, stored.id);
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry).toMatchObject({
      tenantId: tenantA,
      actorKind: "USER",
      actorUserId: userId,
      actorApiKeyId: null,
      action: "credential.read",
      targetType: "credential",
      targetId: stored.id,
      details: { purpose: "[verify provider connection]", provider: PROVIDER },
      authMethod: "SESSION",
      permission: "credential:read",
      sessionId,
      outcome: "ALLOWED",
      requestId,
    });
    expect(JSON.stringify(entry)).not.toContain(secret);
  });

  it("writes the audit entry before decrypting: it exists even when decryption then fails", async () => {
    const original = await rowOf(tenantA, (await storeIn(tenantA, newSecret())).id);
    const tamperedId = randomUUID();
    const outcome = await db.withTenant(tenantA, async (ctx) => {
      await insertRow(ctx, {
        ...original,
        id: tamperedId,
        ciphertext: flipped(original.ciphertext, 40),
      });
      const error = await rejectionOf(() => vault.reveal(ctx, tamperedId, SYSTEM_REQUEST));
      const reads = (await ctx.repos.auditLog.list({ limit: 1000 })).filter(
        (entry) => entry.action === "credential.read" && entry.targetId === tamperedId,
      );
      return { error, reads: reads.length };
    });
    expect(outcome.error).toBeInstanceOf(CredentialDecryptionError);
    expect(outcome.reads).toBe(1);
  });

  it("writes no audit entry and reveals nothing for a revoked credential", async () => {
    const stored = await storeIn(tenantA, newSecret());
    const revoked = await db.withTenant(tenantA, (ctx) => vault.revoke(ctx, stored.id));
    expect(revoked?.id).toBe(stored.id);
    expect(revoked?.revokedAt).toBeInstanceOf(Date);
    expect(await db.withTenant(tenantA, (ctx) => vault.revoke(ctx, stored.id))).toBeNull();

    const error = await rejectionOf(() => reveal(tenantA, stored.id));
    expect(error).toBeInstanceOf(CredentialRevokedError);
    expect(error).toMatchObject({ code: "CREDENTIAL_REVOKED" });
    expect(await credentialReads(tenantA, stored.id)).toHaveLength(0);
  });
});

describe("tenant isolation", () => {
  it("tenant A cannot reveal, revoke or list tenant B's credential", async () => {
    const secret = newSecret();
    const stored = await storeIn(tenantB, secret);

    const error = await rejectionOf(() => reveal(tenantA, stored.id));
    expect(error).toBeInstanceOf(CredentialNotFoundError);
    expect(error).toMatchObject({ code: "CREDENTIAL_NOT_FOUND" });
    const unknown = await rejectionOf(() => reveal(tenantA, randomUUID()));
    expect(unknown).toBeInstanceOf(CredentialNotFoundError);
    expect((unknown as Error).message).toBe((error as Error).message);

    expect(await db.withTenant(tenantA, (ctx) => vault.revoke(ctx, stored.id))).toBeNull();
    const listedInA = await db.withTenant(tenantA, (ctx) => vault.list(ctx, { limit: 1000 }));
    expect(listedInA.map((entry) => entry.id)).not.toContain(stored.id);

    expect(await reveal(tenantB, stored.id)).toBe(secret);
  });
});

describe("input validation", () => {
  const invalid: readonly [string, { provider: string; label: string; secret: string }, string][] =
    [
      ["an uppercase provider", { provider: "Provider", label: "[l]", secret: "[s]" }, "provider"],
      ["a provider with a colon", { provider: "a:b", label: "[l]", secret: "[s]" }, "provider"],
      ["an empty provider", { provider: "", label: "[l]", secret: "[s]" }, "provider"],
      ["a blank label", { provider: PROVIDER, label: "   ", secret: "[s]" }, "label"],
      ["an empty secret", { provider: PROVIDER, label: "[l]", secret: "" }, "secret"],
      ["a lone surrogate", { provider: PROVIDER, label: "[l]", secret: "[s]\ud800" }, "secret"],
    ];

  it.each(invalid)("refuses %s", async (_label, input, field) => {
    const error = await rejectionOf(() => db.withTenant(tenantA, (ctx) => vault.store(ctx, input)));
    expect(error).toBeInstanceOf(CredentialInputError);
    expect(error).toMatchObject({ code: "CREDENTIAL_INPUT_INVALID", field });
    if (input.secret.length > 0) expect((error as Error).message).not.toContain(input.secret);
  });

  it("refuses a reveal with a blank purpose, before reading anything", async () => {
    const stored = await storeIn(tenantA, newSecret());
    const error = await rejectionOf(() =>
      db.withTenant(tenantA, (ctx) =>
        vault.reveal(ctx, stored.id, { ...SYSTEM_REQUEST, purpose: " " }),
      ),
    );
    expect(error).toMatchObject({ code: "CREDENTIAL_INPUT_INVALID", field: "purpose" });
  });
});

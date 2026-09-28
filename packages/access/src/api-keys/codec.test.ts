import { createHash, randomUUID } from "node:crypto";
import { parseTenantId } from "@repo/core";
import { describe, expect, it } from "vitest";
import { generateApiKey, hashApiKeySecret, parseApiKey, secretMatches } from "../index.ts";

const tenantId = parseTenantId(randomUUID());

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

describe("generateApiKey", () => {
  it("produces the documented format, and parses back to its parts", () => {
    const key = generateApiKey(tenantId);
    const tenantHex = tenantId.replaceAll("-", "");
    const keyHex = key.id.replaceAll("-", "");
    expect(key.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(key.plaintext).toMatch(new RegExp(`^ak_${tenantHex}_${keyHex}_[A-Za-z0-9_-]{43}$`, "u"));
    expect(key.plaintext).toHaveLength(112);

    const parsed = parseApiKey(key.plaintext);
    if (parsed === null) return expect.unreachable("a generated key must parse");
    expect(parsed.tenantId).toBe(tenantId);
    expect(parsed.keyId).toBe(key.id);
    expect(parsed.secret).toBe(key.plaintext.slice(-43));
    expect(Buffer.from(parsed.secret, "base64url")).toHaveLength(32);
  });

  it("derives a displayable prefix from the key id", () => {
    const key = generateApiKey(tenantId);
    expect(key.keyPrefix).toBe(`ak_${key.id.replaceAll("-", "").slice(0, 12)}`);
    expect(key.keyPrefix).toMatch(/^[A-Za-z0-9_-]{6,32}$/);
  });

  it("stores the SHA-256 of the secret alone, never of the whole key", () => {
    const key = generateApiKey(tenantId);
    const secret = key.plaintext.slice(-43);
    expect(key.keyHash).toBe(sha256Hex(secret));
    expect(key.keyHash).toBe(hashApiKeySecret(secret));
    expect(key.keyHash).not.toBe(sha256Hex(key.plaintext));
    expect(key.keyHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never repeats an id or a secret", () => {
    const keys = Array.from({ length: 50 }, () => generateApiKey(tenantId));
    expect(new Set(keys.map((key) => key.id)).size).toBe(50);
    expect(new Set(keys.map((key) => key.plaintext.slice(-43))).size).toBe(50);
  });
});

describe("parseApiKey", () => {
  const valid = generateApiKey(tenantId).plaintext;
  // Sliced by position: a base64url secret may itself contain "_".
  const tenantHex = valid.slice(3, 35);
  const keyHex = valid.slice(36, 68);
  const tail = valid.slice(69);

  const malformed: readonly [string, string][] = [
    ["an empty string", ""],
    ["leading whitespace", ` ${valid}`],
    ["trailing whitespace", `${valid} `],
    ["a trailing newline", `${valid}\n`],
    ["an uppercase prefix", `AK_${valid.slice(3)}`],
    ["another prefix", `sk_${valid.slice(3)}`],
    ["uppercase tenant hex", `ak_${tenantHex.toUpperCase()}_${keyHex}_${tail}`],
    ["uppercase key hex", `ak_${tenantHex}_${keyHex.toUpperCase()}_${tail}`],
    ["a short tenant id", `ak_${tenantHex.slice(1)}_${keyHex}_${tail}`],
    ["a long key id", `ak_${tenantHex}_${keyHex}0_${tail}`],
    ["a dashed tenant id", `ak_${tenantId}_${keyHex}_${tail}`],
    ["a non-hex tenant id", `ak_g${tenantHex.slice(1)}_${keyHex}_${tail}`],
    ["a short secret", valid.slice(0, -1)],
    ["a long secret", `${valid}A`],
    ["a padded secret", `${valid.slice(0, -1)}=`],
    ["a standard-base64 secret", `${valid.slice(0, -2)}+${valid.slice(-1)}`],
    ["a non-canonical final character", `${valid.slice(0, -1)}B`],
    ["a missing separator", valid.replace(`_${keyHex}_`, `${keyHex}_`)],
  ];

  it("accepts the valid key used to build the variants", () => {
    expect(parseApiKey(`ak_${tenantHex}_${keyHex}_${tail}`)).not.toBeNull();
    expect(tail).toHaveLength(43);
  });

  it.each(malformed)("rejects %s", (_label, text) => {
    expect(parseApiKey(text)).toBeNull();
  });

  it("rejects values that are not strings", () => {
    expect(parseApiKey(undefined as unknown as string)).toBeNull();
    expect(parseApiKey(42 as unknown as string)).toBeNull();
  });
});

describe("secretMatches", () => {
  it("matches only the secret the hash was made from", () => {
    const key = generateApiKey(tenantId);
    const secret = key.plaintext.slice(-43);
    expect(secretMatches(secret, key.keyHash)).toBe(true);
    expect(secretMatches(generateApiKey(tenantId).plaintext.slice(-43), key.keyHash)).toBe(false);
    expect(secretMatches(key.plaintext, key.keyHash)).toBe(false);
  });

  it("returns false, without throwing, for a malformed stored hash", () => {
    const key = generateApiKey(tenantId);
    const secret = key.plaintext.slice(-43);
    expect(secretMatches(secret, key.keyHash.toUpperCase())).toBe(false);
    expect(secretMatches(secret, key.keyHash.slice(2))).toBe(false);
    expect(secretMatches(secret, `${key.keyHash}00`)).toBe(false);
    expect(secretMatches(secret, "")).toBe(false);
  });

  it("returns false when no key was found, even for the one secret whose hash it compares against", () => {
    const key = generateApiKey(tenantId);
    expect(secretMatches(key.plaintext.slice(-43), null)).toBe(false);
    // The stand-in hash is the empty string's; a null stored hash never matches it.
    expect(secretMatches("", null)).toBe(false);
    expect(hashApiKeySecret("")).toBe(sha256Hex(""));
  });
});

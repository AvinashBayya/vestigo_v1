/**
 * API key wire format:
 *
 *   ak_<tenant id: 32 lowercase hex>_<key id: 32 lowercase hex>_<secret>
 *
 * The secret is 32 random bytes as unpadded base64url (43 characters). The
 * tenant id lets the server open the right tenant context before any lookup;
 * the key id finds the row; only a SHA-256 of the secret is stored. A 256-bit
 * random secret needs no slow hash.
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { parseTenantId, type TenantId } from "@repo/core";

export interface GeneratedApiKey {
  /** The key's row id (UUID form). */
  readonly id: string;
  /** The full key. Shown to its owner exactly once; never stored. */
  readonly plaintext: string;
  /** `ak_` and the first 12 hex digits of the key id: safe to display. */
  readonly keyPrefix: string;
  /** Lowercase hex SHA-256 of the secret. */
  readonly keyHash: string;
}

export interface ParsedApiKey {
  readonly tenantId: TenantId;
  /** UUID form. */
  readonly keyId: string;
  readonly secret: string;
}

const SECRET_BYTES = 32;
/**
 * The whole key, anchored. The secret's final character carries 4 data bits
 * and 2 zero bits, so only 16 characters can end a canonical encoding.
 */
const API_KEY = /^ak_([0-9a-f]{32})_([0-9a-f]{32})_([A-Za-z0-9_-]{42}[AEIMQUYcgkosw048])$/;
const API_KEY_LENGTH = 112;
const SHA256_HEX = /^[0-9a-f]{64}$/;

function hex(uuid: string): string {
  return uuid.replaceAll("-", "");
}

function uuidOf(hex32: string): string {
  return [
    hex32.slice(0, 8),
    hex32.slice(8, 12),
    hex32.slice(12, 16),
    hex32.slice(16, 20),
    hex32.slice(20),
  ].join("-");
}

export function hashApiKeySecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function generateApiKey(tenantId: TenantId): GeneratedApiKey {
  const id = randomUUID();
  const keyHex = hex(id);
  const secret = randomBytes(SECRET_BYTES).toString("base64url");
  return {
    id,
    plaintext: `ak_${hex(tenantId)}_${keyHex}_${secret}`,
    keyPrefix: `ak_${keyHex.slice(0, 12)}`,
    keyHash: hashApiKeySecret(secret),
  };
}

/** Parses a presented key. Null for anything that is not exactly the format. */
export function parseApiKey(text: string): ParsedApiKey | null {
  const value: unknown = text;
  if (typeof value !== "string" || value.length !== API_KEY_LENGTH) return null;
  const match = API_KEY.exec(value);
  if (match === null) return null;
  const [, tenantHex, keyHex, secret] = match;
  if (tenantHex === undefined || keyHex === undefined || secret === undefined) return null;
  return { tenantId: parseTenantId(uuidOf(tenantHex)), keyId: uuidOf(keyHex), secret };
}

/**
 * Compared against when no key was found, so an unknown key costs the same
 * hash-and-compare as a wrong secret. Only the empty string hashes to it, and
 * parseApiKey never yields an empty secret.
 */
const UNMATCHABLE_HASH = hashApiKeySecret("");

/**
 * Constant-time comparison of a presented secret against a stored hash. Pass
 * null when no key was found: the same work is done and the answer is false,
 * so response timing does not reveal whether a key id exists.
 */
export function secretMatches(secret: string, keyHash: string | null): boolean {
  const stored = keyHash === null ? UNMATCHABLE_HASH : keyHash;
  if (!SHA256_HEX.test(stored)) return false;
  const presented = createHash("sha256").update(secret, "utf8").digest();
  return timingSafeEqual(presented, Buffer.from(stored, "hex")) && keyHash !== null;
}

/**
 * AES-256-GCM envelopes. Byte format, for both the sealed secret and the
 * wrapped data key:
 *
 *   1 byte version (0x01) | 12-byte IV | 16-byte auth tag | ciphertext
 *
 * The associated data binds each envelope to where it belongs (tenant,
 * credential id, provider or master key id), so an envelope copied anywhere
 * else fails authentication instead of decrypting.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { CredentialDecryptionError, type DecryptionStage } from "./errors.ts";

export const ENVELOPE_VERSION = 0x01;
export const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = 1 + IV_BYTES + TAG_BYTES;
const CIPHER = "aes-256-gcm";

export function seal(key: Uint8Array, plaintext: Uint8Array, aad: string): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(CIPHER, key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([Buffer.of(ENVELOPE_VERSION), iv, cipher.getAuthTag(), body]);
}

/**
 * Opens an envelope, or throws CredentialDecryptionError. Unauthenticated
 * plaintext is zeroed before the error is thrown and is never returned.
 */
export function open(
  key: Uint8Array,
  envelope: Uint8Array,
  aad: string,
  stage: DecryptionStage,
): Buffer {
  if (envelope.byteLength < HEADER_BYTES || envelope[0] !== ENVELOPE_VERSION) {
    throw new CredentialDecryptionError(stage);
  }
  const bytes = Buffer.from(envelope.buffer, envelope.byteOffset, envelope.byteLength);
  const iv = bytes.subarray(1, 1 + IV_BYTES);
  const tag = bytes.subarray(1 + IV_BYTES, HEADER_BYTES);
  const body = bytes.subarray(HEADER_BYTES);

  const decipher = createDecipheriv(CIPHER, key, iv, { authTagLength: TAG_BYTES });
  decipher.setAuthTag(tag);
  decipher.setAAD(Buffer.from(aad, "utf8"));
  const head = decipher.update(body);
  let tail: Buffer;
  try {
    tail = decipher.final();
  } catch {
    head.fill(0);
    throw new CredentialDecryptionError(stage);
  }
  if (tail.byteLength === 0) return head;
  const plaintext = Buffer.concat([head, tail]);
  head.fill(0);
  tail.fill(0);
  return plaintext;
}

import { inspect } from "node:util";
import { InvalidMasterKeyError } from "./errors.ts";
import { KEY_BYTES, open, seal } from "./envelope.ts";

const KEY_ID = /^[A-Za-z0-9._-]{1,64}$/;
/** Padded base64, standard alphabet. Checked before decoding: Node's decoder skips junk. */
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
/** Longer input than any 32-byte key encodes to is refused before any regex runs. */
const MAX_ENCODED_LENGTH = 256;

/**
 * Reads a MasterKey's bytes. Assigned once, by the class's static block, and
 * used only by the two functions below; the bytes never leave this module.
 */
let keyBytesOf: (key: MasterKey) => Buffer;

/**
 * The vault master key: wraps the per-credential data keys. In production it
 * comes from the secret manager through the environment, never from a file.
 *
 * The key bytes live in a #private field. They cannot be read as a property,
 * and `String()`, `JSON.stringify` and `util.inspect` print a redaction.
 */
export class MasterKey {
  readonly keyId: string;
  readonly #key: Buffer;

  static {
    keyBytesOf = (key) => key.#key;
  }

  constructor(input: { readonly keyId: string; readonly keyBase64: string }) {
    // Widened to unknown: a caller outside the type system (or a missing
    // environment variable) must be refused, not coerced to "undefined".
    const keyId: unknown = input.keyId;
    const encoded: unknown = input.keyBase64;
    if (typeof keyId !== "string" || !KEY_ID.test(keyId)) {
      throw new InvalidMasterKeyError("KEY_ID_FORMAT");
    }
    if (typeof encoded !== "string" || encoded.length > MAX_ENCODED_LENGTH) {
      throw new InvalidMasterKeyError("KEY_LENGTH");
    }
    if (!BASE64.test(encoded)) throw new InvalidMasterKeyError("KEY_NOT_BASE64");
    const key = Buffer.from(encoded, "base64");
    if (key.byteLength !== KEY_BYTES) {
      key.fill(0);
      throw new InvalidMasterKeyError("KEY_LENGTH");
    }
    // Non-zero padding bits decode, but are not the canonical encoding.
    if (key.toString("base64") !== encoded) {
      key.fill(0);
      throw new InvalidMasterKeyError("KEY_NOT_BASE64");
    }
    this.keyId = keyId;
    this.#key = key;
  }

  toString(): string {
    return `[redacted master key ${this.keyId}]`;
  }

  toJSON(): string {
    return this.toString();
  }

  [inspect.custom](): string {
    return this.toString();
  }
}

/** Seals a data key under the master key. Package-internal. */
export function wrapDataKey(masterKey: MasterKey, dataKey: Uint8Array, aad: string): Buffer {
  return seal(keyBytesOf(masterKey), dataKey, aad);
}

/** Opens a wrapped data key, or throws CredentialDecryptionError. Package-internal. */
export function unwrapDataKey(masterKey: MasterKey, wrapped: Uint8Array, aad: string): Buffer {
  return open(keyBytesOf(masterKey), wrapped, aad, "DATA_KEY");
}

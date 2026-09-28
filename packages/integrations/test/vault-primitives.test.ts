/**
 * Unit tests for the vault's building blocks: the master key, the redacting
 * secret wrapper, and the AES-256-GCM envelope. No database.
 */
import { randomBytes } from "node:crypto";
import { format, inspect } from "node:util";
import { describe, expect, it } from "vitest";
import {
  CredentialDecryptionError,
  CredentialVault,
  InvalidMasterKeyError,
  MasterKey,
  SecretValue,
  type InvalidMasterKeyReason,
} from "../src/index.ts";
import { ENVELOPE_VERSION, open, seal } from "../src/vault/envelope.ts";
import { unwrapDataKey, wrapDataKey } from "../src/vault/master-key.ts";

const KEY_ID = "test.master-key_1";

function freshKeyMaterial(): { readonly base64: string; readonly hex: string } {
  const bytes = randomBytes(32);
  return { base64: bytes.toString("base64"), hex: bytes.toString("hex") };
}

/** Every way a value could reach a log line or a response body. */
function renderings(value: unknown): string[] {
  return [
    String(value),
    format("%s %o %O %j", value, value, value, value),
    JSON.stringify(value),
    JSON.stringify({ nested: value }),
    inspect(value),
    inspect({ nested: value }, { depth: 10 }),
    inspect(value, { showHidden: true, depth: 10 }),
  ];
}

function expectAbsent(haystacks: readonly string[], needles: readonly string[]): void {
  for (const haystack of haystacks) {
    for (const needle of needles) expect(haystack).not.toContain(needle);
  }
}

describe("MasterKey", () => {
  it("accepts canonical base64 of exactly 32 bytes and keeps its id", () => {
    const material = freshKeyMaterial();
    const key = new MasterKey({ keyId: KEY_ID, keyBase64: material.base64 });
    expect(key.keyId).toBe(KEY_ID);
    expect(Object.keys(key)).toEqual(["keyId"]);
  });

  it("never renders its key material, however it is printed", () => {
    const material = freshKeyMaterial();
    const key = new MasterKey({ keyId: KEY_ID, keyBase64: material.base64 });
    const printed = renderings(key);
    expectAbsent(printed, [material.base64, material.hex, material.hex.toUpperCase()]);
    expect(String(key)).toBe(`[redacted master key ${KEY_ID}]`);
    expect(JSON.stringify(key)).toBe(JSON.stringify(`[redacted master key ${KEY_ID}]`));
    expect(inspect(key)).toBe(`[redacted master key ${KEY_ID}]`);
  });

  const valid = freshKeyMaterial().base64;
  const refused: readonly [string, { keyId: string; keyBase64: string }, InvalidMasterKeyReason][] =
    [
      ["16 bytes", { keyId: KEY_ID, keyBase64: randomBytes(16).toString("base64") }, "KEY_LENGTH"],
      ["33 bytes", { keyId: KEY_ID, keyBase64: randomBytes(33).toString("base64") }, "KEY_LENGTH"],
      ["an empty key", { keyId: KEY_ID, keyBase64: "" }, "KEY_LENGTH"],
      ["an oversized value", { keyId: KEY_ID, keyBase64: "A".repeat(4096) }, "KEY_LENGTH"],
      [
        "characters outside base64",
        { keyId: KEY_ID, keyBase64: `${valid.slice(0, 40)}!!!=` },
        "KEY_NOT_BASE64",
      ],
      [
        "base64url characters",
        { keyId: KEY_ID, keyBase64: valid.replace(/.{4}$/, "-_A=") },
        "KEY_NOT_BASE64",
      ],
      ["missing padding", { keyId: KEY_ID, keyBase64: valid.slice(0, 43) }, "KEY_NOT_BASE64"],
      ["surrounding whitespace", { keyId: KEY_ID, keyBase64: ` ${valid}\n` }, "KEY_NOT_BASE64"],
      [
        "non-zero padding bits",
        { keyId: KEY_ID, keyBase64: `${valid.slice(0, 42)}B=` },
        "KEY_NOT_BASE64",
      ],
      ["an empty key id", { keyId: "", keyBase64: valid }, "KEY_ID_FORMAT"],
      ["a key id with a space", { keyId: "key one", keyBase64: valid }, "KEY_ID_FORMAT"],
      ["a key id with a colon", { keyId: "key:one", keyBase64: valid }, "KEY_ID_FORMAT"],
      ["a 65-character key id", { keyId: "k".repeat(65), keyBase64: valid }, "KEY_ID_FORMAT"],
      [
        "a missing key id",
        { keyId: undefined as unknown as string, keyBase64: valid },
        "KEY_ID_FORMAT",
      ],
      ["a missing key", { keyId: KEY_ID, keyBase64: undefined as unknown as string }, "KEY_LENGTH"],
    ];

  it.each(refused)("refuses %s without echoing the input", (_label, input, reason) => {
    let caught: unknown;
    try {
      new MasterKey(input);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(InvalidMasterKeyError);
    const error = caught as InvalidMasterKeyError;
    expect(error.code).toBe("VAULT_MASTER_KEY_INVALID");
    expect(error.reason).toBe(reason);
    const printed = [error.message, String(error.stack), inspect(error), JSON.stringify(error)];
    if (typeof input.keyBase64 === "string" && input.keyBase64.trim().length > 0) {
      expectAbsent(printed, [input.keyBase64.trim()]);
    }
    if (typeof input.keyId === "string" && input.keyId.length > 0) {
      expectAbsent(printed, [input.keyId]);
    }
  });
});

describe("SecretValue", () => {
  it("returns the plaintext only through expose()", () => {
    const secret = `[secret ${randomBytes(8).toString("hex")}]`;
    const value = new SecretValue(secret);
    expect(value.expose()).toBe(secret);
    expect(Object.keys(value)).toEqual([]);
    expectAbsent(renderings(value), [secret]);
    expect(String(value)).toBe("[redacted secret]");
  });
});

describe("CredentialVault rendering", () => {
  it("never renders the master key", () => {
    const material = freshKeyMaterial();
    const vault = new CredentialVault(new MasterKey({ keyId: KEY_ID, keyBase64: material.base64 }));
    expectAbsent(renderings(vault), [material.base64, material.hex, material.hex.toUpperCase()]);
    expect(String(vault)).toBe(`[credential vault, master key ${KEY_ID}]`);
  });
});

describe("AES-256-GCM envelope", () => {
  const key = randomBytes(32);
  const aad = "credential:v1:[tenant]:[credential]:[provider]";
  const plaintext = Buffer.from("[plaintext]", "utf8");

  it("round-trips, in the documented byte layout", () => {
    const envelope = seal(key, plaintext, aad);
    expect(envelope[0]).toBe(ENVELOPE_VERSION);
    expect(envelope.byteLength).toBe(1 + 12 + 16 + plaintext.byteLength);
    expect(envelope.includes(plaintext)).toBe(false);
    expect(open(key, envelope, aad, "SECRET").equals(plaintext)).toBe(true);
  });

  it("uses a fresh IV for every seal", () => {
    const first = seal(key, plaintext, aad);
    const second = seal(key, plaintext, aad);
    expect(first.subarray(1, 13).equals(second.subarray(1, 13))).toBe(false);
    expect(first.equals(second)).toBe(false);
  });

  it("refuses the envelope when any single byte is flipped", () => {
    const envelope = seal(key, plaintext, aad);
    for (let index = 0; index < envelope.byteLength; index++) {
      const tampered = Buffer.from(envelope);
      tampered[index] = envelope.readUInt8(index) ^ 0x01;
      expect(() => open(key, tampered, aad, "SECRET"), `byte ${String(index)}`).toThrow(
        CredentialDecryptionError,
      );
    }
  });

  it("refuses a different key, different associated data, truncation and appended bytes", () => {
    const envelope = seal(key, plaintext, aad);
    expect(() => open(randomBytes(32), envelope, aad, "SECRET")).toThrow(CredentialDecryptionError);
    expect(() => open(key, envelope, `${aad}x`, "SECRET")).toThrow(CredentialDecryptionError);
    expect(() => open(key, envelope.subarray(0, 28), aad, "SECRET")).toThrow(
      CredentialDecryptionError,
    );
    expect(() => open(key, envelope.subarray(0, envelope.byteLength - 1), aad, "SECRET")).toThrow(
      CredentialDecryptionError,
    );
    expect(() => open(key, Buffer.concat([envelope, Buffer.of(0)]), aad, "SECRET")).toThrow(
      CredentialDecryptionError,
    );
  });

  it("wraps data keys under the master key, bound to the associated data", () => {
    const masterKey = new MasterKey({ keyId: KEY_ID, keyBase64: freshKeyMaterial().base64 });
    const otherKey = new MasterKey({ keyId: KEY_ID, keyBase64: freshKeyMaterial().base64 });
    const dataKey = randomBytes(32);
    const wrapped = wrapDataKey(masterKey, dataKey, "data-key:v1:[binding]");
    expect(wrapped.includes(dataKey)).toBe(false);
    expect(unwrapDataKey(masterKey, wrapped, "data-key:v1:[binding]").equals(dataKey)).toBe(true);
    const failure = (() => {
      try {
        unwrapDataKey(otherKey, wrapped, "data-key:v1:[binding]");
      } catch (error) {
        return error;
      }
      return expect.unreachable("a different master key must not unwrap the data key");
    })();
    expect(failure).toBeInstanceOf(CredentialDecryptionError);
    expect((failure as CredentialDecryptionError).stage).toBe("DATA_KEY");
    expect(() => unwrapDataKey(masterKey, wrapped, "data-key:v1:[other]")).toThrow(
      CredentialDecryptionError,
    );
  });
});

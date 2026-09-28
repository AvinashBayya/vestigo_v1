import { AppError } from "@repo/core";

/**
 * Typed vault errors (CLAUDE.md §8). No message, field or cause ever carries
 * key material or a secret: they are safe to log.
 */

export type InvalidMasterKeyReason = "KEY_ID_FORMAT" | "KEY_NOT_BASE64" | "KEY_LENGTH";

const MASTER_KEY_PROBLEMS: Readonly<Record<InvalidMasterKeyReason, string>> = {
  KEY_ID_FORMAT: "the master key id must match ^[A-Za-z0-9._-]{1,64}$",
  KEY_NOT_BASE64: "the master key is not canonical, padded base64",
  KEY_LENGTH: "the master key must decode to exactly 32 bytes",
};

/** The configured master key or its id is unusable. Never echoes either value. */
export class InvalidMasterKeyError extends AppError {
  readonly code = "VAULT_MASTER_KEY_INVALID";
  readonly reason: InvalidMasterKeyReason;

  constructor(reason: InvalidMasterKeyReason) {
    super(`Invalid vault master key: ${MASTER_KEY_PROBLEMS[reason]}.`);
    this.name = "InvalidMasterKeyError";
    this.reason = reason;
  }
}

export type CredentialInputField = "provider" | "label" | "secret" | "purpose";

/** A credential or reveal request failed validation. Never echoes the value. */
export class CredentialInputError extends AppError {
  readonly code = "CREDENTIAL_INPUT_INVALID";
  readonly field: CredentialInputField;

  constructor(field: CredentialInputField, requirement: string) {
    super(`Invalid credential ${field}: ${requirement}.`);
    this.name = "CredentialInputError";
    this.field = field;
  }
}

/**
 * No credential with that id exists in the current tenant. Another tenant's
 * credential is indistinguishable from one that does not exist.
 */
export class CredentialNotFoundError extends AppError {
  readonly code = "CREDENTIAL_NOT_FOUND";

  constructor() {
    super("No credential with that id exists in this tenant.");
    this.name = "CredentialNotFoundError";
  }
}

export class CredentialRevokedError extends AppError {
  readonly code = "CREDENTIAL_REVOKED";

  constructor() {
    super("The credential has been revoked and can no longer be read.");
    this.name = "CredentialRevokedError";
  }
}

/** The credential was sealed under a master key other than the one the vault holds. */
export class MasterKeyMismatchError extends AppError {
  readonly code = "VAULT_MASTER_KEY_MISMATCH";
  readonly storedKeyId: string;
  readonly currentKeyId: string;

  constructor(storedKeyId: string, currentKeyId: string) {
    super(
      `The credential was encrypted under master key "${storedKeyId}", ` +
        `but the vault holds master key "${currentKeyId}".`,
    );
    this.name = "MasterKeyMismatchError";
    this.storedKeyId = storedKeyId;
    this.currentKeyId = currentKeyId;
  }
}

/** Which envelope failed to open: the wrapped data key, or the secret itself. */
export type DecryptionStage = "DATA_KEY" | "SECRET";

/**
 * An envelope failed authentication: wrong key, wrong binding (the ciphertext
 * was moved to another credential id, provider or tenant), an unknown format
 * version, or tampering. Deliberately does not say which.
 */
export class CredentialDecryptionError extends AppError {
  readonly code = "CREDENTIAL_DECRYPTION_FAILED";
  readonly stage: DecryptionStage;

  constructor(stage: DecryptionStage) {
    super(
      stage === "DATA_KEY"
        ? "The credential's data key could not be decrypted and authenticated."
        : "The credential could not be decrypted and authenticated.",
    );
    this.name = "CredentialDecryptionError";
    this.stage = stage;
  }
}

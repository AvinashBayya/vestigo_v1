import { randomBytes, randomUUID } from "node:crypto";
import { inspect } from "node:util";
import type { TenantId } from "@repo/core";
import type { AuditActor, Credential, NewAuditEntry, TenantContext } from "@repo/db";
import { KEY_BYTES, open, seal } from "./envelope.ts";
import {
  CredentialDecryptionError,
  CredentialInputError,
  CredentialNotFoundError,
  CredentialRevokedError,
  MasterKeyMismatchError,
} from "./errors.ts";
import { unwrapDataKey, wrapDataKey, type MasterKey } from "./master-key.ts";
import { SecretValue } from "./secret-value.ts";

/** What the vault says about a credential. Never the secret or any ciphertext. */
export interface CredentialMetadata {
  readonly id: string;
  readonly provider: string;
  readonly label: string;
  /** Id of the master key the credential's data key is wrapped under. */
  readonly masterKeyVersion: string;
  readonly createdAt: Date;
  /** Null: no use has been recorded. */
  readonly lastUsedAt: Date | null;
  readonly revokedAt: Date | null;
}

export interface StoreCredentialInput {
  /** Lowercase provider id, e.g. `[provider]`; matches ^[a-z0-9][a-z0-9._-]*$. */
  readonly provider: string;
  readonly label: string;
  readonly secret: string;
}

/**
 * Who is reading a credential, why, and under what authorisation. Written to
 * the audit log before the secret is decrypted. A system job states
 * `{ method: "SYSTEM", permission: null, sessionId: null }`.
 */
export interface RevealRequest {
  readonly purpose: string;
  readonly actor: AuditActor;
  readonly authorization: NonNullable<NewAuditEntry["authorization"]>;
  readonly requestId: string | null;
}

const PROVIDER = /^[a-z0-9][a-z0-9._-]*$/;
const MAX_PROVIDER_LENGTH = 64;
const MAX_LABEL_LENGTH = 200;
const MAX_PURPOSE_LENGTH = 500;
const MAX_SECRET_BYTES = 64 * 1024;

/** Binds a sealed secret to its tenant, credential id and provider. */
function secretAad(tenantId: TenantId, credentialId: string, provider: string): string {
  return `credential:v1:${tenantId}:${credentialId}:${provider}`;
}

/** Binds a wrapped data key to its tenant, credential id and master key id. */
function dataKeyAad(tenantId: TenantId, credentialId: string, keyId: string): string {
  return `data-key:v1:${tenantId}:${credentialId}:${keyId}`;
}

function requireText(field: "label" | "purpose", value: string, maxLength: number): void {
  if (value.trim().length === 0) throw new CredentialInputError(field, "must not be blank");
  if (value.length > maxLength) {
    throw new CredentialInputError(field, `must be at most ${String(maxLength)} characters`);
  }
}

function validateStoreInput(input: StoreCredentialInput): void {
  if (input.provider.length > MAX_PROVIDER_LENGTH || !PROVIDER.test(input.provider)) {
    throw new CredentialInputError(
      "provider",
      `must match ^[a-z0-9][a-z0-9._-]*$ and be at most ${String(MAX_PROVIDER_LENGTH)} characters`,
    );
  }
  requireText("label", input.label, MAX_LABEL_LENGTH);
  if (input.secret.length === 0) throw new CredentialInputError("secret", "must not be empty");
  if (!input.secret.isWellFormed()) {
    throw new CredentialInputError("secret", "must be well-formed Unicode");
  }
  if (Buffer.byteLength(input.secret, "utf8") > MAX_SECRET_BYTES) {
    throw new CredentialInputError("secret", `must be at most ${String(MAX_SECRET_BYTES)} bytes`);
  }
}

function toMetadata(row: Credential): CredentialMetadata {
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    masterKeyVersion: row.masterKeyVersion,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
  };
}

const UTF8 = new TextDecoder("utf-8", { fatal: true });

/**
 * Per-tenant credential vault with envelope encryption (CLAUDE.md §9).
 *
 * Each credential gets its own random 256-bit data key. The secret is sealed
 * with the data key, and the data key is sealed with the master key; both are
 * AES-256-GCM with associated data binding the envelope to its tenant and
 * credential. Only ciphertext reaches the database, and every read of a
 * secret is audited: there is no un-audited read path.
 */
export class CredentialVault {
  readonly #masterKey: MasterKey;

  constructor(masterKey: MasterKey) {
    this.#masterKey = masterKey;
  }

  /** Encrypts and stores a secret. Returns metadata only. */
  async store(ctx: TenantContext, input: StoreCredentialInput): Promise<CredentialMetadata> {
    validateStoreInput(input);
    const keyId = this.#masterKey.keyId;
    const id = randomUUID();
    const dataKey = randomBytes(KEY_BYTES);
    const plaintext = Buffer.from(input.secret, "utf8");
    try {
      const ciphertext = seal(dataKey, plaintext, secretAad(ctx.tenantId, id, input.provider));
      const encryptedDataKey = wrapDataKey(
        this.#masterKey,
        dataKey,
        dataKeyAad(ctx.tenantId, id, keyId),
      );
      const row = await ctx.repos.credentials.create({
        id,
        provider: input.provider,
        label: input.label,
        ciphertext,
        encryptedDataKey,
        masterKeyVersion: keyId,
      });
      return toMetadata(row);
    } finally {
      // Best effort: the JS string the secret arrived in cannot be wiped.
      dataKey.fill(0);
      plaintext.fill(0);
    }
  }

  async list(
    ctx: TenantContext,
    options: { readonly limit: number },
  ): Promise<CredentialMetadata[]> {
    const rows = await ctx.repos.credentials.list(options);
    return rows.map(toMetadata);
  }

  /**
   * Decrypts a credential. Appends a `credential.read` audit entry first, so
   * nothing is decrypted unless the entry was written.
   *
   * The entry belongs to the caller's transaction and commits with it. Reveal
   * in a transaction of its own and use the secret after `withTenant` has
   * returned: if the transaction that revealed a secret rolls back, its audit
   * entry rolls back with it.
   */
  async reveal(
    ctx: TenantContext,
    credentialId: string,
    request: RevealRequest,
  ): Promise<SecretValue> {
    requireText("purpose", request.purpose, MAX_PURPOSE_LENGTH);
    const row = await ctx.repos.credentials.findById(credentialId);
    if (row === null) throw new CredentialNotFoundError();
    if (row.revokedAt !== null) throw new CredentialRevokedError();
    const keyId = this.#masterKey.keyId;
    if (row.masterKeyVersion !== keyId) {
      throw new MasterKeyMismatchError(row.masterKeyVersion, keyId);
    }

    await ctx.repos.auditLog.append({
      actor: request.actor,
      action: "credential.read",
      target: { type: "credential", id: row.id },
      details: { purpose: request.purpose, provider: row.provider },
      authorization: request.authorization,
      outcome: "ALLOWED",
      requestId: request.requestId,
    });

    const dataKey = unwrapDataKey(
      this.#masterKey,
      row.encryptedDataKey,
      dataKeyAad(ctx.tenantId, row.id, keyId),
    );
    try {
      if (dataKey.byteLength !== KEY_BYTES) throw new CredentialDecryptionError("DATA_KEY");
      const plaintext = open(
        dataKey,
        row.ciphertext,
        secretAad(ctx.tenantId, row.id, row.provider),
        "SECRET",
      );
      try {
        return new SecretValue(UTF8.decode(plaintext));
      } catch {
        throw new CredentialDecryptionError("SECRET");
      } finally {
        plaintext.fill(0);
      }
    } finally {
      dataKey.fill(0);
    }
  }

  /** Revokes a credential. Null if it does not exist here or is already revoked. */
  async revoke(ctx: TenantContext, credentialId: string): Promise<CredentialMetadata | null> {
    const row = await ctx.repos.credentials.revoke(credentialId);
    return row === null ? null : toMetadata(row);
  }

  toString(): string {
    return `[credential vault, master key ${this.#masterKey.keyId}]`;
  }

  toJSON(): string {
    return this.toString();
  }

  [inspect.custom](): string {
    return this.toString();
  }
}

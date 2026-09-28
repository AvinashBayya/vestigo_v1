import type { CollectorSecret } from "@repo/collectors";
import type { TenantContext } from "@repo/db";
import type { CredentialVault } from "@repo/integrations";

/** Why credentials are being read, for the audit entry every read writes. */
export interface CredentialPurpose {
  readonly collectorId: string;
  readonly requestId: string | null;
}

/** Where a collector's credentials come from: the tenant's own vault. */
export interface CredentialSource {
  /**
   * The tenant's current credential for each vault id it has one for. Ids
   * with none are simply absent; the runtime decides whether that is fatal.
   */
  resolve(
    ctx: TenantContext,
    vaultIds: readonly string[],
    purpose: CredentialPurpose,
  ): Promise<ReadonlyMap<string, CollectorSecret>>;
}

const MAX_CREDENTIALS = 1000;

/**
 * Reads credentials from the tenant's vault, as the system on a collector's
 * behalf. Every read is audited by the vault. Only called once a collector has
 * been admitted, so a refused collector never causes a credential read.
 */
export class VaultCredentialSource implements CredentialSource {
  readonly #vault: CredentialVault;

  constructor(vault: CredentialVault) {
    this.#vault = vault;
  }

  async resolve(
    ctx: TenantContext,
    vaultIds: readonly string[],
    purpose: CredentialPurpose,
  ): Promise<ReadonlyMap<string, CollectorSecret>> {
    const found = new Map<string, CollectorSecret>();
    if (vaultIds.length === 0) return found;
    const stored = await this.#vault.list(ctx, { limit: MAX_CREDENTIALS });
    for (const vaultId of vaultIds) {
      // The newest credential the tenant has not revoked, if any.
      const current = stored
        .filter((credential) => credential.provider === vaultId && credential.revokedAt === null)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      if (current === undefined) continue;
      found.set(
        vaultId,
        await this.#vault.reveal(ctx, current.id, {
          purpose: `collector ${purpose.collectorId}`,
          actor: { kind: "SYSTEM" },
          authorization: { method: "SYSTEM", permission: null, sessionId: null },
          requestId: purpose.requestId,
        }),
      );
    }
    return found;
  }
}

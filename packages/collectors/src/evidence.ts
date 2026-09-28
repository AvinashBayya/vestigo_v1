import type { CollectionMode, CollectorDiscipline, CommercialUseVerdict } from "@repo/core";
import { CollectorDefinitionError } from "./errors.ts";
import { capturedPayload } from "./fetcher/capture.ts";
import { foundBy, type FoundOutcome } from "./outcome.ts";
import type { RegistryEntry } from "./registry.ts";

/**
 * One evidence row to write, built only from a FOUND outcome the runtime
 * produced for this exact collector. There is no label here: evidence
 * references its collector's registry row, and the label lives there.
 */
export interface EvidenceDraft {
  readonly collectorId: string;
  readonly collectorVersion: string;
  /** The final URL the payload came from, credentials redacted. */
  readonly sourceUrl: string;
  /** Exactly the bytes the upstream sent, as the fetcher recorded them. */
  readonly payload: Uint8Array;
  /** From the upstream's data; null when it gives none. */
  readonly observedAt: Date | null;
  /** When the fetcher received the last byte. Measured, never assumed. */
  readonly collectedAt: Date;
  readonly claimStrength: "OBSERVED" | "REPORTED";
}

/** The tenant's copy of a registry entry, shaped for the collectors_registry row. */
export interface TenantRegistration {
  readonly collectorId: string;
  /** The label on the collector's evidence: always the registry entry's, never the collector's say. */
  readonly sourceLabel: string;
  readonly discipline: CollectorDiscipline;
  readonly collectionMode: CollectionMode;
  readonly dataLicence: string;
  readonly commercialUse: CommercialUseVerdict;
  /** A BLOCKED collector is never enabled, and the database refuses its evidence. */
  readonly enabled: boolean;
  readonly disabledReason: string | null;
}

export function tenantRegistration(entry: RegistryEntry): TenantRegistration {
  const { licence } = entry.source;
  const blocked = licence.commercialUse === "BLOCKED";
  return {
    collectorId: entry.id,
    sourceLabel: entry.label,
    discipline: entry.discipline,
    collectionMode: entry.collectionMode,
    dataLicence: `${entry.source.name}: ${licence.commercialUse}. ${licence.reason}`,
    commercialUse: licence.commercialUse,
    enabled: !blocked,
    disabledReason: blocked ? licence.reason : null,
  };
}

/**
 * The evidence rows for a FOUND outcome. Refuses anything the runtime did not
 * produce for this collector, so evidence can only ever come from a real run
 * of the collector whose registry entry it will carry.
 */
export function evidenceDrafts(entry: RegistryEntry, outcome: FoundOutcome): EvidenceDraft[] {
  if (foundBy(outcome) !== entry.id || outcome.collectorId !== entry.id) {
    throw new CollectorDefinitionError(
      `collector "${entry.id}"`,
      "evidence may only be drafted from a FOUND outcome the runtime produced for this collector",
    );
  }
  return outcome.evidence.map((item) => {
    const payload = capturedPayload(item.response);
    if (payload === null) {
      throw new CollectorDefinitionError(
        `collector "${entry.id}"`,
        "evidence cites a response the fetcher did not capture",
      );
    }
    return {
      collectorId: entry.id,
      collectorVersion: entry.version,
      sourceUrl: item.response.url,
      payload,
      observedAt: item.observedAt,
      collectedAt: item.response.receivedAt,
      claimStrength: entry.claimStrength,
    };
  });
}

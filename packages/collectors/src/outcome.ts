import type { LockReason, UnrunnableReason } from "@repo/core";
import type { EvidenceItem } from "./contract.ts";
import type { Captured } from "./fetcher/capture.ts";

/**
 * Why a collector was not run. Each is decided before the collector's code is
 * reached. LICENCE_BLOCKED and NOT_IMPLEMENTED are core's UNRUNNABLE_REASONS:
 * the collector cannot run for anyone.
 */
export type RefusalReason =
  | UnrunnableReason
  | "UNVERIFIED_SOURCE_NOT_ALLOWED"
  | "TARGET_TYPE_NOT_ACCEPTED"
  | LockReason
  | "SCOPE_AUTHORISATION_REQUIRED";

/** A machine-readable code and a message with no target value, credential or URL path. */
export interface OutcomeError {
  readonly code: string;
  readonly message: string;
}

/**
 * The result of dispatching a collector. Every status is distinct, and only
 * FOUND carries a result or produces evidence:
 *   FOUND             something was found, validated, citing captured responses;
 *   NOT_FOUND         the upstream answered and has nothing for this target;
 *   FAILED            it went wrong and retrying will not help;
 *   UNAVAILABLE       it went wrong and retrying later may help;
 *   NEEDS_CREDENTIALS a required tenant credential is missing;
 *   REFUSED           it was not run at all.
 */
export type CollectionOutcome =
  | {
      readonly status: "FOUND";
      readonly collectorId: string;
      readonly result: unknown;
      readonly evidence: readonly EvidenceItem[];
    }
  | {
      readonly status: "NOT_FOUND";
      readonly collectorId: string;
      readonly detail: string;
      /** The response (or, for a local analysis, the recorded analysis) that said so. */
      readonly response: Captured;
    }
  | { readonly status: "FAILED"; readonly collectorId: string; readonly error: OutcomeError }
  | {
      readonly status: "UNAVAILABLE";
      readonly collectorId: string;
      readonly error: OutcomeError;
      /** When the upstream or the shared limit says to try again. Null: not stated. */
      readonly retryAfterMs: number | null;
    }
  | {
      readonly status: "NEEDS_CREDENTIALS";
      readonly collectorId: string;
      readonly missing: readonly string[];
    }
  | {
      readonly status: "REFUSED";
      readonly collectorId: string;
      readonly reason: RefusalReason;
      readonly message: string;
    };

export type FoundOutcome = Extract<CollectionOutcome, { readonly status: "FOUND" }>;
export type RefusedOutcome = Extract<CollectionOutcome, { readonly status: "REFUSED" }>;
export type FailedOutcome = Extract<CollectionOutcome, { readonly status: "FAILED" }>;

const FOUND = new WeakMap<object, string>();

/** Internal: marks a FOUND outcome as produced by the runtime for this collector. */
export function markFound(outcome: FoundOutcome): FoundOutcome {
  const frozen = Object.freeze(outcome);
  FOUND.set(frozen, outcome.collectorId);
  return frozen;
}

/** The collector a FOUND outcome really came from, or null if the runtime did not produce it. */
export function foundBy(outcome: unknown): string | null {
  if (typeof outcome !== "object" || outcome === null) return null;
  return FOUND.get(outcome) ?? null;
}

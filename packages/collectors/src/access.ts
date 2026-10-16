/**
 * Access methods: how a collector reaches its source (owner instruction,
 * 2026-10-16). Every source declares one or more (SourceDeclaration.access);
 * a source runs only via a method that is enabled in the deployment, and only
 * when its licence verdict is PERMITTED. The vocabulary and the deployment's
 * setting are @repo/config's (ACCESS_METHODS, COLLECTORS_ACCESS_METHODS).
 *
 *   open      a public or official free service, with no credential;
 *   official  the provider's own keyed API, with a key the tenant sets;
 *   licensed  a third-party data vendor, through the tenant's own account;
 *   operator  an operator's own collector, attached to the platform
 *             (OperatorAttachment), with credentials the operator supplies.
 *
 * Every keyed method's credentials come from the tenant's vault, never from
 * configuration. The product ships no collector that uses the operator
 * method: only the interface one is attached to.
 */
import type { AccessMethod } from "@repo/config";
import type { CommercialUseVerdict, UnrunnableReason } from "@repo/core";

export {
  ACCESS_METHODS,
  DEFAULT_ACCESS_METHODS,
  isAccessMethod,
  type AccessMethod,
} from "@repo/config";

/** The methods that hand the collector a credential from the tenant's vault. */
export const KEYED_ACCESS_METHODS = [
  "official",
  "licensed",
  "operator",
] as const satisfies readonly AccessMethod[];
export type KeyedAccessMethod = (typeof KEYED_ACCESS_METHODS)[number];

export function isKeyedAccessMethod(method: AccessMethod): method is KeyedAccessMethod {
  return (KEYED_ACCESS_METHODS as readonly string[]).includes(method);
}

/**
 * The id prefix of every source and collector reached through the operator
 * method, and of nothing else: an attached collector can never take a
 * platform id, now or later, so its evidence label can never be another's.
 */
export const OPERATOR_ID_PREFIX = "operator.";

/** The methods a source declares, never empty. */
export type DeclaredAccess = readonly [AccessMethod, ...AccessMethod[]];

/**
 * The methods a collector can use on its source, in the source's order: open
 * when it runs without a credential, the source's keyed method when it names
 * vault ids. The registry checks that the source declares each of them.
 */
export function usableMethods(
  access: readonly AccessMethod[],
  credentials: { readonly vaultIds: readonly string[]; readonly runsWithout: boolean },
): AccessMethod[] {
  return access.filter((method) =>
    isKeyedAccessMethod(method) ? credentials.vaultIds.length > 0 : credentials.runsWithout,
  );
}

/** One access method, as this deployment treats it. */
export interface AccessMethodEntry {
  readonly kind: AccessMethod;
  /** Enabled in this deployment (COLLECTORS_ACCESS_METHODS). */
  readonly enabled: boolean;
  /** The source's verdict: one provider, one set of terms, whichever way in. */
  readonly licenceVerdict: CommercialUseVerdict;
  /** Enabled, and the verdict is PERMITTED: the only way anything runs. */
  readonly runnable: boolean;
}

/** The methods something can run via here, in its source's order. Never empty. */
export type RunsVia = readonly [AccessMethod, ...AccessMethod[]];

/**
 * Whether something can run here, before any per-run check. When it cannot,
 * `runsVia` is null, never an empty list or a count, and the refusal says why.
 */
export type Runnability =
  | { readonly runsVia: RunsVia; readonly refusal: null; readonly reason: null }
  | { readonly runsVia: null; readonly refusal: UnrunnableReason; readonly reason: string };

/**
 * A source as this deployment runs it: the registry entry per source the
 * owner asked for. `enabled` is whether any of its methods can run here; it is
 * not the tenant registry's `enabled` column, which only says "not BLOCKED".
 */
export type SourceAccess = {
  readonly id: string;
  readonly label: string;
  readonly methods: readonly AccessMethodEntry[];
  readonly licenceVerdict: CommercialUseVerdict;
  readonly enabled: boolean;
} & Runnability;

/** A collector as this deployment runs it. */
export type CollectorAccess = {
  /** The methods it can use, as this deployment treats each. */
  readonly methods: readonly AccessMethodEntry[];
  /**
   * The tenant vault ids it may be handed: its own, when a keyed method it can
   * use is runnable here; none otherwise, so a credential for a method that is
   * not enabled is never read from the vault.
   */
  readonly vaultIds: readonly string[];
} & Runnability;

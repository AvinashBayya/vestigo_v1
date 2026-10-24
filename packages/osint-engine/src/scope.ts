/**
 * Resolving the scope authorisation that clears a target for an ACTIVE
 * collector — the collection-mode gate (CLAUDE.md §3; packages/collectors
 * runtime). Used identically at planning (estimate and run) and at collection
 * (executor), so admission and the collect-time re-check agree, and a revoked
 * authorisation fails closed everywhere.
 *
 * Exact targets are matched exactly, as before. A URL target is additionally
 * cleared by an in-force **DOMAIN** read authorisation for the URL's exact host
 * (Stage 1 of the exact-article work, docs/M1_DIRECT_ARTICLE_FETCH_REPORT.md):
 * a direct article fetch reaches the publisher (ACTIVE), and is authorised per
 * publisher domain, not per article URL. The host is the exact normalised
 * domain (parseTarget("DOMAIN", url)); there is no parent-domain or subdomain
 * widening, and an authorisation never overrides the fetcher's SSRF checks.
 *
 * The clearance this returns is always shaped to the target it clears, so the
 * collectors runtime's admission gate stays a single exact-target check
 * (collectionMode scope gate, runtime.ts): a URL cleared by a DOMAIN
 * authorisation yields a clearance for that URL, carrying the DOMAIN
 * authorisation's id for the audit trail. The widening lives only here, the
 * one shared gate, never copied into the runtime.
 */
import { InvalidTargetError, parseTarget, type ScopeClearance } from "@repo/collectors";
import type { TargetType } from "@repo/core";

/** The minimum of the scope-authorisations repository this needs (structurally `repos.scopeAuthorisations`). */
export interface ScopeAuthorisationLookup {
  findInForce(
    targetType: TargetType,
    target: string,
  ): Promise<{
    readonly id: string;
    readonly targetType: TargetType;
    readonly target: string;
  } | null>;
}

const clearanceOf = (row: {
  readonly id: string;
  readonly targetType: TargetType;
  readonly target: string;
}): ScopeClearance => ({ id: row.id, targetType: row.targetType, target: row.target });

export async function resolveScopeClearance(
  scopeAuthorisations: ScopeAuthorisationLookup,
  target: { readonly type: TargetType; readonly value: string },
): Promise<ScopeClearance | null> {
  const exact = await scopeAuthorisations.findInForce(target.type, target.value);
  if (exact !== null) return clearanceOf(exact);
  if (target.type === "URL") {
    let host: string;
    try {
      host = parseTarget("DOMAIN", target.value).value;
    } catch (error) {
      // A URL that has no valid host authorises against no domain: deny.
      if (error instanceof InvalidTargetError) return null;
      throw error;
    }
    const domain = await scopeAuthorisations.findInForce("DOMAIN", host);
    // The clearance is for this URL target (so the runtime admits the exact
    // target it is collecting), granted by the DOMAIN authorisation — whose id
    // it carries, so the audit trail still points at the per-publisher record.
    if (domain !== null) return { id: domain.id, targetType: target.type, target: target.value };
  }
  return null;
}

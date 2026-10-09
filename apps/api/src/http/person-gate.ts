import { personGate, type PersonLock } from "@repo/access";
import type { PersonProbe, Reads, Tenant } from "@repo/db";
import type { RequestTenant } from "./access.ts";
import { LockedError } from "./errors.ts";

/** The Locked refusal for a lock, naming what this request would have returned. */
export function lockedError(lock: PersonLock, withheld: string): LockedError {
  return new LockedError({
    module: lock.module,
    moduleSummary: lock.moduleSummary,
    withheld,
    reason: lock.reason,
    plan: lock.plan,
    vettingStatus: lock.vettingStatus,
    nextStep: lock.nextStep,
  });
}

/**
 * The gate's one decision, for code that holds a tenant transaction but no
 * request (the run progress stream re-checks with it on every read): the
 * Locked refusal when the tenant may not access person data and anything the
 * probe covers rests on it, otherwise null. The decision is the shared one,
 * personGate in @repo/access, which the case analysis job calls too (D-28); a
 * tenant that may access person data passes without the probe being run, and
 * a probe of any size is split into parts the probe accepts (probeParts).
 */
export async function personLockFor(
  tenant: Pick<Tenant, "plan" | "vettingStatus">,
  reads: Reads,
  probe: PersonProbe,
  withheld: string,
): Promise<LockedError | null> {
  const lock = await personGate(tenant, () => reads.exploration.restsOnPersonData(probe));
  return lock === null ? null : lockedError(lock, withheld);
}

/**
 * CLAUDE.md §9. Refuses the whole read, with the Locked detail, when the
 * tenant may not access person data and anything the read would return rests
 * on it. A read is never thinned: no rows dropped, no count lowered, no part
 * returned as if it were the whole. A tenant that may access person data, or
 * a read that touches none, passes untouched.
 *
 * This file is the API's only way to the person decision; the decision itself
 * is personGate in @repo/access. packages/config/scripts/person-gate-guard.test.ts
 * fails if a copy of either appears anywhere else.
 */
export async function requirePersonAccess(
  context: RequestTenant,
  probe: PersonProbe,
  withheld: string,
): Promise<void> {
  const lock = await personLockFor(context.tenant, context.reads, probe, withheld);
  if (lock !== null) throw lock;
}

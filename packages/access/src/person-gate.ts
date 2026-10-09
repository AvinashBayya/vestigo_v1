import type { LockReason } from "@repo/core";
import { decideDisciplineAccess, type TenantEntitlement } from "./entitlements.ts";

/**
 * Why a read resting on person data is refused, and what to do about it: the
 * Locked state's content (CLAUDE.md §9), the same for the API's 403 and for a
 * worker's coded failure.
 */
export interface PersonLock {
  readonly module: "PERSON_INVESTIGATION";
  readonly moduleSummary: string;
  readonly reason: LockReason;
  readonly plan: TenantEntitlement["plan"];
  readonly vettingStatus: TenantEntitlement["vettingStatus"];
  readonly nextStep: string;
}

const MODULE_SUMMARY =
  "Person investigation covers information about named individuals. It is available only to organisations whose plan includes it and whose vetting is approved.";

/** The next step for the Locked state, by why the module is off. Plain, and true of what exists today. */
function nextStepFor(
  reason: LockReason,
  vettingStatus: TenantEntitlement["vettingStatus"],
): string {
  if (reason === "MODULE_NOT_IN_PLAN") {
    return "An organisation owner can ask the platform operator to add the person investigation module to the plan.";
  }
  switch (vettingStatus) {
    case "NOT_SUBMITTED":
      return "Vetting has not been submitted. It must be submitted and approved before this data can be read.";
    case "PENDING":
      return "Vetting is under review. This data becomes readable once it is approved.";
    case "REJECTED":
      return "Vetting was rejected. An organisation owner can contact the platform operator about the decision.";
    case "SUSPENDED":
      return "Vetting is suspended. An organisation owner can contact the platform operator to have it restored.";
    case "APPROVED":
      // Not reachable: an approved tenant on a plan with the module is allowed.
      return "Vetting is approved; the plan does not include this module.";
  }
}

/**
 * The shared person gate (owner ruling D-28): the one decision, for the API and
 * the workers alike, of whether a read may go ahead. A tenant whose plan and
 * vetting allow person data passes without the probe being asked. Otherwise the
 * probe says whether anything the read covers rests on person data, and when
 * it does, the read is refused whole with the Locked content; it is never
 * thinned.
 *
 * Nothing here does I/O: the probe is the caller's, given in
 * (`reads.exploration.restsOnPersonData` from @repo/db, which may not be
 * imported here). Callers: the API's requirePersonAccess and personLockFor
 * (apps/api/src/http/person-gate.ts), and the case analysis job.
 */
export async function personGate(
  tenant: TenantEntitlement,
  restsOnPersonData: () => Promise<boolean>,
): Promise<PersonLock | null> {
  const decision = decideDisciplineAccess(tenant, "PERSON");
  if (decision.allowed) return null;
  if (!(await restsOnPersonData())) return null;
  return {
    module: "PERSON_INVESTIGATION",
    moduleSummary: MODULE_SUMMARY,
    reason: decision.reason,
    plan: tenant.plan,
    vettingStatus: tenant.vettingStatus,
    nextStep: nextStepFor(decision.reason, tenant.vettingStatus),
  };
}

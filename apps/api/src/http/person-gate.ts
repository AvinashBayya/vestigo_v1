import { decideDisciplineAccess } from "@repo/access";
import type { PersonProbe, Tenant } from "@repo/db";
import type { RequestTenant } from "./access.ts";
import { LockedError, type Locked } from "./errors.ts";

type Reason = Locked["reason"];

/** The next step for the Locked state, by why the module is off. Plain, and true of what exists today. */
function nextStepFor(reason: Reason, vettingStatus: Tenant["vettingStatus"]): string {
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

/** The Locked refusal for a tenant, naming what this request would have returned. */
export function lockedError(
  tenant: Pick<Tenant, "plan" | "vettingStatus">,
  reason: Reason,
  withheld: string,
): LockedError {
  return new LockedError({
    module: "PERSON_INVESTIGATION",
    moduleSummary:
      "Person investigation covers information about named individuals. It is available only to organisations whose plan includes it and whose vetting is approved.",
    withheld,
    reason,
    plan: tenant.plan,
    vettingStatus: tenant.vettingStatus,
    nextStep: nextStepFor(reason, tenant.vettingStatus),
  });
}

/**
 * CLAUDE.md §9. Refuses the whole read, with the Locked detail, when the
 * tenant may not access person data and anything the read would return rests
 * on it. A read is never thinned: no rows dropped, no count lowered, no part
 * returned as if it were the whole. A tenant that may access person data, or
 * a read that touches none, passes untouched (and the probe is not run for
 * the former).
 */
export async function requirePersonAccess(
  context: RequestTenant,
  probe: PersonProbe,
  withheld: string,
): Promise<void> {
  const decision = decideDisciplineAccess(context.tenant, "PERSON");
  if (decision.allowed) return;
  if (!(await context.reads.exploration.touchesPersonData(probe))) return;
  throw lockedError(context.tenant, decision.reason, withheld);
}

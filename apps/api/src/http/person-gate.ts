import { decideDisciplineAccess } from "@repo/access";
import type { PersonProbe, Reads, Tenant } from "@repo/db";
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

/** The most ids of one kind the probe reads in one statement. */
const PROBE_LIMIT = 1000;

const slices = (ids: readonly string[]): string[][] => {
  const out: string[][] = [];
  for (let start = 0; start < ids.length; start += PROBE_LIMIT) {
    out.push(ids.slice(start, start + PROBE_LIMIT));
  }
  return out;
};

/**
 * A probe in parts of at most PROBE_LIMIT ids of each kind. The first part keeps
 * everything else the probe names (its scope, its run, a scope's entities), so
 * no field is lost; together the parts cover exactly what the probe does, and a
 * read that names many entities is decided, never failed.
 */
export function probeParts(probe: PersonProbe): PersonProbe[] {
  const evidenceIds = slices(probe.evidenceIds ?? []);
  const claimIds = slices(probe.claimIds ?? []);
  const entityIds = slices(probe.entityIds ?? []);
  const count = Math.max(1, evidenceIds.length, claimIds.length, entityIds.length);
  return Array.from({ length: count }, (_, index) => {
    const ids = {
      evidenceIds: evidenceIds[index] ?? [],
      claimIds: claimIds[index] ?? [],
      entityIds: entityIds[index] ?? [],
    };
    return index === 0 ? { ...probe, ...ids } : ids;
  });
}

/**
 * The gate's one decision, for code that holds a tenant transaction but no
 * request (the run progress stream re-checks with it on every read): the
 * Locked refusal when the tenant may not access person data and anything the
 * probe covers rests on it, otherwise null. A tenant that may access person
 * data passes without the probe being run.
 */
export async function personLockFor(
  tenant: Pick<Tenant, "plan" | "vettingStatus">,
  reads: Reads,
  probe: PersonProbe,
  withheld: string,
): Promise<LockedError | null> {
  const decision = decideDisciplineAccess(tenant, "PERSON");
  if (decision.allowed) return null;
  for (const part of probeParts(probe)) {
    if (await reads.exploration.touchesPersonData(part)) {
      return lockedError(tenant, decision.reason, withheld);
    }
  }
  return null;
}

/**
 * CLAUDE.md §9. Refuses the whole read, with the Locked detail, when the
 * tenant may not access person data and anything the read would return rests
 * on it. A read is never thinned: no rows dropped, no count lowered, no part
 * returned as if it were the whole. A tenant that may access person data, or
 * a read that touches none, passes untouched.
 *
 * This file is the only place in the apps that decides person access for a
 * read; packages/config/scripts/person-gate-guard.test.ts fails if a copy
 * appears anywhere else.
 */
export async function requirePersonAccess(
  context: RequestTenant,
  probe: PersonProbe,
  withheld: string,
): Promise<void> {
  const lock = await personLockFor(context.tenant, context.reads, probe, withheld);
  if (lock !== null) throw lock;
}

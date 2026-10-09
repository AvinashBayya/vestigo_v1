import type { CollectorDiscipline, LockReason } from "@repo/core";
import { PERMISSION_MODULE, type Module, type Permission } from "./permissions.ts";

/**
 * Plans, by the modules they include. The identifiers describe their contents
 * rather than naming commercial tiers; the commercial plan catalogue is Phase 7.
 * Additive only.
 */
export const PLANS = ["TECHINT", "TECHINT_AND_PERSON"] as const;
export type Plan = (typeof PLANS)[number];

export const PLAN_MODULES: Readonly<Record<Plan, readonly Module[]>> = {
  TECHINT: ["TECHINT"],
  TECHINT_AND_PERSON: ["TECHINT", "PERSON_INVESTIGATION"],
};

/** A tenant's customer-vetting state. Only APPROVED unlocks vetting-gated modules. */
export const VETTING_STATUSES = [
  "NOT_SUBMITTED",
  "PENDING",
  "APPROVED",
  "REJECTED",
  "SUSPENDED",
] as const;
export type VettingStatus = (typeof VETTING_STATUSES)[number];

/** Modules that need an approved vetting status in addition to the plan. */
export const VETTING_GATED_MODULES: readonly Module[] = ["PERSON_INVESTIGATION"];

export interface TenantEntitlement {
  readonly plan: Plan;
  readonly vettingStatus: VettingStatus;
}

export type ModuleDecision =
  { readonly allowed: true } | { readonly allowed: false; readonly reason: LockReason };

/**
 * Whether a tenant may use a module. Person investigation needs BOTH a plan
 * that includes it AND approved vetting; neither alone is enough, and there is
 * no override (CLAUDE.md §9).
 */
export function decideModuleAccess(tenant: TenantEntitlement, module: Module): ModuleDecision {
  if (!PLAN_MODULES[tenant.plan].includes(module)) {
    return { allowed: false, reason: "MODULE_NOT_IN_PLAN" };
  }
  if (VETTING_GATED_MODULES.includes(module) && tenant.vettingStatus !== "APPROVED") {
    return { allowed: false, reason: "VETTING_NOT_APPROVED" };
  }
  return { allowed: true };
}

/**
 * The module each collector discipline belongs to. PERSON collectors are the
 * person-investigation module, so dispatching one needs the plan AND approved
 * vetting. The other disciplines sit in the base module every plan includes,
 * until the commercial plan catalogue (Phase 7) prices them separately.
 */
export const DISCIPLINE_MODULE: Readonly<Record<CollectorDiscipline, Module>> = {
  TECHINT: "TECHINT",
  SOCMINT: "TECHINT",
  MEDIAINT: "TECHINT",
  GEOINT: "TECHINT",
  PERSON: "PERSON_INVESTIGATION",
};

/** Whether a tenant may dispatch a collector of this discipline. */
export function decideDisciplineAccess(
  tenant: TenantEntitlement,
  discipline: CollectorDiscipline,
): ModuleDecision {
  return decideModuleAccess(tenant, DISCIPLINE_MODULE[discipline]);
}

/** The module decision for exercising a permission; permissions outside any module are allowed. */
export function decidePermissionModuleAccess(
  tenant: TenantEntitlement,
  permission: Permission,
): ModuleDecision {
  const module = PERMISSION_MODULE[permission];
  return module === null ? { allowed: true } : decideModuleAccess(tenant, module);
}

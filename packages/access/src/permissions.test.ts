import { describe, expect, it } from "vitest";
import {
  isPermission,
  PERMISSION_MODULE,
  PERMISSIONS,
  permissionsForRoles,
  ROLE_PERMISSIONS,
  ROLES,
} from "./permissions.ts";
import {
  decideDisciplineAccess,
  decideModuleAccess,
  decidePermissionModuleAccess,
  PLAN_MODULES,
  PLANS,
  VETTING_STATUSES,
  type Plan,
  type VettingStatus,
} from "./entitlements.ts";

describe("permission catalogue", () => {
  it("uses resource:action names, each assigned to a module or to none", () => {
    for (const permission of PERMISSIONS) {
      expect(permission).toMatch(/^[a-z][a-z_]*:[a-z][a-z_]*$/);
      expect(PERMISSION_MODULE).toHaveProperty(permission);
    }
    expect(Object.keys(PERMISSION_MODULE).sort()).toEqual([...PERMISSIONS].sort());
  });

  it("grants every role only catalogued permissions", () => {
    for (const role of ROLES) {
      for (const permission of ROLE_PERMISSIONS[role]) expect(isPermission(permission)).toBe(true);
    }
  });

  it("unions the permissions of several roles and ignores unknown role names", () => {
    const granted = permissionsForRoles("viewer, not-a-role");
    expect(granted.has("investigation:read")).toBe(true);
    expect(granted.has("investigation:create")).toBe(false);
    expect(permissionsForRoles("viewer,analyst").has("investigation:create")).toBe(true);
    expect(permissionsForRoles("superuser").size).toBe(0);
    expect(permissionsForRoles("").size).toBe(0);
  });

  it("does not let a viewer manage API keys, credentials or members", () => {
    const viewer = permissionsForRoles("viewer");
    for (const permission of [
      "api_key:manage",
      "credential:read",
      "member:create",
      "member:update",
      "member:delete",
      "invitation:create",
      "invitation:cancel",
    ] as const) {
      expect(viewer.has(permission)).toBe(false);
    }
  });

  it("lets every role see the team, and only administrators change it", () => {
    for (const role of ROLES) {
      expect(permissionsForRoles(role).has("member:read"), `${role} reads members`).toBe(true);
    }
    for (const role of ["viewer", "analyst"] as const) {
      const granted = permissionsForRoles(role);
      for (const permission of ["member:create", "member:update", "member:delete"] as const) {
        expect(granted.has(permission), `${role} ${permission}`).toBe(false);
      }
    }
    for (const role of ["admin", "owner"] as const) {
      const granted = permissionsForRoles(role);
      for (const permission of ["member:create", "member:update", "member:delete"] as const) {
        expect(granted.has(permission), `${role} ${permission}`).toBe(true);
      }
    }
  });
});

describe("module gating", () => {
  const cases: [Plan, VettingStatus, "allowed" | "MODULE_NOT_IN_PLAN" | "VETTING_NOT_APPROVED"][] =
    PLANS.flatMap((plan) =>
      VETTING_STATUSES.map(
        (
          vetting,
        ): [Plan, VettingStatus, "allowed" | "MODULE_NOT_IN_PLAN" | "VETTING_NOT_APPROVED"] => {
          if (!PLAN_MODULES[plan].includes("PERSON_INVESTIGATION"))
            return [plan, vetting, "MODULE_NOT_IN_PLAN"];
          return [plan, vetting, vetting === "APPROVED" ? "allowed" : "VETTING_NOT_APPROVED"];
        },
      ),
    );

  it.each(cases)(
    "person investigation on plan %s with vetting %s: %s",
    (plan, vettingStatus, expected) => {
      const decision = decideModuleAccess({ plan, vettingStatus }, "PERSON_INVESTIGATION");
      expect(decision.allowed ? "allowed" : decision.reason).toBe(expected);
    },
  );

  it("requires approved vetting even on a plan that includes person investigation", () => {
    expect(
      decidePermissionModuleAccess(
        { plan: "TECHINT_AND_PERSON", vettingStatus: "PENDING" },
        "person:search",
      ),
    ).toEqual({ allowed: false, reason: "VETTING_NOT_APPROVED" });
  });

  it("requires the plan even when vetting is approved", () => {
    expect(
      decidePermissionModuleAccess({ plan: "TECHINT", vettingStatus: "APPROVED" }, "person:search"),
    ).toEqual({ allowed: false, reason: "MODULE_NOT_IN_PLAN" });
  });

  it("does not vetting-gate the technical module", () => {
    expect(
      decidePermissionModuleAccess(
        { plan: "TECHINT", vettingStatus: "NOT_SUBMITTED" },
        "investigation:create",
      ),
    ).toEqual({ allowed: true });
  });

  it("gates PERSON collectors on BOTH the plan and approved vetting, and no other discipline", () => {
    for (const plan of PLANS) {
      for (const vettingStatus of VETTING_STATUSES) {
        const person = decideDisciplineAccess({ plan, vettingStatus }, "PERSON");
        const expected =
          plan === "TECHINT_AND_PERSON" && vettingStatus === "APPROVED" ? "allowed" : "refused";
        expect(person.allowed ? "allowed" : "refused").toBe(expected);
        for (const discipline of ["TECHINT", "SOCMINT", "MEDIAINT", "GEOINT"] as const) {
          expect(decideDisciplineAccess({ plan, vettingStatus }, discipline)).toEqual({
            allowed: true,
          });
        }
      }
    }
  });

  it("never gates account administration", () => {
    expect(
      decidePermissionModuleAccess({ plan: "TECHINT", vettingStatus: "SUSPENDED" }, "audit:read"),
    ).toEqual({ allowed: true });
  });
});

import { describe, expect, it } from "vitest";
import {
  ApiKeyScopeError,
  capApiKeyPermissions,
  grantableApiKeyScope,
  permissionsForRoles,
  ROLE_PERMISSIONS,
  type Permission,
} from "../index.ts";

const analyst = permissionsForRoles("analyst");

function scopeError(run: () => unknown): ApiKeyScopeError {
  try {
    run();
  } catch (error) {
    if (error instanceof ApiKeyScopeError) return error;
    throw error;
  }
  return expect.fail("expected an ApiKeyScopeError");
}

function scopeProblem(run: () => unknown): { problem: string; permissions: readonly string[] } {
  const { problem, permissions } = scopeError(run);
  return { problem, permissions };
}

describe("grantableApiKeyScope", () => {
  it("returns the requested scope de-duplicated, in request order", () => {
    expect(
      grantableApiKeyScope(
        ["investigation:read", "case:read", "investigation:read"],
        permissionsForRoles("viewer"),
      ),
    ).toEqual(["investigation:read", "case:read"]);
  });

  it("refuses an empty scope", () => {
    expect(scopeProblem(() => grantableApiKeyScope([], analyst))).toEqual({
      problem: "EMPTY",
      permissions: [],
    });
  });

  it("refuses permissions that do not exist, naming them", () => {
    expect(
      scopeProblem(() => grantableApiKeyScope(["investigation:read", "ALL"], analyst)),
    ).toEqual({ problem: "UNKNOWN_PERMISSION", permissions: ["ALL"] });
  });

  it("refuses permissions the grantor does not hold, naming them", () => {
    expect(
      scopeProblem(() => grantableApiKeyScope(["investigation:read", "audit:read"], analyst)),
    ).toEqual({ problem: "EXCEEDS_GRANTOR", permissions: ["audit:read"] });
  });

  it("carries a machine-readable code", () => {
    expect(scopeError(() => grantableApiKeyScope([], analyst)).code).toBe("API_KEY_SCOPE_INVALID");
  });
});

describe("capApiKeyPermissions", () => {
  const adminScope: ReadonlySet<Permission> = new Set(ROLE_PERMISSIONS.admin);

  it("leaves a key untouched while its issuer still holds every permission in it", () => {
    expect([...capApiKeyPermissions(adminScope, "admin")].sort()).toEqual(
      [...ROLE_PERMISSIONS.admin].sort(),
    );
  });

  it("narrows a key to what its issuer can do today after a demotion", () => {
    const capped = capApiKeyPermissions(adminScope, "viewer");
    expect([...capped].sort()).toEqual([...ROLE_PERMISSIONS.viewer].sort());
    expect(capped.has("api_key:manage")).toBe(false);
  });

  it("never widens a key beyond its own scope, whatever the issuer holds", () => {
    const narrow: ReadonlySet<Permission> = new Set(["investigation:read"]);
    expect([...capApiKeyPermissions(narrow, "owner")]).toEqual(["investigation:read"]);
  });

  it("grants nothing when the issuer's roles are unknown or empty", () => {
    expect(capApiKeyPermissions(adminScope, "not-a-role").size).toBe(0);
    expect(capApiKeyPermissions(adminScope, "").size).toBe(0);
  });
});

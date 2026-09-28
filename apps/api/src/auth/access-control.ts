import { PERMISSIONS, ROLE_PERMISSIONS, ROLES, type Permission, type Role } from "@repo/access";
import { createAccessControl } from "better-auth/plugins/access";

type Statements = Record<string, readonly string[]>;

/** `["member:create", "member:delete"]` → `{ member: ["create", "delete"] }`. */
function group(permissions: readonly Permission[]): Record<string, string[]> {
  const grouped: Record<string, string[]> = {};
  for (const permission of permissions) {
    const [resource, action] = permission.split(":") as [string, string];
    (grouped[resource] ??= []).push(action);
  }
  return grouped;
}

/**
 * The identity provider's access control, generated from the one permission
 * catalogue in @repo/access. Its own endpoints (invite, change a member's role)
 * and this API's route guard therefore check the same role-to-permission map.
 */
export const accessControl = createAccessControl(group(PERMISSIONS) as Statements);

export const accessControlRoles = Object.fromEntries(
  ROLES.map((role) => [role, accessControl.newRole(group(ROLE_PERMISSIONS[role]))]),
) as Record<Role, ReturnType<typeof accessControl.newRole>>;

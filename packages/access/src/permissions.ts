/**
 * Access control vocabulary. Authorisation checks test PERMISSIONS; roles are
 * only a named mapping onto permission sets and are never compared by name
 * (ARCHITECTURE-DECISIONS §4). Additive only: add entries, never rename.
 */

/**
 * Every permission, as `resource:action`. The first group gates this
 * product's own routes; the second gates the identity provider's organisation
 * endpoints (inviting and managing members), so one catalogue governs both.
 */
export const PERMISSIONS = [
  "profile:read",
  "tenant:read",
  "investigation:create",
  "investigation:read",
  "case:read",
  "case:write",
  "evidence:read",
  "person:search",
  "audit:read",
  "api_key:manage",
  "credential:read",
  "credential:write",

  "organization:update",
  "organization:delete",
  "member:create",
  "member:update",
  "member:delete",
  "invitation:create",
  "invitation:cancel",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

/** Feature modules a plan can include. */
export const MODULES = ["TECHINT", "PERSON_INVESTIGATION"] as const;
export type Module = (typeof MODULES)[number];

/**
 * The module each permission belongs to. A permission mapped to a module is
 * usable only when the tenant's plan includes that module (and, for gated
 * modules, the tenant's vetting is approved). Account administration belongs
 * to no module and is always available to those who hold it.
 */
export const PERMISSION_MODULE: Readonly<Record<Permission, Module | null>> = {
  "profile:read": null,
  "tenant:read": null,
  "investigation:create": "TECHINT",
  "investigation:read": "TECHINT",
  "case:read": "TECHINT",
  "case:write": "TECHINT",
  "evidence:read": "TECHINT",
  "person:search": "PERSON_INVESTIGATION",
  "audit:read": null,
  "api_key:manage": null,
  "credential:read": null,
  "credential:write": null,
  "organization:update": null,
  "organization:delete": null,
  "member:create": null,
  "member:update": null,
  "member:delete": null,
  "invitation:create": null,
  "invitation:cancel": null,
};

/** Role names, as stored on a membership. */
export const ROLES = ["owner", "admin", "analyst", "viewer"] as const;
export type Role = (typeof ROLES)[number];

const READ_ONLY: readonly Permission[] = [
  "profile:read",
  "tenant:read",
  "investigation:read",
  "case:read",
  "evidence:read",
];

const ANALYST: readonly Permission[] = [
  ...READ_ONLY,
  "investigation:create",
  "case:write",
  "person:search",
];

const ADMIN: readonly Permission[] = [
  ...ANALYST,
  "audit:read",
  "api_key:manage",
  "credential:read",
  "credential:write",
  "organization:update",
  "member:create",
  "member:update",
  "member:delete",
  "invitation:create",
  "invitation:cancel",
];

/** Each role's permission set. Holding `person:search` does not bypass the module gate. */
export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  owner: [...ADMIN, "organization:delete"],
  admin: ADMIN,
  analyst: ANALYST,
  viewer: READ_ONLY,
};

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

/**
 * The union of permissions granted by a membership's roles. The identity
 * provider stores several roles as a comma-separated string. An unknown role
 * name grants nothing.
 */
export function permissionsForRoles(roles: string): ReadonlySet<Permission> {
  const granted = new Set<Permission>();
  for (const name of roles.split(",").map((part) => part.trim())) {
    if (isRole(name)) for (const permission of ROLE_PERMISSIONS[name]) granted.add(permission);
  }
  return granted;
}

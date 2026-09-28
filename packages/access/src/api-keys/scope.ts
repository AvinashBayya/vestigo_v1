import { isPermission, permissionsForRoles, type Permission } from "../permissions.ts";
import { ApiKeyScopeError } from "./errors.ts";

/**
 * Validates a requested key scope when a key is issued or rotated: non-empty,
 * every entry a known permission, and every entry held by the grantor.
 * Returns it de-duplicated, in request order.
 */
export function grantableApiKeyScope(
  requested: readonly string[],
  grantor: ReadonlySet<Permission>,
): Permission[] {
  if (requested.length === 0) throw new ApiKeyScopeError("EMPTY", []);
  const unique = [...new Set(requested)];
  const unknown = unique.filter((permission) => !isPermission(permission));
  if (unknown.length > 0) throw new ApiKeyScopeError("UNKNOWN_PERMISSION", unknown);
  const scope = unique.filter(isPermission);
  const notHeld = scope.filter((permission) => !grantor.has(permission));
  if (notHeld.length > 0) throw new ApiKeyScopeError("EXCEEDS_GRANTOR", notHeld);
  return scope;
}

/**
 * What a key may do on this request: its scope, capped by what its issuer's
 * current roles grant. A key never does more than the person who issued it
 * can do today, so demoting the issuer narrows every key they issued.
 */
export function capApiKeyPermissions(
  scope: ReadonlySet<Permission>,
  issuerRoles: string,
): ReadonlySet<Permission> {
  const current = permissionsForRoles(issuerRoles);
  return new Set([...scope].filter((permission) => current.has(permission)));
}

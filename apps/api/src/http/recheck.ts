import {
  capApiKeyPermissions,
  isPermission,
  permissionsForRoles,
  type Permission,
} from "@repo/access";
import type { AuthStore, Tenant, TenantContext } from "@repo/db";
import { accessDenial, type AccessDenial } from "./access.ts";
import type { Locked, LockedError } from "./errors.ts";
import type { Principal } from "./principal.ts";

/**
 * Re-checking access while a long-lived response is open (the run progress
 * stream). Connect-time access is decided from the request: the session
 * cookie or the API key. A stream outlives that decision, so on every read it
 * is made again from what the principal recorded (session, user, key, issuer),
 * with the same rules: accessDenial (shared with every request) and the
 * shared person-data gate.
 *
 * The identity store is a separate database role, so its half is read before
 * the tenant transaction opens; a slow identity store never holds a tenant
 * connection.
 */

/** Why an open stream must close, in the order the checks run; the first failure wins. */
export const ACCESS_REFUSAL_REASONS = [
  /** The session ended (signed out or expired), or the API key was revoked or expired. */
  "CREDENTIAL_REVOKED",
  /** The person is no longer an active member of the tenant (for a key: its issuer). */
  "MEMBERSHIP_REVOKED",
  /** Still a member, but the current role no longer grants the permission. */
  "PERMISSION_LOST",
  /** The tenant's plan does not include the module. */
  "MODULE_NOT_IN_PLAN",
  /** The module needs approved vetting, and the tenant's is not. */
  "VETTING_NOT_APPROVED",
] as const;
export type AccessRefusalReason = (typeof ACCESS_REFUSAL_REASONS)[number];

export interface AccessRefusal {
  readonly reason: AccessRefusalReason;
  /** The code a fresh request would now be refused with. */
  readonly code: string;
  readonly message: string;
  /** The person-data gate's Locked block; null for every other refusal. */
  readonly locked: Locked | null;
}

/** The identity store's half of a principal's standing, read outside any tenant transaction. */
export type IdentityStanding =
  | {
      readonly kind: "session";
      readonly sessionLive: boolean;
      /** The membership's roles, or null when the person is no longer a member. */
      readonly membership: { readonly roles: string } | null;
    }
  | { readonly kind: "api_key"; readonly issuerRole: string | null };

export async function identityStanding(
  principal: Principal,
  authStore: AuthStore,
): Promise<IdentityStanding> {
  if (principal.kind === "session") {
    const standing = await authStore.findSessionStanding({
      sessionId: principal.sessionId,
      userId: principal.userId,
      organizationId: principal.tenantId,
    });
    return {
      kind: "session",
      sessionLive: standing.sessionLive,
      membership: standing.membership,
    };
  }
  return {
    kind: "api_key",
    issuerRole:
      principal.issuerUserId === null
        ? null
        : await authStore.findMemberRole(principal.tenantId, principal.issuerUserId),
  };
}

const REASON_BY_DENIAL: Readonly<Record<AccessDenial["code"], AccessRefusalReason>> = {
  MEMBER_INACTIVE: "MEMBERSHIP_REVOKED",
  PERMISSION_DENIED: "PERMISSION_LOST",
  MODULE_NOT_IN_PLAN: "MODULE_NOT_IN_PLAN",
  VETTING_NOT_APPROVED: "VETTING_NOT_APPROVED",
};

/**
 * Everything the access layer decided at connect, decided again now, inside
 * the tenant transaction. Null when the principal may still exercise the
 * permission. The person-data gate is separate (personLockFor).
 */
export async function recheckAccess(input: {
  readonly principal: Principal;
  readonly identity: IdentityStanding;
  readonly context: TenantContext;
  readonly tenant: Pick<Tenant, "plan" | "vettingStatus">;
  readonly permission: Permission;
}): Promise<AccessRefusal | null> {
  const { principal, identity, context } = input;
  let permissions: ReadonlySet<Permission>;
  let profileActive = true;

  if (principal.kind === "session") {
    if (identity.kind !== "session" || !identity.sessionLive) {
      return refusal("CREDENTIAL_REVOKED", "UNAUTHENTICATED", "The session has ended.");
    }
    if (identity.membership === null) {
      return refusal(
        "MEMBERSHIP_REVOKED",
        "NOT_A_MEMBER",
        "This account is no longer a member of this tenant.",
      );
    }
    permissions = permissionsForRoles(identity.membership.roles);
    profileActive = (await context.repos.users.findById(principal.userId))?.status === "ACTIVE";
  } else {
    const key = await context.repos.apiKeys.findUsable(principal.apiKeyId);
    if (key === null) {
      return refusal(
        "CREDENTIAL_REVOKED",
        "API_KEY_INVALID",
        "The API key was revoked or has expired.",
      );
    }
    const scope = new Set(key.permissions.filter(isPermission));
    if (principal.issuerUserId === null) {
      permissions = scope;
    } else {
      const issuerRole = identity.kind === "api_key" ? identity.issuerRole : null;
      if (issuerRole === null) {
        return refusal(
          "MEMBERSHIP_REVOKED",
          "API_KEY_INVALID",
          "The person who issued this API key is no longer a member of this tenant.",
        );
      }
      // A key never does more than its issuer can do today.
      permissions = capApiKeyPermissions(scope, issuerRole);
    }
  }

  const denial = accessDenial({
    tenant: input.tenant,
    profileActive,
    permissions,
    permission: input.permission,
  });
  if (denial === null) return null;
  return refusal(REASON_BY_DENIAL[denial.code], denial.code, denial.message);
}

/** The person-data gate's refusal, in the same shape. */
export function refusalFromLock(lock: LockedError): AccessRefusal {
  return {
    reason: lock.locked.reason,
    code: lock.code,
    message: lock.message,
    locked: lock.locked,
  };
}

function refusal(reason: AccessRefusalReason, code: string, message: string): AccessRefusal {
  return { reason, code, message, locked: null };
}

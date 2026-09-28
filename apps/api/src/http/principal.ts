import {
  capApiKeyPermissions,
  parseApiKey,
  permissionsForRoles,
  type Permission,
} from "@repo/access";
import { parseTenantId, type TenantId } from "@repo/core";
import type { AuthStore, Database } from "@repo/db";
import type { ApiKeyService, FixedWindowRateLimiter } from "@repo/integrations";
import type { FastifyRequest } from "fastify";
import type { Auth } from "../auth/better-auth.ts";
import { forbidden, HttpError, unauthenticated } from "./errors.ts";

/** Who is acting, for which tenant, with which permissions. */
export type Principal =
  | {
      readonly kind: "session";
      readonly tenantId: TenantId;
      readonly userId: string;
      readonly sessionId: string;
      readonly permissions: ReadonlySet<Permission>;
    }
  | {
      readonly kind: "api_key";
      readonly tenantId: TenantId;
      readonly apiKeyId: string;
      /** The person who issued the key (through any chain of keys), or null for a system key. */
      readonly issuerUserId: string | null;
      readonly permissions: ReadonlySet<Permission>;
    };

export interface PrincipalServices {
  readonly auth: Auth;
  readonly authStore: AuthStore;
  readonly db: Database;
  readonly apiKeys: ApiKeyService;
  readonly rateLimiter: FixedWindowRateLimiter;
  readonly apiKeyRateLimit: { readonly limit: number; readonly windowSeconds: number };
  /** Origins allowed to send cookie-authenticated state-changing requests. */
  readonly trustedOrigins: ReadonlySet<string>;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function toFetchHeaders(headers: FastifyRequest["headers"]): Headers {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) result.append(name, item);
  }
  return result;
}

/**
 * Resolves the caller. An `Authorization: Bearer` header means an API key and
 * nothing else; otherwise the session cookie. The tenant comes from the
 * verified key or the session's active, verified membership, never from
 * anything else the request says.
 */
export async function resolvePrincipal(
  request: FastifyRequest,
  services: PrincipalServices,
): Promise<Principal> {
  const authorization = request.headers.authorization;
  if (authorization !== undefined) return resolveApiKey(authorization, services);
  return resolveSession(request, services);
}

async function resolveApiKey(
  authorization: string,
  services: PrincipalServices,
): Promise<Principal> {
  const token = /^Bearer (\S+)$/.exec(authorization)?.[1];
  if (token === undefined) throw unauthenticated("Unsupported authorization scheme.");
  const parsed = parseApiKey(token);
  if (parsed === null) throw new HttpError(401, "API_KEY_INVALID", "The API key is not valid.");

  // Counted before the key is checked, so guessing a key's secret is limited too.
  const decision = await services.rateLimiter.consume(
    `api-key:${parsed.tenantId}:${parsed.keyId}`,
    {
      limit: services.apiKeyRateLimit.limit,
      windowSeconds: services.apiKeyRateLimit.windowSeconds,
    },
  );
  if (!decision.allowed) {
    throw new HttpError(
      429,
      "RATE_LIMITED",
      "This API key has exceeded its request limit.",
      decision.retryAfterSeconds,
    );
  }

  const key = await services.db.withTenant(parsed.tenantId, async (context) => {
    const authenticated = await services.apiKeys.authenticate(context, parsed);
    const row = await context.repos.apiKeys.findById(authenticated.apiKeyId);
    return { ...authenticated, issuerUserId: row === null ? null : row.createdByUserId };
  });

  // A key can never do more than the person who issued it can do today: its
  // scope is capped by the issuer's current role, and it stops working when
  // the issuer leaves the tenant.
  let permissions = key.permissions;
  if (key.issuerUserId !== null) {
    const role = await services.authStore.findMemberRole(key.tenantId, key.issuerUserId);
    if (role === null) throw new HttpError(401, "API_KEY_INVALID", "The API key is not valid.");
    permissions = capApiKeyPermissions(permissions, role);
  }
  return {
    kind: "api_key",
    tenantId: key.tenantId,
    apiKeyId: key.apiKeyId,
    issuerUserId: key.issuerUserId,
    permissions,
  };
}

async function resolveSession(
  request: FastifyRequest,
  services: PrincipalServices,
): Promise<Principal> {
  const session = await services.auth.api.getSession({ headers: toFetchHeaders(request.headers) });
  if (session === null) throw unauthenticated();
  if (session.user.twoFactorEnabled !== true) {
    throw forbidden(
      "MFA_ENROLLMENT_REQUIRED",
      "Enrol in multi-factor authentication before using this account.",
    );
  }
  if (!SAFE_METHODS.has(request.method)) {
    const origin = request.headers.origin;
    if (origin === undefined || !services.trustedOrigins.has(origin)) {
      throw forbidden(
        "ORIGIN_NOT_ALLOWED",
        "Cookie-authenticated changes must come from a trusted origin.",
      );
    }
  }
  const active = session.session.activeOrganizationId;
  if (typeof active !== "string") {
    throw forbidden("NO_ACTIVE_TENANT", "Choose a tenant first (organization/set-active).");
  }
  const role = await services.authStore.findMemberRole(active, session.user.id);
  if (role === null)
    throw forbidden("NOT_A_MEMBER", "This account is not a member of that tenant.");
  return {
    kind: "session",
    tenantId: parseTenantId(active),
    userId: session.user.id,
    sessionId: session.session.id,
    permissions: permissionsForRoles(role),
  };
}

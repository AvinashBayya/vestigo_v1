import { AsyncLocalStorage } from "node:async_hooks";
import { PRODUCT_NAME, type Env } from "@repo/config";
import { parseTenantId, TENANT_REGIONS, type TenantRegion } from "@repo/core";
import type { AuthStore, Database } from "@repo/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { organization, twoFactor } from "better-auth/plugins";
import { accessControl, accessControlRoles } from "./access-control.ts";
import { auditOrganizationEvent } from "./org-audit.ts";

export interface AuthOptions {
  readonly authStore: AuthStore;
  readonly db: Database;
  readonly secret: string;
  /** Public base URL of this API. */
  readonly baseUrl: string;
  /** Origins allowed to send cookie-authenticated requests. */
  readonly trustedOrigins: readonly string[];
  /** Brute-force limits on sign-in and the other auth endpoints. */
  readonly rateLimit: { readonly enabled: boolean };
  /** The application's LOG_LEVEL. The identity provider follows it down, never below warn. */
  readonly logLevel: Env["LOG_LEVEL"];
}

/**
 * The identity provider's own log level, for the application's LOG_LEVEL.
 *
 * It follows the application down (error, silent) but NEVER below "warn",
 * however verbose the application is. Better Auth's info-level messages
 * carry raw personal data: a sign-up for an existing account logs "Sign-up
 * attempt for existing email: <the address>". They also go straight to the
 * console, bypassing the structured logger. Logging personal data breaks
 * CLAUDE.md §8. Do not raise this. test/identity-logging.test.ts fails if
 * any LOG_LEVEL the configuration accepts would let Better Auth publish its
 * debug, info or success output.
 */
function identityProviderLogger(level: Env["LOG_LEVEL"]): {
  readonly disabled: boolean;
  readonly level: "warn" | "error";
} {
  switch (level) {
    case "silent":
      return { disabled: true, level: "error" };
    case "fatal":
    case "error":
      return { disabled: false, level: "error" };
    case "warn":
    case "info":
    case "debug":
    case "trace":
      return { disabled: false, level: "warn" };
  }
}

/** Only these identity-provider paths may be used before enrolling in MFA. */
const MFA_EXEMPT_PATHS = new Set([
  "/sign-in/email",
  "/sign-up/email",
  "/sign-out",
  "/get-session",
  "/two-factor/enable",
  "/two-factor/get-totp-uri",
  "/two-factor/verify-totp",
  "/two-factor/verify-backup-code",
  "/ok",
  "/error",
]);

/**
 * Organisation endpoints that have been reviewed and are exposed. Anything
 * else under /organization (including endpoints a library upgrade adds) is
 * refused until reviewed.
 */
const ORGANIZATION_PATHS = new Set([
  // Refused to every HTTP caller (allowUserToCreateOrganization: false); only
  // the server-side provisioning call, which has no request, can create one.
  "/organization/create",
  "/organization/set-active",
  "/organization/list",
  "/organization/get-full-organization",
  "/organization/update",
  "/organization/invite-member",
  "/organization/cancel-invitation",
  "/organization/accept-invitation",
  "/organization/reject-invitation",
  "/organization/get-invitation",
  "/organization/list-invitations",
  "/organization/list-user-invitations",
  "/organization/list-members",
  "/organization/get-active-member",
  "/organization/update-member-role",
  "/organization/remove-member",
  "/organization/leave",
  "/organization/has-permission",
]);

/** Paths refused outright: MFA can never be switched off. */
const FORBIDDEN_PATHS = new Set(["/two-factor/disable"]);

/**
 * Set only while an operator provisions a tenant (see provisioning.ts).
 * Outside it, sign-up requires a pending invitation.
 */
export const provisioningContext = new AsyncLocalStorage<{ readonly operator: string }>();

function regionOf(metadata: unknown): TenantRegion {
  const parsed: unknown = typeof metadata === "string" ? JSON.parse(metadata) : metadata;
  const region =
    typeof parsed === "object" && parsed !== null && "region" in parsed ? parsed.region : undefined;
  const known = TENANT_REGIONS.find((candidate) => candidate === region);
  if (known === undefined) {
    throw new APIError("BAD_REQUEST", {
      code: "TENANT_REGION_REQUIRED",
      message: "An organisation must be created with a known region in its metadata.",
    });
  }
  return known;
}

export function createAuth(options: AuthOptions) {
  const { authStore, db } = options;
  const tables = authStore.tables;

  /** Gives a joining identity its profile in the tenant it joined. */
  /**
   * Gives a joining identity its profile in the tenant it joined, creating the
   * tenant row first if it does not exist yet. The provider adds an
   * organisation's creator as a member (firing afterAddMember) before
   * afterCreateOrganization runs, so either hook may be first to see a new
   * tenant. Only provisioning can create an organisation, so a missing row can
   * only belong to a tenant being provisioned now.
   */
  const ensureTenantProfile = async (
    org: { readonly id: string; readonly name: string; readonly metadata?: unknown },
    user: { readonly id: string; readonly email: string; readonly name: string },
  ): Promise<void> => {
    await db.withTenant(parseTenantId(org.id), async ({ repos }) => {
      if ((await repos.tenants.current()) === null) {
        await repos.tenants.create({ name: org.name, region: regionOf(org.metadata) });
      }
      await repos.users.ensureMember({
        userId: user.id,
        email: user.email,
        displayName: user.name,
      });
    });
  };

  return betterAuth({
    appName: PRODUCT_NAME,
    baseURL: options.baseUrl,
    basePath: "/api/auth",
    secret: options.secret,
    trustedOrigins: [...options.trustedOrigins],
    // A data-sovereignty product sends nothing to the identity provider's vendor.
    telemetry: { enabled: false },
    // Never below "warn": Better Auth logs email addresses at info level
    // (CLAUDE.md §8). See identityProviderLogger; a test guards it.
    logger: identityProviderLogger(options.logLevel),
    database: drizzleAdapter(authStore.db, { provider: "pg", schema: { ...tables } }),
    advanced: {
      database: { generateId: "uuid" },
      // The API sets this header from the socket address and strips any
      // client-supplied copy, so it cannot be spoofed to dodge rate limits.
      ipAddress: { ipAddressHeaders: ["x-client-ip"] },
    },
    rateLimit: {
      enabled: options.rateLimit.enabled,
      storage: "database",
      modelName: "rateLimit",
    },
    session: {
      expiresIn: 60 * 60 * 12,
      updateAge: 60 * 60,
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      autoSignIn: false,
    },
    databaseHooks: {
      user: {
        create: {
          // Sign-up is by invitation only, except while an operator provisions
          // a tenant's first owner.
          before: async (user, context) => {
            // The provisioning bypass needs BOTH the operator context AND a
            // server-side call: an HTTP sign-up always carries a request.
            const serverSide = context === null || context.request === undefined;
            if (serverSide && provisioningContext.getStore() !== undefined) return;
            if (await authStore.hasPendingInvitation(user.email)) return;
            throw new APIError("FORBIDDEN", {
              code: "SIGN_UP_REQUIRES_INVITATION",
              message: "Accounts are created by invitation only.",
            });
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (FORBIDDEN_PATHS.has(ctx.path)) {
          throw new APIError("FORBIDDEN", {
            code: "MFA_REQUIRED",
            message: "Multi-factor authentication is required for every account.",
          });
        }
        if (ctx.path.startsWith("/organization/") && !ORGANIZATION_PATHS.has(ctx.path)) {
          throw new APIError("NOT_FOUND", { code: "ENDPOINT_NOT_EXPOSED", message: "Not found." });
        }
        if (MFA_EXEMPT_PATHS.has(ctx.path)) return;
        const session = await getSessionFromCtx(ctx);
        if (session !== null && session.user.twoFactorEnabled !== true) {
          throw new APIError("FORBIDDEN", {
            code: "MFA_ENROLLMENT_REQUIRED",
            message: "Enrol in multi-factor authentication before using this account.",
          });
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        await auditOrganizationEvent(db, ctx);
      }),
    },
    plugins: [
      twoFactor({
        issuer: PRODUCT_NAME,
        backupCodeOptions: { storeBackupCodes: "encrypted" },
      }),
      organization({
        ac: accessControl,
        roles: accessControlRoles,
        creatorRole: "owner",
        // Tenants are created by provisioning only; nobody can create or
        // delete one through the API.
        allowUserToCreateOrganization: false,
        disableOrganizationDeletion: true,
        cancelPendingInvitationsOnReInvite: true,
        organizationHooks: {
          afterCreateOrganization: async ({ organization: org, user }) => {
            const tenantId = parseTenantId(org.id);
            await ensureTenantProfile(org, user);
            await db.withTenant(tenantId, async ({ repos }) => {
              const provisioning = provisioningContext.getStore();
              await repos.auditLog.append({
                actor: { kind: "SYSTEM" },
                action: "tenant.provision",
                target: { type: "tenant", id: tenantId },
                details: {
                  operator: provisioning === undefined ? null : provisioning.operator,
                  owner_user_id: user.id,
                },
                authorization: { method: "SYSTEM", permission: null, sessionId: null },
                outcome: "ALLOWED",
                requestId: null,
              });
            });
          },
          afterAddMember: async ({ organization: org, user }) => {
            await ensureTenantProfile(org, user);
          },
          afterAcceptInvitation: async ({ organization: org, user }) => {
            await ensureTenantProfile(org, user);
          },
          afterRemoveMember: async ({ organization: org, user }) => {
            await db.withTenant(parseTenantId(org.id), ({ repos }) => repos.users.disable(user.id));
          },
        },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

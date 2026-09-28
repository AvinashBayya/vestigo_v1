import { decidePermissionModuleAccess, isPermission, type Permission } from "@repo/access";
import { AppError, NotImplementedError, type TenantId } from "@repo/core";
import type { Tenant, TenantContext } from "@repo/db";
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  RouteHandlerMethod,
  RouteOptions,
} from "fastify";
import { forbidden } from "./errors.ts";
import type { Principal } from "./principal.ts";

/**
 * What every route must declare (CLAUDE.md, Phase 2B): either the permission
 * it requires and the audit action it records, or that it is public and why.
 */
export type RouteAccess =
  { readonly permission: Permission; readonly action: string } | { readonly public: string };

export interface RequestTenant extends TenantContext {
  readonly tenant: Tenant;
  readonly principal: Principal;
}

declare module "fastify" {
  interface FastifyContextConfig {
    access?: RouteAccess;
  }
  interface FastifyRequest {
    principal: Principal | null;
    /** Set for the duration of a protected handler: the request's tenant transaction. */
    tenant: RequestTenant | null;
    /** What the handler acted on, for its audit row. */
    auditTarget: { readonly type: string; readonly id: string } | null;
  }
}

export class RouteAccessError extends AppError {
  readonly code = "ROUTE_ACCESS_UNDECLARED";

  constructor(method: string, url: string, problem: string) {
    super(`${method} ${url}: ${problem}`);
    this.name = "RouteAccessError";
  }
}

const ACTION = /^[a-z][a-z_]*(\.[a-z][a-z_]*)+$/;

export interface DeclaredRoute {
  readonly method: string;
  readonly url: string;
  readonly access: RouteAccess;
}

export interface AccessServices {
  readonly authenticate: (request: FastifyRequest) => Promise<Principal>;
  readonly withTenant: <T>(
    tenantId: TenantId,
    work: (context: TenantContext) => Promise<T>,
  ) => Promise<T>;
}

/** The request's tenant transaction, for handlers of protected routes. */
export function tenantOf(request: FastifyRequest): RequestTenant {
  if (request.tenant === null) {
    throw new NotImplementedError("tenant", "this handler was not wrapped by the access layer");
  }
  return request.tenant;
}

function methods(route: RouteOptions): string {
  return Array.isArray(route.method) ? route.method.join(",") : String(route.method);
}

function auditActor(principal: Principal) {
  return principal.kind === "session"
    ? ({ kind: "USER", userId: principal.userId } as const)
    : ({ kind: "API_KEY", apiKeyId: principal.apiKeyId } as const);
}

function auditAuthorization(principal: Principal, permission: Permission) {
  return principal.kind === "session"
    ? { method: "SESSION" as const, permission, sessionId: principal.sessionId }
    : { method: "API_KEY" as const, permission, sessionId: null };
}

/**
 * Makes access declarations mandatory and enforced. Every route registered
 * after this runs must declare `config.access`, or registration throws and
 * the app does not start. A protected route gets:
 *   - authentication before validation (onRequest);
 *   - one tenant transaction around the handler, with the tenant taken from
 *     the session or API key, never from the request;
 *   - the permission check, then the plan and vetting gate for the
 *     permission's module;
 *   - an audit row: DENIED, or ALLOWED in the same transaction as the action,
 *     or FAILED in its own transaction if the handler threw.
 */
export function enforceRouteAccess(
  app: FastifyInstance,
  services: () => AccessServices,
  declared: DeclaredRoute[],
): void {
  app.decorateRequest("principal", null);
  app.decorateRequest("tenant", null);
  app.decorateRequest("auditTarget", null);

  app.addHook("onRoute", (route) => {
    const access = route.config?.access;
    if (access === undefined) {
      throw new RouteAccessError(methods(route), route.url, "no access declared (config.access)");
    }
    declared.push({ method: methods(route), url: route.url, access });
    if ("public" in access) {
      if (access.public.trim().length < 10) {
        throw new RouteAccessError(
          methods(route),
          route.url,
          "a public route must say why it is public",
        );
      }
      return;
    }
    if (!isPermission(access.permission)) {
      throw new RouteAccessError(
        methods(route),
        route.url,
        `unknown permission "${String(access.permission)}"`,
      );
    }
    if (!ACTION.test(access.action)) {
      throw new RouteAccessError(
        methods(route),
        route.url,
        `malformed audit action "${access.action}"`,
      );
    }

    const authenticate = async (request: FastifyRequest) => {
      request.principal = await services().authenticate(request);
    };
    const existing = route.onRequest;
    route.onRequest = [
      authenticate,
      ...(existing === undefined ? [] : Array.isArray(existing) ? existing : [existing]),
    ];
    route.handler = protect(route.handler, access, route.url, services);
  });
}

function protect(
  handler: RouteHandlerMethod,
  access: { readonly permission: Permission; readonly action: string },
  url: string,
  services: () => AccessServices,
): RouteHandlerMethod {
  return async function protectedHandler(
    this: FastifyInstance,
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<unknown> {
    const principal = request.principal;
    if (principal === null)
      throw new RouteAccessError(request.method, url, "no principal was resolved");
    const { withTenant } = services();
    const base = {
      actor: auditActor(principal),
      authorization: auditAuthorization(principal, access.permission),
      requestId: request.id,
    };

    // An object, because the flag is set inside the transaction's callback.
    const progress = { handlerStarted: false };
    try {
      const result = await withTenant(principal.tenantId, async (context) => {
        const tenant = await context.repos.tenants.current();
        if (tenant === null) {
          throw forbidden("TENANT_NOT_PROVISIONED", "This tenant has not been provisioned.");
        }

        let denial: { code: string; message: string } | null = null;
        if (principal.kind === "session") {
          const profile = await context.repos.users.findById(principal.userId);
          if (profile === null || profile.status !== "ACTIVE") {
            denial = {
              code: "MEMBER_INACTIVE",
              message: "This account is not active in this tenant.",
            };
          }
        }
        if (denial === null && !principal.permissions.has(access.permission)) {
          denial = {
            code: "PERMISSION_DENIED",
            message: `This action requires the ${access.permission} permission.`,
          };
        }
        if (denial === null) {
          const decision = decidePermissionModuleAccess(tenant, access.permission);
          if (!decision.allowed) {
            denial =
              decision.reason === "VETTING_NOT_APPROVED"
                ? {
                    code: "VETTING_NOT_APPROVED",
                    message: "This module requires the tenant's vetting to be approved.",
                  }
                : {
                    code: "MODULE_NOT_IN_PLAN",
                    message: "This module is not included in the tenant's plan.",
                  };
          }
        }
        if (denial !== null) {
          await context.repos.auditLog.append({
            ...base,
            action: access.action,
            target: null,
            details: { method: request.method, route: url, reason: denial.code },
            outcome: "DENIED",
          });
          return { denied: denial } as const;
        }

        request.tenant = { ...context, tenant, principal };
        progress.handlerStarted = true;
        try {
          const value: unknown = await handler.call(this, request, reply);
          await context.repos.auditLog.append({
            ...base,
            action: access.action,
            target: request.auditTarget,
            details: { method: request.method, route: url },
            outcome: "ALLOWED",
          });
          return { value } as const;
        } finally {
          request.tenant = null;
        }
      });
      if ("denied" in result) throw forbidden(result.denied.code, result.denied.message);
      return result.value;
    } catch (error) {
      if (progress.handlerStarted) {
        // The action's transaction rolled back; record the attempt on its own.
        const code = error instanceof AppError ? error.code : "INTERNAL_ERROR";
        await withTenant(principal.tenantId, ({ repos }) =>
          repos.auditLog.append({
            ...base,
            action: access.action,
            target: request.auditTarget,
            details: { method: request.method, route: url, error: code },
            outcome: "FAILED",
          }),
        ).catch((auditError: unknown) => {
          request.log.error(
            { err: auditError },
            "could not record a failed action in the audit log",
          );
        });
      }
      throw error;
    }
  };
}

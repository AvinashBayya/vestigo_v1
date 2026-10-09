import { decidePermissionModuleAccess, isPermission, type Permission } from "@repo/access";
import { AppError, NotImplementedError, type LockReason, type TenantId } from "@repo/core";
import {
  SnapshotConflictError,
  type Tenant,
  type TenantContext,
  type TenantTransactionOptions,
} from "@repo/db";
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
 *
 * `snapshot: true` runs the request's transaction on one snapshot (REPEATABLE
 * READ), so a gated read and its person probe see the same data whatever
 * commits meanwhile (owner ruling D-32). Every gated read declares it
 * (packages/config/scripts/person-gate-guard.ts). A request that conflicts with
 * a concurrent commit is run again once, from the start, in a new transaction.
 */
export type ProtectedAccess = {
  readonly permission: Permission;
  readonly action: string;
  readonly snapshot?: true;
};
export type RouteAccess = ProtectedAccess | { readonly public: string };

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
    /** Work the handler deferred until its transaction committed (see afterCommit). */
    afterCommit: (() => Promise<unknown>) | null;
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
    options?: TenantTransactionOptions,
  ) => Promise<T>;
}

/** The request's tenant transaction, for handlers of protected routes. */
export function tenantOf(request: FastifyRequest): RequestTenant {
  if (request.tenant === null) {
    throw new NotImplementedError("tenant", "this handler was not wrapped by the access layer");
  }
  return request.tenant;
}

/** The signed-in person behind a request, for acts that must be attributable to one. */
export type SessionPrincipal = Extract<Principal, { readonly kind: "session" }>;

/**
 * Refuses an API key. For judgements and membership changes: the record of who
 * decided must name a person who did decide it, not the person who issued a
 * key that a program then used (403 SESSION_REQUIRED).
 */
export function sessionPrincipalOf(request: FastifyRequest, what: string): SessionPrincipal {
  const { principal } = tenantOf(request);
  if (principal.kind !== "session") {
    throw forbidden("SESSION_REQUIRED", `${what}: a signed-in person is required, not an API key.`);
  }
  return principal;
}

/**
 * Runs `work` once the request's tenant transaction has committed (its audit
 * row included), and answers the request with `work`'s result instead of the
 * handler's. For work that needs no database and can take time, such as
 * rendering an export or sending a stored file: holding the transaction open
 * through it leaves the connection idle in transaction until the server ends
 * it (Phase 5 live checkpoint). `work` has no tenant transaction: tenantOf
 * throws inside it. If `work` fails, the failure is audited in a transaction
 * of its own, after the ALLOWED row the handler's transaction recorded.
 */
export function afterCommit(request: FastifyRequest, work: () => Promise<unknown>): void {
  if (request.tenant === null) {
    throw new NotImplementedError("tenant", "afterCommit is for protected handlers only");
  }
  if (request.afterCommit !== null) {
    throw new NotImplementedError("afterCommit", "a handler defers at most one piece of work");
  }
  request.afterCommit = work;
}

/** Why a principal may not exercise a permission in its tenant right now. */
export interface AccessDenial {
  readonly code: "MEMBER_INACTIVE" | "PERMISSION_DENIED" | LockReason;
  readonly message: string;
}

/**
 * The access decision after authentication: the member's profile is active,
 * the permission is held, and the tenant's plan and vetting allow the
 * permission's module. Every protected request makes it once (enforceRouteAccess),
 * and the run progress stream makes it again on every read, so the two can
 * never disagree about what is allowed.
 */
export function accessDenial(input: {
  readonly tenant: Pick<Tenant, "plan" | "vettingStatus">;
  /** Whether the member's profile in this tenant is active; true for an API key, which has none. */
  readonly profileActive: boolean;
  readonly permissions: ReadonlySet<Permission>;
  readonly permission: Permission;
}): AccessDenial | null {
  if (!input.profileActive) {
    return { code: "MEMBER_INACTIVE", message: "This account is not active in this tenant." };
  }
  if (!input.permissions.has(input.permission)) {
    return {
      code: "PERMISSION_DENIED",
      message: `This action requires the ${input.permission} permission.`,
    };
  }
  const decision = decidePermissionModuleAccess(input.tenant, input.permission);
  if (decision.allowed) return null;
  return decision.reason === "VETTING_NOT_APPROVED"
    ? {
        code: "VETTING_NOT_APPROVED",
        message: "This module requires the tenant's vetting to be approved.",
      }
    : { code: "MODULE_NOT_IN_PLAN", message: "This module is not included in the tenant's plan." };
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
 *     or FAILED in its own transaction if the handler threw;
 *   - any work the handler deferred with afterCommit, run once the
 *     transaction has committed (and audited FAILED if it throws).
 */
export function enforceRouteAccess(
  app: FastifyInstance,
  services: () => AccessServices,
  declared: DeclaredRoute[],
): void {
  app.decorateRequest("principal", null);
  app.decorateRequest("tenant", null);
  app.decorateRequest("auditTarget", null);
  app.decorateRequest("afterCommit", null);

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

/** Runs of a snapshot request: the first, and one more if a concurrent commit conflicted. */
const SNAPSHOT_RUNS = 2;

function protect(
  handler: RouteHandlerMethod,
  access: ProtectedAccess,
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

    const options: TenantTransactionOptions = { snapshot: access.snapshot === true };
    for (let run = 1; ; run += 1) {
      // An object, because the flag is set inside the transaction's callback.
      const progress = { handlerStarted: false };
      try {
        const result = await withTenant(
          principal.tenantId,
          async (context) => {
            const tenant = await context.repos.tenants.current();
            if (tenant === null) {
              throw forbidden("TENANT_NOT_PROVISIONED", "This tenant has not been provisioned.");
            }

            const profileActive =
              principal.kind === "session"
                ? (await context.repos.users.findById(principal.userId))?.status === "ACTIVE"
                : true;
            const denial = accessDenial({
              tenant,
              profileActive,
              permissions: principal.permissions,
              permission: access.permission,
            });
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
          },
          options,
        );
        if ("denied" in result) throw forbidden(result.denied.code, result.denied.message);
        // Committed. Deferred work runs now, outside any transaction.
        const deferred = request.afterCommit;
        if (deferred === null) return result.value;
        request.afterCommit = null;
        return await deferred();
      } catch (error) {
        // Work deferred by a handler whose transaction failed never runs.
        request.afterCommit = null;
        // A snapshot that conflicted with a concurrent commit wrote nothing: run
        // the request again, once, from the start, before anything is answered.
        if (
          error instanceof SnapshotConflictError &&
          options.snapshot === true &&
          run < SNAPSHOT_RUNS &&
          !reply.sent
        ) {
          request.auditTarget = null;
          continue;
        }
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
    }
  };
}

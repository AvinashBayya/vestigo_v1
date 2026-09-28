import type { Permission } from "@repo/access";
import { parseTenantId } from "@repo/core";
import type { Database } from "@repo/db";
import { getSessionFromCtx, isAPIError } from "better-auth/api";
import { z } from "zod";

type AfterHookContext = Parameters<typeof getSessionFromCtx>[0] & {
  readonly path: string;
  readonly body?: unknown;
  readonly query?: unknown;
  readonly headers?: Headers | undefined;
  readonly context: { readonly returned?: unknown };
};

const withOrganizationId = z.object({ organizationId: z.string(), id: z.string() });
const organizationShape = z.object({ id: z.string() });
const nested = (key: "invitation" | "member") =>
  z
    .object({ [key]: withOrganizationId })
    .transform((value) => value[key] as z.infer<typeof withOrganizationId>);
const organizationIdIn = z.object({ organizationId: z.string() });

interface EventSpec {
  readonly action: string;
  /** The permission the identity provider checked, for denied attempts. */
  readonly permission: Permission | null;
  readonly targetType: string;
  /** Tenant and target from a successful response. */
  readonly fromResult: (returned: unknown) => { tenant: string; target: string } | null;
}

const flat = (value: unknown) => {
  const parsed = withOrganizationId.safeParse(value);
  return parsed.success ? { tenant: parsed.data.organizationId, target: parsed.data.id } : null;
};
const within = (key: "invitation" | "member") => (value: unknown) => {
  const parsed = nested(key).safeParse(value);
  return parsed.success ? { tenant: parsed.data.organizationId, target: parsed.data.id } : null;
};
const organizationItself = (value: unknown) => {
  const parsed = organizationShape.safeParse(value);
  return parsed.success ? { tenant: parsed.data.id, target: parsed.data.id } : null;
};

/**
 * Tenant-scoped identity actions and how to attribute them. Read-only lookups
 * that only concern the caller (their own organisations and invitations) are
 * not tenant actions and are not listed.
 */
const EVENTS: Readonly<Record<string, EventSpec>> = {
  "/organization/invite-member": {
    action: "invitation.create",
    permission: "invitation:create",
    targetType: "invitation",
    fromResult: flat,
  },
  "/organization/cancel-invitation": {
    action: "invitation.cancel",
    permission: "invitation:cancel",
    targetType: "invitation",
    fromResult: flat,
  },
  "/organization/accept-invitation": {
    action: "invitation.accept",
    permission: null,
    targetType: "invitation",
    fromResult: within("invitation"),
  },
  "/organization/reject-invitation": {
    action: "invitation.reject",
    permission: null,
    targetType: "invitation",
    fromResult: within("invitation"),
  },
  "/organization/update-member-role": {
    action: "member.role_update",
    permission: "member:update",
    targetType: "member",
    fromResult: flat,
  },
  "/organization/remove-member": {
    action: "member.remove",
    permission: "member:delete",
    targetType: "member",
    fromResult: within("member"),
  },
  "/organization/leave": {
    action: "member.leave",
    permission: null,
    targetType: "member",
    fromResult: flat,
  },
  "/organization/set-active": {
    action: "tenant.set_active",
    permission: null,
    targetType: "tenant",
    fromResult: organizationItself,
  },
  "/organization/update": {
    action: "organization.update",
    permission: "organization:update",
    targetType: "tenant",
    fromResult: organizationItself,
  },
  "/organization/get-full-organization": {
    action: "organization.read",
    permission: null,
    targetType: "tenant",
    fromResult: organizationItself,
  },
};

/**
 * Writes an audit row, in the affected tenant, for every identity-provider
 * action that touches a tenant: invitations, membership and role changes,
 * switching tenant. A refused attempt (403) is recorded as DENIED against the
 * tenant it named.
 */
export async function auditOrganizationEvent(db: Database, ctx: AfterHookContext): Promise<void> {
  const spec = EVENTS[ctx.path];
  if (spec === undefined) return;
  const session = await getSessionFromCtx(ctx);
  if (session === null) return;

  const returned = ctx.context.returned;
  let tenant: string;
  let target: string | null;
  let outcome: "ALLOWED" | "DENIED";
  if (isAPIError(returned)) {
    if (returned.statusCode !== 403) return;
    // The provider's generic session type does not carry the organisation
    // plugin's field, so it is read as unknown and checked.
    const active: unknown = (session.session as Record<string, unknown>).activeOrganizationId;
    const named = organizationIdIn.safeParse(ctx.body).data?.organizationId ?? active;
    if (typeof named !== "string") return;
    tenant = named;
    target = null;
    outcome = "DENIED";
  } else {
    const attributed = spec.fromResult(returned);
    if (attributed === null) return;
    tenant = attributed.tenant;
    target = attributed.target;
    outcome = "ALLOWED";
  }

  await db.withTenant(parseTenantId(tenant), ({ repos }) =>
    repos.auditLog.append({
      actor: { kind: "USER", userId: session.user.id },
      action: spec.action,
      target: target === null ? null : { type: spec.targetType, id: target },
      details: { endpoint: ctx.path },
      authorization: {
        method: "SESSION",
        permission: spec.permission,
        sessionId: session.session.id,
      },
      outcome,
      // Set by this API's own mount from the Fastify request id; any
      // client-sent copy was overwritten there.
      requestId: ctx.headers?.get("x-request-id") ?? null,
    }),
  );
}

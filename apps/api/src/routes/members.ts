import { ROLES } from "@repo/access";
import { APIError } from "better-auth/api";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { sessionPrincipalOf, tenantOf } from "../http/access.ts";
import { HttpError, notFound, ProblemSchema } from "../http/errors.ts";
import { toFetchHeaders } from "../http/principal.ts";
import type { Services } from "../services.ts";
import { iso, LimitQuery, optionalInstant, page, PROTECTED_ERRORS, SECURITY } from "./schemas.ts";

const Role = z.enum(ROLES);

const MemberView = z.object({
  userId: z.uuid(),
  email: z.string(),
  displayName: z.string().nullable(),
  status: z.enum(["ACTIVE", "DISABLED"]),
  /** Null when the account is no longer a member of the tenant (removed). */
  role: Role.nullable(),
  createdAt: z.iso.datetime(),
});

const InvitationView = z.object({
  id: z.string(),
  email: z.string(),
  roles: z.array(Role),
  invitedByUserId: z.uuid(),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});

/** Identity-provider failures become typed problems; its message is the reason it gives. */
async function identity<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof APIError) {
      const status = error.statusCode;
      const body = error.body as { code?: unknown; message?: unknown } | undefined;
      const code = typeof body?.code === "string" ? body.code : "IDENTITY_REQUEST_REFUSED";
      const message = typeof body?.message === "string" ? body.message : "The request was refused.";
      throw new HttpError(status >= 400 && status < 500 ? status : 400, code, message);
    }
    throw error;
  }
}

export const memberRoutes =
  (services: () => Services): FastifyPluginAsyncZod =>
  (app) => {
    /**
     * Member changes go through the identity provider with the caller's own
     * session, so its checks (who may assign which role, the last owner) apply
     * on top of this route's permission. An API key has no session to act as.
     */
    const sessionHeaders = (request: Parameters<typeof tenantOf>[0]): Headers => {
      sessionPrincipalOf(request, "Changing membership");
      return toFetchHeaders(request.headers);
    };

    app.get(
      "/api/v1/members",
      {
        config: { access: { permission: "member:read", action: "member.list" } },
        schema: {
          operationId: "listMembers",
          summary: "List the tenant's members and their roles",
          tags: ["members"],
          security: SECURITY,
          querystring: LimitQuery,
          response: {
            200: z.object({ items: z.array(MemberView), hasMore: z.boolean() }),
            ...PROTECTED_ERRORS,
          },
        },
      },
      async (request) => {
        const { repos, principal } = tenantOf(request);
        const result = page(
          await repos.users.list({ limit: request.query.limit + 1 }),
          request.query.limit,
        );
        const items = await Promise.all(
          result.items.map(async (user) => {
            const role = await services().authStore.findMemberRole(principal.tenantId, user.id);
            return {
              userId: user.id,
              email: user.email,
              displayName: user.displayName,
              status: user.status,
              role: ROLES.find((candidate) => candidate === role) ?? null,
              createdAt: iso(user.createdAt),
            };
          }),
        );
        return { items, hasMore: result.hasMore };
      },
    );

    app.get(
      "/api/v1/members/invitations",
      {
        config: { access: { permission: "member:read", action: "member.list_invitations" } },
        schema: {
          operationId: "listPendingInvitations",
          summary: "List invitations that have been sent and not yet accepted",
          description:
            "Pending and unexpired only, newest first. The enrolment token is never listed: it is shown once, when the invitation is made.",
          tags: ["members"],
          security: SECURITY,
          querystring: LimitQuery,
          response: {
            200: z.object({ items: z.array(InvitationView), hasMore: z.boolean() }),
            ...PROTECTED_ERRORS,
          },
        },
      },
      async (request) => {
        const { principal } = tenantOf(request);
        // The tenant comes from the principal, never from the request.
        const rows = await services().authStore.listPendingInvitations(
          principal.tenantId,
          request.query.limit + 1,
        );
        const result = page(rows, request.query.limit);
        return {
          items: result.items.map((row) => ({
            id: row.id,
            email: row.email,
            roles: row.role
              .split(",")
              .flatMap((name) => ROLES.filter((candidate) => candidate === name.trim())),
            invitedByUserId: row.inviterUserId,
            createdAt: iso(row.createdAt),
            expiresAt: iso(row.expiresAt),
          })),
          hasMore: result.hasMore,
        };
      },
    );

    app.post(
      "/api/v1/members/invitations",
      {
        config: { access: { permission: "invitation:create", action: "member.invite" } },
        schema: {
          operationId: "inviteMember",
          summary: "Invite a person to the tenant",
          description:
            "The enrolment token is shown once, for the hand-shared invitation link; it cannot be read again.",
          tags: ["members"],
          security: SECURITY,
          body: z.object({ email: z.email().max(320), role: Role }),
          response: {
            201: z.object({
              invitationId: z.string(),
              email: z.string(),
              role: Role,
              expiresAt: optionalInstant,
              enrolmentToken: z.string().nullable(),
            }),
            ...PROTECTED_ERRORS,
          },
        },
      },
      async (request, reply) => {
        const { principal } = tenantOf(request);
        const headers = sessionHeaders(request);
        const invited = await identity(() =>
          services().auth.api.createInvitation({
            headers,
            body: {
              email: request.body.email,
              role: request.body.role,
              organizationId: principal.tenantId,
            },
          }),
        );
        request.auditTarget = { type: "invitation", id: invited.id };
        const extra = invited as { enrolmentToken?: unknown; expiresAt?: Date | string };
        void reply.code(201);
        return {
          invitationId: invited.id,
          email: request.body.email,
          role: request.body.role,
          expiresAt: extra.expiresAt === undefined ? null : new Date(extra.expiresAt).toISOString(),
          enrolmentToken: typeof extra.enrolmentToken === "string" ? extra.enrolmentToken : null,
        };
      },
    );

    const memberIdOf = async (tenantId: string, userId: string, headers: Headers) => {
      const found = await identity(() =>
        services().auth.api.listMembers({
          headers,
          query: { organizationId: tenantId, filterField: "userId", filterValue: userId },
        }),
      );
      const member = found.members.find((candidate) => candidate.userId === userId);
      if (member === undefined) throw notFound("The member");
      return member.id;
    };

    app.patch(
      "/api/v1/members/:userId",
      {
        config: { access: { permission: "member:update", action: "member.change_role" } },
        schema: {
          operationId: "changeMemberRole",
          summary: "Change a member's role",
          tags: ["members"],
          security: SECURITY,
          params: z.object({ userId: z.uuid() }),
          body: z.object({ role: Role }),
          response: { 200: z.object({ userId: z.uuid(), role: Role }), ...PROTECTED_ERRORS },
        },
      },
      async (request) => {
        const { principal } = tenantOf(request);
        const headers = sessionHeaders(request);
        request.auditTarget = { type: "user", id: request.params.userId };
        const memberId = await memberIdOf(principal.tenantId, request.params.userId, headers);
        await identity(() =>
          services().auth.api.updateMemberRole({
            headers,
            body: { memberId, role: request.body.role, organizationId: principal.tenantId },
          }),
        );
        return { userId: request.params.userId, role: request.body.role };
      },
    );

    app.delete(
      "/api/v1/members/:userId",
      {
        config: { access: { permission: "member:delete", action: "member.remove" } },
        schema: {
          operationId: "removeMember",
          summary: "Remove a member from the tenant",
          description: "Their past work and audit entries are kept; their access ends at once.",
          tags: ["members"],
          security: SECURITY,
          params: z.object({ userId: z.uuid() }),
          response: { 204: z.null(), 409: ProblemSchema, ...PROTECTED_ERRORS },
        },
      },
      async (request, reply) => {
        const { principal } = tenantOf(request);
        const headers = sessionHeaders(request);
        request.auditTarget = { type: "user", id: request.params.userId };
        const memberId = await memberIdOf(principal.tenantId, request.params.userId, headers);
        await identity(() =>
          services().auth.api.removeMember({
            headers,
            body: { memberIdOrEmail: memberId, organizationId: principal.tenantId },
          }),
        );
        void reply.code(204);
        return null;
      },
    );
    return Promise.resolve();
  };

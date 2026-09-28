import { PLAN_MODULES, PLANS, VETTING_STATUSES } from "@repo/access";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { tenantOf } from "../http/access.ts";
import { PermissionSchema, PROTECTED_ERRORS, SECURITY } from "./schemas.ts";

const MeResponse = z.object({
  authMethod: z.enum(["SESSION", "API_KEY"]),
  user: z
    .object({ id: z.uuid(), email: z.string(), displayName: z.string().nullable() })
    .nullable()
    .describe("The signed-in person; null when an API key is acting."),
  apiKeyId: z.uuid().nullable(),
  tenant: z.object({
    id: z.uuid(),
    name: z.string(),
    plan: z.enum(PLANS),
    vettingStatus: z.enum(VETTING_STATUSES),
    planModules: z
      .array(z.string())
      .describe("Modules the plan includes, before the vetting gate."),
  }),
  permissions: z.array(PermissionSchema),
});

export const meRoutes: FastifyPluginAsyncZod = (app) => {
  app.get(
    "/api/v1/me",
    {
      config: { access: { permission: "profile:read", action: "profile.read" } },
      schema: {
        operationId: "getMe",
        summary: "Who is calling, for which tenant, with which permissions",
        tags: ["identity"],
        security: SECURITY,
        response: { 200: MeResponse, ...PROTECTED_ERRORS },
      },
    },
    async (request) => {
      const { tenant, principal, repos } = tenantOf(request);
      const profile =
        principal.kind === "session" ? await repos.users.findById(principal.userId) : null;
      return {
        authMethod: principal.kind === "session" ? ("SESSION" as const) : ("API_KEY" as const),
        user:
          profile === null
            ? null
            : { id: profile.id, email: profile.email, displayName: profile.displayName },
        apiKeyId: principal.kind === "api_key" ? principal.apiKeyId : null,
        tenant: {
          id: tenant.tenantId,
          name: tenant.name,
          plan: tenant.plan,
          vettingStatus: tenant.vettingStatus,
          planModules: [...PLAN_MODULES[tenant.plan]],
        },
        permissions: [...principal.permissions].sort(),
      };
    },
  );
  return Promise.resolve();
};

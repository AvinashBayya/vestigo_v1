import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { tenantOf } from "../http/access.ts";
import { notFound } from "../http/errors.ts";
import { PROTECTED_ERRORS, SECURITY } from "./schemas.ts";

/** Bounds guard against nonsense (the table enforces the same); they are not policy. */
const MAX_RETENTION_DAYS = 3650;

const Retention = z.object({
  /** Days evidence is kept; null when the tenant has not chosen a window. Never a default. */
  retentionDays: z.number().int().min(1).max(MAX_RETENTION_DAYS).nullable(),
  /** False: the window is recorded, but nothing deletes evidence when it passes yet. */
  enforced: z.literal(false),
});

export const settingsRoutes: FastifyPluginAsyncZod = (app) => {
  app.get(
    "/api/v1/settings/retention",
    {
      config: { access: { permission: "tenant:read", action: "settings.retention_read" } },
      schema: {
        operationId: "getRetention",
        summary: "Read the tenant's retention window",
        tags: ["settings"],
        security: SECURITY,
        response: { 200: Retention, ...PROTECTED_ERRORS },
      },
    },
    (request) => {
      const { tenant } = tenantOf(request);
      return { retentionDays: tenant.retentionDays, enforced: false as const };
    },
  );

  app.put(
    "/api/v1/settings/retention",
    {
      config: { access: { permission: "organization:update", action: "settings.retention" } },
      schema: {
        operationId: "setRetention",
        summary: "Set or clear the tenant's retention window",
        description:
          "Null clears it: the tenant has no chosen window. The window is recorded only; deletion on expiry is not built yet, and the response says so (`enforced: false`).",
        tags: ["settings"],
        security: SECURITY,
        body: z.object({
          retentionDays: z.number().int().min(1).max(MAX_RETENTION_DAYS).nullable(),
        }),
        response: { 200: Retention, ...PROTECTED_ERRORS },
      },
    },
    async (request) => {
      const { repos, principal } = tenantOf(request);
      request.auditTarget = { type: "tenant", id: principal.tenantId };
      const tenant = await repos.tenants.setRetentionDays(request.body.retentionDays);
      if (tenant === null) throw notFound("The organisation");
      return { retentionDays: tenant.retentionDays, enforced: false as const };
    },
  );
  return Promise.resolve();
};

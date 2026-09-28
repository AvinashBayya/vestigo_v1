import { AUDIT_ACTOR_KINDS, AUDIT_OUTCOMES, AUTH_METHODS } from "@repo/core";
import type { AuditEntry } from "@repo/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { tenantOf } from "../http/access.ts";
import { iso, LimitQuery, page, PROTECTED_ERRORS, SECURITY } from "./schemas.ts";

const Entry = z.object({
  id: z.uuid(),
  tenantId: z.uuid(),
  recordedAt: z.iso.datetime(),
  actor: z.object({
    kind: z.enum(AUDIT_ACTOR_KINDS),
    userId: z.uuid().nullable(),
    apiKeyId: z.uuid().nullable(),
  }),
  action: z.string(),
  target: z.object({ type: z.string(), id: z.string() }).nullable(),
  outcome: z.enum(AUDIT_OUTCOMES).nullable(),
  authorization: z
    .object({
      method: z.enum(AUTH_METHODS),
      permission: z.string().nullable(),
      sessionId: z.uuid().nullable(),
    })
    .nullable()
    .describe("How the actor was authenticated, and the permission the action required."),
  requestId: z.string().nullable(),
  details: z.record(z.string(), z.unknown()).nullable(),
});

const view = (row: AuditEntry): z.infer<typeof Entry> => ({
  id: row.id,
  tenantId: row.tenantId,
  recordedAt: iso(row.recordedAt),
  actor: { kind: row.actorKind, userId: row.actorUserId, apiKeyId: row.actorApiKeyId },
  action: row.action,
  target:
    row.targetType === null || row.targetId === null
      ? null
      : { type: row.targetType, id: row.targetId },
  outcome: row.outcome,
  authorization:
    row.authMethod === null
      ? null
      : { method: row.authMethod, permission: row.permission, sessionId: row.sessionId },
  requestId: row.requestId,
  details:
    typeof row.details === "object" && row.details !== null && !Array.isArray(row.details)
      ? (row.details as Record<string, unknown>)
      : null,
});

export const auditLogRoutes: FastifyPluginAsyncZod = (app) => {
  app.get(
    "/api/v1/audit-log",
    {
      config: { access: { permission: "audit:read", action: "audit_log.read" } },
      schema: {
        operationId: "listAuditLog",
        summary: "The tenant's audit log, newest first",
        tags: ["audit"],
        security: SECURITY,
        querystring: LimitQuery,
        response: {
          200: z.object({ items: z.array(Entry), hasMore: z.boolean() }),
          ...PROTECTED_ERRORS,
        },
      },
    },
    async (request) => {
      const { repos } = tenantOf(request);
      const rows = await repos.auditLog.recent({ limit: request.query.limit + 1 });
      const result = page(rows, request.query.limit);
      return { items: result.items.map(view), hasMore: result.hasMore };
    },
  );
  return Promise.resolve();
};

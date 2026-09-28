import type { ApiKeyMetadata } from "@repo/integrations";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { tenantOf } from "../http/access.ts";
import { notFound } from "../http/errors.ts";
import type { Services } from "../services.ts";
import {
  iso,
  IdParams,
  isoOrNull,
  LimitQuery,
  page,
  PermissionSchema,
  PROTECTED_ERRORS,
  SECURITY,
} from "./schemas.ts";

/** Never includes the key or its hash; `keyPrefix` identifies it. */
const ApiKey = z.object({
  id: z.uuid(),
  name: z.string(),
  keyPrefix: z.string(),
  permissions: z.array(z.string()),
  createdByUserId: z.uuid().nullable(),
  rotatedFromId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullable().describe("Null: no use has been recorded."),
  expiresAt: z.iso.datetime().nullable().describe("Null: the key does not expire."),
  revokedAt: z.iso.datetime().nullable(),
});

const IssuedKey = z.object({
  key: ApiKey,
  plaintext: z
    .string()
    .describe(
      "The API key. Shown once, here; it is stored only as a hash and cannot be retrieved.",
    ),
});

const view = (row: ApiKeyMetadata): z.infer<typeof ApiKey> => ({
  id: row.id,
  name: row.name,
  keyPrefix: row.keyPrefix,
  permissions: [...row.permissions],
  createdByUserId: row.createdByUserId,
  rotatedFromId: row.rotatedFromId,
  createdAt: iso(row.createdAt),
  lastUsedAt: isoOrNull(row.lastUsedAt),
  expiresAt: isoOrNull(row.expiresAt),
  revokedAt: isoOrNull(row.revokedAt),
});

export function apiKeyRoutes(services: () => Services): FastifyPluginAsyncZod {
  return (app) => {
    app.post(
      "/api/v1/api-keys",
      {
        config: { access: { permission: "api_key:manage", action: "api_key.create" } },
        schema: {
          operationId: "createApiKey",
          summary: "Issue an API key scoped to permissions the caller holds",
          tags: ["api-keys"],
          security: SECURITY,
          body: z.object({
            name: z.string().trim().min(1).max(200),
            permissions: z.array(PermissionSchema).min(1),
            expiresAt: z.iso.datetime().nullable().describe("Null: the key does not expire."),
          }),
          response: { 201: IssuedKey, ...PROTECTED_ERRORS },
        },
      },
      async (request, reply) => {
        const context = tenantOf(request);
        const { principal } = context;
        const issued = await services().apiKeys.create(context, {
          name: request.body.name,
          permissions: request.body.permissions,
          // A key minted by a key records the original human issuer.
          createdByUserId: principal.kind === "session" ? principal.userId : principal.issuerUserId,
          expiresAt: request.body.expiresAt === null ? null : new Date(request.body.expiresAt),
          grantorPermissions: principal.permissions,
        });
        request.auditTarget = { type: "api_key", id: issued.key.id };
        void reply.code(201);
        return { key: view(issued.key), plaintext: issued.plaintext };
      },
    );

    app.get(
      "/api/v1/api-keys",
      {
        config: { access: { permission: "api_key:manage", action: "api_key.list" } },
        schema: {
          operationId: "listApiKeys",
          summary: "List the tenant's API keys (never the keys themselves)",
          tags: ["api-keys"],
          security: SECURITY,
          querystring: LimitQuery,
          response: {
            200: z.object({ items: z.array(ApiKey), hasMore: z.boolean() }),
            ...PROTECTED_ERRORS,
          },
        },
      },
      async (request) => {
        const rows = await services().apiKeys.list(tenantOf(request), {
          limit: request.query.limit + 1,
        });
        const result = page(rows, request.query.limit);
        return { items: result.items.map(view), hasMore: result.hasMore };
      },
    );

    app.post(
      "/api/v1/api-keys/:id/rotate",
      {
        config: { access: { permission: "api_key:manage", action: "api_key.rotate" } },
        schema: {
          operationId: "rotateApiKey",
          summary:
            "Replace a key with a new one; the old one stops working now or after an overlap",
          tags: ["api-keys"],
          security: SECURITY,
          params: IdParams,
          body: z.object({
            overlapSeconds: z
              .number()
              .int()
              .min(0)
              .max(86_400)
              .describe("How long the old key keeps working. 0 revokes it immediately."),
          }),
          response: { 201: IssuedKey, ...PROTECTED_ERRORS },
        },
      },
      async (request, reply) => {
        const context = tenantOf(request);
        const { principal } = context;
        request.auditTarget = { type: "api_key", id: request.params.id };
        const seconds = request.body.overlapSeconds;
        const issued = await services().apiKeys.rotate(context, request.params.id, {
          overlapUntil: seconds === 0 ? null : new Date(Date.now() + seconds * 1000),
          // A key minted by a key records the original human issuer.
          createdByUserId: principal.kind === "session" ? principal.userId : principal.issuerUserId,
          grantorPermissions: principal.permissions,
        });
        void reply.code(201);
        return { key: view(issued.key), plaintext: issued.plaintext };
      },
    );

    app.post(
      "/api/v1/api-keys/:id/revoke",
      {
        config: { access: { permission: "api_key:manage", action: "api_key.revoke" } },
        schema: {
          operationId: "revokeApiKey",
          summary: "Revoke an API key",
          tags: ["api-keys"],
          security: SECURITY,
          params: IdParams,
          response: { 200: ApiKey, ...PROTECTED_ERRORS },
        },
      },
      async (request) => {
        request.auditTarget = { type: "api_key", id: request.params.id };
        const revoked = await services().apiKeys.revoke(tenantOf(request), request.params.id);
        if (revoked === null) throw notFound("The API key");
        return view(revoked);
      },
    );
    return Promise.resolve();
  };
}

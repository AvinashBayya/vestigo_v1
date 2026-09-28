import type { CredentialMetadata } from "@repo/integrations";
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
  PROTECTED_ERRORS,
  SECURITY,
} from "./schemas.ts";

/**
 * Metadata only. No route returns a credential's secret or its ciphertext:
 * plaintext is reachable only inside the server, through the vault's audited
 * reveal, for the collector that needs it.
 */
const Credential = z.object({
  id: z.uuid(),
  provider: z.string(),
  label: z.string(),
  masterKeyVersion: z.string(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullable().describe("Null: no use has been recorded."),
  revokedAt: z.iso.datetime().nullable(),
});

const view = (row: CredentialMetadata): z.infer<typeof Credential> => ({
  id: row.id,
  provider: row.provider,
  label: row.label,
  masterKeyVersion: row.masterKeyVersion,
  createdAt: iso(row.createdAt),
  lastUsedAt: isoOrNull(row.lastUsedAt),
  revokedAt: isoOrNull(row.revokedAt),
});

export function credentialRoutes(services: () => Services): FastifyPluginAsyncZod {
  return (app) => {
    app.post(
      "/api/v1/credentials",
      {
        config: { access: { permission: "credential:write", action: "credential.create" } },
        schema: {
          operationId: "storeCredential",
          summary: "Store a provider credential, encrypted; the secret is never returned",
          tags: ["credentials"],
          security: SECURITY,
          body: z.object({
            provider: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/),
            label: z.string().trim().min(1).max(200),
            secret: z.string().min(1).max(8192),
          }),
          response: { 201: Credential, ...PROTECTED_ERRORS },
        },
      },
      async (request, reply) => {
        const context = tenantOf(request);
        const stored = await services().vault.store(context, request.body);
        request.auditTarget = { type: "credential", id: stored.id };
        void reply.code(201);
        return view(stored);
      },
    );

    app.get(
      "/api/v1/credentials",
      {
        config: { access: { permission: "credential:read", action: "credential.list" } },
        schema: {
          operationId: "listCredentials",
          summary: "List stored credentials (metadata only)",
          tags: ["credentials"],
          security: SECURITY,
          querystring: LimitQuery,
          response: {
            200: z.object({ items: z.array(Credential), hasMore: z.boolean() }),
            ...PROTECTED_ERRORS,
          },
        },
      },
      async (request) => {
        const rows = await services().vault.list(tenantOf(request), {
          limit: request.query.limit + 1,
        });
        const result = page(rows, request.query.limit);
        return { items: result.items.map(view), hasMore: result.hasMore };
      },
    );

    app.post(
      "/api/v1/credentials/:id/revoke",
      {
        config: { access: { permission: "credential:write", action: "credential.revoke" } },
        schema: {
          operationId: "revokeCredential",
          summary: "Revoke a stored credential",
          tags: ["credentials"],
          security: SECURITY,
          params: IdParams,
          response: { 200: Credential, ...PROTECTED_ERRORS },
        },
      },
      async (request) => {
        request.auditTarget = { type: "credential", id: request.params.id };
        const revoked = await services().vault.revoke(tenantOf(request), request.params.id);
        if (revoked === null) throw notFound("The credential");
        return view(revoked);
      },
    );
    return Promise.resolve();
  };
}

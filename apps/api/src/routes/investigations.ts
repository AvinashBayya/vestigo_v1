import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { tenantOf } from "../http/access.ts";
import { notFound } from "../http/errors.ts";
import {
  iso,
  IdParams,
  isoOrNull,
  LimitQuery,
  page,
  PROTECTED_ERRORS,
  SECURITY,
} from "./schemas.ts";

const Investigation = z.object({
  id: z.uuid(),
  title: z.string(),
  target: z.string(),
  createdByUserId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  archivedAt: z.iso.datetime().nullable(),
});

type Row = {
  id: string;
  title: string;
  target: string;
  createdByUserId: string | null;
  createdAt: Date;
  archivedAt: Date | null;
};

const view = (row: Row): z.infer<typeof Investigation> => ({
  id: row.id,
  title: row.title,
  target: row.target,
  createdByUserId: row.createdByUserId,
  createdAt: iso(row.createdAt),
  archivedAt: isoOrNull(row.archivedAt),
});

export const investigationRoutes: FastifyPluginAsyncZod = (app) => {
  app.post(
    "/api/v1/investigations",
    {
      config: { access: { permission: "investigation:create", action: "investigation.create" } },
      schema: {
        operationId: "createInvestigation",
        summary: "Open an investigation into a target",
        tags: ["investigations"],
        security: SECURITY,
        body: z.object({
          title: z.string().trim().min(1).max(200),
          target: z.string().trim().min(1).max(500),
        }),
        response: { 201: Investigation, ...PROTECTED_ERRORS },
      },
    },
    async (request, reply) => {
      const { repos, principal } = tenantOf(request);
      const created = await repos.investigations.create({
        title: request.body.title,
        target: request.body.target,
        createdByUserId: principal.kind === "session" ? principal.userId : null,
      });
      request.auditTarget = { type: "investigation", id: created.id };
      void reply.code(201);
      return view(created);
    },
  );

  app.get(
    "/api/v1/investigations",
    {
      config: { access: { permission: "investigation:read", action: "investigation.list" } },
      schema: {
        operationId: "listInvestigations",
        summary: "List the tenant's investigations, oldest first",
        tags: ["investigations"],
        security: SECURITY,
        querystring: LimitQuery,
        response: {
          200: z.object({ items: z.array(Investigation), hasMore: z.boolean() }),
          ...PROTECTED_ERRORS,
        },
      },
    },
    async (request) => {
      const { repos } = tenantOf(request);
      const rows = await repos.investigations.list({ limit: request.query.limit + 1 });
      const result = page(rows, request.query.limit);
      return { items: result.items.map(view), hasMore: result.hasMore };
    },
  );

  app.get(
    "/api/v1/investigations/:id",
    {
      config: { access: { permission: "investigation:read", action: "investigation.read" } },
      schema: {
        operationId: "getInvestigation",
        summary: "Read one investigation",
        tags: ["investigations"],
        security: SECURITY,
        params: IdParams,
        response: { 200: Investigation, ...PROTECTED_ERRORS },
      },
    },
    async (request) => {
      const { repos } = tenantOf(request);
      request.auditTarget = { type: "investigation", id: request.params.id };
      const row = await repos.investigations.findById(request.params.id);
      if (row === null) throw notFound("The investigation");
      return view(row);
    },
  );
  return Promise.resolve();
};

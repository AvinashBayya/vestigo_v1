import { InvalidTargetError, parseTarget } from "@repo/collectors";
import { TARGET_TYPES } from "@repo/core";
import type { ScopeAuthorisation } from "@repo/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { tenantOf } from "../http/access.ts";
import { forbidden, HttpError, notFound, ProblemSchema } from "../http/errors.ts";
import {
  iso,
  IdParams,
  isoOrNull,
  LimitQuery,
  page,
  PROTECTED_ERRORS,
  SECURITY,
} from "./schemas.ts";

/** The longest one authorisation may last; renewing it is a new, recorded decision. */
const MAX_VALIDITY_MS = 366 * 24 * 60 * 60 * 1000;

const ScopeAuthorisationView = z.object({
  id: z.uuid(),
  targetType: z.enum(TARGET_TYPES),
  /** The exact target, normalised: an authorisation covers this target and nothing else. */
  target: z.string(),
  /** Who authorised it: a person, never a key. */
  authorisedByUserId: z.uuid(),
  /** The recorded basis: the engagement, the client's written permission. */
  basis: z.string(),
  validFrom: z.iso.datetime(),
  validUntil: z.iso.datetime(),
  revokedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

const view = (row: ScopeAuthorisation): z.infer<typeof ScopeAuthorisationView> => ({
  id: row.id,
  targetType: row.targetType,
  target: row.target,
  authorisedByUserId: row.authorisedByUserId,
  basis: row.basis,
  validFrom: iso(row.validFrom),
  validUntil: iso(row.validUntil),
  revokedAt: isoOrNull(row.revokedAt),
  createdAt: iso(row.createdAt),
});

/**
 * Scope authorisations: the per-tenant, per-exact-target record an ACTIVE
 * collector needs before it may run (CLAUDE.md §3). Recorded, then only ever
 * revoked; every create and revoke is in the audit log.
 */
export const scopeAuthorisationRoutes: FastifyPluginAsyncZod = (app) => {
  app.post(
    "/api/v1/scope-authorisations",
    {
      config: {
        access: { permission: "scope_authorisation:write", action: "scope_authorisation.create" },
      },
      schema: {
        operationId: "createScopeAuthorisation",
        summary: "Record an authorisation to collect actively against one exact target",
        description:
          "The authoriser is the signed-in person; an API key cannot authorise. The target is normalised and matched exactly: it covers no subdomain, range or other target. At most 366 days.",
        tags: ["scope-authorisations"],
        security: SECURITY,
        body: z.object({
          targetType: z.enum(TARGET_TYPES),
          target: z.string().trim().min(1).max(2048),
          basis: z.string().trim().min(10).max(2000),
          validFrom: z.iso.datetime(),
          validUntil: z.iso.datetime(),
        }),
        response: { 201: ScopeAuthorisationView, ...PROTECTED_ERRORS },
      },
    },
    async (request, reply) => {
      const { repos, principal } = tenantOf(request);
      if (principal.kind !== "session") {
        throw forbidden(
          "SCOPE_AUTHORISER_REQUIRED",
          "A scope authorisation must be recorded by a signed-in person, not an API key.",
        );
      }
      let target;
      try {
        target = parseTarget(request.body.targetType, request.body.target);
      } catch (error) {
        if (error instanceof InvalidTargetError) {
          throw new HttpError(400, error.code, error.message);
        }
        throw error;
      }
      const validFrom = new Date(request.body.validFrom);
      const validUntil = new Date(request.body.validUntil);
      if (validUntil.getTime() <= validFrom.getTime()) {
        throw new HttpError(400, "VALIDITY_INVALID", "validUntil must be after validFrom.");
      }
      if (validUntil.getTime() - validFrom.getTime() > MAX_VALIDITY_MS) {
        throw new HttpError(
          400,
          "VALIDITY_TOO_LONG",
          "An authorisation may last at most 366 days.",
        );
      }
      const created = await repos.scopeAuthorisations.create({
        targetType: target.type,
        target: target.value,
        authorisedByUserId: principal.userId,
        basis: request.body.basis,
        validFrom,
        validUntil,
      });
      request.auditTarget = { type: "scope_authorisation", id: created.id };
      void reply.code(201);
      return view(created);
    },
  );

  app.get(
    "/api/v1/scope-authorisations",
    {
      config: {
        access: { permission: "scope_authorisation:read", action: "scope_authorisation.list" },
      },
      schema: {
        operationId: "listScopeAuthorisations",
        summary: "List the tenant's scope authorisations, oldest first",
        tags: ["scope-authorisations"],
        security: SECURITY,
        querystring: LimitQuery,
        response: {
          200: z.object({ items: z.array(ScopeAuthorisationView), hasMore: z.boolean() }),
          ...PROTECTED_ERRORS,
        },
      },
    },
    async (request) => {
      const { repos } = tenantOf(request);
      const rows = await repos.scopeAuthorisations.list({ limit: request.query.limit + 1 });
      const result = page(rows, request.query.limit);
      return { items: result.items.map(view), hasMore: result.hasMore };
    },
  );

  app.post(
    "/api/v1/scope-authorisations/:id/revoke",
    {
      config: {
        access: { permission: "scope_authorisation:write", action: "scope_authorisation.revoke" },
      },
      schema: {
        operationId: "revokeScopeAuthorisation",
        summary: "End a scope authorisation now",
        tags: ["scope-authorisations"],
        security: SECURITY,
        params: IdParams,
        body: z.object({}),
        response: { 200: ScopeAuthorisationView, ...PROTECTED_ERRORS, 409: ProblemSchema },
      },
    },
    async (request) => {
      const { repos } = tenantOf(request);
      request.auditTarget = { type: "scope_authorisation", id: request.params.id };
      const existing = await repos.scopeAuthorisations.findById(request.params.id);
      if (existing === null) throw notFound("The scope authorisation");
      if (existing.revokedAt !== null) {
        throw new HttpError(409, "ALREADY_REVOKED", "The scope authorisation is already revoked.");
      }
      const revoked = await repos.scopeAuthorisations.revoke(request.params.id);
      if (revoked === null) throw notFound("The scope authorisation");
      return view(revoked);
    },
  );
  return Promise.resolve();
};

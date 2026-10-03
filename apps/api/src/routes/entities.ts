import { CLAIM_STRENGTHS, DECISION_ACTOR_KINDS, ENTITY_KINDS, MERGE_SIGNALS } from "@repo/core";
import type { EntityMerge, ScopedEntity } from "@repo/db";
import { ConstraintViolationError } from "@repo/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { sessionPrincipalOf, tenantOf } from "../http/access.ts";
import { requirePersonAccess } from "../http/person-gate.ts";
import { HttpError, notFound, ProblemSchema } from "../http/errors.ts";
import {
  iso,
  IdParams,
  JsonValue,
  LimitQuery,
  page,
  PROTECTED_ERRORS,
  SECURITY,
} from "./schemas.ts";
import { resolveScope, ScopeQuery } from "./scope.ts";

const Strength = z.enum(CLAIM_STRENGTHS);

const EntityView = z.object({
  id: z.uuid(),
  kind: z.enum(ENTITY_KINDS),
  displayName: z.string(),
  /** The normalised identifier; null for entities identified by name alone. */
  identifier: z.string().nullable(),
  createdAt: z.iso.datetime(),
  /** Everything recorded about the entity, not only what the scope holds. All measured. */
  claimCount: z.number().int().min(0),
  evidenceCount: z.number().int().min(0),
  relationshipCount: z.number().int().min(0),
  /** The distinct strengths of its claims, strongest first. */
  strengths: z.array(Strength),
  /** The survivor this entity is currently merged into; null when it is not merged. */
  mergedIntoEntityId: z.uuid().nullable(),
  /** How many entities are currently merged into this one. */
  mergedEntityCount: z.number().int().min(0),
});

const entityView = (row: ScopedEntity): z.infer<typeof EntityView> => ({
  id: row.id,
  kind: row.kind,
  displayName: row.displayName,
  identifier: row.identifier,
  createdAt: iso(row.createdAt),
  claimCount: row.claimCount,
  evidenceCount: row.evidenceCount,
  relationshipCount: row.relationshipCount,
  strengths: [...row.strengths],
  mergedIntoEntityId: row.mergedIntoEntityId,
  mergedEntityCount: row.mergedEntityCount,
});

const ClaimView = z.object({
  id: z.uuid(),
  evidenceId: z.uuid(),
  attribute: z.string(),
  /** What the claim states. Null is a stated null, not a missing value. */
  value: JsonValue,
  /** DERIVED marks a value the platform computed; every other label is the source's. */
  strength: Strength,
  createdAt: z.iso.datetime(),
});

const RelationshipView = z.object({
  id: z.uuid(),
  kind: z.string(),
  direction: z.enum(["OUTGOING", "INCOMING"]),
  otherEntity: z.object({
    id: z.uuid(),
    kind: z.enum(ENTITY_KINDS),
    displayName: z.string(),
  }),
  claimCount: z.number().int().min(0),
  strengths: z.array(Strength),
});

const CLAIM_LIMIT_MAX = 500;

const Actor = z.object({
  kind: z.enum(DECISION_ACTOR_KINDS),
  userId: z.uuid().nullable(),
  rule: z.string().nullable(),
});

const MergeView = z.object({
  id: z.uuid(),
  entityKind: z.enum(ENTITY_KINDS),
  survivingEntityId: z.uuid(),
  mergedEntityId: z.uuid(),
  reason: z.string(),
  /** 0 to 1, as assessed by whoever decided. */
  confidence: z.number().min(0).max(1),
  matchSignals: z.array(z.enum(MERGE_SIGNALS)),
  mergedBy: Actor,
  createdAt: z.iso.datetime(),
  /** Always true until it is undone: a merge never deletes or rewrites anything. */
  reversible: z.boolean(),
  /** Null while the merge is in force. */
  reverted: z
    .object({
      at: z.iso.datetime(),
      by: Actor,
      reason: z.string(),
    })
    .nullable(),
});

function mergeView(row: EntityMerge): z.infer<typeof MergeView> {
  return {
    id: row.id,
    entityKind: row.entityKind,
    survivingEntityId: row.survivingEntityId,
    mergedEntityId: row.mergedEntityId,
    reason: row.reason,
    confidence: Number(row.confidence),
    matchSignals: [...row.matchSignals],
    mergedBy: { kind: row.mergedByKind, userId: row.mergedByUserId, rule: row.mergedByRule },
    createdAt: iso(row.createdAt),
    reversible: row.revertedAt === null,
    reverted:
      row.revertedAt === null || row.revertedByKind === null
        ? null
        : {
            at: iso(row.revertedAt),
            by: {
              kind: row.revertedByKind,
              userId: row.revertedByUserId,
              rule: row.revertedByRule,
            },
            reason: row.revertReason ?? "",
          },
  };
}

const MERGE_ERRORS = { 409: ProblemSchema } as const;

export const entityRoutes: FastifyPluginAsyncZod = (app) => {
  app.get(
    "/api/v1/entities",
    {
      config: { access: { permission: "evidence:read", action: "entity.list" } },
      schema: {
        operationId: "listEntities",
        summary: "List the entities of a case or a run, with their measured counts",
        description:
          "Merged entities are listed too, marked with the survivor they are merged into. Counts cover everything recorded about each entity.",
        tags: ["entities"],
        security: SECURITY,
        querystring: ScopeQuery.and(LimitQuery),
        response: {
          200: z.object({ items: z.array(EntityView), hasMore: z.boolean() }),
          ...PROTECTED_ERRORS,
        },
      },
    },
    async (request) => {
      const context = tenantOf(request);
      const { repos, reads } = context;
      const scope = await resolveScope(repos, request.query);
      const rows = await reads.exploration.entitiesInScope(scope, {
        limit: request.query.limit + 1,
      });
      const result = page(rows, request.query.limit);
      await requirePersonAccess(
        context,
        { scope, entityIds: result.items.map((row) => row.id) },
        "The entities of this case or run, with their claims, relationships and counts.",
      );
      return { items: result.items.map(entityView), hasMore: result.hasMore };
    },
  );

  app.get(
    "/api/v1/entities/merge-candidates",
    {
      config: { access: { permission: "evidence:read", action: "entity.merge_candidates" } },
      schema: {
        operationId: "listMergeCandidates",
        summary: "Entities of a case or run that may be the same thing",
        description:
          "Computed on request, not stored. Every candidate is an INFERRED suggestion from a name match alone; nothing is merged until a person decides. Pairs that already have a merge on record, active or undone, are not suggested.",
        tags: ["entities"],
        security: SECURITY,
        querystring: ScopeQuery.and(LimitQuery),
        response: {
          200: z.object({
            items: z.array(
              z.object({
                kind: z.enum(ENTITY_KINDS),
                first: z.object({ id: z.uuid(), displayName: z.string() }),
                second: z.object({ id: z.uuid(), displayName: z.string() }),
                matchSignals: z.array(z.enum(MERGE_SIGNALS)),
                strength: z.literal("INFERRED"),
                nameOnly: z.literal(true),
              }),
            ),
            hasMore: z.boolean(),
          }),
          ...PROTECTED_ERRORS,
        },
      },
    },
    async (request) => {
      const context = tenantOf(request);
      const { repos, reads } = context;
      const scope = await resolveScope(repos, request.query);
      const rows = await reads.exploration.mergeCandidates(scope, {
        limit: request.query.limit + 1,
      });
      const result = page(rows, request.query.limit);
      await requirePersonAccess(
        context,
        {
          scope,
          entityIds: result.items.flatMap((row) => [row.first.id, row.second.id]),
        },
        "The merge candidates of this case or run, with the entity names.",
      );
      return {
        items: result.items.map((row) => ({
          ...row,
          matchSignals: ["NAME" as const],
          strength: "INFERRED" as const,
          nameOnly: true as const,
        })),
        hasMore: result.hasMore,
      };
    },
  );

  app.get(
    "/api/v1/entities/:id",
    {
      config: { access: { permission: "evidence:read", action: "entity.read" } },
      schema: {
        operationId: "getEntity",
        summary: "Read an entity with its claims, relationships and merged entities",
        tags: ["entities"],
        security: SECURITY,
        params: IdParams,
        querystring: z.object({
          claimLimit: z.coerce.number().int().min(1).max(CLAIM_LIMIT_MAX).default(200),
        }),
        response: {
          200: z.object({
            entity: EntityView,
            claims: z.array(ClaimView),
            /** True when the entity has more claims than were returned: the list is partial. */
            claimsTruncated: z.boolean(),
            relationships: z.array(RelationshipView),
            mergedEntityIds: z.array(z.uuid()),
          }),
          ...PROTECTED_ERRORS,
        },
      },
    },
    async (request) => {
      const context = tenantOf(request);
      const { repos, reads } = context;
      request.auditTarget = { type: "entity", id: request.params.id };
      const detail = await reads.exploration.entityDetail(request.params.id);
      if (detail === null) throw notFound("The entity");
      // The entity, and the entities its relationships show by name.
      await requirePersonAccess(
        context,
        {
          entityIds: [
            detail.entity.id,
            ...detail.relationships.map((relationship) => relationship.otherEntity.id),
          ],
        },
        "This entity, with its claims, relationships and counts.",
      );
      const rows = await repos.claims.listForEntity(request.params.id, {
        limit: request.query.claimLimit + 1,
      });
      return {
        entity: entityView(detail.entity),
        claims: rows.slice(0, request.query.claimLimit).map((claim) => ({
          id: claim.id,
          evidenceId: claim.evidenceId,
          attribute: claim.attribute,
          value: claim.value,
          strength: claim.strength,
          createdAt: iso(claim.createdAt),
        })),
        claimsTruncated: rows.length > request.query.claimLimit,
        relationships: detail.relationships.map((r) => ({
          ...r,
          strengths: [...r.strengths],
        })),
        mergedEntityIds: [...detail.mergedEntityIds],
      };
    },
  );

  app.get(
    "/api/v1/entity-merges",
    {
      config: { access: { permission: "evidence:read", action: "entity_merge.list" } },
      schema: {
        operationId: "listEntityMerges",
        summary: "List merge decisions, active and undone",
        tags: ["entities"],
        security: SECURITY,
        querystring: z.object({ entityId: z.uuid().optional() }).and(LimitQuery),
        response: {
          200: z.object({ items: z.array(MergeView), hasMore: z.boolean() }),
          ...PROTECTED_ERRORS,
        },
      },
    },
    async (request) => {
      const { repos } = tenantOf(request);
      const limit = { limit: request.query.limit + 1 };
      const rows =
        request.query.entityId === undefined
          ? await repos.entityMerges.list(limit)
          : await repos.entityMerges.listInvolving(request.query.entityId, limit);
      const result = page(rows, request.query.limit);
      return { items: result.items.map(mergeView), hasMore: result.hasMore };
    },
  );

  app.post(
    "/api/v1/entity-merges",
    {
      config: { access: { permission: "case:write", action: "entity_merge.create" } },
      schema: {
        operationId: "mergeEntities",
        summary: "Merge one entity into another",
        description:
          "Reversible: nothing is rewritten or deleted, and the merge can be undone. Both entities must be the same kind.",
        tags: ["entities"],
        security: SECURITY,
        body: z.object({
          survivingEntityId: z.uuid(),
          mergedEntityId: z.uuid(),
          reason: z.string().trim().min(1).max(1000),
          confidence: z.number().min(0).max(1),
          matchSignals: z.array(z.enum(MERGE_SIGNALS)).min(1),
        }),
        response: { 201: MergeView, ...MERGE_ERRORS, ...PROTECTED_ERRORS },
      },
    },
    async (request, reply) => {
      const { repos } = tenantOf(request);
      // A merge is an analytic judgement: attributable to the person who made it.
      const { userId } = sessionPrincipalOf(request, "A merge is an analytic judgement");
      try {
        const created = await repos.entityMerges.merge({
          ...request.body,
          decidedBy: { kind: "USER", userId },
        });
        request.auditTarget = { type: "entity_merge", id: created.id };
        void reply.code(201);
        return mergeView(created);
      } catch (error) {
        if (error instanceof ConstraintViolationError) {
          throw new HttpError(409, "MERGE_NOT_ALLOWED", "This merge is not allowed.");
        }
        throw error;
      }
    },
  );

  app.post(
    "/api/v1/entity-merges/:id/undo",
    {
      config: { access: { permission: "case:write", action: "entity_merge.undo" } },
      schema: {
        operationId: "undoEntityMerge",
        summary: "Undo a merge",
        description:
          "Restores the previous state; nothing was lost by the merge. An undone merge cannot be redone, only decided again.",
        tags: ["entities"],
        security: SECURITY,
        params: IdParams,
        body: z.object({ reason: z.string().trim().min(1).max(1000) }),
        response: { 200: MergeView, ...MERGE_ERRORS, ...PROTECTED_ERRORS },
      },
    },
    async (request) => {
      const { repos } = tenantOf(request);
      request.auditTarget = { type: "entity_merge", id: request.params.id };
      const { userId } = sessionPrincipalOf(request, "Undoing a merge is an analytic judgement");
      const undone = await repos.entityMerges.undo(request.params.id, {
        decidedBy: { kind: "USER", userId },
        reason: request.body.reason,
      });
      if (undone === null) throw notFound("The merge");
      return mergeView(undone);
    },
  );
  return Promise.resolve();
};

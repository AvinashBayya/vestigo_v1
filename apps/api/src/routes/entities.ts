import { CLAIM_STRENGTHS, DECISION_ACTOR_KINDS, ENTITY_KINDS, MERGE_SIGNALS } from "@repo/core";
import type { Claim, EntityMerge, ScopedEntity } from "@repo/db";
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

const RelationshipEndView = z.object({
  id: z.uuid(),
  kind: z.enum(ENTITY_KINDS),
  displayName: z.string(),
  identifier: z.string().nullable(),
});

const RelationshipDetailView = z.object({
  id: z.uuid(),
  kind: z.string(),
  source: RelationshipEndView,
  target: RelationshipEndView,
  createdAt: z.iso.datetime(),
  /** Every claim recorded about the relationship (measured). */
  claimCount: z.number().int().min(0),
  /** The distinct strengths of its claims, strongest first. */
  strengths: z.array(Strength),
});

const CLAIM_LIMIT_MAX = 500;

const ClaimLimitQuery = z.object({
  claimLimit: z.coerce.number().int().min(1).max(CLAIM_LIMIT_MAX).default(200),
});

const claimView = (claim: Claim): z.infer<typeof ClaimView> => ({
  id: claim.id,
  evidenceId: claim.evidenceId,
  attribute: claim.attribute,
  value: claim.value,
  strength: claim.strength,
  createdAt: iso(claim.createdAt),
});

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

/** Every entity the merges fetched name, and the one asked about; each once. */
function mergeEntityIds(rows: readonly EntityMerge[], asked: string | undefined): string[] {
  const ids = new Set<string>(asked === undefined ? [] : [asked]);
  for (const row of rows) {
    ids.add(row.survivingEntityId);
    ids.add(row.mergedEntityId);
  }
  return [...ids];
}

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
      // Every row fetched (the one past the page decides hasMore), and the survivor a
      // merged entity names, which may not be listed itself.
      await requirePersonAccess(
        context,
        {
          scope,
          entityIds: [
            ...new Set(
              rows.flatMap((row) =>
                row.mergedIntoEntityId === null ? [row.id] : [row.id, row.mergedIntoEntityId],
              ),
            ),
          ],
        },
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
      // Every pair fetched: the one past the page decides hasMore.
      await requirePersonAccess(
        context,
        {
          scope,
          entityIds: [...new Set(rows.flatMap((row) => [row.first.id, row.second.id]))],
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
        querystring: ClaimLimitQuery,
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
      // Read everything first, then probe: a claim committed between a probe and a later
      // read would reach a locked tenant. The probe sees at least what the reads saw.
      const rows = await repos.claims.listForEntity(request.params.id, {
        limit: request.query.claimLimit + 1,
      });
      // The entity, the entities its relationships show by name, and the merge partners it
      // shows by id: a merge with a person entity is part of what this read says.
      await requirePersonAccess(
        context,
        {
          entityIds: [
            ...new Set([
              detail.entity.id,
              ...detail.relationships.map((relationship) => relationship.otherEntity.id),
              ...detail.mergedEntityIds,
              ...(detail.entity.mergedIntoEntityId === null
                ? []
                : [detail.entity.mergedIntoEntityId]),
            ]),
          ],
        },
        "This entity, with its claims, relationships, counts and merged entities.",
      );
      return {
        entity: entityView(detail.entity),
        claims: rows.slice(0, request.query.claimLimit).map(claimView),
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
    "/api/v1/relationships/:id",
    {
      config: { access: { permission: "evidence:read", action: "relationship.read" } },
      schema: {
        operationId: "getRelationship",
        summary: "Read a relationship with both of its entities and the claims behind it",
        description:
          "The provenance of an edge: every claim asserting the relationship, each with the evidence it cites. DERIVED marks a claim the platform computed; every other label is the source's.",
        tags: ["entities"],
        security: SECURITY,
        params: IdParams,
        querystring: ClaimLimitQuery,
        response: {
          200: z.object({
            relationship: RelationshipDetailView,
            claims: z.array(ClaimView),
            /** True when the relationship has more claims than were returned: the list is partial. */
            claimsTruncated: z.boolean(),
          }),
          ...PROTECTED_ERRORS,
        },
      },
    },
    async (request) => {
      const context = tenantOf(request);
      const { repos, reads } = context;
      request.auditTarget = { type: "relationship", id: request.params.id };
      const detail = await reads.exploration.relationshipDetail(request.params.id);
      if (detail === null) throw notFound("The relationship");
      // Read first, then probe, as for an entity.
      const rows = await repos.claims.listForRelationship(request.params.id, {
        limit: request.query.claimLimit + 1,
      });
      // Both ends are shown by name; probing them covers the relationship's own claims too.
      await requirePersonAccess(
        context,
        { entityIds: [detail.source.id, detail.target.id] },
        "This relationship, with both of its entities and the claims behind it.",
      );
      return {
        relationship: {
          id: detail.id,
          kind: detail.kind,
          source: detail.source,
          target: detail.target,
          createdAt: iso(detail.createdAt),
          claimCount: detail.claimCount,
          strengths: [...detail.strengths],
        },
        claims: rows.slice(0, request.query.claimLimit).map(claimView),
        claimsTruncated: rows.length > request.query.claimLimit,
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
      const context = tenantOf(request);
      const { repos } = context;
      const limit = { limit: request.query.limit + 1 };
      const rows =
        request.query.entityId === undefined
          ? await repos.entityMerges.list(limit)
          : await repos.entityMerges.listInvolving(request.query.entityId, limit);
      const result = page(rows, request.query.limit);
      // Both sides of every merge fetched (the one past the page decides hasMore), and the
      // entity asked about even when it has none: "no merges" for a person entity is still
      // an answer about it.
      await requirePersonAccess(
        context,
        { entityIds: mergeEntityIds(rows, request.query.entityId) },
        "This page of merge decisions: which entities were merged, by whom, and the reasons given.",
      );
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
      const context = tenantOf(request);
      const { repos } = context;
      // A merge is an analytic judgement: attributable to the person who made it.
      const { userId } = sessionPrincipalOf(request, "A merge is an analytic judgement");
      // Before anything changes: a refused merge merges nothing.
      await requirePersonAccess(
        context,
        { entityIds: [request.body.survivingEntityId, request.body.mergedEntityId] },
        "The merge decision for these two entities.",
      );
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
      const context = tenantOf(request);
      const { repos } = context;
      request.auditTarget = { type: "entity_merge", id: request.params.id };
      const { userId } = sessionPrincipalOf(request, "Undoing a merge is an analytic judgement");
      const merge = await repos.entityMerges.findById(request.params.id);
      if (merge === null) throw notFound("The merge");
      // Before anything changes: a refused undo leaves the merge in force.
      await requirePersonAccess(
        context,
        { entityIds: [merge.survivingEntityId, merge.mergedEntityId] },
        "This merge decision, with its undo.",
      );
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

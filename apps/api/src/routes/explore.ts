import { CLAIM_STRENGTHS, ENTITY_KINDS, MAX_GRAPH_HOPS, MAX_GRAPH_NODES } from "@repo/core";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { tenantOf } from "../http/access.ts";
import { requirePersonAccess } from "../http/person-gate.ts";
import type { Services } from "../services.ts";
import {
  isoOrNull,
  LimitQuery,
  optionalInstant,
  page,
  PROTECTED_ERRORS,
  SECURITY,
} from "./schemas.ts";
import { resolveScope, ScopeQuery } from "./scope.ts";

const Strength = z.enum(CLAIM_STRENGTHS);

const GraphNodeView = z.object({
  id: z.uuid(),
  kind: z.enum(ENTITY_KINDS),
  displayName: z.string(),
  identifier: z.string().nullable(),
  /** Relationships from the nearest seed, computed by the platform; 0 for a seed. */
  hop: z.number().int().min(0),
  claimCount: z.number().int().min(0),
  /** The survivor this node is merged into; null when not merged. The node is shown as stored. */
  mergedIntoEntityId: z.uuid().nullable(),
});

const GraphEdgeView = z.object({
  id: z.uuid(),
  sourceEntityId: z.uuid(),
  targetEntityId: z.uuid(),
  kind: z.string(),
  claimCount: z.number().int().min(0),
  /** Strengths of the claims behind the edge, strongest first. INFERRED edges are drawn dashed. */
  strengths: z.array(Strength),
});

const TimelineEvent = z.object({
  evidenceId: z.uuid(),
  collectorId: z.string(),
  /** The collector's label from the platform registry; null when it is no longer registered. */
  sourceLabel: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  /** When the source says it happened. Null when it does not say: never the collection time. */
  observedAt: optionalInstant,
  /** When we fetched it. Null when not recorded. */
  collectedAt: optionalInstant,
  strength: Strength,
  claimCount: z.number().int().min(0),
});

export const exploreRoutes =
  (services: () => Services): FastifyPluginAsyncZod =>
  (app) => {
    app.get(
      "/api/v1/graph",
      {
        config: { access: { permission: "evidence:read", action: "graph.read" } },
        schema: {
          operationId: "getGraph",
          summary: "Nodes and edges around a case's or run's entities, to a hop limit",
          description:
            "Seeds are the entities of the case or run. `truncated` is true when the slice was cut at the node cap: it is then partial.",
          tags: ["graph"],
          security: SECURITY,
          querystring: ScopeQuery.and(
            z.object({
              hops: z.coerce.number().int().min(0).max(MAX_GRAPH_HOPS).default(1),
              maxNodes: z.coerce.number().int().min(1).max(MAX_GRAPH_NODES).default(200),
            }),
          ),
          response: {
            200: z.object({
              nodes: z.array(GraphNodeView),
              edges: z.array(GraphEdgeView),
              maxHops: z.number().int(),
              truncated: z.boolean(),
            }),
            ...PROTECTED_ERRORS,
          },
        },
      },
      async (request) => {
        const context = tenantOf(request);
        const { repos, reads } = context;
        const scope = await resolveScope(repos, request.query);
        const seeds = await reads.exploration.entityIdsInScope(scope, MAX_GRAPH_NODES);
        const slice = await reads.graph.neighbourhood({
          seedEntityIds: seeds.ids,
          maxHops: request.query.hops,
          maxNodes: request.query.maxNodes,
        });
        await requirePersonAccess(
          context,
          { scope, entityIds: slice.nodes.map((node) => node.id) },
          "The graph of this case or run: its entities, their relationships and claim counts.",
        );
        return {
          nodes: slice.nodes.map((node) => ({ ...node })),
          edges: slice.edges.map((edge) => ({ ...edge, strengths: [...edge.strengths] })),
          maxHops: slice.maxHops,
          truncated: slice.truncated || seeds.truncated,
        };
      },
    );

    app.get(
      "/api/v1/timeline",
      {
        config: { access: { permission: "evidence:read", action: "timeline.read" } },
        schema: {
          operationId: "getTimeline",
          summary: "Events (evidence) of a case or run, newest first by the chosen time",
          description:
            "observedAt and collectedAt are separate and each may be null. Events without the chosen time come last; they are undated, not dated otherwise.",
          tags: ["timeline"],
          security: SECURITY,
          querystring: ScopeQuery.and(LimitQuery).and(
            z.object({ sortBy: z.enum(["observedAt", "collectedAt"]).default("observedAt") }),
          ),
          response: {
            200: z.object({
              items: z.array(TimelineEvent),
              hasMore: z.boolean(),
              /** All events in scope (measured). */
              total: z.number().int().min(0),
              withoutObservedAt: z.number().int().min(0),
              withoutCollectedAt: z.number().int().min(0),
            }),
            ...PROTECTED_ERRORS,
          },
        },
      },
      async (request) => {
        const context = tenantOf(request);
        const { repos, reads } = context;
        const scope = await resolveScope(repos, request.query);
        // The totals span all of the scope's evidence, so the whole scope is probed.
        await requirePersonAccess(
          context,
          { scope },
          "The timeline of this case or run: its events and the totals over them.",
        );
        const { rows, totals } = await reads.exploration.timeline(scope, request.query.sortBy, {
          limit: request.query.limit + 1,
        });
        const result = page(rows, request.query.limit);
        const entries = services().runs.registry.list();
        return {
          items: result.items.map((row) => ({
            evidenceId: row.evidenceId,
            collectorId: row.collectorId,
            sourceLabel: entries.find((entry) => entry.id === row.collectorId)?.label ?? null,
            sourceUrl: row.sourceUrl,
            observedAt: isoOrNull(row.observedAt),
            collectedAt: isoOrNull(row.collectedAt),
            strength: row.strength,
            claimCount: row.claimCount,
          })),
          hasMore: result.hasMore,
          total: totals.total,
          withoutObservedAt: totals.withoutObservedAt,
          withoutCollectedAt: totals.withoutCollectedAt,
        };
      },
    );
    return Promise.resolve();
  };

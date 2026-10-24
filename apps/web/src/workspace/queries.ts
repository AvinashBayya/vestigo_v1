import { queryOptions } from "@tanstack/react-query";
import { timed, unwrap } from "../api.ts";
import { api, type paths } from "../client/index.ts";
import type { components } from "../client/schema.gen.ts";

type Ok<P extends keyof paths, M extends keyof paths[P]> = paths[P][M] extends {
  responses: { 200: { content: { "application/json": infer T } } };
}
  ? T
  : never;

export type EntityList = Ok<"/api/v1/entities", "get">;
export type EntityRow = EntityList["items"][number];
export type EntityDetail = Ok<"/api/v1/entities/{id}", "get">;
export type EntityClaim = EntityDetail["claims"][number];
export type EntityRelationship = EntityDetail["relationships"][number];
export type RelationshipDetail = Ok<"/api/v1/relationships/{id}", "get">;
export type EvidenceDetail = Ok<"/api/v1/evidence/{id}", "get">;
export type Graph = Ok<"/api/v1/graph", "get">;
export type GraphNode = Graph["nodes"][number];
export type GraphEdge = Graph["edges"][number];
export type Timeline = Ok<"/api/v1/timeline", "get">;
export type TimelineEvent = Timeline["items"][number];
export type CaseList = Ok<"/api/v1/cases", "get">;
export type CaseRow = CaseList["items"][number];
export type PinList = Ok<"/api/v1/cases/{id}/pins", "get">;
export type PinRow = PinList["items"][number];
export type RunRead = Ok<"/api/v1/runs/{id}", "get">;
/**
 * Where a case's analysis stands, with its documents. The named schema
 * component the analyses endpoints $ref, not an Ok<> re-extraction: its deep
 * unions otherwise materialise as a distinct structural type (TS2719).
 */
export type CaseAnalysisRead = components["schemas"]["CaseAnalysisRead"];
export type Strength = EvidenceDetail["strength"];
export type PinTarget = PinRow["target"];

/**
 * What a workspace shows: one run's results, or what is pinned to one case.
 * A case has no other link to runs yet, so its content is exactly its pins.
 */
export type Scope =
  { readonly kind: "run"; readonly id: string } | { readonly kind: "case"; readonly id: string };

const scopeQuery = (scope: Scope) =>
  scope.kind === "run" ? { runId: scope.id } : { caseId: scope.id };

/**
 * The most any list read returns at once (the API's maximum). Beyond it a read
 * says it has more; the screen then says the list is partial, never complete.
 */
export const LIST_LIMIT = 500;

/** Why a pin count is not given when the pins read was cut: a count over it would be short. */
export const PINS_UNCOUNTED = `More than ${String(LIST_LIMIT)} pins: counted over the first ${String(LIST_LIMIT)} only, so a count here would be short.`;

/** Each kind of pin in words, one and many. */
export const PIN_WORDS: Readonly<Record<PinTarget["type"], readonly [string, string]>> = {
  evidence: ["evidence record", "evidence records"],
  entity: ["entity", "entities"],
  claim: ["claim", "claims"],
  relationship: ["relationship", "relationships"],
};

/** The kinds of pin, in the order they are counted. */
export const PIN_TYPES = Object.keys(PIN_WORDS) as PinTarget["type"][];

export const entitiesQuery = (scope: Scope) =>
  queryOptions({
    queryKey: ["entities", scope.kind, scope.id],
    queryFn: ({ signal }): Promise<EntityList> =>
      unwrap(
        api.GET("/api/v1/entities", {
          params: { query: { ...scopeQuery(scope), limit: LIST_LIMIT } },
          signal: timed(signal),
        }),
      ),
  });

export const entityQuery = (id: string) =>
  queryOptions({
    queryKey: ["entity", id],
    queryFn: ({ signal }): Promise<EntityDetail> =>
      unwrap(
        api.GET("/api/v1/entities/{id}", {
          params: { path: { id }, query: { claimLimit: LIST_LIMIT } },
          signal: timed(signal),
        }),
      ),
  });

export const relationshipQuery = (id: string) =>
  queryOptions({
    queryKey: ["relationship", id],
    queryFn: ({ signal }): Promise<RelationshipDetail> =>
      unwrap(
        api.GET("/api/v1/relationships/{id}", {
          params: { path: { id }, query: { claimLimit: LIST_LIMIT } },
          signal: timed(signal),
        }),
      ),
  });

export const evidenceQuery = (id: string) =>
  queryOptions({
    queryKey: ["evidence", id],
    queryFn: ({ signal }): Promise<EvidenceDetail> =>
      unwrap(
        api.GET("/api/v1/evidence/{id}", {
          params: { path: { id }, query: { claimLimit: LIST_LIMIT } },
          signal: timed(signal),
        }),
      ),
  });

export const graphQuery = (scope: Scope, hops: number) =>
  queryOptions({
    queryKey: ["graph", scope.kind, scope.id, hops],
    queryFn: ({ signal }): Promise<Graph> =>
      unwrap(
        api.GET("/api/v1/graph", {
          params: { query: { ...scopeQuery(scope), hops, maxNodes: LIST_LIMIT } },
          signal: timed(signal),
        }),
      ),
  });

export type TimeOrder = "observedAt" | "collectedAt";

export const timelineQuery = (scope: Scope, sortBy: TimeOrder) =>
  queryOptions({
    queryKey: ["timeline", scope.kind, scope.id, sortBy],
    queryFn: ({ signal }): Promise<Timeline> =>
      unwrap(
        api.GET("/api/v1/timeline", {
          params: { query: { ...scopeQuery(scope), sortBy, limit: LIST_LIMIT } },
          signal: timed(signal),
        }),
      ),
  });

export const casesQuery = queryOptions({
  queryKey: ["cases"],
  queryFn: ({ signal }): Promise<CaseList> =>
    unwrap(
      api.GET("/api/v1/cases", { params: { query: { limit: LIST_LIMIT } }, signal: timed(signal) }),
    ),
});

export const caseQuery = (id: string) =>
  queryOptions({
    queryKey: ["case", id],
    queryFn: ({ signal }): Promise<CaseRow> =>
      unwrap(api.GET("/api/v1/cases/{id}", { params: { path: { id } }, signal: timed(signal) })),
  });

export const casePinsQuery = (id: string) =>
  queryOptions({
    queryKey: ["case-pins", id],
    queryFn: ({ signal }): Promise<PinList> =>
      unwrap(
        api.GET("/api/v1/cases/{id}/pins", {
          params: { path: { id }, query: { limit: LIST_LIMIT } },
          signal: timed(signal),
        }),
      ),
  });

/** Where a case's analysis stands now (COMPLETE/PENDING/FAILED/STALE/NONE_YET), with its documents. */
export const caseAnalysisQuery = (id: string) =>
  queryOptions({
    queryKey: ["case-analysis", id],
    // No return annotation: CaseAnalysisRead's deep unions trip a structural
    // check (TS2719) against unwrap's inferred type, which are the same type.
    queryFn: ({ signal }) =>
      unwrap(
        api.GET("/api/v1/cases/{id}/analyses", { params: { path: { id } }, signal: timed(signal) }),
      ),
  });

export const runQuery = (id: string) =>
  queryOptions({
    queryKey: ["run", id],
    queryFn: ({ signal }): Promise<RunRead> =>
      unwrap(api.GET("/api/v1/runs/{id}", { params: { path: { id } }, signal: timed(signal) })),
  });

/** Every read a scope's tabs make, so one refresh re-reads all of them. */
export const scopeKeys = (scope: Scope) => [
  ["entities", scope.kind, scope.id],
  ["graph", scope.kind, scope.id],
  ["timeline", scope.kind, scope.id],
  ...(scope.kind === "case"
    ? [
        ["case", scope.id],
        ["case-pins", scope.id],
      ]
    : // A run's report list and its reports too, so Refresh never leaves the Report tab stale.
      [["run", scope.id], ["run-reports", scope.id], ["report"], ["report-pdf"]]),
];

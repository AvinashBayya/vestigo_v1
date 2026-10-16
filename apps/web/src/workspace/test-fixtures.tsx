/**
 * Shared fixtures and helpers for the workspace tests (workspace-frame.test.tsx
 * and workspace-results.test.tsx), split out of workspace.test.tsx in U1-c so
 * two groups can edit the tests in parallel. The fetch stub stays per test
 * file (vi.hoisted, so the generated client captures it at import time);
 * the helpers that read it take it as an argument (workspaceApi).
 * Values are bracketed placeholders or fixed test ids: nothing is real data.
 */
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import type { Mock } from "vitest";
import type { SessionState } from "../api.ts";
import { createAppRouter } from "../router.tsx";

export type Handler = (
  request: Request,
  body: Record<string, unknown>,
) => Response | Promise<Response>;

export const RUN_ID = "44444444-4444-4444-8444-444444444444";
export const CASE_ID = "55555555-5555-4555-8555-555555555555";
export const ARCHIVED_CASE = "55555555-5555-4555-8555-000000000009";
export const EVIDENCE_ID = "66666666-6666-4666-8666-666666666661";
export const UNREGISTERED_EVIDENCE = "66666666-6666-4666-8666-666666666662";
export const DOMAIN_ID = "77777777-7777-4777-8777-777777777771";
export const IP_ID = "77777777-7777-4777-8777-777777777772";
export const RELATIONSHIP_ID = "88888888-8888-4888-8888-888888888881";
export const STATED_CLAIM = "99999999-9999-4999-8999-999999999991";
export const DERIVED_CLAIM = "99999999-9999-4999-8999-999999999992";

export const tenant = { id: "11111111-1111-4111-8111-111111111111", name: "[Tenant one]" };
export const session: SessionState = {
  state: "SIGNED_IN",
  user: { id: "u1", email: "analyst@example.com", name: "[Analyst]" },
  activeTenantId: tenant.id,
  tenants: [tenant],
};

export const me = (permissions: string[]) => ({
  authMethod: "SESSION",
  user: { id: "u1", email: "analyst@example.com", displayName: null },
  apiKeyId: null,
  tenant: {
    id: tenant.id,
    name: tenant.name,
    plan: "TECHINT",
    vettingStatus: "NOT_SUBMITTED",
    planModules: ["TECHINT"],
  },
  permissions,
});

export const timelineItem = (overrides: Record<string, unknown> = {}) => ({
  evidenceId: EVIDENCE_ID,
  collectorId: "dns",
  sourceLabel: "[DNS source]",
  sourceUrl: "https://example.com/",
  observedAt: null,
  collectedAt: "2026-05-01T10:00:00.000Z",
  strength: "OBSERVED",
  claimCount: 2,
  ...overrides,
});

export const TIMELINE = {
  items: [
    timelineItem(),
    timelineItem({
      evidenceId: UNREGISTERED_EVIDENCE,
      collectorId: "retired-source",
      sourceLabel: null,
      sourceUrl: null,
      observedAt: "2026-04-01T00:00:00.000Z",
      collectedAt: "2026-05-02T10:00:00.000Z",
      strength: "REPORTED",
      claimCount: 1,
    }),
  ],
  hasMore: false,
  total: 2,
  withoutObservedAt: 1,
  withoutCollectedAt: 0,
};

export const entityRow = (overrides: Record<string, unknown> = {}) => ({
  id: DOMAIN_ID,
  kind: "DOMAIN",
  displayName: "example.com",
  identifier: "example.com",
  createdAt: "2026-05-01T10:00:00.000Z",
  claimCount: 2,
  evidenceCount: 1,
  relationshipCount: 1,
  strengths: ["OBSERVED", "DERIVED"],
  mergedIntoEntityId: null,
  mergedEntityCount: 0,
  ...overrides,
});

export const ENTITIES = {
  items: [
    entityRow(),
    entityRow({
      id: IP_ID,
      kind: "IP_ADDRESS",
      displayName: "192.0.2.1",
      identifier: "192.0.2.1",
      claimCount: 0,
      evidenceCount: 0,
      strengths: [],
    }),
  ],
  hasMore: false,
};

export const STATED = {
  id: STATED_CLAIM,
  evidenceId: EVIDENCE_ID,
  attribute: "registrar",
  value: null,
  strength: "OBSERVED",
  createdAt: "2026-05-01T10:00:00.000Z",
};
export const DERIVED = {
  id: DERIVED_CLAIM,
  evidenceId: EVIDENCE_ID,
  attribute: "age_days",
  value: 412,
  strength: "DERIVED",
  createdAt: "2026-05-01T10:00:00.000Z",
};

export const ENTITY = {
  entity: entityRow(),
  claims: [STATED, DERIVED],
  claimsTruncated: false,
  relationships: [
    {
      id: RELATIONSHIP_ID,
      kind: "resolves_to",
      direction: "OUTGOING",
      otherEntity: { id: IP_ID, kind: "IP_ADDRESS", displayName: "192.0.2.1" },
      claimCount: 1,
      strengths: ["OBSERVED"],
    },
  ],
  mergedEntityIds: [],
};

/** A claim as the evidence read gives it: about an entity, never both. */
export const onEvidence = (claim: typeof STATED | typeof DERIVED) => ({
  id: claim.id,
  attribute: claim.attribute,
  value: claim.value,
  strength: claim.strength,
  createdAt: claim.createdAt,
  entityId: DOMAIN_ID,
  relationshipId: null,
});

export const EVIDENCE = {
  id: EVIDENCE_ID,
  collectorId: "dns",
  collectorVersion: "1.4.0",
  sourceLabel: "[DNS source]",
  sourceUrl: "https://example.com/",
  jobId: null,
  runId: RUN_ID,
  contentHash: "sha256:[content hash]",
  observedAt: null,
  collectedAt: "2026-05-01T10:00:00.000Z",
  recordedAt: "2026-05-01T10:00:01.000Z",
  strength: "OBSERVED",
  attribution: null,
  claimCount: 2,
  claimsTruncated: false,
  stated: [onEvidence(STATED)],
  derived: [onEvidence(DERIVED)],
};

export const RELATIONSHIP = {
  relationship: {
    id: RELATIONSHIP_ID,
    kind: "resolves_to",
    source: {
      id: DOMAIN_ID,
      kind: "DOMAIN",
      displayName: "example.com",
      identifier: "example.com",
    },
    target: { id: IP_ID, kind: "IP_ADDRESS", displayName: "192.0.2.1", identifier: "192.0.2.1" },
    createdAt: "2026-05-01T10:00:00.000Z",
    claimCount: 1,
    strengths: ["OBSERVED"],
  },
  claims: [
    {
      id: STATED_CLAIM,
      evidenceId: EVIDENCE_ID,
      attribute: "record_type",
      value: "A",
      strength: "OBSERVED",
      createdAt: "2026-05-01T10:00:00.000Z",
    },
  ],
  claimsTruncated: false,
};

export const GRAPH = {
  nodes: [
    {
      id: DOMAIN_ID,
      kind: "DOMAIN",
      displayName: "example.com",
      identifier: "example.com",
      hop: 0,
      claimCount: 2,
      mergedIntoEntityId: null,
    },
    {
      id: IP_ID,
      kind: "IP_ADDRESS",
      displayName: "192.0.2.1",
      identifier: "192.0.2.1",
      hop: 1,
      claimCount: 0,
      mergedIntoEntityId: null,
    },
  ],
  edges: [
    {
      id: RELATIONSHIP_ID,
      sourceEntityId: DOMAIN_ID,
      targetEntityId: IP_ID,
      kind: "resolves_to",
      claimCount: 1,
      strengths: ["OBSERVED"],
    },
  ],
  maxHops: 1,
  truncated: false,
};

export const job = (overrides: Record<string, unknown>) => ({
  id: "j1",
  collectorId: "dns",
  sourceLabel: "[DNS source]",
  status: "SUCCEEDED",
  outcome: "FOUND",
  outcomeDetail: null,
  error: null,
  attempts: 1,
  nextAttemptAt: null,
  deadLetteredAt: null,
  startedAt: "2026-05-01T10:00:00.000Z",
  finishedAt: "2026-05-01T10:00:01.000Z",
  fusedAt: "2026-05-01T10:00:02.000Z",
  evidenceIds: [EVIDENCE_ID],
  ...overrides,
});

export const RUN = {
  id: RUN_ID,
  investigationId: "33333333-3333-4333-8333-333333333333",
  status: "PARTIAL",
  plan: {
    input: "example.com",
    requestedType: null,
    detected: { primaryType: "DOMAIN", alternateTypes: [] },
    targets: [{ type: "DOMAIN", value: "example.com" }],
    jobs: [],
    excluded: [],
  },
  createdAt: "2026-05-01T09:59:00.000Z",
  startedAt: "2026-05-01T10:00:00.000Z",
  finishedAt: "2026-05-01T10:00:05.000Z",
  settled: true,
  counts: {},
  jobs: [
    job({}),
    job({
      id: "j2",
      collectorId: "crtsh",
      sourceLabel: "[Certificate source]",
      status: "DEAD_LETTERED",
      outcome: "UNAVAILABLE",
      error: { code: "SOURCE_UNAVAILABLE", message: "[the source did not answer]" },
      evidenceIds: [],
    }),
  ],
};

export const caseRow = (id: string, title: string, archivedAt: string | null = null) => ({
  id,
  title,
  description: null,
  createdByUserId: null,
  createdAt: "2026-05-01T00:00:00.000Z",
  archivedAt,
  pinCount: 0,
});

export const CASES = {
  items: [
    caseRow(CASE_ID, "[Open case]"),
    caseRow(ARCHIVED_CASE, "[Archived case]", "2026-05-02T00:00:00.000Z"),
  ],
  hasMore: false,
};

export const LOCKED = {
  module: "PERSON_INVESTIGATION",
  moduleSummary: "[what the module does]",
  withheld: "[what was withheld]",
  reason: "MODULE_NOT_IN_PLAN",
  plan: "TECHINT",
  vettingStatus: "NOT_SUBMITTED",
  nextStep: "[the next step]",
};

export const problem = (status: number, code: string, detail: string, extra: object = {}) =>
  Response.json(
    { type: "about:blank", title: "Refused", status, code, detail, ...extra },
    { status },
  );

/** The investigation RUN belongs to, and its runs (the Graph tab's runs rail reads both). */
export const INVESTIGATION_ID = "33333333-3333-4333-8333-333333333333";
export const OTHER_RUN_ID = "44444444-4444-4444-8444-444444444445";
export const INVESTIGATION = {
  id: INVESTIGATION_ID,
  title: "[Investigation]",
  target: "example.com",
  createdByUserId: "u1",
  createdAt: "2026-05-01T09:58:00.000Z",
  archivedAt: null,
};
export const INVESTIGATION_RUNS = {
  items: [
    {
      id: RUN_ID,
      status: "PARTIAL",
      createdAt: "2026-05-01T09:59:00.000Z",
      startedAt: "2026-05-01T10:00:00.000Z",
      finishedAt: "2026-05-01T10:00:05.000Z",
    },
    {
      id: OTHER_RUN_ID,
      status: "SUCCEEDED",
      createdAt: "2026-04-01T09:59:00.000Z",
      startedAt: "2026-04-01T10:00:00.000Z",
      finishedAt: "2026-04-01T10:00:05.000Z",
    },
  ],
  hasMore: false,
};

/** What every screen here reads unless a test says otherwise. */
export const DEFAULTS: Record<string, Handler> = {
  "GET /api/v1/session": () => Response.json(session),
  "GET /api/v1/me": () =>
    Response.json(me(["run:read", "evidence:read", "case:read", "case:write"])),
  "GET /api/v1/collectors": () =>
    Response.json({
      unverifiedSourcesAllowed: false,
      accessMethodsEnabled: ["open", "official", "licensed"],
      sources: [],
      items: [],
    }),
  [`GET /api/v1/runs/${RUN_ID}`]: () => Response.json(RUN),
  "GET /api/v1/timeline": () => Response.json(TIMELINE),
  "GET /api/v1/entities": () => Response.json(ENTITIES),
  [`GET /api/v1/entities/${DOMAIN_ID}`]: () => Response.json(ENTITY),
  [`GET /api/v1/evidence/${EVIDENCE_ID}`]: () => Response.json(EVIDENCE),
  [`GET /api/v1/relationships/${RELATIONSHIP_ID}`]: () => Response.json(RELATIONSHIP),
  "GET /api/v1/graph": () => Response.json(GRAPH),
  "GET /api/v1/cases": () => Response.json(CASES),
  [`GET /api/v1/cases/${CASE_ID}`]: () => Response.json(CASES.items[0]),
  [`GET /api/v1/cases/${CASE_ID}/pins`]: () => Response.json({ items: [], hasMore: false }),
  [`GET /api/v1/investigations/${INVESTIGATION_ID}`]: () => Response.json(INVESTIGATION),
  [`GET /api/v1/investigations/${INVESTIGATION_ID}/runs`]: () => Response.json(INVESTIGATION_RUNS),
};

/** The fetch stub each test file creates (vi.hoisted, so the generated client captures it). */
export type FetchMock = Mock<(request: Request) => Promise<Response>>;

/**
 * The API over a file's fetch stub: `fakeApi` answers each request from the
 * defaults and the test's own handlers (anything else is a 404 UNEXPECTED);
 * `requestsTo` lists the requests sent to one method and path.
 */
export function workspaceApi(fetchMock: FetchMock) {
  function fakeApi(given: Record<string, Handler> = {}): void {
    const handlers = { ...DEFAULTS, ...given };
    fetchMock.mockImplementation(async (request) => {
      const path = new URL(request.url).pathname;
      const handler = handlers[`${request.method} ${path}`];
      if (handler === undefined) return problem(404, "UNEXPECTED", path);
      const text = request.method === "GET" ? "" : await request.clone().text();
      return handler(request, text === "" ? {} : (JSON.parse(text) as Record<string, unknown>));
    });
  }

  const requestsTo = (method: string, path: string) =>
    fetchMock.mock.calls
      .map(([request]) => request)
      .filter((request) => request.method === method && new URL(request.url).pathname === path);

  return { fakeApi, requestsTo };
}

export function renderAt(path: string): ReturnType<typeof createAppRouter> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: [path] }));
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

/** The body row of the grid that shows this text. */
export const rowOf = (text: string) => {
  const row = screen
    .getAllByRole("row")
    .find(
      (candidate) =>
        within(candidate).queryAllByText(text).length > 0 && candidate.closest("tbody") !== null,
    );
  if (row === undefined) throw new TypeError(`no row for ${text}`);
  return row;
};

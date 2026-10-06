/**
 * Step 4 of the web flow: a run's results and the case workspace. The real
 * router and screens, over a fetch stub; every request goes through the
 * generated client. What is checked here is what the brief makes
 * non-negotiable: source labels and both timestamps, strengths in words,
 * derived set apart from stated, an em dash (with why) for every unmeasured
 * value, pin-to-case on every result surface, provenance from any value,
 * partial lists said to be partial, and Locked rather than an error.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionState } from "./api.ts";
import { createAppRouter } from "./router.tsx";

// The generated client captures fetch when it is created, at import time.
const fetchMock = vi.hoisted(() => {
  const mock = vi.fn<(request: Request) => Promise<Response>>();
  vi.stubGlobal("fetch", mock);
  return mock;
});

type Handler = (request: Request, body: Record<string, unknown>) => Response | Promise<Response>;

const RUN_ID = "44444444-4444-4444-8444-444444444444";
const CASE_ID = "55555555-5555-4555-8555-555555555555";
const ARCHIVED_CASE = "55555555-5555-4555-8555-000000000009";
const EVIDENCE_ID = "66666666-6666-4666-8666-666666666661";
const UNREGISTERED_EVIDENCE = "66666666-6666-4666-8666-666666666662";
const DOMAIN_ID = "77777777-7777-4777-8777-777777777771";
const IP_ID = "77777777-7777-4777-8777-777777777772";
const RELATIONSHIP_ID = "88888888-8888-4888-8888-888888888881";
const STATED_CLAIM = "99999999-9999-4999-8999-999999999991";
const DERIVED_CLAIM = "99999999-9999-4999-8999-999999999992";

const tenant = { id: "11111111-1111-4111-8111-111111111111", name: "[Tenant one]" };
const session: SessionState = {
  state: "SIGNED_IN",
  user: { id: "u1", email: "analyst@example.com", name: "[Analyst]" },
  activeTenantId: tenant.id,
  tenants: [tenant],
};

const me = (permissions: string[]) => ({
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

const timelineItem = (overrides: Record<string, unknown> = {}) => ({
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

const TIMELINE = {
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

const entityRow = (overrides: Record<string, unknown> = {}) => ({
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

const ENTITIES = {
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

const STATED = {
  id: STATED_CLAIM,
  evidenceId: EVIDENCE_ID,
  attribute: "registrar",
  value: null,
  strength: "OBSERVED",
  createdAt: "2026-05-01T10:00:00.000Z",
};
const DERIVED = {
  id: DERIVED_CLAIM,
  evidenceId: EVIDENCE_ID,
  attribute: "age_days",
  value: 412,
  strength: "DERIVED",
  createdAt: "2026-05-01T10:00:00.000Z",
};

const ENTITY = {
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
const onEvidence = (claim: typeof STATED | typeof DERIVED) => ({
  id: claim.id,
  attribute: claim.attribute,
  value: claim.value,
  strength: claim.strength,
  createdAt: claim.createdAt,
  entityId: DOMAIN_ID,
  relationshipId: null,
});

const EVIDENCE = {
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

const RELATIONSHIP = {
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

const GRAPH = {
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

const job = (overrides: Record<string, unknown>) => ({
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

const RUN = {
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

const caseRow = (id: string, title: string, archivedAt: string | null = null) => ({
  id,
  title,
  description: null,
  createdByUserId: null,
  createdAt: "2026-05-01T00:00:00.000Z",
  archivedAt,
  pinCount: 0,
});

const CASES = {
  items: [
    caseRow(CASE_ID, "[Open case]"),
    caseRow(ARCHIVED_CASE, "[Archived case]", "2026-05-02T00:00:00.000Z"),
  ],
  hasMore: false,
};

const LOCKED = {
  module: "PERSON_INVESTIGATION",
  moduleSummary: "[what the module does]",
  withheld: "[what was withheld]",
  reason: "MODULE_NOT_IN_PLAN",
  plan: "TECHINT",
  vettingStatus: "NOT_SUBMITTED",
  nextStep: "[the next step]",
};

const problem = (status: number, code: string, detail: string, extra: object = {}) =>
  Response.json(
    { type: "about:blank", title: "Refused", status, code, detail, ...extra },
    { status },
  );

/** What every screen here reads unless a test says otherwise. */
const DEFAULTS: Record<string, Handler> = {
  "GET /api/v1/session": () => Response.json(session),
  "GET /api/v1/me": () =>
    Response.json(me(["run:read", "evidence:read", "case:read", "case:write"])),
  "GET /api/v1/collectors": () => Response.json({ unverifiedSourcesAllowed: true, items: [] }),
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
};

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

function renderAt(path: string) {
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

beforeEach(() => {
  // jsdom draws nothing: the graph's list stands in, as it does in any browser without a canvas.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  vi.restoreAllMocks();
});

/** The body row of the grid that shows this text. */
const rowOf = (text: string) => {
  const row = screen
    .getAllByRole("row")
    .find(
      (candidate) =>
        within(candidate).queryAllByText(text).length > 0 && candidate.closest("tbody") !== null,
    );
  if (row === undefined) throw new TypeError(`no row for ${text}`);
  return row;
};

describe("the evidence grid", () => {
  it("labels each record's source, keeps both times apart, says strength in words, and never fills an unknown", async () => {
    fakeApi();
    renderAt(`/runs/${RUN_ID}/evidence`);
    const table = await screen.findByRole("table", { name: "Evidence" });
    const dns = rowOf("[DNS source]");
    // Observed is unknown: an em dash saying why, never the collection time.
    expect(
      within(dns).getByRole("button", {
        name: /Not measured\. The source did not say when this happened/,
      }),
    ).toBeTruthy();
    expect(within(dns).getByText("OBSERVED")).toBeTruthy();
    expect(within(dns).getByRole("button", { name: /Pin evidence to a case/ })).toBeTruthy();
    // A collector the registry no longer lists: its id, and why there is no label.
    const retired = rowOf("retired-source");
    expect(
      within(retired).getByRole("button", { name: /not in the platform registry/ }),
    ).toBeTruthy();
    expect(
      within(retired).getByRole("button", { name: /No source URL was recorded/ }),
    ).toBeTruthy();
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(screen.getByText(/1 record with no observed time/)).toBeTruthy();
    // Nothing on the screen calls an unknown zero, N/A or blank.
    expect(document.body.textContent).not.toMatch(/N\/A/);
  });

  it("filters by strength, and sorts with unknown times last", async () => {
    fakeApi();
    renderAt(`/runs/${RUN_ID}/evidence`);
    const table = await screen.findByRole("table", { name: "Evidence" });
    fireEvent.change(screen.getByLabelText("Strength"), { target: { value: "REPORTED" } });
    expect(within(table).getAllByRole("row")).toHaveLength(2);
    expect(screen.getByText(/1 record match, of 2 shown/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Strength"), { target: { value: "" } });

    fireEvent.click(within(table).getByRole("button", { name: "Observed" }));
    const header = within(table).getByRole("columnheader", { name: /Observed/ });
    expect(header.getAttribute("aria-sort")).not.toBeNull();
    const firstBody = within(table).getAllByRole("row")[1];
    // Either way round, the record with no observed time sorts last.
    expect(firstBody?.textContent).toContain("retired-source");
  });

  it("says a list cut at 500 is partial, and of how many", async () => {
    fakeApi({
      "GET /api/v1/timeline": () => Response.json({ ...TIMELINE, hasMore: true, total: 812 }),
    });
    renderAt(`/runs/${RUN_ID}/evidence`);
    expect(await screen.findByText("Partial: 2 of 812 evidence records.")).toBeTruthy();
  });

  it("an empty run says what would appear and where to look", async () => {
    fakeApi({
      "GET /api/v1/timeline": () =>
        Response.json({
          items: [],
          hasMore: false,
          total: 0,
          withoutObservedAt: 0,
          withoutCollectedAt: 0,
        }),
    });
    renderAt(`/runs/${RUN_ID}/evidence`);
    expect(await screen.findByText(/This run recorded no evidence/)).toBeTruthy();
  });

  it("a refusal carrying `locked` is the Locked state, not an error; another failure offers a retry", async () => {
    fakeApi({
      "GET /api/v1/timeline": () =>
        problem(403, "MODULE_NOT_IN_PLAN", "[refused; nothing was returned]", { locked: LOCKED }),
    });
    renderAt(`/runs/${RUN_ID}/evidence`);
    const step = await screen.findByText("[the next step]");
    expect(step.closest("[role]")?.getAttribute("role")).toBe("status");
    expect(screen.getByText("[what the module does]")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    cleanup();

    let calls = 0;
    fakeApi({
      "GET /api/v1/timeline": () => {
        calls += 1;
        return calls === 1
          ? problem(503, "DB_UNAVAILABLE", "[unavailable]")
          : Response.json(TIMELINE);
      },
    });
    renderAt(`/runs/${RUN_ID}/evidence`);
    expect((await screen.findByRole("alert")).textContent).toContain("DB_UNAVAILABLE");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("table", { name: "Evidence" })).toBeTruthy();
  });
});

describe("the provenance drawer", () => {
  it("opens from a value: collector and version, run, both times, hash, URL, the raw payload, stated apart from derived", async () => {
    const created: Blob[] = [];
    vi.stubGlobal(
      "URL",
      Object.assign(URL, {
        createObjectURL: (blob: Blob) => {
          created.push(blob);
          return "blob:[payload]";
        },
        revokeObjectURL: () => undefined,
      }),
    );
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    fakeApi({
      [`GET /api/v1/evidence/${EVIDENCE_ID}/payload`]: () =>
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "application/octet-stream" },
        }),
    });
    renderAt(`/runs/${RUN_ID}/evidence`);
    fireEvent.click(
      await screen.findByRole("button", { name: "Provenance of evidence from [DNS source]" }),
    );
    const drawer = await screen.findByRole("dialog");
    await within(drawer).findByText("dns v1.4.0");
    expect(within(drawer).getByText(RUN_ID)).toBeTruthy();
    expect(within(drawer).getByText("sha256:[content hash]")).toBeTruthy();
    expect(within(drawer).getByRole("link", { name: "https://example.com/" })).toBeTruthy();
    expect(
      within(drawer).getByRole("button", { name: /Not measured\. The source did not say when/ }),
    ).toBeTruthy();
    // Stated and derived are separate sections; DERIVED is said in words.
    const stated = within(drawer).getByText("Stated by the source (1)").closest("section");
    const derived = within(drawer).getByText("Computed by the platform (1)").closest("section");
    expect(stated?.textContent).toContain("registrar");
    expect(stated?.textContent).toContain("null (stated as empty)");
    expect(derived?.textContent).toContain("age_days");
    expect(derived?.textContent).toContain("DERIVED");
    // Pin from inside the drawer too: the evidence and each claim.
    expect(within(drawer).getAllByRole("button", { name: /^Pin / }).length).toBe(3);

    fireEvent.click(within(drawer).getByRole("button", { name: "Download raw payload" }));
    await waitFor(() => {
      expect(created).toHaveLength(1);
    });
    expect(requestsTo("GET", `/api/v1/evidence/${EVIDENCE_ID}/payload`)).toHaveLength(1);
  });

  it("opens from a relationship, and walks to the evidence behind its claim and back", async () => {
    fakeApi();
    renderAt(`/runs/${RUN_ID}/graph`);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Provenance of the relationship: example.com resolves_to 192.0.2.1",
      }),
    );
    const drawer = await screen.findByRole("dialog");
    await within(drawer).findByText("What asserts it");
    expect(within(drawer).getByRole("button", { name: /Pin relationship to a case/ })).toBeTruthy();
    fireEvent.click(within(drawer).getByRole("button", { name: "Evidence behind this claim" }));
    await within(drawer).findByText("dns v1.4.0");
    fireEvent.click(within(drawer).getByRole("button", { name: "Back" }));
    expect(await within(drawer).findByText("What asserts it")).toBeTruthy();
  });
});

describe("pin-to-case", () => {
  it("pins by type and id to an open case the reader chooses; archived cases are not offered", async () => {
    fakeApi({
      [`POST /api/v1/cases/${CASE_ID}/pins`]: (_request, body) =>
        Response.json(
          {
            id: "pin-1",
            caseId: CASE_ID,
            target: (body as { target: unknown }).target,
            note: null,
            pinnedByUserId: "u1",
            createdAt: "2026-05-03T00:00:00.000Z",
            subject: null,
          },
          { status: 201 },
        ),
    });
    renderAt(`/runs/${RUN_ID}/evidence`);
    await screen.findByRole("table", { name: "Evidence" });
    fireEvent.click(within(rowOf("[DNS source]")).getByRole("button", { name: /Pin evidence/ }));
    fireEvent.click(await screen.findByRole("button", { name: "[Open case]" }));
    expect(screen.queryByRole("button", { name: "[Archived case]" })).toBeNull();
    expect(await screen.findByText(/Pinned to/)).toBeTruthy();
    const [request] = requestsTo("POST", `/api/v1/cases/${CASE_ID}/pins`);
    expect(await request?.json()).toEqual({
      target: { type: "evidence", id: EVIDENCE_ID },
      note: null,
    });
  });

  it("creates a case and pins to it in one step", async () => {
    const NEW_CASE = "55555555-5555-4555-8555-00000000000a";
    fakeApi({
      "POST /api/v1/cases": () => Response.json(caseRow(NEW_CASE, "[New case]"), { status: 201 }),
      [`POST /api/v1/cases/${NEW_CASE}/pins`]: () =>
        Response.json(
          {
            id: "pin-2",
            caseId: NEW_CASE,
            target: { type: "entity", id: DOMAIN_ID },
            note: null,
            pinnedByUserId: "u1",
            createdAt: "2026-05-03T00:00:00.000Z",
            subject: null,
          },
          { status: 201 },
        ),
    });
    renderAt(`/runs/${RUN_ID}/entities`);
    await screen.findByRole("table", { name: "Entities" });
    fireEvent.click(within(rowOf("example.com")).getByRole("button", { name: /Pin entity/ }));
    fireEvent.change(await screen.findByLabelText("New case"), { target: { value: "[New case]" } });
    fireEvent.click(screen.getByRole("button", { name: "Create and pin" }));
    expect(await screen.findByText(/Pinned to/)).toBeTruthy();
    expect(requestsTo("POST", `/api/v1/cases/${NEW_CASE}/pins`)).toHaveLength(1);
  });

  it("a role that cannot pin is told why, before anything is sent", async () => {
    fakeApi({
      "GET /api/v1/me": () => Response.json(me(["run:read", "evidence:read", "case:read"])),
    });
    renderAt(`/runs/${RUN_ID}/evidence`);
    await screen.findByRole("table", { name: "Evidence" });
    fireEvent.click(within(rowOf("[DNS source]")).getByRole("button", { name: /Pin evidence/ }));
    expect(await screen.findByText(/cannot pin to cases/)).toBeTruthy();
    expect(fetchMock.mock.calls.some(([request]) => request.method === "POST")).toBe(false);
  });
});

describe("entities", () => {
  it("lists each entity with its class in words; its claims open provenance, derived set apart; relationships pin", async () => {
    fakeApi();
    renderAt(`/runs/${RUN_ID}/entities`);
    await screen.findByRole("table", { name: "Entities" });
    expect(within(rowOf("192.0.2.1")).getByText("IP address")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "example.com" }));
    const panel = await screen.findByRole("region", { name: "Entity" });
    await within(panel).findByText("Stated by a source (1)");
    expect(
      within(panel).getByText("Computed by the platform (1)").closest("section")?.textContent,
    ).toContain("DERIVED");
    expect(within(panel).getByRole("button", { name: /Pin relationship to a case/ })).toBeTruthy();
    fireEvent.click(within(panel).getByRole("button", { name: "Provenance of registrar" }));
    const drawer = await screen.findByRole("dialog");
    // The claim it opened from is marked in the evidence.
    await waitFor(() => {
      expect(
        within(drawer).getByText("registrar").closest("li")?.getAttribute("aria-current"),
      ).toBe("true");
    });
  });

  it("a list with more than it returned is partial, and the overview's count is an em dash with why", async () => {
    fakeApi({ "GET /api/v1/entities": () => Response.json({ ...ENTITIES, hasMore: true }) });
    renderAt(`/runs/${RUN_ID}/entities`);
    expect(await screen.findByText("Partial: 2 of more than 500 entities.")).toBeTruthy();
    cleanup();
    fakeApi({ "GET /api/v1/entities": () => Response.json({ ...ENTITIES, hasMore: true }) });
    renderAt(`/runs/${RUN_ID}/overview`);
    expect(
      await screen.findByRole("button", { name: /Not measured\. More than 500 entities/ }),
    ).toBeTruthy();
  });
});

describe("the graph", () => {
  it("lists every node with its class in words and every edge, says when it is cut, and opens an entity", async () => {
    fakeApi({ "GET /api/v1/graph": () => Response.json({ ...GRAPH, truncated: true }) });
    renderAt(`/runs/${RUN_ID}/graph`);
    expect(await screen.findByText(/Partial: the graph was cut at 500 entities/)).toBeTruthy();
    expect(screen.getByText(/This browser cannot draw the graph/)).toBeTruthy();
    const legend = screen.getByRole("list", { name: "Legend" });
    expect(legend.textContent).toContain("Domain");
    expect(legend.textContent).toContain("IP address");
    expect(screen.getAllByRole("button", { name: /Pin entity to a case/ })).toHaveLength(2);
    expect(screen.getByRole("button", { name: /Pin relationship to a case/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Only these" }));
    await waitFor(() => {
      expect(
        requestsTo("GET", "/api/v1/graph").some(
          (request) => new URL(request.url).searchParams.get("hops") === "0",
        ),
      ).toBe(true);
    });
  });
});

describe("the timeline", () => {
  it("places undated events apart, never at the other time, and reorders by collection time on request", async () => {
    fakeApi();
    renderAt(`/runs/${RUN_ID}/timeline`);
    const undated = await screen.findByRole("list", { name: "Undated events" });
    expect(undated.textContent).toContain("[DNS source]");
    expect(screen.getByRole("list", { name: "Timeline" }).textContent).toContain("retired-source");
    fireEvent.click(screen.getByRole("button", { name: "Collected time" }));
    await waitFor(() => {
      expect(
        requestsTo("GET", "/api/v1/timeline").some(
          (request) => new URL(request.url).searchParams.get("sortBy") === "collectedAt",
        ),
      ).toBe(true);
    });
  });
});

describe("the overview", () => {
  it("for a run: its coverage, a partial run said to be partial, its gaps with reasons, and counts that were measured", async () => {
    fakeApi();
    renderAt(`/runs/${RUN_ID}/overview`);
    expect(await screen.findByText(/These results are partial/)).toBeTruthy();
    expect(screen.getByText("[the source did not answer]")).toBeTruthy();
    expect(screen.getByText("1 failed")).toBeTruthy();
    expect(screen.getByText("1 ran")).toBeTruthy();
    const evidence = screen.getByText("Evidence records").parentElement;
    expect(evidence?.textContent).toContain("2");
  });

  it("for a case: labelled pinned items only, with its pins counted by kind", async () => {
    fakeApi();
    renderAt(`/cases/${CASE_ID}/overview`);
    expect(await screen.findByText("Pinned items only.")).toBeTruthy();
    expect(await screen.findByText(/Nothing is pinned yet/)).toBeTruthy();
    // A case has no Progress tab: it is not a run.
    expect(screen.queryByRole("link", { name: "Progress" })).toBeNull();
    expect(
      requestsTo("GET", "/api/v1/timeline").every(
        (request) => new URL(request.url).searchParams.get("caseId") === CASE_ID,
      ),
    ).toBe(true);
  });

  it("a run still collecting says its results are not final", async () => {
    fakeApi({
      [`GET /api/v1/runs/${RUN_ID}`]: () =>
        Response.json({ ...RUN, status: "RUNNING", settled: false }),
    });
    renderAt(`/runs/${RUN_ID}/overview`);
    expect(await screen.findByText(/This run is still collecting/)).toBeTruthy();
  });
});

describe("navigation", () => {
  it("every tab with an endpoint is reachable; an unknown tab is said plainly", async () => {
    fakeApi();
    renderAt(`/runs/${RUN_ID}/overview`);
    const nav = await screen.findByRole("navigation", { name: "Workspace" });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Progress", "Overview", "Entities", "Evidence", "Graph", "Timeline"]);
    cleanup();
    fakeApi();
    renderAt(`/runs/${RUN_ID}/media`);
    expect(await screen.findByText(/There is no/)).toBeTruthy();
  });
});

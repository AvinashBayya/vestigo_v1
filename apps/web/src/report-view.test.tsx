/**
 * Step 5 of the web flow: the report view. The real router and screen over a
 * fetch stub; every request goes through the generated client. The report's
 * wording below is exactly what the API stores (captured from a generated
 * report), so the screen is checked against the words the PDF prints.
 */
import { PRODUCT_NAME } from "@repo/config/product";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionState } from "./api.ts";
import { createAppRouter } from "./router.tsx";
// Every screen the router loads on demand, loaded with this file (see test-screens.ts).
import "./test-screens.ts";

// The generated client captures fetch when it is created, at import time.
const fetchMock = vi.hoisted(() => {
  const mock = vi.fn<(request: Request) => Promise<Response>>();
  vi.stubGlobal("fetch", mock);
  return mock;
});

/** The report wording exactly as the API stores it (captured from a generated report). */
const WORDING = {
  glossary: [
    {
      strength: "OBSERVED",
      definition: "Seen directly by the platform, not taken from anyone's statement.",
    },
    {
      strength: "REPORTED",
      definition:
        "Stated by the cited source. The platform recorded the statement; it did not verify the fact.",
    },
    {
      strength: "DERIVED",
      definition:
        "Computed by the platform from recorded values (a count, a parsed date, a split list). No source stated it.",
    },
    {
      strength: "CORRELATED",
      definition:
        "A link drawn by the analysis model between two or more independent cited sources.",
    },
    {
      strength: "INFERRED",
      definition:
        "An analytic inference drawn by the analysis model from the cited evidence. No source stated it.",
    },
    {
      strength: "HYPOTHESIS",
      definition: "A possibility the cited evidence permits but does not establish.",
    },
  ],
  headings: {
    coverage: "Coverage and limitations",
    notCollected: "What was not collected, and why",
    collected: "What was collected",
    standingLimits: "Standing limits of this report",
    glossary: "How to read the claim labels",
    synthesis: "Synthesis",
    findings: "Findings",
    relationships: "Relationships",
    untrustedContent: "Content that resembles instructions to an AI system",
    evidenceBasis: "Evidence basis",
    attribution: "Attribution",
    renderingNote: "Rendering note",
  },
  cover: {
    target: "Target: ",
    collectedAs: "Collected as: ",
    run: "Run: ",
    runValue: "{runId}, status {status}",
    generated: "Generated: ",
  },
  marking: {
    set: "HANDLING: {marking}",
    notSet: "NO HANDLING MARKING IS SET FOR THIS ORGANISATION",
  },
  footer: {
    report: "Report {reportId}",
    page: "Page {page} of {pages}",
  },
  states: {
    COLLECTED: "COLLECTED",
    NOTHING_FOUND: "NOTHING FOUND",
    FAILED: "FAILED",
    NEEDS_CREDENTIALS: "NEEDS CREDENTIALS",
    REFUSED: "REFUSED",
    NOT_FINISHED: "NOT FINISHED",
    EXCLUDED: "EXCLUDED",
    HELD: "HELD",
  },
  coverage: {
    allCollected: "Every collector planned for this target collected something.",
    noneCollected: "No collector found anything for this target.",
    notApplicable: "Not applicable to this target's type: ",
    evidenceItems: "{count} evidence item(s)",
    attempts: "{count} attempt(s)",
    omittedClaims:
      "{count} further claim(s) were left out of this report at its size limit; the run holds them.",
  },
  synthesis: {
    model: "Model: {id} ({licence}, {profile} profile).",
    servedBy: "Served by: {provider}, as the endpoint {endpoint} reported it.",
    servedByEndpoint:
      "Served by: {endpoint}, the endpoint this request was sent to. It named no upstream provider.",
    regionHeader:
      "The endpoint reported region header {name}: {value}. This records what the endpoint said; it is not a guarantee of where the request was processed.",
    notRequested:
      "No synthesis was requested for this report. Every finding below is as collected.",
    none: "No synthesis: {reason}",
  },
  findings: {
    none: "The run recorded no claims.",
    emptyValue: "(empty)",
    shortened: "[shortened; the JSON export holds the full value]",
  },
  untrustedContent: {
    intro:
      "These sources contain text addressed to AI systems, a common form of prompt injection. It was treated as data throughout: it is reported below as collected and was never followed.",
    line: "Source {number}: {patterns}",
  },
  evidence: {
    intro:
      "Every evidence item this report rests on. Numbers match the citations. The content hash identifies the stored raw response.",
    none: "The run recorded no evidence.",
    columns: {
      number: "No.",
      source: "Source",
      collected: "Collected",
      strength: "Strength",
      claims: "Claims",
    },
    notRecorded: "not recorded",
    detail: "Evidence {evidenceId}. {contentHash}. {url}",
    noUrl: "No URL recorded.",
  },
  footnote: {
    line: "{number}. {label}, {collected}. {url}. Evidence {evidenceId}.",
    collectedAt: "collected {at}",
    collectedUnknown: "collection time not recorded",
    noUrl: "no URL recorded",
    missing: "{number}. Source not found in this report.",
  },
  attribution: {
    none: "No source used in this report requires attribution.",
  },
  renderingNote:
    '{count} character(s) in this report are outside the embedded font\'s coverage and are shown as "?". The JSON export holds the exact text.',
  tabular: {
    markingNotSet: "not set",
    notRecorded: "not recorded",
  },
} as const;

const RUN_ID = "44444444-4444-4444-8444-444444444444";
const REPORT_ID = "12121212-1212-4121-8121-121212121212";
const EVIDENCE_ID = "66666666-6666-4666-8666-666666666661";
const ENTITY_ID = "77777777-7777-4777-8777-777777777771";

const tenant = { id: "11111111-1111-4111-8111-111111111111", name: "[Tenant one]" };
const session: SessionState = {
  state: "SIGNED_IN",
  user: { id: "u1", email: "analyst@example.com", name: "[Analyst]" },
  activeTenantId: tenant.id,
  tenants: [tenant],
};

const RUN = {
  id: RUN_ID,
  investigationId: "33333333-3333-4333-8333-333333333333",
  status: "PARTIAL",
  plan: null,
  createdAt: "2026-05-01T09:59:00.000Z",
  startedAt: "2026-05-01T10:00:00.000Z",
  finishedAt: "2026-05-01T10:00:05.000Z",
  settled: true,
  counts: {},
  jobs: [],
};

const SOURCE = {
  number: 1,
  evidenceId: EVIDENCE_ID,
  collectorId: "[collector]",
  sourceLabel: "[Source label]",
  sourceUrl: null,
  collectedAt: "2026-05-01T10:00:01.000Z",
  observedAt: null,
  contentHash: "sha256:[content hash]",
  strength: "REPORTED",
  claimCount: 2,
};

type Synthesis = Record<string, unknown>;

const documentWith = (synthesis: Synthesis, partial = true) => ({
  formatVersion: 3,
  reportId: REPORT_ID,
  title: "[Report title]",
  investigationId: RUN.investigationId,
  runId: RUN_ID,
  target: { input: "[target]", types: [{ type: "DOMAIN", value: "[target]" }] },
  run: {
    status: partial ? "PARTIAL" : "SUCCEEDED",
    startedAt: RUN.startedAt,
    finishedAt: RUN.finishedAt,
  },
  generatedAt: "2026-05-01T10:01:00.000Z",
  handlingMarking: null,
  coverage: {
    runStatus: partial ? "PARTIAL" : "SUCCEEDED",
    partial,
    headline: "[coverage headline as the report states it]",
    entries: [
      {
        collectorId: "[failed collector]",
        sourceLabel: "[Failed source]",
        state: "FAILED",
        targetType: "DOMAIN",
        reasonCode: "UPSTREAM_UNAVAILABLE",
        detail: "[why it failed]",
        evidenceCount: 0,
        attempts: 5,
      },
      {
        collectorId: "[held collector]",
        sourceLabel: "[Held source]",
        state: "HELD",
        targetType: "DOMAIN",
        reasonCode: "COLLECTOR_HELD",
        detail: "[why it is held]",
        evidenceCount: 0,
        attempts: null,
      },
      {
        collectorId: "[empty collector]",
        sourceLabel: "[Source that found nothing]",
        state: "NOTHING_FOUND",
        targetType: "DOMAIN",
        reasonCode: null,
        detail: "[what it looked for]",
        evidenceCount: 0,
        attempts: 1,
      },
      {
        collectorId: "[collector]",
        sourceLabel: "[Source label]",
        state: "COLLECTED",
        targetType: "DOMAIN",
        reasonCode: null,
        detail: null,
        evidenceCount: 1,
        attempts: 1,
      },
    ],
    notApplicable: [],
    caveats: ["[a standing limit]"],
  },
  findings: [
    {
      entityId: ENTITY_ID,
      kind: "DOMAIN",
      displayName: "[entity]",
      identifier: "[entity identifier]",
      claims: [
        {
          claimId: "99999999-9999-4999-8999-999999999991",
          attribute: "[stated attribute]",
          value: "[stated value]",
          display: { text: "[stated value]", truncated: false },
          strength: "REPORTED",
          citations: [1],
        },
        {
          claimId: "99999999-9999-4999-8999-999999999992",
          attribute: "[derived attribute]",
          value: "[derived value]",
          display: { text: "[derived value]", truncated: false },
          strength: "DERIVED",
          citations: [1, 9],
        },
      ],
    },
  ],
  relationships: [],
  sources: [SOURCE],
  synthesis,
  attributions: [],
  untrustedContent: [],
  omittedClaims: 0,
  wording: WORDING,
  producedBy: PRODUCT_NAME,
});

const report = (overrides: Record<string, unknown>) => ({
  id: REPORT_ID,
  runId: RUN_ID,
  status: "SUCCEEDED",
  includeSynthesis: false,
  attempts: 1,
  error: null,
  createdAt: "2026-05-01T10:00:30.000Z",
  startedAt: "2026-05-01T10:00:31.000Z",
  finishedAt: "2026-05-01T10:01:00.000Z",
  document: documentWith({ status: "NOT_REQUESTED" }),
  pdf: { status: "READY", byteLength: 4, contentHash: "sha256:[pdf hash]", error: null },
  ...overrides,
});

const GENERATED = (model: Record<string, unknown>) => ({
  status: "GENERATED",
  model: {
    id: "[model id]",
    licence: "[licence]",
    profile: "[profile]",
    endpointHost: "[endpoint.host]",
    servedBy: null,
    regionHeaders: [],
    ...model,
  },
  statements: [{ text: "[a cited statement]", strength: "INFERRED", citations: [1] }],
  generatedAt: "2026-05-01T10:00:59.000Z",
  attempts: 1,
  notice: "[the model-written notice as stored]",
});

type Handler = (request: Request) => Response | Promise<Response>;

const problem = (status: number, code: string, detail: string, extra: object = {}) =>
  Response.json(
    { type: "about:blank", title: "Refused", status, code, detail, ...extra },
    { status },
  );

const pdfBytes = () =>
  new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
    headers: { "content-type": "application/pdf" },
  });

const DEFAULTS: Record<string, Handler> = {
  "GET /api/v1/session": () => Response.json(session),
  "GET /api/v1/me": () =>
    Response.json({
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
      permissions: ["run:read", "evidence:read", "case:read", "case:write", "report:create"],
    }),
  [`GET /api/v1/runs/${RUN_ID}`]: () => Response.json(RUN),
  [`GET /api/v1/runs/${RUN_ID}/reports`]: () =>
    Response.json({ items: [report({})], hasMore: false }),
  [`GET /api/v1/reports/${REPORT_ID}`]: () => Response.json(report({})),
  [`GET /api/v1/reports/${REPORT_ID}/export/pdf`]: () => pdfBytes(),
  [`GET /api/v1/evidence/${EVIDENCE_ID}`]: () =>
    Response.json({
      id: EVIDENCE_ID,
      collectorId: "[collector]",
      collectorVersion: "1.0.0",
      sourceLabel: "[Source label]",
      sourceUrl: null,
      jobId: null,
      runId: RUN_ID,
      contentHash: "sha256:[content hash]",
      observedAt: null,
      collectedAt: "2026-05-01T10:00:01.000Z",
      recordedAt: "2026-05-01T10:00:02.000Z",
      strength: "REPORTED",
      attribution: null,
      claimCount: 0,
      claimsTruncated: false,
      stated: [],
      derived: [],
    }),
};

function fakeApi(given: Record<string, Handler> = {}): void {
  const handlers = { ...DEFAULTS, ...given };
  fetchMock.mockImplementation(async (request) => {
    const path = new URL(request.url).pathname;
    const handler = handlers[`${request.method} ${path}`];
    if (handler === undefined) return problem(404, "UNEXPECTED", path);
    return handler(request);
  });
}

const requestsTo = (method: string, path: string) =>
  fetchMock.mock.calls
    .map(([request]) => request)
    .filter((request) => request.method === method && new URL(request.url).pathname === path);

function renderReport({ strict = false }: { readonly strict?: boolean } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createAppRouter(
    queryClient,
    createMemoryHistory({ initialEntries: [`/runs/${RUN_ID}/report`] }),
  );
  const app = (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
  render(strict ? <StrictMode>{app}</StrictMode> : app);
}

beforeEach(() => {
  vi.stubGlobal(
    "URL",
    Object.assign(URL, { createObjectURL: () => "blob:[pdf]", revokeObjectURL: () => undefined }),
  );
});

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  vi.stubGlobal("fetch", fetchMock);
});

describe("the report view", () => {
  it("shows a partial run's coverage as stored: failed and held sources with their reasons, and none hidden", async () => {
    fakeApi();
    renderReport();
    const article = await screen.findByRole("article", { name: "Report" });
    // REGRESSION (review 2026-10-06): the stored headline, boxed as the PDF boxes it, and no
    // sentence of the screen's own (partial is also true for FAILED and CANCELLED runs).
    expect(screen.getByRole("status", { name: "Coverage" }).textContent).toBe(
      "[coverage headline as the report states it]",
    );
    expect(screen.queryByText(/partial run\./)).toBeNull();
    const missed = within(article).getByRole("region", { name: WORDING.headings.notCollected });
    expect(within(missed).getByText("[Failed source]")).toBeTruthy();
    expect(within(missed).getByText("UPSTREAM_UNAVAILABLE")).toBeTruthy();
    expect(within(missed).getByText(WORDING.states.FAILED)).toBeTruthy();
    expect(within(missed).getByText("[Held source]")).toBeTruthy();
    expect(within(missed).getByText(WORDING.states.HELD)).toBeTruthy();
    // A held source never ran: no attempts to count, an em dash that says so, never 0.
    expect(
      within(missed).getByRole("button", { name: /Not measured\. Never attempted/ }),
    ).toBeTruthy();
    const got = within(article).getByRole("region", { name: WORDING.headings.collected });
    expect(within(got).getByText("[Source label]")).toBeTruthy();
    // REGRESSION (review 2026-10-06, high): found nothing is not collected. The stored PDF
    // lists it under what was not collected, and why; so does the screen.
    expect(within(missed).getByText("[Source that found nothing]")).toBeTruthy();
    expect(within(got).queryByText("[Source that found nothing]")).toBeNull();
    // The evidence count is printed for collected rows only, as the stored report prints it.
    expect(within(got).getByText("1 evidence item(s)")).toBeTruthy();
    expect(within(missed).queryByText(/evidence item/)).toBeNull();
    expect(within(article).getByText("[a standing limit]")).toBeTruthy();
    expect(within(article).getByText(WORDING.synthesis.notRequested)).toBeTruthy();
  });

  it("gives every claim its strength in words and its citations, which open the cited evidence", async () => {
    fakeApi();
    renderReport();
    const article = await screen.findByRole("article", { name: "Report" });
    const stated = within(article).getByText("[stated attribute]").closest("li");
    expect(stated?.textContent).toContain("REPORTED");
    const derived = within(article).getByText("[derived attribute]").closest("li");
    expect(derived?.textContent).toContain("DERIVED");
    expect(derived?.textContent).toContain("computed by the platform");
    expect(within(stated as HTMLElement).getByRole("button", { name: /Pin claim/ })).toBeTruthy();
    fireEvent.click(
      within(stated as HTMLElement).getByRole("button", { name: "Source 1: [Source label]" }),
    );
    const drawer = await screen.findByRole("dialog");
    expect(await within(drawer).findByText("sha256:[content hash]")).toBeTruthy();
  });

  it("states the model's provenance exactly as stored: the endpoint host, a region header raw, and no upstream invented", async () => {
    const withSynthesis = (model: Record<string, unknown>) =>
      report({ includeSynthesis: true, document: documentWith(GENERATED(model), false) });
    fakeApi({
      [`GET /api/v1/reports/${REPORT_ID}`]: () =>
        Response.json(
          withSynthesis({ regionHeaders: [{ name: "[region header name]", value: "bom" }] }),
        ),
    });
    renderReport();
    const provenance = await screen.findByRole("region", { name: "Model provenance" });
    expect(provenance.textContent).toContain(
      "Served by: [endpoint.host], the endpoint this request was sent to. It named no upstream provider.",
    );
    // Raw: "bom" stays "bom", never read as a place.
    expect(provenance.textContent).toContain(
      "The endpoint reported region header [region header name]: bom.",
    );
    expect(provenance.textContent).not.toMatch(/Mumbai|India|in-region/i);
    expect(screen.getByText("[a cited statement]").closest("li")?.textContent).toContain(
      "INFERRED",
    );
    expect(screen.queryByRole("status", { name: "Coverage" })).toBeNull();
    cleanup();

    fakeApi({
      [`GET /api/v1/reports/${REPORT_ID}`]: () =>
        Response.json(withSynthesis({ servedBy: "[provider]" })),
    });
    renderReport();
    const named = await screen.findByRole("region", { name: "Model provenance" });
    expect(named.textContent).toContain(
      "Served by: [provider], as the endpoint [endpoint.host] reported it.",
    );
    // REGRESSION (review 2026-10-06): no region header, no line. The stored wording prints
    // the line only when the response carried one; the screen invents no sentence for it.
    expect(named.textContent).not.toMatch(/region header/);
  });

  it("polls the stored PDF: rendering while the API answers 202, as long as Retry-After says, then the file", async () => {
    let asked = 0;
    fakeApi({
      [`GET /api/v1/reports/${REPORT_ID}/export/pdf`]: () => {
        asked += 1;
        return asked === 1
          ? Response.json(
              { status: "RENDERING", detail: "[still rendering]" },
              { status: 202, headers: { "retry-after": "1" } },
            )
          : pdfBytes();
      },
    });
    renderReport();
    await waitFor(() => {
      expect(document.body.textContent).toContain(
        "The PDF is rendering. Asking again in 1 seconds, as the server asked.",
      );
    });
    const pdf = await screen.findByLabelText("The report as a PDF", {}, { timeout: 4000 });
    expect(pdf.getAttribute("data")).toBe("blob:[pdf]");
    expect(asked).toBe(2);
  });

  it("a PDF that could not be rendered is a failure with its code, not a blank", async () => {
    fakeApi({
      [`GET /api/v1/reports/${REPORT_ID}/export/pdf`]: () =>
        problem(409, "REPORT_PDF_FAILED", "[why it could not be rendered]"),
    });
    renderReport();
    expect((await screen.findByRole("alert")).textContent).toContain("REPORT_PDF_FAILED");
  });

  it("generates: a refused synthesis says why, and a queued report is read again until it is generated", async () => {
    let reads = 0;
    let generated = false;
    fakeApi({
      [`GET /api/v1/runs/${RUN_ID}/reports`]: () =>
        Response.json({
          items: generated ? [report({ status: "QUEUED", document: null, pdf: null })] : [],
          hasMore: false,
        }),
      [`POST /api/v1/runs/${RUN_ID}/reports`]: async (request) => {
        const body = (await request.clone().json()) as { synthesis: boolean };
        if (!body.synthesis) generated = true;
        return body.synthesis
          ? problem(409, "SYNTHESIS_UNAVAILABLE", "[no model provider is configured]")
          : Response.json(
              report({ status: "QUEUED", document: null, pdf: null, finishedAt: null }),
              { status: 202 },
            );
      },
      [`GET /api/v1/reports/${REPORT_ID}`]: () => {
        reads += 1;
        return Response.json(
          reads === 1
            ? report({ status: "QUEUED", document: null, pdf: null, finishedAt: null })
            : report({}),
        );
      },
    });
    renderReport();
    expect(await screen.findByText("No report has been generated for this run yet.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Generate with a model synthesis" }));
    expect((await screen.findByRole("alert")).textContent).toContain("SYNTHESIS_UNAVAILABLE");
    fireEvent.click(screen.getByRole("button", { name: "Generate report" }));
    expect(await screen.findByText(/Queued: waiting for a worker/)).toBeTruthy();
    expect(await screen.findByRole("article", { name: "Report" }, { timeout: 5000 })).toBeTruthy();
    const posts = requestsTo("POST", `/api/v1/runs/${RUN_ID}/reports`);
    expect(
      await Promise.all(posts.map(async (request) => (await request.json()) as unknown)),
    ).toEqual([{ synthesis: true }, { synthesis: false }]);
  });

  it("a run that has not settled cannot be reported on yet, and says why", async () => {
    fakeApi({
      [`GET /api/v1/runs/${RUN_ID}`]: () =>
        Response.json({ ...RUN, status: "RUNNING", settled: false }),
    });
    renderReport();
    expect(await screen.findByText(/This run has not settled yet/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Generate report" }).hasAttribute("disabled")).toBe(
      true,
    );
  });

  it("a failed report says why, with its code; a refusal carrying `locked` is the Locked state", async () => {
    fakeApi({
      [`GET /api/v1/reports/${REPORT_ID}`]: () =>
        Response.json(
          report({
            status: "FAILED",
            document: null,
            pdf: null,
            error: { code: "[FAILURE_CODE]", message: "[why it failed]" },
          }),
        ),
    });
    renderReport();
    expect(await screen.findByText("[why it failed]")).toBeTruthy();
    expect(screen.getByText("Code: [FAILURE_CODE]")).toBeTruthy();
    cleanup();

    fakeApi({
      [`GET /api/v1/runs/${RUN_ID}/reports`]: () =>
        problem(403, "VETTING_NOT_APPROVED", "[refused; nothing was returned]", {
          locked: {
            module: "PERSON_INVESTIGATION",
            moduleSummary: "[what the module does]",
            withheld: "[what was withheld]",
            reason: "VETTING_NOT_APPROVED",
            plan: "TECHINT_AND_PERSON",
            vettingStatus: "PENDING",
            nextStep: "[the next step]",
          },
        }),
    });
    renderReport();
    const step = await screen.findByText("[the next step]");
    expect(step.closest("[role]")?.getAttribute("role")).toBe("status");
  });

  it("REGRESSION (live check 2026-10-06): the report list is read again when the report it shows is generated", async () => {
    let listReads = 0;
    fakeApi({
      [`GET /api/v1/runs/${RUN_ID}/reports`]: () => {
        listReads += 1;
        const older = {
          ...report({}),
          id: "13131313-1313-4131-8131-131313131313",
          createdAt: "2026-05-01T09:00:00.000Z",
        };
        const current = listReads === 1 ? report({ status: "RUNNING" }) : report({});
        return Response.json({ items: [older, current], hasMore: false });
      },
    });
    renderReport();
    await screen.findByRole("article", { name: "Report" });
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Report" }).textContent).toContain("SUCCEEDED");
    });
    expect(screen.getByRole("combobox", { name: "Report" }).textContent).not.toContain("RUNNING");
  });

  it("prints the cover as the report does: each type with its value, the run, and the identifier in a finding", async () => {
    fakeApi();
    renderReport();
    const article = await screen.findByRole("article", { name: "Report" });
    expect(article.textContent).toContain(`${WORDING.cover.collectedAs}DOMAIN [target]`);
    expect(article.textContent).toContain(`${WORDING.cover.run}${RUN_ID}, status PARTIAL`);
    expect(
      within(article).getByRole("heading", { name: /^\[entity\]\s*\(\[entity identifier\]\)$/ }),
    ).toBeTruthy();
  });

  it("REGRESSION (review 2026-10-06): PDF polling stops once a poll is refused, and a failed render offers no retry", async () => {
    let asked = 0;
    fakeApi({
      [`GET /api/v1/reports/${REPORT_ID}/export/pdf`]: () => {
        asked += 1;
        return asked === 1
          ? Response.json(
              { status: "RENDERING", detail: "[still rendering]" },
              { status: 202, headers: { "retry-after": "1" } },
            )
          : problem(409, "REPORT_PDF_FAILED", "[why it could not be rendered]");
      },
    });
    renderReport();
    expect(
      await screen.findByText("[why it could not be rendered]", {}, { timeout: 4000 }),
    ).toBeTruthy();
    expect(screen.getByText(/Generate the report again to render a new one/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    // Past two more Retry-After periods, nothing more was asked.
    await new Promise((resolve) => setTimeout(resolve, 2500));
    expect(asked).toBe(2);
  }, 10_000);

  it("a PDF the report records as failed is not asked for", async () => {
    fakeApi({
      [`GET /api/v1/reports/${REPORT_ID}`]: () =>
        Response.json(
          report({
            pdf: {
              status: "FAILED",
              byteLength: null,
              contentHash: null,
              error: { code: "[RENDER_CODE]", message: "[why rendering failed]" },
            },
          }),
        ),
    });
    renderReport();
    expect(await screen.findByText("[why rendering failed]")).toBeTruthy();
    expect(screen.getByText("Code: [RENDER_CODE]")).toBeTruthy();
    expect(requestsTo("GET", `/api/v1/reports/${REPORT_ID}/export/pdf`)).toHaveLength(0);
  });

  it("REGRESSION (review 2026-10-06): an export that gets no answer is said to be unreachable, with its code", async () => {
    fakeApi({
      [`GET /api/v1/reports/${REPORT_ID}/export/pdf`]: () =>
        Promise.reject(new TypeError("[network down]")),
    });
    renderReport();
    expect((await screen.findByRole("alert")).textContent).toContain("Code: API_UNREACHABLE");
  });

  it("the PDF's loading state is announced", async () => {
    fakeApi({
      [`GET /api/v1/reports/${REPORT_ID}/export/pdf`]: () => new Promise<Response>(() => undefined),
    });
    renderReport();
    // Announced in words a live region speaks, not only in a label it never reads out.
    const reading = await screen.findByText("Reading the PDF…");
    expect(reading.getAttribute("role")).toBe("status");
  });

  it("REGRESSION (review 2026-10-06): a report list cut at the read limit says it is partial", async () => {
    fakeApi({
      [`GET /api/v1/runs/${RUN_ID}/reports`]: () =>
        Response.json({ items: [report({})], hasMore: true }),
    });
    renderReport();
    expect(await screen.findByText("Partial: this run has more than 500 reports.")).toBeTruthy();
  });

  it("REGRESSION (review 2026-10-06): a spent model-token quota is stated in the API's words", async () => {
    fakeApi({
      [`POST /api/v1/runs/${RUN_ID}/reports`]: () =>
        problem(429, "QUOTA_EXCEEDED", "[a model token quota for this tenant is spent]"),
    });
    renderReport();
    const button = await screen.findByRole("button", { name: "Generate with a model synthesis" });
    // Enabled once the run is read and known to be settled.
    await waitFor(() => {
      expect(button.hasAttribute("disabled")).toBe(false);
    });
    fireEvent.click(button);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("[a model token quota for this tenant is spent]");
    expect(alert.textContent).not.toMatch(/no run can start/);
  });

  it("REGRESSION (review 2026-10-06): Refresh on the Report tab reads the run's reports again", async () => {
    fakeApi();
    renderReport();
    await screen.findByRole("article", { name: "Report" });
    const before = requestsTo("GET", `/api/v1/runs/${RUN_ID}/reports`).length;
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => {
      expect(requestsTo("GET", `/api/v1/runs/${RUN_ID}/reports`).length).toBeGreaterThan(before);
    });
  });

  it("REGRESSION (review 2026-10-06): under StrictMode the shown PDF's URL is not revoked", async () => {
    // Every Blob gets its own URL, as in a browser.
    let made = 0;
    const revoked: string[] = [];
    vi.stubGlobal(
      "URL",
      Object.assign(URL, {
        createObjectURL: () => {
          made += 1;
          return `blob:[pdf ${String(made)}]`;
        },
        revokeObjectURL: (url: string) => {
          revoked.push(url);
        },
      }),
    );
    fakeApi();
    renderReport({ strict: true });
    await screen.findByLabelText("The report as a PDF");
    // Leave the tab and come back: the panel now mounts with the PDF already cached, which
    // is where StrictMode's second effect run used to revoke the URL it was about to show.
    const tabs = screen.getByRole("navigation", { name: "Workspace" });
    fireEvent.click(within(tabs).getByRole("link", { name: "Overview" }));
    await waitFor(() => {
      expect(screen.queryByLabelText("The report as a PDF")).toBeNull();
    });
    fireEvent.click(within(tabs).getByRole("link", { name: "Report" }));
    const pdf = await screen.findByLabelText("The report as a PDF");
    await new Promise((resolve) => setTimeout(resolve, 50));
    const shown = pdf.getAttribute("data") ?? "";
    expect(shown).toMatch(/^blob:/);
    expect(revoked).not.toContain(shown);
  });

  it("prints each source's claim count, and the stored wording for a citation no source matches", async () => {
    fakeApi();
    renderReport();
    const article = await screen.findByRole("article", { name: "Report" });
    expect(article.textContent).toContain(`${WORDING.evidence.columns.claims}: 2`);
    expect(article.textContent).toContain("9. Source not found in this report.");
  });

  it("opening the tab reads the run's reports once; a just-generated report missing from a cut list is still the one named", async () => {
    fakeApi();
    renderReport();
    await screen.findByRole("article", { name: "Report" });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(requestsTo("GET", `/api/v1/runs/${RUN_ID}/reports`)).toHaveLength(1);
    cleanup();

    const NEW_ID = "14141414-1414-4141-8141-141414141414";
    const older = { ...report({}), id: "13131313-1313-4131-8131-131313131313" };
    fakeApi({
      [`GET /api/v1/runs/${RUN_ID}/reports`]: () =>
        Response.json({ items: [older, report({})], hasMore: true }),
      [`POST /api/v1/runs/${RUN_ID}/reports`]: () =>
        Response.json(
          { ...report({ status: "QUEUED", document: null, pdf: null }), id: NEW_ID },
          { status: 202 },
        ),
      [`GET /api/v1/reports/${NEW_ID}`]: () =>
        Response.json({ ...report({ status: "QUEUED", document: null, pdf: null }), id: NEW_ID }),
    });
    renderReport();
    const generateButton = await screen.findByRole("button", { name: "Generate report" });
    await waitFor(() => {
      expect(generateButton.hasAttribute("disabled")).toBe(false);
    });
    fireEvent.click(generateButton);
    const picker = await screen.findByRole("combobox", { name: "Report" });
    await waitFor(() => {
      expect((picker as HTMLSelectElement).value).toBe(NEW_ID);
    });
    expect((picker as HTMLSelectElement).selectedOptions[0]?.textContent).toBe(
      "The report just asked for",
    );
  });

  it("a refused queue is said in the API's words; a refused synthesis says a plain report still works", async () => {
    fakeApi({
      [`POST /api/v1/runs/${RUN_ID}/reports`]: async (request) => {
        const body = (await request.clone().json()) as { synthesis: boolean };
        return body.synthesis
          ? problem(409, "SYNTHESIS_UNAVAILABLE", "[no model provider is configured]")
          : problem(503, "QUEUE_UNAVAILABLE", "[the job queue could not take the report]");
      },
    });
    renderReport();
    const plain = await screen.findByRole("button", { name: "Generate report" });
    await waitFor(() => {
      expect(plain.hasAttribute("disabled")).toBe(false);
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate with a model synthesis" }));
    const refused = await screen.findByRole("alert");
    expect(refused.textContent).toContain("A report without a synthesis can still be generated");
    fireEvent.click(plain);
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain(
        "[the job queue could not take the report]",
      );
    });
    expect(screen.getByRole("alert").textContent).not.toMatch(/run could not be queued/);
  });

  it("REGRESSION (review 2026-10-06): the stored PDF is fetched once: not again on focus, nor to download it", async () => {
    const clicks: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicks.push(this.download);
    });
    fakeApi();
    renderReport();
    await screen.findByLabelText("The report as a PDF");
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    fireEvent.click(screen.getByRole("button", { name: "Download PDF" }));
    await waitFor(() => {
      expect(clicks).toEqual([`report-${REPORT_ID}.pdf`]);
    });
    expect(requestsTo("GET", `/api/v1/reports/${REPORT_ID}/export/pdf`)).toHaveLength(1);
  });
  it("the sections rail lists the stored headings in the PDF's order and links to each section; relationships and untrusted content appear only when present", async () => {
    fakeApi();
    renderReport();
    await screen.findByRole("article", { name: "Report" });
    const rail = screen.getByRole("navigation", { name: "Report sections" });
    const links = within(rail).getAllByRole("link");
    // The stored headings, never the mockup's titles, in the order the PDF prints them.
    expect(links.map((link) => link.textContent)).toEqual([
      WORDING.headings.coverage,
      WORDING.headings.glossary,
      WORDING.headings.synthesis,
      WORDING.headings.findings,
      WORDING.headings.evidenceBasis,
      WORDING.headings.attribution,
      "PDF",
    ]);
    expect(
      within(rail).queryByText(/Executive summary|Infrastructure|Timeline of events/),
    ).toBeNull();
    // Each link points at its section, which is in the report under that heading.
    const article = screen.getByRole("article", { name: "Report" });
    for (const link of links.slice(0, -1)) {
      const id = (link.getAttribute("href") ?? "").slice(1);
      const section = article.querySelector(`#${id}`);
      expect(section?.querySelector("h3")?.textContent).toBe(link.textContent);
    }
    expect(links.at(-1)?.getAttribute("href")).toBe("#report-pdf");
    expect(document.getElementById("report-pdf")).not.toBeNull();
    // The section chosen is the current one, and the citation rail follows it.
    expect(links[0]?.getAttribute("aria-current")).toBe("location");
    fireEvent.click(links[3] as HTMLElement);
    expect(links[3]?.getAttribute("aria-current")).toBe("location");
    expect(links[0]?.getAttribute("aria-current")).toBeNull();
    cleanup();

    fakeApi({
      [`GET /api/v1/reports/${REPORT_ID}`]: () =>
        Response.json(
          report({
            document: {
              ...documentWith({ status: "NOT_REQUESTED" }),
              relationships: [
                {
                  relationshipId: "88888888-8888-4888-8888-888888888881",
                  from: {
                    entityId: ENTITY_ID,
                    kind: "DOMAIN",
                    displayName: "[entity]",
                    identifier: null,
                  },
                  kind: "[RELATES_TO]",
                  to: {
                    entityId: "77777777-7777-4777-8777-777777777772",
                    kind: "IP_ADDRESS",
                    displayName: "[other entity]",
                    identifier: null,
                  },
                  strength: "OBSERVED",
                  citations: [1],
                },
              ],
              untrustedContent: [{ sourceNumber: 1, patterns: ["[pattern]"] }],
            },
          }),
        ),
    });
    renderReport();
    await screen.findByRole("article", { name: "Report" });
    const withAll = within(screen.getByRole("navigation", { name: "Report sections" }))
      .getAllByRole("link")
      .map((link) => link.textContent);
    expect(withAll).toEqual([
      WORDING.headings.coverage,
      WORDING.headings.glossary,
      WORDING.headings.synthesis,
      WORDING.headings.findings,
      WORDING.headings.relationships,
      WORDING.headings.untrustedContent,
      WORDING.headings.evidenceBasis,
      WORDING.headings.attribution,
      "PDF",
    ]);
  });

  it("the citation rail lists the chosen section's sources from the stored report: number, strength in words, source, and the stored wording for a number no source matches", async () => {
    fakeApi();
    renderReport();
    await screen.findByRole("article", { name: "Report" });
    const rail = screen.getByRole("complementary", { name: "Citations" });
    // Coverage, the first section, cites nothing: said so, with a count of 0.
    expect(within(rail).getByText("This section cites no evidence.")).toBeTruthy();
    fireEvent.click(
      within(screen.getByRole("navigation", { name: "Report sections" })).getByRole("link", {
        name: WORDING.headings.findings,
      }),
    );
    // Findings cite [1] and [9]; [9] matches no source.
    expect(rail.textContent).toContain("9. Source not found in this report.");
    expect(within(rail).getByText("REPORTED")).toBeTruthy();
    expect(within(rail).getByText("[Source label]")).toBeTruthy();
    expect(within(rail).queryByText("This section cites no evidence.")).toBeNull();
    fireEvent.click(within(rail).getByRole("button", { name: "Open source 1: [Source label]" }));
    const drawer = await screen.findByRole("dialog");
    expect(await within(drawer).findByText("sha256:[content hash]")).toBeTruthy();
  });

  it("no Unreviewed pill, no Regenerate section, no Residency, no Rejected drafts, and the citation check is Not built with no count", async () => {
    fakeApi({
      [`GET /api/v1/reports/${REPORT_ID}`]: () =>
        Response.json(
          report({
            includeSynthesis: true,
            document: documentWith(
              GENERATED({ regionHeaders: [{ name: "[region header name]", value: "bom" }] }),
            ),
          }),
        ),
    });
    renderReport();
    await screen.findByRole("region", { name: "Model provenance" });
    expect(
      screen.queryByText(
        /Unreviewed|Regenerate section|In-region|Rejected drafts|claims cite a source/,
      ),
    ).toBeNull();
    expect(screen.queryByText(/Residency/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Regenerate/ })).toBeNull();
    const check = screen.getByRole("heading", { name: "Citation check" }).closest("section");
    expect(check?.textContent).toContain(
      "Not built yet. The API does not record a citation check for a stored report.",
    );
    expect(check?.textContent).not.toMatch(/\d/);
    // The corrected sentence ("this run's", not "pinned"), shown only for a generated synthesis.
    expect(
      screen.getByText(
        "A synthesis sentence that cannot cite this run's evidence is rejected before it is stored.",
      ),
    ).toBeTruthy();
    // View PDF is the in-page link to the stored file, not a second download button.
    expect(screen.getByRole("link", { name: "View PDF" }).getAttribute("href")).toBe("#report-pdf");
  });

  it("an INFERRED statement says INFERRED and what it is from (its cited sources); a NOTHING_FOUND coverage row uses the Found nothing chip with the stored word", async () => {
    fakeApi({
      [`GET /api/v1/reports/${REPORT_ID}`]: () =>
        Response.json(report({ includeSynthesis: true, document: documentWith(GENERATED({})) })),
    });
    renderReport();
    const article = await screen.findByRole("article", { name: "Report" });
    const statement = within(article).getByText("[a cited statement]").closest("li");
    expect(statement?.textContent).toContain("INFERRED");
    expect(statement?.textContent).toContain("from source [1]");
    // Its citation opens the evidence from a standalone control after the passage (D8).
    expect(
      within(statement as HTMLElement).getByRole("button", { name: "Source 1: [Source label]" }),
    ).toBeTruthy();
    const missed = within(article).getByRole("region", { name: WORDING.headings.notCollected });
    const chip = within(missed).getByText(WORDING.states.NOTHING_FOUND);
    // The stored word, on the Found nothing colours (D7): never the Ran green.
    expect(chip.className).toContain("bg-claim-hypothesis-fill");
    expect(chip.className).not.toContain("claim-observed");
    const collected = within(article).getByRole("region", { name: WORDING.headings.collected });
    expect(within(collected).getByText(WORDING.states.COLLECTED).className).toContain(
      "bg-claim-observed-fill",
    );
  });

  it("an unconfirmed empty answer is listed as not collected, under its own stored word, never Found nothing's (D9, Track M Day 2)", async () => {
    const base = documentWith(GENERATED({}));
    const document = {
      ...base,
      coverage: {
        ...base.coverage,
        entries: [
          ...base.coverage.entries,
          {
            collectorId: "[news collector]",
            sourceLabel: "[News source]",
            state: "EMPTY_UNCONFIRMED",
            targetType: "DOMAIN",
            reasonCode: null,
            detail: "[what came back empty, and why that is not nothing]",
            evidenceCount: 0,
            attempts: 1,
          },
        ],
      },
      wording: {
        ...base.wording,
        states: { ...base.wording.states, EMPTY_UNCONFIRMED: "RETURNED NOTHING (UNCONFIRMED)" },
      },
    };
    fakeApi({
      [`GET /api/v1/reports/${REPORT_ID}`]: () =>
        Response.json(report({ includeSynthesis: true, document })),
    });
    renderReport();
    const article = await screen.findByRole("article", { name: "Report" });
    const missed = within(article).getByRole("region", { name: WORDING.headings.notCollected });
    const chip = within(missed).getByText("RETURNED NOTHING (UNCONFIRMED)");
    // Grey, as every status that produced no result (D9), and with its own word.
    expect(chip.className).toContain("bg-claim-hypothesis-fill");
    expect(missed.textContent).toContain("[what came back empty, and why that is not nothing]");
    const collected = within(article).getByRole("region", { name: WORDING.headings.collected });
    expect(collected.textContent).not.toContain("[News source]");
  });

  it("sets the serif only on the report's own title and prose, never on a container or the screen around it", async () => {
    fakeApi({
      [`GET /api/v1/reports/${REPORT_ID}`]: () =>
        Response.json(report({ includeSynthesis: true, document: documentWith(GENERATED({})) })),
    });
    renderReport();
    const article = await screen.findByRole("article", { name: "Report" });
    const serif = [...document.querySelectorAll(".font-serif")];
    expect(serif.length).toBeGreaterThan(0);
    for (const element of serif) {
      // Inside the report's document only, and only on text elements: a heading or a paragraph.
      expect(article.contains(element)).toBe(true);
      expect(["H2", "H3", "P"]).toContain(element.tagName);
      expect(element.querySelector("ul, ol, section, article, button")).toBeNull();
    }
    expect(serif.map((element) => element.textContent)).toEqual(
      expect.arrayContaining([
        "[Report title]",
        WORDING.headings.coverage,
        "[a standing limit]",
        "[the model-written notice as stored]",
        WORDING.evidence.intro,
      ]),
    );
    // A partial run's headline is the coverage callout's, and the callout is a status: sans.
    expect(screen.getByRole("status", { name: "Coverage" }).className).not.toContain("serif");
    expect(screen.getByRole("status", { name: "Coverage" }).closest(".font-serif")).toBeNull();
    expect(serif.some((element) => element.textContent.includes("[a cited statement]"))).toBe(true);
    // The rails and the PDF card stay in sans.
    expect(
      screen.getByRole("navigation", { name: "Report sections" }).querySelector(".font-serif"),
    ).toBeNull();
    expect(
      screen.getByRole("complementary", { name: "Citations" }).querySelector(".font-serif"),
    ).toBeNull();
    expect(document.getElementById("report-pdf")?.querySelector(".font-serif")).toBeNull();
  });

  it("shows the generate controls once: in the empty card while there is no report, in the toolbar after", async () => {
    fakeApi({
      [`GET /api/v1/runs/${RUN_ID}/reports`]: () => Response.json({ items: [], hasMore: false }),
    });
    renderReport();
    await screen.findByText("No report has been generated for this run yet.");
    expect(screen.getAllByRole("button", { name: "Generate report" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Generate with a model synthesis" })).toHaveLength(
      1,
    );
    expect(screen.queryByRole("link", { name: "View PDF" })).toBeNull();
    cleanup();

    fakeApi();
    renderReport();
    await screen.findByRole("article", { name: "Report" });
    expect(screen.getAllByRole("button", { name: "Generate report" })).toHaveLength(1);
    // The toolbar names the report by its stored title once it is generated.
    expect(screen.getAllByRole("heading", { level: 2, name: "[Report title]" }).length).toBe(2);
  });

  it("every section heading is the library's serif section heading, and names its section", async () => {
    fakeApi();
    renderReport();
    const article = await screen.findByRole("article", { name: "Report" });
    const sections = [...article.querySelectorAll("section[data-report-section]")];
    expect(sections.length).toBe(6);
    for (const section of sections) {
      const heading = section.querySelector("h3");
      // ReportSectionHeading: serif-title in ink-primary, never the sans title style.
      expect(heading?.className).toContain("font-serif");
      expect(heading?.className).toContain("text-serif-title");
      expect(heading?.className).toContain("text-ink-primary");
      expect(heading?.className).not.toMatch(/(^|s)text-title(s|$)/);
      expect(section.getAttribute("aria-labelledby")).toBe(heading?.id);
    }
    expect(within(article).getByRole("region", { name: WORDING.headings.findings })).toBeTruthy();
  });

  it("states the coverage headline once: in the callout under the coverage heading when partial, as prose when not", async () => {
    const occurrences = (root: HTMLElement) =>
      root.textContent.split("[coverage headline as the report states it]").length - 1;
    fakeApi();
    renderReport();
    const article = await screen.findByRole("article", { name: "Report" });
    expect(occurrences(article)).toBe(1);
    const coverage = within(article).getByRole("region", { name: WORDING.headings.coverage });
    const status = within(coverage).getByRole("status", { name: "Coverage" });
    expect(status.textContent).toBe("[coverage headline as the report states it]");
    // Under the section's heading, not before it.
    const heading = within(coverage).getByRole("heading", { level: 3 });
    expect(heading.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    cleanup();

    fakeApi({
      [`GET /api/v1/reports/${REPORT_ID}`]: () =>
        Response.json(report({ document: documentWith({ status: "NOT_REQUESTED" }, false) })),
    });
    renderReport();
    const whole = await screen.findByRole("article", { name: "Report" });
    expect(occurrences(whole)).toBe(1);
    expect(screen.queryByRole("status", { name: "Coverage" })).toBeNull();
    expect(
      within(whole).getByText("[coverage headline as the report states it]").className,
    ).toContain("font-serif");
  });

  it("groups each finding's claims behind a disclosure that states the count; every claim stays reachable, and a shortened value says so", async () => {
    const base = documentWith({ status: "NOT_REQUESTED" });
    const [finding] = base.findings;
    const claims = [
      ...(finding?.claims ?? []),
      {
        claimId: "99999999-9999-4999-8999-999999999993",
        attribute: "[long attribute]",
        value: "[the full long value]",
        display: { text: "[the shortened value]", truncated: true },
        strength: "OBSERVED",
        citations: [1],
      },
    ];
    fakeApi({
      [`GET /api/v1/reports/${REPORT_ID}`]: () =>
        Response.json(report({ document: { ...base, findings: [{ ...finding, claims }] } })),
    });
    renderReport();
    const article = await screen.findByRole("article", { name: "Report" });
    const entity = within(article).getByRole("region", { name: "[entity]" });
    const details = entity.querySelector("details");
    expect(details).not.toBeNull();
    const summary = details?.querySelector("summary");
    expect(summary?.textContent).toContain("3 claims");
    expect(summary?.textContent).toContain("1 value shortened");
    // Closed until asked for; opening it shows every claim, none dropped.
    expect(details?.open).toBe(false);
    fireEvent.click(summary as HTMLElement);
    expect(details?.open).toBe(true);
    const rows = [...(details?.querySelectorAll("li") ?? [])];
    expect(rows).toHaveLength(3);
    for (const attribute of ["[stated attribute]", "[derived attribute]", "[long attribute]"]) {
      const row = within(details as HTMLElement)
        .getByText(attribute)
        .closest("li");
      expect(within(row as HTMLElement).getByRole("button", { name: /Pin claim/ })).toBeTruthy();
    }
    // The stored shortened text and the stored wording that says it is shortened; the full
    // value is the JSON export's, never invented or cut here.
    const long = within(details as HTMLElement)
      .getByText("[long attribute]")
      .closest("li");
    expect(long?.textContent).toContain("[the shortened value]");
    expect(long?.textContent).toContain(WORDING.findings.shortened);
    expect(long?.textContent).not.toContain("[the full long value]");
  });
});

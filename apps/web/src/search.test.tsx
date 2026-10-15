/**
 * Step 2 of the web flow: the search dashboard. One input; checking a target
 * shows its type, the sources that would and would not run, and the cost
 * estimate (an em dash with its reason when there is none); starting opens the
 * investigation and queues the run. The real router and screens, over a fetch
 * stub; every request goes through the generated client.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionState } from "./api.ts";
import { createAppRouter } from "./router.tsx";
import type { Estimate } from "./search/plan.ts";

// The generated client captures fetch when it is created, at import time.
const fetchMock = vi.hoisted(() => {
  const mock = vi.fn<(request: Request) => Promise<Response>>();
  vi.stubGlobal("fetch", mock);
  return mock;
});

type Handler = (body: Record<string, unknown>, request: Request) => Response | Promise<Response>;

/** What the dashboard's panels read when a test does not say otherwise: nothing yet. */
const PANEL_DEFAULTS: Record<string, Handler> = {
  "GET /api/v1/cases": () => Response.json({ items: [], hasMore: false }),
  "GET /api/v1/collectors": () => Response.json({ unverifiedSourcesAllowed: true, items: [] }),
};

/** Answers by method and path; anything unexpected fails loudly as a 404 problem. */
function fakeApi(given: Record<string, Handler>): void {
  const handlers = { ...PANEL_DEFAULTS, ...given };
  fetchMock.mockImplementation(async (request) => {
    const path = new URL(request.url).pathname;
    const handler = handlers[`${request.method} ${path}`];
    if (handler === undefined) {
      return Response.json(
        { type: "about:blank", title: "Not Found", status: 404, code: "UNEXPECTED", detail: path },
        { status: 404 },
      );
    }
    const text = request.method === "GET" ? "" : await request.clone().text();
    return handler(text === "" ? {} : (JSON.parse(text) as Record<string, unknown>), request);
  });
}

const problem = (status: number, code: string, detail: string, extra: object = {}) =>
  Response.json(
    { type: "about:blank", title: "Refused", status, code, detail, ...extra },
    { status },
  );

const tenant = { id: "11111111-1111-4111-8111-111111111111", name: "[Tenant one]" };
const session: SessionState = {
  state: "SIGNED_IN",
  user: { id: "u1", email: "analyst@example.com", name: "[Analyst]" },
  activeTenantId: tenant.id,
  tenants: [tenant],
};

const INVESTIGATION_ID = "33333333-3333-4333-8333-333333333333";
const RUN_ID = "44444444-4444-4444-8444-444444444444";
const NO_COST = "[why no credit cost is estimated]";

/** An estimate as the API answers it, for a domain unless told otherwise. */
function estimateFor(input: string, overrides: Partial<Estimate> = {}): Estimate {
  return {
    input,
    requestedType: null,
    detectedType: "DOMAIN",
    alternateTypes: [],
    targets: [{ type: "DOMAIN", value: input, invalid: null }],
    collectors: [
      {
        collectorId: "dns",
        sourceLabel: "[DNS source]",
        targetType: "DOMAIN",
        credentials: { vaultIds: [], runsWithout: true },
        estimatedCredits: null,
        estimatedCreditsReason: NO_COST,
      },
      {
        collectorId: "keyed",
        sourceLabel: "[Keyed source]",
        targetType: "DOMAIN",
        credentials: { vaultIds: ["[vault id]"], runsWithout: false },
        estimatedCredits: null,
        estimatedCreditsReason: NO_COST,
      },
    ],
    excluded: [
      {
        collectorId: "held",
        sourceLabel: "[Unlicensed source]",
        targetType: "DOMAIN",
        reason: "LICENCE_BLOCKED",
        message: "[why its licence blocks it]",
      },
      {
        collectorId: "person",
        sourceLabel: "[Person source]",
        targetType: "DOMAIN",
        reason: "MODULE_NOT_IN_PLAN",
        message: "[why the plan excludes it]",
      },
      {
        collectorId: "phone",
        sourceLabel: "[Phone source]",
        targetType: null,
        reason: "TARGET_TYPE_NOT_ACCEPTED",
        message: "[the types it accepts]",
      },
    ],
    notPlanned: [],
    total: { estimatedCredits: null, estimatedCreditsReason: NO_COST },
    ...overrides,
  };
}

function renderHome() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: ["/"] }));
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const typeTarget = (value: string) => {
  fireEvent.change(screen.getByLabelText("Target to investigate"), { target: { value } });
};

const checkTarget = async (value: string) => {
  await screen.findByLabelText("Target to investigate");
  typeTarget(value);
  fireEvent.click(screen.getByRole("button", { name: "Investigate" }));
  await screen.findByRole("heading", { name: /Sources that would run/ });
};

const requests = (method: string, path: string) =>
  fetchMock.mock.calls.filter(
    ([request]) => request.method === method && new URL(request.url).pathname === path,
  );

const bodiesOf = async (method: string, path: string) =>
  Promise.all(
    requests(method, path).map(
      async ([request]) => JSON.parse(await request.clone().text()) as Record<string, unknown>,
    ),
  );

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  sessionStorage.clear();
});

describe("the search dashboard", () => {
  it("before any search: the newest open cases, and each collector with whether it can run here", async () => {
    const caseOf = (title: string, createdAt: string, archivedAt: string | null = null) => ({
      id: `77777777-7777-4777-8777-${createdAt.slice(8, 10).padStart(12, "0")}`,
      title,
      description: null,
      createdByUserId: null,
      createdAt,
      archivedAt,
      pinCount: 0,
    });
    const collector = (
      id: string,
      label: string,
      availability: string,
      availabilityReason: string | null,
      targetTypes: string[],
    ) => ({
      id,
      version: "1.0.0",
      label,
      discipline: "TECHINT",
      targetTypes,
      collectionMode: "PASSIVE_API",
      claimStrength: "REPORTED",
      credentials: { vaultIds: [], runsWithout: true },
      availability,
      availabilityReason,
    });
    fakeApi({
      "GET /api/v1/session": () => Response.json(session),
      "GET /api/v1/cases": () =>
        Response.json({
          items: [
            caseOf("[Oldest case]", "2026-01-01T00:00:00.000Z"),
            caseOf("[Archived case]", "2026-01-05T00:00:00.000Z", "2026-01-06T00:00:00.000Z"),
            caseOf("[Second case]", "2026-01-02T00:00:00.000Z"),
            caseOf("[Newest case]", "2026-01-04T00:00:00.000Z"),
            caseOf("[Third case]", "2026-01-03T00:00:00.000Z"),
          ],
          hasMore: false,
        }),
      "GET /api/v1/collectors": () =>
        Response.json({
          unverifiedSourcesAllowed: false,
          items: [
            collector("ok", "[Permitted source]", "AVAILABLE", null, ["DOMAIN"]),
            collector("unverified", "[Unverified source]", "UNVERIFIED", "[licence reason]", [
              "USERNAME",
            ]),
            collector("blocked", "[Blocked source]", "BLOCKED", "[why it is blocked]", ["URL"]),
          ],
        }),
    });
    renderHome();
    expect(
      await screen.findByRole("heading", { name: "What are you investigating?" }),
    ).toBeTruthy();
    // Investigate stays enabled; an empty box is refused on submit (asserted in its own test).
    expect(screen.getByRole("button", { name: "Investigate" }).hasAttribute("disabled")).toBe(
      false,
    );

    // Newest first by creation (cases record no update time), archived left out, three shown.
    const cases = (await screen.findByText("[Newest case]")).closest("ul");
    expect(
      [...(cases?.querySelectorAll("li > a:first-child") ?? [])].map((a) => a.textContent),
    ).toEqual(["[Newest case]", "[Third case]", "[Second case]"]);
    // Each opens its case's workspace.
    expect(screen.getByRole("link", { name: "[Newest case]" }).getAttribute("href")).toBe(
      "/cases/77777777-7777-4777-8777-000000000004/overview",
    );
    expect(cases?.textContent).toContain("0 pinned · created");

    const rowOf = (label: string) => screen.getByText(label).closest("li")?.textContent;
    expect(rowOf("[Permitted source]")).toBe("[Permitted source]Ready");
    // This deployment does not allow unverified sources, so that one is held, and says so.
    expect(rowOf("[Unverified source]")).toBe(
      "[Unverified source]Its licence is unverified, and this deployment does not allow unverified sources.Held",
    );
    expect(rowOf("[Blocked source]")).toBe("[Blocked source][why it is blocked]Held");
    // The held ones sit behind a disclosure that states how many there are; none is dropped.
    const held = screen.getByText("2 held: not enabled here").closest("details");
    expect(held?.textContent).toContain("[Unverified source]");
    expect(held?.textContent).toContain("[Blocked source]");
    expect(held?.textContent).not.toContain("[Permitted source]");
    // No live health is measured, so nothing claims a key is missing or a source is down.
    const health = screen.getByRole("region", { name: "Collector health" });
    expect(health.textContent).toContain("Live health is not measured.");
    expect(health.textContent).not.toMatch(/Needs key|Unavailable/);

    // Monitors do not exist: the Not built card says so, with no count, no rows and no number at all.
    const monitors = screen.getByRole("region", { name: "Monitor alerts" });
    expect(within(monitors).getByRole("heading", { name: "Monitor alerts" })).toBeTruthy();
    expect(within(monitors).getByText(/^Not built yet\. Monitors do not exist/)).toBeTruthy();
    expect(monitors.textContent).toContain("Not built yet.");
    expect(monitors.textContent).not.toMatch(/\d/);
    expect(within(monitors).queryByRole("listitem")).toBeNull();
    // Only types some source here can take are offered as examples.
    expect(screen.getByText("Sources here run for:").parentElement?.textContent).toBe(
      "Sources here run for:domain",
    );
    expect(requests("POST", "/api/v1/estimates")).toHaveLength(0);
  });

  it("refuses an empty Investigate with a message under the shell, and sends nothing", async () => {
    fakeApi({
      "GET /api/v1/session": () => Response.json(session),
      "POST /api/v1/estimates": (body) => Response.json(estimateFor(String(body["target"]))),
    });
    renderHome();
    await screen.findByLabelText("Target to investigate");
    expect(screen.queryByRole("alert")).toBeNull();
    // Blank, then spaces only: both are empty.
    fireEvent.click(screen.getByRole("button", { name: "Investigate" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Enter a target to investigate",
    );
    typeTarget("   ");
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Investigate" }));
    expect(screen.getByRole("alert").textContent).toContain("Enter a target to investigate");
    expect(requests("POST", "/api/v1/estimates")).toHaveLength(0);
    // Typing a target clears it, and a real target is checked.
    await checkTarget("example.org");
    expect(screen.queryByText(/Enter a target to investigate/)).toBeNull();
    expect(requests("POST", "/api/v1/estimates")).toHaveLength(1);
  });

  it("says a note every collector row shares once, not on each row", async () => {
    const unverified = (id: string, label: string) => ({
      id,
      version: "1.0.0",
      label,
      discipline: "TECHINT",
      targetTypes: ["DOMAIN"],
      collectionMode: "PASSIVE_API",
      claimStrength: "REPORTED",
      credentials: { vaultIds: [], runsWithout: true },
      availability: "UNVERIFIED",
      availabilityReason: "[licence reason]",
    });
    fakeApi({
      "GET /api/v1/session": () => Response.json(session),
      "GET /api/v1/cases": () => Response.json({ items: [], hasMore: false }),
      "GET /api/v1/collectors": () =>
        Response.json({
          unverifiedSourcesAllowed: false,
          items: [unverified("a", "[Source A]"), unverified("b", "[Source B]")],
        }),
    });
    renderHome();
    const health = await screen.findByRole("region", { name: "Collector health" });
    await within(health).findByText("[Source A]");
    const note =
      "Its licence is unverified, and this deployment does not allow unverified sources.";
    expect(within(health).getAllByText(note)).toHaveLength(1);
    // Each row is its label and its status only; the note sits above them.
    expect(within(health).getByText("[Source A]").closest("li")?.textContent).toBe(
      "[Source A]Held",
    );
    expect(within(health).getByText("[Source B]").closest("li")?.textContent).toBe(
      "[Source B]Held",
    );
  });

  it("shows the plan: type, sources with their key needs, sources left out with their status, and no number for an unestimated cost", async () => {
    fakeApi({
      "GET /api/v1/session": () => Response.json(session),
      "POST /api/v1/estimates": (body) => Response.json(estimateFor(String(body["target"]))),
    });
    renderHome();
    await checkTarget("  example.org  ");

    expect(await bodiesOf("POST", "/api/v1/estimates")).toEqual([{ target: "example.org" }]);
    expect(screen.getByText("Detected as: Domain.")).toBeTruthy();

    const running = screen
      .getByRole("heading", { name: "Sources that would run (2)" })
      .closest("section");
    if (running === null) throw new TypeError("no panel");
    expect(within(running).getByText("[DNS source]")).toBeTruthy();
    expect(running.textContent).toContain("Needs no key.");
    expect(running.textContent).toContain("Needs a key ([vault id]). Without one it will not run.");
    // Each cost is an em dash that says why, never a number.
    const dashes = within(running).getAllByRole("button", { name: `Not measured. ${NO_COST}` });
    expect(dashes.map((dash) => dash.textContent)).toEqual(["—", "—"]);
    expect(running.textContent).not.toMatch(/\d+ credits?/);

    // The total: an em dash, and the reason in plain sight.
    const total = screen.getByText("Estimated cost of this run").parentElement;
    if (total === null) throw new TypeError("no total");
    expect(within(total).getByRole("button", { name: `Not measured. ${NO_COST}` })).toBeTruthy();
    expect(within(total).getByText(NO_COST)).toBeTruthy();
    expect(total.textContent).not.toMatch(/\d/);

    // Left out: the status as words, the source's reason, the code.
    const excluded = screen
      .getByRole("heading", { name: "Sources that would not run (2)" })
      .closest("section");
    if (excluded === null) throw new TypeError("no panel");
    const rows = within(excluded).getAllByRole("listitem");
    expect(rows[0]?.textContent).toBe(
      "Held[Unlicensed source][why its licence blocks it]LICENCE_BLOCKED",
    );
    expect(rows[1]?.textContent).toBe(
      "Skipped[Person source][why the plan excludes it]MODULE_NOT_IN_PLAN",
    );
    // Sources that do not take the type are counted apart, not mixed in with refusals.
    expect(
      within(excluded).getByText("1 other sources do not take this kind of target"),
    ).toBeTruthy();
  });

  it("shows a cost the API does give as a number", async () => {
    fakeApi({
      "GET /api/v1/session": () => Response.json(session),
      "POST /api/v1/estimates": (body) =>
        Response.json(
          estimateFor(String(body["target"]), {
            total: { estimatedCredits: 0, estimatedCreditsReason: null },
          }),
        ),
    });
    renderHome();
    await checkTarget("example.org");
    const total = screen.getByText("Estimated cost of this run").parentElement;
    expect(total?.textContent).toBe("Estimated cost of this run0 credits");
  });

  it("lets the analyst pick an alternate type, and plans and starts the run as that type", async () => {
    fakeApi({
      "GET /api/v1/session": () => Response.json(session),
      "POST /api/v1/estimates": (body) => {
        const input = String(body["target"]);
        if (body["targetType"] === "DOMAIN") {
          return Response.json(
            estimateFor(input, {
              requestedType: "DOMAIN",
              detectedType: null,
              targets: [{ type: "DOMAIN", value: "example.org", invalid: null }],
            }),
          );
        }
        return Response.json(
          estimateFor(input, {
            detectedType: "URL",
            alternateTypes: ["DOMAIN"],
            targets: [
              { type: "URL", value: input, invalid: null },
              { type: "DOMAIN", value: "example.org", invalid: null },
            ],
          }),
        );
      },
      "POST /api/v1/investigations": (body) =>
        Response.json(
          {
            id: INVESTIGATION_ID,
            title: body["title"],
            target: body["target"],
            createdByUserId: null,
            createdAt: "2026-01-01T00:00:00.000Z",
            archivedAt: null,
          },
          { status: 201 },
        ),
      [`POST /api/v1/investigations/${INVESTIGATION_ID}/runs`]: () =>
        Response.json(
          { id: RUN_ID, investigationId: INVESTIGATION_ID, status: "QUEUED", plan: null },
          { status: 202 },
        ),
    });
    const router = renderHome();
    await checkTarget("https://example.org/path");

    const url = screen.getByLabelText("URL (detected)");
    expect((url as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "Domain" }));
    await waitFor(() => {
      expect(requests("POST", "/api/v1/estimates")).toHaveLength(2);
    });
    await screen.findByRole("heading", { name: /Sources that would run/ });
    expect(screen.getByRole<HTMLInputElement>("radio", { name: "Domain" }).checked).toBe(true);
    expect((await bodiesOf("POST", "/api/v1/estimates"))[1]).toEqual({
      target: "https://example.org/path",
      targetType: "DOMAIN",
    });

    fireEvent.click(screen.getByRole("button", { name: "Start run" }));
    // Straight to the run's live progress.
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/runs/${RUN_ID}`);
    });
    expect(await bodiesOf("POST", "/api/v1/investigations")).toEqual([
      { title: "https://example.org/path", target: "https://example.org/path" },
    ]);
    expect(await bodiesOf("POST", `/api/v1/investigations/${INVESTIGATION_ID}/runs`)).toEqual([
      { targetType: "DOMAIN" },
    ]);
  });

  it("when the run cannot be queued, says so, and a retry reuses the investigation already opened", async () => {
    let queueUp = false;
    fakeApi({
      "GET /api/v1/session": () => Response.json(session),
      "POST /api/v1/estimates": (body) => Response.json(estimateFor(String(body["target"]))),
      "POST /api/v1/investigations": (body) =>
        Response.json(
          {
            id: INVESTIGATION_ID,
            title: body["title"],
            target: body["target"],
            createdByUserId: null,
            createdAt: "2026-01-01T00:00:00.000Z",
            archivedAt: null,
          },
          { status: 201 },
        ),
      [`POST /api/v1/investigations/${INVESTIGATION_ID}/runs`]: () =>
        queueUp
          ? Response.json(
              { id: RUN_ID, investigationId: INVESTIGATION_ID, status: "QUEUED", plan: null },
              { status: 202 },
            )
          : problem(503, "QUEUE_UNAVAILABLE", "The job queue could not take the run."),
    });
    const router = renderHome();
    await checkTarget("example.org");
    fireEvent.click(screen.getByRole("button", { name: "Start run" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "The run could not be queued just now. Nothing was started. Try again.",
    );
    expect(alert.textContent).toContain(
      "trying again starts the run in it rather than opening another",
    );

    queueUp = true;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/runs/${RUN_ID}`);
    });
    expect(requests("POST", "/api/v1/investigations")).toHaveLength(1);
    expect(requests("POST", `/api/v1/investigations/${INVESTIGATION_ID}/runs`)).toHaveLength(2);
  });

  it("marks the plan stale once the target changes, and will not start it", async () => {
    fakeApi({
      "GET /api/v1/session": () => Response.json(session),
      "POST /api/v1/estimates": (body) => Response.json(estimateFor(String(body["target"]))),
    });
    renderHome();
    await checkTarget("example.org");
    typeTarget("example.net");
    expect(screen.getByText(/This plan is for/).textContent).toBe(
      "This plan is for example.org. Check the target again to plan for what is in the box now.",
    );
    expect(screen.getByRole("button", { name: "Start run" }).hasAttribute("disabled")).toBe(true);
  });

  it("will not start a run no source can take, and says why", async () => {
    fakeApi({
      "GET /api/v1/session": () => Response.json(session),
      "POST /api/v1/estimates": (body) =>
        Response.json(estimateFor(String(body["target"]), { collectors: [] })),
    });
    renderHome();
    await checkTarget("example.org");
    expect(screen.getByRole("button", { name: "Start run" }).hasAttribute("disabled")).toBe(true);
    expect(
      screen.getByText("No source can run for this target, so there is nothing to start."),
    ).toBeTruthy();
  });

  it("shows a refused check plainly, and a person-data refusal as the Locked state", async () => {
    const locked = {
      module: "PERSON_INVESTIGATION",
      moduleSummary: "[what the module does]",
      withheld: "[what was withheld]",
      reason: "VETTING_NOT_APPROVED",
      plan: "[plan]",
      vettingStatus: "[vetting status]",
      nextStep: "[the next step]",
    };
    let refusal = problem(403, "PERMISSION_DENIED", "[detail]");
    fakeApi({
      "GET /api/v1/session": () => Response.json(session),
      "POST /api/v1/estimates": () => refusal,
    });
    renderHome();
    await screen.findByLabelText("Target to investigate");
    typeTarget("example.org");
    fireEvent.click(screen.getByRole("button", { name: "Investigate" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Your role in this organisation does not allow this.",
    );

    refusal = problem(403, "VETTING_NOT_APPROVED", "[detail]", { locked });
    fireEvent.click(screen.getByRole("button", { name: "Investigate" }));
    const notice = await screen.findByText("[the next step]");
    const block = notice.parentElement;
    expect(block?.textContent).toContain("Locked");
    expect(block?.textContent).toContain("[what the module does]");
    expect(block?.textContent).toContain("Your organisation's vetting has not been approved.");
    expect(block?.getAttribute("role")).toBe("status");
  });
});

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

/** Answers by method and path; anything unexpected fails loudly as a 404 problem. */
function fakeApi(handlers: Record<string, Handler>): void {
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
  fireEvent.change(screen.getByLabelText("Target"), { target: { value } });
};

const checkTarget = async (value: string) => {
  await screen.findByLabelText("Target");
  typeTarget(value);
  fireEvent.click(screen.getByRole("button", { name: "Check target" }));
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
  it("before any check, says what checking does and that nothing runs yet", async () => {
    fakeApi({ "GET /api/v1/session": () => Response.json(session) });
    renderHome();
    expect(
      (await screen.findByText(/Check a target to see what kind of target it is/)).textContent,
    ).toContain("Nothing is collected until you start a run.");
    expect(screen.getByRole("button", { name: "Check target" }).hasAttribute("disabled")).toBe(
      true,
    );
    expect(requests("POST", "/api/v1/estimates")).toHaveLength(0);
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
    await screen.findByLabelText("Target");
    typeTarget("example.org");
    fireEvent.click(screen.getByRole("button", { name: "Check target" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Your role in this organisation does not allow this.",
    );

    refusal = problem(403, "VETTING_NOT_APPROVED", "[detail]", { locked });
    fireEvent.click(screen.getByRole("button", { name: "Check target" }));
    const notice = await screen.findByText("[the next step]");
    const block = notice.parentElement;
    expect(block?.textContent).toContain("Locked");
    expect(block?.textContent).toContain("[what the module does]");
    expect(block?.textContent).toContain("Your organisation's vetting has not been approved.");
    expect(block?.getAttribute("role")).toBe("status");
  });
});

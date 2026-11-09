/**
 * The Monitors screen and the dashboard's alerts panel: both read monitors and
 * alerts from the API, and every action goes through the generated client.
 * The real router and screens, over a fetch stub.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
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

type Handler = (body: Record<string, unknown>, request: Request) => Response | Promise<Response>;

/** What the shell and the dashboard read when a test does not say otherwise: nothing yet. */
const PANEL_DEFAULTS: Record<string, Handler> = {
  "GET /api/v1/session": () => Response.json(session),
  "GET /api/v1/cases": () => Response.json({ items: [], hasMore: false }),
  "GET /api/v1/investigations": () => Response.json({ items: [], hasMore: false }),
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

const problem = (status: number, code: string, detail: string) =>
  Response.json({ type: "about:blank", title: "Refused", status, code, detail }, { status });

const tenant = { id: "11111111-1111-4111-8111-111111111111", name: "[Tenant one]" };
const session: SessionState = {
  state: "SIGNED_IN",
  user: { id: "u1", email: "analyst@example.com", name: "[Analyst]" },
  activeTenantId: tenant.id,
  tenants: [tenant],
};

const MONITOR_ID = "22222222-2222-4222-8222-222222222222";
const PAUSED_ID = "33333333-3333-4333-8333-333333333333";
const ALERT_ID = "44444444-4444-4444-8444-444444444444";

/** A monitor as the API lists it. */
const monitor = (overrides: Record<string, unknown> = {}) => ({
  id: MONITOR_ID,
  name: "[Watch one]",
  target: "[target one]",
  scheduleCron: "0 9 * * *",
  enabled: true,
  createdByUserId: "u1",
  createdAt: "2026-10-28T09:00:00.000Z",
  ...overrides,
});

/** An alert as the API lists it. */
const alert = (overrides: Record<string, unknown> = {}) => ({
  id: ALERT_ID,
  monitorId: MONITOR_ID,
  title: "[New evidence for the target]",
  evidenceId: null,
  createdAt: "2026-10-28T10:00:00.000Z",
  acknowledgedAt: null,
  acknowledgedByUserId: null,
  ...overrides,
});

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

/** The requests the stub saw with this method and path, oldest first. */
const requestsTo = (method: string, path: string): Request[] =>
  fetchMock.mock.calls
    .map(([request]) => request)
    .filter((request) => request.method === method && new URL(request.url).pathname === path);

const jsonBodyOf = async (request: Request) =>
  JSON.parse(await request.clone().text()) as Record<string, unknown>;

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
});

describe("Monitors screen", () => {
  it("lists the monitors and the unacknowledged alerts the API returns, with their state", async () => {
    fakeApi({
      "GET /api/v1/monitors": () =>
        Response.json({
          items: [monitor(), monitor({ id: PAUSED_ID, name: "[Watch two]", enabled: false })],
          hasMore: false,
        }),
      "GET /api/v1/alerts": () => Response.json({ items: [alert()], hasMore: false }),
    });

    renderAt("/monitors");

    // An alert also names its monitor, so the monitor rows are read within their own table.
    const monitorsTable = await screen.findByRole("table", { name: "Monitors" });
    expect(within(monitorsTable).getByText("[Watch one]")).toBeTruthy();
    expect(within(monitorsTable).getByText("[Watch two]")).toBeTruthy();
    expect(within(monitorsTable).getByText("Active")).toBeTruthy();
    expect(within(monitorsTable).getByText("Paused")).toBeTruthy();
    const alerts = await screen.findByRole("table", { name: "Unacknowledged alerts" });
    expect(within(alerts).getByText("[New evidence for the target]")).toBeTruthy();
    // The acknowledged-only filter is sent as the API's own query, not a string the screen built by hand.
    const [alertRead] = requestsTo("GET", "/api/v1/alerts");
    expect(alertRead).toBeDefined();
    expect(new URL(alertRead?.url ?? "").searchParams.get("acknowledged")).toBe("false");
  });

  it("says the monitors could not be read, rather than showing an empty table", async () => {
    fakeApi({
      "GET /api/v1/monitors": () => problem(503, "UNAVAILABLE", "[why the API could not answer]"),
      "GET /api/v1/alerts": () => Response.json({ items: [], hasMore: false }),
    });

    renderAt("/monitors");

    expect(await screen.findByText("Monitors could not be read.")).toBeTruthy();
    // A failed read must not look like a tenant with no monitors.
    expect(screen.queryByText("No monitors yet")).toBeNull();
    expect(screen.queryByRole("table", { name: "Monitors" })).toBeNull();
  });

  it("shows a reading state, not an empty table, while the monitors and alerts are read", async () => {
    fakeApi({
      "GET /api/v1/monitors": () => new Promise<Response>(() => undefined),
      "GET /api/v1/alerts": () => new Promise<Response>(() => undefined),
    });

    renderAt("/monitors");

    expect(await screen.findByText("Reading monitors.")).toBeTruthy();
    expect(await screen.findByText("Reading alerts.")).toBeTruthy();
    expect(screen.queryByText("No monitors yet")).toBeNull();
    expect(screen.queryByText("No unacknowledged alerts")).toBeNull();
  });

  it("says the alerts could not be read, rather than showing none", async () => {
    fakeApi({
      "GET /api/v1/monitors": () => Response.json({ items: [monitor()], hasMore: false }),
      "GET /api/v1/alerts": () => problem(503, "UNAVAILABLE", "[why the alerts could not be read]"),
    });

    renderAt("/monitors");

    expect(await screen.findByText("Alerts could not be read.")).toBeTruthy();
    expect(screen.queryByText("No unacknowledged alerts")).toBeNull();
  });

  it("creates a monitor with the entered name, target and schedule, enabled", async () => {
    let created = false;
    fakeApi({
      "GET /api/v1/monitors": () =>
        Response.json({ items: created ? [monitor()] : [], hasMore: false }),
      "GET /api/v1/alerts": () => Response.json({ items: [], hasMore: false }),
      "POST /api/v1/monitors": () => {
        created = true;
        return Response.json(monitor(), { status: 201 });
      },
    });

    renderAt("/monitors");
    await screen.findByText("No monitors yet");

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "[Watch one]" } });
    fireEvent.change(screen.getByLabelText("Target"), { target: { value: "[target one]" } });
    fireEvent.click(screen.getByRole("button", { name: "Create monitor" }));

    expect(await screen.findByText("Monitor created successfully.")).toBeTruthy();
    const [post] = requestsTo("POST", "/api/v1/monitors");
    expect(post).toBeDefined();
    expect(await jsonBodyOf(post as Request)).toEqual({
      name: "[Watch one]",
      target: "[target one]",
      scheduleCron: "0 9 * * *",
      enabled: true,
    });
  });

  it("pauses an active monitor through the disable endpoint and re-reads the list", async () => {
    let enabled = true;
    fakeApi({
      "GET /api/v1/monitors": () =>
        Response.json({ items: [monitor({ enabled })], hasMore: false }),
      "GET /api/v1/alerts": () => Response.json({ items: [], hasMore: false }),
      [`POST /api/v1/monitors/${MONITOR_ID}/disable`]: () => {
        enabled = false;
        return Response.json(monitor({ enabled: false }));
      },
    });

    renderAt("/monitors");
    fireEvent.click(await screen.findByRole("button", { name: "Pause" }));

    expect(await screen.findByRole("button", { name: "Resume" })).toBeTruthy();
    expect(screen.getByText("Paused")).toBeTruthy();
    expect(requestsTo("POST", `/api/v1/monitors/${MONITOR_ID}/disable`)).toHaveLength(1);
  });

  it("removes a monitor only once the API confirms the delete", async () => {
    let present = true;
    fakeApi({
      "GET /api/v1/monitors": () =>
        Response.json({ items: present ? [monitor()] : [], hasMore: false }),
      "GET /api/v1/alerts": () => Response.json({ items: [], hasMore: false }),
      [`DELETE /api/v1/monitors/${MONITOR_ID}`]: () => {
        present = false;
        return new Response(null, { status: 204 });
      },
    });

    renderAt("/monitors");
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

    expect(await screen.findByText("No monitors yet")).toBeTruthy();
    expect(screen.queryByText("[Watch one]")).toBeNull();
  });

  it("keeps the monitor and states the refusal when the API refuses a delete", async () => {
    fakeApi({
      "GET /api/v1/monitors": () => Response.json({ items: [monitor()], hasMore: false }),
      "GET /api/v1/alerts": () => Response.json({ items: [], hasMore: false }),
      [`DELETE /api/v1/monitors/${MONITOR_ID}`]: () =>
        problem(409, "MONITOR_BUSY", "[why the API refused the delete]"),
    });

    renderAt("/monitors");
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(requestsTo("DELETE", `/api/v1/monitors/${MONITOR_ID}`)).toHaveLength(1);
    });
    expect(await screen.findByText("[Watch one]")).toBeTruthy();
    expect(screen.getByText(/why the API refused the delete/)).toBeTruthy();
  });

  it("acknowledges an alert through the ack endpoint and drops it from the list", async () => {
    let acknowledged = false;
    fakeApi({
      "GET /api/v1/monitors": () => Response.json({ items: [monitor()], hasMore: false }),
      "GET /api/v1/alerts": () =>
        Response.json({ items: acknowledged ? [] : [alert()], hasMore: false }),
      [`POST /api/v1/alerts/${ALERT_ID}/ack`]: () => {
        acknowledged = true;
        return Response.json(alert({ acknowledgedAt: "2026-10-28T11:00:00.000Z" }));
      },
    });

    renderAt("/monitors");
    fireEvent.click(await screen.findByRole("button", { name: "Acknowledge" }));

    expect(await screen.findByText("No unacknowledged alerts")).toBeTruthy();
    expect(requestsTo("POST", `/api/v1/alerts/${ALERT_ID}/ack`)).toHaveLength(1);
  });
});

describe("Dashboard monitor alerts panel", () => {
  it("lists the unacknowledged alerts with a count, and links to the monitors screen", async () => {
    fakeApi({
      "GET /api/v1/alerts": () => Response.json({ items: [alert()], hasMore: false }),
    });

    renderAt("/");

    const panel = await screen.findByRole("region", { name: "Monitor alerts" });
    expect(await within(panel).findByText("[New evidence for the target]")).toBeTruthy();
    expect(within(panel).getByText("1 unacknowledged")).toBeTruthy();
    expect(within(panel).getByRole("link", { name: "All monitors" }).getAttribute("href")).toBe(
      "/monitors",
    );
  });

  it("says the alerts could not be read, rather than showing none", async () => {
    fakeApi({
      "GET /api/v1/alerts": () => problem(503, "UNAVAILABLE", "[why the alerts could not be read]"),
    });

    renderAt("/");

    const panel = await screen.findByRole("region", { name: "Monitor alerts" });
    expect(await within(panel).findByText(/why the alerts could not be read/)).toBeTruthy();
    expect(within(panel).queryByText(/No unacknowledged alerts/)).toBeNull();
    expect(within(panel).queryByText(/unacknowledged$/)).toBeNull();
  });

  it("states that the count is partial when the API holds more alerts than it returned", async () => {
    fakeApi({
      "GET /api/v1/alerts": () => Response.json({ items: [alert()], hasMore: true }),
    });

    renderAt("/");

    const panel = await screen.findByRole("region", { name: "Monitor alerts" });
    expect(
      await within(panel).findByText(/^Partial: only the first 1 unacknowledged alerts/),
    ).toBeTruthy();
    expect(within(panel).queryByText("1 unacknowledged")).toBeNull();
    expect(within(panel).getByText("[New evidence for the target]")).toBeTruthy();
  });
});

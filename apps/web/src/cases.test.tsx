/**
 * The Cases list: every case with its title link, pin count, opening time and
 * state in words; the Partial, Empty and Failed states; and creating a case.
 * The real router and screens, over a fetch stub; every request goes through
 * the generated client.
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

const tenant = { id: "11111111-1111-4111-8111-111111111111", name: "[Tenant one]" };
const session: SessionState = {
  state: "SIGNED_IN",
  user: { id: "u1", email: "analyst@example.com", name: "[Analyst]" },
  activeTenantId: tenant.id,
  tenants: [tenant],
};
const me = () =>
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
    permissions: ["run:read"],
  });

const OPEN_ID = "77777777-7777-4777-8777-000000000001";
const ARCHIVED_ID = "77777777-7777-4777-8777-000000000002";
const NEW_ID = "77777777-7777-4777-8777-000000000003";

const caseRow = (id: string, title: string, pinCount: number, archivedAt: string | null) => ({
  id,
  title,
  description: null,
  createdByUserId: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  archivedAt,
  pinCount,
});

const listOf = (hasMore: boolean) => () =>
  Response.json({
    items: [
      caseRow(OPEN_ID, "[Open case]", 0, null),
      caseRow(ARCHIVED_ID, "[Archived case]", 3, "2026-01-02T00:00:00.000Z"),
    ],
    hasMore,
  });

function renderCases() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: ["/cases"] }));
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const requests = (method: string, path: string) =>
  fetchMock.mock.calls.filter(
    ([request]) => request.method === method && new URL(request.url).pathname === path,
  );

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  sessionStorage.clear();
});

describe("the Cases list", () => {
  it("lists each case: its title opens it, a zero pin count is shown as 0, and archived is a word", async () => {
    fakeApi({
      "GET /api/v1/session": () => Response.json(session),
      "GET /api/v1/me": me,
      "GET /api/v1/cases": listOf(false),
    });
    renderCases();
    expect(await screen.findByRole("heading", { level: 1, name: "Cases" })).toBeTruthy();
    const table = await screen.findByRole("table", { name: "Cases" });
    const open = within(table).getByRole("link", { name: "[Open case]" }).closest("tr");
    const archived = within(table).getByRole("link", { name: "[Archived case]" }).closest("tr");
    if (open === null || archived === null) throw new TypeError("no rows");
    expect(within(table).getByRole("link", { name: "[Open case]" }).getAttribute("href")).toBe(
      `/cases/${OPEN_ID}/overview`,
    );
    const cells = (row: HTMLElement) =>
      within(row)
        .getAllByRole("cell")
        .map((cell) => cell.textContent);
    // A measured zero is a value: shown as 0, not hidden and not a dash.
    expect(cells(open)[1]).toBe("0");
    expect(cells(open)[3]).toBe("Open");
    expect(cells(archived)[1]).toBe("3");
    expect(cells(archived)[3]).toBe("Archived");
    expect(within(open).getByText((_, element) => element?.tagName === "TIME")).toBeTruthy();
    // One verb for when a case began, on every screen: "created".
    expect(within(table).getByRole("columnheader", { name: "Created" })).toBeTruthy();
    expect(within(table).queryByRole("columnheader", { name: "Opened" })).toBeNull();
    // Not cut, so no Partial notice.
    expect(screen.queryByText(/^Partial:/)).toBeNull();
  });

  it("says when the list is cut at the read limit", async () => {
    fakeApi({
      "GET /api/v1/session": () => Response.json(session),
      "GET /api/v1/me": me,
      "GET /api/v1/cases": listOf(true),
    });
    renderCases();
    expect((await screen.findByText(/^Partial:/)).textContent).toBe(
      "Partial: 2 of more than 500 cases.",
    );
  });

  it("shows the empty state for no cases, never a bare header", async () => {
    fakeApi({
      "GET /api/v1/session": () => Response.json(session),
      "GET /api/v1/me": me,
      "GET /api/v1/cases": () => Response.json({ items: [], hasMore: false }),
    });
    renderCases();
    expect(await screen.findByRole("heading", { name: "No cases yet" })).toBeTruthy();
    expect(
      screen.getByText("Create one here, or pin a result from a run to create one there."),
    ).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows a failed read with its code, and Try again reads it again", async () => {
    let up = false;
    fakeApi({
      "GET /api/v1/session": () => Response.json(session),
      "GET /api/v1/me": me,
      "GET /api/v1/cases": () =>
        up
          ? listOf(false)()
          : Response.json(
              { type: "about:blank", title: "Down", status: 503, code: "[CODE]", detail: "[x]" },
              { status: 503 },
            ),
    });
    renderCases();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("The cases could not be read.");
    expect(alert.textContent).toContain("Code: [CODE]");
    up = true;
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("link", { name: "[Open case]" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("creates a case with the title typed and no description, then opens it", async () => {
    fakeApi({
      "GET /api/v1/session": () => Response.json(session),
      "GET /api/v1/me": me,
      "GET /api/v1/cases": () => Response.json({ items: [], hasMore: false }),
      "POST /api/v1/cases": (body) =>
        Response.json(caseRow(NEW_ID, String(body["title"]), 0, null), { status: 201 }),
    });
    const router = renderCases();
    const field = await screen.findByLabelText("New case");
    // The primary stays enabled; an empty title is refused on submit with a field error.
    const create = screen.getByRole("button", { name: "Create case" });
    expect(create.hasAttribute("disabled")).toBe(false);
    fireEvent.click(create);
    expect(await screen.findByText("Enter a title for the case.")).toBeTruthy();
    expect(field.getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(field, { target: { value: "   " } });
    fireEvent.click(create);
    expect(screen.getByText("Enter a title for the case.")).toBeTruthy();
    expect(requests("POST", "/api/v1/cases")).toHaveLength(0);
    fireEvent.change(field, { target: { value: "  [New case title]  " } });
    expect(screen.queryByText("Enter a title for the case.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Create case" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/cases/${NEW_ID}/overview`);
    });
    const posted = await Promise.all(
      requests("POST", "/api/v1/cases").map(
        async ([request]) => JSON.parse(await request.clone().text()) as unknown,
      ),
    );
    expect(posted).toEqual([{ title: "[New case title]", description: null }]);
  });
});

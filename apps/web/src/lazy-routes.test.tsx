/**
 * Screens, and the graph renderer, are downloaded when first needed
 * (router.tsx, workspace/GraphTab.tsx). A download that fails is said, as any
 * unexpected failure is (§8 Failed): never a blank page, never a screen
 * standing in for the one that could not load. The real router over a fetch
 * stub; each failing module is replaced by one that throws when imported, as
 * a failed download does.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionState } from "./api.ts";
import { createAppRouter } from "./router.tsx";
// Loaded with this file so a wait is for the failure, not the first compile (see test-screens.ts).
import "./workspace/Workspace.tsx";

// The generated client captures fetch when it is created, at import time.
const fetchMock = vi.hoisted(() => {
  const mock = vi.fn<(request: Request) => Promise<Response>>();
  vi.stubGlobal("fetch", mock);
  return mock;
});

vi.mock("./screens/Members.tsx", () => {
  throw new TypeError("[the members screen could not be downloaded]");
});
vi.mock("./workspace/graph/CytoscapeGraph.tsx", () => {
  throw new TypeError("[the graph renderer could not be downloaded]");
});

const RUN_ID = "44444444-4444-4444-8444-444444444444";
const tenant = { id: "11111111-1111-4111-8111-111111111111", name: "[Tenant one]" };
const session: SessionState = {
  state: "SIGNED_IN",
  user: { id: "u1", email: "analyst@example.com", name: "[Analyst]" },
  activeTenantId: tenant.id,
  tenants: [tenant],
};
const graph = {
  nodes: [
    {
      id: "77777777-7777-4777-8777-777777777771",
      kind: "DOMAIN",
      displayName: "example.com",
      identifier: "example.com",
      hop: 0,
      claimCount: 0,
      mergedIntoEntityId: null,
    },
  ],
  edges: [],
  maxHops: 1,
  truncated: false,
};

/** Answers the session and the graph; anything else is a 404 problem, which the screens show as one. */
function fakeApi(): void {
  fetchMock.mockImplementation((request) => {
    const path = new URL(request.url).pathname;
    if (path === "/api/v1/session") return Promise.resolve(Response.json(session));
    if (path === "/api/v1/graph") return Promise.resolve(Response.json(graph));
    return Promise.resolve(
      Response.json(
        { type: "about:blank", title: "Not Found", status: 404, code: "UNEXPECTED", detail: path },
        { status: 404 },
      ),
    );
  });
}

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
}

/** The router's error component, with the failure in words: an unexpected one carries no code. */
async function expectCannotContinue() {
  expect(await screen.findByRole("heading", { name: "Cannot continue" })).toBeTruthy();
  const alert = screen.getByRole("alert");
  expect(alert.textContent).toContain(
    "The app hit an unexpected error. Reload the page, then try again.",
  );
  expect(alert.textContent).not.toContain("Code:");
  expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
}

beforeEach(() => {
  // jsdom draws nothing, as in workspace-results.test.tsx.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe("a download that fails", () => {
  it("a screen that cannot be downloaded is the router's error, never a blank page", async () => {
    fakeApi();
    renderAt("/members");
    await expectCannotContinue();
    // Nothing of the screen that failed is drawn in its place.
    expect(screen.queryByRole("heading", { name: "Members" })).toBeNull();
  });

  it("a graph renderer that cannot be downloaded is the router's error, not an empty canvas", async () => {
    fakeApi();
    renderAt(`/runs/${RUN_ID}/graph`);
    await expectCannotContinue();
    expect(within(document.body).queryByRole("img", { name: /^Graph of/ })).toBeNull();
  });
});

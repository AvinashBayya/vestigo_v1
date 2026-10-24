/**
 * The provisional Settings screen: the real router and screen, over a fetch
 * stub that answers as the API does; every request goes through the generated
 * client. It reads the retention window, and never changes a setting.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
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

type Handler = (request: Request) => Response | Promise<Response>;

/** Answers by method and path; anything unexpected is a 404 problem. */
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
    return handler(request);
  });
}

const user = { id: "u1", email: "[analyst-email]", name: "[Analyst]" };
const tenant = { id: "11111111-1111-4111-8111-111111111111", name: "[Tenant one]" };
const session: SessionState = {
  state: "SIGNED_IN",
  user,
  activeTenantId: tenant.id,
  tenants: [tenant],
};
const me = {
  authMethod: "SESSION",
  user: { id: user.id, email: user.email, displayName: null },
  apiKeyId: null,
  tenant: {
    id: tenant.id,
    name: tenant.name,
    plan: "TECHINT",
    vettingStatus: "NOT_SUBMITTED",
    planModules: ["TECHINT"],
  },
  permissions: ["tenant:read"],
};

const base: Record<string, Handler> = {
  "GET /api/v1/session": () => Response.json(session),
  "GET /api/v1/me": () => Response.json(me),
  "GET /health": () => Response.json({ status: "ok" }),
};

function renderSettings() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createAppRouter(
    queryClient,
    createMemoryHistory({ initialEntries: ["/settings"] }),
  );
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

/** Every request the screen sent was a read, and none of them read usage. */
function expectOnlyReads() {
  expect(fetchMock.mock.calls.length).toBeGreaterThan(0);
  for (const [request] of fetchMock.mock.calls) {
    expect(request.method).toBe("GET");
    expect(new URL(request.url).pathname).not.toBe("/api/v1/usage");
  }
}

const retentionCard = async () => within(await screen.findByRole("region", { name: "Retention" }));

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
});

describe("the provisional Settings screen", () => {
  it("shows the retention window from the API, and is labelled provisional", async () => {
    fakeApi({
      ...base,
      "GET /api/v1/settings/retention": () => Response.json({ retentionDays: 30, enforced: false }),
    });
    renderSettings();

    expect(await screen.findByRole("heading", { level: 1, name: "Settings" })).toBeTruthy();
    expect(screen.getByText("Provisional: no screen design yet")).toBeTruthy();
    expect(
      screen.getByText(/Changing a setting is not\s+built in this provisional screen/),
    ).toBeTruthy();

    const retention = await retentionCard();
    expect(await retention.findByText("30 days")).toBeTruthy();
    expect(
      retention.getByText("Not enforced: nothing deletes evidence when the window passes yet."),
    ).toBeTruthy();

    // The marking has no read in the API: an em dash that says so, never a guess.
    const reports = within(screen.getByRole("region", { name: "Reports" }));
    expect(
      reports.getByRole("button", {
        name: "Not measured. The API can set this marking but has no way to read it back, so the current marking cannot be shown here.",
      }).textContent,
    ).toBe("—");

    // The areas not built here say so, with no figures, each as its own Not built card
    // (no card header around it), in the same grid as Reports and Retention.
    const grid = screen.getByRole("region", { name: "Reports" }).parentElement;
    for (const area of ["API keys", "Credentials", "Scope authorisations", "Usage"]) {
      const region = screen.getByRole("region", { name: area });
      const card = within(region);
      expect(card.getByText(/^Not built yet\./)).toBeTruthy();
      expect(card.queryByText(/\d/)).toBeNull();
      expect(card.queryByRole("heading", { level: 2 })).toBeNull();
      expect(region.parentElement).toBe(grid);
    }
    expect(screen.getByRole("region", { name: "Retention" }).parentElement).toBe(grid);
    expect(grid?.children).toHaveLength(6);

    // No control that would change a setting exists.
    expect(
      screen.queryByRole("button", { name: /^(save|edit|change|set|update|clear)\b/i }),
    ).toBeNull();
    expectOnlyReads();
  });

  it("words deletion from the API's enforced flag, whichever it states", async () => {
    fakeApi({
      ...base,
      "GET /api/v1/settings/retention": () => Response.json({ retentionDays: 30, enforced: true }),
    });
    renderSettings();
    const retention = await retentionCard();
    expect(
      await retention.findByText(
        "Enforced: the API reports that evidence is deleted when the window passes.",
      ),
    ).toBeTruthy();
    expect(retention.queryByText(/Not enforced/)).toBeNull();
    expectOnlyReads();
  });

  it("shows an unchosen retention window as an em dash with its reason", async () => {
    fakeApi({
      ...base,
      "GET /api/v1/settings/retention": () =>
        Response.json({ retentionDays: null, enforced: false }),
    });
    renderSettings();
    const retention = await retentionCard();
    expect(
      (
        await retention.findByRole("button", {
          name: "Not measured. This organisation has not chosen a retention window.",
        })
      ).textContent,
    ).toBe("—");
    expect(retention.queryByText(/\bdays?\b/)).toBeNull();
    expectOnlyReads();
  });

  it("says a refused read plainly, with no retry", async () => {
    fakeApi({
      ...base,
      "GET /api/v1/settings/retention": () =>
        Response.json(
          {
            type: "about:blank",
            title: "Forbidden",
            status: 403,
            code: "PERMISSION_DENIED",
            detail: "[detail]",
          },
          { status: 403 },
        ),
    });
    renderSettings();
    const refusal = await (await retentionCard()).findByRole("alert");
    expect(refusal.textContent).toContain("The retention window could not be read.");
    expect(refusal.textContent).toContain("Your role in this organisation does not allow this.");
    expect(refusal.textContent).toContain("Code: PERMISSION_DENIED");
    expect(within(refusal).queryByRole("button", { name: "Try again" })).toBeNull();
    expectOnlyReads();
  });

  it("offers a retry when the read failed for another reason", async () => {
    fakeApi({
      ...base,
      "GET /api/v1/settings/retention": () =>
        Response.json(
          {
            type: "about:blank",
            title: "Service Unavailable",
            status: 503,
            code: "[UNAVAILABLE_CODE]",
            detail: "[The stated reason]",
          },
          { status: 503 },
        ),
    });
    renderSettings();
    const refusal = await (await retentionCard()).findByRole("alert");
    expect(refusal.textContent).toContain("[The stated reason]");
    expect(within(refusal).getByRole("button", { name: "Try again" })).toBeTruthy();
    expectOnlyReads();
  });

  it("says what it is reading while the retention window loads", async () => {
    fakeApi({
      ...base,
      "GET /api/v1/settings/retention": () => new Promise<Response>(() => undefined),
    });
    renderSettings();
    const status = await (await retentionCard()).findByRole("status");
    expect(status.textContent).toBe("Reading the retention window.");
    expectOnlyReads();
  });
});

/**
 * The signed-in frame: the side navigation and its credits meter, the app
 * header's command palette, vetting pill and account menu (with the theme
 * toggle). The real router and screens, over a fetch stub that answers as the
 * API does; every request goes through the generated client. (The first test
 * moved from auth-flow.test.tsx for U1-c; the theme buttons became the account
 * menu's Light/Dark radios, asserted as strongly.)
 */
import { PRODUCT_NAME } from "@repo/config/product";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionState } from "./api.ts";
import { createAppRouter } from "./router.tsx";

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
    const text = request.method === "GET" ? "" : await request.text();
    return handler(text === "" ? {} : (JSON.parse(text) as Record<string, unknown>), request);
  });
}

const user = { id: "u1", email: "analyst@example.com", name: "[Analyst]" };
const acme = { id: "11111111-1111-4111-8111-111111111111", name: "[Tenant one]" };
const other = { id: "22222222-2222-4222-8222-222222222222", name: "[Tenant two]" };
const signedIn = (activeTenantId: string | null, tenants = [acme]): SessionState => ({
  state: "SIGNED_IN",
  user,
  activeTenantId,
  tenants,
});

const meOf = (vettingStatus: string) => () =>
  Response.json({
    authMethod: "SESSION",
    user: { id: user.id, email: user.email, displayName: null },
    apiKeyId: null,
    tenant: {
      id: acme.id,
      name: acme.name,
      plan: "TECHINT",
      vettingStatus,
      planModules: ["TECHINT"],
    },
    permissions: ["run:read"],
  });

const problem = (status: number, code: string) => () =>
  Response.json(
    { type: "about:blank", title: "Refused", status, code, detail: "[detail]" },
    { status },
  );

const caseRow = (id: string, title: string, archivedAt: string | null = null) => ({
  id,
  title,
  description: null,
  createdByUserId: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  archivedAt,
  pinCount: 0,
});

/** The dashboard's own reads, answered empty, for tests that land on "/". */
const DASHBOARD: Record<string, Handler> = {
  "GET /api/v1/cases": () => Response.json({ items: [], hasMore: false }),
  "GET /api/v1/collectors": () => Response.json({ unverifiedSourcesAllowed: false, items: [] }),
};

const requests = (method: string, path: string) =>
  fetchMock.mock.calls.filter(
    ([request]) => request.method === method && new URL(request.url).pathname === path,
  );

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

/** Opens the palette with Ctrl K, once the frame is on screen. */
async function openPalette() {
  await screen.findByRole("button", { name: "Account" });
  fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  return screen.findByRole("dialog", { name: "Command palette" });
}

/** Each option's first line: its label. */
const labels = (options: readonly HTMLElement[]) =>
  options.map((option) => option.firstChild?.textContent);

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  sessionStorage.clear();
  localStorage.clear();
  delete document.documentElement.dataset["theme"];
});

describe("the signed-in frame", () => {
  it("shows the organisation's vetting status as the API states it, and switches theme from the account menu", async () => {
    fakeApi({
      ...DASHBOARD,
      "GET /api/v1/session": () => Response.json(signedIn(acme.id)),
      "GET /api/v1/me": meOf("NOT_SUBMITTED"),
      "GET /health": () => Response.json({ status: "ok" }),
    });
    renderAt("/");
    // Not "Verified tenant": that is said only when vetting is approved.
    expect(await screen.findByText("Vetting not submitted")).toBeTruthy();
    expect(screen.queryByText("Verified tenant")).toBeNull();
    // Only what is built: search, the cases results are pinned to, members and settings.
    // The side navigation (from md) and the phone row (below md) list the same destinations.
    const [side, phone] = screen.getAllByRole("navigation", { name: "Main" });
    expect(side?.textContent).toBe(`${PRODUCT_NAME}SearchCasesMembersSettings`);
    expect(phone?.textContent).toBe("SearchCasesMembersSettings");

    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    fireEvent.click(await screen.findByRole("radio", { name: "Dark" }));
    expect(document.documentElement.dataset["theme"]).toBe("dark");
    expect(localStorage.getItem("theme")).toBe("dark");
    expect(screen.getByRole<HTMLInputElement>("radio", { name: "Dark" }).checked).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "Light" }));
    expect(document.documentElement.dataset["theme"]).toBe("light");
    expect(localStorage.getItem("theme")).toBe("light");
    expect(screen.getByRole<HTMLInputElement>("radio", { name: "Light" }).checked).toBe(true);
  });

  it("keeps the theme choice: after a remount the stored theme is the one checked", async () => {
    fakeApi({
      "GET /api/v1/session": () => Response.json(signedIn(acme.id)),
      "GET /api/v1/me": meOf("NOT_SUBMITTED"),
    });
    renderAt("/members");
    fireEvent.click(await screen.findByRole("button", { name: "Account" }));
    fireEvent.click(await screen.findByRole("radio", { name: "Dark" }));
    cleanup();
    delete document.documentElement.dataset["theme"];

    renderAt("/members");
    fireEvent.click(await screen.findByRole("button", { name: "Account" }));
    expect((await screen.findByRole<HTMLInputElement>("radio", { name: "Dark" })).checked).toBe(
      true,
    );
    expect(localStorage.getItem("theme")).toBe("dark");
  });

  it("marks the current destination with aria-current, not colour alone", async () => {
    fakeApi({
      ...DASHBOARD,
      "GET /api/v1/session": () => Response.json(signedIn(acme.id)),
      "GET /api/v1/me": meOf("NOT_SUBMITTED"),
    });
    const router = renderAt("/");
    // Both the side navigation and the phone row mark the same destination (the side
    // navigation's destinations are list items; its product mark is not one).
    const current = () =>
      screen
        .getAllByRole("navigation", { name: "Main" })
        .map((nav) =>
          [
            ...nav.querySelectorAll(':scope > [aria-current="page"], li > [aria-current="page"]'),
          ].map((item) => item.textContent),
        );
    await screen.findAllByRole("navigation", { name: "Main" });
    expect(current()).toEqual([["Search"], ["Search"]]);

    await router.navigate({ to: "/cases" });
    await waitFor(() => {
      expect(current()).toEqual([["Cases"], ["Cases"]]);
    });
    cleanup();

    renderAt("/members");
    await screen.findAllByRole("navigation", { name: "Main" });
    expect(current()).toEqual([["Members"], ["Members"]]);
  });

  it("below md the destinations stay reachable as a plain row of links, not only the side navigation", async () => {
    // REGRESSION (R1-0 pre-flight 0.4): below md the side navigation is not drawn, and the
    // palette button was covered, so nothing at phone width led to Members or Settings.
    fakeApi({
      "GET /api/v1/session": () => Response.json(signedIn(acme.id)),
      "GET /api/v1/me": meOf("NOT_SUBMITTED"),
    });
    renderAt("/settings");
    const [side, phone] = await screen.findAllByRole("navigation", { name: "Main" });
    // Each is drawn at one width only: jsdom applies no media queries, so the classes say it.
    expect(side?.closest("aside")?.className).toMatch(/(^|\s)hidden(\s|$)/);
    expect(side?.closest("aside")?.className).toMatch(/(^|\s)md:flex(\s|$)/);
    expect(phone?.className).toMatch(/(^|\s)md:hidden(\s|$)/);
    expect(
      within(phone as HTMLElement)
        .getAllByRole("link")
        .map((link) => [link.textContent, link.getAttribute("href")]),
    ).toEqual([
      ["Search", "/"],
      ["Cases", "/cases"],
      ["Members", "/members"],
      ["Settings", "/settings"],
    ]);
    // A target each, and the current one said by aria-current and weight, not colour alone.
    for (const link of within(phone as HTMLElement).getAllByRole("link")) {
      expect(link.className).toContain("min-h-target");
    }
    const here = (phone as HTMLElement).querySelector('[aria-current="page"]');
    expect(here?.textContent).toBe("Settings");
    expect(here?.className).toContain("text-ui-strong");
  });

  it("shows credits as an em dash with its reason: no figure, no bar, no meter", async () => {
    fakeApi({
      "GET /api/v1/session": () => Response.json(signedIn(acme.id)),
      "GET /api/v1/me": meOf("NOT_SUBMITTED"),
    });
    renderAt("/members");
    const credits = await screen.findByRole("region", { name: "Credits this month" });
    // Outside the navigation landmark, which holds the destinations only.
    expect(credits.closest("nav")).toBeNull();
    const dash = within(credits).getByRole("button", {
      name: "Not measured. Credit metering is not built.",
    });
    expect(dash.textContent).toBe("—");
    expect(credits.textContent).toContain("Not measured — credit metering is not built.");
    expect(credits.textContent).not.toMatch(/\d/);
    expect(within(credits).queryByRole("meter")).toBeNull();
    expect(within(credits).queryByRole("progressbar")).toBeNull();
    // Nothing is read for it: usage counts upstream requests, not credits.
    expect(requests("GET", "/api/v1/usage")).toHaveLength(0);
  });

  it("says plainly when the vetting status cannot be read: an em dash, never an alert or a guess", async () => {
    fakeApi({
      "GET /api/v1/session": () => Response.json(signedIn(acme.id)),
      "GET /api/v1/me": problem(503, "[CODE]"),
      "GET /api/v1/cases": () => Response.json({ items: [], hasMore: false }),
    });
    renderAt("/cases");
    expect(
      await screen.findByRole("button", {
        name: "Not measured. The vetting status could not be read ([CODE]).",
      }),
    ).toBeTruthy();
    expect(screen.queryByText("Verified tenant")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("draws the vetting status as an outline with no dot, so it never reads as a status chip", async () => {
    fakeApi({
      "GET /api/v1/session": () => Response.json(signedIn(acme.id)),
      "GET /api/v1/me": meOf("APPROVED"),
    });
    renderAt("/members");
    const pill = await screen.findByText("Verified tenant");
    expect(pill.className).toContain("border-border-input");
    expect(pill.children).toHaveLength(0);
  });

  it("opens the command palette on Ctrl K, reading cases only then, and lists pages and cases but no runs", async () => {
    fakeApi({
      "GET /api/v1/session": () => Response.json(signedIn(acme.id)),
      "GET /api/v1/me": meOf("NOT_SUBMITTED"),
      "GET /api/v1/cases": () =>
        Response.json({
          items: [
            caseRow("77777777-7777-4777-8777-000000000001", "[Open case]"),
            caseRow(
              "77777777-7777-4777-8777-000000000002",
              "[Closed case]",
              "2026-01-02T00:00:00.000Z",
            ),
          ],
          hasMore: false,
        }),
    });
    const router = renderAt("/members");
    await screen.findByRole("button", { name: "Account" });
    // Nothing is read for the palette until it opens.
    expect(requests("GET", "/api/v1/cases")).toHaveLength(0);
    expect(screen.queryByRole("dialog")).toBeNull();

    const palette = await openPalette();
    const listbox = await within(palette).findByRole("listbox");
    const group = (name: string) => within(listbox).getByRole("group", { name });
    expect(labels(within(group("Pages")).getAllByRole("option"))).toEqual([
      "Search",
      "Cases",
      "Members",
      "Settings",
    ]);
    const cases = within(group("Cases")).getAllByRole("option");
    expect(labels(cases)).toEqual(["[Open case]", "[Closed case]"]);
    // When it was created, in the shared form (local time with its zone), with one verb.
    expect(cases[0]?.textContent).toContain("created ");
    expect(cases[0]?.textContent).not.toContain("opened");
    const time = cases[0]?.querySelector("time");
    expect(time?.getAttribute("dateTime")).toBe("2026-01-01T00:00:00.000Z");
    expect(time?.textContent).toBe(
      new Date("2026-01-01T00:00:00.000Z").toLocaleString(undefined, { timeZoneName: "short" }),
    );
    // An archived case says so in words.
    expect(cases[1]?.textContent).toContain("archived");
    expect(cases[0]?.textContent).not.toContain("archived");
    expect(requests("GET", "/api/v1/cases")).toHaveLength(1);
    // No runs (no endpoint lists them), and with one organisation, no switch.
    expect(listbox.textContent).not.toMatch(/\brun\b/i);
    expect(within(listbox).queryByRole("group", { name: "Organisation" })).toBeNull();

    fireEvent.click(cases[0] as HTMLElement);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(
        "/cases/77777777-7777-4777-8777-000000000001/overview",
      );
    });
  });

  it("offers Switch organisation only where there is another one to switch to", async () => {
    fakeApi({
      "GET /api/v1/session": () => Response.json(signedIn(acme.id, [acme, other])),
      "GET /api/v1/me": meOf("NOT_SUBMITTED"),
      "GET /api/v1/cases": () => Response.json({ items: [], hasMore: false }),
    });
    const router = renderAt("/members");
    const palette = await openPalette();
    const organisation = await within(palette).findByRole("group", { name: "Organisation" });
    expect(labels(within(organisation).getAllByRole("option"))).toEqual(["Switch organisation"]);
    fireEvent.click(within(organisation).getByRole("option"));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/tenant");
    });
  });

  it("with one organisation, neither the palette nor the account menu offers a switch", async () => {
    fakeApi({
      "GET /api/v1/session": () => Response.json(signedIn(acme.id)),
      "GET /api/v1/me": meOf("NOT_SUBMITTED"),
    });
    renderAt("/members");
    fireEvent.click(await screen.findByRole("button", { name: "Account" }));
    await screen.findByRole("radio", { name: "Light" });
    expect(screen.queryByRole("button", { name: "Switch organisation" })).toBeNull();
  });

  it("says in the palette when the cases cannot be read, with the code, and keeps the pages", async () => {
    fakeApi({
      "GET /api/v1/session": () => Response.json(signedIn(acme.id)),
      "GET /api/v1/me": meOf("NOT_SUBMITTED"),
      "GET /api/v1/cases": problem(503, "[CODE]"),
    });
    renderAt("/members");
    const palette = await openPalette();
    const cases = await within(palette).findByRole("group", { name: "Cases" });
    expect(cases.textContent).toContain("Cases could not be read");
    expect(cases.textContent).toContain("Code: [CODE].");
    expect(within(palette).getByRole("group", { name: "Pages" })).toBeTruthy();
  });

  it("the organisation chooser marks the current one in words, and names each button by its organisation", async () => {
    fakeApi({
      "GET /api/v1/session": () => Response.json(signedIn(acme.id, [acme, other])),
      "GET /api/v1/me": meOf("NOT_SUBMITTED"),
    });
    renderAt("/tenant");
    const current = await screen.findByRole("button", { name: acme.name });
    expect(current.getAttribute("aria-current")).toBe("true");
    expect(current.closest("li")?.textContent).toBe(`${acme.name}Current`);
    const second = screen.getByRole("button", { name: other.name });
    expect(second.getAttribute("aria-current")).toBeNull();
    expect(second.closest("li")?.textContent).toBe(other.name);
    expect(screen.getByRole("link", { name: "Back to search" }).getAttribute("href")).toBe("/");
    // Every row keeps the trailing column, so the buttons line up whichever is Current.
    expect(second.closest("li")?.children).toHaveLength(2);
  });

  it("switching from an open organisation sits in the app frame; the first choice sits in the sign-in frame", async () => {
    fakeApi({
      "GET /api/v1/session": () => Response.json(signedIn(acme.id, [acme, other])),
      "GET /api/v1/me": meOf("NOT_SUBMITTED"),
    });
    renderAt("/tenant");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Choose an organisation" }),
    ).toBeTruthy();
    // The app frame: its navigation, its header's account menu and the command palette.
    expect(screen.getAllByRole("navigation", { name: "Main" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Account" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Command palette/ })).toBeTruthy();
    cleanup();

    fakeApi({
      "GET /api/v1/session": () => Response.json(signedIn(null, [acme, other])),
    });
    renderAt("/tenant");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Choose an organisation" }),
    ).toBeTruthy();
    // No organisation is open yet: the sign-in frame, with no app navigation and no way back.
    expect(screen.getByText(PRODUCT_NAME)).toBeTruthy();
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByRole("button", { name: "Account" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Back to search" })).toBeNull();
    expect(screen.getByRole("button", { name: acme.name }).closest("li")?.children).toHaveLength(2);
  });
});

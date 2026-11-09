/**
 * The provisional Settings screen: the real router and screen, over a fetch
 * stub that answers as the API does; every request goes through the generated
 * client. It reads the retention window and the usage summary, manages stored
 * credentials and scope authorisations, and changes no other setting.
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

const usage = {
  lines: [
    {
      unit: "UPSTREAM_REQUEST",
      period: "DAY",
      periodStart: "2026-10-27T00:00:00.000Z",
      used: 12,
      maxQuantity: 500,
    },
    {
      unit: "UPSTREAM_REQUEST",
      period: "MONTH",
      periodStart: "2026-10-01T00:00:00.000Z",
      used: 1234,
      maxQuantity: 20000,
    },
  ],
  exceeded: false,
};

const ACTIVE_CRED = "22222222-2222-4222-8222-000000000001";
const REVOKED_CRED = "22222222-2222-4222-8222-000000000002";

/** A stored credential's metadata, as the vault returns it (never a secret). */
const cred = (over: Record<string, unknown> = {}) => ({
  id: ACTIVE_CRED,
  provider: "shodan",
  label: "[Shodan key]",
  masterKeyVersion: "mk-1",
  createdAt: "2026-02-01T00:00:00.000Z",
  lastUsedAt: null,
  revokedAt: null,
  ...over,
});

const SA_ID = "33333333-3333-4333-8333-000000000001";

/** A scope authorisation, as the API returns it; the status is derived from these dates. */
const sa = (over: Record<string, unknown> = {}) => ({
  id: SA_ID,
  targetType: "DOMAIN",
  target: "example.com",
  authorisedByUserId: "99999999-9999-4999-8999-000000000001",
  basis: "[Engagement 42: written client permission on file]",
  validFrom: "2020-01-01T00:00:00.000Z",
  validUntil: "2099-01-01T00:00:00.000Z",
  revokedAt: null,
  createdAt: "2020-01-01T00:00:00.000Z",
  ...over,
});

const base: Record<string, Handler> = {
  "GET /api/v1/session": () => Response.json(session),
  "GET /api/v1/me": () => Response.json(me),
  "GET /api/v1/usage": () => Response.json(usage),
  "GET /api/v1/credentials": () => Response.json({ items: [], hasMore: false }),
  "GET /api/v1/scope-authorisations": () => Response.json({ items: [], hasMore: false }),
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

/** Every request the screen sent was a read (a GET): nothing was submitted. */
function expectOnlyReads() {
  expect(fetchMock.mock.calls.length).toBeGreaterThan(0);
  for (const [request] of fetchMock.mock.calls) {
    expect(request.method).toBe("GET");
  }
}

/** The calls the screen made to one method and path, for asserting what was (not) sent. */
const requests = (method: string, path: string) =>
  fetchMock.mock.calls.filter(
    ([request]) => request.method === method && new URL(request.url).pathname === path,
  );

const retentionCard = async () => within(await screen.findByRole("region", { name: "Retention" }));
const usageCard = async () => within(await screen.findByRole("region", { name: "Usage" }));
const credentialsCard = async () =>
  within(await screen.findByRole("region", { name: "Credentials" }));
const scopeCard = async () =>
  within(await screen.findByRole("region", { name: "Scope authorisations" }));

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
      screen.getByText(/Stored credentials and scope authorisations can be managed here/),
    ).toBeTruthy();
    expect(
      screen.getByText(/the other settings cannot be changed in this provisional screen/),
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
    for (const area of ["API keys"]) {
      const region = screen.getByRole("region", { name: area });
      const card = within(region);
      expect(card.getByText(/^Not built yet\./)).toBeTruthy();
      expect(card.queryByText(/\d/)).toBeNull();
      expect(card.queryByRole("heading", { level: 2 })).toBeNull();
      expect(region.parentElement).toBe(grid);
    }
    // Usage, Credentials and Scope authorisations are now real, not Not built cards.
    for (const area of ["Usage", "Credentials", "Scope authorisations"]) {
      const region = screen.getByRole("region", { name: area });
      expect(within(region).queryByText(/^Not built yet\./)).toBeNull();
      expect(region.parentElement).toBe(grid);
    }
    expect(screen.getByRole("region", { name: "Retention" }).parentElement).toBe(grid);
    expect(grid?.children).toHaveLength(6);

    // Nothing changes retention, usage or reports here; credentials are managed in their
    // own card, and on load (nothing submitted) every request the screen makes is a read.
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

describe("the Settings usage card", () => {
  /** The real retention read beside a per-test usage read, so the whole screen renders. */
  const withRetention = (handlers: Record<string, Handler>): Record<string, Handler> => ({
    ...base,
    "GET /api/v1/settings/retention": () => Response.json({ retentionDays: 30, enforced: false }),
    ...handlers,
  });

  it("shows this organisation's usage beside its quotas, from the API", async () => {
    fakeApi(withRetention({}));
    renderSettings();
    const card = await usageCard();
    // Each metric is labelled with its unit and time period.
    expect(await card.findByText(/Upstream requests.*Today/)).toBeTruthy();
    expect(card.getByText(/Upstream requests.*This month/)).toBeTruthy();
    expect(card.getByText("12")).toBeTruthy();
    expect(card.getByText("500")).toBeTruthy();
    expect(card.getByText("1234")).toBeTruthy();
    expect(card.getByText("20000")).toBeTruthy();
    // exceeded is false, so nothing says a quota is spent.
    expect(card.queryByText(/quota is spent/i)).toBeNull();
    expectOnlyReads();
  });

  it("announces when a quota is spent", async () => {
    fakeApi(
      withRetention({
        "GET /api/v1/usage": () =>
          Response.json({
            lines: [
              {
                unit: "UPSTREAM_REQUEST",
                period: "DAY",
                periodStart: "2026-10-27T00:00:00.000Z",
                used: 500,
                maxQuantity: 500,
              },
            ],
            exceeded: true,
          }),
      }),
    );
    renderSettings();
    const card = await usageCard();
    expect(
      await card.findByText("A quota is spent, so new runs are refused until its period ends."),
    ).toBeTruthy();
    expectOnlyReads();
  });

  it("shows a measured zero as 0, never an em dash", async () => {
    fakeApi(
      withRetention({
        "GET /api/v1/usage": () =>
          Response.json({
            lines: [
              {
                unit: "UPSTREAM_REQUEST",
                period: "DAY",
                periodStart: "2026-10-27T00:00:00.000Z",
                used: 0,
                maxQuantity: 500,
              },
              {
                unit: "UPSTREAM_REQUEST",
                period: "MONTH",
                periodStart: "2026-10-01T00:00:00.000Z",
                used: 9,
                maxQuantity: 500,
              },
            ],
            exceeded: false,
          }),
      }),
    );
    renderSettings();
    const card = await usageCard();
    // 0 is a measured value, shown as 0.
    expect(await card.findByText("0")).toBeTruthy();
    // Every quota is known here, so there is no em dash (Unmeasured button) to confuse it with.
    expect(card.queryByRole("button")).toBeNull();
    expectOnlyReads();
  });

  it("shows a period with no quota as an em dash with its reason, never a guessed limit", async () => {
    fakeApi(
      withRetention({
        "GET /api/v1/usage": () =>
          Response.json({
            lines: [
              {
                unit: "UPSTREAM_REQUEST",
                period: "DAY",
                periodStart: "2026-10-27T00:00:00.000Z",
                used: 3,
                maxQuantity: null,
              },
              {
                unit: "UPSTREAM_REQUEST",
                period: "MONTH",
                periodStart: "2026-10-01T00:00:00.000Z",
                used: 40,
                maxQuantity: 7,
              },
            ],
            exceeded: false,
          }),
      }),
    );
    renderSettings();
    const card = await usageCard();
    const dash = await card.findByRole("button", {
      name: "Not measured. This organisation has no quota for this unit in this period.",
    });
    expect(dash.textContent).toBe("—");
    // The used counts and the other period's real quota are still shown.
    expect(card.getByText("3")).toBeTruthy();
    expect(card.getByText("40")).toBeTruthy();
    expect(card.getByText("7")).toBeTruthy();
    expectOnlyReads();
  });

  it("says what it is reading while usage loads", async () => {
    fakeApi(
      withRetention({
        "GET /api/v1/usage": () => new Promise<Response>(() => undefined),
      }),
    );
    renderSettings();
    const status = await (await usageCard()).findByRole("status");
    expect(status.textContent).toBe("Reading usage.");
    expectOnlyReads();
  });

  it("offers a retry when the usage read failed for another reason", async () => {
    fakeApi(
      withRetention({
        "GET /api/v1/usage": () =>
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
      }),
    );
    renderSettings();
    const refusal = await (await usageCard()).findByRole("alert");
    expect(refusal.textContent).toContain("[The stated reason]");
    expect(within(refusal).getByRole("button", { name: "Try again" })).toBeTruthy();
    expectOnlyReads();
  });

  it("says a refused usage read plainly, with no retry and no retry loop", async () => {
    fakeApi(
      withRetention({
        "GET /api/v1/usage": () =>
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
      }),
    );
    renderSettings();
    const refusal = await (await usageCard()).findByRole("alert");
    expect(refusal.textContent).toContain("Usage could not be read.");
    expect(refusal.textContent).toContain("Your role in this organisation does not allow this.");
    expect(refusal.textContent).toContain("Code: PERMISSION_DENIED");
    expect(within(refusal).queryByRole("button", { name: "Try again" })).toBeNull();
    // No retry loop: usage was asked for exactly once.
    const usageReads = fetchMock.mock.calls.filter(
      ([request]) => new URL(request.url).pathname === "/api/v1/usage",
    );
    expect(usageReads).toHaveLength(1);
    expectOnlyReads();
  });
});

describe("the Settings credentials card", () => {
  /** The real retention and usage reads beside a per-test credentials setup. */
  const withBase = (handlers: Record<string, Handler>): Record<string, Handler> => ({
    ...base,
    "GET /api/v1/settings/retention": () => Response.json({ retentionDays: 30, enforced: false }),
    ...handlers,
  });

  it("lists stored credentials: provider, status, last used, and Revoke only on active ones", async () => {
    fakeApi(
      withBase({
        "GET /api/v1/credentials": () =>
          Response.json({
            items: [
              cred({
                id: ACTIVE_CRED,
                provider: "shodan",
                label: "[Shodan key]",
                lastUsedAt: "2026-03-01T00:00:00.000Z",
              }),
              cred({
                id: REVOKED_CRED,
                provider: "hibp",
                label: "[HIBP key]",
                lastUsedAt: null,
                revokedAt: "2026-03-05T00:00:00.000Z",
              }),
            ],
            hasMore: false,
          }),
      }),
    );
    renderSettings();
    const card = await credentialsCard();
    expect(await card.findByText("[Shodan key]")).toBeTruthy();
    expect(card.getByText("[HIBP key]")).toBeTruthy();
    expect(card.getByText("shodan")).toBeTruthy();
    expect(card.getByText("hibp")).toBeTruthy();
    expect(card.getByText("Active")).toBeTruthy();
    expect(card.getByText("Revoked")).toBeTruthy();
    // The never-used credential shows an em dash with its reason, not a zero or a blank.
    expect(
      card.getByRole("button", {
        name: "None. No use of this credential has been recorded.",
      }).textContent,
    ).toBe("—");
    // Only the active credential can be revoked.
    expect(card.getAllByRole("button", { name: "Revoke" })).toHaveLength(1);
  });

  it("shows an empty state when nothing is stored, and still offers the add form", async () => {
    fakeApi(withBase({}));
    renderSettings();
    const card = await credentialsCard();
    expect(
      await card.findByText(/No credentials are stored for this organisation yet\./),
    ).toBeTruthy();
    expect(card.getByRole("button", { name: "Add credential" })).toBeTruthy();
    expect(card.queryByRole("button", { name: "Revoke" })).toBeNull();
  });

  it("stores a credential, then clears the secret and never shows it again", async () => {
    fakeApi(
      withBase({
        "POST /api/v1/credentials": async (request) => {
          const body = JSON.parse(await request.clone().text()) as Record<string, unknown>;
          return Response.json(cred({ provider: body["provider"], label: body["label"] }), {
            status: 201,
          });
        },
      }),
    );
    renderSettings();
    const card = await credentialsCard();
    const SECRET = "[synthetic-secret-xyz]";
    fireEvent.change(card.getByLabelText("Provider"), { target: { value: "shodan" } });
    fireEvent.change(card.getByLabelText("Label"), { target: { value: "[Shodan key]" } });
    fireEvent.change(card.getByLabelText("Secret"), { target: { value: SECRET } });
    fireEvent.click(card.getByRole("button", { name: "Add credential" }));

    await waitFor(() => {
      expect(requests("POST", "/api/v1/credentials")).toHaveLength(1);
    });
    const posted = await Promise.all(
      requests("POST", "/api/v1/credentials").map(
        async ([request]) => JSON.parse(await request.clone().text()) as unknown,
      ),
    );
    expect(posted).toEqual([{ provider: "shodan", label: "[Shodan key]", secret: SECRET }]);

    // After storing, the secret is cleared from the form and never rendered anywhere.
    await waitFor(() => {
      expect(screen.getByLabelText<HTMLInputElement>("Secret").value).toBe("");
    });
    expect(screen.queryByText(SECRET)).toBeNull();
    expect(screen.queryByDisplayValue(SECRET)).toBeNull();
    // The secret travelled in the POST body only, never in a URL.
    for (const [request] of fetchMock.mock.calls) {
      expect(request.url).not.toContain("synthetic-secret");
    }
  });

  it("does not store a credential twice while one store is in flight", async () => {
    fakeApi(
      withBase({
        "POST /api/v1/credentials": () => new Promise<Response>(() => undefined),
      }),
    );
    renderSettings();
    const card = await credentialsCard();
    fireEvent.change(card.getByLabelText("Provider"), { target: { value: "shodan" } });
    fireEvent.change(card.getByLabelText("Label"), { target: { value: "[Key]" } });
    fireEvent.change(card.getByLabelText("Secret"), { target: { value: "[secret]" } });
    fireEvent.click(card.getByRole("button", { name: "Add credential" }));
    // It says it is working and is disabled; a second click sends nothing more.
    const busy = await card.findByRole("button", { name: "Adding…" });
    expect(busy.hasAttribute("disabled")).toBe(true);
    fireEvent.click(busy);
    expect(requests("POST", "/api/v1/credentials")).toHaveLength(1);
  });

  it("refuses an empty field with a message and sends nothing", async () => {
    fakeApi(withBase({}));
    renderSettings();
    const card = await credentialsCard();
    fireEvent.click(card.getByRole("button", { name: "Add credential" }));
    expect(card.getByText("Enter the provider this key is for.")).toBeTruthy();
    expect(card.getByText("Enter a label for this credential.")).toBeTruthy();
    expect(card.getByText("Enter the secret to store.")).toBeTruthy();
    expect(requests("POST", "/api/v1/credentials")).toHaveLength(0);
  });

  it("surfaces a server validation error and keeps the secret out of the message", async () => {
    fakeApi(
      withBase({
        "POST /api/v1/credentials": () =>
          Response.json(
            {
              type: "about:blank",
              title: "Bad Request",
              status: 400,
              code: "[VALIDATION]",
              detail: "[provider is not valid]",
            },
            { status: 400 },
          ),
      }),
    );
    renderSettings();
    const card = await credentialsCard();
    const SECRET = "[synthetic-secret-abc]";
    fireEvent.change(card.getByLabelText("Provider"), { target: { value: "BAD provider" } });
    fireEvent.change(card.getByLabelText("Label"), { target: { value: "[Key]" } });
    fireEvent.change(card.getByLabelText("Secret"), { target: { value: SECRET } });
    fireEvent.click(card.getByRole("button", { name: "Add credential" }));
    const alert = await card.findByRole("alert");
    expect(alert.textContent).toContain("[provider is not valid]");
    expect(alert.textContent).not.toContain(SECRET);
    expect(screen.queryByText(SECRET)).toBeNull();
  });

  it("revokes a credential after a confirmation step", async () => {
    let revoked = false;
    fakeApi(
      withBase({
        "GET /api/v1/credentials": () =>
          Response.json({
            items: [cred({ revokedAt: revoked ? "2026-03-10T00:00:00.000Z" : null })],
            hasMore: false,
          }),
        [`POST /api/v1/credentials/${ACTIVE_CRED}/revoke`]: () => {
          revoked = true;
          return Response.json(cred({ revokedAt: "2026-03-10T00:00:00.000Z" }), { status: 200 });
        },
      }),
    );
    renderSettings();
    const card = await credentialsCard();
    // Revoking asks for confirmation before anything is sent.
    fireEvent.click(await card.findByRole("button", { name: "Revoke" }));
    expect(requests("POST", `/api/v1/credentials/${ACTIVE_CRED}/revoke`)).toHaveLength(0);
    fireEvent.click(card.getByRole("button", { name: "Confirm revoke" }));
    // Once revoked, the row says so and offers no further Revoke control.
    expect(await card.findByText("Revoked")).toBeTruthy();
    await waitFor(() => {
      expect(card.queryByRole("button", { name: "Revoke" })).toBeNull();
    });
    expect(requests("POST", `/api/v1/credentials/${ACTIVE_CRED}/revoke`)).toHaveLength(1);
  });

  it("says a refused credentials read plainly, with no retry and no retry loop", async () => {
    fakeApi(
      withBase({
        "GET /api/v1/credentials": () =>
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
      }),
    );
    renderSettings();
    const card = await credentialsCard();
    const refusal = await card.findByRole("alert");
    expect(refusal.textContent).toContain("The stored credentials could not be read.");
    expect(refusal.textContent).toContain("Your role in this organisation does not allow this.");
    expect(refusal.textContent).toContain("Code: PERMISSION_DENIED");
    expect(within(refusal).queryByRole("button", { name: "Try again" })).toBeNull();
    // No retry loop: the credentials list was read exactly once.
    expect(requests("GET", "/api/v1/credentials")).toHaveLength(1);
  });
});

describe("the Settings scope authorisations card", () => {
  /** The real retention read beside a per-test scope-authorisation setup. */
  const withBase = (handlers: Record<string, Handler>): Record<string, Handler> => ({
    ...base,
    "GET /api/v1/settings/retention": () => Response.json({ retentionDays: 30, enforced: false }),
    ...handlers,
  });

  it("lists authorisations with a derived status, validity, target and basis", async () => {
    fakeApi(
      withBase({
        "GET /api/v1/scope-authorisations": () =>
          Response.json({
            items: [
              sa({
                id: "a",
                target: "active.example",
                validFrom: "2020-01-01T00:00:00.000Z",
                validUntil: "2099-01-01T00:00:00.000Z",
              }),
              sa({
                id: "p",
                target: "pending.example",
                validFrom: "2099-01-01T00:00:00.000Z",
                validUntil: "2099-02-01T00:00:00.000Z",
              }),
              sa({
                id: "e",
                target: "expired.example",
                validFrom: "2020-01-01T00:00:00.000Z",
                validUntil: "2021-01-01T00:00:00.000Z",
              }),
              sa({ id: "r", target: "revoked.example", revokedAt: "2021-06-01T00:00:00.000Z" }),
            ],
            hasMore: false,
          }),
      }),
    );
    renderSettings();
    const card = await scopeCard();
    expect(await card.findByText("active.example")).toBeTruthy();
    expect(card.getByText("pending.example")).toBeTruthy();
    expect(card.getByText("expired.example")).toBeTruthy();
    expect(card.getByText("revoked.example")).toBeTruthy();
    // Status is derived from the dates/revocation, never a server field.
    expect(card.getByText("Active")).toBeTruthy();
    expect(card.getByText("Not yet valid")).toBeTruthy();
    expect(card.getByText("Expired")).toBeTruthy();
    expect(card.getByText("Revoked")).toBeTruthy();
    // The basis is shown on every row.
    expect(card.getAllByText(/Engagement 42/)).toHaveLength(4);
    // Only the three not-yet-revoked authorisations can be revoked.
    expect(card.getAllByRole("button", { name: "Revoke" })).toHaveLength(3);
  });

  it("shows an empty state and still offers the record form", async () => {
    fakeApi(withBase({}));
    renderSettings();
    const card = await scopeCard();
    expect(await card.findByText(/No scope authorisations are recorded\./)).toBeTruthy();
    expect(card.getByRole("button", { name: "Record authorisation" })).toBeTruthy();
    expect(card.queryByRole("button", { name: "Revoke" })).toBeNull();
  });

  it("records an authorisation with the exact server fields, then clears the form", async () => {
    fakeApi(
      withBase({
        "POST /api/v1/scope-authorisations": async (request) => {
          const body = JSON.parse(await request.clone().text()) as Record<string, unknown>;
          return Response.json(sa({ target: body["target"] }), { status: 201 });
        },
      }),
    );
    renderSettings();
    const card = await scopeCard();
    fireEvent.change(card.getByLabelText("Target type"), { target: { value: "DOMAIN" } });
    fireEvent.change(card.getByLabelText("Target"), { target: { value: "example.com" } });
    fireEvent.change(card.getByLabelText("Basis"), { target: { value: "[written permission]" } });
    fireEvent.change(card.getByLabelText("Valid from"), { target: { value: "2027-01-01T00:00" } });
    fireEvent.change(card.getByLabelText("Valid until"), { target: { value: "2027-02-01T00:00" } });
    fireEvent.click(card.getByRole("button", { name: "Record authorisation" }));

    await waitFor(() => {
      expect(requests("POST", "/api/v1/scope-authorisations")).toHaveLength(1);
    });
    const posted = await Promise.all(
      requests("POST", "/api/v1/scope-authorisations").map(async ([request]) => {
        const body = JSON.parse(await request.clone().text()) as Record<string, unknown>;
        return {
          targetType: body["targetType"],
          target: body["target"],
          basis: body["basis"],
          orderedInstants:
            typeof body["validFrom"] === "string" &&
            typeof body["validUntil"] === "string" &&
            new Date(body["validUntil"]).getTime() > new Date(body["validFrom"]).getTime(),
        };
      }),
    );
    expect(posted).toEqual([
      {
        targetType: "DOMAIN",
        target: "example.com",
        basis: "[written permission]",
        orderedInstants: true,
      },
    ]);
    // The form resets after a successful record.
    await waitFor(() => {
      expect(screen.getByLabelText<HTMLInputElement>("Target").value).toBe("");
    });
  });

  it("does not record an authorisation twice while one is in flight", async () => {
    fakeApi(
      withBase({
        "POST /api/v1/scope-authorisations": () => new Promise<Response>(() => undefined),
      }),
    );
    renderSettings();
    const card = await scopeCard();
    fireEvent.change(card.getByLabelText("Target type"), { target: { value: "DOMAIN" } });
    fireEvent.change(card.getByLabelText("Target"), { target: { value: "example.com" } });
    fireEvent.change(card.getByLabelText("Basis"), { target: { value: "[written permission]" } });
    fireEvent.change(card.getByLabelText("Valid from"), { target: { value: "2027-01-01T00:00" } });
    fireEvent.change(card.getByLabelText("Valid until"), { target: { value: "2027-02-01T00:00" } });
    fireEvent.click(card.getByRole("button", { name: "Record authorisation" }));
    const busy = await card.findByRole("button", { name: "Recording…" });
    expect(busy.hasAttribute("disabled")).toBe(true);
    fireEvent.click(busy);
    expect(requests("POST", "/api/v1/scope-authorisations")).toHaveLength(1);
  });

  it("refuses missing fields with messages and sends nothing", async () => {
    fakeApi(withBase({}));
    renderSettings();
    const card = await scopeCard();
    fireEvent.click(card.getByRole("button", { name: "Record authorisation" }));
    expect(card.getByText("Choose the target type.")).toBeTruthy();
    expect(card.getByText("Enter the exact target.")).toBeTruthy();
    expect(card.getByText("Record the basis for this authorisation.")).toBeTruthy();
    expect(card.getByText("Enter when the authorisation starts.")).toBeTruthy();
    expect(card.getByText("Enter when the authorisation ends.")).toBeTruthy();
    expect(requests("POST", "/api/v1/scope-authorisations")).toHaveLength(0);
  });

  it("refuses an end that is not after the start, and sends nothing", async () => {
    fakeApi(withBase({}));
    renderSettings();
    const card = await scopeCard();
    fireEvent.change(card.getByLabelText("Target type"), { target: { value: "DOMAIN" } });
    fireEvent.change(card.getByLabelText("Target"), { target: { value: "example.com" } });
    fireEvent.change(card.getByLabelText("Basis"), { target: { value: "[written permission]" } });
    fireEvent.change(card.getByLabelText("Valid from"), { target: { value: "2027-02-01T00:00" } });
    fireEvent.change(card.getByLabelText("Valid until"), { target: { value: "2027-01-01T00:00" } });
    fireEvent.click(card.getByRole("button", { name: "Record authorisation" }));
    expect(card.getByText("The end must be after the start.")).toBeTruthy();
    expect(requests("POST", "/api/v1/scope-authorisations")).toHaveLength(0);
  });

  it("surfaces a server validation error with its reason", async () => {
    fakeApi(
      withBase({
        "POST /api/v1/scope-authorisations": () =>
          Response.json(
            {
              type: "about:blank",
              title: "Bad Request",
              status: 400,
              code: "VALIDITY_TOO_LONG",
              detail: "An authorisation may last at most 366 days.",
            },
            { status: 400 },
          ),
      }),
    );
    renderSettings();
    const card = await scopeCard();
    fireEvent.change(card.getByLabelText("Target type"), { target: { value: "DOMAIN" } });
    fireEvent.change(card.getByLabelText("Target"), { target: { value: "example.com" } });
    fireEvent.change(card.getByLabelText("Basis"), { target: { value: "[written permission]" } });
    fireEvent.change(card.getByLabelText("Valid from"), { target: { value: "2027-01-01T00:00" } });
    fireEvent.change(card.getByLabelText("Valid until"), { target: { value: "2029-01-01T00:00" } });
    fireEvent.click(card.getByRole("button", { name: "Record authorisation" }));
    const alert = await card.findByRole("alert");
    expect(alert.textContent).toContain("An authorisation may last at most 366 days.");
    expect(alert.textContent).toContain("Code: VALIDITY_TOO_LONG");
  });

  it("revokes an authorisation after confirmation, sending an empty body", async () => {
    let revoked = false;
    fakeApi(
      withBase({
        "GET /api/v1/scope-authorisations": () =>
          Response.json({
            items: [sa({ revokedAt: revoked ? "2027-06-01T00:00:00.000Z" : null })],
            hasMore: false,
          }),
        [`POST /api/v1/scope-authorisations/${SA_ID}/revoke`]: () => {
          revoked = true;
          return Response.json(sa({ revokedAt: "2027-06-01T00:00:00.000Z" }), { status: 200 });
        },
      }),
    );
    renderSettings();
    const card = await scopeCard();
    fireEvent.click(await card.findByRole("button", { name: "Revoke" }));
    // Confirmation is required before anything is sent.
    expect(requests("POST", `/api/v1/scope-authorisations/${SA_ID}/revoke`)).toHaveLength(0);
    fireEvent.click(card.getByRole("button", { name: "Confirm revoke" }));
    expect(await card.findByText("Revoked")).toBeTruthy();
    await waitFor(() => {
      expect(card.queryByRole("button", { name: "Revoke" })).toBeNull();
    });
    const bodies = await Promise.all(
      requests("POST", `/api/v1/scope-authorisations/${SA_ID}/revoke`).map(
        async ([request]) => JSON.parse(await request.clone().text()) as unknown,
      ),
    );
    expect(bodies).toEqual([{}]);
  });

  it("says a refused read plainly, with no retry and no retry loop", async () => {
    fakeApi(
      withBase({
        "GET /api/v1/scope-authorisations": () =>
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
      }),
    );
    renderSettings();
    const card = await scopeCard();
    const refusal = await card.findByRole("alert");
    expect(refusal.textContent).toContain("The scope authorisations could not be read.");
    expect(refusal.textContent).toContain("Your role in this organisation does not allow this.");
    expect(refusal.textContent).toContain("Code: PERMISSION_DENIED");
    expect(within(refusal).queryByRole("button", { name: "Try again" })).toBeNull();
    expect(requests("GET", "/api/v1/scope-authorisations")).toHaveLength(1);
  });
});

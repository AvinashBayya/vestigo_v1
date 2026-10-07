/**
 * The provisional Members screen: the real router and screen, over a fetch
 * stub that answers as the API does; every request goes through the generated
 * client. It reads members and pending invitations, and never changes them.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
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
  permissions: ["member:read"],
};

const owner = {
  userId: "22222222-2222-4222-8222-222222222222",
  email: "[owner-email]",
  displayName: "[Owner name]",
  status: "ACTIVE",
  role: "owner",
  createdAt: "2026-01-01T00:00:00.000Z",
};
const removed = {
  userId: "33333333-3333-4333-8333-333333333333",
  email: "[removed-email]",
  displayName: null,
  status: "DISABLED",
  role: null,
  createdAt: "2026-02-01T00:00:00.000Z",
};
const invitation = {
  id: "[invitation-id]",
  email: "[invitee-email]",
  roles: ["analyst"],
  invitedByUserId: owner.userId,
  createdAt: "2026-03-01T00:00:00.000Z",
  expiresAt: "2026-03-08T00:00:00.000Z",
};

const base: Record<string, Handler> = {
  "GET /api/v1/session": () => Response.json(session),
  "GET /api/v1/me": () => Response.json(me),
  "GET /health": () => Response.json({ status: "ok" }),
};

function renderMembers() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createAppRouter(
    queryClient,
    createMemoryHistory({ initialEntries: ["/members"] }),
  );
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

/** A table's row by index (0 is the header row); a missing row fails the test. */
function rowOf(table: HTMLElement, index: number): HTMLElement {
  const row = within(table).getAllByRole("row")[index];
  expect(row).toBeDefined();
  return row as HTMLElement;
}

/** Every request the screen sent was a read. */
function expectOnlyReads() {
  expect(fetchMock.mock.calls.length).toBeGreaterThan(0);
  for (const [request] of fetchMock.mock.calls) expect(request.method).toBe("GET");
}

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
});

describe("the provisional Members screen", () => {
  it("lists members and pending invitations from the API, with an em dash and its reason for each null", async () => {
    fakeApi({
      ...base,
      "GET /api/v1/members": () => Response.json({ items: [owner, removed], hasMore: false }),
      "GET /api/v1/members/invitations": () =>
        Response.json({ items: [invitation], hasMore: false }),
    });
    renderMembers();

    expect(await screen.findByRole("heading", { level: 1, name: "Members" })).toBeTruthy();
    expect(screen.getByText("Provisional: no screen design yet")).toBeTruthy();
    expect(screen.getAllByText(/not built in\s+this provisional screen/).length).toBeGreaterThan(0);

    const members = await screen.findByRole("table", { name: "Members" });
    expect(within(members).getAllByRole("row")).toHaveLength(3);
    const ownerRow = rowOf(members, 1);
    const removedRow = rowOf(members, 2);
    expect(within(ownerRow).getByText("[Owner name]")).toBeTruthy();
    expect(within(ownerRow).getByText("[owner-email]")).toBeTruthy();
    // Roles in words, through the label map: the API's "owner" is shown as "Owner".
    expect(within(ownerRow).getByText("Owner")).toBeTruthy();
    expect(within(ownerRow).queryByText("owner")).toBeNull();
    expect(within(ownerRow).getByText("Active")).toBeTruthy();
    // Nulls are em dashes that say why, never blank, never a guess.
    expect(
      within(removedRow).getByRole("button", {
        name: "Not measured. No display name is recorded for this account.",
      }).textContent,
    ).toBe("—");
    expect(
      within(removedRow).getByRole("button", {
        name: "Not measured. No role: this account is no longer a member of this organisation.",
      }).textContent,
    ).toBe("—");
    expect(within(removedRow).getByText("Disabled")).toBeTruthy();

    const invitations = await screen.findByRole("table", { name: "Pending invitations" });
    const invitationRow = rowOf(invitations, 1);
    expect(within(invitationRow).getByText("[invitee-email]")).toBeTruthy();
    expect(within(invitationRow).getByText("Analyst")).toBeTruthy();
    // The inviter is named by the email the members list gives for their id.
    expect(within(invitationRow).getByText("[owner-email]")).toBeTruthy();

    // No invite, role change or removal control exists.
    expect(screen.queryByRole("button", { name: /invite|remove|change role/i })).toBeNull();
    expectOnlyReads();
  });

  it("says a list cut at the read limit is partial", async () => {
    fakeApi({
      ...base,
      "GET /api/v1/members": () => Response.json({ items: [owner], hasMore: true }),
      "GET /api/v1/members/invitations": () => Response.json({ items: [], hasMore: false }),
    });
    renderMembers();
    expect(await screen.findByText("Partial: 1 of more than 500 members.")).toBeTruthy();
    expect(await screen.findByText("No pending invitations")).toBeTruthy();
    // An empty table says so once, in its empty state: no "0" count under it.
    expect(screen.queryByText(/^0 pending invitations$/)).toBeNull();
    for (const region of screen.getAllByRole("region", { name: "Pending invitations" })) {
      expect(region.textContent).not.toMatch(/\b0\b/);
    }
    expectOnlyReads();
  });

  it("says a refused read plainly, with no retry, and the Locked state when the refusal carries one", async () => {
    fakeApi({
      ...base,
      "GET /api/v1/members": () =>
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
      "GET /api/v1/members/invitations": () =>
        Response.json(
          {
            type: "about:blank",
            title: "Forbidden",
            status: 403,
            code: "VETTING_NOT_APPROVED",
            detail: "[detail]",
            locked: {
              reason: "VETTING_NOT_APPROVED",
              module: "PERSON_INVESTIGATION",
              plan: "TECHINT_AND_PERSON",
              vettingStatus: "PENDING",
              moduleSummary: "[What the module does]",
              withheld: "[What was withheld]",
              nextStep: "[The next step]",
            },
          },
          { status: 403 },
        ),
    });
    renderMembers();

    const refusal = await screen.findByRole("alert");
    expect(refusal.textContent).toContain("The members could not be read.");
    expect(refusal.textContent).toContain("Your role in this organisation does not allow this.");
    expect(refusal.textContent).toContain("Code: PERMISSION_DENIED");
    expect(within(refusal).queryByRole("button", { name: "Try again" })).toBeNull();

    expect(await screen.findByText("[The next step]")).toBeTruthy();
    expect(screen.getByText("Code: VETTING_NOT_APPROVED")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expectOnlyReads();
  });

  it("says what it is reading while the lists load", async () => {
    fakeApi({
      ...base,
      "GET /api/v1/members": () => new Promise<Response>(() => undefined),
      "GET /api/v1/members/invitations": () => new Promise<Response>(() => undefined),
    });
    renderMembers();
    expect(await screen.findByText("Reading the organisation's members.")).toBeTruthy();
    expect(screen.getByText("Reading the pending invitations.")).toBeTruthy();
    const statuses = screen.getAllByRole("status").map((node) => node.textContent);
    expect(statuses).toContain("Reading the organisation's members.");
    expectOnlyReads();
  });
});

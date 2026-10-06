/**
 * Step 1 of the web flow: sign in, the MFA challenge, MFA enrolment with the
 * link's token, choosing a tenant, signing out. The real router and screens,
 * over a fetch stub that answers as the API's session routes do; every
 * request goes through the generated client.
 */
import { PRODUCT_NAME } from "@repo/config/product";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

const problem = (status: number, code: string, detail: string, headers: HeadersInit = {}) =>
  Response.json(
    { type: "about:blank", title: "Refused", status, code, detail },
    { status, headers },
  );

const user = { id: "u1", email: "analyst@example.com", name: "[Analyst]" };
const acme = { id: "11111111-1111-4111-8111-111111111111", name: "[Tenant one]" };
const other = { id: "22222222-2222-4222-8222-222222222222", name: "[Tenant two]" };
const signedIn = (activeTenantId: string | null, tenants = [acme]): SessionState => ({
  state: "SIGNED_IN",
  user,
  activeTenantId,
  tenants,
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

const typeInto = (label: string, value: string) => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
};

const requests = (method: string, path: string) =>
  fetchMock.mock.calls.filter(
    ([request]) => request.method === method && new URL(request.url).pathname === path,
  );

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  sessionStorage.clear();
});

describe("sign in", () => {
  it("sends a signed-out visitor to sign-in, and says plainly when the password is wrong", async () => {
    fakeApi({
      "GET /api/v1/session": () => Response.json({ state: "SIGNED_OUT" }),
      "POST /api/v1/session/sign-in": () =>
        problem(401, "INVALID_EMAIL_OR_PASSWORD", "Invalid email or password"),
    });
    const router = renderAt("/");
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeTruthy();
    expect(router.state.location.pathname).toBe("/sign-in");

    typeInto("Work email", "analyst@example.com");
    typeInto("Password", "[wrong]");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("That email address and password do not match an account.");
    expect(alert.textContent).toContain("Code: INVALID_EMAIL_OR_PASSWORD");
  });

  it("says when to try again after too many attempts", async () => {
    fakeApi({
      "GET /api/v1/session": () => Response.json({ state: "SIGNED_OUT" }),
      "POST /api/v1/session/sign-in": () =>
        problem(429, "RATE_LIMITED", "Too many requests.", { "retry-after": "40" }),
    });
    renderAt("/sign-in");
    await screen.findByRole("heading", { name: "Sign in" });
    typeInto("Work email", "analyst@example.com");
    typeInto("Password", "[password]");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Too many attempts. Try again in 40 seconds.",
    );
  });

  it("shows an unreachable server as a failure to retry, not as signed out", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    renderAt("/");
    expect(await screen.findByRole("heading", { name: "Cannot continue" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain(
      "Could not reach the server. Check your connection, then try again.",
    );
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Sign in" })).toBeNull();
  });
});

describe("the MFA challenge", () => {
  it("refuses a wrong code, then signs in, choosing the only tenant at once", async () => {
    let session: SessionState = { state: "SIGNED_OUT" };
    fakeApi({
      "GET /api/v1/session": () => Response.json(session),
      "POST /api/v1/session/sign-in": () => Response.json({ next: "MFA_CHALLENGE" }),
      "POST /api/v1/session/mfa/verify": (body) => {
        if (body["code"] !== "123456") return problem(401, "INVALID_CODE", "Invalid code");
        session = signedIn(null);
        return Response.json(session);
      },
      "POST /api/v1/session/tenant": (body) => {
        session = signedIn(String(body["tenantId"]));
        return Response.json(session);
      },
    });
    const router = renderAt("/sign-in");
    await screen.findByRole("heading", { name: "Sign in" });
    typeInto("Work email", user.email);
    typeInto("Password", "[password]");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      await screen.findByRole("heading", { name: "Enter your authentication code" }),
    ).toBeTruthy();
    typeInto("Six-digit code", "000000");
    fireEvent.click(screen.getByRole("button", { name: "Verify and sign in" }));
    expect((await screen.findByRole("alert")).textContent).toContain("That code was not accepted.");

    typeInto("Six-digit code", "123456");
    fireEvent.click(screen.getByRole("button", { name: "Verify and sign in" }));
    expect(await screen.findByText(acme.name)).toBeTruthy();
    // Who is signed in is in the account menu.
    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    expect(await screen.findByText(user.email)).toBeTruthy();
    expect(router.state.location.pathname).toBe("/");
    expect(requests("POST", "/api/v1/session/tenant")).toHaveLength(1);
  });

  it("accepts a backup code instead", async () => {
    const sent: Record<string, unknown>[] = [];
    fakeApi({
      "GET /api/v1/session": () => Response.json({ state: "SIGNED_OUT" }),
      "POST /api/v1/session/mfa/verify": (body) => {
        sent.push(body);
        return problem(401, "INVALID_BACKUP_CODE", "Invalid backup code");
      },
    });
    renderAt("/sign-in/verify");
    await screen.findByRole("heading", { name: "Enter your authentication code" });
    fireEvent.click(screen.getByRole("button", { name: "Use a backup code instead" }));
    typeInto("Backup code", "abcde-12345");
    fireEvent.click(screen.getByRole("button", { name: "Verify and sign in" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "That backup code is not right, or it has already been used.",
    );
    expect(sent).toEqual([{ method: "BACKUP_CODE", code: "abcde-12345" }]);
  });

  it("offers a fresh sign-in when the challenge has expired", async () => {
    fakeApi({
      "GET /api/v1/session": () => Response.json({ state: "SIGNED_OUT" }),
      "POST /api/v1/session/mfa/verify": () =>
        problem(401, "INVALID_TWO_FACTOR_COOKIE", "Invalid two factor cookie"),
    });
    renderAt("/sign-in/verify");
    await screen.findByRole("heading", { name: "Enter your authentication code" });
    typeInto("Six-digit code", "123456");
    fireEvent.click(screen.getByRole("button", { name: "Verify and sign in" }));
    expect((await screen.findByRole("alert")).textContent).toContain("This sign-in has expired.");
    expect(screen.getByRole("link", { name: "Sign in again" })).toBeTruthy();
  });
});

describe("MFA enrolment with the link's token", () => {
  it("takes the token from the link, shows the QR code, key and backup codes, then lets the person choose a tenant", async () => {
    let session: SessionState = { state: "MFA_ENROLMENT_REQUIRED", user };
    fakeApi({
      "GET /api/v1/session": () => Response.json(session),
      "POST /api/v1/session/mfa/enrolment": (body) => {
        expect(body).toEqual({ password: "[password]", enrolmentToken: "mfa_fromlink" });
        return Response.json({
          totpUri: "otpauth://totp/Test:analyst?secret=JBSWY3DPEHPK3PXP&issuer=Test",
          secret: "JBSWY3DPEHPK3PXP",
          backupCodes: ["aaaaa-11111", "bbbbb-22222"],
        });
      },
      "POST /api/v1/session/mfa/enrolment/confirm": (body) => {
        expect(body).toEqual({ code: "654321", enrolmentToken: "mfa_fromlink" });
        session = signedIn(null, [acme, other]);
        return Response.json(session);
      },
      "POST /api/v1/session/tenant": (body) => {
        session = signedIn(String(body["tenantId"]), [acme, other]);
        return Response.json(session);
      },
    });
    const router = renderAt("/enrol#token=mfa_fromlink");
    expect(
      await screen.findByRole("heading", { name: "Set up two-factor authentication" }),
    ).toBeTruthy();
    // The link's token is used, not asked for.
    expect(screen.getByText("Enrolment link received")).toBeTruthy();
    expect(screen.queryByLabelText("Enrolment token")).toBeNull();

    typeInto("Password", "[password]");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(
      await screen.findByRole("img", { name: "QR code for your authenticator app" }),
    ).toBeTruthy();
    expect(screen.getByText("JBSW Y3DP EHPK 3PXP")).toBeTruthy();
    expect(screen.getByText("aaaaa-11111")).toBeTruthy();
    expect(screen.getByText("bbbbb-22222")).toBeTruthy();

    typeInto("Six-digit code from your app", "654321");
    fireEvent.click(screen.getByRole("button", { name: "Confirm and finish" }));
    // Two tenants: the person chooses.
    expect(await screen.findByRole("heading", { name: "Choose an organisation" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: other.name }));
    expect(await screen.findByText(other.name)).toBeTruthy();
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/");
    });
    // The one-time token is not kept once used.
    expect(sessionStorage.length).toBe(0);
  });

  it("asks for the token when there is no link, and again when the one given is refused", async () => {
    fakeApi({
      "GET /api/v1/session": () => Response.json({ state: "MFA_ENROLMENT_REQUIRED", user }),
      "POST /api/v1/session/mfa/enrolment": () =>
        problem(403, "MFA_ENROLMENT_TOKEN_INVALID", "The enrolment token is not valid."),
    });
    renderAt("/enrol");
    await screen.findByRole("heading", { name: "Set up two-factor authentication" });
    typeInto("Enrolment token", "mfa_typed");
    typeInto("Password", "[password]");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "That enrolment token is not valid for this account, or it has expired.",
    );
    expect(screen.getByLabelText("Enrolment token")).toBeTruthy();
  });

  it("sends a signed-out visitor with a link to sign in first, keeping the token for afterwards", async () => {
    fakeApi({ "GET /api/v1/session": () => Response.json({ state: "SIGNED_OUT" }) });
    const router = renderAt("/enrol#token=mfa_kept");
    expect(
      await screen.findByText("Sign in to finish setting up two-factor authentication."),
    ).toBeTruthy();
    expect(router.state.location.pathname).toBe("/sign-in");
    expect(sessionStorage.getItem("mfa-enrolment-token")).toBe("mfa_kept");
  });
});

describe("signed in", () => {
  it("signs out, back to sign-in with a plain notice", async () => {
    let session: SessionState = signedIn(acme.id);
    fakeApi({
      "GET /api/v1/session": () => Response.json(session),
      "POST /api/v1/session/sign-out": () => {
        session = { state: "SIGNED_OUT" };
        return Response.json(session);
      },
      "GET /health": () => Response.json({ status: "ok" }),
    });
    renderAt("/");
    expect(await screen.findByText(acme.name)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    expect(await screen.findByText("You are signed out.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeTruthy();
  });
});

describe("the screen designs, with their copy corrected for what is true", () => {
  it("never tells the person an administrator can reset their second factor: none can", async () => {
    fakeApi({ "GET /api/v1/session": () => Response.json({ state: "SIGNED_OUT" }) });
    renderAt("/sign-in/verify");
    await screen.findByRole("heading", { name: "Enter your authentication code" });
    expect(document.body.textContent).toContain(
      "Lost your device? Sign in with one of the backup codes",
    );
    expect(document.body.textContent).not.toMatch(/reset your second factor/i);
    expect(screen.getByText("Step 2 of 2")).toBeTruthy();
  });

  it("puts saving the backup codes before the confirmation that leaves the page, and downloads them as a file", async () => {
    fakeApi({
      "GET /api/v1/session": () => Response.json({ state: "MFA_ENROLMENT_REQUIRED", user }),
      "POST /api/v1/session/mfa/enrolment": () =>
        Response.json({
          totpUri: "otpauth://totp/Test:analyst?secret=JBSWY3DPEHPK3PXP&issuer=Test",
          secret: "JBSWY3DPEHPK3PXP",
          backupCodes: ["aaaaa-11111", "bbbbb-22222"],
        }),
    });
    const saved: Blob[] = [];
    const createObjectURL = vi.fn((blob: Blob) => {
      saved.push(blob);
      return "blob:backup-codes";
    });
    // jsdom has no object URLs; the file's contents are what matter.
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = vi.fn();
    renderAt("/enrol#token=mfa_fromlink");
    await screen.findByRole("heading", { name: "Set up two-factor authentication" });
    expect(document.body.textContent).not.toMatch(/link verified|Invitation accepted/i);
    typeInto("Password", "[password]");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("img", { name: "QR code for your authenticator app" });

    const steps = screen
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent);
    expect(steps).toEqual([
      "Scan with your authenticator app",
      "Save your backup codes",
      "Confirm the code",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Download codes" }));
    expect(saved).toHaveLength(1);
    const text = await saved[0]?.text();
    expect(text).toContain("aaaaa-11111\nbbbbb-22222");
  });
});

describe("the signed-in frame", () => {
  it("shows the organisation's vetting status as the API states it, and switches theme from the account menu", async () => {
    fakeApi({
      "GET /api/v1/session": () => Response.json(signedIn(acme.id)),
      "GET /api/v1/me": () =>
        Response.json({
          authMethod: "SESSION",
          user: { id: user.id, email: user.email, displayName: null },
          apiKeyId: null,
          tenant: {
            id: acme.id,
            name: acme.name,
            plan: "TECHINT",
            vettingStatus: "NOT_SUBMITTED",
            planModules: ["TECHINT"],
          },
          permissions: ["run:read"],
        }),
      "GET /health": () => Response.json({ status: "ok" }),
    });
    renderAt("/");
    // Not "Verified tenant": that is said only when vetting is approved.
    expect(await screen.findByText("Vetting not submitted")).toBeTruthy();
    expect(screen.queryByText("Verified tenant")).toBeNull();
    expect(screen.getByRole("navigation", { name: "Main" }).textContent).toBe(
      `${PRODUCT_NAME}Search`,
    );

    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    fireEvent.click(await screen.findByRole("button", { name: "Use dark theme" }));
    expect(document.documentElement.dataset["theme"]).toBe("dark");
    expect(screen.getByRole("button", { name: "Use light theme" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use light theme" }));
    expect(document.documentElement.dataset["theme"]).toBe("light");
  });
});

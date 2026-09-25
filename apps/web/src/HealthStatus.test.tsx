import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HealthStatus } from "./HealthStatus.tsx";

// The generated client captures fetch when it is created, at import time, so
// the mock is installed before any import runs and re-programmed per test.
const fetchMock = vi.hoisted(() => {
  const mock = vi.fn<(request: Request) => Promise<Response>>();
  vi.stubGlobal("fetch", mock);
  return mock;
});

function stubFetch(implementation: (request: Request) => Promise<Response>): void {
  fetchMock.mockImplementation(implementation);
}

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
});

describe("HealthStatus", () => {
  it("renders the status the API reports, fetched from /health via the generated client", async () => {
    stubFetch(() => Promise.resolve(Response.json({ status: "ok" })));

    render(<HealthStatus />);

    expect(await screen.findByText("API health: ok")).toBeTruthy();
    const request = fetchMock.mock.calls[0]?.[0];
    expect(request && new URL(request.url).pathname).toBe("/health");
  });

  it("shows an HTTP failure as unreachable, never as ok", async () => {
    stubFetch(() => Promise.resolve(new Response("upstream down", { status: 503 })));

    render(<HealthStatus />);

    expect(await screen.findByText("API health: unreachable (HTTP 503)")).toBeTruthy();
    expect(screen.queryByText(/API health: ok/)).toBeNull();
  });

  it("shows a network failure as unreachable, never as ok", async () => {
    stubFetch(() => Promise.reject(new TypeError("Failed to fetch")));

    render(<HealthStatus />);

    expect(await screen.findByText("API health: unreachable (Failed to fetch)")).toBeTruthy();
  });

  it("shows checking, not a result, before the API answers", () => {
    stubFetch(() => new Promise<Response>(() => undefined));

    render(<HealthStatus />);

    expect(screen.getByRole("status").textContent).toBe("API health: checking…");
  });
});

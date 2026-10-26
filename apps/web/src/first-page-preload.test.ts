/**
 * A first load asks for the page's code while the guard is still reading the
 * session (router.tsx, preloadFirstPage), so the two wait side by side, not one
 * after the other. Without it, the router asks for the code only once every
 * guard has passed.
 */
import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory } from "@tanstack/react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppRouter, preloadFirstPage } from "./router.tsx";

// The generated client captures fetch when it is created, at import time.
const fetchMock = vi.hoisted(() => {
  const mock = vi.fn<(request: Request) => Promise<Response>>();
  vi.stubGlobal("fetch", mock);
  return mock;
});

// Records when the Members screen's code is asked for, as a download would start.
const asked = vi.hoisted(() => ({ members: false }));
vi.mock("./screens/Members.tsx", () => {
  asked.members = true;
  return { MembersScreen: () => null };
});

afterEach(() => {
  fetchMock.mockReset();
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 50));

describe("the first page's download", () => {
  it("starts while the session is still being read, not after the guard has passed", async () => {
    // The session read never answers during this test: the guard stays waiting.
    fetchMock.mockImplementation(() => new Promise<Response>(() => undefined));
    const router = createAppRouter(
      new QueryClient({ defaultOptions: { queries: { retry: false } } }),
      createMemoryHistory({ initialEntries: ["/members"] }),
    );
    void router.load();
    await tick();
    // The guard is waiting on the session, so the router has not asked for the code.
    expect(fetchMock).toHaveBeenCalled();
    expect(asked.members).toBe(false);

    preloadFirstPage(router);
    await vi.waitFor(() => {
      expect(asked.members).toBe(true);
    });
  });
});

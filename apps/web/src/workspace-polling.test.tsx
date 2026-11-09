/**
 * The results workspace re-reads while a run is still collecting, and stops
 * once it settles. Before this, run/timeline/entity reads were fetched once and
 * went stale: a run that finished after the page opened kept showing the
 * "still collecting" banner and empty tabs until a manual refresh.
 *
 * The pure polling conditions are unit-tested (robust, no timers); one
 * integration test drives the real router and screens over the fetch stub with
 * fake timers, so the actual re-reads and their stop at settle are observed.
 */
import { act, cleanup, renderHook, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  runQuery,
  useScopePollInterval,
  WORKSPACE_POLL_MS,
  type RunRead,
  type Scope,
} from "./workspace/queries.ts";
import { CASE_ID, renderAt, RUN, RUN_ID, workspaceApi } from "./workspace/test-fixtures.tsx";

// The generated client captures fetch when it is created, at import time.
const fetchMock = vi.hoisted(() => {
  const mock = vi.fn<(request: Request) => Promise<Response>>();
  vi.stubGlobal("fetch", mock);
  return mock;
});

const { fakeApi, requestsTo } = workspaceApi(fetchMock);

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  vi.useRealTimers();
});

/** The run fixture, forced to a given settled state (unsettled runs have no finish time). */
const runWith = (settled: boolean): RunRead =>
  ({
    ...RUN,
    status: settled ? "PARTIAL" : "RUNNING",
    settled,
    finishedAt: settled ? RUN.finishedAt : null,
  }) as RunRead;

describe("runQuery polling condition", () => {
  // The refetchInterval function, as React Query will call it with the query's state.
  const interval = runQuery(RUN_ID).refetchInterval as (query: {
    state: { status: string; data: RunRead | undefined };
  }) => number | false;
  const at = (status: string, data: RunRead | undefined) => interval({ state: { status, data } });

  it("polls while a successful read is still collecting", () => {
    expect(at("success", runWith(false))).toBe(WORKSPACE_POLL_MS);
  });

  it("stops once the run is settled", () => {
    expect(at("success", runWith(true))).toBe(false);
  });

  it("does not poll through an error, nor before the first read", () => {
    // A failed read keeps the last data, whose settled flag would never clear.
    expect(at("error", runWith(false))).toBe(false);
    expect(at("success", undefined)).toBe(false);
  });
});

describe("useScopePollInterval", () => {
  // The run read is seeded before the hook mounts, so staleTime keeps it and no
  // request is made: the hook's answer is read straight from the given run.
  function harness(scope: Scope, run?: RunRead) {
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY, retry: false } },
    });
    if (run !== undefined) client.setQueryData(["run", RUN_ID], run);
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    return renderHook(() => useScopePollInterval(scope), { wrapper });
  }

  it("polls while an unsettled run collects", () => {
    const { result } = harness({ kind: "run", id: RUN_ID }, runWith(false));
    expect(result.current).toBe(WORKSPACE_POLL_MS);
  });

  it("does not poll a settled run", () => {
    const { result } = harness({ kind: "run", id: RUN_ID }, runWith(true));
    expect(result.current).toBe(false);
  });

  it("never polls a case, which only shows what is pinned to it", () => {
    const { result } = harness({ kind: "case", id: CASE_ID }, runWith(false));
    expect(result.current).toBe(false);
  });
});

describe("the results workspace while a run is still collecting", () => {
  const flush = async (ms: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };
  const timelineReads = () => requestsTo("GET", "/api/v1/timeline").length;
  const runReads = () => requestsTo("GET", `/api/v1/runs/${RUN_ID}`).length;

  it("re-reads the timeline while unsettled, then stops once the run settles", async () => {
    // Only the timer functions React Query polls on are faked; Date stays real.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    let settled = false;
    fakeApi({
      [`GET /api/v1/runs/${RUN_ID}`]: () => Response.json(runWith(settled)),
    });
    renderAt(`/runs/${RUN_ID}/timeline`);

    // Initial reads, and the banner that says the run is still collecting.
    await flush(0);
    expect(timelineReads()).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/still collecting/i)).toBeTruthy();
    const timelineAfterLoad = timelineReads();
    const runAfterLoad = runReads();

    // One interval while unsettled: the run and the timeline are both read again.
    await flush(WORKSPACE_POLL_MS);
    expect(runReads()).toBeGreaterThan(runAfterLoad);
    expect(timelineReads()).toBeGreaterThan(timelineAfterLoad);

    // The run settles; give it a couple of intervals to be observed and to run
    // the one final read of every tab, then let the counts settle.
    settled = true;
    await flush(WORKSPACE_POLL_MS * 2);
    const timelineAtSettle = timelineReads();
    const runAtSettle = runReads();

    // Further intervals: polling has stopped, so neither is read again.
    await flush(WORKSPACE_POLL_MS * 3);
    expect(timelineReads()).toBe(timelineAtSettle);
    expect(runReads()).toBe(runAtSettle);
  });
});

/**
 * Step 3 of the web flow: a run's live progress. The real router and screen,
 * over a fetch stub whose progress stream the test writes event by event,
 * exactly as the API sends them (`event:` and `data:` lines).
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionState } from "./api.ts";
import { createAppRouter } from "./router.tsx";
import type { JobData, LockedEventData, RunData } from "./run/progress.ts";

// The generated client captures fetch when it is created, at import time.
const fetchMock = vi.hoisted(() => {
  const mock = vi.fn<(request: Request) => Promise<Response>>();
  vi.stubGlobal("fetch", mock);
  return mock;
});

const RUN_ID = "44444444-4444-4444-8444-444444444444";
const EVENTS = `/api/v1/runs/${RUN_ID}/events`;

const tenant = { id: "11111111-1111-4111-8111-111111111111", name: "[Tenant one]" };
const session: SessionState = {
  state: "SIGNED_IN",
  user: { id: "u1", email: "analyst@example.com", name: "[Analyst]" },
  activeTenantId: tenant.id,
  tenants: [tenant],
};

/** A progress stream the test writes to, one event at a time. */
function progressStream() {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(started) {
      controller = started;
    },
  });
  const encoder = new TextEncoder();
  const write = (text: string) => {
    if (controller === undefined) throw new TypeError("the stream has not started");
    controller.enqueue(encoder.encode(text));
  };
  return {
    response: () => new Response(body, { headers: { "content-type": "text/event-stream" } }),
    send: (event: string, data: unknown) => {
      write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    write,
    close: () => controller?.close(),
  };
}

/** Answers the session, and each request for the stream with the next response given. */
function fakeApi(streams: (() => Response)[]): void {
  fetchMock.mockImplementation((request) => {
    const path = new URL(request.url).pathname;
    if (request.method === "GET" && path === "/api/v1/session") {
      return Promise.resolve(Response.json(session));
    }
    if (request.method === "GET" && path === EVENTS) {
      const next = streams.shift();
      if (next !== undefined) return Promise.resolve(next());
    }
    return Promise.resolve(
      Response.json(
        { type: "about:blank", title: "Not Found", status: 404, code: "UNEXPECTED", detail: path },
        { status: 404 },
      ),
    );
  });
}

const streamRequests = () =>
  fetchMock.mock.calls.filter(([request]) => new URL(request.url).pathname === EVENTS);

function renderRun() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createAppRouter(
    queryClient,
    createMemoryHistory({ initialEntries: [`/runs/${RUN_ID}`] }),
  );
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const run = (overrides: Partial<RunData> = {}): RunData => ({
  id: RUN_ID,
  investigationId: "33333333-3333-4333-8333-333333333333",
  status: "RUNNING",
  plan: {
    input: "example.org",
    requestedType: null,
    detected: { primaryType: "DOMAIN", alternateTypes: [] },
    targets: [{ type: "DOMAIN", value: "example.org" }],
    jobs: [],
    excluded: [
      {
        collectorId: "unlicensed-source",
        targetType: "DOMAIN",
        reason: "LICENCE_BLOCKED",
        message: "[why its licence blocks it]",
      },
      {
        collectorId: "phone-source",
        targetType: null,
        reason: "TARGET_TYPE_NOT_ACCEPTED",
        message: "[the types it accepts]",
      },
    ],
  },
  createdAt: "2026-01-01T00:00:00.000Z",
  startedAt: "2026-01-01T00:00:01.000Z",
  finishedAt: null,
  settled: false,
  counts: {},
  ...overrides,
});

let nextJob = 0;
const job = (overrides: Partial<JobData> = {}): JobData => {
  nextJob += 1;
  return {
    id: `55555555-5555-4555-8555-${String(nextJob).padStart(12, "0")}`,
    collectorId: `[collector ${String(nextJob)}]`,
    sourceLabel: `[Source ${String(nextJob)}]`,
    status: "QUEUED",
    outcome: null,
    outcomeDetail: null,
    error: null,
    attempts: 0,
    nextAttemptAt: null,
    deadLetteredAt: null,
    startedAt: null,
    finishedAt: null,
    fusedAt: null,
    evidenceIds: [],
    ...overrides,
  };
};

/** The row for a source, by its label. */
const rowOf = (label: string): HTMLElement => {
  const row = screen.getByText(label).closest("li");
  if (row === null) throw new TypeError(`no row for ${label}`);
  return row;
};

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
});

describe("the run view", () => {
  it("shows each source as its events arrive, with what it found or why not, then the settled run", async () => {
    const stream = progressStream();
    fakeApi([stream.response]);
    renderRun();
    expect(await screen.findByLabelText("Connecting to the run")).toBeTruthy();

    const found = job({ sourceLabel: "[Found source]" });
    const nothing = job({ sourceLabel: "[Empty source]", status: "RUNNING", attempts: 1 });
    const failing = job({ sourceLabel: "[Failing source]", status: "RUNNING", attempts: 1 });
    const keyed = job({ sourceLabel: "[Keyed source]" });
    const retrying = job({ sourceLabel: "[Retrying source]" });
    stream.send("run", run());
    for (const entry of [found, nothing, failing, keyed, retrying]) stream.send("job", entry);

    expect(await screen.findByText("Running.")).toBeTruthy();
    expect(screen.getByText("Live: this page updates as each source finishes.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Sources: 0 of 5 finished" })).toBeTruthy();
    expect(rowOf("[Found source]").textContent).toBe("Queued[Found source]Waiting for a worker.");
    expect(rowOf("[Empty source]").textContent).toBe("Running[Empty source]Collecting.");

    const evidence = [
      "66666666-6666-4666-8666-000000000001",
      "66666666-6666-4666-8666-000000000002",
    ];
    stream.send("job", {
      ...found,
      status: "SUCCEEDED",
      outcome: "FOUND",
      evidenceIds: evidence,
      fusedAt: "2026-01-01T00:00:05.000Z",
    });
    stream.send("job", {
      ...nothing,
      status: "SUCCEEDED",
      outcome: "NOT_FOUND",
      outcomeDetail: "[what was not found]",
    });
    stream.send("job", {
      ...failing,
      status: "DEAD_LETTERED",
      outcome: "FAILED",
      attempts: 3,
      error: { code: "UPSTREAM_TIMEOUT", message: "[why it timed out]" },
      deadLetteredAt: "2026-01-01T00:00:09.000Z",
    });
    stream.send("job", {
      ...keyed,
      status: "FAILED",
      outcome: "NEEDS_CREDENTIALS",
      attempts: 1,
      error: { code: "NEEDS_CREDENTIALS", message: "[which key is missing]" },
    });
    stream.send("job", {
      ...retrying,
      attempts: 1,
      error: { code: "UPSTREAM_RATE_LIMITED", message: "[rate limited]" },
      nextAttemptAt: "2026-01-01T00:01:00.000Z",
    });

    await screen.findByRole("heading", { name: "Sources: 4 of 5 finished" });
    expect(rowOf("[Found source]").textContent).toBe("Ran[Found source]Found 2 evidence records.");
    // Found nothing and failed look obviously different: the word, and the reason.
    expect(rowOf("[Empty source]").textContent).toBe(
      "Ran[Empty source]Found nothing: [what was not found]",
    );
    const failed = rowOf("[Failing source]").textContent;
    expect(failed).toContain("Failed[Failing source][why it timed out] Code: UPSTREAM_TIMEOUT.");
    expect(failed).toContain("Gave up after 3 attempts at");
    expect(failed).toContain("kept in the dead-letter queue for review.");
    expect(rowOf("[Keyed source]").textContent).toBe(
      "Needs key[Keyed source][which key is missing] Code: NEEDS_CREDENTIALS.",
    );
    const queued = rowOf("[Retrying source]").textContent;
    expect(queued).toContain("Queued[Retrying source][rate limited] Code: UPSTREAM_RATE_LIMITED.");
    expect(queued).toContain("Next attempt at");
    expect(queued).toContain("(after 1 attempt).");

    // Left out by the plan: by id and status; a source that does not take the type is not listed.
    const notRun = screen.getByRole("heading", { name: "Not run (1)" }).closest("section");
    expect(notRun?.textContent).toBe(
      "Not run (1)Heldunlicensed-source[why its licence blocks it]LICENCE_BLOCKED",
    );

    stream.send(
      "run",
      run({ status: "PARTIAL", finishedAt: "2026-01-01T00:02:00.000Z", settled: true }),
    );
    stream.send("end", { status: "PARTIAL" });
    expect(
      await screen.findByText(
        "Partial: some sources failed. Each failure is listed with its reason.",
      ),
    ).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByText("Live: this page updates as each source finishes.")).toBeNull();
    });
    expect(screen.queryByRole("button", { name: "Reconnect" })).toBeNull();
    expect(streamRequests()).toHaveLength(1);
  });

  it("shows both costs as an em dash with why, never a number", async () => {
    const stream = progressStream();
    fakeApi([stream.response]);
    renderRun();
    stream.send("run", run());
    stream.send("end", { status: "RUNNING" });
    const cost = (await screen.findByRole("heading", { name: "Cost" })).closest("section");
    if (cost === null) throw new TypeError("no cost panel");
    const dashes = within(cost).getAllByRole("button", { name: /^Not measured\./ });
    expect(dashes.map((dash) => dash.textContent)).toEqual(["—", "—"]);
    expect(cost.textContent).toContain("per-run cost metering is not built yet");
    expect(cost.textContent).not.toMatch(/\d/);
  });

  it("reconnects at once when the stream reaches its maximum length", async () => {
    const first = progressStream();
    const second = progressStream();
    fakeApi([first.response, second.response]);
    renderRun();
    first.send("run", run());
    await screen.findByText("Running.");
    first.send("timeout", { reconnect: true });
    await waitFor(() => {
      expect(streamRequests()).toHaveLength(2);
    });
    second.send(
      "run",
      run({ status: "SUCCEEDED", settled: true, finishedAt: "2026-01-01T00:02:00.000Z" }),
    );
    second.send("end", { status: "SUCCEEDED" });
    expect(await screen.findByText("Finished: every source ran.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("when the stream fails, says so, keeps what it had as of its last update, and reconnects on request", async () => {
    const first = progressStream();
    const second = progressStream();
    fakeApi([first.response, second.response]);
    renderRun();
    first.send("run", run());
    first.send("job", job({ sourceLabel: "[Kept source]" }));
    first.send("error", { code: "STREAM_FAILED" });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Live updates stopped.");
    expect(alert.textContent).toContain("Code: STREAM_FAILED");
    expect(
      screen.getByText(/The run goes on without this page\. What is shown below is as of/),
    ).toBeTruthy();
    expect(screen.getByText("[Kept source]")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    second.send(
      "run",
      run({ status: "SUCCEEDED", settled: true, finishedAt: "2026-01-01T00:02:00.000Z" }),
    );
    second.send("end", { status: "SUCCEEDED" });
    expect(await screen.findByText("Finished: every source ran.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(streamRequests()).toHaveLength(2);
  });

  it("treats a stream that closes before the run ends, or sends malformed data, as stopped, never as finished", async () => {
    const closing = progressStream();
    const malformed = progressStream();
    fakeApi([closing.response, malformed.response]);
    renderRun();
    closing.send("run", run());
    closing.close();
    expect((await screen.findByRole("alert")).textContent).toContain("Code: STREAM_CLOSED");

    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    await waitFor(() => {
      expect(streamRequests()).toHaveLength(2);
    });
    malformed.write("event: job\ndata: {not json\n\n");
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("Code: STREAM_PROTOCOL");
    });
    expect(screen.getByText("Running.")).toBeTruthy();
  });

  it("closes on a locked event: the Locked state when person data is the reason, the plain reason otherwise, and no reconnect", async () => {
    const person = progressStream();
    fakeApi([person.response]);
    renderRun();
    const lockedBlock = {
      module: "PERSON_INVESTIGATION",
      moduleSummary: "[what the module does]",
      withheld: "[what was withheld]",
      reason: "MODULE_NOT_IN_PLAN",
      plan: "[plan]",
      vettingStatus: "[vetting status]",
      nextStep: "[the next step]",
    };
    const lockedEvent = (overrides: Partial<LockedEventData>) => ({
      reason: "MODULE_NOT_IN_PLAN",
      code: "MODULE_NOT_IN_PLAN",
      detail: "[why access is refused]",
      locked: lockedBlock,
      recheckIntervalMs: 1000,
      checkedAt: "2026-01-01T00:00:10.000Z",
      ...overrides,
    });
    person.send("run", run());
    person.send("locked", lockedEvent({}));
    const nextStep = await screen.findByText("[the next step]");
    expect(nextStep.parentElement?.textContent).toContain("Locked");
    expect(nextStep.parentElement?.textContent).toContain("[what the module does]");
    expect(screen.queryByRole("button", { name: "Reconnect" })).toBeNull();
    cleanup();

    const revoked = progressStream();
    fakeApi([revoked.response]);
    renderRun();
    revoked.send("run", run());
    revoked.send(
      "locked",
      lockedEvent({ reason: "MEMBERSHIP_REVOKED", code: "NOT_A_MEMBER", locked: null }),
    );
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "Updates stopped: access to this run is no longer allowed.",
    );
    expect(alert.textContent).toContain("[why access is refused]");
    expect(alert.textContent).toContain("Code: NOT_A_MEMBER");
    expect(screen.queryByRole("button", { name: "Reconnect" })).toBeNull();
  });

  it("shows a refused connection plainly: the Locked state for person data, the reason otherwise", async () => {
    const locked = {
      module: "PERSON_INVESTIGATION",
      moduleSummary: "[what the module does]",
      withheld: "[what was withheld]",
      reason: "VETTING_NOT_APPROVED",
      plan: "[plan]",
      vettingStatus: "[vetting status]",
      nextStep: "[the next step]",
    };
    fakeApi([
      () =>
        Response.json(
          {
            type: "about:blank",
            title: "Refused",
            status: 403,
            code: "VETTING_NOT_APPROVED",
            detail: "[detail]",
            locked,
          },
          { status: 403 },
        ),
    ]);
    renderRun();
    expect(await screen.findByText("[the next step]")).toBeTruthy();
    cleanup();

    fakeApi([]);
    renderRun();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Code: UNEXPECTED");
    expect(screen.getByText(/Nothing had been received yet\./)).toBeTruthy();
  });

  it("says when the run no longer exists", async () => {
    const stream = progressStream();
    fakeApi([stream.response]);
    renderRun();
    stream.send("end", { status: null });
    expect(
      await screen.findByText("This run no longer exists, so there is nothing more to show."),
    ).toBeTruthy();
  });
});

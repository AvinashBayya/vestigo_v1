/**
 * Step 3 of the web flow: a run's live progress. The real router and screen,
 * over a fetch stub whose progress stream the test writes event by event,
 * exactly as the API sends them (`event:` and `data:` lines).
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { LOCK_REASON_TITLE } from "@repo/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionState } from "./api.ts";
import { createAppRouter } from "./router.tsx";
// Every screen the router loads on demand, loaded with this file (see test-screens.ts).
import "./test-screens.ts";
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

/** The collector list: the plan's left-out sources are in it; the test jobs' collectors are not. */
const COLLECTORS = {
  unverifiedSourcesAllowed: false,
  accessMethodsEnabled: ["open", "official", "licensed"],
  sources: [],
  items: [
    {
      id: "unlicensed-source",
      label: "[Unlicensed source]",
      discipline: "TECHINT",
      targetTypes: ["DOMAIN"],
    },
    {
      id: "phone-source",
      label: "[Phone source]",
      discipline: "PERSON",
      targetTypes: ["PHONE_NUMBER"],
    },
  ].map((entry) => ({
    ...entry,
    version: "1.0.0",
    collectionMode: "PASSIVE_API",
    claimStrength: "REPORTED",
    credentials: { vaultIds: [], runsWithout: true },
    availability: "AVAILABLE",
    availabilityReason: null,
    sourceId: `[source of ${entry.id}]`,
    access: {
      methods: [{ kind: "open", enabled: true, licenceVerdict: "PERMITTED", runnable: true }],
      runsVia: ["open"],
      refusal: null,
      reason: null,
    },
  })),
};

const ME = {
  authMethod: "SESSION",
  user: { id: "u1", email: "analyst@example.com", displayName: null },
  apiKeyId: null,
  tenant: {
    id: tenant.id,
    name: tenant.name,
    plan: "TECHINT",
    vettingStatus: "NOT_SUBMITTED",
    planModules: ["TECHINT"],
  },
  permissions: ["run:read"],
};

/** Answers the session, the collector list and /me, and each stream request with the next response given. */
function fakeApi(streams: (() => Response | Promise<Response>)[], me: unknown = ME): void {
  fetchMock.mockImplementation((request) => {
    const path = new URL(request.url).pathname;
    if (request.method === "GET" && path === "/api/v1/session") {
      return Promise.resolve(Response.json(session));
    }
    if (request.method === "GET" && path === "/api/v1/collectors") {
      return Promise.resolve(Response.json(COLLECTORS));
    }
    if (request.method === "GET" && path === "/api/v1/me") {
      return Promise.resolve(Response.json(me));
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
    // A designed loading state (§8 Loading) appears before any event.
    const connecting = await screen.findByText("Connecting to the run.");
    expect(connecting.getAttribute("role")).toBe("status");
    expect(connecting.closest('[aria-busy="true"]')).not.toBeNull();

    const found = job({ sourceLabel: "[Found source]" });
    const nothing = job({ sourceLabel: "[Empty source]", status: "RUNNING", attempts: 1 });
    const failing = job({ sourceLabel: "[Failing source]", status: "RUNNING", attempts: 1 });
    const keyed = job({ sourceLabel: "[Keyed source]" });
    const retrying = job({ sourceLabel: "[Retrying source]" });
    stream.send("run", run());
    for (const entry of [found, nothing, failing, keyed, retrying]) stream.send("job", entry);

    expect(await screen.findByText("Running.")).toBeTruthy();
    expect(screen.getByText("Live: this page updates as each source finishes.")).toBeTruthy();
    expect(screen.getByText(/0 of 5 collectors settled · elapsed /)).toBeTruthy();
    expect(screen.getByText("3 queued")).toBeTruthy();
    expect(screen.getByText("2 running")).toBeTruthy();
    expect(screen.getByText("2 not run")).toBeTruthy();
    // A status no job has is never a "0" chip.
    expect(
      screen.queryByText(
        /^0 (ran|found nothing|running|queued|failed|need a key|skipped|cancelled|locked|not run)$/,
      ),
    ).toBeNull();
    expect(rowOf("[Found source]").textContent).toBe("[Found source]waiting for a workerQueued");
    expect(rowOf("[Empty source]").textContent).toBe("[Empty source]collectingRunning");
    // No job reports its progress, so a running row has no bar (a guessed width is fabricated).
    expect(document.querySelector("progress")).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();

    const evidence = [
      "66666666-6666-4666-8666-000000000001",
      "66666666-6666-4666-8666-000000000002",
    ];
    stream.send("job", {
      ...found,
      status: "SUCCEEDED",
      outcome: "FOUND",
      evidenceIds: evidence,
      startedAt: "2026-01-01T00:00:01.000Z",
      finishedAt: "2026-01-01T00:00:01.900Z",
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

    await screen.findByText(/4 of 5 collectors settled/);
    // What it found, with how long it took (measured from its own start and finish).
    expect(rowOf("[Found source]").textContent).toBe("[Found source]2 evidence records · 0.9sRan");
    // Found nothing and failed look obviously different: the word, the reason, the tint.
    // D7: a source that ran and found nothing says so in its chip, with the API's detail.
    const empty = rowOf("[Empty source]");
    expect(empty.textContent).toBe("[Empty source][what was not found]Found nothing");
    expect(empty.className).not.toContain("failed");
    const failed = rowOf("[Failing source]");
    expect(failed.className).toContain("bg-status-failed-tint");
    expect(failed.textContent).toContain(
      "[Failing source]UPSTREAM_TIMEOUT · [why it timed out] · gave up after 3 attempts · dead-lettered ",
    );
    // The count chips use the rows' words: found nothing is counted apart from ran.
    expect(screen.getByText("1 ran")).toBeTruthy();
    expect(screen.getByText("1 found nothing")).toBeTruthy();
    expect(screen.getByText("1 failed")).toBeTruthy();
    expect(screen.getByText("1 need a key")).toBeTruthy();
    expect(failed.textContent).toMatch(/, kept for reviewFailed$/);
    expect(rowOf("[Keyed source]").textContent).toBe(
      "[Keyed source]NEEDS_CREDENTIALS: [which key is missing]Needs key",
    );
    const queued = rowOf("[Retrying source]").textContent;
    expect(queued).toContain(
      "[Retrying source]UPSTREAM_RATE_LIMITED: [rate limited] · next attempt ",
    );
    expect(queued).toMatch(/\(after 1 attempt\)Queued$/);

    // Left out by the plan: labelled from the collector list, with its status and the API's reason.
    expect(rowOf("[Unlicensed source]").textContent).toBe(
      "[Unlicensed source]TECHINT · [why its licence blocks it]Held",
    );
    // One that does not take this kind of target says so in type words, never the API's type codes.
    expect(rowOf("[Phone source]").textContent).toBe(
      "[Phone source]Person · Does not apply to a domain target: it takes a phone number.Skipped",
    );
    expect(document.body.textContent).not.toMatch(/PHONE_NUMBER|TARGET_TYPE_NOT_ACCEPTED/);

    // Arriving now: counted from the run; what a source that did not complete would have found is unmeasured.
    const arriving = screen.getByRole("heading", { name: "Arriving now" }).closest("section");
    if (arriving === null) throw new TypeError("no panel");
    expect(within(arriving).getByText("Evidence records").parentElement?.textContent).toBe(
      "Evidence records2",
    );
    // Every card heading sits directly under the page's h1: no h3 without an h2.
    for (const name of ["Collectors", "Arriving now", "Cost", "Run settings"]) {
      expect(screen.getByRole("heading", { name, level: 2 }), name).toBeTruthy();
    }
    const fromFailing = within(arriving).getByText("From [Failing source]").parentElement;
    expect(fromFailing?.textContent).toContain("—");
    expect(fromFailing?.textContent).toContain("Not measured — [Failing source] did not complete");
    expect(fromFailing?.textContent).not.toMatch(/\d/);
    // The stream does not count claims, so the claims row is an em dash with why.
    expect(within(arriving).getByText("Claims").parentElement?.textContent).toBe(
      "Claims—Not measured — the progress stream does not count claimsNot measured — the progress stream does not count claims",
    );

    // Settings, each from what the API states.
    const settings = screen.getByRole("heading", { name: "Run settings" }).closest("section");
    if (settings === null) throw new TypeError("no panel");
    // The plan and vetting as /me states them, never a verdict computed here (CLAUDE.md §6, §9).
    expect(within(settings).getByText("Person modules").parentElement?.textContent).toBe(
      "Person modulesPlan: TECHINT · Vetting: not submitted",
    );
    // The test jobs' collectors are not in the list, so the mode is not asserted.
    expect(
      within(settings).getByRole("button", { name: /^Not measured\. The collector list/ }),
    ).toBeTruthy();
    // No run records its model, so the row is an em dash with why in words, never a provider's name.
    const model = within(settings).getByText("Model").parentElement;
    expect(model?.textContent).toMatch(
      /^Model—Not measured — the run does not record a model[^—]*Not measured — the run does not record a model/,
    );
    expect(
      within(settings).getByText(/^Not measured — the run does not record a model/, {
        selector: "span[aria-hidden='true']",
      }),
    ).toBeTruthy();
    expect(document.body.textContent).not.toMatch(
      /Recording to case|In-region|Open case|Pause run/,
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
    // The header carries the run's own status: a run's PARTIAL, never a collector's "Partial".
    const header = screen.getByRole("banner");
    expect(within(header).getByText("PARTIAL")).toBeTruthy();
    expect(within(header).queryByText("Partial")).toBeNull();
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
    // Exactly two values, both em dashes, each with its reason in words.
    expect(within(cost).getAllByText("—")).toHaveLength(2);
    expect(within(cost).getAllByRole("definition")).toHaveLength(2);
    for (const label of ["Estimated before run", "Spent so far"]) {
      const row = within(cost).getByText(label).parentElement;
      expect(row?.textContent, label).toMatch(/^[^—]+—Not measured — [^—]+/);
    }
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

  it("closes on a locked event: the Locked state for every reason, never a failure, and no reconnect", async () => {
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
    const personNotice = nextStep.closest('[role="status"]');
    expect(personNotice?.textContent).toContain("Locked");
    expect(personNotice?.textContent).toContain("[what the module does]");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Reconnect" })).toBeNull();
    cleanup();

    // The reader's own access ended: the Locked state with the API's reason and
    // an action this app can take, never a failure or a connection error.
    const accessCases = [
      {
        reason: "CREDENTIAL_REVOKED",
        code: "UNAUTHENTICATED",
        next: "Sign in again to keep following this run.",
        href: "/sign-in",
      },
      {
        reason: "MEMBERSHIP_REVOKED",
        code: "NOT_A_MEMBER",
        next: "Choose an organisation you still belong to.",
        href: "/tenant",
      },
      {
        reason: "PERMISSION_LOST",
        code: "PERMISSION_DENIED",
        next: "Ask an owner or administrator of this organisation to give your role permission to read runs.",
        href: null,
      },
    ] as const;
    for (const { reason, code, next, href } of accessCases) {
      cleanup();
      const revoked = progressStream();
      fakeApi([revoked.response]);
      renderRun();
      revoked.send("run", run());
      revoked.send("job", job({ sourceLabel: "[Read before the lock]" }));
      await screen.findByText("[Read before the lock]");
      revoked.send("locked", lockedEvent({ reason, code, locked: null }));
      const step = await screen.findByText(next);
      const notice = step.closest("[role]");
      expect(notice?.getAttribute("role"), reason).toBe("status");
      expect(notice?.textContent).toContain("Locked");
      expect(notice?.textContent).toContain("Live updates for this run are withheld.");
      // When the refusing check ran: the exact instant, shown in the reader's local time.
      expect(
        notice?.querySelector('time[datetime="2026-01-01T00:00:10.000Z"]'),
        reason,
      ).not.toBeNull();
      // The access that read the rows is gone, so nothing read before the lock stays on screen.
      expect(screen.queryByText("[Read before the lock]"), reason).toBeNull();
      expect(screen.queryByRole("heading", { name: "Arriving now" }), reason).toBeNull();
      expect(notice?.textContent).toContain("[why access is refused]");
      // The reason in words and the code, each once.
      expect(notice?.textContent).toContain(LOCK_REASON_TITLE[reason]);
      expect(notice?.textContent.split(code)).toHaveLength(2);
      expect(within(notice as HTMLElement).getByText(code).className).toContain("font-mono");
      // Behind a lock, "View results" would only lead to the same refusal.
      expect(screen.queryByRole("link", { name: "View results" }), reason).toBeNull();
      expect(step.closest("a")?.getAttribute("href") ?? null, reason).toBe(href);
      expect(screen.queryByRole("alert"), reason).toBeNull();
      expect(screen.queryByRole("button", { name: "Reconnect" })).toBeNull();
    }
  });

  it("on a person-data lock, withholds every collector row and every count, whole, and shows the Locked state in their place", async () => {
    const stream = progressStream();
    fakeApi([stream.response]);
    renderRun();
    const evidence = ["66666666-6666-4666-8666-000000000001"];
    const finished = {
      status: "SUCCEEDED",
      outcome: "FOUND",
      attempts: 1,
      evidenceIds: evidence,
      fusedAt: "2026-01-01T00:00:05.000Z",
    } as const;
    stream.send("run", run());
    // Whatever each collector is, the whole read is refused (CLAUDE.md §9): no row is kept.
    stream.send(
      "job",
      job({ collectorId: "unlicensed-source", sourceLabel: "[Kept]", ...finished }),
    );
    stream.send("job", job({ collectorId: "phone-source", sourceLabel: "[Person]", ...finished }));
    stream.send("job", job({ sourceLabel: "[Unlisted]", ...finished }));
    await screen.findByText("[Unlisted]");
    // Before the lock every count is measured.
    const arriving = screen.getByRole("heading", { name: "Arriving now" }).closest("section");
    if (arriving === null) throw new TypeError("no panel");
    await waitFor(() => {
      expect(within(arriving).getByText("Evidence records").parentElement?.textContent).toBe(
        "Evidence records3",
      );
    });

    stream.send("locked", {
      reason: "VETTING_NOT_APPROVED",
      code: "VETTING_NOT_APPROVED",
      detail: "[why access is refused]",
      locked: {
        module: "PERSON_INVESTIGATION",
        moduleSummary: "[what the module does]",
        withheld: "[what was withheld]",
        reason: "VETTING_NOT_APPROVED",
        plan: "TECHINT",
        vettingStatus: "PENDING",
        nextStep: "[the next step]",
      },
      recheckIntervalMs: 1000,
      checkedAt: "2026-01-01T00:00:10.000Z",
    });
    const nextStep = await screen.findByText("[the next step]");
    const lock = nextStep.closest('[role="status"]');
    if (lock === null) throw new TypeError("no lock");
    // The Locked state, with the API's Locked block: what the module does, what was withheld, the next step.
    expect(lock.textContent).toContain("Locked");
    expect(lock.textContent).toContain("[what the module does]");
    expect(lock.textContent).toContain("[what was withheld]");
    // The reason in words and the code, once.
    expect(lock.textContent).toContain(LOCK_REASON_TITLE.VETTING_NOT_APPROVED);
    expect(lock.textContent.split("VETTING_NOT_APPROVED")).toHaveLength(2);

    // No collector row remains, of any collector, and no count or chip built from them.
    for (const label of ["[Kept]", "[Person]", "[Unlisted]"]) {
      expect(screen.queryByText(label), label).toBeNull();
    }
    expect(document.querySelectorAll("li")).toHaveLength(0);
    expect(screen.queryByRole("heading", { name: "Arriving now" })).toBeNull();
    expect(screen.queryByText("Evidence records")).toBeNull();
    expect(screen.queryByText(/^\d+ (ran|not run)$/)).toBeNull();
    expect(screen.queryByText(/collectors settled/)).toBeNull();
    expect(screen.queryByRole("link", { name: "View results" })).toBeNull();
    // Nor the target the run was for.
    expect(document.body.textContent).not.toContain("example.org");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Reconnect" })).toBeNull();
    expect(screen.queryByText("Live: this page updates as each source finishes.")).toBeNull();
  });

  it("REGRESSION (U1-c re-check): a reconnect refused for person data or for access withholds what was held", async () => {
    const lockedBlock = {
      module: "PERSON_INVESTIGATION",
      moduleSummary: "[what the module does]",
      withheld: "[what was withheld]",
      reason: "MODULE_NOT_IN_PLAN",
      plan: "[plan]",
      vettingStatus: "[vetting status]",
      nextStep: "[the next step]",
    };
    for (const refusal of [
      { status: 403, code: "MODULE_NOT_IN_PLAN", locked: lockedBlock },
      { status: 401, code: "UNAUTHENTICATED" },
    ]) {
      const first = progressStream();
      fakeApi([
        first.response,
        () =>
          Response.json(
            { type: "about:blank", title: "Refused", detail: "[detail]", ...refusal },
            { status: refusal.status },
          ),
      ]);
      renderRun();
      first.send("run", run());
      first.send("job", job({ sourceLabel: "[Held source]" }));
      expect(await screen.findByText("[Held source]")).toBeTruthy();
      // The stream reaches its maximum length; the reconnect is refused.
      first.send("timeout", { reconnect: true });
      await waitFor(() => {
        expect(streamRequests()).toHaveLength(2);
      });
      await waitFor(() => {
        expect(screen.queryByText("[Held source]")).toBeNull();
      });
      expect(screen.queryByText("Running.")).toBeNull();
      expect(screen.queryByRole("link", { name: "View results" })).toBeNull();
      cleanup();
      fetchMock.mockReset();
    }
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

    // A refusal at connect hides the way to results too: it would meet the same gate.
    expect(screen.queryByRole("link", { name: "View results" })).toBeNull();
    cleanup();

    fakeApi([
      () =>
        Response.json(
          {
            type: "about:blank",
            title: "Server error",
            status: 500,
            code: "UNEXPECTED",
            detail: "[detail]",
          },
          { status: 500 },
        ),
    ]);
    renderRun();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Code: UNEXPECTED");
    expect(screen.getByText(/Nothing had been received yet\./)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeTruthy();
  });

  it("says when the run no longer exists, offers a new search, and no way to its results", async () => {
    const stream = progressStream();
    fakeApi([stream.response]);
    renderRun();
    stream.send("end", { status: null });
    expect(
      await screen.findByText("This run no longer exists, so there is nothing more to show."),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Run not found" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Start a search" }).getAttribute("href")).toBe("/");
    expect(screen.queryByRole("link", { name: "View results" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reconnect" })).toBeNull();
  });

  it("on a 404 at connect, says the run is not found, never a failure with a Reconnect that cannot succeed", async () => {
    fakeApi([
      () =>
        Response.json(
          {
            type: "about:blank",
            title: "Not Found",
            status: 404,
            code: "NOT_FOUND",
            detail: "[detail]",
          },
          { status: 404 },
        ),
    ]);
    renderRun();
    expect(await screen.findByRole("heading", { name: "Run not found" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Start a search" }).getAttribute("href")).toBe("/");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("Could not follow this run.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Reconnect" })).toBeNull();
    expect(screen.queryByRole("link", { name: "View results" })).toBeNull();
    // Nothing waits for a run that is not there.
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it("while connected but before the run's details arrive, shows the run skeleton, never an empty page", async () => {
    const stream = progressStream();
    fakeApi([stream.response]);
    renderRun();
    // A job event first: the connection is live, and no run event has come.
    stream.send("job", job({ sourceLabel: "[Early source]" }));
    const waiting = await screen.findByText("Connected. Waiting for the run's details.");
    expect(waiting.getAttribute("role")).toBe("status");
    expect(waiting.closest('[aria-busy="true"]')).not.toBeNull();
    expect(screen.getByRole("region", { name: "Collectors" })).toBeTruthy();
    stream.send("run", run());
    expect(await screen.findByText("Running.")).toBeTruthy();
    expect(screen.queryByText("Connected. Waiting for the run's details.")).toBeNull();
  });

  it("REGRESSION (U1-c integration): a stream that ends before the run's details is not shown as loading", async () => {
    const stream = progressStream();
    fakeApi([stream.response]);
    renderRun();
    // The stream settles (an end with a status) without ever sending the run.
    stream.send("end", { status: "SUCCEEDED" });
    expect(
      await screen.findByRole("heading", { name: "The run's details did not arrive" }),
    ).toBeTruthy();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    expect(screen.queryByText("Connected. Waiting for the run's details.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    await waitFor(() => {
      expect(streamRequests()).toHaveLength(2);
    });
  });

  it("while reconnecting, says what is shown is as of the last update", async () => {
    const first = progressStream();
    const second = progressStream();
    let answer: (response: Response) => void = () => undefined;
    const held = new Promise<Response>((resolve) => {
      answer = resolve;
    });
    fakeApi([first.response, () => held]);
    renderRun();
    first.send("run", run());
    first.send("job", job({ sourceLabel: "[Held source]" }));
    await screen.findByText("[Held source]");
    first.send("timeout", { reconnect: true });

    const reconnecting = await screen.findByText(/^Reconnecting… shown as of/);
    expect(reconnecting.getAttribute("role")).toBe("status");
    expect(reconnecting.querySelector("time[datetime]")).not.toBeNull();
    // What was received stays, marked as of then, never as live.
    expect(screen.getByText("[Held source]")).toBeTruthy();
    expect(screen.queryByText("Live: this page updates as each source finishes.")).toBeNull();

    answer(second.response());
    second.send("run", run());
    expect(
      await screen.findByText("Live: this page updates as each source finishes."),
    ).toBeTruthy();
    expect(screen.queryByText(/^Reconnecting…/)).toBeNull();
  });

  it("stops the elapsed time when the stream drops: it stays as of the last update", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      // Ten seconds after the run's recorded start.
      vi.setSystemTime(new Date("2026-01-01T00:00:11.000Z"));
      const stream = progressStream();
      fakeApi([stream.response]);
      renderRun();
      stream.send("run", run());
      expect(await screen.findByText(/0 of 0 collectors settled · elapsed 10s$/)).toBeTruthy();

      stream.send("error", { code: "STREAM_FAILED" });
      await screen.findByRole("alert");
      // An hour on, and more than one tick later, the elapsed time has not moved.
      vi.setSystemTime(new Date("2026-01-01T01:00:11.000Z"));
      await new Promise((resolve) => {
        setTimeout(resolve, 1500);
      });
      expect(
        screen.getByText("0 of 0 collectors settled · elapsed 10s as of the last update"),
      ).toBeTruthy();
      expect(screen.queryByText(/elapsed 1h/)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the plan's modules and the vetting status as stated, with no verdict computed here", async () => {
    const stream = progressStream();
    fakeApi([stream.response], {
      ...ME,
      tenant: {
        ...ME.tenant,
        plan: "TECHINT_AND_PERSON",
        vettingStatus: "APPROVED",
        planModules: ["TECHINT", "PERSON_INVESTIGATION"],
      },
    });
    renderRun();
    stream.send("run", run());
    const settings = (await screen.findByRole("heading", { name: "Run settings" })).closest(
      "section",
    );
    if (settings === null) throw new TypeError("no panel");
    expect(
      await within(settings).findByText("Plan: TECHINT, PERSON_INVESTIGATION · Vetting: approved"),
    ).toBeTruthy();
    // Whether person modules are open is the API's decision (packages/access), never this page's.
    expect(settings.textContent).not.toMatch(/Available|Vetting required|Not in this plan/);
  });

  it("says the run is passive only when every source in it is, from the collector list, and shows the run's status in the header", async () => {
    const stream = progressStream();
    fakeApi([stream.response]);
    renderRun();
    stream.send(
      "run",
      run({ status: "SUCCEEDED", settled: true, finishedAt: "2026-01-01T00:02:00.000Z" }),
    );
    stream.send(
      "job",
      job({
        collectorId: "unlicensed-source",
        sourceLabel: "[Listed source]",
        status: "SUCCEEDED",
        outcome: "FOUND",
        attempts: 2,
      }),
    );
    stream.send("end", { status: "SUCCEEDED" });
    expect(await screen.findByText("Finished: every source ran.")).toBeTruthy();
    const settings = screen.getByRole("heading", { name: "Run settings" }).closest("section");
    if (settings === null) throw new TypeError("no panel");
    expect(await within(settings).findByText("Passive only")).toBeTruthy();
    // A source that succeeded on a later attempt says so; its discipline comes from the list.
    expect(rowOf("[Listed source]").textContent).toBe(
      "[Listed source]TECHINT · 0 evidence records · merging into the results · recovered on attempt 2Ran",
    );
    // The detected type is a tag (§12: a non-status pill is a radius-sm tag), never a pill.
    const detected = screen.getByText("Detected: domain");
    expect(detected.className).not.toContain("rounded-pill");
    expect(within(screen.getByRole("banner")).getByText("Ran")).toBeTruthy();
    // The way to this run's results.
    expect(screen.getByRole("link", { name: "View results" }).getAttribute("href")).toBe(
      `/runs/${RUN_ID}/overview`,
    );
  });

  it("says an alternate reading the run did not plan was not run, never lists it as if it ran (Day 1)", async () => {
    const stream = progressStream();
    fakeApi([stream.response]);
    renderRun();
    stream.send(
      "run",
      run({
        plan: {
          input: "[two words]",
          requestedType: null,
          detected: { primaryType: "ORGANIZATION", alternateTypes: ["TOPIC"] },
          targets: [{ type: "ORGANIZATION", value: "[two words]" }],
          jobs: [],
          excluded: [],
          notPlanned: [
            {
              type: "TOPIC",
              reason: "NOT_PLANNED_UNLESS_CHOSEN",
              message: "[why it was not planned]",
            },
          ],
        },
      }),
    );
    expect(
      await screen.findByText("alternates: topic (not run unless chosen)", { exact: false }),
    ).toBeTruthy();
    expect(screen.getByText("Detected: organisation")).toBeTruthy();
  });

  it("lists an alternate plainly when the plan records none left out (plans before Day 1)", async () => {
    const stream = progressStream();
    fakeApi([stream.response]);
    renderRun();
    stream.send(
      "run",
      run({
        plan: {
          input: "octocat",
          requestedType: null,
          detected: { primaryType: "USERNAME", alternateTypes: ["ORGANIZATION"] },
          targets: [
            { type: "USERNAME", value: "octocat" },
            { type: "ORGANIZATION", value: "octocat" },
          ],
          jobs: [],
          excluded: [],
        },
      }),
    );
    expect(await screen.findByText("alternates: organisation", { exact: false })).toBeTruthy();
    expect(screen.queryByText("not run unless chosen", { exact: false })).toBeNull();
  });
});

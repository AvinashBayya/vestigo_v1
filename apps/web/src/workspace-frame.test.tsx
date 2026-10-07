/**
 * The workspace frame: entities, the overview and navigation between tabs.
 * Split from workspace.test.tsx (U1-c); shared fixtures in
 * workspace/test-fixtures.tsx.
 *
 * Step 4 of the web flow: a run's results and the case workspace. The real
 * router and screens, over a fetch stub; every request goes through the
 * generated client. What is checked here is what the brief makes
 * non-negotiable: source labels and both timestamps, strengths in words,
 * derived set apart from stated, an em dash (with why) for every unmeasured
 * value, pin-to-case on every result surface, provenance from any value,
 * partial lists said to be partial, and Locked rather than an error.
 * U1-c: the frame is full-bleed (case header, D6 tab bar); Media, Map and a
 * case's Report are Not built tabs that read nothing; "Read at" is when the
 * data was read.
 */
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CASE_ID,
  ENTITIES,
  renderAt,
  rowOf,
  RUN,
  RUN_ID,
  TIMELINE,
  workspaceApi,
} from "./workspace/test-fixtures.tsx";

// The generated client captures fetch when it is created, at import time.
const fetchMock = vi.hoisted(() => {
  const mock = vi.fn<(request: Request) => Promise<Response>>();
  vi.stubGlobal("fetch", mock);
  return mock;
});

const { fakeApi, requestsTo } = workspaceApi(fetchMock);

beforeEach(() => {
  // jsdom draws nothing: the graph's list stands in, as it does in any browser without a canvas.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  vi.restoreAllMocks();
});

describe("entities", () => {
  it("lists each entity with its class in words; its claims open provenance, derived set apart; relationships pin", async () => {
    fakeApi();
    renderAt(`/runs/${RUN_ID}/entities`);
    await screen.findByRole("table", { name: "Entities" });
    expect(within(rowOf("192.0.2.1")).getByText("IP address")).toBeTruthy();
    // REGRESSION (live check 2026-10-06): an entity with no claims left its Strength cell
    // blank. Its strength set is a measured empty one, and says so in words.
    expect(within(rowOf("192.0.2.1")).getByText("no claims, so no strength")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "example.com" }));
    // The docked inspector (Workspace.dc.html's right column) is an aside, named for what it shows.
    const panel = await screen.findByRole("complementary", { name: "Entity" });
    await within(panel).findByText("Stated by a source (1)");
    expect(
      within(panel).getByText("Computed by the platform (1)").closest("section")?.textContent,
    ).toContain("DERIVED");
    expect(within(panel).getByRole("button", { name: /Pin relationship to a case/ })).toBeTruthy();
    fireEvent.click(within(panel).getByRole("button", { name: "Provenance of registrar" }));
    const drawer = await screen.findByRole("dialog");
    // The claim it opened from is marked in the evidence.
    await waitFor(() => {
      expect(
        within(drawer).getByText("registrar").closest("li")?.getAttribute("aria-current"),
      ).toBe("true");
    });
  });

  it("a list with more than it returned is partial, and the overview's count is an em dash with why", async () => {
    fakeApi({ "GET /api/v1/entities": () => Response.json({ ...ENTITIES, hasMore: true }) });
    renderAt(`/runs/${RUN_ID}/entities`);
    expect(await screen.findByText("Partial: 2 of more than 500 entities.")).toBeTruthy();
    cleanup();
    fakeApi({ "GET /api/v1/entities": () => Response.json({ ...ENTITIES, hasMore: true }) });
    renderAt(`/runs/${RUN_ID}/overview`);
    expect(
      await screen.findByRole("button", { name: /Not measured\. More than 500 entities/ }),
    ).toBeTruthy();
  });
});

describe("the overview", () => {
  it("for a run: its coverage, a partial run said to be partial, its gaps with reasons, and counts that were measured", async () => {
    fakeApi();
    renderAt(`/runs/${RUN_ID}/overview`);
    // One Partial notice: the measured count in bold, then why, said once.
    const partial = await screen.findByText("Partial: 1 of 2 ran.");
    expect(partial.tagName).toBe("STRONG");
    const notice = partial.closest("[role='status']");
    expect(notice?.textContent).toContain(
      "Some sources failed, and what they would have found is not here.",
    );
    expect(screen.getAllByText(/Some sources failed/)).toHaveLength(1);
    expect(screen.getByText("[the source did not answer]")).toBeTruthy();
    expect(screen.getByText("1 failed")).toBeTruthy();
    expect(screen.getByText("1 ran")).toBeTruthy();
    // Nothing was left out of this plan, so no not-run chip claims any.
    expect(screen.queryByText(/not run$/)).toBeNull();
    const evidence = screen.getByText("Evidence records").parentElement;
    expect(evidence?.textContent).toContain("2");
  });

  it("gaps to close: real gaps first; sources that do not take the target on one collapsed line, counted, never hidden", async () => {
    const excluded = (collectorId: string, reason: string, message: string) => ({
      collectorId,
      targetType: "DOMAIN",
      reason,
      message,
    });
    fakeApi({
      [`GET /api/v1/runs/${RUN_ID}`]: () =>
        Response.json({
          ...RUN,
          plan: {
            ...RUN.plan,
            excluded: [
              excluded("[not-for-domains-1]", "TARGET_TYPE_NOT_ACCEPTED", "[takes usernames only]"),
              excluded("[held-source]", "LICENCE_BLOCKED", "[licence not cleared]"),
              excluded("[not-for-domains-2]", "TARGET_TYPE_NOT_ACCEPTED", "[takes phones only]"),
            ],
          },
        }),
    });
    renderAt(`/runs/${RUN_ID}/overview`);
    const card = (await screen.findByRole("heading", { name: "Gaps to close" })).closest("section");
    if (card === null) throw new Error("The Gaps to close card is not a section.");
    const gaps = await within(card).findByRole("list", { name: "Gaps" });
    // The failed job and the held source are gaps; the type mismatches are not.
    expect(gaps.textContent).toContain("[Certificate source] · Failed");
    expect(gaps.textContent).toContain("LICENCE_BLOCKED");
    expect(gaps.textContent).not.toContain("[takes usernames only]");
    expect(gaps.textContent).not.toContain("TARGET_TYPE_NOT_ACCEPTED");
    // They are said, after the gaps, on one collapsed line naming the target type and how many.
    const line = within(card).getByText("Not applicable to a domain target (2)");
    const details = line.closest("details");
    expect(details?.hasAttribute("open")).toBe(false);
    expect(details?.textContent).toContain("[takes usernames only]");
    expect(details?.textContent).toContain("[takes phones only]");
    expect(gaps.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Every source left out of the plan is counted on the Coverage card.
    expect(screen.getByText("3 not run")).toBeTruthy();
  });

  it("for a case: labelled pinned items only, with its pins counted by kind", async () => {
    fakeApi();
    renderAt(`/cases/${CASE_ID}/overview`);
    // The case header labels it (a Tag beside the case name), and the Overview says what that means.
    expect(
      await within(await screen.findByRole("banner")).findByText("Pinned items only"),
    ).toBeTruthy();
    expect(
      screen.getByText(/It is not linked to the runs they came from\./).closest("section"),
    ).toBeTruthy();
    expect(await screen.findByText(/Nothing is pinned yet/)).toBeTruthy();
    // A case has no Progress tab and no live view: it is not a run.
    expect(screen.queryByRole("link", { name: "Progress" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Live progress" })).toBeNull();
    expect(
      requestsTo("GET", "/api/v1/timeline").every(
        (request) => new URL(request.url).searchParams.get("caseId") === CASE_ID,
      ),
    ).toBe(true);
  });

  it("a run still collecting says its results are not final", async () => {
    fakeApi({
      [`GET /api/v1/runs/${RUN_ID}`]: () =>
        Response.json({ ...RUN, status: "RUNNING", settled: false }),
    });
    renderAt(`/runs/${RUN_ID}/overview`);
    expect(await screen.findByText(/This run is still collecting/)).toBeTruthy();
  });
});

describe("navigation", () => {
  it("every tab is reachable in D6 order, unbuilt tabs say so; an unknown tab is said plainly", async () => {
    fakeApi();
    renderAt(`/runs/${RUN_ID}/overview`);
    const nav = await screen.findByRole("navigation", { name: "Workspace" });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Overview", "Entities", "Graph", "Timeline", "Evidence", "Media", "Map", "Report"]);
    expect(within(nav).getByRole("link", { name: "Overview" }).getAttribute("aria-current")).toBe(
      "page",
    );
    // Only one place is current: the tab, never another link to the same run.
    expect(document.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    // A run's live view is not a result tab: the run header links to it.
    expect(
      within(screen.getByRole("banner"))
        .getByRole("link", { name: "Live progress" })
        .getAttribute("href"),
    ).toBe(`/runs/${RUN_ID}`);
    // The tabs with no endpoint are reachable, and say they are not built.
    fireEvent.click(within(nav).getByRole("link", { name: "Media" }));
    expect(await screen.findByText(/Not built yet\./)).toBeTruthy();
    fireEvent.click(within(nav).getByRole("link", { name: "Map" }));
    expect(await screen.findByText("Map of located evidence")).toBeTruthy();
    expect(screen.getByText(/Not built yet\./)).toBeTruthy();
    cleanup();
    fakeApi();
    renderAt(`/runs/${RUN_ID}/monitors`);
    expect(await screen.findByText(/There is no/)).toBeTruthy();
  });
});

describe("the frame", () => {
  it("a run header shows the run's own PARTIAL chip, not a collector's Partial", async () => {
    fakeApi();
    renderAt(`/runs/${RUN_ID}/overview`);
    const header = await screen.findByRole("banner");
    const chip = await within(header).findByText("PARTIAL");
    // §3: a run's PARTIAL is amber (the inferred tone), in capitals; a collector's green
    // "Partial" never stands for the run.
    expect(chip.className).toContain("bg-claim-inferred-fill");
    expect(chip.className).not.toContain("bg-claim-observed-fill");
    expect(screen.queryByText("Partial")).toBeNull();
    // The Coverage card states it the same way.
    expect(await screen.findByText("Partial: 1 of 2 ran.")).toBeTruthy();
    expect(screen.getAllByText("PARTIAL")).toHaveLength(2);
  });

  it("'Read at' is when the data was read, and absent until it is", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const held = (body: unknown) => async (): Promise<Response> => {
      await gate;
      return Response.json(body);
    };
    fakeApi({
      [`GET /api/v1/runs/${RUN_ID}`]: held(RUN),
      "GET /api/v1/timeline": held(TIMELINE),
      "GET /api/v1/entities": held(ENTITIES),
    });
    const router = renderAt(`/runs/${RUN_ID}/overview`);
    const header = await screen.findByRole("banner");
    const mountedAt = Date.now();
    // Nothing has been read: no time is shown, and the header says it is reading.
    expect(within(header).getByText("Reading…")).toBeTruthy();
    expect(within(header).queryByText(/Read at/)).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 30));
    release();
    const readAt = await within(header).findByText(/Read at/);
    const shown = Date.parse(readAt.querySelector("time")?.getAttribute("dateTime") ?? "");
    // The time shown is when a read was answered (a query's dataUpdatedAt), never the mount time.
    const answered = router.options.context.queryClient
      .getQueryCache()
      .getAll()
      .map((query) => query.state.dataUpdatedAt)
      .filter((at) => at > 0);
    expect(answered).toContain(shown);
    expect(shown).toBeGreaterThanOrEqual(mountedAt + 30);
  });
});

describe("media, map and a case's report", () => {
  it("each is a Not built tab that asks the API for nothing", async () => {
    for (const [path, title] of [
      [`/runs/${RUN_ID}/media`, "Media in this case"],
      [`/cases/${CASE_ID}/media`, "Media in this case"],
      [`/runs/${RUN_ID}/map`, "Map of located evidence"],
      [`/cases/${CASE_ID}/map`, "Map of located evidence"],
      [`/cases/${CASE_ID}/report`, "Case report"],
    ] as const) {
      fakeApi();
      renderAt(path);
      const heading = await screen.findByRole("heading", { name: title });
      const card = heading.closest("section");
      // What it will show (the title), that it is not built, and what it needs.
      expect(card?.textContent).toMatch(
        new RegExp(String.raw`^${title}Not built yet\. .*needs .+`, "u"),
      );
      // No number, no image, no point: only the card's words (C2PA and R9 are names, not counts).
      expect(card?.textContent.replace(/C2PA|R9/gu, "")).not.toMatch(/\d/u);
      expect(document.querySelector("main img, main canvas, main svg")).toBeNull();
      const paths = fetchMock.mock.calls.map(([request]) => new URL(request.url).pathname);
      expect(paths.filter((url) => /media|map|report/u.test(url))).toEqual([]);
      cleanup();
      fetchMock.mockReset();
    }
  });
});

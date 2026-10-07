/**
 * The workspace's result surfaces: the evidence grid, the provenance drawer, pin-to-case, the graph and the timeline.
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
 */
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CASE_ID,
  caseRow,
  DOMAIN_ID,
  EVIDENCE,
  EVIDENCE_ID,
  GRAPH,
  INVESTIGATION_ID,
  IP_ID,
  LOCKED,
  me,
  problem,
  renderAt,
  rowOf,
  RUN_ID,
  TIMELINE,
  timelineItem,
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

describe("the evidence grid", () => {
  it("labels each record's source, keeps both times apart, says strength in words, and never fills an unknown", async () => {
    fakeApi();
    renderAt(`/runs/${RUN_ID}/evidence`);
    const table = await screen.findByRole("table", { name: "Evidence" });
    const dns = rowOf("[DNS source]");
    // Observed is unknown: an em dash saying why, never the collection time.
    expect(
      within(dns).getByRole("button", {
        name: /Not measured\. The source did not say when this happened/,
      }),
    ).toBeTruthy();
    expect(within(dns).getByText("OBSERVED")).toBeTruthy();
    expect(within(dns).getByRole("button", { name: /Pin evidence to a case/ })).toBeTruthy();
    // A collector the registry no longer lists: its id, and why there is no label.
    const retired = rowOf("retired-source");
    expect(
      within(retired).getByRole("button", { name: /not in the platform registry/ }),
    ).toBeTruthy();
    expect(
      within(retired).getByRole("button", { name: /No source URL was recorded/ }),
    ).toBeTruthy();
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(screen.getByText(/1 record with no observed time/)).toBeTruthy();
    // Nothing on the screen calls an unknown zero, N/A or blank.
    expect(document.body.textContent).not.toMatch(/N\/A/);
  });

  it("filters by strength, and sorts with unknown times last", async () => {
    fakeApi();
    renderAt(`/runs/${RUN_ID}/evidence`);
    await screen.findByRole("table", { name: "Evidence" });
    fireEvent.click(screen.getByRole("button", { name: "Add filter" }));
    fireEvent.change(screen.getByLabelText("Strength"), { target: { value: "REPORTED" } });
    expect(
      within(screen.getByRole("table", { name: "Evidence" })).getAllByRole("row"),
    ).toHaveLength(2);
    expect(screen.getByText(/1 record match, of 2 shown/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove filter Strength: REPORTED" }));
    const table = screen.getByRole("table", { name: "Evidence" });
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: /Remove filter/ })).toBeNull();

    // Each click must set a direction, and either way round the record with no
    // observed time sorts last.
    const directions: string[] = [];
    for (let click = 0; click < 2; click += 1) {
      fireEvent.click(within(table).getByRole("button", { name: "Observed" }));
      const header = within(table).getByRole("columnheader", { name: /Observed/ });
      directions.push(header.getAttribute("aria-sort") ?? "");
      const body = within(table).getAllByRole("row").slice(1);
      expect(body[0]?.textContent).toContain("retired-source");
      expect(body.at(-1)?.textContent).toContain("[DNS source]");
    }
    expect([...directions].sort()).toEqual(["ascending", "descending"]);
  });

  it("a filter that matches nothing says so, offers Clear filters, and keeps the toolbar", async () => {
    fakeApi();
    renderAt(`/runs/${RUN_ID}/evidence`);
    await screen.findByRole("table", { name: "Evidence" });
    fireEvent.change(screen.getByLabelText("Search evidence"), {
      target: { value: "[matches nothing]" },
    });
    expect(screen.getByText("No record matches")).toBeTruthy();
    expect(screen.getByText("No evidence shown matches these filters.")).toBeTruthy();
    // Never presented as a run with no evidence.
    expect(screen.queryByText(/recorded no evidence/)).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByLabelText("Search evidence")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(
      within(screen.getByRole("table", { name: "Evidence" })).getAllByRole("row"),
    ).toHaveLength(3);
  });

  it("says a list cut at 500 is partial, and of how many", async () => {
    fakeApi({
      "GET /api/v1/timeline": () => Response.json({ ...TIMELINE, hasMore: true, total: 812 }),
    });
    renderAt(`/runs/${RUN_ID}/evidence`);
    expect(await screen.findByText("Partial: 2 of 812 evidence records.")).toBeTruthy();
  });

  it("an empty run says what would appear and where to look", async () => {
    fakeApi({
      "GET /api/v1/timeline": () =>
        Response.json({
          items: [],
          hasMore: false,
          total: 0,
          withoutObservedAt: 0,
          withoutCollectedAt: 0,
        }),
    });
    renderAt(`/runs/${RUN_ID}/evidence`);
    expect(await screen.findByText(/This run recorded no evidence/)).toBeTruthy();
  });

  it("a refusal carrying `locked` is the Locked state, not an error; another failure offers a retry", async () => {
    fakeApi({
      "GET /api/v1/timeline": () =>
        problem(403, "MODULE_NOT_IN_PLAN", "[refused; nothing was returned]", { locked: LOCKED }),
    });
    renderAt(`/runs/${RUN_ID}/evidence`);
    const step = await screen.findByText("[the next step]");
    expect(step.closest("[role]")?.getAttribute("role")).toBe("status");
    expect(screen.getByText("[what the module does]")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    cleanup();

    let calls = 0;
    fakeApi({
      "GET /api/v1/timeline": () => {
        calls += 1;
        return calls === 1
          ? problem(503, "DB_UNAVAILABLE", "[unavailable]")
          : Response.json(TIMELINE);
      },
    });
    renderAt(`/runs/${RUN_ID}/evidence`);
    expect((await screen.findByRole("alert")).textContent).toContain("DB_UNAVAILABLE");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("table", { name: "Evidence" })).toBeTruthy();
  });
});

describe("the provenance drawer", () => {
  it("opens from a value: collector and version, run, both times, hash, URL, the raw payload, stated apart from derived", async () => {
    const created: Blob[] = [];
    vi.stubGlobal(
      "URL",
      Object.assign(URL, {
        createObjectURL: (blob: Blob) => {
          created.push(blob);
          return "blob:[payload]";
        },
        revokeObjectURL: () => undefined,
      }),
    );
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    fakeApi({
      [`GET /api/v1/evidence/${EVIDENCE_ID}/payload`]: () =>
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "application/octet-stream" },
        }),
    });
    renderAt(`/runs/${RUN_ID}/evidence`);
    fireEvent.click(
      await screen.findByRole("button", { name: "Provenance of evidence from [DNS source]" }),
    );
    const drawer = await screen.findByRole("dialog");
    await within(drawer).findByText("dns v1.4.0");
    expect(within(drawer).getByText(RUN_ID)).toBeTruthy();
    expect(within(drawer).getByText("sha256:[content hash]")).toBeTruthy();
    expect(within(drawer).getByRole("link", { name: "https://example.com/" })).toBeTruthy();
    expect(
      within(drawer).getByRole("button", { name: /Not measured\. The source did not say when/ }),
    ).toBeTruthy();
    // Stated and derived are separate sections; DERIVED is said in words.
    const stated = within(drawer).getByText("Stated by the source (1)").closest("section");
    const derived = within(drawer).getByText("Computed by the platform (1)").closest("section");
    expect(stated?.textContent).toContain("registrar");
    expect(stated?.textContent).toContain("null (stated as empty)");
    expect(derived?.textContent).toContain("age_days");
    expect(derived?.textContent).toContain("DERIVED");
    // Pin from inside the drawer too: the evidence and each claim.
    expect(within(drawer).getAllByRole("button", { name: /^Pin / }).length).toBe(3);

    fireEvent.click(within(drawer).getByRole("button", { name: "Download raw payload" }));
    await waitFor(() => {
      expect(created).toHaveLength(1);
    });
    expect(requestsTo("GET", `/api/v1/evidence/${EVIDENCE_ID}/payload`)).toHaveLength(1);
  });

  it("attribution is a link when the evidence requires it; a payload refusal is shown with its code; Escape closes and focus returns to the value", async () => {
    fakeApi({
      [`GET /api/v1/evidence/${EVIDENCE_ID}`]: () =>
        Response.json({
          ...EVIDENCE,
          attribution: { text: "[attribution text]", url: "https://example.com/[licence]" },
        }),
      [`GET /api/v1/evidence/${EVIDENCE_ID}/payload`]: () =>
        problem(500, "EVIDENCE_PAYLOAD_INTEGRITY_FAILED", "[refused: the bytes do not match]"),
    });
    renderAt(`/runs/${RUN_ID}/evidence`);
    const value = await screen.findByRole("button", {
      name: "Provenance of evidence from [DNS source]",
    });
    value.focus();
    fireEvent.click(value);
    const drawer = await screen.findByRole("dialog", { name: "Provenance" });
    // Docked, not modal: the grid beside it stays usable.
    expect(drawer.getAttribute("aria-modal")).toBe("false");
    // The row whose provenance is open is marked, not by tint alone.
    expect(rowOf("[DNS source]").getAttribute("aria-current")).toBe("true");
    const attribution = await within(drawer).findByRole("link", { name: "[attribution text]" });
    expect(attribution.getAttribute("href")).toBe("https://example.com/[licence]");
    expect(attribution.getAttribute("rel")).toContain("noopener");
    expect(attribution.closest("section")?.textContent).toContain("Attribution");

    const download = within(drawer).getByRole("button", { name: "Download raw payload" });
    fireEvent.click(download);
    expect((await within(drawer).findByRole("alert")).textContent).toContain(
      "EVIDENCE_PAYLOAD_INTEGRITY_FAILED",
    );

    fireEvent.keyDown(download, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(document.activeElement).toBe(value);
  });

  it("opens from a relationship, and walks to the evidence behind its claim and back", async () => {
    fakeApi();
    renderAt(`/runs/${RUN_ID}/graph`);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Provenance of the relationship: example.com resolves_to 192.0.2.1",
      }),
    );
    const drawer = await screen.findByRole("dialog");
    await within(drawer).findByText("What asserts it");
    expect(within(drawer).getByRole("button", { name: /Pin relationship to a case/ })).toBeTruthy();
    fireEvent.click(within(drawer).getByRole("button", { name: "Evidence behind this claim" }));
    await within(drawer).findByText("dns v1.4.0");
    fireEvent.click(within(drawer).getByRole("button", { name: "Back" }));
    expect(await within(drawer).findByText("What asserts it")).toBeTruthy();
  });
});

describe("pin-to-case", () => {
  it("pins by type and id to an open case the reader chooses; archived cases are not offered", async () => {
    fakeApi({
      [`POST /api/v1/cases/${CASE_ID}/pins`]: (_request, body) =>
        Response.json(
          {
            id: "pin-1",
            caseId: CASE_ID,
            target: (body as { target: unknown }).target,
            note: null,
            pinnedByUserId: "u1",
            createdAt: "2026-05-03T00:00:00.000Z",
            subject: null,
          },
          { status: 201 },
        ),
    });
    renderAt(`/runs/${RUN_ID}/evidence`);
    await screen.findByRole("table", { name: "Evidence" });
    fireEvent.click(within(rowOf("[DNS source]")).getByRole("button", { name: /Pin evidence/ }));
    fireEvent.click(await screen.findByRole("button", { name: "[Open case]" }));
    expect(screen.queryByRole("button", { name: "[Archived case]" })).toBeNull();
    expect(await screen.findByText(/Pinned to/)).toBeTruthy();
    const [request] = requestsTo("POST", `/api/v1/cases/${CASE_ID}/pins`);
    expect(await request?.json()).toEqual({
      target: { type: "evidence", id: EVIDENCE_ID },
      note: null,
    });
  });

  it("creates a case and pins to it in one step", async () => {
    const NEW_CASE = "55555555-5555-4555-8555-00000000000a";
    fakeApi({
      "POST /api/v1/cases": () => Response.json(caseRow(NEW_CASE, "[New case]"), { status: 201 }),
      [`POST /api/v1/cases/${NEW_CASE}/pins`]: () =>
        Response.json(
          {
            id: "pin-2",
            caseId: NEW_CASE,
            target: { type: "entity", id: DOMAIN_ID },
            note: null,
            pinnedByUserId: "u1",
            createdAt: "2026-05-03T00:00:00.000Z",
            subject: null,
          },
          { status: 201 },
        ),
    });
    renderAt(`/runs/${RUN_ID}/entities`);
    await screen.findByRole("table", { name: "Entities" });
    fireEvent.click(within(rowOf("example.com")).getByRole("button", { name: /Pin entity/ }));
    fireEvent.change(await screen.findByLabelText("New case"), { target: { value: "[New case]" } });
    fireEvent.click(screen.getByRole("button", { name: "Create and pin" }));
    expect(await screen.findByText(/Pinned to/)).toBeTruthy();
    expect(requestsTo("POST", `/api/v1/cases/${NEW_CASE}/pins`)).toHaveLength(1);
  });

  it("a role that cannot pin is told why, before anything is sent", async () => {
    fakeApi({
      "GET /api/v1/me": () => Response.json(me(["run:read", "evidence:read", "case:read"])),
    });
    renderAt(`/runs/${RUN_ID}/evidence`);
    await screen.findByRole("table", { name: "Evidence" });
    fireEvent.click(within(rowOf("[DNS source]")).getByRole("button", { name: /Pin evidence/ }));
    expect(await screen.findByText(/cannot pin to cases/)).toBeTruthy();
    expect(fetchMock.mock.calls.some(([request]) => request.method === "POST")).toBe(false);
  });
});

describe("pin state", () => {
  const pinnedEvidence = {
    id: "pin-3",
    caseId: CASE_ID,
    target: { type: "evidence", id: EVIDENCE_ID },
    note: null,
    pinnedByUserId: "u1",
    createdAt: "2026-05-03T00:00:00.000Z",
    subject: null,
  };

  it("in a run, a row's pin claims no state; after pinning it is pressed", async () => {
    fakeApi({
      [`POST /api/v1/cases/${CASE_ID}/pins`]: () => Response.json(pinnedEvidence, { status: 201 }),
    });
    renderAt(`/runs/${RUN_ID}/evidence`);
    await screen.findByRole("table", { name: "Evidence" });
    const pin = within(rowOf("[DNS source]")).getByRole("button", { name: /Pin evidence/ });
    // No read says whether it is pinned: never a guessed "not pinned".
    expect(pin.hasAttribute("aria-pressed")).toBe(false);
    fireEvent.click(pin);
    fireEvent.click(await screen.findByRole("button", { name: "[Open case]" }));
    expect(await screen.findByText(/Pinned to/)).toBeTruthy();
    await waitFor(() => {
      expect(pin.getAttribute("aria-pressed")).toBe("true");
    });
  });

  it("in a case, evidence found among the case's pins is pressed, and the rest claim no state", async () => {
    fakeApi({
      [`GET /api/v1/cases/${CASE_ID}/pins`]: () =>
        Response.json({ items: [pinnedEvidence], hasMore: false }),
    });
    renderAt(`/cases/${CASE_ID}/evidence`);
    await screen.findByRole("table", { name: "Evidence" });
    await waitFor(() => {
      expect(
        within(rowOf("[DNS source]"))
          .getByRole("button", { name: /Pin evidence/ })
          .getAttribute("aria-pressed"),
      ).toBe("true");
    });
    expect(
      within(rowOf("retired-source"))
        .getByRole("button", { name: /Pin evidence/ })
        .hasAttribute("aria-pressed"),
    ).toBe(false);
  });
});

describe("the graph", () => {
  it("lists every node with its class in words and every edge, says when it is cut, and opens an entity", async () => {
    fakeApi({ "GET /api/v1/graph": () => Response.json({ ...GRAPH, truncated: true }) });
    renderAt(`/runs/${RUN_ID}/graph`);
    expect(await screen.findByText(/Partial: the graph was cut at 500 entities/)).toBeTruthy();
    expect(screen.getByText(/This browser cannot draw the graph/)).toBeTruthy();
    const legend = screen.getByRole("list", { name: "Entity classes" });
    expect(legend.textContent).toContain("Domain");
    expect(legend.textContent).toContain("IP address");
    expect(screen.getAllByRole("button", { name: /Pin entity to a case/ })).toHaveLength(2);
    expect(screen.getByRole("button", { name: /Pin relationship to a case/ })).toBeTruthy();

    // The edge list's key in words, beside the classes.
    expect(screen.getByRole("list", { name: "Edges" }).textContent).toMatch(/INFERRED/);

    // An entity opens in the docked inspector, and its row says it is the one open.
    const entity = screen.getByRole("button", { name: "example.com" });
    expect(entity.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(entity);
    const inspector = await screen.findByRole("complementary", { name: "Entity" });
    expect(await within(inspector).findByText(/registrar/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "example.com" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    // A relationship takes the inspector's place; closing it returns to the entity.
    fireEvent.click(
      screen.getByRole("button", {
        name: "Provenance of the relationship: example.com resolves_to 192.0.2.1",
      }),
    );
    const relationship = await screen.findByRole("dialog", { name: "Relationship" });
    expect(screen.queryByRole("complementary", { name: "Entity" })).toBeNull();
    fireEvent.click(within(relationship).getByRole("button", { name: "Close relationship" }));
    expect(await screen.findByRole("complementary", { name: "Entity" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Only these" }));
    await waitFor(() => {
      expect(
        requestsTo("GET", "/api/v1/graph").some(
          (request) => new URL(request.url).searchParams.get("hops") === "0",
        ),
      ).toBe(true);
    });
  });

  it("the runs rail lists the investigation's runs with their status in words; a case says it has none", async () => {
    fakeApi();
    renderAt(`/runs/${RUN_ID}/graph`);
    const rail = await screen.findByRole("navigation", { name: "Runs" });
    const runs = await within(rail).findAllByRole("button");
    expect(runs).toHaveLength(2);
    expect(runs[0]?.getAttribute("aria-current")).toBe("true");
    expect(runs[0]?.textContent).toContain("example.com");
    expect(runs[0]?.textContent).toContain("PARTIAL");
    expect(runs[1]?.hasAttribute("aria-current")).toBe(false);
    cleanup();
    fetchMock.mockReset();

    fakeApi();
    renderAt(`/cases/${CASE_ID}/graph`);
    expect(
      await screen.findByText(/A case is not linked to the runs its pins came from/),
    ).toBeTruthy();
    expect(requestsTo("GET", `/api/v1/investigations/${INVESTIGATION_ID}/runs`)).toHaveLength(0);
  });

  it("a case's rail counts what is pinned to it at its foot, from the case's pins; cut pins are not counted", async () => {
    const pin = (id: string, type: string) => ({
      id,
      caseId: CASE_ID,
      target: { type, id: `${id}-target` },
      note: null,
      pinnedByUserId: "u1",
      createdAt: "2026-05-03T00:00:00.000Z",
      subject: null,
    });
    fakeApi({
      [`GET /api/v1/cases/${CASE_ID}/pins`]: () =>
        Response.json({
          items: [pin("p1", "evidence"), pin("p2", "evidence"), pin("p3", "entity")],
          hasMore: false,
        }),
    });
    renderAt(`/cases/${CASE_ID}/graph`);
    const foot = await screen.findByRole("region", { name: "Pinned to case" });
    await within(foot).findByText("2 evidence records");
    expect(within(foot).getByText("1 entity")).toBeTruthy();
    // A measured zero is a count, not a blank.
    expect(within(foot).getByText("0 claims")).toBeTruthy();
    expect(within(foot).getByText("0 relationships")).toBeTruthy();
    cleanup();
    fetchMock.mockReset();

    fakeApi({
      [`GET /api/v1/cases/${CASE_ID}/pins`]: () =>
        Response.json({ items: [pin("p1", "evidence")], hasMore: true }),
    });
    renderAt(`/cases/${CASE_ID}/graph`);
    const cut = await screen.findByRole("region", { name: "Pinned to case" });
    // Past the read's limit a count would be short: an em dash with why, never "1".
    const dashes = await within(cut).findAllByRole("button", {
      name: /^Not measured\. More than 500 pins/,
    });
    expect(dashes).toHaveLength(4);
    expect(cut.textContent).not.toMatch(/\d+ evidence record/);
  });

  it("a run's rail writes when each run was created in the shared instant form, with its zone", async () => {
    fakeApi();
    renderAt(`/runs/${RUN_ID}/graph`);
    const rail = await screen.findByRole("navigation", { name: "Runs" });
    const runs = await within(rail).findAllByRole("button");
    const zoned = new Date("2026-05-01T09:59:00.000Z").toLocaleString(undefined, {
      timeZoneName: "short",
    });
    expect(runs.some((run) => run.textContent.includes(`Created ${zoned}`))).toBe(true);
  });

  it("Hide inferred hides only all-INFERRED edges, says how many, and offers them back; an edge with no claims says so", async () => {
    const edge = (id: string, kind: string, strengths: string[]) => ({
      id,
      sourceEntityId: DOMAIN_ID,
      targetEntityId: IP_ID,
      kind,
      claimCount: strengths.length,
      strengths,
    });
    fakeApi({
      "GET /api/v1/graph": () =>
        Response.json({
          ...GRAPH,
          edges: [
            ...GRAPH.edges,
            edge("88888888-8888-4888-8888-888888888882", "[inferred link]", ["INFERRED"]),
            edge("88888888-8888-4888-8888-888888888883", "[mixed link]", [
              "INFERRED",
              "HYPOTHESIS",
            ]),
            edge("88888888-8888-4888-8888-888888888884", "[bare link]", []),
          ],
        }),
    });
    renderAt(`/runs/${RUN_ID}/graph`);
    expect(await screen.findByText("Relationships (4)")).toBeTruthy();
    const name = (kind: string) => `Provenance of the relationship: example.com ${kind} 192.0.2.1`;
    // Unsupported: said in words, never shown as a stated relationship.
    expect(
      screen.getByRole("button", { name: name("[bare link]") }).closest("li")?.textContent,
    ).toContain("no claims");

    const hide = screen.getByRole("button", { name: "Hide inferred" });
    fireEvent.click(hide);
    expect(hide.getAttribute("aria-pressed")).toBe("true");
    expect(
      screen.getByText("1 relationship hidden: every claim behind it is INFERRED."),
    ).toBeTruthy();
    expect(screen.getByText("Relationships (3)")).toBeTruthy();
    expect(screen.queryByRole("button", { name: name("[inferred link]") })).toBeNull();
    // A mixed INFERRED / HYPOTHESIS edge, an edge with no claims, and the observed one stay.
    expect(screen.getByRole("button", { name: name("[mixed link]") })).toBeTruthy();
    expect(screen.getByRole("button", { name: name("[bare link]") })).toBeTruthy();
    expect(screen.getByRole("button", { name: name("resolves_to") })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Show them" }));
    expect(hide.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByText("Relationships (4)")).toBeTruthy();
    expect(screen.queryByText(/relationship hidden/)).toBeNull();
  });
});

describe("the timeline", () => {
  it("places undated events apart, never at the other time, and reorders by collection time on request", async () => {
    fakeApi();
    renderAt(`/runs/${RUN_ID}/timeline`);
    const undated = await screen.findByRole("list", { name: "Undated events" });
    expect(undated.textContent).toContain("[DNS source]");
    expect(screen.getByRole("list", { name: "Timeline" }).textContent).toContain("retired-source");
    fireEvent.click(screen.getByRole("button", { name: "Collected time" }));
    await waitFor(() => {
      expect(
        requestsTo("GET", "/api/v1/timeline").some(
          (request) => new URL(request.url).searchParams.get("sortBy") === "collectedAt",
        ),
      ).toBe(true);
    });
    expect(
      screen.getByRole("button", { name: "Collected time" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("the range strip places a tick for each dated event only, in its strength's mark, and says brushing is not built", async () => {
    fakeApi();
    renderAt(`/runs/${RUN_ID}/timeline`);
    await screen.findByRole("list", { name: "Undated events" });
    const range = screen.getByRole("region", { name: "Range" });
    // By observed time: one event has it, the other is undated and has no tick.
    const strip = within(range).getByRole("img", { name: /^1 event placed by observed time/ });
    const ticks = strip.querySelectorAll("line");
    expect(ticks).toHaveLength(1);
    expect(ticks[0]?.getAttribute("data-strength")).toBe("REPORTED");
    expect(ticks[0]?.getAttribute("class")).toContain("text-claim-reported-mark");
    // Its colour is said in words by the key.
    expect(screen.getByText("Marker colours").parentElement?.textContent).toContain("REPORTED");
    expect(within(range).getByText(/Not built yet: choosing a span on the strip/)).toBeTruthy();

    // By collection time both are dated, so both are placed.
    fireEvent.click(screen.getByRole("button", { name: "Collected time" }));
    // The range is drawn afresh once the reordered read arrives.
    const both = await screen.findByRole("img", { name: /^2 events placed by collected time/ });
    expect(screen.getByRole("region", { name: "Range" }).contains(both)).toBe(true);
    expect(
      [...both.querySelectorAll("line")].map((line) => line.getAttribute("data-strength")),
    ).toEqual(["OBSERVED", "REPORTED"]);
  });

  it("with no dated event shown, Range is an em dash with its reason; a cut list labels the range as of the shown events", async () => {
    fakeApi({
      "GET /api/v1/timeline": () =>
        Response.json({
          items: [timelineItem()],
          hasMore: false,
          total: 1,
          withoutObservedAt: 1,
          withoutCollectedAt: 0,
        }),
    });
    renderAt(`/runs/${RUN_ID}/timeline`);
    await screen.findByRole("list", { name: "Undated events" });
    const range = screen.getByRole("region", { name: "Range" });
    // Never computed from the collection time.
    expect(
      within(range).getByRole("button", {
        name: "Not measured. No event shown has an observed time.",
      }),
    ).toBeTruthy();
    expect(range.querySelector("time")).toBeNull();
    // Nothing dated, so nothing is placed: no strip at all, never a tick at the other time.
    expect(range.querySelector("line")).toBeNull();
    // The strengths present, with their words.
    expect(screen.getByText("Marker colours").parentElement?.textContent).toContain("OBSERVED");
    cleanup();

    fakeApi({
      "GET /api/v1/timeline": () => Response.json({ ...TIMELINE, hasMore: true, total: 812 }),
    });
    renderAt(`/runs/${RUN_ID}/timeline`);
    expect(await screen.findByText("Partial: 2 of 812 events.")).toBeTruthy();
    const cut = screen.getByRole("region", { name: "Range" });
    expect(within(cut).getByText("Range of the 2 shown")).toBeTruthy();
    expect(within(cut).getByText("812")).toBeTruthy();
  });
});

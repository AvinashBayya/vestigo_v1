/**
 * The Contradictions panel (M4-3): it renders the contradiction review the
 * case-analysis engine persisted — attribute, entity, each conflicting position
 * with its value, strength and a link back to the supporting evidence — through
 * the real generated client, inventing nothing the API did not provide. It
 * covers the read's states (NONE_YET, PENDING, FAILED, STALE, COMPLETE), an
 * analysis stored before the field existed, a person-gated refusal (Locked, not
 * an error), and a run scope (which has no case analysis).
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Contradictions } from "./workspace/Contradictions.tsx";
import { ProvenanceProvider } from "./workspace/Provenance.tsx";
import type { Scope } from "./workspace/queries.ts";
import {
  CASE_ID,
  DOMAIN_ID,
  EVIDENCE_ID,
  LOCKED,
  problem,
  RUN_ID,
  UNREGISTERED_EVIDENCE,
  workspaceApi,
} from "./workspace/test-fixtures.tsx";

// The generated client captures fetch when it is created, at import time.
const fetchMock = vi.hoisted(() => {
  const mock = vi.fn<(request: Request) => Promise<Response>>();
  vi.stubGlobal("fetch", mock);
  return mock;
});
const { fakeApi } = workspaceApi(fetchMock);

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  vi.restoreAllMocks();
});

const CAVEAT =
  "A contradiction is two or more stored claims that state different values for the same attribute of the same entity. The conflicting positions are shown for review, with the evidence and strength behind each; none is marked correct, and nothing is inferred beyond what the claims state.";

const CONTRADICTION = {
  entityId: DOMAIN_ID,
  attribute: "registrar",
  positions: [
    { value: "[Registrar Alpha]", evidenceIds: [EVIDENCE_ID], strengths: ["REPORTED"] },
    { value: "[Registrar Beta]", evidenceIds: [UNREGISTERED_EVIDENCE], strengths: ["DERIVED"] },
  ],
};

/** A CaseAnalysisRead as the API returns it; the panel reads only these fields. */
function analysisRead(overrides: Record<string, unknown> = {}) {
  const hash = `sha256:${"a".repeat(64)}`;
  return {
    state: "COMPLETE",
    reason: "[complete]",
    caseId: CASE_ID,
    currentInputHash: hash,
    analysis: {
      id: "a0000000-0000-4000-8000-000000000001",
      caseId: CASE_ID,
      inputHash: hash,
      engineVersion: 8,
      requestedByUserId: null,
      requestedAt: "2026-05-01T00:00:00.000Z",
      attempt: 1,
      status: "COMPLETE",
      attemptRequestedAt: "2026-05-01T00:00:00.000Z",
      finishedAt: "2026-05-01T00:00:05.000Z",
      error: null,
      document: { engineVersion: 8, contradictions: { items: [CONTRADICTION], caveat: CAVEAT } },
      wording: null,
    },
    ...overrides,
  };
}

function analyses(read: unknown): Record<string, () => Response> {
  return { [`GET /api/v1/cases/${CASE_ID}/analyses`]: () => Response.json(read) };
}

function renderPanel(scope: Scope): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ProvenanceProvider>
        <Contradictions scope={scope} />
      </ProvenanceProvider>
    </QueryClientProvider>,
  );
}

const caseScope: Scope = { kind: "case", id: CASE_ID };

describe("the Contradictions panel", () => {
  it("renders a persisted contradiction: attribute, entity, both positions, strengths and evidence links", async () => {
    fakeApi(analyses(analysisRead()));
    renderPanel(caseScope);
    // The attribute and the entity (its name resolved from the entity list).
    expect(await screen.findByText("registrar")).toBeTruthy();
    expect(screen.getByText("example.com")).toBeTruthy();
    // Both conflicting values, kept side by side, neither resolved.
    expect(screen.getByText("[Registrar Alpha]")).toBeTruthy();
    expect(screen.getByText("[Registrar Beta]")).toBeTruthy();
    // Strengths in words, and a link back to each position's evidence.
    expect(screen.getByText("REPORTED")).toBeTruthy();
    expect(screen.getByText("DERIVED")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: `Provenance of evidence ${EVIDENCE_ID}` }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: `Provenance of evidence ${UNREGISTERED_EVIDENCE}` }),
    ).toBeTruthy();
    // The analysis's own neutral caveat — nothing is called true.
    expect(screen.getByText(CAVEAT)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/N\/A/);
  });

  it("navigates from a position to its supporting evidence", async () => {
    fakeApi(analyses(analysisRead()));
    renderPanel(caseScope);
    fireEvent.click(
      await screen.findByRole("button", { name: `Provenance of evidence ${EVIDENCE_ID}` }),
    );
    // The provenance drawer opens on that evidence, read through the real client.
    const drawer = await screen.findByRole("dialog");
    expect(await within(drawer).findByText("dns v1.4.0")).toBeTruthy();
    expect(within(drawer).getByText("sha256:[content hash]")).toBeTruthy();
  });

  it("says there are no contradictions when the analysis found none", async () => {
    fakeApi(
      analyses(
        analysisRead({
          analysis: {
            ...analysisRead().analysis,
            document: { engineVersion: 8, contradictions: { items: [], caveat: CAVEAT } },
          },
        }),
      ),
    );
    renderPanel(caseScope);
    expect(await screen.findByText(/No contradictions/)).toBeTruthy();
    expect(screen.queryByText("registrar")).toBeNull();
  });

  it("says no analysis has run yet (NONE_YET)", async () => {
    fakeApi(
      analyses({
        state: "NONE_YET",
        reason: "[none]",
        caseId: CASE_ID,
        currentInputHash: "sha256:x",
        analysis: null,
      }),
    );
    renderPanel(caseScope);
    expect(await screen.findByText(/No analysis of this case has run yet/)).toBeTruthy();
  });

  it("says the analysis is running (PENDING)", async () => {
    fakeApi(
      analyses(
        analysisRead({
          state: "PENDING",
          analysis: {
            ...analysisRead().analysis,
            status: "PENDING",
            finishedAt: null,
            document: null,
          },
        }),
      ),
    );
    renderPanel(caseScope);
    expect(await screen.findByText(/running/)).toBeTruthy();
  });

  it("shows the failure code when the analysis failed (FAILED)", async () => {
    fakeApi(
      analyses(
        analysisRead({
          state: "FAILED",
          analysis: {
            ...analysisRead().analysis,
            status: "FAILED",
            document: null,
            error: { code: "CASE_TOO_LARGE", message: "[too large]" },
          },
        }),
      ),
    );
    renderPanel(caseScope);
    expect(await screen.findByText(/CASE_TOO_LARGE/)).toBeTruthy();
  });

  it("marks a stale analysis and still shows its contradictions (STALE)", async () => {
    fakeApi(analyses(analysisRead({ state: "STALE" })));
    renderPanel(caseScope);
    expect(await screen.findByText(/Stale:/)).toBeTruthy();
    expect(screen.getByText("[Registrar Alpha]")).toBeTruthy();
  });

  it("says an analysis stored before the field predates contradiction review", async () => {
    fakeApi(
      analyses(
        analysisRead({
          state: "STALE",
          analysis: {
            ...analysisRead().analysis,
            engineVersion: 7,
            document: { engineVersion: 7 },
          },
        }),
      ),
    );
    renderPanel(caseScope);
    expect(await screen.findByText(/predates contradiction review/)).toBeTruthy();
    expect(screen.queryByText("[Registrar Alpha]")).toBeNull();
  });

  it("shows Locked, not an error, when the case analysis is person-gated (403)", async () => {
    fakeApi({
      [`GET /api/v1/cases/${CASE_ID}/analyses`]: () =>
        problem(403, "MODULE_NOT_IN_PLAN", "[refused; nothing was returned]", { locked: LOCKED }),
    });
    renderPanel(caseScope);
    expect(await screen.findByText("[the next step]")).toBeTruthy();
    expect(screen.queryByText("registrar")).toBeNull();
  });

  it("a run scope points to a case instead of showing contradictions", () => {
    fakeApi();
    renderPanel({ kind: "run", id: RUN_ID });
    expect(screen.getByText(/Open or build a case/)).toBeTruthy();
  });
});

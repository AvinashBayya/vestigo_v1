/**
 * The Agent-Reach channel collectors through the platform harness, with every
 * production gate. A channel is a LOCAL_ANALYSIS tool container, so it makes no
 * network request (every test asserts the loopback network stayed untouched);
 * the container itself is replaced by an injected runner that returns a
 * synthetic envelope, so the test is of this code — the schema, the
 * normalisation, the outcome, the evidence — never of a live container.
 *
 * Every value below is a bracketed placeholder: no item names a real person,
 * account or post, so nothing here asserts a real-world fact (CLAUDE.md §1).
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  configureAgentReach,
  resetAgentReach,
  type CollectionOutcome,
  type ContainerInvocation,
  type ContainerOutput,
  type DispatchRequest,
} from "../../src/index.ts";
import { AGENT_REACH_COLLECTORS } from "../../src/platform/agent-reach.ts";
import { startHarness, type Harness } from "./harness.ts";

const FULLY_ENTITLED = { plan: "TECHINT_AND_PERSON", vettingStatus: "APPROVED" } as const;

/** The synthetic envelope the injected runner returns next, and the last call it saw. */
let nextOutput: ContainerOutput;
let lastInvocation: ContainerInvocation | null;

function envelope(items: unknown[]): ContainerOutput {
  const json = { collectedAt: "[container-run-time]", items };
  return { json, stdout: JSON.stringify(json) };
}

let harness: Harness;

beforeEach(async () => {
  lastInvocation = null;
  nextOutput = envelope([{ url: "https://example.com/[item]", title: "[an item]" }]);
  configureAgentReach({
    runner: (invocation) => {
      lastInvocation = invocation;
      return Promise.resolve(nextOutput);
    },
    command: "[unused-in-tests]",
    baseArgs: [],
    timeoutMs: 30_000,
    maxOutputBytes: 1_000_000,
  });
  harness = await startHarness({ collectors: AGENT_REACH_COLLECTORS, fixtures: [] });
});

afterEach(async () => {
  // A tool container never reaches the (loopback) network through the fetcher.
  expect(harness.requests).toEqual([]);
  expect(harness.unmatched).toEqual([]);
  await harness.close();
  resetAgentReach();
});

afterAll(() => {
  resetAgentReach();
});

function expectStatus<S extends CollectionOutcome["status"]>(
  outcome: CollectionOutcome,
  status: S,
): Extract<CollectionOutcome, { status: S }> {
  expect(outcome.status, JSON.stringify(outcome)).toBe(status);
  return outcome as Extract<CollectionOutcome, { status: S }>;
}

const run = (
  id: string,
  target: { readonly type: DispatchRequest["target"]["type"]; readonly value: string },
  overrides?: Partial<Omit<DispatchRequest, "target">>,
) => harness.run(id, target, { entitlement: FULLY_ENTITLED, ...overrides });

describe("Agent-Reach channel registration", () => {
  it("registers every channel as a LOCAL_ANALYSIS, DERIVED collector needing no credential", () => {
    for (const collector of AGENT_REACH_COLLECTORS) {
      const entry = harness.runtime.registry.entry(collector.declaration.id);
      expect(entry, collector.declaration.id).toMatchObject({
        collectionMode: "LOCAL_ANALYSIS",
        claimStrength: "DERIVED",
        credentials: { vaultIds: [], runsWithout: true },
      });
      expect(entry.source.network).toBeNull();
    }
  });

  it("lists every channel as PERMITTED by the operator's decision, so each can be toggled per deployment", () => {
    for (const collector of AGENT_REACH_COLLECTORS) {
      expect(
        harness.runtime.registry.entry(collector.declaration.id).commercialUse,
        collector.declaration.id,
      ).toBe("PERMITTED");
    }
  });

  it("includes the people-centric platform channels", () => {
    const ids = AGENT_REACH_COLLECTORS.map((c) => c.declaration.id);
    for (const id of [
      "agent-reach.x",
      "agent-reach.linkedin",
      "agent-reach.reddit",
      "agent-reach.facebook",
      "agent-reach.instagram",
      "agent-reach.xiaohongshu",
    ]) {
      expect(ids, id).toContain(id);
    }
  });

  it("makes the people-centric channels PERSON-discipline", () => {
    for (const id of ["agent-reach.x", "agent-reach.linkedin", "agent-reach.reddit"]) {
      expect(harness.runtime.registry.entry(id).discipline, id).toBe("PERSON");
    }
  });
});

describe("Agent-Reach channel gates", () => {
  it("refuses a PERSON channel without the person module in the plan", async () => {
    const outcome = await run(
      "agent-reach.x",
      { type: "USERNAME", value: "fixture_user" },
      { entitlement: { plan: "TECHINT", vettingStatus: "APPROVED" } },
    );
    expect(expectStatus(outcome, "REFUSED").reason).toBe("MODULE_NOT_IN_PLAN");
  });

  it("refuses a PERSON channel when vetting is not approved", async () => {
    const outcome = await run(
      "agent-reach.linkedin",
      { type: "USERNAME", value: "fixture_user" },
      { entitlement: { plan: "TECHINT_AND_PERSON", vettingStatus: "PENDING" } },
    );
    expect(expectStatus(outcome, "REFUSED").reason).toBe("VETTING_NOT_APPROVED");
  });
});

describe("Agent-Reach channel runs", () => {
  it("passes the channel, action and target to the container as separate argv, never a shell string", async () => {
    await run("agent-reach.reddit", { type: "TOPIC", value: "a b; rm -rf /" });
    expect(lastInvocation?.toolArgs).toEqual(["reddit", "search", "a b; rm -rf /"]);
  });

  it("uses each channel's own Agent-Reach id (X is twitter)", async () => {
    await run("agent-reach.x", { type: "USERNAME", value: "fixture_user" });
    expect(lastInvocation?.toolArgs[0]).toBe("twitter");
  });

  it("states the result's identity itself, taking only items and the time from the container", async () => {
    nextOutput = envelope([
      { url: "https://example.com/[one]", title: "[one]", author: "[a]", publishedAt: "[t]", text: "[x]" },
      { url: "https://example.com/[two]" },
    ]);
    const found = expectStatus(await run("agent-reach.x", { type: "TOPIC", value: "[a topic]" }), "FOUND");
    expect(found.result).toEqual({
      tool: "agent-reach",
      channel: "twitter",
      action: "search",
      query: "[a topic]",
      collectedAt: "[container-run-time]",
      items: [
        { url: "https://example.com/[one]", title: "[one]", author: "[a]", publishedAt: "[t]", text: "[x]" },
        { url: "https://example.com/[two]", title: null, author: null, publishedAt: null, text: null },
      ],
    });
  });

  it("cites its recorded analysis as the one DERIVED evidence item, with no observed date", async () => {
    const found = expectStatus(await run("agent-reach.web", { type: "URL", value: "https://example.com/[p]" }), "FOUND");
    expect(found.evidence).toHaveLength(1);
    expect(found.evidence[0]?.response.kind).toBe("LOCAL");
    expect(found.evidence[0]?.observedAt).toBeNull();
  });

  it("reports NOT_FOUND, citing its recorded analysis, when the container returns no items", async () => {
    nextOutput = envelope([]);
    const notFound = expectStatus(await run("agent-reach.web", { type: "TOPIC", value: "[a topic]" }), "NOT_FOUND");
    expect(notFound.response.kind).toBe("LOCAL");
    expect(notFound.detail).toContain("no items");
  });

  it("reports NOT_FOUND when every returned item is empty, never a found of nothing", async () => {
    nextOutput = envelope([{ url: null, title: null, author: null, publishedAt: null, text: null }]);
    expectStatus(await run("agent-reach.web", { type: "TOPIC", value: "[a topic]" }), "NOT_FOUND");
  });

  it("fails as an unusable response when the container prints the wrong shape", async () => {
    nextOutput = { json: { items: "not-an-array" }, stdout: '{"items":"not-an-array"}' };
    const failed = expectStatus(await run("agent-reach.github", { type: "USERNAME", value: "fixture_user" }), "FAILED");
    expect(failed.error.code).toBe("UPSTREAM_RESPONSE_INVALID");
  });

  it("reports the tool unavailable when the deployment has not configured it", async () => {
    resetAgentReach();
    const outcome = await run("agent-reach.web", { type: "URL", value: "https://example.com/[p]" });
    expect(expectStatus(outcome, "UNAVAILABLE").error.code).toBe("UPSTREAM_UNAVAILABLE");
  });
});

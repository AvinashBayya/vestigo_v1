/**
 * The Hacker News account collector (REWRITE of the previous codebase's HN
 * lookup), run offline through the platform harness against recorded,
 * redacted Firebase and Algolia answers, with synthetic fixtures only for
 * conditions that cannot be provoked on demand. The regression block pins each
 * legacy defect the rewrite removes.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { evidenceDrafts, tenantRegistration, type CollectionOutcome } from "../../src/index.ts";
import {
  HACKERNEWS_ITEMS_PER_PAGE,
  HACKERNEWS_RESULT,
  hackernewsCollector,
} from "../../src/platform/hackernews.ts";
import { loadFixture, startHarness, type Fixture } from "./harness.ts";

const FIREBASE = "hacker-news.firebaseio.com";
const ALGOLIA = "hn.algolia.com";
const LABEL = "Hacker News account (HN API and Algolia HN Search)";
const HANDLE = "fixture-user";

const USER = loadFixture("hackernews", "user-found");
const SEARCH = loadFixture("hackernews", "search-found");
const FOUND_FIXTURES = [USER, SEARCH];

function expectStatus<S extends CollectionOutcome["status"]>(
  outcome: CollectionOutcome,
  status: S,
): Extract<CollectionOutcome, { status: S }> {
  expect(outcome.status, JSON.stringify(outcome)).toBe(status);
  return outcome as Extract<CollectionOutcome, { status: S }>;
}

async function run(fixtures: readonly Fixture[], handle: string = HANDLE) {
  const harness = await startHarness({ collectors: [hackernewsCollector], fixtures });
  try {
    const outcome = await harness.run("hackernews", { type: "USERNAME", value: handle });
    return { outcome, harness };
  } finally {
    await harness.close();
  }
}

const RECORDED_USER = z.object({
  id: z.string(),
  created: z.number(),
  karma: z.number(),
  about: z.string(),
  submitted: z.array(z.number()),
});
const RECORDED_SEARCH = z.object({
  nbHits: z.number(),
  hits: z.array(
    z.object({ objectID: z.string(), created_at: z.string(), _tags: z.array(z.string()) }),
  ),
});

describe("registration", () => {
  it("is labelled by the registry and reads only the Firebase and Algolia hosts", async () => {
    const harness = await startHarness({ collectors: [hackernewsCollector], fixtures: [] });
    await harness.close();
    const entry = harness.runtime.registry.entry("hackernews");
    expect(entry.label).toBe(LABEL);
    expect(tenantRegistration(entry).sourceLabel).toBe(LABEL);
    expect(entry.source.network?.hosts).toEqual([FIREBASE, ALGOLIA]);
    expect(entry.commercialUse).toBe("UNVERIFIED");
    expect(entry).toMatchObject({
      discipline: "SOCMINT",
      targetTypes: ["USERNAME"],
      collectionMode: "PASSIVE_API",
      claimStrength: "REPORTED",
      credentials: { vaultIds: [], runsWithout: true },
    });
  });
});

describe("FOUND: the account and its most recent items", () => {
  it("reads the exact handle, then searches items authored by it, and nothing else", async () => {
    const { harness } = await run(FOUND_FIXTURES);
    expect(harness.unmatched).toEqual([]);
    expect(harness.requests.map((r) => [r.host, r.path])).toEqual(
      FOUND_FIXTURES.map((f) => [f.request.host, f.request.path]),
    );
  });

  it("reports the account as Hacker News gave it", async () => {
    const { outcome } = await run(FOUND_FIXTURES);
    const result = HACKERNEWS_RESULT.parse(expectStatus(outcome, "FOUND").result);
    const recorded = RECORDED_USER.parse(JSON.parse(USER.response.body));
    expect(result.account).toEqual({
      handle: HANDLE,
      created: recorded.created,
      karma: recorded.karma,
      about: recorded.about,
    });
    expect(result.derived).toMatchObject({
      accountCreatedAt: new Date(recorded.created * 1000).toISOString(),
      submittedItemCount: recorded.submitted.length,
    });
  });

  it("reports every indexed item in the index's order, with its own dates", async () => {
    const { outcome } = await run(FOUND_FIXTURES);
    const result = HACKERNEWS_RESULT.parse(expectStatus(outcome, "FOUND").result);
    const recorded = RECORDED_SEARCH.parse(JSON.parse(SEARCH.response.body));
    expect(result.recentItems.items.map((i) => [i.hnItemId, i.createdAt, i.derived.kind])).toEqual(
      recorded.hits.map((h) => [h.objectID, h.created_at, h._tags[0]]),
    );
    expect(result.derived.recentItems.requested).toBe(HACKERNEWS_ITEMS_PER_PAGE);
    expect(result.recentItems.indexedItemCount).toBe(recorded.nbHits);
    expect(result.derived.recentItems.partial).toBe(recorded.nbHits > recorded.hits.length);
  });

  it("reports points only where the index states them, never zero for comments", async () => {
    const { outcome } = await run(FOUND_FIXTURES);
    const result = HACKERNEWS_RESULT.parse(expectStatus(outcome, "FOUND").result);
    const comments = result.recentItems.items.filter((i) => i.derived.kind === "comment");
    const stories = result.recentItems.items.filter((i) => i.derived.kind === "story");
    expect(comments.length).toBeGreaterThan(0);
    expect(stories.length).toBeGreaterThan(0);
    expect(comments.every((i) => i.points === null && i.title === null)).toBe(true);
    expect(stories.every((i) => typeof i.points === "number" && i.title !== null)).toBe(true);
  });

  it("a minimal account and an empty search are FOUND with nulls, not invented values", async () => {
    const { outcome } = await run([
      loadFixture("hackernews", "user-minimal"),
      loadFixture("hackernews", "search-empty"),
    ]);
    const result = HACKERNEWS_RESULT.parse(expectStatus(outcome, "FOUND").result);
    expect(result.account.about).toBeNull();
    expect(result.derived.submittedItemCount).toBeNull();
    expect(result.recentItems).toEqual({ indexedItemCount: 0, items: [] });
    expect(result.derived.recentItems.partial).toBe(false);
  });

  it("cites both responses byte for byte, dated by nothing the sources did not state", async () => {
    const { outcome, harness } = await run(FOUND_FIXTURES);
    const drafts = evidenceDrafts(
      harness.runtime.registry.entry("hackernews"),
      expectStatus(outcome, "FOUND"),
    );
    expect(drafts.map((d) => [d.sourceUrl, d.observedAt])).toEqual(
      FOUND_FIXTURES.map((f) => [`https://${f.request.host}${f.request.path}`, null]),
    );
    expect(drafts.map((d) => new TextDecoder().decode(d.payload))).toEqual(
      FOUND_FIXTURES.map((f) => f.response.body),
    );
  });
});

describe("regressions for the legacy lookup's defects", () => {
  it("no variation probing: a handle that does not exist is one request, then NOT_FOUND", async () => {
    const fixture = loadFixture("hackernews", "user-nonexistent");
    const { outcome, harness } = await run([fixture], "qzxwv-placeholder-nonexistent");
    expectStatus(outcome, "NOT_FOUND");
    expect(harness.requests.map((r) => r.path)).toEqual([fixture.request.path]);
  });

  it("no near matches: a handle in the wrong case is NOT_FOUND, as Hacker News answers it", async () => {
    const { outcome, harness } = await run([loadFixture("hackernews", "user-wrong-case")], "PG");
    expectStatus(outcome, "NOT_FOUND");
    expect(harness.requests).toHaveLength(1);
  });

  it("an answer for another handle is FAILED, never presented as the profile", async () => {
    const { outcome, harness } = await run([loadFixture("hackernews", "user-other-id")]);
    expect(expectStatus(outcome, "FAILED").error.code).toBe("UPSTREAM_RESPONSE_INVALID");
    expect(harness.requests).toHaveLength(1);
  });

  it("an item by another author is FAILED, never attributed to the handle", async () => {
    const { outcome } = await run([USER, loadFixture("hackernews", "search-other-author")]);
    expect(expectStatus(outcome, "FAILED").error.code).toBe("UPSTREAM_RESPONSE_INVALID");
  });

  it("no invented karma: a user without karma is FAILED, not zero", async () => {
    const { outcome } = await run([loadFixture("hackernews", "user-wrong-shape")]);
    expect(expectStatus(outcome, "FAILED").error.code).toBe("UPSTREAM_RESPONSE_INVALID");
  });

  it("no status, verification, nearest-match or mention fields", async () => {
    const { outcome } = await run(FOUND_FIXTURES);
    const text = JSON.stringify(expectStatus(outcome, "FOUND").result);
    expect(text).not.toMatch(/nearest|verified|status|active member|mention/i);
  });
});

describe("statuses", () => {
  it.each([
    ["user-503", null],
    ["user-429", 30_000],
  ] as const)("UNAVAILABLE: %s", async (name, retryAfterMs) => {
    const { outcome } = await run([loadFixture("hackernews", name)]);
    expect(expectStatus(outcome, "UNAVAILABLE").retryAfterMs).toBe(retryAfterMs);
  });

  it("UNAVAILABLE: a search outage after a good profile fails the whole collection", async () => {
    const { outcome, harness } = await run([USER, loadFixture("hackernews", "search-503")]);
    expectStatus(outcome, "UNAVAILABLE");
    expect(harness.requests).toHaveLength(2);
  });

  it.each([
    ["user-401", "UPSTREAM_REFUSED"],
    ["search-wrong-shape", "UPSTREAM_RESPONSE_INVALID"],
  ] as const)("FAILED: %s", async (name, code) => {
    const fixture = loadFixture("hackernews", name);
    const fixtures = fixture.request.host === ALGOLIA ? [USER, fixture] : [fixture];
    const { outcome } = await run(fixtures);
    expect(expectStatus(outcome, "FAILED").error.code).toBe(code);
  });

  it("REFUSED: a target type other than USERNAME never runs", async () => {
    const harness = await startHarness({ collectors: [hackernewsCollector], fixtures: [] });
    try {
      const outcome = await harness.run("hackernews", { type: "DOMAIN", value: "ycombinator.com" });
      expect(expectStatus(outcome, "REFUSED").reason).toBe("TARGET_TYPE_NOT_ACCEPTED");
      expect(harness.requests).toEqual([]);
    } finally {
      await harness.close();
    }
  });
});

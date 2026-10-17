/**
 * reddit.search (2026-10-17) on recorded answers. www.reddit.com answered
 * this deployment's unauthenticated search with its 403 block page when it
 * was recorded: reported as a refusal, never as no posts, and never worked
 * around. With a tenant's OAuth app (the official method) it takes an
 * app-only token and searches oauth.reddit.com; those answers are synthetic
 * until a live one can be recorded. Reddit's source keeps one request a
 * second, shared by every worker. Items follow the news collector's shape.
 */
import { describe, expect, it } from "vitest";
import {
  createPlatformRegistry,
  PLATFORM_COLLECTORS,
  PLATFORM_SOURCES,
  REDDIT_SEARCH_RESULT,
  type CollectionOutcome,
} from "../../src/index.ts";
import { loadFixture, startHarness, type Fixture } from "./harness.ts";

const COLLECTOR = PLATFORM_COLLECTORS.filter((c) => c.declaration.id === "reddit.search");
const topic = (value: string) => ({ type: "TOPIC", value }) as const;
const APP = JSON.stringify({ clientId: "[client id]", clientSecret: "[client secret]" });
const app = (secret = APP) => new Map([["reddit-api", { expose: () => secret }]]);

function expectStatus<S extends CollectionOutcome["status"]>(
  outcome: CollectionOutcome,
  status: S,
): Extract<CollectionOutcome, { status: S }> {
  expect(outcome.status, JSON.stringify(outcome).slice(0, 400)).toBe(status);
  return outcome as Extract<CollectionOutcome, { status: S }>;
}

async function run(
  fixtures: readonly Fixture[],
  phrase: string,
  credentials: ReadonlyMap<string, { expose(): string }> = new Map(),
) {
  const harness = await startHarness({ collectors: COLLECTOR, fixtures });
  try {
    return { outcome: await harness.run("reddit.search", topic(phrase), { credentials }), harness };
  } finally {
    await harness.close();
  }
}

describe("reddit.search without a key: the public JSON endpoint", () => {
  it("reports the recorded 403 block page as a refusal, never as no posts and never as 0 (acceptance b)", async () => {
    const { outcome, harness } = await run(
      [loadFixture("reddit", "public-search-403")],
      "climate change",
    );
    expect(expectStatus(outcome, "FAILED").error.code).toBe("UPSTREAM_REFUSED");
    expect(harness.unmatched).toEqual([]);
    expect(harness.requests.map((request) => request.host)).toEqual(["www.reddit.com"]);
  });

  it("reads a found listing in the documented shape, through the open method", async () => {
    const { outcome } = await run(
      [loadFixture("reddit", "public-search-found")],
      "[an open topic]",
    );
    const result = REDDIT_SEARCH_RESULT.parse(expectStatus(outcome, "FOUND").result);
    expect(result.derived.search.method).toBe("open");
    expect(result.articles[0]?.derived.publishedAt).toBe(new Date(1792123200 * 1000).toISOString());
    // One post, but the listing names a next page: these are the newest only.
    expect(result.articles).toHaveLength(1);
    expect(result.derived.newestPageOnly).toBe(true);
  });
});

describe("reddit.search with the tenant's OAuth app: the official method", () => {
  it("takes an app-only token, searches oauth.reddit.com, and returns every post in the news collector's shape", async () => {
    const { outcome, harness } = await run(
      [loadFixture("reddit", "token"), loadFixture("reddit", "search-found")],
      "climate change",
      app(),
    );
    const found = expectStatus(outcome, "FOUND");
    expect(harness.unmatched).toEqual([]);
    expect(harness.requests.map((r) => [r.method, r.host, r.path.split("?")[0]])).toEqual([
      ["POST", "www.reddit.com", "/api/v1/access_token"],
      ["GET", "oauth.reddit.com", "/search"],
    ]);
    expect(harness.requests[0]?.headers.authorization).toBe(
      `Basic ${Buffer.from("[client id]:[client secret]").toString("base64")}`,
    );
    expect(harness.requests[1]?.headers.authorization).toBe("Bearer [access token]");
    const result = REDDIT_SEARCH_RESULT.parse(found.result);
    expect(result.articles).toHaveLength(3);
    expect(result.articles[0]).toEqual({
      url: "https://news.example.org/[article-1]",
      mobileUrl: null,
      title: "[post title 1]",
      published: 1792130400,
      outletDomain: "news.example.org",
      language: null,
      outletCountry: null,
      socialImageUrl: "https://b.thumbs.redditmedia.com/[thumb-1].jpg",
      derived: {
        permalinkUrl: "https://www.reddit.com/r/[subreddit-1]/comments/[id-1]/[slug-1]/",
        publishedAt: new Date(1792130400 * 1000).toISOString(),
        region: null,
        claimStrengths: { existence: "OBSERVED", content: "REPORTED" },
      },
    });
    // A text post's thumbnail is a word, not an image.
    expect(result.articles[1]).toMatchObject({
      outletDomain: "self.[subreddit-2]",
      socialImageUrl: null,
    });
    // Three posts and no next page: the whole of what Reddit listed.
    expect(result.derived.newestPageOnly).toBe(false);
  });

  it("stores publishedAt null for a post that gives no created_utc: never the time of collection (acceptance c)", async () => {
    const { outcome } = await run(
      [loadFixture("reddit", "token"), loadFixture("reddit", "search-found")],
      "climate change",
      app(),
    );
    const third = REDDIT_SEARCH_RESULT.parse(expectStatus(outcome, "FOUND").result).articles[2];
    expect(third?.published).toBeNull();
    expect(third?.derived.publishedAt).toBeNull();
  });

  it("is EMPTY_UNCONFIRMED when the listing holds no posts: never NOT_FOUND, never 0 (acceptance b)", async () => {
    const { outcome } = await run(
      [loadFixture("reddit", "token"), loadFixture("reddit", "search-empty")],
      "[a topic no post mentions]",
      app(),
    );
    expect(expectStatus(outcome, "EMPTY_UNCONFIRMED").detail).toContain("unconfirmed");
  });

  it("fails, typed, on a credential that is not an OAuth app, and never repeats it", async () => {
    const { outcome, harness } = await run([], "climate change", app("[not json]"));
    const failed = expectStatus(outcome, "FAILED");
    expect(failed.error.code).toBe("CREDENTIAL_MALFORMED");
    expect(JSON.stringify(failed)).not.toContain("[not json]");
    expect(harness.requests).toEqual([]);
  });
});

describe("reddit.search's registration", () => {
  it("reads only Reddit's source, at one request a second shared by every worker, and is UNVERIFIED", () => {
    const entry = createPlatformRegistry().entry("reddit.search");
    expect(entry).toMatchObject({
      label: "Reddit post search (Reddit)",
      discipline: "SOCMINT",
      targetTypes: ["TOPIC"],
      claimStrength: "OBSERVED",
      commercialUse: "UNVERIFIED",
      emptyAnswersUnreliable: true,
      accessMethods: ["open", "official"],
      credentials: { vaultIds: ["reddit-api"], runsWithout: true },
    });
    const source = PLATFORM_SOURCES.find((candidate) => candidate.id === "reddit-api");
    expect(source?.network?.rateLimit).toMatchObject({ requests: 1, intervalSeconds: 1 });
    expect(entry.source.id).toBe("reddit-api");
  });

  it("needs the person module and approved vetting for a topic (Day 1, acceptance d)", async () => {
    const harness = await startHarness({ collectors: COLLECTOR, fixtures: [] });
    try {
      const outcome = await harness.run("reddit.search", topic("climate change"), {
        entitlement: { plan: "TECHINT_AND_PERSON", vettingStatus: "PENDING" },
      });
      expect(expectStatus(outcome, "REFUSED").reason).toBe("VETTING_NOT_APPROVED");
      expect(harness.requests).toEqual([]);
    } finally {
      await harness.close();
    }
  });
});

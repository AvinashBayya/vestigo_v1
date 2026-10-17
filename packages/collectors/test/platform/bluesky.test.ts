/**
 * bluesky.search (2026-10-17) on recorded answers. The public AppView refused
 * an unauthenticated search with 403 when it was recorded, so the collector
 * reports that refusal as a failure, never as no posts. With a tenant's
 * account app password (the official method) it signs in and searches;
 * those answers are synthetic until a live one can be recorded. Items follow
 * the news collector's article shape.
 */
import { describe, expect, it } from "vitest";
import {
  BLUESKY_SEARCH_RESULT,
  createPlatformRegistry,
  PLATFORM_COLLECTORS,
  type RateLimitAnswer,
  type UpstreamRateLimiter,
  type CollectionOutcome,
} from "../../src/index.ts";
import { loadFixture, startHarness, type Fixture } from "./harness.ts";

const COLLECTOR = PLATFORM_COLLECTORS.filter((c) => c.declaration.id === "bluesky.search");
const topic = (value: string) => ({ type: "TOPIC", value }) as const;
const LOGIN = JSON.stringify({
  identifier: "[account].bsky.social",
  appPassword: "[app password]",
});
const account = (secret = LOGIN) => new Map([["bluesky", { expose: () => secret }]]);
const signedIn = [loadFixture("bluesky", "session"), loadFixture("bluesky", "session-closed")];

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
    return {
      outcome: await harness.run("bluesky.search", topic(phrase), { credentials }),
      harness,
    };
  } finally {
    await harness.close();
  }
}

describe("bluesky.search without a key: the public AppView", () => {
  it("reports the recorded 403 as a refusal, never as no posts and never as 0 (acceptance b)", async () => {
    const { outcome, harness } = await run(
      [loadFixture("bluesky", "public-search-403")],
      "climate change",
    );
    const failed = expectStatus(outcome, "FAILED");
    expect(failed.error.code).toBe("UPSTREAM_REFUSED");
    expect(harness.unmatched).toEqual([]);
    expect(harness.requests.map((request) => request.host)).toEqual(["public.api.bsky.app"]);
  });

  it("reads a found page in the documented shape, through the open method", async () => {
    const { outcome } = await run(
      [loadFixture("bluesky", "public-search-found")],
      "[an open topic]",
    );
    const result = BLUESKY_SEARCH_RESULT.parse(expectStatus(outcome, "FOUND").result);
    expect(result.derived.search).toEqual({
      query: '"[an open topic]"',
      sort: "latest",
      limit: 100,
      method: "open",
    });
    // The link is built from the DID in the post's URI, never from the author's
    // handle, which Bluesky shows as "handle.invalid" when it cannot verify it.
    expect(result.articles[0]?.derived.webUrl).toBe(
      "https://bsky.app/profile/did:plc:%5Bauthor-4%5D/post/%5Bpost-4%5D",
    );
    expect(result.derived.newestPageOnly).toBe(false);
  });
});

describe("bluesky.search with the tenant's account app password: the official method", () => {
  it("signs in on bsky.social, searches there, and returns every post in the news collector's shape", async () => {
    const { outcome, harness } = await run(
      [...signedIn, loadFixture("bluesky", "search-found")],
      "climate change",
      account(),
    );
    const found = expectStatus(outcome, "FOUND");
    expect(harness.unmatched).toEqual([]);
    expect(harness.requests.map((r) => [r.method, r.host, r.path.split("?")[0]])).toEqual([
      ["POST", "bsky.social", "/xrpc/com.atproto.server.createSession"],
      ["GET", "bsky.social", "/xrpc/app.bsky.feed.searchPosts"],
      ["POST", "bsky.social", "/xrpc/com.atproto.server.deleteSession"],
    ]);
    // The session's tokens go to the search and to its close, and never into the result.
    expect(harness.requests[1]?.headers.authorization).toBe("Bearer [access token]");
    expect(harness.requests[2]?.headers.authorization).toBe("Bearer [refresh token]");
    expect(JSON.stringify(found.result)).not.toContain("[access token]");
    expect(JSON.stringify(found.result)).not.toContain("[refresh token]");
    const result = BLUESKY_SEARCH_RESULT.parse(found.result);
    expect(result.articles).toHaveLength(3);
    expect(result.articles[0]).toEqual({
      url: "at://did:plc:[author-1]/app.bsky.feed.post/[post-1]",
      mobileUrl: null,
      title: "[post text 1]",
      published: "2026-10-17T05:30:00.000Z",
      outletDomain: null,
      language: "en",
      outletCountry: null,
      socialImageUrl: null,
      derived: {
        webUrl: "https://bsky.app/profile/did:plc:%5Bauthor-1%5D/post/%5Bpost-1%5D",
        publishedAt: "2026-10-17T05:30:00.000Z",
        region: null,
        claimStrengths: { existence: "OBSERVED", content: "REPORTED" },
      },
    });
    expect(result.derived).toMatchObject({
      search: { method: "official" },
      // The page carries a cursor: Bluesky has more posts than this page.
      newestPageOnly: true,
      volume: { count: null, reason: "NOT_MEASURED_BY_A_SEARCH_PAGE" },
    });
  });

  it("stores publishedAt null for a post that gives no createdAt: never the time of collection (acceptance c)", async () => {
    const { outcome } = await run(
      [...signedIn, loadFixture("bluesky", "search-found")],
      "climate change",
      account(),
    );
    const second = BLUESKY_SEARCH_RESULT.parse(expectStatus(outcome, "FOUND").result).articles[1];
    expect(second?.published).toBeNull();
    expect(second?.derived.publishedAt).toBeNull();
    const third = BLUESKY_SEARCH_RESULT.parse(expectStatus(outcome, "FOUND").result).articles[2];
    expect(third?.socialImageUrl).toBe("https://cdn.bsky.app/img/feed_thumbnail/plain/[image-3]");
  });

  it("is EMPTY_UNCONFIRMED when the page holds no posts: never NOT_FOUND, never 0 (acceptance b)", async () => {
    const { outcome } = await run(
      [...signedIn, loadFixture("bluesky", "search-empty")],
      "[a topic no post mentions]",
      account(),
    );
    const empty = expectStatus(outcome, "EMPTY_UNCONFIRMED");
    expect(empty.detail).toContain("unconfirmed");
  });

  it("closes the session even when the search answers an error, and reports the search's failure", async () => {
    const { outcome, harness } = await run(signedIn, "climate change", account());
    expect(expectStatus(outcome, "UNAVAILABLE").error.code).toBe("UPSTREAM_UNAVAILABLE");
    expect(harness.requests.map((r) => r.path.split("?")[0])).toEqual([
      "/xrpc/com.atproto.server.createSession",
      "/xrpc/app.bsky.feed.searchPosts",
      "/xrpc/com.atproto.server.deleteSession",
    ]);
    expect(harness.requests[2]?.headers.authorization).toBe("Bearer [refresh token]");
  });

  it("fails, typed, when the session cannot be closed: never a found result over an open session", async () => {
    const { outcome } = await run(
      [loadFixture("bluesky", "session"), loadFixture("bluesky", "search-found")],
      "climate change",
      account(),
    );
    const unavailable = expectStatus(outcome, "UNAVAILABLE");
    expect(unavailable.error.code).toBe("UPSTREAM_UNAVAILABLE");
    expect(unavailable.error.message).toContain("deleteSession answered 599");
    expect(unavailable.error.message).toContain("the session may still be open");
  });

  /** A limiter that refuses only the nth request, for longer than any request may wait. */
  const refusingRequest = (nth: number): UpstreamRateLimiter => {
    let asked = 0;
    return {
      acquire: () => {
        asked += 1;
        const answer: RateLimitAnswer =
          asked === nth ? { allowed: false, retryAfterMs: 999_999 } : { allowed: true };
        return Promise.resolve(answer);
      },
    };
  };

  async function runLimited(fixtures: readonly Fixture[], rateLimiter: UpstreamRateLimiter) {
    const harness = await startHarness({ collectors: COLLECTOR, fixtures, rateLimiter });
    try {
      return {
        outcome: await harness.run("bluesky.search", topic("climate change"), {
          credentials: account(),
        }),
        harness,
      };
    } finally {
      await harness.close();
    }
  }

  it("closes the session when the search cannot even be sent, and reports the search's failure", async () => {
    // The second request, the search, gets no rate-limit slot: ctx.fetch throws.
    const { outcome, harness } = await runLimited(
      [...signedIn, loadFixture("bluesky", "search-found")],
      refusingRequest(2),
    );
    expect(expectStatus(outcome, "UNAVAILABLE").error.code).toBe("UPSTREAM_RATE_LIMITED");
    expect(harness.requests.map((r) => r.path.split("?")[0])).toEqual([
      "/xrpc/com.atproto.server.createSession",
      "/xrpc/com.atproto.server.deleteSession",
    ]);
    expect(harness.requests[1]?.headers.authorization).toBe("Bearer [refresh token]");
  });

  it("says the session may still be open when its close cannot be sent: never a found result", async () => {
    // The third request, the close, gets no rate-limit slot, after a search that found posts.
    const { outcome, harness } = await runLimited(
      [...signedIn, loadFixture("bluesky", "search-found")],
      refusingRequest(3),
    );
    const unavailable = expectStatus(outcome, "UNAVAILABLE");
    expect(unavailable.error.code).toBe("UPSTREAM_UNAVAILABLE");
    expect(unavailable.error.message).toContain("the session may still be open");
    expect(unavailable.error.message).toContain("UPSTREAM_RATE_LIMITED");
    expect(harness.requests.map((r) => r.path.split("?")[0])).toEqual([
      "/xrpc/com.atproto.server.createSession",
      "/xrpc/app.bsky.feed.searchPosts",
    ]);
  });

  it("fails, typed, on a credential that is not the account's login, and never repeats it", async () => {
    const { outcome, harness } = await run([], "climate change", account("[not json]"));
    const failed = expectStatus(outcome, "FAILED");
    expect(failed.error.code).toBe("CREDENTIAL_MALFORMED");
    expect(JSON.stringify(failed)).not.toContain("[not json]");
    expect(harness.requests).toEqual([]);
  });

  it("uses the key only while the official method is enabled: off, it asks the public AppView", async () => {
    const harness = await startHarness({
      collectors: COLLECTOR,
      fixtures: [loadFixture("bluesky", "public-search-403")],
      accessMethods: ["open"],
    });
    try {
      const outcome = await harness.run("bluesky.search", topic("climate change"), {
        credentials: account(),
      });
      expect(expectStatus(outcome, "FAILED").error.code).toBe("UPSTREAM_REFUSED");
      expect(harness.requests.map((request) => request.host)).toEqual(["public.api.bsky.app"]);
    } finally {
      await harness.close();
    }
  });
});

describe("bluesky.search's registration", () => {
  it("reads only Bluesky's source, takes a topic, and is UNVERIFIED until its terms are recorded", () => {
    const entry = createPlatformRegistry().entry("bluesky.search");
    expect(entry).toMatchObject({
      label: "Bluesky post search (Bluesky public API)",
      discipline: "SOCMINT",
      targetTypes: ["TOPIC"],
      claimStrength: "OBSERVED",
      commercialUse: "UNVERIFIED",
      emptyAnswersUnreliable: true,
      accessMethods: ["open", "official"],
      credentials: { vaultIds: ["bluesky"], runsWithout: true },
    });
    expect(entry.source.id).toBe("bluesky");
  });

  it("needs the person module and approved vetting for a topic (Day 1, acceptance d)", async () => {
    const harness = await startHarness({ collectors: COLLECTOR, fixtures: [] });
    try {
      const outcome = await harness.run("bluesky.search", topic("climate change"), {
        entitlement: { plan: "TECHINT", vettingStatus: "APPROVED" },
      });
      expect(expectStatus(outcome, "REFUSED").reason).toBe("MODULE_NOT_IN_PLAN");
      expect(harness.requests).toEqual([]);
    } finally {
      await harness.close();
    }
  });
});

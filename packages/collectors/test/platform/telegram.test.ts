/**
 * telegram.channel on recorded answers. Telegram's public channel preview
 * (t.me/s/<handle>) is parsed into posts; the parsing carries the three
 * misattribution/encoding fixes ported from the previous codebase
 * (legacy/src/utils/social.ts), each pinned here:
 *   - the reply quote that renders before a post's own text is not collected as
 *     the post's text;
 *   - a video is reported by its mp4, never the poster-frame still;
 *   - entity-only forms like &#036; are decoded, not stored as markup.
 * No live fetch is made: the fixtures are synthetic HTML modelled on the
 * preview's structure (test/fixtures/telegram), so these prove the parser and
 * the collection path, not live Telegram access. The source is UNVERIFIED, so
 * no deployment runs it; a replay never contacts t.me.
 */
import { describe, expect, it } from "vitest";
import {
  createPlatformRegistry,
  PLATFORM_COLLECTORS,
  TELEGRAM_CHANNEL_RESULT,
  type CollectionOutcome,
} from "../../src/index.ts";
import { TELEGRAM_MAX_PAGES } from "../../src/platform/telegram.ts";
import { loadFixture, startHarness, type Fixture } from "./harness.ts";

const COLLECTOR = PLATFORM_COLLECTORS.filter((c) => c.declaration.id === "telegram.channel");
const username = (value: string) => ({ type: "USERNAME", value }) as const;
const fixtures = (...names: string[]): Fixture[] =>
  names.map((name) => loadFixture("telegram", name));

function expectStatus<S extends CollectionOutcome["status"]>(
  outcome: CollectionOutcome,
  status: S,
): Extract<CollectionOutcome, { status: S }> {
  expect(outcome.status, JSON.stringify(outcome).slice(0, 400)).toBe(status);
  return outcome as Extract<CollectionOutcome, { status: S }>;
}

async function run(given: readonly Fixture[], handle: string) {
  const harness = await startHarness({ collectors: COLLECTOR, fixtures: given });
  try {
    return { outcome: await harness.run("telegram.channel", username(handle)), harness };
  } finally {
    await harness.close();
  }
}

describe("telegram.channel: reading one public channel's preview", () => {
  it("parses a page's posts, taking each post's own text and not the reply it quotes", async () => {
    const { outcome, harness } = await run(fixtures("channel-found"), "fixture_channel");
    const result = TELEGRAM_CHANNEL_RESULT.parse(expectStatus(outcome, "FOUND").result);
    expect(harness.unmatched).toEqual([]);
    expect(harness.requests.map((r) => [r.method, r.host, r.path])).toEqual([
      ["GET", "t.me", "/s/fixture_channel"],
    ]);
    expect(result.posts).toHaveLength(3);
    // The reply quote renders first in the slice; it must not become the post's text.
    expect(result.posts[0]).toEqual({
      postRef: "fixture_channel/100",
      datetimeStated: "2026-08-12T14:30:08+00:00",
      derived: {
        url: "https://t.me/fixture_channel/100",
        // <br/> → newline, &#036; → "$", &amp; → "&" (decoded last).
        text: "[real message one] with $200,000 and a & sign\nsecond line",
        publishedAt: "2026-08-12T14:30:08.000Z",
        media: [],
        claimStrengths: { existence: "OBSERVED", content: "REPORTED" },
      },
    });
    expect(JSON.stringify(result)).not.toContain("must not be collected");
    expect(result.derived).toEqual({
      channel: { handle: "fixture_channel", webUrl: "https://t.me/s/fixture_channel" },
      pages: { fetched: 1, bound: TELEGRAM_MAX_PAGES, stoppedBecause: "NO_OLDER_PAGE" },
      newestPostsOnly: true,
      volume: { count: null, reason: "PREVIEW_IS_NOT_THE_FULL_HISTORY" },
    });
  });

  it("keeps a media-only post with empty text, and never invents a date it was not given", async () => {
    const { outcome } = await run(fixtures("channel-found"), "fixture_channel");
    const result = TELEGRAM_CHANNEL_RESULT.parse(expectStatus(outcome, "FOUND").result);
    expect(result.posts[1]).toEqual({
      postRef: "fixture_channel/99",
      datetimeStated: null,
      derived: {
        url: "https://t.me/fixture_channel/99",
        text: null,
        publishedAt: null,
        media: [
          {
            url: "https://cdn4.telesco.pe/file/photo99.jpg",
            type: "image",
            thumbnailUrl: "https://cdn4.telesco.pe/file/photo99.jpg",
          },
        ],
        claimStrengths: { existence: "OBSERVED", content: "REPORTED" },
      },
    });
  });

  it("reports a video by its mp4, never the poster-frame still (ported regression)", async () => {
    const { outcome } = await run(fixtures("channel-video"), "clips_channel");
    const result = TELEGRAM_CHANNEL_RESULT.parse(expectStatus(outcome, "FOUND").result);
    expect(result.posts[0]?.derived.media).toEqual([
      {
        url: "https://cdn4.telesco.pe/file/clip5.mp4",
        type: "video",
        thumbnailUrl: "https://cdn4.telesco.pe/file/poster5.jpg",
      },
    ]);
  });
});

describe("telegram.channel: bounded pagination and deduplication", () => {
  it("follows the page's own older-messages link and de-duplicates posts seen on both pages", async () => {
    const { outcome, harness } = await run(
      fixtures("channel-page1", "channel-page2"),
      "pagedchannel",
    );
    const result = TELEGRAM_CHANNEL_RESULT.parse(expectStatus(outcome, "FOUND").result);
    expect(result.posts.map((p) => p.postRef)).toEqual([
      "pagedchannel/100",
      "pagedchannel/99",
      "pagedchannel/98",
      "pagedchannel/97",
      "pagedchannel/96",
    ]);
    // Post 98 appears on both pages; it is kept once, in its first (newest) position.
    expect(result.posts.filter((p) => p.postRef === "pagedchannel/98")).toHaveLength(1);
    expect(result.derived.pages).toEqual({
      fetched: 2,
      bound: TELEGRAM_MAX_PAGES,
      stoppedBecause: "NO_OLDER_PAGE",
    });
    expect(harness.requests.map((r) => r.path)).toEqual([
      "/s/pagedchannel",
      "/s/pagedchannel?before=98",
    ]);
    expect(harness.unmatched).toEqual([]);
  });

  it("stops at the page bound, never requesting the next page the last one links to", async () => {
    const { outcome, harness } = await run(
      fixtures("channel-bound-1", "channel-bound-2", "channel-bound-3"),
      "boundchannel",
    );
    const result = TELEGRAM_CHANNEL_RESULT.parse(expectStatus(outcome, "FOUND").result);
    expect(result.posts.map((p) => p.postRef)).toEqual([
      "boundchannel/30",
      "boundchannel/29",
      "boundchannel/28",
    ]);
    expect(result.derived.pages).toEqual({
      fetched: TELEGRAM_MAX_PAGES,
      bound: TELEGRAM_MAX_PAGES,
      stoppedBecause: "PAGE_BOUND_REACHED",
    });
    // Page 3 links to ?before=28, which is never fetched.
    expect(harness.requests.map((r) => r.path)).toEqual([
      "/s/boundchannel",
      "/s/boundchannel?before=30",
      "/s/boundchannel?before=29",
    ]);
    expect(harness.unmatched).toEqual([]);
  });
});

describe("telegram.channel: honest status handling", () => {
  it("reports a 404 as not found, citing the response, never as no posts", async () => {
    const { outcome } = await run(fixtures("channel-404"), "missingchannel");
    const notFound = expectStatus(outcome, "NOT_FOUND");
    expect(notFound.detail).toContain("no public preview");
  });

  it("is UNAVAILABLE with the retry-after on a 429, never a failure that cannot be retried", async () => {
    const { outcome } = await run(fixtures("channel-429"), "busychannel");
    const unavailable = expectStatus(outcome, "UNAVAILABLE");
    expect(unavailable.error.code).toBe("UPSTREAM_UNAVAILABLE");
    expect(unavailable.retryAfterMs).toBe(120_000);
  });

  it("is EMPTY_UNCONFIRMED when a 200 page carries no readable messages: never NOT_FOUND, never 0", async () => {
    const { outcome } = await run(fixtures("channel-empty"), "silentchannel");
    const empty = expectStatus(outcome, "EMPTY_UNCONFIRMED");
    expect(empty.detail).toContain("unconfirmed");
  });

  it("fails as not searchable, sending nothing, for a username that cannot be a Telegram handle", async () => {
    const { outcome, harness } = await run([], "has-hyphen");
    expect(expectStatus(outcome, "FAILED").error.code).toBe("TARGET_NOT_SEARCHABLE");
    expect(harness.requests).toEqual([]);
  });
});

describe("telegram.channel's registration", () => {
  it("reads only Telegram's preview source, takes a username, and is UNVERIFIED until its terms are recorded", () => {
    const entry = createPlatformRegistry().entry("telegram.channel");
    expect(entry).toMatchObject({
      label: "Telegram public channel preview",
      discipline: "SOCMINT",
      targetTypes: ["USERNAME"],
      collectionMode: "PASSIVE_PUBLIC_WEB",
      claimStrength: "OBSERVED",
      commercialUse: "UNVERIFIED",
      availability: "UNVERIFIED",
      accessMethods: ["open"],
      credentials: { vaultIds: [], runsWithout: true },
    });
    expect(entry.source.id).toBe("telegram-preview");
  });
});

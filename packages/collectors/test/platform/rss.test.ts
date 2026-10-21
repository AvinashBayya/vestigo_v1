/**
 * RSS (2026-10-17): one collector per publishing domain in the verified feed
 * list, on recorded feeds (test/fixtures/rss, recorded-redacted from the live
 * check). Each item follows the news collector's article shape, with the
 * source's own date as given and, derived, publishedAt (null when the item
 * has none, never invented) and region. Finding nothing in a feed's newest
 * items is EMPTY_UNCONFIRMED, never "0 articles"; a feed that cannot be read
 * is a typed failure, never empty. Every source is UNVERIFIED, so these run
 * only through the harness's replay of recorded answers.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { RSS_PUBLISHERS } from "../../src/data/rss-feeds.ts";
import {
  createPlatformRegistry,
  PLATFORM_SOURCES,
  RSS_COLLECTORS,
  RSS_RESULT,
  type CollectionOutcome,
} from "../../src/index.ts";
import { parseFeed, readableText, type FeedItem } from "../../src/platform/feed.ts";
import { isoFromStatedDate } from "../../src/platform/monitoring.ts";
import { phraseMatcher } from "../../src/platform/rss.ts";
import { FIXTURES_DIR, loadFixture, startHarness, type Fixture } from "./harness.ts";

const topic = (value: string) => ({ type: "TOPIC", value }) as const;

/** The live check of every feed URL (2026-10-17): what was kept, and why each other one was not. */
const SNAPSHOT = z
  .object({
    checkedAt: z.string(),
    counts: z
      .object({
        fetched: z.number().int(),
        kept: z.number().int(),
        failed: z.number().int(),
        excluded: z.number().int(),
      })
      .strict(),
    indianOutletsAdded: z.array(z.string()),
    kept: z.array(
      z.object({
        url: z.string(),
        name: z.string(),
        origin: z.string(),
        country: z
          .string()
          .regex(/^[A-Z]{2}$/)
          .nullable(),
      }),
    ),
    failed: z.array(
      z.object({ url: z.string(), name: z.string(), origin: z.string(), why: z.string().min(1) }),
    ),
    excluded: z.array(
      z.object({
        url: z.string(),
        name: z.string(),
        origin: z.string(),
        reason: z.enum(["GOOGLE_NEWS_BLOCKED", "NINTH_INDIAN_OUTLET"]),
        verified: z.boolean(),
      }),
    ),
  })
  .parse(
    JSON.parse(
      readFileSync(join(FIXTURES_DIR, "..", "snapshots", "rss-feed-verification.json"), "utf8"),
    ),
  );

/** A synthetic answer at a recorded feed's address. */
function answering(
  feed: Fixture,
  status: number,
  body: string,
  contentType = "text/html",
): Fixture {
  return {
    provenance: {
      kind: "synthetic",
      source: feed.provenance.source,
      recordedOn: "2026-10-17",
      notes: `[test: the feed answering ${String(status)}]`,
    },
    request: feed.request,
    response: { status, headers: { "content-type": contentType }, body },
  };
}

/** Every recorded feed of a publisher, by its file name under test/fixtures/rss. */
const FIXTURES: Readonly<Record<string, readonly string[]>> = {
  "rss.bbci-co-uk": [
    "bbci-co-uk-hindi",
    "bbci-co-uk-news-world-africa",
    "bbci-co-uk-news-world-asia",
    "bbci-co-uk-news-world-latin_america",
    "bbci-co-uk-news-world-middle_east",
    "bbci-co-uk-news-world",
    "bbci-co-uk-persian",
  ],
  "rss.ndtv-via-feedburner": [
    "ndtv-via-feedburner-ndtvkhabar-latest",
    "ndtv-via-feedburner-ndtvnews-top-stories",
  ],
  "rss.theverge-com": ["theverge-com-ai-artificial-intelligence-index", "theverge-com-index"],
  "rss.thehindu-com": ["thehindu-com-feeder-default"],
};

const recorded = (id: string): Fixture[] =>
  (FIXTURES[id] ?? []).map((name) => loadFixture("rss", name));

function expectStatus<S extends CollectionOutcome["status"]>(
  outcome: CollectionOutcome,
  status: S,
): Extract<CollectionOutcome, { status: S }> {
  expect(outcome.status, JSON.stringify(outcome).slice(0, 400)).toBe(status);
  return outcome as Extract<CollectionOutcome, { status: S }>;
}

async function run(id: string, fixtures: readonly Fixture[], phrase: string) {
  const collector = RSS_COLLECTORS.find((entry) => entry.declaration.id === id);
  if (collector === undefined) throw new Error(`no collector ${id}`);
  const harness = await startHarness({ collectors: [collector], fixtures });
  try {
    return { outcome: await harness.run(id, topic(phrase)), harness };
  } finally {
    await harness.close();
  }
}

const RESULT = RSS_RESULT;

describe("reading a feed", () => {
  it("reads every item of a recorded RSS feed, each value as its text has it", () => {
    const body = loadFixture("rss", "bbci-co-uk-news-world").response.body;
    const feed = parseFeed(body);
    expect(feed.kind).toBe("rss");
    expect(feed.items).toHaveLength(33);
    expect(feed.items[1]).toMatchObject({
      title: "[news-world headline 2]",
      link: "https://www.bbc.co.uk/[news-world-article-2]",
    });
    for (const item of feed.items) expect(body).toContain(item.published);
  });

  it("reads an Atom feed's entries, their alternate links and their dates", () => {
    const feed = parseFeed(loadFixture("rss", "theverge-com-index").response.body);
    expect(feed.kind).toBe("atom");
    expect(feed.language).toBe("en-US");
    expect(feed.items).toHaveLength(10);
    expect(feed.items[0]?.link).toBe("https://www.theverge.com/[index-article-1]");
    expect(feed.items[0]?.published).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("decodes entities and drops markup only for reading, never in what it reports", () => {
    expect(readableText("[a] &amp; [b] &#8212; &#x2014; <b>[c]</b> &lt;i&gt;[d]&lt;/i&gt;")).toBe(
      "[a] & [b] — — [c] [d]",
    );
    expect(readableText("&#1114112; &unknown;")).toBe("&#1114112; &unknown;");
    // HTML's named entities, case-sensitive as in HTML.
    expect(readableText("M&uuml;nchen &ndash; Pe&ntilde;a, d&rsquo;Ivoire &Uuml; &frac12;")).toBe(
      "München – Peña, d’Ivoire Ü ½",
    );
    expect(readableText("&UUML; &Rsquo;")).toBe("&UUML; &Rsquo;");
    // A name an object's prototype has is no entity: never "function Object() …".
    expect(readableText("[a] &constructor; &CONSTRUCTOR; &toString; &amp;constructor; [b]")).toBe(
      "[a] &constructor; &CONSTRUCTOR; &toString; &constructor; [b]",
    );
  });

  it("passes over a video's media:content for its poster image, and names no video as an image", () => {
    const image = (inner: string) =>
      parseFeed(
        `<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><item><title>[t]</title><link>https://example.org/[a]</link>${inner}</item></channel></rss>`,
      ).items[0]?.image;
    expect(
      image(
        '<media:content url="https://example.org/[v].mov" medium="video"><media:thumbnail url="https://example.org/[poster].jpg"/></media:content>',
      ),
    ).toBe("https://example.org/[poster].jpg");
    expect(image('<media:content url="https://example.org/[v].mp4" medium="video"/>')).toBeNull();
    expect(image('<media:content url="https://example.org/[v].mp4" type="video/mp4"/>')).toBeNull();
    expect(
      image(
        '<media:content url="https://example.org/[v]/index.m3u8" type="application/vnd.apple.mpegurl"/>',
      ),
    ).toBeNull();
    // One that states neither medium nor type is taken as given, as many feeds state neither.
    expect(image('<media:content url="https://example.org/[i].jpg" width="140"/>')).toBe(
      "https://example.org/[i].jpg",
    );
    expect(image('<media:content url="https://example.org/[i]" medium="image"/>')).toBe(
      "https://example.org/[i]",
    );
  });

  it("reads an Atom entry's own title, link and date, never those of the <source> it was copied from", () => {
    const source =
      '<source><title>[source feed]</title><link rel="alternate" href="https://example.org/[source]"/><updated>2020-01-01T00:00:00Z</updated></source>';
    const entry = (inner: string) =>
      parseFeed(`<feed xmlns="http://www.w3.org/2005/Atom"><entry>${inner}</entry></feed>`)
        .items[0];
    expect(
      entry(
        `${source}<title>[entry]</title><link rel="alternate" href="https://example.org/[entry]"/><updated>2026-10-17T00:00:00Z</updated>`,
      ),
    ).toMatchObject({
      title: "[entry]",
      link: "https://example.org/[entry]",
      published: "2026-10-17T00:00:00Z",
    });
    // An entry whose only link is rel="self" has no link of its own: never its source's.
    expect(
      entry(`<title>[entry]</title><link rel="self" href="https://example.org/[self]"/>${source}`)
        ?.link,
    ).toBeNull();
  });

  it("refuses a body that is neither RSS nor Atom, as a failure, never an empty feed", () => {
    expect(() => parseFeed("<html><body>[not a feed]</body></html>")).toThrow(
      /not an RSS or Atom feed/,
    );
  });

  it("takes an Atom entry's alternate link, or its first without a rel, never self, replies or enclosure", () => {
    const entry = (links: string) =>
      parseFeed(
        `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>[t]</title>${links}</entry></feed>`,
      ).items[0]?.link;
    expect(
      entry(
        '<link rel="self" href="https://example.org/[self]"/><link rel="replies" href="https://example.org/[replies]"/><link rel="enclosure" href="https://example.org/[file]"/><link rel="alternate" href="https://example.org/[page]"/>',
      ),
    ).toBe("https://example.org/[page]");
    expect(
      entry(
        '<link rel="self" href="https://example.org/[self]"/><link href="https://example.org/[page]"/>',
      ),
    ).toBe("https://example.org/[page]");
    expect(entry('<link rel="self" href="https://example.org/[self]"/>')).toBeNull();
  });

  it("takes an RSS item's guid as its link only when it has no <link> and the guid is a permalink URL", () => {
    const item = (inner: string) =>
      parseFeed(
        `<rss version="2.0"><channel><item><title>[t]</title>${inner}</item></channel></rss>`,
      ).items[0]?.link;
    expect(item("<guid>https://example.org/[permalink]</guid>")).toBe(
      "https://example.org/[permalink]",
    );
    expect(item('<guid isPermaLink="false">https://example.org/[an id]</guid>')).toBeNull();
    expect(item("<guid>[an id that is not a URL]</guid>")).toBeNull();
    expect(
      item("<link>https://example.org/[link]</link><guid>https://example.org/[guid]</guid>"),
    ).toBe("https://example.org/[link]");
  });

  it("reads a hostile body in time proportional to its length: items that never close fail fast", () => {
    const openings = "<item><title>[t]</title>".repeat(45_000); // about 1 MB
    const started = performance.now();
    expect(() => parseFeed(`<rss version="2.0"><channel>${openings}</channel></rss>`)).toThrow(
      /never closes/,
    );
    // The same openings with one close at the end: one item, read once, not once per opening.
    expect(
      parseFeed(`<rss version="2.0"><channel>${openings}</item></channel></rss>`).items,
    ).toHaveLength(1);
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it("decodes and matches a hostile item in time proportional to its length, as it parses it", () => {
    // Well-formed XML for about a million "<" characters with no ">" after any of them.
    const title = "&amp;lt;".repeat(250_000);
    const started = performance.now();
    const [item] = parseFeed(
      `<rss version="2.0"><channel><item><title>${title}</title><link>https://example.org/[a]</link></item></channel></rss>`,
    ).items;
    expect(item === undefined ? null : phraseMatcher("[x]")(item)).toBe(false);
    expect(readableText("<".repeat(1_000_000)).length).toBe(1_000_000);
    expect(readableText("&a".repeat(500_000)).length).toBe(1_000_000);
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it("reads a date only when it states its zone after a time: never this server's local reading", () => {
    // A date that ends in a dash and a year states no zone: "-2026" is not an offset.
    for (const zoneless of [
      "10-17-2026",
      "17-Oct-2026",
      "Oct-17-2026",
      "Thu, 17-Oct-2026",
      "2026-10-17",
      "Sat, 17 Oct 2026",
      "2026-10-17T05:30:00",
      "Sat, 17 Oct 2026 05:30:00",
    ]) {
      expect(isoFromStatedDate(zoneless), zoneless).toBeNull();
    }
    expect(isoFromStatedDate("Sat, 17 Oct 2026 05:30:00 +0530")).toBe("2026-10-17T00:00:00.000Z");
    expect(isoFromStatedDate("Sat, 17 Oct 2026 05:30:00 GMT")).toBe("2026-10-17T05:30:00.000Z");
    expect(isoFromStatedDate("2026-10-17T05:30:00.250+05:30")).toBe("2026-10-17T00:00:00.250Z");
    expect(isoFromStatedDate("2026-10-17T05:30:00Z")).toBe("2026-10-17T05:30:00.000Z");
    expect(isoFromStatedDate(null)).toBeNull();
  });

  it("reads a date field by field: never a year, day or order a lenient parser would fill in", () => {
    for (const [stated, why] of [
      ["Sat, 17 Oct 10:00:00 +0530", "no year"],
      ["Sat, 31 Feb 2026 10:00:00 +0530", "a day February does not have"],
      ["2026-02-31T10:00:00Z", "a day February does not have"],
      ["05-10-2026 10:00:00 +0530", "day-first or month-first, unknowable"],
      ["10/11/2026 10:00:00 GMT", "day-first or month-first, unknowable"],
      ["Oct 2026 10:00 GMT", "no day"],
      ["2026 10:00 GMT", "no month or day"],
      ["12 10:00 Z", "no month or year"],
      ["Sat, 17 Oct 2026 10:00:00 +0599", "an offset of 99 minutes"],
      ["Mon, 17 Oct 2026 10:00 GMT", "17 October 2026 is a Saturday"],
      ["Sat, 17 Oct 20226 10:00:00 +0530", "a five-digit year"],
      ["+012026-10-17T10:00:00Z", "a five-digit year"],
      ["17 Oct 26 10:00 GMT", "a two-digit year with no weekday to confirm it"],
      ["Sat, 17 Oct 2026 10:00:00 A", "a military zone other than Z states none"],
      ["2026-10-17T24:00:00Z", "hour 24"],
      ["9999-12-31T23:30:00-01:00", "an instant after the year 9999"],
      ["0000-01-01T00:30:00+01:00", "an instant before the year 0000"],
    ] as const) {
      expect(isoFromStatedDate(stated), `${stated}: ${why}`).toBeNull();
    }
    // RFC 2822's two-digit years (00-49 are 20xx), when the weekday confirms them,
    // as CISA's feed writes them.
    expect(isoFromStatedDate("Sat, 17 Oct 26 10:00 GMT")).toBe("2026-10-17T10:00:00.000Z");
    expect(isoFromStatedDate("Saturday, 17 October 2026 10:00 EDT")).toBe(
      "2026-10-17T14:00:00.000Z",
    );
    expect(isoFromStatedDate("Sat, 17 Oct 2026 05:30:00 +05:30")).toBe("2026-10-17T00:00:00.000Z");
    expect(isoFromStatedDate("2026-10-17t05:30:00.2509z")).toBe("2026-10-17T05:30:00.250Z");
  });
});

describe("matching a topic in a feed's items", () => {
  const item = (title: string | null, summary: string | null = null): FeedItem => ({
    title,
    summary,
    link: "https://example.org/[an article]",
    published: null,
    image: null,
  });

  it("matches whole words only, in any script: AI is not in 'said', भारत is not in भारतीय", () => {
    const ai = phraseMatcher("AI");
    expect(ai(item("[a minister] said [x]"))).toBe(false);
    expect(ai(item("[x] AIs [y]"))).toBe(false);
    expect(ai(item("[x] AI [y]"))).toBe(true);
    expect(ai(item("[x] (ai), [y]"))).toBe(true);
    expect(phraseMatcher("भारत")(item("[x] भारतीय [y]"))).toBe(false);
    expect(phraseMatcher("भारत")(item("[x] भारत [y]"))).toBe(true);
  });

  it("matches the title and the summary each on its own, never a phrase made across them", () => {
    const phrase = phraseMatcher("climate change");
    expect(phrase(item("[a] climate", "change [b]"))).toBe(false);
    expect(phrase(item("[a]", "[b] Climate Change [c]"))).toBe(true);
    expect(phrase(item(null, "[b] climate change"))).toBe(true);
  });

  it("reads spacing, entities, markup and composed characters as a reader would", () => {
    expect(phraseMatcher("climate   change")(item("[a] climate change"))).toBe(true);
    expect(phraseMatcher("climate change")(item("[a] climate\n   change [b]"))).toBe(true);
    expect(phraseMatcher("R&D")(item("[a] R&amp;D [b]"))).toBe(true);
    expect(phraseMatcher("climate change")(item("[a] <b>climate</b> change"))).toBe(true);
    // Typographic apostrophes and dashes match their plain forms, decoded or not.
    expect(phraseMatcher("Côte d'Ivoire")(item("Côte d’Ivoire [votes]"))).toBe(true);
    expect(phraseMatcher("[a]'s [b]")(item("[a]&#8217;s [b]"))).toBe(true);
    expect(phraseMatcher("[a]'s [b]")(item("[a]&rsquo;s [b]"))).toBe(true);
    expect(phraseMatcher("[a]-[b]")(item("[a]–[b]"))).toBe(true);
    // Named entities, in escaped markup as feeds write it, decode before matching.
    expect(
      phraseMatcher("München")(
        item(null, "&lt;p&gt;[x] M&amp;uuml;nchen &amp;ndash; [y]&lt;/p&gt;"),
      ),
    ).toBe(true);
    expect(phraseMatcher("café")(item("[a] café [b]"))).toBe(true);
  });
});

describe("an RSS collector on a topic: real items, in the news collector's shape", () => {
  it("returns the items that mention the topic, with their source's values and a measured date", async () => {
    const { outcome, harness } = await run(
      "rss.bbci-co-uk",
      recorded("rss.bbci-co-uk"),
      "[news-world headline 2]",
    );
    const found = expectStatus(outcome, "FOUND");
    expect(harness.unmatched).toEqual([]);
    // Every BBC feed was read, each once.
    expect(harness.requests).toHaveLength(7);
    const result = RESULT.parse(found.result);
    expect(result.articles).toHaveLength(1);
    const [article] = result.articles;
    expect(article).toEqual({
      url: "https://www.bbc.co.uk/[news-world-article-2]",
      mobileUrl: null,
      title: "[news-world headline 2]",
      published: expect.stringMatching(/GMT$/) as unknown,
      outletDomain: null,
      language: "en-gb",
      outletCountry: null,
      socialImageUrl: "https://ichef.bbci.co.uk/[news-world-image-2].jpg",
      derived: {
        titleText: "[news-world headline 2]",
        linkUrl: "https://www.bbc.co.uk/[news-world-article-2]",
        publishedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/) as unknown,
        // The catalog records the BBC's country as GB; the feed's en-gb is a
        // language, not the source of this.
        region: "GB",
        feedUrl: "https://feeds.bbci.co.uk/news/world/rss.xml",
        claimStrengths: { existence: "OBSERVED", content: "REPORTED" },
      },
    });
    expect(new Date(article?.derived.publishedAt ?? "").toUTCString()).toBe(article?.published);
    // Evidence cites the feed the item came from, and only that one.
    expect(found.evidence).toHaveLength(1);
    expect(found.evidence[0]?.response.kind === "NETWORK" && found.evidence[0].response.url).toBe(
      "https://feeds.bbci.co.uk/news/world/rss.xml",
    );
    expect(result.derived.feedsRead).toHaveLength(7);
    expect(result.derived.volume).toEqual({ count: null, reason: "NOT_MEASURED_BY_A_FEED" });
  });

  it("stores publishedAt null for an item whose feed gives it no date: never the time of collection (acceptance c)", async () => {
    // BBC Hindi's recorded feed: its second item carries no <pubDate>, as received.
    const body = loadFixture("rss", "bbci-co-uk-hindi").response.body;
    expect(parseFeed(body).items[1]?.published).toBeNull();
    const { outcome } = await run(
      "rss.bbci-co-uk",
      recorded("rss.bbci-co-uk"),
      "[hindi headline 2]",
    );
    const [article] = RESULT.parse(expectStatus(outcome, "FOUND").result).articles;
    expect(article?.published).toBeNull();
    expect(article?.derived.publishedAt).toBeNull();
  });

  it("reads no date it cannot place: a date with no time zone is null, never this server's local reading", async () => {
    const feed = loadFixture("rss", "thehindu-com-feeder-default");
    const zoneless = {
      ...feed,
      provenance: {
        ...feed.provenance,
        kind: "synthetic" as const,
        notes: "[test: one date without its zone]",
      },
      response: {
        ...feed.response,
        body: feed.response.body.replace(
          /(<item>[\s\S]*?<pubDate>)<!\[CDATA\[([^\]]*?) \+0530\]\]>/,
          "$1$2",
        ),
      },
    };
    const { outcome } = await run("rss.thehindu-com", [zoneless], "[feeder-default headline 1]");
    const [article] = RESULT.parse(expectStatus(outcome, "FOUND").result).articles;
    expect(article?.published).toMatch(/:\d{2}$/);
    expect(article?.derived.publishedAt).toBeNull();
  });

  it("stores a malformed date as null on its own item: never a failed run that loses the other items", async () => {
    const hindu = loadFixture("rss", "thehindu-com-feeder-default");
    const feed = answering(
      hindu,
      200,
      `<rss version="2.0"><channel><title>[channel]</title><item><title>[a headline] one</title><link>https://www.thehindu.com/[one]</link><pubDate>Sat, 17 Oct 2026 10:00:00 +0530</pubDate></item><item><title>[a headline] two</title><link>https://www.thehindu.com/[two]</link><pubDate>Sat, 17 Oct 20226 10:00:00 +0530</pubDate></item></channel></rss>`,
      "application/rss+xml",
    );
    const { outcome } = await run("rss.thehindu-com", [feed], "[a headline]");
    const result = RESULT.parse(expectStatus(outcome, "FOUND").result);
    expect(result.articles.map((article) => article.derived.publishedAt)).toEqual([
      "2026-10-17T04:30:00.000Z",
      null,
    ]);
    expect(result.articles[1]?.published).toBe("Sat, 17 Oct 20226 10:00:00 +0530");
  });

  it("tags an Indian outlet's items with its country, from the feed list, and no other outlet's", async () => {
    const { outcome } = await run(
      "rss.ndtv-via-feedburner",
      recorded("rss.ndtv-via-feedburner"),
      "[ndtvnews-top-stories headline 1]",
    );
    const [article] = RESULT.parse(expectStatus(outcome, "FOUND").result).articles;
    expect(article?.derived.region).toBe("IN");
    // Its date is NDTV's own, in its own zone, read to the instant.
    expect(article?.published).toMatch(/\+0530$/);
    expect(article?.derived.publishedAt).toMatch(/Z$/);
    // Each publisher's country is the one the live check records for every one
    // of its feeds: never a copy of this list, and never mixed within a publisher.
    const countryOf = new Map(SNAPSHOT.kept.map((feed) => [feed.url, feed.country]));
    for (const entry of RSS_PUBLISHERS) {
      expect([...new Set(entry.feeds.map((url) => countryOf.get(url)))], entry.id).toEqual([
        entry.country,
      ]);
    }
    // The Indian set is whatever the snapshot records, not a frozen count, and
    // the twelve original Indian publishers are still among them.
    const indianPublishers = RSS_PUBLISHERS.filter((entry) => entry.country === "IN");
    expect(indianPublishers.length).toBeGreaterThanOrEqual(12);
    for (const id of ["rss.thehindu-com", "rss.ndtv-via-feedburner", "rss.aajtak-in"]) {
      expect(indianPublishers.map((entry) => entry.id)).toContain(id);
    }
  });

  it("reads an Atom feed's entry the same way", async () => {
    const { outcome } = await run(
      "rss.theverge-com",
      recorded("rss.theverge-com"),
      "[index headline 1]",
    );
    const [article] = RESULT.parse(expectStatus(outcome, "FOUND").result).articles;
    expect(article).toMatchObject({
      url: "https://www.theverge.com/[index-article-1]",
      language: "en-US",
      derived: { publishedAt: expect.stringMatching(/Z$/) as unknown },
    });
  });
});

describe("an RSS collector that finds nothing, or cannot read a feed (acceptance b)", () => {
  it("is EMPTY_UNCONFIRMED when no newest item mentions the topic: never NOT_FOUND, never 0 articles", async () => {
    const { outcome } = await run(
      "rss.bbci-co-uk",
      recorded("rss.bbci-co-uk"),
      "[a topic no item mentions]",
    );
    const empty = expectStatus(outcome, "EMPTY_UNCONFIRMED");
    expect(empty.detail).toContain("unconfirmed");
    expect(empty.detail).toContain("newest items");
    expect(JSON.stringify(empty)).not.toMatch(/"count":0|0 articles/);
  });

  it("fails, typed, when a feed answers 503 or 403 or is not a feed: never an empty answer", async () => {
    const hindu = loadFixture("rss", "thehindu-com-feeder-default");
    const unavailable = expectStatus(
      (await run("rss.thehindu-com", [answering(hindu, 503, "[busy]")], "[x]")).outcome,
      "UNAVAILABLE",
    );
    expect(unavailable.error.code).toBe("UPSTREAM_UNAVAILABLE");
    const refused = expectStatus(
      (await run("rss.thehindu-com", [answering(hindu, 403, "[forbidden]")], "[x]")).outcome,
      "FAILED",
    );
    expect(refused.error.code).toBe("UPSTREAM_REFUSED");
    const notFeed = expectStatus(
      (await run("rss.thehindu-com", [answering(hindu, 200, "<html>[a page]</html>")], "[x]"))
        .outcome,
      "FAILED",
    );
    expect(notFeed.error.code).toBe("UPSTREAM_RESPONSE_INVALID");
  });

  it("fails the whole job when its last feed cannot be read, after earlier ones matched: never a quiet partial", async () => {
    // BBC's feeds are read in list order, Persian last. Without its recording the
    // harness answers it 599, after the World feed has already matched the topic.
    const fixtures = recorded("rss.bbci-co-uk").filter(
      (fixture) => !fixture.request.path.startsWith("/persian/"),
    );
    const { outcome, harness } = await run("rss.bbci-co-uk", fixtures, "[news-world headline 2]");
    const unavailable = expectStatus(outcome, "UNAVAILABLE");
    expect(unavailable.error.code).toBe("UPSTREAM_UNAVAILABLE");
    expect(harness.requests).toHaveLength(7);
    expect(harness.unmatched).toEqual(["feeds.bbci.co.uk/persian/rss.xml"]);
    expect(JSON.stringify(outcome)).not.toContain("[news-world-article-2]");
  });

  it("fails the whole job when a middle feed refuses, and reads no further", async () => {
    const fixtures = recorded("rss.bbci-co-uk").map((fixture) =>
      fixture.request.path.startsWith("/news/world/middle_east/")
        ? answering(fixture, 403, "[forbidden]")
        : fixture,
    );
    const { outcome, harness } = await run("rss.bbci-co-uk", fixtures, "[news-world headline 2]");
    expect(expectStatus(outcome, "FAILED").error.code).toBe("UPSTREAM_REFUSED");
    // Hindi, Africa, Asia, Latin America, then Middle East refused: World and Persian never asked.
    expect(harness.requests).toHaveLength(5);
  });
});

describe("an RSS item that mentions the topic but gives no link", () => {
  const hindu = loadFixture("rss", "thehindu-com-feeder-default");
  const feed = (items: string) =>
    answering(
      hindu,
      200,
      `<rss version="2.0"><channel><title>[channel]</title>${items}</channel></rss>`,
      "application/rss+xml",
    );

  it("is counted, and the empty answer says so: never dropped as though the feed did not mention it", async () => {
    const { outcome } = await run(
      "rss.thehindu-com",
      [feed("<item><title>[a linkless headline]</title></item>")],
      "[a linkless headline]",
    );
    const empty = expectStatus(outcome, "EMPTY_UNCONFIRMED");
    expect(empty.detail).toContain("1 of the newest items");
    expect(empty.detail).toContain("give no link");
    expect(empty.detail).toContain("unconfirmed");
  });

  it("is counted beside the items that can be cited", async () => {
    const { outcome } = await run(
      "rss.thehindu-com",
      [
        feed(
          "<item><title>[a headline] one</title><link>https://www.thehindu.com/[article]</link></item><item><title>[a headline] two</title></item>",
        ),
      ],
      "[a headline]",
    );
    const result = RESULT.parse(expectStatus(outcome, "FOUND").result);
    expect(result.articles.map((article) => article.url)).toEqual([
      "https://www.thehindu.com/[article]",
    ]);
    expect(result.derived.feedsRead).toEqual([
      {
        feedUrl: "https://www.thehindu.com/feeder/default.rss",
        itemsListed: 2,
        itemsWithoutLink: 1,
        itemsMentioning: 2,
        itemsMentioningWithoutLink: 1,
      },
    ]);
  });
});

describe("the RSS collectors' registration", () => {
  const registry = createPlatformRegistry();

  it("lists exactly the feeds the live check kept, none from Google News, eight Indian outlets added", () => {
    expect(RSS_PUBLISHERS.flatMap((entry) => entry.feeds).sort()).toEqual(
      SNAPSHOT.kept.map((feed) => feed.url).sort(),
    );
    expect(JSON.stringify(RSS_PUBLISHERS)).not.toContain("news.google.com");
    expect(SNAPSHOT.indianOutletsAdded).toHaveLength(8);
    const added = SNAPSHOT.kept.filter((feed) => feed.origin === "indian-outlet-candidate");
    expect(added.map((feed) => feed.name).sort()).toEqual([...SNAPSHOT.indianOutletsAdded].sort());
  });

  it("accounts for every URL the live check fetched: kept, failed with its reason, or left out and why", () => {
    const { counts, kept, failed, excluded } = SNAPSHOT;
    expect([kept.length, failed.length, excluded.length]).toEqual([
      counts.kept,
      counts.failed,
      counts.excluded,
    ]);
    expect(counts.kept + counts.failed + counts.excluded).toBe(counts.fetched);
    const urls = [...kept, ...failed, ...excluded].map((feed) => feed.url);
    expect(new Set(urls).size).toBe(urls.length);
    // Google News is left out whatever it answered; nothing else is left out but the ninth Indian outlet.
    for (const feed of [...kept, ...failed]) expect(feed.url).not.toContain("news.google.com");
    for (const feed of excluded) {
      expect(feed.reason === "GOOGLE_NEWS_BLOCKED", feed.url).toBe(
        feed.url.includes("news.google.com"),
      );
    }
    const ninth = excluded.filter((feed) => feed.reason === "NINTH_INDIAN_OUTLET");
    expect(ninth).toHaveLength(1);
    expect(ninth[0]).toMatchObject({ origin: "indian-outlet-candidate", verified: true });
    // Every Indian candidate is one of the eight added, the ninth, or a failure with its reason.
    const indian = (feeds: readonly { origin: string; name: string }[]) =>
      feeds.filter((feed) => feed.origin === "indian-outlet-candidate").map((feed) => feed.name);
    expect(indian(kept).sort()).toEqual([...SNAPSHOT.indianOutletsAdded].sort());
    expect(indian(excluded)).toEqual(ninth.map((feed) => feed.name));
    expect(indian(failed).length).toBeGreaterThan(0);
  });

  it("keeps no recorded category in a redacted fixture, as text or as Atom's term and label", () => {
    const redacted = Object.values(FIXTURES)
      .flat()
      .map((name) => ({ name, fixture: loadFixture("rss", name) }))
      .filter(({ fixture }) => fixture.provenance.kind === "recorded-redacted");
    expect(redacted).toHaveLength(12);
    for (const { name, fixture } of redacted) {
      const body = fixture.response.body;
      // The items' categories, as the notes say: the channel is kept as received.
      const items = body.slice(Math.max(0, body.search(/<(?:item|entry)[\s>]/i)));
      // An element with text, never a self-closing one (Atom states its category in attributes).
      for (const [, , text] of items.matchAll(
        /<(category|dc:subject)\b(?:[^>]*[^/>])?>([\s\S]*?)<\/\1\s*>/gi,
      )) {
        expect(text, name).toBe("[category]");
      }
      for (const [, value] of body.matchAll(
        /<(?:category|media:category)\b[^>]*\s(?:term|label)\s*=\s*["']([^"']*)["']/gi,
      )) {
        expect(value, name).toBe("[category]");
      }
    }
  });

  it("registers one collector per publisher, on its own UNVERIFIED source with its own limit, taking a topic", () => {
    expect(RSS_COLLECTORS).toHaveLength(RSS_PUBLISHERS.length);
    for (const entry of RSS_PUBLISHERS) {
      const collector = registry.entry(entry.id);
      expect(collector.source.id).toBe(entry.id);
      expect(collector).toMatchObject({
        discipline: "MEDIAINT",
        targetTypes: ["TOPIC"],
        claimStrength: "OBSERVED",
        commercialUse: "UNVERIFIED",
        emptyAnswersUnreliable: true,
        accessMethods: ["open"],
      });
      expect(collector.source.network?.rateLimit).toMatchObject({
        requests: 1,
        intervalSeconds: 2,
        basis: "SELF_IMPOSED",
      });
      for (const operator of collector.source.network?.operators ?? []) {
        expect(collector.label, entry.id).toContain(operator.name);
      }
    }
    const ids = PLATFORM_SOURCES.filter((source) => source.id.startsWith("rss.")).map((s) => s.id);
    expect(ids.sort()).toEqual(RSS_PUBLISHERS.map((entry) => entry.id).sort());
  });

  it("needs the person module and approved vetting for a topic, as every TOPIC run does (Day 1, acceptance d)", async () => {
    const harness = await startHarness({
      collectors: RSS_COLLECTORS.filter((c) => c.declaration.id === "rss.thehindu-com"),
      fixtures: [],
    });
    try {
      for (const [entitlement, reason] of [
        [{ plan: "TECHINT", vettingStatus: "APPROVED" }, "MODULE_NOT_IN_PLAN"],
        [{ plan: "TECHINT_AND_PERSON", vettingStatus: "PENDING" }, "VETTING_NOT_APPROVED"],
      ] as const) {
        const outcome = await harness.run("rss.thehindu-com", topic("[x]"), { entitlement });
        expect(expectStatus(outcome, "REFUSED").reason).toBe(reason);
      }
      expect(harness.requests).toEqual([]);
    } finally {
      await harness.close();
    }
  });
});

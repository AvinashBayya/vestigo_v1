/**
 * RSS: one collector per publishing domain in the verified feed list
 * (src/data/rss-feeds.ts), each reading only its own source's feeds. For a
 * topic, it reads each feed and keeps the items whose title or summary
 * contains the topic's phrase as whole words. A feed lists only its newest items, so finding
 * none is EMPTY_UNCONFIRMED ("returned nothing — unconfirmed"), never "0
 * articles"; a feed that cannot be read is a typed failure, never an empty
 * result. Every source is UNVERIFIED until the owner records the publisher's
 * terms, so these run only on recorded answers in tests (owner ruling,
 * 2026-10-17).
 */
import { z } from "zod";
import { defineCollector, type Collector, type EvidenceItem } from "../contract.ts";
import { RSS_COUNTRY_CODES, RSS_PUBLISHERS, type RssPublisher } from "../data/rss-feeds.ts";
import { UpstreamRejectedError, UpstreamResponseError } from "../errors.ts";
import type { CapturedResponse } from "../fetcher/capture.ts";
import { parseFeed, readableText, type FeedItem } from "./feed.ts";
import {
  isoFromStatedDate,
  ITEM_CLAIM_STRENGTHS,
  itemClaimStrengths,
  REPORTED_TEXT,
  topicPhrase,
  unavailableUnlessPermanent,
} from "./monitoring.ts";

const FEED_TIMEOUT_MS = 20_000;

const RSS_ARTICLE = z
  .object({
    /**
     * The item's `<link>` (Atom: its alternate link's href), or, with no
     * `<link>`, its permalink `<guid>`, exactly as the feed's text has it.
     */
    url: z.string().min(1),
    /** A feed gives no separate mobile URL. */
    mobileUrl: z.null(),
    /** The item's `<title>` as the feed's text has it (entities and all); null when it has none. */
    title: REPORTED_TEXT,
    /**
     * The item's own date, as given: `<pubDate>`, `<dc:date>`, Atom
     * `<published>` or `<updated>`. Null when the feed gives the item none.
     */
    published: REPORTED_TEXT,
    /** A feed does not state its outlet's domain. */
    outletDomain: z.null(),
    /** The feed's `<language>` (Atom: `xml:lang`), as given; null when it states none. */
    language: REPORTED_TEXT,
    /** A feed does not state its outlet's country (see derived.region). */
    outletCountry: z.null(),
    /**
     * An image the item names: a `media:content` not marked as another medium
     * or type (a video is passed over), a `media:thumbnail`, an image enclosure.
     */
    socialImageUrl: REPORTED_TEXT,
    /** Computed by this collector (src/provenance.ts). */
    derived: z
      .object({
        /** The title as a reader sees it: entities decoded, markup removed. */
        titleText: z.string().nullable(),
        /** The link resolved against its feed's URL; null when it is not a URL. */
        linkUrl: z.url().nullable(),
        /**
         * `published` in ISO 8601. Null when the feed gives the item no date,
         * or one without a time zone: never the time of this collection.
         */
        publishedAt: z.iso.datetime().nullable(),
        /** The outlet's country (ISO 3166-1 alpha-2) where the feed list records one (src/data/rss-feeds.ts); else null. */
        region: z.enum(RSS_COUNTRY_CODES).nullable(),
        /** The feed it came from. */
        feedUrl: z.url(),
        claimStrengths: ITEM_CLAIM_STRENGTHS,
      })
      .strict(),
  })
  .strict();

export const RSS_RESULT = z
  .object({
    /**
     * Every item of the publisher's feeds that mentions the topic and gives a
     * link, in feed order. One that mentions it with no link cannot be cited:
     * it is counted in feedsRead.itemsMentioningWithoutLink.
     */
    articles: z.array(RSS_ARTICLE).min(1),
    derived: z
      .object({
        search: z
          .object({
            /** The phrase looked for, as whole words and case-insensitively, in each item's title and in its summary. */
            phrase: z.string().min(1),
            /** Every feed read. */
            feeds: z.array(z.url()).min(1),
          })
          .strict(),
        /** Each feed as read: how many items it listed, and how many mentioned the topic. */
        feedsRead: z
          .array(
            z
              .object({
                feedUrl: z.url(),
                itemsListed: z.number().int().min(0),
                itemsWithoutLink: z.number().int().min(0),
                itemsMentioning: z.number().int().min(0),
                /** Of those, the ones with no link: counted here, never cited as articles. */
                itemsMentioningWithoutLink: z.number().int().min(0),
              })
              .strict(),
          )
          .min(1),
        /** A feed lists only its newest items: these are not everything the outlet published. */
        newestItemsOnly: z.literal(true),
        /** How much coverage matches: never measured from a feed's newest items. */
        volume: z.object({ count: z.null(), reason: z.literal("NOT_MEASURED_BY_A_FEED") }).strict(),
      })
      .strict(),
  })
  .strict();

export type RssResult = z.infer<typeof RSS_RESULT>;
type RssArticle = z.infer<typeof RSS_ARTICLE>;

/** The collector's label: names every operator of the hosts it reads. */
export function rssLabel(publisher: RssPublisher): string {
  const operators = publisher.operators.map((operator) => operator.name);
  const others = operators.filter((name) => name !== publisher.publisher);
  return others.length === 0
    ? `News feeds of ${publisher.publisher} (RSS)`
    : `News feeds of ${publisher.publisher} (RSS, via ${others.join(", ")})`;
}

function refuseUnlessOk(response: CapturedResponse, feedUrl: string): void {
  if (response.status === 200) return;
  const unavailable = unavailableUnlessPermanent(response, `The feed ${feedUrl}`);
  if (unavailable !== null) throw unavailable;
  if (response.status === 401 || response.status === 403) {
    throw new UpstreamRejectedError(
      `the feed ${feedUrl} refused the request with ${String(response.status)}`,
    );
  }
  throw new UpstreamResponseError(`the feed ${feedUrl} answered ${String(response.status)}`);
}

function absolute(link: string, base: string): string | null {
  const decoded = readableText(link);
  return URL.canParse(decoded, base) ? new URL(decoded, base).toString() : null;
}

function toArticle(
  item: FeedItem & { readonly link: string },
  language: string | null,
  feedUrl: string,
  publisher: RssPublisher,
): RssArticle {
  return {
    url: item.link,
    mobileUrl: null,
    title: item.title,
    published: item.published,
    outletDomain: null,
    language,
    outletCountry: null,
    socialImageUrl: item.image,
    derived: {
      titleText: item.title === null ? null : readableText(item.title),
      linkUrl: absolute(item.link, feedUrl),
      publishedAt: isoFromStatedDate(item.published),
      region: publisher.country,
      feedUrl,
      claimStrengths: itemClaimStrengths,
    },
  };
}

/**
 * Whether an item mentions the phrase: as whole words (letters, marks and
 * digits on either side end a word, so "AI" is not in "said", in any script),
 * case-insensitively, in its title or in its summary, each on its own, so a
 * title's last word and a summary's first never make a phrase together.
 */
export function phraseMatcher(phrase: string): (item: FeedItem) => boolean {
  const words = folded(phrase)
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${words}(?![\\p{L}\\p{M}\\p{N}])`, "iu");
  return (item) =>
    [item.title, item.summary].some(
      (field) => field !== null && pattern.test(folded(readableText(field))),
    );
}

/**
 * Text and phrase alike, before matching: composed (NFC), with typographic
 * apostrophes and dashes as their plain forms, so "Côte d’Ivoire" is found for
 * "Côte d'Ivoire" and an en dash for a hyphen.
 */
function folded(text: string): string {
  return (
    text
      .normalize("NFC")
      // U+2018, U+2019, U+02BC, U+0060, U+00B4: to U+0027.
      .replace(/[‘’ʼ`´]/g, "'")
      // U+2010 to U+2015, U+2212: to U+002D.
      .replace(/[‐-―−]/g, "-")
  );
}

function rssCollector(publisher: RssPublisher): Collector {
  return defineCollector(
    {
      id: publisher.id,
      version: "1.0.0",
      displayName: rssLabel(publisher),
      discipline: "MEDIAINT",
      targetTypes: ["TOPIC"],
      collectionMode: "PASSIVE_PUBLIC_WEB",
      source: publisher.id,
      credentials: { vaultIds: [], runsWithout: true },
      claimStrength: "OBSERVED",
      // Every feed, each waiting its turn in the source's limit.
      timeoutMs: Math.min(1_800_000, 10_000 + publisher.feeds.length * (FEED_TIMEOUT_MS + 5_000)),
      resultSchema: RSS_RESULT,
      emptyAnswersUnreliable: true,
    },
    async (ctx) => {
      const phrase = topicPhrase(ctx.target, "An RSS feed");
      const mentions = phraseMatcher(phrase);
      const articles: RssArticle[] = [];
      let mentionedWithoutLink = 0;
      const evidence: EvidenceItem[] = [];
      const feedsRead: RssResult["derived"]["feedsRead"] = [];
      let firstResponse: CapturedResponse | null = null;
      for (const feedUrl of publisher.feeds) {
        const response = await ctx.fetch(feedUrl, {
          method: "GET",
          timeoutMs: FEED_TIMEOUT_MS,
          headers: {
            accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
          },
        });
        refuseUnlessOk(response, feedUrl);
        const feed = parseFeed(response.text());
        firstResponse ??= response;
        // Every item is checked; one that mentions the topic but gives no link
        // cannot be cited as an article, and is counted, never dropped unsaid.
        const mentioning = feed.items.filter(mentions);
        const matching = mentioning.filter(
          (item): item is FeedItem & { readonly link: string } => item.link !== null,
        );
        mentionedWithoutLink += mentioning.length - matching.length;
        feedsRead.push({
          feedUrl,
          itemsListed: feed.items.length,
          itemsWithoutLink: feed.items.filter((item) => item.link === null).length,
          itemsMentioning: mentioning.length,
          itemsMentioningWithoutLink: mentioning.length - matching.length,
        });
        if (matching.length > 0) {
          evidence.push({ response, observedAt: null });
          articles.push(
            ...matching.map((item) => toArticle(item, feed.language, feedUrl, publisher)),
          );
        }
      }
      const [firstEvidence, ...otherEvidence] = evidence;
      if (firstResponse === null) {
        throw new UpstreamResponseError(`${publisher.publisher} has no feed to read`);
      }
      if (firstEvidence === undefined || articles.length === 0) {
        const feeds = `${publisher.publisher}'s ${String(publisher.feeds.length)} feed(s)`;
        return ctx.emptyUnconfirmed(
          firstResponse,
          mentionedWithoutLink > 0
            ? `${String(mentionedWithoutLink)} of the newest items in ${feeds} mention this topic but give no link, so none can be cited — unconfirmed: a feed lists only its newest items.`
            : `None of the newest items in ${feeds} mentions this topic — unconfirmed: a feed lists only its newest items, never everything the outlet published.`,
        );
      }
      return ctx.found(
        {
          articles,
          derived: {
            search: { phrase, feeds: [...publisher.feeds] },
            feedsRead,
            newestItemsOnly: true,
            volume: { count: null, reason: "NOT_MEASURED_BY_A_FEED" },
          },
        },
        [firstEvidence, ...otherEvidence],
      );
    },
  );
}

/** One collector per publisher in the verified feed list, in its order. */
export const RSS_COLLECTORS: readonly Collector[] = RSS_PUBLISHERS.map(rssCollector);

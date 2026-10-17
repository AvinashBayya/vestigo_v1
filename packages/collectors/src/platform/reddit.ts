/**
 * reddit.search: Reddit posts that contain a topic's phrase, newest first.
 * Without a key it asks the public JSON endpoint (www.reddit.com/search.json),
 * which answered this deployment's address with Reddit's 403 block page on
 * 2026-10-17 (test/fixtures/reddit/public-search-403.json): a refusal,
 * reported as one, never as no posts, and never worked around. With the
 * tenant's OAuth app (vault id "reddit-api", the official method) it takes an
 * app-only token and searches oauth.reddit.com. Reddit's source keeps its
 * limit of one request a second, shared by every worker. An empty listing is
 * EMPTY_UNCONFIRMED. UNVERIFIED: Reddit's Data API terms must be read before
 * it runs (docs/monitoring/MONITORING-PLAN.md, D-M8).
 */
import { z } from "zod";
import { defineCollector, type Collector } from "../contract.ts";
import {
  CredentialMalformedError,
  UpstreamRejectedError,
  UpstreamResponseError,
} from "../errors.ts";
import type { CapturedResponse } from "../fetcher/capture.ts";
import {
  ITEM_CLAIM_STRENGTHS,
  itemClaimStrengths,
  REPORTED_TEXT,
  topicPhrase,
  unavailableUnlessPermanent,
} from "./monitoring.ts";

export const REDDIT_SEARCH_LIMIT = 100;
const FETCH_TIMEOUT_MS = 20_000;

/** The documented listing (https://www.reddit.com/dev/api/#GET_search), as far as it is read. */
const LINK = z.object({
  kind: z.literal("t3"),
  data: z.object({
    title: z.string().optional(),
    url: z.string().optional(),
    permalink: z.string().min(1),
    created_utc: z.number().optional(),
    domain: z.string().optional(),
    thumbnail: z.string().optional(),
  }),
});
const LISTING = z.object({
  kind: z.literal("Listing"),
  /** `after` names the next page; null when Reddit has none. */
  data: z.object({ children: z.array(z.unknown()), after: z.string().nullable().optional() }),
});
const TOKEN = z.object({ access_token: z.string().min(1) });
const APP = z.object({ clientId: z.string().min(1), clientSecret: z.string().min(1) }).strict();

const REDDIT_ARTICLE = z
  .object({
    /** The post's `url`, as Reddit gives it: the linked page, or the post itself for a text post. */
    url: z.string().min(1),
    mobileUrl: z.null(),
    /** The post's `title`, as given. */
    title: REPORTED_TEXT,
    /** The post's `created_utc`, as given: seconds since 1970 (UTC); null when it gives none. */
    published: z.number().nullable(),
    /** The post's `domain`, as given (`self.<subreddit>` for a text post). */
    outletDomain: REPORTED_TEXT,
    /** Reddit states no language for a post. */
    language: z.null(),
    outletCountry: z.null(),
    /** The post's `thumbnail` when it is a URL (Reddit also sends words such as "self"). */
    socialImageUrl: REPORTED_TEXT,
    derived: z
      .object({
        /** The post on reddit.com, from its `permalink`. */
        permalinkUrl: z.url(),
        /** `published` in ISO 8601; null when the post gives none. */
        publishedAt: z.iso.datetime().nullable(),
        /** Reddit states no region for a post. */
        region: z.null(),
        claimStrengths: ITEM_CLAIM_STRENGTHS,
      })
      .strict(),
  })
  .strict();

export const REDDIT_SEARCH_RESULT = z
  .object({
    /** Every post in the listing, in Reddit's order, none dropped. */
    articles: z.array(REDDIT_ARTICLE).min(1),
    derived: z
      .object({
        search: z
          .object({
            query: z.string().min(1),
            sort: z.literal("new"),
            limit: z.literal(REDDIT_SEARCH_LIMIT),
            method: z.enum(["open", "official"]),
          })
          .strict(),
        /**
         * A full page, or one that names a next page: the newest posts only,
         * out of a number Reddit does not give.
         */
        newestPageOnly: z.boolean(),
        volume: z
          .object({ count: z.null(), reason: z.literal("NOT_MEASURED_BY_A_SEARCH_PAGE") })
          .strict(),
      })
      .strict(),
  })
  .strict();

type RedditArticle = z.infer<typeof REDDIT_ARTICLE>;

function reported(value: string | undefined): string | null {
  return value === undefined || value.trim().length === 0 ? null : value;
}

function refuseUnlessOk(response: CapturedResponse, asked: string): void {
  if (response.status === 200) return;
  const unavailable = unavailableUnlessPermanent(response, asked);
  if (unavailable !== null) throw unavailable;
  if (response.status === 401 || response.status === 403) {
    throw new UpstreamRejectedError(`${asked} was refused with ${String(response.status)}`);
  }
  throw new UpstreamResponseError(`${asked} answered ${String(response.status)}`);
}

function parsed<T>(schema: z.ZodType<T>, response: CapturedResponse, what: string): T {
  const result = schema.safeParse(response.json());
  if (!result.success) throw new UpstreamResponseError(`${what} is not the documented shape`);
  return result.data;
}

function toArticle(link: z.infer<typeof LINK>): RedditArticle | null {
  const { data } = link;
  const url = reported(data.url);
  if (url === null) return null;
  const thumbnail = reported(data.thumbnail);
  return {
    url,
    mobileUrl: null,
    title: reported(data.title),
    published: data.created_utc ?? null,
    outletDomain: reported(data.domain),
    language: null,
    outletCountry: null,
    socialImageUrl: thumbnail !== null && /^https?:\/\//.test(thumbnail) ? thumbnail : null,
    derived: {
      permalinkUrl: new URL(data.permalink, "https://www.reddit.com").toString(),
      publishedAt:
        data.created_utc === undefined ? null : new Date(data.created_utc * 1000).toISOString(),
      region: null,
      claimStrengths: itemClaimStrengths,
    },
  };
}

export const redditSearchCollector: Collector = defineCollector(
  {
    id: "reddit.search",
    version: "1.0.0",
    displayName: "Reddit post search (Reddit)",
    discipline: "SOCMINT",
    targetTypes: ["TOPIC"],
    collectionMode: "PASSIVE_API",
    source: "reddit-api",
    credentials: { vaultIds: ["reddit-api"], runsWithout: true },
    claimStrength: "OBSERVED",
    timeoutMs: 60_000,
    resultSchema: REDDIT_SEARCH_RESULT,
    emptyAnswersUnreliable: true,
  },
  async (ctx) => {
    const query = `"${topicPhrase(ctx.target, "Reddit's post search")}"`;
    const params = new URLSearchParams({
      q: query,
      sort: "new",
      limit: String(REDDIT_SEARCH_LIMIT),
      type: "link",
      raw_json: "1",
    }).toString();
    const secret = ctx.credentials.get("reddit-api");
    let response: CapturedResponse;
    let method: "open" | "official";
    if (secret === null) {
      method = "open";
      response = await ctx.fetch(`https://www.reddit.com/search.json?${params}`, {
        method: "GET",
        timeoutMs: FETCH_TIMEOUT_MS,
        headers: { accept: "application/json" },
      });
    } else {
      method = "official";
      let app: z.infer<typeof APP>;
      try {
        app = APP.parse(JSON.parse(secret.expose()));
      } catch {
        throw new CredentialMalformedError(
          "reddit-api",
          'JSON of the form {"clientId": …, "clientSecret": …}',
        );
      }
      const basic = Buffer.from(`${app.clientId}:${app.clientSecret}`).toString("base64");
      const token = await ctx.fetch("https://www.reddit.com/api/v1/access_token", {
        method: "POST",
        timeoutMs: FETCH_TIMEOUT_MS,
        headers: {
          authorization: `Basic ${basic}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
      });
      refuseUnlessOk(token, "Reddit's token request");
      const { access_token: accessToken } = parsed(TOKEN, token, "Reddit's token");
      response = await ctx.fetch(`https://oauth.reddit.com/search?${params}`, {
        method: "GET",
        timeoutMs: FETCH_TIMEOUT_MS,
        headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
      });
    }
    refuseUnlessOk(response, "Reddit's post search");
    const listing = parsed(LISTING, response, "Reddit's search answer");
    // Only posts (t3) are searched for; anything else in the listing is a changed answer.
    const links = listing.data.children.map((child) => {
      const link = LINK.safeParse(child);
      if (!link.success)
        throw new UpstreamResponseError("Reddit's listing holds something other than posts");
      return link.data;
    });
    const articles = links.map(toArticle);
    if (articles.some((article) => article === null)) {
      throw new UpstreamResponseError("a post in Reddit's listing has no url");
    }
    const kept = articles.filter((article): article is RedditArticle => article !== null);
    if (kept.length === 0) {
      return ctx.emptyUnconfirmed(
        response,
        "Reddit's post search returned nothing for this topic — unconfirmed: a search index is not every post.",
      );
    }
    return ctx.found(
      {
        articles: kept,
        derived: {
          search: { query, sort: "new", limit: REDDIT_SEARCH_LIMIT, method },
          newestPageOnly:
            (listing.data.after ?? null) !== null || links.length >= REDDIT_SEARCH_LIMIT,
          volume: { count: null, reason: "NOT_MEASURED_BY_A_SEARCH_PAGE" },
        },
      },
      [{ response, observedAt: null }],
    );
  },
);

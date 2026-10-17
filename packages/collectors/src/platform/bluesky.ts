/**
 * bluesky.search: Bluesky posts that contain a topic's phrase, newest first,
 * through `app.bsky.feed.searchPosts`. Without a key it asks the public
 * AppView (public.api.bsky.app), which answered 403 to an unauthenticated
 * search on 2026-10-17 (test/fixtures/bluesky/public-search-403.json): that is
 * a refusal, reported as one, never as no posts. With the tenant's account
 * app password (vault id "bluesky", the official method) it opens a session
 * on bsky.social, searches there, and closes the session whatever the search
 * answered. A close that fails, or cannot be sent, is reported as a failure
 * that says the session may still be open, never dropped. An empty page is
 * EMPTY_UNCONFIRMED: a search index is not every post. Its source is
 * UNVERIFIED, so it runs only on recorded answers until the owner records
 * Bluesky's terms.
 */
import { AppError } from "@repo/core";
import { z } from "zod";
import { defineCollector, type Collector } from "../contract.ts";
import {
  CredentialMalformedError,
  UpstreamRateLimitedError,
  UpstreamRejectedError,
  UpstreamResponseError,
  UpstreamUnavailableError,
} from "../errors.ts";
import type { CapturedResponse } from "../fetcher/capture.ts";
import type { UpstreamFetch } from "../fetcher/fetcher.ts";
import {
  isoFromStatedDate,
  ITEM_CLAIM_STRENGTHS,
  itemClaimStrengths,
  REPORTED_TEXT,
  retryAfterMs,
  topicPhrase,
  unavailableUnlessPermanent,
} from "./monitoring.ts";

const PUBLIC = "https://public.api.bsky.app/xrpc";
const PDS = "https://bsky.social/xrpc";
export const BLUESKY_SEARCH_LIMIT = 100;
const FETCH_TIMEOUT_MS = 20_000;

/** The documented shape (https://docs.bsky.app/docs/api/app-bsky-feed-search-posts), as far as it is read. */
const POST_VIEW = z.object({
  uri: z.string().min(1),
  record: z.object({
    text: z.string().optional(),
    createdAt: z.string().optional(),
    langs: z.array(z.string()).optional(),
  }),
  embed: z
    .object({ images: z.array(z.object({ thumb: z.string().optional() })).optional() })
    .optional(),
});
/** `cursor` is there when Bluesky has another page. */
const SEARCH_PAGE = z.object({ posts: z.array(POST_VIEW), cursor: z.string().optional() });
const SESSION = z.object({ accessJwt: z.string().min(1), refreshJwt: z.string().min(1) });
const LOGIN = z.object({ identifier: z.string().min(1), appPassword: z.string().min(1) }).strict();

const BLUESKY_ARTICLE = z
  .object({
    /** The post's AT URI (at://…), as Bluesky gives it. */
    url: z.string().min(1),
    mobileUrl: z.null(),
    /** A post has no title: its text, as Bluesky gives it; null when it has none. */
    title: REPORTED_TEXT,
    /** The post's `createdAt`, as given: set by the author's client, not by Bluesky. */
    published: REPORTED_TEXT,
    outletDomain: z.null(),
    /** The post's first `langs` tag, as given; null when it states none. */
    language: REPORTED_TEXT,
    outletCountry: z.null(),
    /** The first image's thumbnail URL, when the post has images. */
    socialImageUrl: REPORTED_TEXT,
    derived: z
      .object({
        /**
         * The post on bsky.app, from the DID and record key in its URI: never
         * the author's handle, which can change, or be "handle.invalid".
         */
        webUrl: z.url().nullable(),
        /** `published` in ISO 8601; null when the post gives none, or none with a time zone. */
        publishedAt: z.iso.datetime().nullable(),
        /** Bluesky states no region for a post. */
        region: z.null(),
        claimStrengths: ITEM_CLAIM_STRENGTHS,
      })
      .strict(),
  })
  .strict();

export const BLUESKY_SEARCH_RESULT = z
  .object({
    /** Every post on the page, in Bluesky's order, none dropped. */
    articles: z.array(BLUESKY_ARTICLE).min(1),
    derived: z
      .object({
        search: z
          .object({
            /** The query sent: the topic as one quoted phrase. */
            query: z.string().min(1),
            sort: z.literal("latest"),
            limit: z.literal(BLUESKY_SEARCH_LIMIT),
            /** How it was reached: the public AppView, or the tenant's account. */
            method: z.enum(["open", "official"]),
          })
          .strict(),
        /**
         * A full page, or one with a cursor to another: the newest posts only,
         * out of a number Bluesky does not give.
         */
        newestPageOnly: z.boolean(),
        /** How many posts match: never measured from one page. */
        volume: z
          .object({ count: z.null(), reason: z.literal("NOT_MEASURED_BY_A_SEARCH_PAGE") })
          .strict(),
      })
      .strict(),
  })
  .strict();

type BlueskyArticle = z.infer<typeof BLUESKY_ARTICLE>;

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

/** A failure's code and message, for a report that names more than one. */
function described(failure: unknown): string {
  return failure instanceof AppError
    ? `${failure.code}: ${failure.message}`
    : "an unexpected error";
}

/**
 * Ends the session with its refresh token. Never throws: what went wrong, if
 * anything, is returned, so the caller can say the session may still be open.
 */
async function closeSession(
  fetch: UpstreamFetch,
  refreshJwt: string,
): Promise<{ readonly problem: string; readonly retryAfterMs: number | null } | null> {
  let closed: CapturedResponse;
  try {
    closed = await fetch(`${PDS}/com.atproto.server.deleteSession`, {
      method: "POST",
      timeoutMs: FETCH_TIMEOUT_MS,
      headers: { authorization: `Bearer ${refreshJwt}` },
    });
  } catch (failure) {
    const wait = failure instanceof UpstreamRateLimitedError ? failure.retryAfterMs : null;
    return { problem: `the request could not be sent: ${described(failure)}`, retryAfterMs: wait };
  }
  if (closed.status === 200) return null;
  return {
    problem: `deleteSession answered ${String(closed.status)}`,
    retryAfterMs: retryAfterMs(closed),
  };
}

function parsed<T>(schema: z.ZodType<T>, response: CapturedResponse, what: string): T {
  const result = schema.safeParse(response.json());
  if (!result.success) throw new UpstreamResponseError(`${what} is not the documented shape`);
  return result.data;
}

/** A post's AT URI by DID: at://did:<method>:<id>/app.bsky.feed.post/<record key>. */
const POST_URI = /^at:\/\/(did:[a-z]+:[^/?#]+)\/app\.bsky\.feed\.post\/([^/?#]+)$/;

function toArticle(post: z.infer<typeof POST_VIEW>): BlueskyArticle {
  const [, did, rkey] = POST_URI.exec(post.uri) ?? [];
  // A DID's colons stay as they are in a bsky.app path; everything else is encoded.
  const webUrl =
    did === undefined || rkey === undefined
      ? null
      : `https://bsky.app/profile/${encodeURIComponent(did).replace(/%3A/g, ":")}/post/${encodeURIComponent(rkey)}`;
  return {
    url: post.uri,
    mobileUrl: null,
    title: reported(post.record.text),
    published: reported(post.record.createdAt),
    outletDomain: null,
    language: reported(post.record.langs?.[0]),
    outletCountry: null,
    socialImageUrl: reported(post.embed?.images?.[0]?.thumb),
    derived: {
      webUrl,
      publishedAt: isoFromStatedDate(reported(post.record.createdAt)),
      region: null,
      claimStrengths: itemClaimStrengths,
    },
  };
}

export const blueskySearchCollector: Collector = defineCollector(
  {
    id: "bluesky.search",
    version: "1.0.0",
    displayName: "Bluesky post search (Bluesky public API)",
    discipline: "SOCMINT",
    targetTypes: ["TOPIC"],
    collectionMode: "PASSIVE_API",
    source: "bluesky",
    credentials: { vaultIds: ["bluesky"], runsWithout: true },
    claimStrength: "OBSERVED",
    timeoutMs: 60_000,
    resultSchema: BLUESKY_SEARCH_RESULT,
    emptyAnswersUnreliable: true,
  },
  async (ctx) => {
    const query = `"${topicPhrase(ctx.target, "Bluesky's post search")}"`;
    const params = new URLSearchParams({
      q: query,
      sort: "latest",
      limit: String(BLUESKY_SEARCH_LIMIT),
    }).toString();
    const secret = ctx.credentials.get("bluesky");
    let response: CapturedResponse;
    let method: "open" | "official";
    if (secret === null) {
      method = "open";
      response = await ctx.fetch(`${PUBLIC}/app.bsky.feed.searchPosts?${params}`, {
        method: "GET",
        timeoutMs: FETCH_TIMEOUT_MS,
      });
    } else {
      method = "official";
      let login: z.infer<typeof LOGIN>;
      try {
        login = LOGIN.parse(JSON.parse(secret.expose()));
      } catch {
        throw new CredentialMalformedError(
          "bluesky",
          'JSON of the form {"identifier": …, "appPassword": …}',
        );
      }
      const session = await ctx.fetch(`${PDS}/com.atproto.server.createSession`, {
        method: "POST",
        timeoutMs: FETCH_TIMEOUT_MS,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identifier: login.identifier, password: login.appPassword }),
      });
      refuseUnlessOk(session, "Bluesky's session request");
      const { accessJwt, refreshJwt } = parsed(SESSION, session, "Bluesky's session");
      const search = await ctx
        .fetch(`${PDS}/app.bsky.feed.searchPosts?${params}`, {
          method: "GET",
          timeoutMs: FETCH_TIMEOUT_MS,
          headers: { authorization: `Bearer ${accessJwt}` },
        })
        .then(
          (answer) => ({ answer, failure: null }),
          (failure: unknown) => ({ answer: null, failure }),
        );
      // Whatever the search answered, or if it could not be sent: a session
      // left open stays live on the tenant's account.
      const unclosed = await closeSession(ctx.fetch, refreshJwt);
      if (unclosed !== null) {
        const before =
          search.failure === null
            ? ""
            : `; the search had already failed: ${described(search.failure)}`;
        throw new UpstreamUnavailableError(
          `closing Bluesky's session failed (${unclosed.problem}), so the session may still be open on the tenant's account${before}`,
          unclosed.retryAfterMs,
        );
      }
      if (search.answer === null) throw search.failure;
      response = search.answer;
    }
    refuseUnlessOk(response, "Bluesky's post search");
    const { posts, cursor } = parsed(SEARCH_PAGE, response, "Bluesky's search answer");
    if (posts.length === 0) {
      return ctx.emptyUnconfirmed(
        response,
        "Bluesky's post search returned nothing for this topic — unconfirmed: a search index is not every post.",
      );
    }
    return ctx.found(
      {
        articles: posts.map(toArticle),
        derived: {
          search: { query, sort: "latest", limit: BLUESKY_SEARCH_LIMIT, method },
          newestPageOnly: cursor !== undefined || posts.length >= BLUESKY_SEARCH_LIMIT,
          volume: { count: null, reason: "NOT_MEASURED_BY_A_SEARCH_PAGE" },
        },
      },
      [{ response, observedAt: null }],
    );
  },
);

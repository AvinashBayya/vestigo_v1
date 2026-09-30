/**
 * Hacker News account: the Hacker News account with one exact handle, as the
 * official Firebase API reports it, and that account's most recent items, as
 * the Algolia HN search indexes them.
 *
 * REWRITE of the previous codebase's Hacker News lookup (legacy
 * src/routes/news.tsx, the handle variations and the HN checks). The data-path
 * defects this fixes, each with a regression test in
 * test/platform/hackernews.test.ts:
 *   - Near matches as profiles: legacy probed derived variations of the handle
 *     (underscores removed, trailing digits stripped, hyphens for underscores)
 *     and presented the first hit as the profile, labelled "Nearest Match".
 *     Here one handle is looked up, exactly as given and case-sensitively, as
 *     Hacker News compares handles; an answer for any other handle is refused.
 *   - An invented status: an exact hit was labelled "Verified Active Member".
 *     Nothing here asserts verification or activity.
 *   - An invented karma: legacy defaulted a missing karma to zero with a nullish
 *     fallback. Here a user without karma is not the documented shape and fails.
 *   - Mentions for a keyword: legacy searched Algolia for the handle as free
 *     text and reported every hit as a mention. Here the search is filtered to
 *     items authored by the handle, and an item by anyone else fails the run.
 *   - Swallowed failures: every legacy check caught and ignored its error, so
 *     an outage read as "no profile". Here only Firebase's null is NOT_FOUND.
 */
import { z } from "zod";
import { defineCollector, type Collector } from "../contract.ts";
import {
  UpstreamRejectedError,
  UpstreamResponseError,
  UpstreamUnavailableError,
} from "../errors.ts";
import type { CapturedResponse } from "../fetcher/capture.ts";

const FIREBASE = "https://hacker-news.firebaseio.com/v0/user";
const ALGOLIA = "https://hn.algolia.com/api/v1/search_by_date";

/** Most recent items asked for. */
export const HACKERNEWS_ITEMS_PER_PAGE = 20;

const FETCH_TIMEOUT_MS = 20_000;
/** The submitted list of a long-standing account runs to hundreds of kilobytes. */
const USER_MAX_BYTES = 8 * 1024 * 1024;

// ── What Hacker News sends ───────────────────────────────────────────────

const USER = z.object({
  id: z.string().min(1),
  created: z.number().int(),
  karma: z.number().int(),
  about: z.string().optional(),
  submitted: z.array(z.number().int()).optional(),
});

const SEARCH = z.object({
  nbHits: z.number().int().min(0),
  hits: z.array(
    z.object({
      objectID: z.string(),
      author: z.string(),
      _tags: z.array(z.string()),
      created_at: z.string(),
      title: z.string().nullable().optional(),
      url: z.string().nullable().optional(),
      story_id: z.number().int().nullable().optional(),
      story_title: z.string().nullable().optional(),
      points: z.number().int().nullable().optional(),
    }),
  ),
});

// ── What the collector reports ────────────────────────────────────────────

const TEXT = z.string().nullable();

export const HACKERNEWS_RESULT = z
  .object({
    account: z
      .object({
        /** The handle as Hacker News returned it; always exactly the handle asked for. */
        handle: z.string().min(1),
        /** Hacker News's stated account creation time, in Unix seconds, as given. */
        created: z.number().int(),
        karma: z.number().int(),
        /** The profile's about text as Hacker News stores it (HTML); null when it has none. */
        about: TEXT,
      })
      .strict(),
    recentItems: z
      .object({
        /** The search index's own count of the account's items. */
        indexedItemCount: z.number().int().min(0),
        /** Newest first, as the index ordered them; every item is by this handle. */
        items: z.array(
          z
            .object({
              hnItemId: z.string(),
              /** The index's tags for the item, as given (item type, author, story). */
              tags: z.array(z.string()),
              createdAt: z.string(),
              title: TEXT,
              url: TEXT,
              /** For a comment, the story it belongs to, as the index states. */
              storyId: z.number().int().nullable(),
              storyTitle: TEXT,
              /** Points, as the index states for stories; null when it gives none. */
              points: z.number().int().nullable(),
              /** Computed by this collector from the fields above (src/provenance.ts). */
              derived: z
                .object({
                  /** The item type among its tags, e.g. story or comment; null when none is one it knows. */
                  kind: TEXT,
                })
                .strict(),
            })
            .strict(),
        ),
      })
      .strict(),
    /** What this collector asked for and computed; nothing here is Hacker News's (src/provenance.ts). */
    derived: z
      .object({
        /** account.created as ISO 8601. */
        accountCreatedAt: z.iso.datetime(),
        /** How many item ids the account's submitted list holds; null when Hacker News omits the list. */
        submittedItemCount: z.number().int().min(0).nullable(),
        recentItems: z
          .object({
            requested: z.literal(HACKERNEWS_ITEMS_PER_PAGE),
            /** The index holds more items than were returned: the list is partial. */
            partial: z.boolean(),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

export type HackernewsResult = z.infer<typeof HACKERNEWS_RESULT>;

const ITEM_KINDS = new Set(["story", "comment", "poll", "pollopt", "job", "show_hn", "ask_hn"]);

/** Retry-After in milliseconds, in seconds or as an HTTP date; null when absent or unreadable. */
function retryAfterMs(response: CapturedResponse): number | null {
  const value = response.headers["retry-after"]?.trim();
  if (value === undefined || value.length === 0) return null;
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const at = Date.parse(value);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - response.receivedAt.getTime());
}

/** Throws for every status but 200, typed by whether a retry can help. */
function refuseUnlessOk(response: CapturedResponse, what: string): void {
  const { status } = response;
  if (status === 200) return;
  if (status === 429 || status >= 500) {
    throw new UpstreamUnavailableError(
      `${what} answered ${String(status)}`,
      retryAfterMs(response),
    );
  }
  if (status === 401 || status === 403) {
    throw new UpstreamRejectedError(`${what} refused the request with ${String(status)}`);
  }
  throw new UpstreamResponseError(`${what} answered an unexpected status ${String(status)}`);
}

export const hackernewsCollector: Collector = defineCollector(
  {
    id: "hackernews",
    version: "1.0.0",
    // Two operators answer: Y Combinator's Firebase API and Algolia's HN
    // Search. The label names both (Phase 3B review: it named only one).
    displayName: "Hacker News account (HN API and Algolia HN Search)",
    discipline: "SOCMINT",
    targetTypes: ["USERNAME"],
    collectionMode: "PASSIVE_API",
    source: "hacker-news",
    credentials: { vaultIds: [], runsWithout: true },
    claimStrength: "REPORTED",
    timeoutMs: 60_000,
    resultSchema: HACKERNEWS_RESULT,
  },
  async (ctx) => {
    const handle = ctx.target.value;
    const userResponse = await ctx.fetch(`${FIREBASE}/${encodeURIComponent(handle)}.json`, {
      method: "GET",
      timeoutMs: FETCH_TIMEOUT_MS,
      headers: { accept: "application/json" },
      maxBytes: USER_MAX_BYTES,
    });
    refuseUnlessOk(userResponse, "Hacker News");
    const body = userResponse.json();
    // Firebase answers a handle it does not hold with 200 and the literal null.
    if (body === null) {
      return ctx.notFound(userResponse, "Hacker News has no account with exactly this handle.");
    }
    const user = USER.safeParse(body);
    if (!user.success) {
      throw new UpstreamResponseError("Hacker News's user answer is not the documented shape");
    }
    if (user.data.id !== handle) {
      throw new UpstreamResponseError(
        "Hacker News answered for a different handle than was asked for",
      );
    }

    const searchParams = new URLSearchParams({
      tags: `author_${handle}`,
      hitsPerPage: String(HACKERNEWS_ITEMS_PER_PAGE),
    });
    const searchResponse = await ctx.fetch(`${ALGOLIA}?${searchParams.toString()}`, {
      method: "GET",
      timeoutMs: FETCH_TIMEOUT_MS,
      headers: { accept: "application/json" },
    });
    refuseUnlessOk(searchResponse, "The Hacker News search");
    const search = SEARCH.safeParse(searchResponse.json());
    if (!search.success) {
      throw new UpstreamResponseError("The Hacker News search answer is not the documented shape");
    }
    if (search.data.hits.some((hit) => hit.author !== handle)) {
      throw new UpstreamResponseError(
        "The Hacker News search returned an item by another author for an author-filtered search",
      );
    }

    const optional = (value: string | null | undefined): string | null =>
      value === undefined || value === null || value.length === 0 ? null : value;

    return ctx.found(
      {
        account: {
          handle: user.data.id,
          created: user.data.created,
          karma: user.data.karma,
          about: optional(user.data.about),
        },
        recentItems: {
          indexedItemCount: search.data.nbHits,
          items: search.data.hits.map((hit) => ({
            hnItemId: hit.objectID,
            tags: hit._tags,
            createdAt: hit.created_at,
            title: optional(hit.title),
            url: optional(hit.url),
            storyId: hit.story_id ?? null,
            storyTitle: optional(hit.story_title),
            points: hit.points ?? null,
            derived: { kind: hit._tags.find((tag) => ITEM_KINDS.has(tag)) ?? null },
          })),
        },
        derived: {
          accountCreatedAt: new Date(user.data.created * 1000).toISOString(),
          submittedItemCount: user.data.submitted?.length ?? null,
          recentItems: {
            requested: HACKERNEWS_ITEMS_PER_PAGE,
            partial: search.data.nbHits > search.data.hits.length,
          },
        },
      },
      // The account and its items carry their own dates in the result.
      [
        { response: userResponse, observedAt: null },
        { response: searchResponse, observedAt: null },
      ],
    );
  },
);

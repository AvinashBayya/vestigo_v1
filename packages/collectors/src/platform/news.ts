/**
 * GDELT news coverage: the articles GDELT's DOC 2.0 API holds that mention a
 * domain, as GDELT reports them.
 *
 * REWRITE of the previous codebase's news adapter (legacy
 * collectors/existing/news.ts over geo-sources.ts collectNewsGeo and
 * geo.ts fromGdeltArticle). The data-path defects this fixes, each with a
 * regression test in test/platform/news.test.ts:
 *   - Label fallbacks: an article with no domain was attributed to "GDELT"
 *     (the aggregator named as the publisher, audit REPORT §4.1, geo.ts:538),
 *     a missing title became "Untitled report", a missing language or domain
 *     became "unknown", a missing URL became "". Absent values are null here,
 *     and the evidence label is the registry's, never an article's domain.
 *   - Publisher country as a location: GDELT's `sourcecountry` (where the
 *     OUTLET is) was turned into country-centroid coordinates and a LOCATED_IN
 *     relationship with an invented confidence. Here it is `outletCountry`, a
 *     string, and nothing in the result is a coordinate or an event location.
 *   - Dropped articles: an article whose outlet country was missing from a
 *     hand-written centroid table, or that had no date, was discarded as
 *     "unplaceable". Every article GDELT returned is kept.
 *   - Invented subject: an empty query was replaced with "conflict". A target
 *     is validated before the collector runs; nothing is substituted.
 *   - Unbounded calls: six call sites hit GDELT with no shared limiter. Every
 *     request here takes a slot from the gdelt-doc source's shared limit.
 *   - Unlabelled limits: at most 50 records from a three-day window were
 *     requested, and the result stated neither. The result states the window,
 *     the cap, the returned count and whether the cap was reached.
 */
import { z } from "zod";
import { defineCollector, type Collector } from "../contract.ts";
import {
  UpstreamRejectedError,
  UpstreamResponseError,
  UpstreamUnavailableError,
} from "../errors.ts";
import type { CapturedResponse } from "../fetcher/capture.ts";

const ENDPOINT = "https://api.gdeltproject.org/api/v2/doc/doc";

/** GDELT DOC's largest article list per request. */
export const NEWS_MAX_RECORDS = 250;
/** GDELT DOC searches a rolling window; this is the window requested, stated in every result. */
export const NEWS_TIMESPAN = "3months";
/** Newest first, so a capped list holds the most recent coverage. */
export const NEWS_SORT = "datedesc";

/** Includes waiting for the shared one-per-five-seconds slot; GDELT is slow to answer. */
const FETCH_TIMEOUT_MS = 30_000;

// ── What GDELT sends ──────────────────────────────────────────────────────

const GDELT_TEXT = z.string().nullish();

const GDELT_ARTICLE = z.object({
  url: z.string(),
  url_mobile: GDELT_TEXT,
  title: GDELT_TEXT,
  seendate: GDELT_TEXT,
  socialimage: GDELT_TEXT,
  domain: GDELT_TEXT,
  language: GDELT_TEXT,
  sourcecountry: GDELT_TEXT,
});

/** GDELT answers `{}` when nothing matches, and `{ articles: [...] }` otherwise. */
const GDELT_ARTLIST = z.object({ articles: z.array(GDELT_ARTICLE).optional() });

// ── What the collector reports ────────────────────────────────────────────

const REPORTED_TEXT = z.string().min(1).nullable();

const NEWS_ARTICLE = z
  .object({
    /** The article's URL, as GDELT gives it. */
    url: z.string().min(1),
    /** GDELT's `url_mobile`; null when it gives none. */
    mobileUrl: REPORTED_TEXT,
    /** GDELT's `title`; null when it gives none. Never a placeholder. */
    title: REPORTED_TEXT,
    /**
     * GDELT's `seendate`, as given (YYYYMMDDTHHMMSSZ): when GDELT first saw the
     * article, which is not necessarily when it was published. Null when GDELT
     * gives none; never the time of this collection.
     */
    seendate: REPORTED_TEXT,
    /** GDELT's `domain`: the publishing outlet's domain. Null when it gives none. */
    outletDomain: REPORTED_TEXT,
    /** GDELT's `language` for the article. Null when it gives none. */
    language: REPORTED_TEXT,
    /**
     * GDELT's `sourcecountry`: the country of the PUBLISHING OUTLET. It says
     * nothing about where the reported events happened, and is never a location.
     */
    outletCountry: REPORTED_TEXT,
    /** GDELT's `socialimage`: the article's sharing image URL. Null when it gives none. */
    socialImageUrl: REPORTED_TEXT,
    /** Computed by this collector from the fields above (src/provenance.ts). */
    derived: z
      .object({
        /** `seendate` in ISO 8601; null when GDELT gives none. */
        seenByGdeltAt: z.iso.datetime().nullable(),
      })
      .strict(),
  })
  .strict();

export const NEWS_RESULT = z
  .object({
    /** Every article GDELT returned, in GDELT's order, none dropped. */
    articles: z.array(NEWS_ARTICLE).min(1),
    /** What this collector asked for and computed; nothing here is GDELT's (src/provenance.ts). */
    derived: z
      .object({
        /** Exactly what this collector asked GDELT for. */
        search: z
          .object({
            /** The GDELT query string sent: the target domain as a quoted phrase. */
            query: z.string().min(1),
            /** GDELT searched only this rolling window; older coverage is not covered. */
            timespan: z.literal(NEWS_TIMESPAN),
            sort: z.literal(NEWS_SORT),
            /** The most articles GDELT was asked to return. */
            maxRecords: z.literal(NEWS_MAX_RECORDS),
          })
          .strict(),
        /** How many articles GDELT returned. */
        returnedCount: z.number().int().min(1),
        /**
         * True when the returned count reached maxRecords: GDELT gives no
         * total, so more matching articles may exist that were not returned,
         * and the list is then partial.
         */
        capped: z.boolean(),
      })
      .strict(),
  })
  .strict();

export type NewsResult = z.infer<typeof NEWS_RESULT>;
type NewsArticle = z.infer<typeof NEWS_ARTICLE>;

/** A value GDELT gave, or null when it gave none or left it blank. Never trimmed or replaced. */
function reported(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value.trim().length === 0) return null;
  return value;
}

const SEEN_DATE = /^\d{8}T\d{6}Z$/;

/** GDELT's compact `seendate` (YYYYMMDDTHHMMSSZ) as ISO 8601, or null when it gives none. */
function seenByGdeltAt(value: string | null | undefined): string | null {
  const raw = reported(value);
  if (raw === null) return null;
  if (!SEEN_DATE.test(raw)) {
    throw new UpstreamResponseError("an article's seendate is not in GDELT's documented format");
  }
  const iso =
    `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` +
    `T${raw.slice(9, 11)}:${raw.slice(11, 13)}:${raw.slice(13, 15)}.000Z`;
  const date = new Date(iso);
  // Rejects values the pattern admits but the calendar does not (month 13, 31 February).
  if (Number.isNaN(date.getTime()) || date.toISOString() !== iso) {
    throw new UpstreamResponseError("an article's seendate is not a real date");
  }
  return iso;
}

function toArticle(article: z.infer<typeof GDELT_ARTICLE>): NewsArticle {
  const url = reported(article.url);
  if (url === null) throw new UpstreamResponseError("an article in GDELT's list has no URL");
  return {
    url,
    mobileUrl: reported(article.url_mobile),
    title: reported(article.title),
    seendate: reported(article.seendate),
    outletDomain: reported(article.domain),
    language: reported(article.language),
    outletCountry: reported(article.sourcecountry),
    socialImageUrl: reported(article.socialimage),
    derived: { seenByGdeltAt: seenByGdeltAt(article.seendate) },
  };
}

/** Retry-After in milliseconds, in seconds or as an HTTP date; null when absent or unreadable. */
function retryAfterMs(response: CapturedResponse): number | null {
  const value = response.headers["retry-after"]?.trim();
  if (value === undefined || value.length === 0) return null;
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const at = Date.parse(value);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - response.receivedAt.getTime());
}

/** Every status but 200 is a failure, typed by whether a retry can help. */
function refuseUnlessOk(response: CapturedResponse): void {
  const { status } = response;
  if (status === 200) return;
  if (status === 429) {
    throw new UpstreamUnavailableError(
      "GDELT DOC answered 429; it accepts one request every five seconds",
      retryAfterMs(response),
    );
  }
  if (status >= 500) {
    throw new UpstreamUnavailableError(
      `GDELT DOC answered ${String(status)}`,
      retryAfterMs(response),
    );
  }
  if (status === 401 || status === 403) {
    throw new UpstreamRejectedError(`GDELT DOC refused the request with ${String(status)}`);
  }
  // Including 404: GDELT DOC reports no matches as `{}`, so a 404 means the
  // endpoint itself was not found, never that the target has no coverage.
  throw new UpstreamResponseError(`GDELT DOC answered an unexpected status ${String(status)}`);
}

export const newsCollector: Collector = defineCollector(
  {
    id: "news",
    version: "1.0.0",
    displayName: "GDELT news coverage",
    discipline: "MEDIAINT",
    targetTypes: ["DOMAIN"],
    collectionMode: "PASSIVE_API",
    source: "gdelt-doc",
    credentials: { vaultIds: [], runsWithout: true },
    claimStrength: "REPORTED",
    timeoutMs: 40_000,
    resultSchema: NEWS_RESULT,
  },
  async (ctx) => {
    const query = `"${ctx.target.value}"`;
    const params = new URLSearchParams({
      query,
      mode: "artlist",
      format: "json",
      maxrecords: String(NEWS_MAX_RECORDS),
      timespan: NEWS_TIMESPAN,
      sort: NEWS_SORT,
    });
    const response = await ctx.fetch(`${ENDPOINT}?${params.toString()}`, {
      method: "GET",
      timeoutMs: FETCH_TIMEOUT_MS,
      headers: { accept: "application/json" },
    });
    refuseUnlessOk(response);

    let body: unknown;
    try {
      body = response.json();
    } catch {
      // A 200 whose body is not JSON (GDELT can answer a query it will not
      // run with a line of text) is a failure, never "no coverage".
      throw new UpstreamResponseError("GDELT DOC answered with text, not a JSON article list");
    }
    const parsed = GDELT_ARTLIST.safeParse(body);
    if (!parsed.success) {
      throw new UpstreamResponseError("GDELT DOC's JSON is not the documented article list");
    }

    // GDELT's documented no-match answer is `{}`; an empty list says the same.
    const listed = parsed.data.articles;
    if (listed === undefined || listed.length === 0) {
      return ctx.notFound(
        response,
        `GDELT DOC holds no articles matching the phrase within its ${NEWS_TIMESPAN} window.`,
      );
    }
    const articles = listed.map(toArticle);
    return ctx.found(
      {
        articles,
        derived: {
          search: { query, timespan: NEWS_TIMESPAN, sort: NEWS_SORT, maxRecords: NEWS_MAX_RECORDS },
          returnedCount: articles.length,
          capped: articles.length >= NEWS_MAX_RECORDS,
        },
      },
      // One response lists many articles, each with its own seendate; GDELT
      // gives no single date for the list, so the evidence carries none. Each
      // article's own date is in the result.
      [{ response, observedAt: null }],
    );
  },
);

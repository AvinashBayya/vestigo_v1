/**
 * GDELT news coverage: the articles GDELT's DOC 2.0 API returns for a domain
 * or a topic, as GDELT reports them.
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
 *     requested, and the result stated neither. The result states the search
 *     it sent, the window, and whether the list reached the cap.
 *
 * Track M Day 2 (owner's instruction, 2026-10-15):
 *   - A TOPIC is searched as one exact phrase in GDELT's quote marks, as typed
 *     less one pair of outer quotes. A topic with a quote mark inside is refused
 *     before anything is sent: the mark would end the phrase, and GDELT would
 *     read the rest as its operators (a minus, OR, domain:, sourcelang:).
 *   - An empty answer is never NOT_FOUND. GDELT's empty answers are unreliable:
 *     it searches English machine translations of what it monitors (its DOC
 *     2.0 announcement), and the one live answer recorded (2026-10-15) covered
 *     two and a half hours of the three months asked for. It is
 *     EMPTY_UNCONFIRMED, never a count of zero. The registry entry declares it
 *     (emptyAnswersUnreliable), so the runtime refuses a not-found from here.
 *   - The canary: on an empty answer, one search that always has articles, in
 *     the same window. Articles back mean GDELT is up, and the empty answer
 *     stays unconfirmed; nothing back means GDELT is not answering searches,
 *     which is UNAVAILABLE. A passing canary means GDELT is up, not that any
 *     query found something, and its message says so (NEWS_CANARY_PASSED).
 *   - A full list is the newest 250 only (newest250Only), and no figure in the
 *     result is a count of coverage (volume is never measured here), so none
 *     can be read as a rise.
 */
import { z } from "zod";
import { defineCollector, type Collector } from "../contract.ts";
import {
  TargetNotSearchableError,
  UpstreamRejectedError,
  UpstreamResponseError,
  UpstreamUnavailableError,
} from "../errors.ts";
import type { CapturedResponse } from "../fetcher/capture.ts";
import type { UpstreamFetch } from "../fetcher/fetcher.ts";
import type { Target } from "../target.ts";

const ENDPOINT = "https://api.gdeltproject.org/api/v2/doc/doc";

/** GDELT DOC's largest article list per request. */
export const NEWS_MAX_RECORDS = 250;
/** GDELT DOC searches a rolling window; this is the window requested, stated in every result. */
export const NEWS_TIMESPAN = "3months";
/** Newest first, so a capped list holds the most recent coverage. */
export const NEWS_SORT = "datedesc";

/**
 * The canary: a word in news coverage every day, in every language GDELT
 * translates, so a search for it over three months always has articles while
 * GDELT is answering searches. It asks for GDELT's documented default list
 * (75); a smaller one is not documented, and was not verified live.
 */
export const NEWS_CANARY_QUERY = '"government"';
export const NEWS_CANARY_MAX_RECORDS = 75;

/** What a canary that came back with articles says, and does not say. */
export const NEWS_CANARY_PASSED =
  "Canary: GDELT DOC answered a search that always has articles, so GDELT is up. A passing canary means GDELT is up — not that any query found something.";

/** What every empty answer says: what GDELT's emptiness does not show. */
export const NEWS_EMPTY_UNCONFIRMED =
  "GDELT DOC returned nothing for this search — unconfirmed. Its empty answers are unreliable: it searches English machine translations of the coverage it monitors, and a list it returns can cover only the newest part of the window, so this is not a finding that there is no coverage, and not a count of zero.";

/** Includes waiting for the shared one-per-five-seconds slot; GDELT is slow to answer. */
const FETCH_TIMEOUT_MS = 30_000;

/** The URL of one GDELT DOC article-list search, exactly as this collector sends it. */
export function newsSearchUrl(query: string, maxRecords: number): string {
  const params = new URLSearchParams({
    query,
    mode: "artlist",
    format: "json",
    maxrecords: String(maxRecords),
    timespan: NEWS_TIMESPAN,
    sort: NEWS_SORT,
  });
  return `${ENDPOINT}?${params.toString()}`;
}

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

/**
 * GDELT answers `{}` when it returns nothing, and `{ articles: [...] }`
 * otherwise. Neither shape is documented; both are recorded
 * (test/fixtures/news: empty-answer.json, 2026-09-28; found.json, 2026-10-15).
 */
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
     * GDELT's `seendate`, as given (YYYYMMDDTHHMMSSZ in every recorded
     * answer): GDELT's date for the article, named by GDELT for when it saw
     * it, which is not necessarily when it was published. GDELT documents
     * neither its meaning nor its format. Null when GDELT gives none; never
     * the time of this collection.
     */
    seendate: REPORTED_TEXT,
    /** GDELT's `domain`: the publishing outlet's domain. Null when it gives none. */
    outletDomain: REPORTED_TEXT,
    /** GDELT's `language` for the article, as GDELT names it. Null when it gives none. */
    language: REPORTED_TEXT,
    /**
     * GDELT's `sourcecountry`: the country of the PUBLISHING OUTLET, as GDELT
     * names it. It says nothing about where the reported events happened, and
     * is never a location.
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

/** The stretch of the window a list covers: its newest and oldest seendate. */
const SEEN_SPAN = z
  .object({ newest: z.iso.datetime(), oldest: z.iso.datetime() })
  .strict()
  .refine((span) => span.oldest <= span.newest, {
    message: "the oldest seendate is after the newest",
  });

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
            /**
             * The GDELT query string sent: the target as one phrase in quote
             * marks (a domain as it is; a topic less any outer quotes).
             */
            query: z.string().min(1),
            /** GDELT searched only this rolling window; older coverage is not covered. */
            timespan: z.literal(NEWS_TIMESPAN),
            sort: z.literal(NEWS_SORT),
            /** The most articles GDELT was asked to return. */
            maxRecords: z.literal(NEWS_MAX_RECORDS),
          })
          .strict(),
        /**
         * True when GDELT returned its most, 250: the list is the newest 250
         * only, out of a number GDELT does not give. It is about this list,
         * never about the news: it is not a count of coverage, and neither it
         * nor the list's length can show a rise. A list under 250 is not all
         * the coverage in the window either (seenSpan).
         */
        newest250Only: z.boolean(),
        /**
         * The newest and oldest seendate in the list: the part of the window
         * it covers, which can be far less than the window (recorded
         * 2026-10-15: two and a half hours of three months). Null when no
         * article in it has a seendate.
         */
        seenSpan: SEEN_SPAN.nullable(),
        /**
         * How much coverage matches: never measured here. GDELT gives no
         * total, a list stops at 250, and one under 250 can cover only part
         * of the window, so no figure in this result counts coverage, and none
         * can show a rise (GDELT measures volume only in its timeline modes,
         * which this collector does not use).
         */
        volume: z
          .object({ count: z.null(), reason: z.literal("NOT_MEASURED_BY_AN_ARTICLE_LIST") })
          .strict(),
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
    throw new UpstreamResponseError("an article's seendate is not in the form GDELT sends");
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

/** The newest and oldest seendate in a list, or null when none has one. */
function seenSpanOf(articles: readonly NewsArticle[]): z.infer<typeof SEEN_SPAN> | null {
  const dates = articles
    .map((article) => article.derived.seenByGdeltAt)
    .filter((date): date is string => date !== null)
    .sort();
  const [oldest] = dates;
  const newest = dates.at(-1);
  return oldest === undefined || newest === undefined ? null : { newest, oldest };
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

/**
 * Every status but 200 is a failure, typed by whether a retry can help.
 * `asked` names the search, so a failed canary says it was the canary.
 */
function refuseUnlessOk(response: CapturedResponse, asked: string): void {
  const { status } = response;
  if (status === 200) return;
  if (status === 429) {
    throw new UpstreamUnavailableError(
      `GDELT DOC answered 429 to ${asked}; it asks for one request every five seconds`,
      retryAfterMs(response),
    );
  }
  if (status >= 500) {
    throw new UpstreamUnavailableError(
      `GDELT DOC answered ${String(status)} to ${asked}`,
      retryAfterMs(response),
    );
  }
  if (status === 401 || status === 403) {
    throw new UpstreamRejectedError(`GDELT DOC refused ${asked} with ${String(status)}`);
  }
  // Including 404: GDELT DOC answers a search it returns nothing for with `{}`
  // (recorded), so a 404 means the endpoint itself was not found, never that
  // the target has no coverage.
  throw new UpstreamResponseError(
    `GDELT DOC answered ${asked} with an unexpected status ${String(status)}`,
  );
}

/** The articles in a 200 answer: none when GDELT returned nothing. */
function articlesIn(response: CapturedResponse, asked: string) {
  let body: unknown;
  try {
    body = response.json();
  } catch {
    // A 200 whose body is not JSON (GDELT can answer a query it will not run
    // with a line of text) is a failure, never "nothing returned".
    throw new UpstreamResponseError(`GDELT DOC answered ${asked} with text, not an article list`);
  }
  const parsed = GDELT_ARTLIST.safeParse(body);
  if (!parsed.success) {
    throw new UpstreamResponseError(
      `GDELT DOC's answer to ${asked} is not the article list it sends`,
    );
  }
  return parsed.data.articles ?? [];
}

/**
 * One phrase for GDELT: a domain as it is; a topic as typed, less one pair of
 * outer quotes (straight or curly, as Day 1's detection reads a quoted
 * phrase). A topic with a quote mark inside, or nothing inside its quotes,
 * cannot be one GDELT phrase, and is refused before anything is sent.
 */
function phraseOf(target: Target): string {
  switch (target.type) {
    case "DOMAIN":
      return target.value;
    case "TOPIC": {
      const quoted = /^"(.*)"$/su.exec(target.value) ?? /^“(.*)”$/su.exec(target.value);
      const phrase = quoted?.[1] ?? target.value;
      if (/["“”]/u.test(phrase)) {
        throw new TargetNotSearchableError(
          "GDELT DOC searches a topic as one phrase in quote marks, so a topic with a quote mark inside cannot be searched",
        );
      }
      if (phrase.trim().length === 0) {
        throw new TargetNotSearchableError("there is nothing inside the topic's quote marks");
      }
      return phrase;
    }
    default:
      throw new TargetNotSearchableError("GDELT DOC is searched only for a domain or a topic");
  }
}

/**
 * The canary, after an empty answer: one search that always has articles, in
 * the same window, through the same shared limit. It returns when GDELT is up;
 * it throws when GDELT answered it with nothing (UNAVAILABLE: GDELT is not
 * answering searches) or could not be asked.
 */
async function canary(fetch: UpstreamFetch): Promise<void> {
  const asked = "its canary search";
  const response = await fetch(newsSearchUrl(NEWS_CANARY_QUERY, NEWS_CANARY_MAX_RECORDS), {
    method: "GET",
    timeoutMs: FETCH_TIMEOUT_MS,
    headers: { accept: "application/json" },
  });
  refuseUnlessOk(response, asked);
  if (articlesIn(response, asked).length === 0) {
    throw new UpstreamUnavailableError(
      "GDELT DOC returned nothing for this search, and nothing for its canary, a search that always has articles: GDELT is not answering searches now, so this search says nothing",
      null,
    );
  }
}

export const newsCollector: Collector = defineCollector(
  {
    id: "news",
    version: "2.0.0",
    displayName: "GDELT news coverage",
    discipline: "MEDIAINT",
    targetTypes: ["DOMAIN", "TOPIC"],
    collectionMode: "PASSIVE_API",
    source: "gdelt-doc",
    credentials: { vaultIds: [], runsWithout: true },
    claimStrength: "REPORTED",
    // Two searches at most (the target's, then the canary's), each with its
    // own wait for the shared slot.
    timeoutMs: 75_000,
    resultSchema: NEWS_RESULT,
    emptyAnswersUnreliable: true,
  },
  async (ctx) => {
    const query = `"${phraseOf(ctx.target)}"`;
    const asked = "this search";
    const response = await ctx.fetch(newsSearchUrl(query, NEWS_MAX_RECORDS), {
      method: "GET",
      timeoutMs: FETCH_TIMEOUT_MS,
      headers: { accept: "application/json" },
    });
    refuseUnlessOk(response, asked);
    const listed = articlesIn(response, asked);

    if (listed.length === 0) {
      // Never "no coverage": unconfirmed, once the canary shows GDELT is up.
      await canary(ctx.fetch);
      return ctx.emptyUnconfirmed(response, `${NEWS_EMPTY_UNCONFIRMED} ${NEWS_CANARY_PASSED}`);
    }
    const articles = listed.map(toArticle);
    return ctx.found(
      {
        articles,
        derived: {
          search: { query, timespan: NEWS_TIMESPAN, sort: NEWS_SORT, maxRecords: NEWS_MAX_RECORDS },
          newest250Only: articles.length >= NEWS_MAX_RECORDS,
          seenSpan: seenSpanOf(articles),
          volume: { count: null, reason: "NOT_MEASURED_BY_AN_ARTICLE_LIST" },
        },
      },
      // One response lists many articles, each with its own seendate; GDELT
      // gives no single date for the list, so the evidence carries none. Each
      // article's own date is in the result.
      [{ response, observedAt: null }],
    );
  },
);

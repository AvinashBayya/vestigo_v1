/**
 * Common Crawl URL index: the URLs Common Crawl captured under a domain in its
 * newest published crawl, as its CDX index lists them.
 *
 * NEW; the previous codebase had no Common Crawl collector.
 *
 * Common Crawl crawls periodically and publishes each crawl's index weeks
 * after the crawl ends, so every result is a historical snapshot and says so
 * (COMMONCRAWL_HISTORICAL_NOTE). Absence from the index is reported as
 * absence from that index, never as absence from the web.
 *
 * Two requests per run: collinfo.json for the newest index, then that index's
 * CDX API for captures under the domain, capped at COMMONCRAWL_CAPTURE_LIMIT;
 * the result says when the cap was reached.
 */
import { z } from "zod";
import { defineCollector, type Collector } from "../contract.ts";
import {
  UpstreamRejectedError,
  UpstreamResponseError,
  UpstreamUnavailableError,
} from "../errors.ts";
import type { CapturedResponse } from "../fetcher/capture.ts";

const ORIGIN = "https://index.commoncrawl.org";

/** Captures asked for; the index may hold more. */
export const COMMONCRAWL_CAPTURE_LIMIT = 100;

/** A fixed statement carried in every result: the index is historical and late. */
export const COMMONCRAWL_HISTORICAL_NOTE =
  "Common Crawl's index is a historical snapshot of a periodic crawl, published weeks after the crawl ends. A URL absent here may exist; a URL listed here may since have changed or gone.";

const FETCH_TIMEOUT_MS = 60_000;
const CDX_MAX_BYTES = 8 * 1024 * 1024;

// ── What Common Crawl sends ──────────────────────────────────────────────

// Recent ids are CC-MAIN-<year>-<week>; the oldest are CC-MAIN-2012 and CC-MAIN-2008-2009.
const INDEX_ID = /^CC-MAIN-\d{4}(-\d{2,4})?$/;
/** Common Crawl states crawl times without a zone, e.g. 2026-09-17T05:59:21. */
const STATED_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

const COLLINFO = z
  .array(
    z.object({
      id: z.string().regex(INDEX_ID),
      name: z.string(),
      from: z.string().regex(STATED_TIME),
      to: z.string().regex(STATED_TIME),
    }),
  )
  .min(1);

const CAPTURE = z.object({
  url: z.string(),
  timestamp: z.string().regex(/^\d{14}$/),
  mime: z.string().optional(),
  "mime-detected": z.string().optional(),
  status: z.string(),
  digest: z.string().optional(),
  redirect: z.string().optional(),
  languages: z.string().optional(),
  length: z.string().regex(/^\d+$/),
  offset: z.string().regex(/^\d+$/),
  filename: z.string(),
});

// ── What the collector reports ────────────────────────────────────────────

const TEXT = z.string().nullable();

export const COMMONCRAWL_RESULT = z
  .object({
    index: z
      .object({
        /** Common Crawl's id for the crawl, e.g. CC-MAIN-2026-39; the newest by stated end time. */
        id: z.string().regex(INDEX_ID),
        name: z.string(),
        /** The crawl's start and end, as Common Crawl states them (no time zone given). */
        crawlStartedAsStated: z.string(),
        crawlEndedAsStated: z.string(),
      })
      .strict(),
    captures: z
      .array(
        z
          .object({
            url: z.string(),
            /** The capture time as the index states it: YYYYMMDDhhmmss, in UTC. */
            timestamp: z.string().regex(/^\d{14}$/),
            /** The HTTP status the crawler received, as the index states it; null where it writes "-". */
            status: TEXT,
            mime: TEXT,
            mimeDetected: TEXT,
            digest: TEXT,
            redirect: TEXT,
            languages: TEXT,
            /** Where the capture is stored in Common Crawl's WARC files, as the index states it. */
            warcFilename: z.string(),
            warcOffset: z.string().regex(/^\d+$/),
            warcLength: z.string().regex(/^\d+$/),
            /** Computed by this collector from the fields above (src/provenance.ts). */
            derived: z
              .object({
                /** timestamp in ISO 8601. */
                capturedAt: z.iso.datetime(),
              })
              .strict(),
          })
          .strict(),
      )
      .min(1),
    /** What this collector asked for, computed and stated; nothing here is Common Crawl's (src/provenance.ts). */
    derived: z
      .object({
        query: z
          .object({
            /** The CDX URL pattern: the domain and every host under it. */
            urlPattern: z.string(),
            limit: z.literal(COMMONCRAWL_CAPTURE_LIMIT),
          })
          .strict(),
        /**
         * The index returned as many captures as the limit allows, so it may hold
         * more than are listed. Not a measure of whether it does (Phase 3B review:
         * this was named "partial", asserting what was not measured).
         */
        limitReached: z.boolean(),
        note: z.literal(COMMONCRAWL_HISTORICAL_NOTE),
      })
      .strict(),
  })
  .strict();

export type CommoncrawlResult = z.infer<typeof COMMONCRAWL_RESULT>;

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
      `Common Crawl's ${what} answered ${String(status)}`,
      retryAfterMs(response),
    );
  }
  if (status === 401 || status === 403) {
    throw new UpstreamRejectedError(
      `Common Crawl's ${what} refused the request with ${String(status)}`,
    );
  }
  throw new UpstreamResponseError(
    `Common Crawl's ${what} answered an unexpected status ${String(status)}`,
  );
}

/** "20260905044625" → "2026-09-05T04:46:25Z"; the CDX timestamp is UTC. */
function isoFromCdx(timestamp: string): string {
  const iso = `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}T${timestamp.slice(8, 10)}:${timestamp.slice(10, 12)}:${timestamp.slice(12, 14)}Z`;
  const parsed = Date.parse(iso);
  // Round-tripping rejects values that parse only by rolling over (31 February),
  // as wayback and news do (Phase 3B review: this check was missing here).
  if (Number.isNaN(parsed) || new Date(parsed).toISOString() !== iso.replace("Z", ".000Z")) {
    throw new UpstreamResponseError(
      "Common Crawl's index listed a capture with an invalid timestamp",
    );
  }
  return iso;
}

export const commoncrawlCollector: Collector = defineCollector(
  {
    id: "commoncrawl",
    version: "1.0.0",
    displayName: "Common Crawl URL index",
    discipline: "TECHINT",
    targetTypes: ["DOMAIN"],
    collectionMode: "PASSIVE_API",
    source: "commoncrawl",
    credentials: { vaultIds: [], runsWithout: true },
    claimStrength: "REPORTED",
    timeoutMs: 180_000,
    resultSchema: COMMONCRAWL_RESULT,
  },
  async (ctx) => {
    const infoResponse = await ctx.fetch(`${ORIGIN}/collinfo.json`, {
      method: "GET",
      timeoutMs: FETCH_TIMEOUT_MS,
      headers: { accept: "application/json" },
    });
    refuseUnlessOk(infoResponse, "index list");
    const indexes = COLLINFO.safeParse(infoResponse.json());
    if (!indexes.success) {
      throw new UpstreamResponseError("Common Crawl's index list is not the documented shape");
    }
    // The newest crawl is the one that ended last; the stated times share one
    // fixed format, so they compare as strings.
    const newest = indexes.data.reduce((a, b) => (b.to > a.to ? b : a));

    const urlPattern = `*.${ctx.target.value}`;
    const params = new URLSearchParams({
      url: urlPattern,
      output: "json",
      limit: String(COMMONCRAWL_CAPTURE_LIMIT),
    });
    const cdxResponse = await ctx.fetch(`${ORIGIN}/${newest.id}-index?${params.toString()}`, {
      method: "GET",
      timeoutMs: FETCH_TIMEOUT_MS,
      headers: { accept: "application/x-ndjson, application/json" },
      maxBytes: CDX_MAX_BYTES,
    });
    // The CDX server answers a pattern with no captures with 404 and this message.
    if (cdxResponse.status === 404 && cdxResponse.text().includes("No Captures found")) {
      return ctx.notFound(
        cdxResponse,
        `Common Crawl's newest index (${newest.id}) holds no captures under this domain. ${COMMONCRAWL_HISTORICAL_NOTE}`,
      );
    }
    refuseUnlessOk(cdxResponse, "CDX index");

    const lines = cdxResponse
      .text()
      .split("\n")
      .filter((line) => line.trim().length > 0);
    if (lines.length === 0) {
      // A 200 with no lines is neither the documented empty answer nor a list.
      throw new UpstreamResponseError("Common Crawl's CDX index answered 200 with no captures");
    }
    const captures = lines.map((line) => {
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        throw new UpstreamResponseError(
          "Common Crawl's CDX index answered a line that is not JSON",
        );
      }
      const capture = CAPTURE.safeParse(value);
      if (!capture.success) {
        throw new UpstreamResponseError(
          "Common Crawl's CDX index answered a capture of an undocumented shape",
        );
      }
      const c = capture.data;
      const optional = (text: string | undefined): string | null =>
        text === undefined || text.length === 0 ? null : text;
      return {
        url: c.url,
        timestamp: c.timestamp,
        status: c.status === "-" || c.status.length === 0 ? null : c.status,
        mime: optional(c.mime),
        mimeDetected: optional(c["mime-detected"]),
        digest: optional(c.digest),
        redirect: optional(c.redirect),
        languages: optional(c.languages),
        warcFilename: c.filename,
        warcOffset: c.offset,
        warcLength: c.length,
        derived: { capturedAt: isoFromCdx(c.timestamp) },
      };
    });

    return ctx.found(
      {
        index: {
          id: newest.id,
          name: newest.name,
          crawlStartedAsStated: newest.from,
          crawlEndedAsStated: newest.to,
        },
        captures,
        derived: {
          query: { urlPattern, limit: COMMONCRAWL_CAPTURE_LIMIT },
          limitReached: captures.length >= COMMONCRAWL_CAPTURE_LIMIT,
          note: COMMONCRAWL_HISTORICAL_NOTE,
        },
      },
      // Each capture carries its own time; the listing as a whole has none.
      [
        { response: infoResponse, observedAt: null },
        { response: cdxResponse, observedAt: null },
      ],
    );
  },
);

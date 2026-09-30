/**
 * Wayback Machine captures: what the Internet Archive's CDX index lists for a
 * domain or a URL. Ported from the previous codebase's wayback adapter
 * (docs/audit/INVENTORY.md verdict: KEEP), onto the collector SDK.
 *
 * WHAT IT READS. The CDX index at web.archive.org/cdx/search/cdx: a keyless
 * query over the archive's own capture records. It never contacts the target;
 * the archive already crawled it, and this reads the index of what exists.
 *
 * THE QUERY, kept from the previous adapter:
 *   - DOMAIN: url=<domain>/*, which the CDX server treats as a prefix match
 *     on every path of that host (not its subdomains);
 *   - URL: url=<the exact URL>;
 *   - collapse=urlkey: one row per distinct URL key, the first capture the
 *     index holds for it (the index is sorted by URL, then date). For a URL
 *     target that is a single row: the first capture of that URL.
 *
 * WHAT IS REPORTED, AND WHAT IS NOT:
 *   - every capture as the archive states it: its raw timestamp, the URL it
 *     recorded (whose scheme, host or port may differ from the target), and its
 *     status code, MIME type and digest, each null where the archive writes "-";
 *   - capturedAt is that timestamp read as UTC, or null when it is not a real
 *     date. Never the fetch time;
 *   - at most 200 captures. The collector asks for 201 rows, so a partial
 *     result is known, not guessed: `derived.coverage.partial` is true exactly when the
 *     archive had more;
 *   - earliest and newest capture times are computed over the RETURNED rows
 *     only, and named "InResult" so they cannot be read as the target's whole
 *     archive history.
 *
 * observedAt. The one evidence item is the CDX response, and its observedAt is
 * null. The response lists many captures, each with its own time (in the
 * result); it has no single date. The newest capturedAt in the result is not
 * one either: with collapse=urlkey each row is the FIRST capture of its URL,
 * and the rows are the first 200 in URL order, so that value is a computed
 * figure over a subset, not when the archive last saw the target. (Phase 3B
 * review: it was used as observedAt, stamping a derived value on the evidence
 * as the archive's own date.)
 *
 * Changes from the previous adapter, each deliberate:
 *   - A body the collector cannot read is FAILED. The old parser returned an
 *     empty list for a non-array payload, a missing column or a malformed row,
 *     which read as "nothing archived".
 *   - An empty body is FAILED, not "no captures". The old adapter treated it as
 *     no captures; the archive's recorded answer for no captures is [] (see the
 *     domain-not-found fixture), so an empty body is not a recognised answer.
 *   - It asks for 201 rows and returns 200, so `partial` is exact. The old
 *     adapter flagged a result as capped whenever exactly 200 rows came back.
 *   - The previous normalize() step (entities, ARCHIVED_AS edges) belongs to
 *     the engine, not the collector, and is not part of this result.
 */
import { z } from "zod";
import { defineCollector, type Collector } from "../contract.ts";
import {
  CollectorDefinitionError,
  UpstreamRejectedError,
  UpstreamResponseError,
  UpstreamUnavailableError,
} from "../errors.ts";
import type { CapturedResponse } from "../fetcher/capture.ts";
import type { Target } from "../target.ts";

const CDX_ENDPOINT = "https://web.archive.org/cdx/search/cdx";
const REPLAY_BASE = "https://web.archive.org/web/";

/** The most captures a result carries. Always disclosed when the archive holds more. */
export const WAYBACK_ROW_LIMIT = 200;

/** The columns asked for, in the `fl` parameter. The answer is read by its header, not by position. */
const FIELDS = ["timestamp", "original", "statuscode", "mimetype", "digest"] as const;

/** The CDX index is slow on busy hosts: queries of 12 to 17 s were recorded. */
const FETCH_TIMEOUT_MS = 50_000;
const RUN_TIMEOUT_MS = 55_000;

const ISO_DATETIME = z.iso.datetime();

const CAPTURE = z.strictObject({
  timestamp: z
    .string()
    .min(1)
    .describe("The capture time exactly as the archive states it: YYYYMMDDhhmmss, in UTC."),
  originalUrl: z
    .string()
    .min(1)
    .describe(
      "The URL the archive captured, as it records it. Its scheme, host or port may differ from the target.",
    ),
  statusCode: z
    .string()
    .min(1)
    .nullable()
    .describe("The HTTP status the archive recorded; null where it records none."),
  mimeType: z
    .string()
    .min(1)
    .nullable()
    .describe("The MIME type the archive recorded; null where it records none."),
  digest: z
    .string()
    .min(1)
    .nullable()
    .describe("The archive's content digest; null where it records none."),
  /** Computed by this collector from the fields above (src/provenance.ts). */
  derived: z.strictObject({
    capturedAt: ISO_DATETIME.nullable().describe(
      "The timestamp as ISO 8601; null when the archive's value is not a real date.",
    ),
    replayUrl: z
      .string()
      .startsWith(REPLAY_BASE)
      .describe(
        "The archive's replay address for this capture, built from timestamp and originalUrl.",
      ),
  }),
});

export type WaybackCapture = z.infer<typeof CAPTURE>;

export const WAYBACK_RESULT = z.strictObject({
  captures: z.array(CAPTURE).min(1).max(WAYBACK_ROW_LIMIT),
  /** What this collector asked for and computed; nothing here is the archive's (src/provenance.ts). */
  derived: z.strictObject({
    query: z.strictObject({
      url: z
        .string()
        .min(1)
        .describe(
          "The CDX url parameter: <domain>/* for every path on the domain's host, or the exact URL.",
        ),
      collapse: z
        .literal("urlkey")
        .describe("One row per distinct URL key: the first capture the index holds for it."),
    }),
    coverage: z.strictObject({
      partial: z
        .boolean()
        .describe(
          "True when the archive holds more rows than rowLimit; only the first rowLimit, in the index's order, are included.",
        ),
      rowLimit: z.literal(WAYBACK_ROW_LIMIT),
      capturesReturned: z
        .number()
        .int()
        .min(1)
        .describe("Derived: the number of captures in this result."),
    }),
    earliestCapturedAtInResult: ISO_DATETIME.nullable().describe(
      "Derived: the earliest capturedAt among the returned captures only; null if none is readable.",
    ),
    newestCapturedAtInResult: ISO_DATETIME.nullable().describe(
      "Derived: the newest capturedAt among the returned captures only. Each row is the first capture of its URL, so this is not when the archive last saw the target.",
    ),
    capturesWithoutReadableTimestamp: z
      .number()
      .int()
      .min(0)
      .describe("Derived: returned captures whose timestamp is not a real date."),
  }),
});

export type WaybackResult = z.infer<typeof WAYBACK_RESULT>;

// ── Pure helpers, exported for direct tests ──────────────────────────────

/**
 * `YYYYMMDDhhmmss` (UTC) to ISO 8601, or null. A short or malformed value, or
 * one that only parses by rolling over (month 13, day 32), is an unknown time,
 * never a guess.
 */
export function waybackTimestampToIso(raw: string): string | null {
  if (!/^\d{14}$/.test(raw)) return null;
  const part = (start: number, end: number) => raw.slice(start, end);
  const iso = `${part(0, 4)}-${part(4, 6)}-${part(6, 8)}T${part(8, 10)}:${part(10, 12)}:${part(12, 14)}.000Z`;
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return null;
  // Round-tripping proves every component was real rather than merely numeric.
  return new Date(parsed).toISOString() === iso ? iso : null;
}

/** The archive's replay address for a capture. */
export function replayUrlFor(timestamp: string, originalUrl: string): string {
  return `${REPLAY_BASE}${timestamp}/${originalUrl}`;
}

/**
 * The CDX `url` parameter: a prefix match over the domain's paths, or the
 * exact URL. Only the two declared target types reach here.
 */
export function cdxUrlParameter(target: Target): string {
  switch (target.type) {
    case "DOMAIN":
      return `${target.value}/*`;
    case "URL":
      return target.value;
    default:
      throw new CollectorDefinitionError(
        'collector "wayback"',
        "only DOMAIN and URL targets are declared",
      );
  }
}

function cdxQueryUrl(target: Target): string {
  const params = new URLSearchParams({
    url: cdxUrlParameter(target),
    output: "json",
    fl: FIELDS.join(","),
    collapse: "urlkey",
    // One more than the limit, so "the archive holds more" is measured.
    limit: String(WAYBACK_ROW_LIMIT + 1),
  });
  return `${CDX_ENDPOINT}?${params.toString()}`;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((cell) => typeof cell === "string");
}

/**
 * Parses a CDX JSON answer: a header row naming the columns, then one row per
 * capture. Read by the header, so a change in column order cannot shift every
 * field by one. `[]` is the archive's answer for no captures, and a header with
 * no rows lists none either; both give an empty list. Anything else that is
 * not this shape throws: an unreadable answer is a failure, never "nothing
 * archived".
 */
export function parseCdxRows(payload: unknown): WaybackCapture[] {
  if (!Array.isArray(payload)) {
    throw new UpstreamResponseError("the CDX answer is not a JSON array");
  }
  const [header, ...rows] = payload as unknown[];
  if (header === undefined) return [];
  if (!isStringArray(header)) {
    throw new UpstreamResponseError("the CDX answer's first row is not a header of column names");
  }
  const column = (name: (typeof FIELDS)[number]) => header.indexOf(name);
  const iTimestamp = column("timestamp");
  const iOriginal = column("original");
  if (iTimestamp === -1 || iOriginal === -1) {
    throw new UpstreamResponseError("the CDX answer has no timestamp or original column");
  }
  const iStatus = column("statuscode");
  const iMime = column("mimetype");
  const iDigest = column("digest");

  return rows.map((row) => {
    if (!isStringArray(row) || row.length !== header.length) {
      throw new UpstreamResponseError("a CDX row does not match the header's columns");
    }
    // The CDX index writes "-" where it has no value. A column it did not
    // send is not stated either. Both are null, never a stand-in string.
    const cell = (index: number): string | null => {
      if (index === -1) return null;
      const value = row[index]?.trim();
      return value === undefined || value === "" || value === "-" ? null : value;
    };
    const timestamp = cell(iTimestamp);
    const originalUrl = cell(iOriginal);
    if (timestamp === null || originalUrl === null) {
      throw new UpstreamResponseError("a CDX row has no timestamp or original URL");
    }
    return {
      timestamp,
      originalUrl,
      statusCode: cell(iStatus),
      mimeType: cell(iMime),
      digest: cell(iDigest),
      derived: {
        capturedAt: waybackTimestampToIso(timestamp),
        replayUrl: replayUrlFor(timestamp, originalUrl),
      },
    };
  });
}

/**
 * The upstream's Retry-After, in milliseconds: delta-seconds, or an HTTP date
 * measured from when the response arrived. Null when absent or unreadable.
 */
export function retryAfterMs(response: CapturedResponse): number | null {
  const value = response.headers["retry-after"]?.trim();
  if (value === undefined || value === "") return null;
  if (/^\d+$/.test(value)) {
    const ms = Number(value) * 1000;
    return Number.isSafeInteger(ms) ? ms : null;
  }
  const at = Date.parse(value);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - response.receivedAt.getTime());
}

/** Every status the CDX API can answer with, mapped. Only a 2xx carries an answer. */
function requireAnswer(response: CapturedResponse): void {
  const { status } = response;
  if (status >= 200 && status <= 299) return;
  const said = `the Wayback CDX API answered HTTP ${String(status)}`;
  if (status === 429) {
    throw new UpstreamUnavailableError(`${said} (rate limited)`, retryAfterMs(response));
  }
  if (status >= 500 && status <= 599) {
    throw new UpstreamUnavailableError(said, retryAfterMs(response));
  }
  if (status === 401 || status === 403) throw new UpstreamRejectedError(said);
  // A 404 or any other status is not how the index says "no captures" (that
  // is 200 with []), so it is never read as one.
  throw new UpstreamResponseError(`${said}, which is not a query answer`);
}

function summarise(captures: readonly WaybackCapture[]) {
  const dated = captures
    .map((capture) => capture.derived.capturedAt)
    .filter((value): value is string => value !== null)
    .sort();
  return {
    earliestCapturedAtInResult: dated.at(0) ?? null,
    newestCapturedAtInResult: dated.at(-1) ?? null,
    capturesWithoutReadableTimestamp: captures.length - dated.length,
  };
}

export const waybackCollector: Collector = defineCollector(
  {
    id: "wayback",
    version: "1.0.0",
    displayName: "Wayback Machine captures",
    // The previous adapter tagged it MEDIAINT first (and TECHINT), and the
    // collector audit lists it as MEDIAINT (docs/audit/COLLECTORS.md row 8).
    discipline: "MEDIAINT",
    targetTypes: ["DOMAIN", "URL"],
    collectionMode: "PASSIVE_DATASET",
    source: "wayback-cdx",
    credentials: { vaultIds: [], runsWithout: true },
    claimStrength: "REPORTED",
    timeoutMs: RUN_TIMEOUT_MS,
    resultSchema: WAYBACK_RESULT,
  },
  async (ctx) => {
    const response = await ctx.fetch(cdxQueryUrl(ctx.target), {
      method: "GET",
      headers: { accept: "application/json" },
      timeoutMs: FETCH_TIMEOUT_MS,
    });
    requireAnswer(response);
    if (response.text().trim().length === 0) {
      throw new UpstreamResponseError(
        "the CDX answer was empty; the index answers a query with no captures with []",
      );
    }
    const rows = parseCdxRows(response.json());
    if (rows.length === 0) {
      // The detail states the query's scope, so absence is not read wider than
      // what was asked (Phase 3B review). It never repeats the target.
      return ctx.notFound(
        response,
        ctx.target.type === "DOMAIN"
          ? "The Wayback CDX index lists no captures for any path on this domain's host. Its subdomains were not searched."
          : "The Wayback CDX index lists no captures for this exact URL.",
      );
    }
    const captures = rows.slice(0, WAYBACK_ROW_LIMIT);
    const result: WaybackResult = {
      captures,
      derived: {
        query: { url: cdxUrlParameter(ctx.target), collapse: "urlkey" },
        coverage: {
          partial: rows.length > WAYBACK_ROW_LIMIT,
          rowLimit: WAYBACK_ROW_LIMIT,
          capturesReturned: captures.length,
        },
        ...summarise(captures),
      },
    };
    return ctx.found(result, [{ response, observedAt: null }]);
  },
);

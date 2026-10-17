/**
 * What the monitoring collectors (RSS, Bluesky, Reddit) share: the topic they
 * search for, and the parts of an item that are the same in each. Their items
 * follow the news collector's article shape (url, mobileUrl, title,
 * outletDomain, language, outletCountry, socialImageUrl, derived), each value
 * as its source gives it, with two additions the owner approved on
 * 2026-10-17: `published`, the source's own date as given, and, under
 * `derived`, `publishedAt` (null when the source gives none: never the time
 * of collection) and `region`. GDELT's own `seendate` is GDELT's and is not
 * carried over.
 */
import { z } from "zod";
import { TargetNotSearchableError, UpstreamUnavailableError } from "../errors.ts";
import type { CapturedResponse } from "../fetcher/capture.ts";
import type { Target } from "../target.ts";

/**
 * An item's claim strengths: that the item exists, at its source, is
 * OBSERVED; what it says is REPORTED, as the item's author's statement, never
 * the platform's. Stated by the collector, so it sits under `derived`.
 */
export const ITEM_CLAIM_STRENGTHS = z
  .object({ existence: z.literal("OBSERVED"), content: z.literal("REPORTED") })
  .strict();
export const itemClaimStrengths = { existence: "OBSERVED", content: "REPORTED" } as const;

/** A value as the source gives it, or null when it gives none. */
export const REPORTED_TEXT = z.string().min(1).nullable();

/**
 * The topic as one phrase: as typed, less one pair of outer quotes (straight
 * or curly), as news.ts reads one. A quote mark inside, or nothing inside the
 * quotes, cannot be one phrase, and is refused before anything is sent.
 */
export function topicPhrase(target: Target, upstream: string): string {
  switch (target.type) {
    case "TOPIC": {
      const quoted = /^"(.*)"$/su.exec(target.value) ?? /^“(.*)”$/su.exec(target.value);
      const phrase = (quoted?.[1] ?? target.value).trim();
      if (/["“”]/u.test(phrase)) {
        throw new TargetNotSearchableError(
          `${upstream} is searched for a topic as one phrase, so a topic with a quote mark inside cannot be searched`,
        );
      }
      if (phrase.length === 0) {
        throw new TargetNotSearchableError(`${upstream} cannot be searched for an empty phrase`);
      }
      return phrase;
    }
    default:
      throw new TargetNotSearchableError(`${upstream} is searched only for a topic`);
  }
}

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** A month or weekday by its English name, in full or its first three letters, any case; -1 for another word. */
function indexByName(names: readonly string[], word: string): number {
  const key = word.toLowerCase();
  return names.findIndex((name) => key === name || key === name.slice(0, 3));
}
/** RFC 822's named zones, in minutes east of UTC. A military letter other than Z means "unknown". */
const NAMED_ZONES: ReadonlyMap<string, number> = new Map([
  ["ut", 0],
  ["utc", 0],
  ["gmt", 0],
  ["z", 0],
  ["est", -300],
  ["edt", -240],
  ["cst", -360],
  ["cdt", -300],
  ["mst", -420],
  ["mdt", -360],
  ["pst", -480],
  ["pdt", -420],
]);

/** RFC 822/2822 (RSS): [Sat,] 17 Oct 2026 05:30[:00] +0530, an English month. */
const RFC_2822 =
  /^(?:([a-z]{3,9}),\s*)?(\d{1,2})\s+([a-z]{3,9})\s+(\d{4}|\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?\s*([+-]\d{2}:?\d{2}|[a-z]{1,3})$/i;
/** RFC 3339 (Atom, Bluesky): 2026-10-17T05:30[:00[.250]](Z|+05:30). */
const RFC_3339 =
  /^(\d{4})-(\d{2})-(\d{2})[t ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?\s*(z|[+-]\d{2}:?\d{2})$/i;

/** Minutes east of UTC, or null for a zone that states none for certain. */
function zoneMinutes(zone: string): number | null {
  const named = NAMED_ZONES.get(zone.toLowerCase());
  if (named !== undefined) return named;
  const offset = /^([+-])(\d{2}):?(\d{2})$/.exec(zone);
  if (offset === null) return null;
  const [, sign, hours, minutes] = offset;
  if (Number(hours) > 23 || Number(minutes) > 59) return null;
  return (sign === "-" ? -1 : 1) * (Number(hours) * 60 + Number(minutes));
}

/**
 * The instant the fields state, or null when any field is out of range or the
 * date does not exist (31 February is null, never 3 March).
 */
function instantOf(
  fields: {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
    ms: number;
  },
  offsetMinutes: number,
): Date | null {
  const { year, month, day, hour, minute, second, ms } = fields;
  if (hour > 23 || minute > 59 || second > 59) return null;
  const local = new Date(0);
  local.setUTCFullYear(year, month - 1, day);
  local.setUTCHours(hour, minute, second, ms);
  if (
    local.getUTCFullYear() !== year ||
    local.getUTCMonth() !== month - 1 ||
    local.getUTCDate() !== day
  ) {
    return null;
  }
  const at = new Date(local.getTime() - offsetMinutes * 60_000);
  // Only years 0000-9999 have an ISO 8601 form the result schemas accept.
  return at.getUTCFullYear() < 0 || at.getUTCFullYear() > 9999 ? null : at;
}

/**
 * A source's date as ISO 8601, or null when it gives none, or gives one this
 * cannot read for certain. Only the two forms feeds use are read, field by
 * field, never by a lenient parser that fills in what the source left out:
 * RFC 822/2822 (RSS) and RFC 3339 (Atom, Bluesky). A date with no time zone, a
 * two-digit year with no weekday to confirm it, a weekday that is not the
 * date's, a day the month does not have, or any other form is null, never this
 * server's reading or a guess.
 */
export function isoFromStatedDate(raw: string | null): string | null {
  if (raw === null) return null;
  const text = raw.trim();
  const rfc2822 = RFC_2822.exec(text);
  if (rfc2822 !== null) {
    const [, weekday, day, monthName, stated = "", hour, minute, second, zone] = rfc2822;
    const month = indexByName(MONTHS, monthName ?? "");
    const offset = zoneMinutes(zone ?? "");
    if (month < 0 || offset === null) return null;
    // A two-digit year is read by RFC 2822's own rule (00-49 is 20xx, 50-99 is
    // 19xx), and only when a weekday is stated to confirm it, checked below.
    if (stated.length === 2 && weekday === undefined) return null;
    const year =
      stated.length === 4 ? Number(stated) : Number(stated) + (Number(stated) < 50 ? 2000 : 1900);
    const at = instantOf(
      {
        year,
        month: month + 1,
        day: Number(day),
        hour: Number(hour),
        minute: Number(minute),
        second: Number(second ?? "0"),
        ms: 0,
      },
      offset,
    );
    if (at === null) return null;
    // A stated weekday must be the date's own, on the date as written.
    if (weekday !== undefined) {
      const local = new Date(at.getTime() + offset * 60_000).getUTCDay();
      if (indexByName(WEEKDAYS, weekday) !== local) return null;
    }
    return at.toISOString();
  }
  const rfc3339 = RFC_3339.exec(text);
  if (rfc3339 !== null) {
    const [, year, month, day, hour, minute, second, fraction, zone] = rfc3339;
    const offset = zoneMinutes(zone ?? "");
    if (offset === null) return null;
    const at = instantOf(
      {
        year: Number(year),
        month: Number(month),
        day: Number(day),
        hour: Number(hour),
        minute: Number(minute),
        second: Number(second ?? "0"),
        // Milliseconds, as ISO 8601 output carries: finer digits are dropped, never rounded up.
        ms: Number((fraction ?? "").slice(0, 3).padEnd(3, "0")),
      },
      offset,
    );
    return at === null ? null : at.toISOString();
  }
  return null;
}

/** Retry-After in milliseconds, in seconds or as an HTTP date; null when absent or unreadable. */
export function retryAfterMs(response: CapturedResponse): number | null {
  const value = response.headers["retry-after"]?.trim();
  if (value === undefined || value.length === 0) return null;
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const at = Date.parse(value);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - response.receivedAt.getTime());
}

/** 429 and 5xx: retry later. Everything else that is not handled is permanent. */
export function unavailableUnlessPermanent(
  response: CapturedResponse,
  asked: string,
): UpstreamUnavailableError | null {
  const { status } = response;
  if (status === 429 || status >= 500) {
    return new UpstreamUnavailableError(
      `${asked} answered ${String(status)}`,
      retryAfterMs(response),
    );
  }
  return null;
}

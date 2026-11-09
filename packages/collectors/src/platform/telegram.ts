/**
 * telegram.channel: the recent posts a Telegram public channel shows on its
 * web preview, newest first, read from `t.me/s/<handle>` — the only free,
 * unauthenticated route into a public channel, and exactly what a logged-out
 * browser sees. No credential, no login-walled content, no API. Its source is
 * UNVERIFIED (catalogue.ts, "telegram-preview"), so it runs only on recorded
 * answers until an owner records Telegram's terms.
 *
 * Ported from the previous codebase (legacy/src/utils/social.ts, audit verdict
 * ADAPT in docs/audit/INVENTORY.md). The parsing carries that code's three
 * recorded defect fixes — each the kind of silent misattribution this product
 * exists to make impossible — and a regression test pins each
 * (test/platform/telegram.test.ts):
 *   - Message slices are cut on `data-post="` boundaries, so a media-only post
 *     can no longer shift every later post's text up by one slot (the legacy
 *     parser zipped parallel id/text/time arrays by index).
 *   - A post's text is read from its own `js-message_text` div, never the
 *     truncated `js-message_reply_text` copy of the message it replies to, which
 *     renders first in the same slice.
 *   - A video is reported by its `<video src>` (an mp4), never the poster-frame
 *     JPEG, so a still is never labelled a video and never sent down an image path.
 * The legacy topic classifier (telegram-intel.ts, verdict DROP) is not ported:
 * it invented a "topic" and an "early signal" label the source never stated.
 *
 * What is observed and what is derived:
 *   - The bytes `t.me` served are the evidence (content-hashed by the evidence
 *     store). Each post's `postRef` (its `data-post` value, e.g. "<channel>/<n>")
 *     and `datetimeStated` (its `<time datetime>`, as written) are verbatim
 *     fragments of those bytes, so they are the REPORTED values a FOUND cites.
 *   - Everything parsed from the HTML — the tag-stripped, entity-decoded text,
 *     the message permalink, the date in ISO 8601, the media — is a computation
 *     over those bytes and lives under `derived`, never presented as something
 *     the source stated verbatim.
 *   - It invents nothing. A post with no stated date has `datetimeStated: null`
 *     and `publishedAt: null`, never the time of collection. A handle with no
 *     public preview (404/410) is reported not found, citing the response. A
 *     200 page this parser finds no messages in is EMPTY_UNCONFIRMED, never
 *     "no posts": the preview may be disabled or show only media forms this
 *     parser does not read, which is not proof the channel has none.
 *
 * Pagination follows the page's own "older messages" link — any anchor pointing
 * at this same channel's `/s/<handle>?before=<id>` URL, the documented way
 * t.me/s/ pages back — bounded to TELEGRAM_MAX_PAGES and TELEGRAM_MAX_POSTS, and
 * confined by the fetcher to t.me. Absent that link, there are no older messages.
 */
import { z } from "zod";
import { defineCollector, type Collector, type EvidenceItem } from "../contract.ts";
import {
  TargetNotSearchableError,
  UpstreamRejectedError,
  UpstreamResponseError,
} from "../errors.ts";
import type { CapturedResponse } from "../fetcher/capture.ts";
import type { UpstreamFetch } from "../fetcher/fetcher.ts";
import {
  isoFromStatedDate,
  ITEM_CLAIM_STRENGTHS,
  itemClaimStrengths,
  REPORTED_TEXT,
  unavailableUnlessPermanent,
} from "./monitoring.ts";

const ORIGIN = "https://t.me";
const FETCH_TIMEOUT_MS = 15_000;
/** At most this many preview pages are read in one run (bounded pagination). */
export const TELEGRAM_MAX_PAGES = 3;
/** At most this many posts are returned; a preview page holds ~20. */
export const TELEGRAM_MAX_POSTS = 60;
/**
 * A Telegram public channel handle: letters, digits and underscore. A username
 * target of any other shape (spaces, Unicode, punctuation) cannot be a channel
 * here, so it is reported not searchable, never as "no channel".
 */
const TELEGRAM_HANDLE = /^[A-Za-z0-9_]{3,32}$/;

// ── What the collector reports ──────────────────────────────────────────────

const TELEGRAM_MEDIA = z
  .object({
    /** The media URL as the preview stated it (never fetched by this collector). */
    url: z.string().min(1),
    /** image for a photo; video for a `<video>` element or a video poster frame. */
    type: z.enum(["image", "video"]),
    /** A poster/thumbnail URL as stated; null when the preview gives none. */
    thumbnailUrl: z.string().min(1).nullable(),
  })
  .strict();

const TELEGRAM_POST = z
  .object({
    /** The post reference, verbatim from `data-post` (e.g. "<channel>/<n>"): REPORTED. */
    postRef: z.string().min(1),
    /** The post's `<time datetime>` as written; null when it states none: REPORTED. */
    datetimeStated: REPORTED_TEXT,
    /** Everything parsed from the bytes; nothing here is a verbatim quote of the page. */
    derived: z
      .object({
        /** The post's permalink, built from its postRef. */
        url: z.url({ protocol: /^https$/ }),
        /** The message text, tag-stripped and entity-decoded; null when media-only. */
        text: REPORTED_TEXT,
        /** datetimeStated in ISO 8601; null when it states none or it cannot be read for certain. */
        publishedAt: z.iso.datetime().nullable(),
        /** Media the post carries, as the preview stated it; empty when it carries none. */
        media: z.array(TELEGRAM_MEDIA),
        claimStrengths: ITEM_CLAIM_STRENGTHS,
      })
      .strict(),
  })
  .strict();

export const TELEGRAM_CHANNEL_RESULT = z
  .object({
    /** The preview's posts, newest first, in page order, none dropped but duplicates. */
    posts: z.array(TELEGRAM_POST).min(1),
    derived: z
      .object({
        channel: z
          .object({
            /** The channel handle looked up (a leading @ removed). */
            handle: z.string().min(1),
            /** The preview page read: https://t.me/s/<handle>. */
            webUrl: z.url({ protocol: /^https$/ }),
          })
          .strict(),
        pages: z
          .object({
            /** Preview pages actually read (each contributed at least one new post). */
            fetched: z.number().int().min(1),
            /** The page bound for a run. */
            bound: z.literal(TELEGRAM_MAX_PAGES),
            /** Why paging stopped. */
            stoppedBecause: z.enum(["NO_OLDER_PAGE", "PAGE_BOUND_REACHED", "NO_NEW_POSTS"]),
          })
          .strict(),
        /** A preview shows the newest messages, never the full channel history. */
        newestPostsOnly: z.literal(true),
        /** How many posts the channel holds: never measured from a preview. */
        volume: z
          .object({ count: z.null(), reason: z.literal("PREVIEW_IS_NOT_THE_FULL_HISTORY") })
          .strict(),
      })
      .strict(),
  })
  .strict();

export type TelegramChannelResult = z.infer<typeof TELEGRAM_CHANNEL_RESULT>;
type TelegramMedia = z.infer<typeof TELEGRAM_MEDIA>;

interface RawPost {
  readonly postRef: string;
  readonly datetimeStated: string | null;
  readonly text: string | null;
  readonly media: readonly TelegramMedia[];
}

// ── Parsing (ported from legacy/src/utils/social.ts) ─────────────────────────

/**
 * Split a t.me/s/ page into one HTML slice per message, cut on `data-post="`
 * boundaries so every field of a message — its id, text, time and media — stays
 * together and a media-only post cannot desynchronise the ones after it.
 */
function splitMessages(html: string): string[] {
  const marker = /data-post="[^"]+"/g;
  const starts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = marker.exec(html)) !== null) starts.push(m.index);
  return starts.map((start, i) =>
    html.slice(start, i + 1 < starts.length ? starts[i + 1] : html.length),
  );
}

/**
 * Decode the entity set Telegram's preview HTML emits, after stripping tags.
 * `&amp;` is decoded last, so an escaped entity is never decoded twice.
 */
function decodeHtml(raw: string): string {
  const named: Record<string, string> = {
    "&quot;": '"',
    "&apos;": "'",
    "&nbsp;": " ",
    "&lt;": "<",
    "&gt;": ">",
  };
  return raw
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(?:quot|apos|nbsp|lt|gt);/g, (entity) => named[entity] ?? entity)
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) =>
      String.fromCodePoint(parseInt(code, 16)),
    )
    .replace(/&amp;/g, "&")
    .trim();
}

/** Media from one message slice. Scoped to the message's own `tgme_widget_message_*` classes. */
function mediaFrom(block: string): TelegramMedia[] {
  const out: TelegramMedia[] = [];
  const photoRe =
    /class="tgme_widget_message_photo_wrap[^"]*"[^>]*style="[^"]*background-image:url\('([^']+)'\)/g;
  let m: RegExpExecArray | null;
  while ((m = photoRe.exec(block)) !== null) {
    const url = m[1];
    if (url !== undefined) out.push({ url, type: "image", thumbnailUrl: url });
  }
  // Poster frames, in document order, each paired with the video it belongs to.
  const posters: string[] = [];
  const posterRe =
    /class="tgme_widget_message_video_thumb"[^>]*style="[^"]*background-image:url\('([^']+)'\)/g;
  while ((m = posterRe.exec(block)) !== null) {
    if (m[1] !== undefined) posters.push(m[1]);
  }
  // The real mp4 is present; emit it, never the poster JPEG, so a still is never
  // labelled a video asset.
  const videoRe = /<video[^>]*\bsrc="([^"]+)"/g;
  let videoIndex = 0;
  while ((m = videoRe.exec(block)) !== null) {
    const url = m[1];
    if (url !== undefined) {
      out.push({ url, type: "video", thumbnailUrl: posters[videoIndex] ?? null });
    }
    videoIndex += 1;
  }
  // A poster with no matching <video> still means a video is present (a round
  // video, or an embed whose file element the preview withholds): record it as a
  // video so nothing reads it as a photograph.
  for (let i = videoIndex; i < posters.length; i += 1) {
    const url = posters[i];
    if (url !== undefined) out.push({ url, type: "video", thumbnailUrl: url });
  }
  const seen = new Set<string>();
  return out.filter((item) => (seen.has(item.url) ? false : (seen.add(item.url), true)));
}

/** One message slice to a raw post, or null when it carries neither text nor media. */
function parsePost(block: string): RawPost | null {
  const idMatch = /data-post="([^"]+)"/.exec(block);
  const postRef = idMatch?.[1];
  if (postRef === undefined) return null;

  // The message's OWN text, never the `js-message_reply_text` copy of the
  // message it replies to, which renders first in the same slice.
  let text: string | null = null;
  const textRe = /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/g;
  let tm: RegExpExecArray | null;
  while ((tm = textRe.exec(block)) !== null) {
    const openTag = tm[0].slice(0, tm[0].indexOf(">"));
    if (openTag.includes("js-message_reply_text")) continue;
    const decoded = decodeHtml(tm[1] ?? "");
    text = decoded.length > 0 ? decoded : null;
    break;
  }

  const timeMatch = /<time[^>]*datetime="([^"]+)"/.exec(block);
  const datetimeStated = timeMatch?.[1] ?? null;
  const media = mediaFrom(block);
  if (text === null && media.length === 0) return null;
  return { postRef, datetimeStated, text, media };
}

/**
 * The URL of the channel's own "older messages" page, or null when the page
 * offers none. Any anchor whose href resolves to this same channel's
 * `/s/<handle>?before=<id>` is followed — the documented way t.me/s/ pages back
 * — and nothing else, so paging stays on the one channel's preview.
 */
function olderPageUrl(html: string, handle: string): string | null {
  for (const tag of html.match(/<a\b[^>]*>/gi) ?? []) {
    const hrefMatch = /\bhref\s*=\s*("([^"]*)"|'([^']*)')/i.exec(tag);
    const value = hrefMatch?.[2] ?? hrefMatch?.[3];
    if (value === undefined || value.length === 0) continue;
    let resolved: URL;
    try {
      resolved = new URL(value, ORIGIN);
    } catch {
      continue;
    }
    if (
      resolved.protocol === "https:" &&
      resolved.host === "t.me" &&
      resolved.pathname === `/s/${handle}` &&
      resolved.searchParams.has("before")
    ) {
      return resolved.toString();
    }
  }
  return null;
}

// ── Collector ────────────────────────────────────────────────────────────────

/** Whether the fetch may be read: OK for a 2xx, GONE for a 404/410; every other status throws, typed. */
function statusDisposition(response: CapturedResponse): "OK" | "GONE" {
  const { status } = response;
  if (status >= 200 && status <= 299) return "OK";
  if (status === 404 || status === 410) return "GONE";
  const unavailable = unavailableUnlessPermanent(response, "Telegram's channel preview");
  if (unavailable !== null) throw unavailable;
  if (status === 401 || status === 403) {
    throw new UpstreamRejectedError(
      `Telegram's channel preview was refused with ${String(status)}`,
    );
  }
  throw new UpstreamResponseError(
    `Telegram's channel preview answered an unexpected status ${String(status)}`,
  );
}

function fetchPreview(fetch: UpstreamFetch, url: string): Promise<CapturedResponse> {
  return fetch(url, {
    method: "GET",
    timeoutMs: FETCH_TIMEOUT_MS,
    headers: { accept: "text/html,application/xhtml+xml" },
  });
}

function toPost(raw: RawPost): z.infer<typeof TELEGRAM_POST> {
  return {
    postRef: raw.postRef,
    datetimeStated: raw.datetimeStated,
    derived: {
      url: `${ORIGIN}/${raw.postRef}`,
      text: raw.text,
      publishedAt: isoFromStatedDate(raw.datetimeStated),
      media: [...raw.media],
      claimStrengths: itemClaimStrengths,
    },
  };
}

export const telegramChannelCollector: Collector = defineCollector(
  {
    id: "telegram.channel",
    version: "1.0.0",
    displayName: "Telegram public channel preview",
    discipline: "SOCMINT",
    targetTypes: ["USERNAME"],
    collectionMode: "PASSIVE_PUBLIC_WEB",
    source: "telegram-preview",
    credentials: { vaultIds: [], runsWithout: true },
    claimStrength: "OBSERVED",
    timeoutMs: 60_000,
    resultSchema: TELEGRAM_CHANNEL_RESULT,
  },
  async (ctx) => {
    const handle = ctx.target.value.trim().replace(/^@/, "");
    if (!TELEGRAM_HANDLE.test(handle)) {
      throw new TargetNotSearchableError(
        "a Telegram public channel is looked up by its handle (letters, digits and underscore), which this target is not",
      );
    }
    const webUrl = `${ORIGIN}/s/${handle}`;

    const posts: RawPost[] = [];
    const seenRefs = new Set<string>();
    const citedPages: CapturedResponse[] = [];
    const fetchedUrls = new Set<string>();
    let url: string | null = webUrl;
    let stoppedBecause: "NO_OLDER_PAGE" | "PAGE_BOUND_REACHED" | "NO_NEW_POSTS" = "NO_OLDER_PAGE";
    let firstResponse: CapturedResponse | null = null;

    while (url !== null) {
      if (citedPages.length >= TELEGRAM_MAX_PAGES) {
        stoppedBecause = "PAGE_BOUND_REACHED";
        break;
      }
      if (fetchedUrls.has(url)) {
        // A link that points back at a page already read: stop, never loop.
        stoppedBecause = "NO_NEW_POSTS";
        break;
      }
      fetchedUrls.add(url);
      const response = await fetchPreview(ctx.fetch, url);
      if (firstResponse === null) firstResponse = response;
      const disposition = statusDisposition(response);
      if (disposition === "GONE") {
        if (citedPages.length === 0) {
          return ctx.notFound(
            response,
            "Telegram has no public preview for this channel handle: it does not exist, is private, or has the web preview disabled.",
          );
        }
        // An older page that is no longer there: keep what the earlier pages gave.
        stoppedBecause = "NO_OLDER_PAGE";
        break;
      }
      const contentType = response.headers["content-type"] ?? "";
      if (!/html/i.test(contentType)) {
        throw new UpstreamResponseError(
          `Telegram's channel preview answered ${contentType.trim().length > 0 ? contentType.trim() : "an unnamed type"}, not HTML`,
        );
      }
      const html = response.text();

      let addedFromPage = 0;
      let capReached = false;
      for (const block of splitMessages(html)) {
        if (posts.length >= TELEGRAM_MAX_POSTS) {
          capReached = true;
          break;
        }
        const post = parsePost(block);
        if (post === null || seenRefs.has(post.postRef)) continue;
        seenRefs.add(post.postRef);
        posts.push(post);
        addedFromPage += 1;
      }

      if (addedFromPage > 0) citedPages.push(response);

      if (capReached) {
        stoppedBecause = "PAGE_BOUND_REACHED";
        break;
      }
      if (addedFromPage === 0) {
        // No new posts on this page: the first page empty is unconfirmed (below);
        // a later page repeating the last one means there is nothing more.
        stoppedBecause = "NO_NEW_POSTS";
        break;
      }
      // The page's own older-messages link, or null when it offers none; a null
      // ends the loop with the default reason (NO_OLDER_PAGE).
      url = olderPageUrl(html, handle);
    }

    if (posts.length === 0) {
      // firstResponse is set: the loop ran at least once with a 2xx (a GONE first
      // page returned above, and a thrown status never reaches here).
      const response = firstResponse ?? null;
      if (response === null) {
        throw new UpstreamResponseError("Telegram's channel preview returned no response to cite");
      }
      return ctx.emptyUnconfirmed(
        response,
        "Telegram's public preview for this channel carried no messages this collector could read — unconfirmed: the preview may be disabled, or show only media forms this parser does not read, neither of which shows the channel has none.",
      );
    }

    const [firstPage, ...laterPages] = citedPages;
    if (firstPage === undefined) {
      // Unreachable: a non-empty posts list means at least one page was cited.
      throw new UpstreamResponseError(
        "Telegram's channel preview produced posts with no cited page",
      );
    }
    const evidence: [EvidenceItem, ...EvidenceItem[]] = [
      { response: firstPage, observedAt: null },
      ...laterPages.map((response) => ({ response, observedAt: null })),
    ];

    return ctx.found(
      {
        posts: posts.map(toPost),
        derived: {
          channel: { handle, webUrl },
          pages: { fetched: citedPages.length, bound: TELEGRAM_MAX_PAGES, stoppedBecause },
          newestPostsOnly: true,
          volume: { count: null, reason: "PREVIEW_IS_NOT_THE_FULL_HISTORY" },
        },
      },
      evidence,
    );
  },
);

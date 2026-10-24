/**
 * Direct article fetch: retrieves one exact article URL from the publisher the
 * tenant authorised, over the SSRF-hardened open-host fetch path, and records
 * what the page states about itself.
 *
 * This is Stage 3 of the exact-article work (docs/M1_DIRECT_ARTICLE_FETCH_REPORT.md).
 * It is ACTIVE: it reaches the publisher's own server directly, so a run needs
 * a scope authorisation in force for the exact target — a URL is cleared by an
 * in-force DOMAIN authorisation for its exact host (Stage 1, osint-engine
 * scope.ts). Its source is the one open-host source (catalogue.ts,
 * "direct-article"): https only, bound by the fetcher to the authorised
 * target's own host, every SSRF rule and every redirect re-checked. The source
 * is UNVERIFIED, so no deployment runs it until an owner records a per-publisher
 * verdict; the path is proven offline against recorded fixtures.
 *
 * What is observed and what is derived:
 *   - The raw bytes the publisher served are the evidence (content-hashed by the
 *     evidence store). `headline` — the first <title>'s inner text, trimmed but
 *     NOT decoded — is a verbatim fragment of those bytes, so it is the one
 *     REPORTED value FOUND cites. Everything extractArticle() produces is a
 *     parse of those bytes, so it lives under `derived` (a DERIVED claim), never
 *     presented as something the source stated verbatim.
 *   - It invents nothing. A field the page does not carry is null. A page it
 *     fetched but could not read as an article (no <title>, no body text, no
 *     metadata) is not FOUND — it is reported not found, citing the response.
 *   - A date is only what the page states, parsed strictly to ISO (article-extract.ts),
 *     never the time of collection.
 */
import { z } from "zod";
import { defineCollector, type Collector } from "../contract.ts";
import {
  UpstreamRejectedError,
  UpstreamResponseError,
  UpstreamUnavailableError,
} from "../errors.ts";
import type { CapturedResponse } from "../fetcher/capture.ts";
import { extractArticle, extractMentions, MAX_ARTICLE_MENTIONS } from "./article-extract.ts";

/** One GET per run; the open-host source's shared slot is waited for inside it. */
const FETCH_TIMEOUT_MS = 25_000;

/**
 * The most readable text kept from one article. The raw bytes are the evidence
 * (content-hashed); this bounded, decoded text is retained for analysis and
 * display, and the mention spans index it. A longer article is cut here, with a
 * flag, never dropped and never fabricated.
 */
const MAX_BODY_TEXT = 100_000;

const REPORTED_TEXT = z.string().min(1).nullable();

export const ARTICLE_RESULT = z
  .object({
    /**
     * The publisher's stated page title: the first <title>'s inner text,
     * trimmed, NOT entity-decoded — a verbatim fragment of the bytes the
     * publisher served, and the one value here that the source reported rather
     * than the collector parsed. Never a placeholder; a page with no <title> is
     * not reported FOUND.
     */
    headline: z.string().min(1),
    /** What this collector fetched and parsed; nothing here is a verbatim quote of the page. */
    derived: z
      .object({
        /** The exact article URL fetched: the authorised target. */
        url: z.url({ protocol: /^https$/ }),
        /** The publisher's host, from the URL — the source of the article. */
        outletDomain: z.string().min(1),
        /** A stable dedup key: the article URL with its fragment removed (origin, path and query kept). */
        dedupKey: z.url({ protocol: /^https$/ }),
        /** The page's declared <link rel=canonical> href, as written; null when it declares none. */
        canonicalUrl: REPORTED_TEXT,
        /** og:title/twitter:title/<title>, decoded and trimmed, for display; null when none. */
        title: REPORTED_TEXT,
        /** A stated author name (never a URL); null when none. */
        author: REPORTED_TEXT,
        /** The declared language (`<html lang>` / og:locale), as stated; null when none. */
        language: REPORTED_TEXT,
        /** The stated publication time in ISO 8601; null when the page states none or it is not a real date. */
        publishedAt: z.iso.datetime().nullable(),
        /** What the extractor drew: FULL_TEXT or METADATA_ONLY (NO_CONTENT is reported not found, not FOUND). */
        extractionStatus: z.enum(["FULL_TEXT", "METADATA_ONLY"]),
        /**
         * The readable body text the publisher served, decoded and bounded to
         * MAX_BODY_TEXT; "" when METADATA_ONLY. A parse of the bytes, never a
         * verbatim quote of them, and never fabricated — the mention spans below
         * index this stored text.
         */
        bodyText: z.string(),
        /** True when bodyText was cut to the length bound; the raw evidence still holds the whole page. */
        bodyTextTruncated: z.boolean(),
        /**
         * Unambiguous identifier mentions in bodyText (explicit URLs and emails),
         * each with its span; empty when the text states none. Never a guessed
         * person, organisation, place, bare domain or date.
         */
        mentions: z
          .array(
            z
              .object({
                kind: z.enum(["URL", "EMAIL_ADDRESS"]),
                value: z.string().min(1),
                start: z.number().int().min(0),
                end: z.number().int().min(0),
              })
              .strict(),
          )
          .max(MAX_ARTICLE_MENTIONS),
      })
      .strict(),
  })
  .strict();

export type ArticleResult = z.infer<typeof ARTICLE_RESULT>;

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
 * Whether the fetch may be read as an article. "OK" for a 2xx; "GONE" for a 404
 * or 410 (the article is not there — reported not found, citing the response).
 * Every other status is a failure, typed by whether a retry can help: 429 and
 * 5xx are retryable; 401/403 are a refusal; anything else is unexpected.
 */
function statusDisposition(response: CapturedResponse): "OK" | "GONE" {
  const { status } = response;
  if (status >= 200 && status <= 299) return "OK";
  if (status === 404 || status === 410) return "GONE";
  if (status === 429) {
    throw new UpstreamUnavailableError(
      "the publisher answered 429 to the article request",
      retryAfterMs(response),
    );
  }
  if (status >= 500) {
    throw new UpstreamUnavailableError(
      `the publisher answered ${String(status)} to the article request`,
      retryAfterMs(response),
    );
  }
  if (status === 401 || status === 403) {
    throw new UpstreamRejectedError(
      `the publisher refused the article request with ${String(status)}`,
    );
  }
  throw new UpstreamResponseError(
    `the publisher answered the article request with an unexpected status ${String(status)}`,
  );
}

/** The first <title>'s inner text, trimmed but not decoded: a verbatim fragment of the bytes, or null. */
function rawTitle(html: string): string | null {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (match === null) return null;
  const raw = (match[1] ?? "").trim();
  return raw.length > 0 ? raw : null;
}

/** The page's declared canonical URL (<link rel=canonical href=...>), as written; null when none. Best effort, bounded. */
function declaredCanonical(html: string): string | null {
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (!/\brel\s*=\s*(["']?)canonical\1/i.test(tag)) continue;
    const href = /\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(tag);
    const value = href?.[2] ?? href?.[3] ?? href?.[4] ?? null;
    if (value !== null && value.length > 0) return value;
  }
  return null;
}

/** The article URL without its fragment: the dedup key (origin, path and query kept). */
function dedupKeyOf(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  return parsed.toString();
}

export const articleCollector: Collector = defineCollector(
  {
    id: "article",
    version: "1.0.0",
    displayName: "Direct article fetch",
    discipline: "MEDIAINT",
    targetTypes: ["URL"],
    collectionMode: "ACTIVE",
    source: "direct-article",
    credentials: { vaultIds: [], runsWithout: true },
    claimStrength: "REPORTED",
    timeoutMs: 30_000,
    resultSchema: ARTICLE_RESULT,
  },
  async (ctx) => {
    const url = ctx.target.value;
    const response = await ctx.fetch(url, {
      method: "GET",
      timeoutMs: FETCH_TIMEOUT_MS,
      headers: { accept: "text/html,application/xhtml+xml" },
    });
    if (statusDisposition(response) === "GONE") {
      return ctx.notFound(
        response,
        `The publisher answered ${String(response.status)}: no article is available at this URL.`,
      );
    }
    const contentType = response.headers["content-type"] ?? "";
    if (!/html/i.test(contentType)) {
      throw new UpstreamResponseError(
        `the response is ${contentType.trim().length > 0 ? contentType.trim() : "an unnamed type"}, not an HTML article`,
      );
    }
    const html = response.text();
    const headline = rawTitle(html);
    const article = extractArticle(html);
    if (article.status === "NO_CONTENT" || headline === null) {
      return ctx.notFound(
        response,
        "The page was fetched, but it states no <title> and carries no extractable article text or metadata.",
      );
    }
    // The bounded, decoded body text, then the identifier mentions in exactly
    // that stored text (so the spans resolve against bodyText).
    const bodyText = article.text.slice(0, MAX_BODY_TEXT);
    return ctx.found(
      {
        headline,
        derived: {
          url,
          outletDomain: new URL(url).hostname,
          dedupKey: dedupKeyOf(url),
          canonicalUrl: declaredCanonical(html),
          title: article.title,
          author: article.author,
          language: article.language,
          publishedAt: article.publishedAt,
          extractionStatus: article.status,
          bodyText,
          bodyTextTruncated: article.text.length > MAX_BODY_TEXT,
          mentions: extractMentions(bodyText),
        },
      },
      // The one response is the article's bytes; its observedAt is the stated
      // publication time where the page gives one, never the time of collection.
      [
        {
          response,
          observedAt: article.publishedAt === null ? null : new Date(article.publishedAt),
        },
      ],
    );
  },
);

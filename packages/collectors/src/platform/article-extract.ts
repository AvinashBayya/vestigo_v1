/**
 * Deterministic, dependency-free extraction of an article's readable text and
 * metadata from an HTML document — the reusable core the M1 direct-article
 * collector will hand bytes a fetch already retrieved. It is the one part of
 * M1 with no network, SSRF, authorisation or source-verdict surface, so it is
 * safe and fully offline-testable on its own; the secure retrieval and the
 * per-tenant/per-domain authorisation that feed it are a separate, reviewed
 * step (docs/SOURCE_ACCESS_POLICY.md, docs/M1_DIRECT_ARTICLE_FETCH_REPORT.md).
 *
 * Rules, matching the rest of the collector stack:
 *   - It fetches nothing and interprets nothing as an instruction. The HTML is
 *     untrusted: scripts/styles/templates are stripped, never run or followed.
 *   - It invents nothing. A field the document does not carry is null; text it
 *     cannot find is empty; `status` says which.
 *   - No HTML/DOM library, as feed.ts uses none for RSS/Atom: a bounded set of
 *     single forward passes, so a hostile document costs time in proportion to
 *     its length (no nested quantifiers that could backtrack).
 *   - A date is read only from a field the document states, strictly parsed,
 *     never the time of collection.
 */

/** What the extractor could draw from the document. */
export type ArticleExtractionStatus =
  /** Readable body text was found. */
  | "FULL_TEXT"
  /** Metadata (title/date/author) but no usable body text. */
  | "METADATA_ONLY"
  /** Neither body text nor any metadata. */
  | "NO_CONTENT";

export interface ExtractedArticle {
  /** og:title, twitter:title or <title>, decoded and trimmed; null when none. */
  readonly title: string | null;
  /** The publication time the document states, as ISO 8601; null when it states none or it is not a real date. */
  readonly publishedAt: string | null;
  /** A stated author name (never a URL); null when none. */
  readonly author: string | null;
  /** The language the document declares (`<html lang>` / og:locale), as stated; null when none. */
  readonly language: string | null;
  /** The readable body text, paragraphs joined by newlines; "" when none was found. */
  readonly text: string;
  readonly status: ArticleExtractionStatus;
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  "#39": "'",
};

/** Decodes the HTML entities a stated value may carry; an unknown entity is left as written. */
function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+[0-9]*);/gi, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isNaN(code) ? whole : safeFromCode(code, whole);
    }
    if (body.startsWith("#")) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isNaN(code) ? whole : safeFromCode(code, whole);
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named ?? whole;
  });
}

function safeFromCode(code: number, whole: string): string {
  if (code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return whole;
  try {
    return String.fromCodePoint(code);
  } catch {
    return whole;
  }
}

/** The value of the first attribute named `attr` on a tag, or null. Bounded, no backtracking. */
function attrValue(tag: string, attr: string): string | null {
  const re = new RegExp(`\\b${attr}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i");
  const match = re.exec(tag);
  if (match === null) return null;
  const raw = match[2] ?? match[3] ?? match[4] ?? "";
  return decodeEntities(raw).trim();
}

/** Every `<meta ...>` tag, as written. */
function metaTags(html: string): readonly string[] {
  return html.match(/<meta\b[^>]*>/gi) ?? [];
}

/** The content of the first meta tag whose name/property (any of `keys`) matches, trimmed; null when none. */
function metaContent(metas: readonly string[], keys: readonly string[]): string | null {
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  for (const tag of metas) {
    const key = (attrValue(tag, "property") ?? attrValue(tag, "name"))?.toLowerCase();
    if (key !== undefined && wanted.has(key)) {
      const content = attrValue(tag, "content");
      if (content !== null && content.length > 0) return content;
    }
  }
  return null;
}

/** A stated date parsed strictly to ISO 8601, or null when absent or not a real instant. */
function statedDate(value: string | null): string | null {
  if (value === null || value.trim().length === 0) return null;
  const at = Date.parse(value.trim());
  if (Number.isNaN(at)) return null;
  return new Date(at).toISOString();
}

/** Removes a whole element (open tag to its matching close) wherever it appears; forward, bounded. */
function stripElement(html: string, tag: string): string {
  return html.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi"), " ");
}

/** The readable text of the body: paragraph and heading text, tags removed, entities decoded. */
function bodyText(html: string): string {
  let cleaned = html;
  for (const tag of ["script", "style", "noscript", "template", "svg", "head"]) {
    cleaned = stripElement(cleaned, tag);
  }
  const blocks = cleaned.match(/<(p|h1|h2|h3|li|blockquote)\b[^>]*>[\s\S]*?<\/\1>/gi) ?? [];
  const paragraphs = blocks
    .map((block) =>
      decodeEntities(block.replace(/<[^>]+>/g, " "))
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((text) => text.length > 0);
  return paragraphs.join("\n");
}

/** The document's title: og:title, then twitter:title, then <title>. */
function titleOf(html: string, metas: readonly string[]): string | null {
  const metaTitle = metaContent(metas, ["og:title", "twitter:title"]);
  if (metaTitle !== null) return metaTitle;
  const match = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (match === null) return null;
  const title = decodeEntities(match[1] ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return title.length > 0 ? title : null;
}

/** A stated author name, unless it is a URL (`article:author` is often a profile URL). */
function authorOf(metas: readonly string[]): string | null {
  const author = metaContent(metas, ["author", "article:author"]);
  if (author === null) return null;
  return /^https?:\/\//i.test(author) ? null : author;
}

/** The language the document declares: `<html lang>` or og:locale, as stated. */
function languageOf(html: string, metas: readonly string[]): string | null {
  const htmlTag = /<html\b[^>]*>/i.exec(html);
  const lang = htmlTag === null ? null : attrValue(htmlTag[0], "lang");
  if (lang !== null && lang.length > 0) return lang;
  return metaContent(metas, ["og:locale"]);
}

/**
 * Extracts an article from an HTML document. Pure: the same HTML always gives
 * the same result. `url` is not used to invent anything; it is accepted so a
 * caller keeps the article's identity beside the extraction.
 */
export function extractArticle(html: string): ExtractedArticle {
  const metas = metaTags(html);
  const title = titleOf(html, metas);
  const publishedAt = statedDate(
    metaContent(metas, [
      "article:published_time",
      "article:published",
      "date",
      "pubdate",
      "publishdate",
      "dc.date.issued",
    ]) ?? timeDatetime(html),
  );
  const author = authorOf(metas);
  const language = languageOf(html, metas);
  const text = bodyText(html);
  const status: ArticleExtractionStatus =
    text.length > 0
      ? "FULL_TEXT"
      : title !== null || publishedAt !== null || author !== null
        ? "METADATA_ONLY"
        : "NO_CONTENT";
  return { title, publishedAt, author, language, text, status };
}

/** The `datetime` of the first `<time datetime=...>`, when the metas carry no date. */
function timeDatetime(html: string): string | null {
  const match = /<time\b[^>]*>/i.exec(html);
  return match === null ? null : attrValue(match[0], "datetime");
}

// ── Identifier mentions in the readable text ────────────────────────────────

/** The most identifier mentions kept from one article (bounds a hostile link dump). */
export const MAX_ARTICLE_MENTIONS = 100;

/** One unambiguous identifier the article's text states, with its exact span. */
export interface ArticleMention {
  /** The identifier's kind, named as the entity kind it resolves to. */
  readonly kind: "URL" | "EMAIL_ADDRESS";
  /** The identifier exactly as it appears in the text. */
  readonly value: string;
  /** The span in the text: start inclusive, end exclusive. */
  readonly start: number;
  readonly end: number;
}

const URL_IN_TEXT = /https?:\/\/[^\s<>"'`)\]}]+/gi;
const EMAIL_IN_TEXT = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** Sentence punctuation a greedy match may trail; never part of the identifier. */
const TRAILING_PUNCT = /[.,;:!?)\]}'"]+$/;

/**
 * The unambiguous identifier mentions in an article's readable text: explicit
 * http(s) URLs and email addresses, each with its exact span. Deterministic and
 * high-precision — it NEVER guesses a person, organisation, place, bare domain
 * or date from prose (those are ambiguous, and are left to a later reviewed,
 * grounded step, never invented here). Deduplicated by value (the first span
 * kept) and bounded, so a hostile document cannot flood the graph. It reads
 * untrusted text as data only: nothing it finds is fetched or acted on.
 */
export function extractMentions(text: string): ArticleMention[] {
  const mentions: ArticleMention[] = [];
  const seen = new Set<string>();
  const urlSpans: [number, number][] = [];
  const add = (kind: ArticleMention["kind"], raw: string, start: number): void => {
    const value = raw.replace(TRAILING_PUNCT, "");
    if (value.length === 0) return;
    if (kind === "URL" && !URL.canParse(value)) return;
    const key = `${kind}\u0000${value.toLowerCase()}`;
    if (seen.has(key) || mentions.length >= MAX_ARTICLE_MENTIONS) return;
    seen.add(key);
    if (kind === "URL") urlSpans.push([start, start + value.length]);
    mentions.push({ kind, value, start, end: start + value.length });
  };
  for (const match of text.matchAll(URL_IN_TEXT)) add("URL", match[0], match.index);
  for (const match of text.matchAll(EMAIL_IN_TEXT)) {
    // An email-looking substring inside a URL (user@host) is part of the URL, not a mention.
    if (urlSpans.some(([from, to]) => match.index >= from && match.index < to)) continue;
    add("EMAIL_ADDRESS", match[0], match.index);
  }
  return mentions.sort(
    (a, b) => a.start - b.start || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0),
  );
}

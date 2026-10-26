/**
 * Reads an RSS 2.0, RSS 1.0 (RDF) or Atom feed: no XML library, no DTD, no
 * external entity, nothing fetched. Each value is returned twice: exactly as
 * the feed's text has it (entities and all, the inside of a CDATA section),
 * so the provenance check finds it in the payload, and decoded, for reading
 * and matching. A body that is neither format, or has an item that never
 * closes, is a typed failure, never an empty feed.
 *
 * Every scan moves forward only, here and in readableText, so a hostile body
 * (thousands of tags or entities that never close) costs time in proportion
 * to its length, never its square: the parse and the matching after it are
 * synchronous, and nothing else in the worker could stop them.
 */
import { UpstreamResponseError } from "../errors.ts";

/** One item, every value as the feed's text has it; null when the feed gives none. */
export interface FeedItem {
  readonly title: string | null;
  /**
   * RSS `<link>`, or its `<guid>` when the item has no link and the guid is a
   * permalink URL; Atom `<link href>` (alternate, or the first without a rel).
   */
  readonly link: string | null;
  /** The first of `<pubDate>`, `<dc:date>`, `<published>`, `<updated>`. */
  readonly published: string | null;
  /** An image URL: a `<media:content>` that is not a video, a `<media:thumbnail>`, or an image `<enclosure>`. */
  readonly image: string | null;
  /** `<description>`, `<summary>` or `<content>`, for matching only. */
  readonly summary: string | null;
}

export interface ParsedFeed {
  readonly kind: "rss" | "atom";
  /** The channel's `<language>`, or the Atom feed's `xml:lang`, as given. */
  readonly language: string | null;
  readonly items: readonly FeedItem[];
}

const CDATA = /^<!\[CDATA\[([\s\S]*?)\]\]>$/;

const escaped = (name: string): string => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Where the first `</name>` at or after `from` starts, case-insensitively; -1 when there is none. */
function closingAt(text: string, name: string, from: number): number {
  const close = new RegExp(`</${escaped(name)}\\s*>`, "gi");
  close.lastIndex = from;
  return close.exec(text)?.index ?? -1;
}

/** Every opening tag of `name` in `text`: its start and the index just past its `>`. */
function* openings(
  text: string,
  name: string,
): Generator<{ readonly start: number; readonly end: number; readonly tag: string }> {
  // `name` then a space, `>` or `/`: never a longer name (<link> is not <linkage>).
  const start = new RegExp(`<${escaped(name)}(?=[\\s>/])`, "gi");
  for (;;) {
    const found = start.exec(text);
    if (found === null) return;
    const close = text.indexOf(">", found.index);
    if (close < 0) return;
    yield { start: found.index, end: close + 1, tag: text.slice(found.index, close + 1) };
    start.lastIndex = close + 1;
  }
}

/** The first element `name`'s text as the feed has it: a CDATA section's inside, else raw, trimmed. */
function elementText(block: string, name: string): string | null {
  for (const open of openings(block, name)) {
    if (open.tag.endsWith("/>")) continue;
    const close = closingAt(block, name, open.end);
    if (close < 0) return null;
    const inner = block.slice(open.end, close).trim();
    const cdata = CDATA.exec(inner);
    const text = (cdata === null ? inner : (cdata[1] ?? "")).trim();
    return text.length === 0 ? null : text;
  }
  return null;
}

function attributeOf(tag: string, name: string): string | null {
  const value = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag);
  const found = value?.[1] ?? value?.[2];
  return found === undefined || found.trim().length === 0 ? null : found.trim();
}

function atomLink(block: string): string | null {
  for (const { tag } of openings(block, "link")) {
    const rel = attributeOf(tag, "rel");
    if (rel !== null && rel !== "alternate") continue;
    const href = attributeOf(tag, "href");
    if (href !== null) return href;
  }
  return null;
}

/** An RSS guid that is a permalink URL; RSS 2.0 reads a guid as one unless isPermaLink="false". */
function permalinkGuid(block: string): string | null {
  for (const { tag } of openings(block, "guid")) {
    if (attributeOf(tag, "isPermaLink")?.toLowerCase() === "false") return null;
    const text = elementText(block, "guid");
    return text !== null && /^https?:\/\//i.test(text) ? text : null;
  }
  return null;
}

/**
 * Whether a media element may be an image: a `medium` other than "image", or
 * a `type` naming another kind of file (video/mp4, an HLS playlist), says it
 * is not. One that states neither is taken as given (many feeds state neither).
 */
function mayBeImage(tag: string): boolean {
  const medium = attributeOf(tag, "medium")?.toLowerCase();
  if (medium !== undefined && medium !== "image") return false;
  const type = attributeOf(tag, "type")?.toLowerCase();
  return type === undefined || type.startsWith("image/") || type === "application/octet-stream";
}

function imageOf(block: string): string | null {
  // A video's media:content is passed over; its poster (a media:thumbnail,
  // nested or not) is still found after.
  for (const name of ["media:content", "media:thumbnail"]) {
    for (const { tag } of openings(block, name)) {
      if (!mayBeImage(tag)) continue;
      const url = attributeOf(tag, "url");
      if (url !== null) return url;
    }
  }
  for (const { tag } of openings(block, "enclosure")) {
    if (!/^image\//i.test(attributeOf(tag, "type") ?? "")) continue;
    const url = attributeOf(tag, "url");
    if (url !== null) return url;
  }
  return null;
}

function first(...values: (string | null)[]): string | null {
  return values.find((value) => value !== null) ?? null;
}

/**
 * Each item's text, in order; an item that never closes is a failure. The
 * next item is looked for after this one's close, never inside it, so a
 * thousand openings before one close are read once, not a thousand times.
 */
function blocksOf(text: string, name: string): string[] {
  const blocks: string[] = [];
  const start = new RegExp(`<${escaped(name)}(?=[\\s>/])`, "gi");
  const close = new RegExp(`</${escaped(name)}\\s*>`, "gi");
  for (;;) {
    const found = start.exec(text);
    if (found === null) return blocks;
    const tagEnd = text.indexOf(">", found.index);
    if (tagEnd < 0) throw new UpstreamResponseError(`the feed has an <${name}> that never closes`);
    if (text[tagEnd - 1] === "/") {
      start.lastIndex = tagEnd + 1;
      continue;
    }
    close.lastIndex = tagEnd + 1;
    const closing = close.exec(text);
    if (closing === null) {
      throw new UpstreamResponseError(`the feed has an <${name}> that never closes`);
    }
    blocks.push(text.slice(tagEnd + 1, closing.index));
    start.lastIndex = closing.index + closing[0].length;
  }
}

/**
 * An Atom entry less its `<source>` elements: a source holds the title, links
 * and dates of the feed the entry was copied from (RFC 4287 §4.2.11), never the
 * entry's own. One that never closes takes the rest of the entry with it.
 */
function withoutSources(block: string): string {
  const start = /<source(?=[\s>/])/gi;
  const close = /<\/source\s*>/gi;
  let kept = "";
  let from = 0;
  for (;;) {
    start.lastIndex = from;
    const found = start.exec(block);
    if (found === null) return kept + block.slice(from);
    kept += block.slice(from, found.index);
    const tagEnd = block.indexOf(">", found.index);
    if (tagEnd < 0) return kept;
    if (block[tagEnd - 1] === "/") {
      from = tagEnd + 1;
      continue;
    }
    close.lastIndex = tagEnd + 1;
    const closing = close.exec(block);
    if (closing === null) return kept;
    from = closing.index + closing[0].length;
  }
}

/** Parses a feed's text; throws when it is neither RSS nor Atom, or an item never closes. */
export function parseFeed(text: string): ParsedFeed {
  const head = text.slice(0, 4096);
  const rss = /<rss[\s>]|<rdf:RDF[\s>]/i.test(head);
  const atom = !rss && /<feed[\s>]/i.test(head);
  if (!rss && !atom) throw new UpstreamResponseError("the answer is not an RSS or Atom feed");
  const tag = rss ? "item" : "entry";
  const blocks = blocksOf(text, tag).map((block) => (atom ? withoutSources(block) : block));
  const items = blocks.map((block): FeedItem => ({
    title: elementText(block, "title"),
    link: rss ? (elementText(block, "link") ?? permalinkGuid(block)) : atomLink(block),
    published: first(
      elementText(block, "pubDate"),
      elementText(block, "dc:date"),
      elementText(block, "published"),
      elementText(block, "updated"),
    ),
    image: imageOf(block),
    summary: first(
      elementText(block, "description"),
      elementText(block, "summary"),
      elementText(block, "content"),
    ),
  }));
  const firstItem = openings(text, tag).next();
  const channel = firstItem.done === true ? text : text.slice(0, firstItem.value.start);
  const feedTag = atom ? openings(head, "feed").next() : null;
  const language = rss
    ? elementText(channel, "language")
    : feedTag !== null && feedTag.done !== true
      ? attributeOf(feedTag.value.tag, "xml:lang")
      : null;
  return { kind: rss ? "rss" : "atom", language, items };
}

/** HTML's Latin-1 entities, in code point order from U+00A0. */
const LATIN_1 = [
  "nbsp",
  "iexcl",
  "cent",
  "pound",
  "curren",
  "yen",
  "brvbar",
  "sect",
  "uml",
  "copy",
  "ordf",
  "laquo",
  "not",
  "shy",
  "reg",
  "macr",
  "deg",
  "plusmn",
  "sup2",
  "sup3",
  "acute",
  "micro",
  "para",
  "middot",
  "cedil",
  "sup1",
  "ordm",
  "raquo",
  "frac14",
  "frac12",
  "frac34",
  "iquest",
  "Agrave",
  "Aacute",
  "Acirc",
  "Atilde",
  "Auml",
  "Aring",
  "AElig",
  "Ccedil",
  "Egrave",
  "Eacute",
  "Ecirc",
  "Euml",
  "Igrave",
  "Iacute",
  "Icirc",
  "Iuml",
  "ETH",
  "Ntilde",
  "Ograve",
  "Oacute",
  "Ocirc",
  "Otilde",
  "Ouml",
  "times",
  "Oslash",
  "Ugrave",
  "Uacute",
  "Ucirc",
  "Uuml",
  "Yacute",
  "THORN",
  "szlig",
  "agrave",
  "aacute",
  "acirc",
  "atilde",
  "auml",
  "aring",
  "aelig",
  "ccedil",
  "egrave",
  "eacute",
  "ecirc",
  "euml",
  "igrave",
  "iacute",
  "icirc",
  "iuml",
  "eth",
  "ntilde",
  "ograve",
  "oacute",
  "ocirc",
  "otilde",
  "ouml",
  "divide",
  "oslash",
  "ugrave",
  "uacute",
  "ucirc",
  "uuml",
  "yacute",
  "thorn",
  "yuml",
];

/**
 * The named entities feeds use: XML's five (and HTML's upper-case forms of
 * them), the Latin-1 set and the typographic ones. Names are case-sensitive,
 * as in HTML; any other name is left as it was written. A Map, so a name such
 * as "constructor" is never found on an object's prototype.
 */
const NAMED: ReadonlyMap<string, string> = new Map([
  ...[
    ["amp", 38],
    ["AMP", 38],
    ["lt", 60],
    ["LT", 60],
    ["gt", 62],
    ["GT", 62],
    ["quot", 34],
    ["QUOT", 34],
    ["apos", 39],
    ["OElig", 338],
    ["oelig", 339],
    ["Scaron", 352],
    ["scaron", 353],
    ["Yuml", 376],
    ["fnof", 402],
    ["circ", 710],
    ["tilde", 732],
    ["ensp", 8194],
    ["emsp", 8195],
    ["thinsp", 8201],
    ["zwnj", 8204],
    ["zwj", 8205],
    ["lrm", 8206],
    ["rlm", 8207],
    ["ndash", 8211],
    ["mdash", 8212],
    ["lsquo", 8216],
    ["rsquo", 8217],
    ["sbquo", 8218],
    ["ldquo", 8220],
    ["rdquo", 8221],
    ["bdquo", 8222],
    ["dagger", 8224],
    ["Dagger", 8225],
    ["bull", 8226],
    ["hellip", 8230],
    ["permil", 8240],
    ["prime", 8242],
    ["Prime", 8243],
    ["lsaquo", 8249],
    ["rsaquo", 8250],
    ["oline", 8254],
    ["frasl", 8260],
    ["euro", 8364],
    ["trade", 8482],
    ["larr", 8592],
    ["uarr", 8593],
    ["rarr", 8594],
    ["darr", 8595],
    ["minus", 8722],
  ].map(([name, code]) => [String(name), String.fromCodePoint(Number(code))] as const),
  ...LATIN_1.map((name, index) => [name, String.fromCodePoint(0xa0 + index)] as const),
]);

/**
 * Text as a reader sees it: entities decoded, markup removed, spaces
 * collapsed. Each pattern stops at the next character that could start
 * another match, so a run of "<" or "&" with no end costs its length, never
 * its square.
 */
export function readableText(raw: string): string {
  const once = (value: string) =>
    value.replace(/&(#x[0-9a-f]{1,8}|#\d{1,8}|[a-z][a-z0-9]{1,31});/gi, (entity, name: string) => {
      if (name.startsWith("#")) {
        const hex = name.startsWith("#x") || name.startsWith("#X");
        const code = hex ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
        // A reference to no character is left as it was written.
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
      }
      return NAMED.get(name) ?? entity;
    });
  // Feeds often escape markup inside an element: decode, drop tags, decode again.
  return once(once(raw).replace(/<[^<>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

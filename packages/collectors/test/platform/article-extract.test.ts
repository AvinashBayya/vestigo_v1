/**
 * The pure article extractor: deterministic, offline, inventing nothing. These
 * tests pin that it draws only what a document states, decodes entities, never
 * runs or includes scripts, and reports an honest status — the safe M1 core,
 * independent of any network/authorisation surface.
 */
import { describe, expect, it } from "vitest";
import {
  extractArticle,
  extractMentions,
  MAX_ARTICLE_MENTIONS,
} from "../../src/platform/article-extract.ts";

const ARTICLE = `<!doctype html>
<html lang="en-IN">
  <head>
    <title>Site name — Some headline</title>
    <meta property="og:title" content="Some headline &amp; more" />
    <meta property="article:published_time" content="2026-10-15T14:30:00+05:30" />
    <meta name="author" content="A. Reporter" />
    <style>.x{color:red}</style>
    <script>var leak = "SECRET should never appear in text";</script>
  </head>
  <body>
    <article>
      <h1>Some headline &amp; more</h1>
      <p>First paragraph with an entity: Côte d&#39;Ivoire and a dash&#x2014;here.</p>
      <p>Second   paragraph  with   messy   spacing.</p>
    </article>
  </body>
</html>`;

describe("extractArticle", () => {
  it("draws title, stated published time, author, language and body text from a well-formed article", () => {
    const article = extractArticle(ARTICLE);
    expect(article.title).toBe("Some headline & more");
    // The stated offset time, normalised to ISO UTC — never the time of collection.
    expect(article.publishedAt).toBe("2026-10-15T09:00:00.000Z");
    expect(article.author).toBe("A. Reporter");
    expect(article.language).toBe("en-IN");
    expect(article.status).toBe("FULL_TEXT");
    expect(article.text).toContain("Côte d'Ivoire and a dash—here.");
    expect(article.text).toContain("Second paragraph with messy spacing.");
  });

  it("never includes script or style content, and does not run it", () => {
    const article = extractArticle(ARTICLE);
    expect(article.text).not.toContain("SECRET");
    expect(article.text).not.toContain("color:red");
  });

  it("invents no date: a document stating none has publishedAt null", () => {
    const html = `<html><head><title>No date here</title></head><body><p>Body.</p></body></html>`;
    expect(extractArticle(html).publishedAt).toBeNull();
  });

  it("reads a date only when it is a real instant, else null", () => {
    const bad = `<html><head><meta property="article:published_time" content="not a date"></head><body><p>x</p></body></html>`;
    expect(extractArticle(bad).publishedAt).toBeNull();
    const viaTime = `<html><body><time datetime="2024-01-02T03:04:05Z">Jan</time><p>x</p></body></html>`;
    expect(extractArticle(viaTime).publishedAt).toBe("2024-01-02T03:04:05.000Z");
  });

  it("treats an article:author that is a URL as no author", () => {
    const html = `<html><head><meta property="article:author" content="https://example.com/profile/a"><title>t</title></head><body><p>x</p></body></html>`;
    expect(extractArticle(html).author).toBeNull();
  });

  it("is METADATA_ONLY when there is a title but no body text", () => {
    const html = `<html><head><title>Only a title</title></head><body><nav>menu</nav></body></html>`;
    const article = extractArticle(html);
    expect(article.status).toBe("METADATA_ONLY");
    expect(article.text).toBe("");
    expect(article.title).toBe("Only a title");
  });

  it("is NO_CONTENT when the document carries neither metadata nor body text", () => {
    const article = extractArticle(`<html><body><div></div></body></html>`);
    expect(article).toMatchObject({ status: "NO_CONTENT", title: null, text: "" });
  });

  it("extracts what it can from malformed HTML without throwing", () => {
    const html = `<html><head><title>Broken`; // unclosed tags, truncated
    expect(() => extractArticle(html)).not.toThrow();
    expect(extractArticle(html).status).toBe("NO_CONTENT");
  });

  it("is deterministic: the same HTML always gives the same result", () => {
    expect(JSON.stringify(extractArticle(ARTICLE))).toBe(JSON.stringify(extractArticle(ARTICLE)));
  });
});

describe("extractMentions", () => {
  it("finds explicit URLs and emails with exact spans, in text order", () => {
    const text = "Write to press@example.com or see https://report.example.org/a for more.";
    const mentions = extractMentions(text);
    expect(mentions.map((m) => [m.kind, m.value])).toEqual([
      ["EMAIL_ADDRESS", "press@example.com"],
      ["URL", "https://report.example.org/a"],
    ]);
    for (const mention of mentions)
      expect(text.slice(mention.start, mention.end)).toBe(mention.value);
  });

  it("trims trailing sentence punctuation from a URL", () => {
    const [mention] = extractMentions("The report is at https://example.org/doc-1.");
    expect(mention?.value).toBe("https://example.org/doc-1");
    expect("The report is at https://example.org/doc-1.".slice(mention?.start, mention?.end)).toBe(
      "https://example.org/doc-1",
    );
  });

  it("invents nothing: bare domains, names, versions and dates are not mentions", () => {
    // No scheme, no @ — ambiguous, so not drawn. Preserve ambiguity as absence.
    expect(extractMentions("Acme Corp of example.com shipped v1.2.3 on 2026-10-21.")).toEqual([]);
    expect(extractMentions("The minister said the policy would change.")).toEqual([]);
  });

  it("deduplicates by value, keeping the first span", () => {
    const text = "See https://example.org/x. Again: https://example.org/x.";
    const mentions = extractMentions(text);
    expect(mentions).toHaveLength(1);
    expect(mentions[0]?.start).toBe(text.indexOf("https://example.org/x"));
  });

  it("does not treat an email-looking substring inside a URL as a separate email", () => {
    const mentions = extractMentions("Login at https://host.example/u@team/page here.");
    expect(mentions.map((m) => m.kind)).toEqual(["URL"]);
  });

  it("is bounded: a flood of distinct URLs is capped", () => {
    const text = Array.from(
      { length: MAX_ARTICLE_MENTIONS + 50 },
      (_, i) => `https://e.example/${String(i)}`,
    ).join(" ");
    expect(extractMentions(text)).toHaveLength(MAX_ARTICLE_MENTIONS);
  });

  it("is empty for text that states no identifier", () => {
    expect(extractMentions("")).toEqual([]);
    expect(extractMentions("A plain sentence with no links.")).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { AppError } from "./errors.ts";
import {
  EmptyQueryError,
  EXTERNAL_BROWSER_DISCLAIMER,
  generateBrowserSearchUrls,
  normalizeFiletype,
  normalizeSiteDomain,
  parseTargetedQuery,
} from "./targeted-search.ts";

describe("targeted search operator normalization", () => {
  it("normalizes domains with protocols, paths, and trailing slashes", () => {
    expect(normalizeSiteDomain("https://example.com/")).toBe("example.com");
    expect(normalizeSiteDomain("http://SUB.Example.ORG/path?query=1")).toBe("sub.example.org");
    expect(normalizeSiteDomain("*.reuters.com")).toBe("reuters.com");
    expect(normalizeSiteDomain("bbc.co.uk")).toBe("bbc.co.uk");
  });

  it("normalizes file extensions with leading dots and uppercase", () => {
    expect(normalizeFiletype(".PDF")).toBe("pdf");
    expect(normalizeFiletype("..docx")).toBe("docx");
    expect(normalizeFiletype("XLSX")).toBe("xlsx");
  });
});

describe("parseTargetedQuery", () => {
  it("throws EmptyQueryError on empty or whitespace query", () => {
    expect(() => parseTargetedQuery("")).toThrow(EmptyQueryError);
    expect(() => parseTargetedQuery("   \t\n  ")).toThrow(EmptyQueryError);
    const err = new EmptyQueryError();
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe("QUERY_EMPTY");
  });

  it("parses valid targeted operators, quoted phrases, and text terms", () => {
    const parsed = parseTargetedQuery(
      'site:reuters.com "oil spill" filetype:PDF inurl:investigation -confidential',
    );

    expect(parsed.isValid).toBe(true);
    expect(parsed.validationErrors).toEqual([]);
    expect(parsed.operators).toEqual([
      { operator: "site", rawValue: "reuters.com", normalizedValue: "reuters.com", negated: false },
      { operator: "filetype", rawValue: "PDF", normalizedValue: "pdf", negated: false },
      {
        operator: "inurl",
        rawValue: "investigation",
        normalizedValue: "investigation",
        negated: false,
      },
    ]);
    expect(parsed.exactPhrases).toEqual(["oil spill"]);
    expect(parsed.excludedTerms).toEqual(["confidential"]);
    expect(parsed.normalizedQuery).toBe(
      'site:reuters.com filetype:pdf inurl:investigation "oil spill" -confidential',
    );
  });

  it("flags unsupported legacy/deprecated operators with helpful explanations", () => {
    const parsed = parseTargetedQuery(
      "cache:example.com related:cnn.com link:reuters.com daterange:2459000-2459100",
    );

    expect(parsed.unsupportedOperators).toHaveLength(4);
    expect(parsed.unsupportedOperators[0]?.operator).toBe("cache");
    expect(parsed.unsupportedOperators[0]?.reason).toContain("Wayback Machine");
    expect(parsed.unsupportedOperators[1]?.operator).toBe("related");
    expect(parsed.unsupportedOperators[1]?.reason).toContain("Wikidata");
    expect(parsed.unsupportedOperators[2]?.operator).toBe("link");
    expect(parsed.unsupportedOperators[2]?.reason).toContain("crt.sh");
    expect(parsed.unsupportedOperators[3]?.operator).toBe("daterange");
    expect(parsed.unsupportedOperators[3]?.reason).toContain("GDELT");
  });

  it("detects syntax errors in operators", () => {
    const parsed = parseTargetedQuery(
      "site:not_a_valid_domain filetype:too_long_extension_12345 site:",
    );

    expect(parsed.isValid).toBe(false);
    expect(parsed.validationErrors).toHaveLength(3);
    expect(parsed.validationErrors[0]).toContain("invalid domain format");
    expect(parsed.validationErrors[1]).toContain("invalid extension format");
    expect(parsed.validationErrors[2]).toContain("requires a value");
  });

  it("handles curly quotes in phrases", () => {
    const parsed = parseTargetedQuery("“secret document” site:gov.uk");

    expect(parsed.exactPhrases).toEqual(["secret document"]);
    expect(parsed.operators).toHaveLength(1);
    expect(parsed.operators[0]?.operator).toBe("site");
    expect(parsed.normalizedQuery).toBe('site:gov.uk "secret document"');
  });

  it("supports negated operators like -site:example.com", () => {
    const parsed = parseTargetedQuery('leak -site:wikipedia.org -"internal memo"');

    expect(parsed.textTerms).toEqual(["leak"]);
    expect(parsed.operators).toEqual([
      {
        operator: "site",
        rawValue: "wikipedia.org",
        normalizedValue: "wikipedia.org",
        negated: true,
      },
    ]);
    expect(parsed.excludedTerms).toEqual(['"internal memo"']);
    expect(parsed.normalizedQuery).toBe('-site:wikipedia.org leak -"internal memo"');
  });
});

describe("generateBrowserSearchUrls", () => {
  it("generates correctly encoded URLs for Brave, DuckDuckGo, and Google", () => {
    const query = 'site:defence.gov.au "maritime patrol" filetype:pdf';
    const urls = generateBrowserSearchUrls(query);

    expect(urls).toHaveLength(3);

    const brave = urls.find((u) => u.engine === "brave");
    const ddg = urls.find((u) => u.engine === "duckduckgo");
    const google = urls.find((u) => u.engine === "google");

    expect(brave).toBeDefined();
    expect(ddg).toBeDefined();
    expect(google).toBeDefined();

    expect(brave?.url).toContain("https://search.brave.com/search?q=");
    expect(ddg?.url).toContain("https://duckduckgo.com/?q=");
    expect(google?.url).toContain("https://www.google.com/search?q=");

    // Verifies proper URL encoding of spaces, quotes, colons
    expect(brave?.url).toContain(
      encodeURIComponent('site:defence.gov.au filetype:pdf "maritime patrol"'),
    );
  });

  it("differentiates external browser fallback from automated collection", () => {
    const urls = generateBrowserSearchUrls("site:example.com");
    for (const link of urls) {
      expect(link.mode).toBe("EXTERNAL_BROWSER_FALLBACK");
      expect(link.requiresUserAction).toBe(true);
      expect(link.disclaimer).toBe(EXTERNAL_BROWSER_DISCLAIMER);
      expect(link.disclaimer).toContain("user-initiated");
      expect(link.disclaimer).toContain("not automatically collected");
    }
  });
});

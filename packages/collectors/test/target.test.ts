/**
 * parseTarget's DOMAIN and URL rules, and the regression behind the news-URL
 * bug: a valid article URL chosen as its DOMAIN must resolve to the publisher's
 * host (so a domain collector runs) rather than being rejected as malformed,
 * while a URL chosen as a URL keeps its full form, and nothing else that
 * validates a domain (an email address's domain part) is loosened.
 */
import { describe, expect, it } from "vitest";
import { InvalidTargetError } from "../src/errors.ts";
import { parseTarget } from "../src/target.ts";

const ARTICLE =
  "https://www.hindustantimes.com/india-news/some-headline-101700000000000.html?utm=x#top";

describe("DOMAIN target", () => {
  it("normalises a bare domain, lower-cased, trailing dot dropped", () => {
    expect(parseTarget("DOMAIN", "Example.COM.")).toEqual({ type: "DOMAIN", value: "example.com" });
  });

  it("resolves a full http(s) URL to its host, so an article URL can be investigated as its publisher", () => {
    expect(parseTarget("DOMAIN", ARTICLE)).toEqual({
      type: "DOMAIN",
      value: "www.hindustantimes.com",
    });
    expect(parseTarget("DOMAIN", "http://example.net/a/b?c=d")).toEqual({
      type: "DOMAIN",
      value: "example.net",
    });
  });

  it("refuses a string that is neither a domain nor an http(s) URL", () => {
    // The exact regression from the screenshot's message, now only for genuine non-domains.
    expect(() => parseTarget("DOMAIN", "not a domain at all")).toThrow(InvalidTargetError);
    try {
      parseTarget("DOMAIN", "ftp://example.com/x");
      throw new Error("expected a throw");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidTargetError);
      expect((error as InvalidTargetError).problem).toBe("MALFORMED");
    }
  });

  it("takes the host from a URL with a port and path, dropping the port", () => {
    expect(parseTarget("DOMAIN", "https://news.example.com:8443/a/b?c=d#e")).toEqual({
      type: "DOMAIN",
      value: "news.example.com",
    });
  });

  it("refuses a URL whose host is an IPv4 or IPv6 literal, or that carries credentials", () => {
    expect(() => parseTarget("DOMAIN", "http://127.0.0.1/path")).toThrow(InvalidTargetError);
    expect(() => parseTarget("DOMAIN", "http://[2001:db8::1]/path")).toThrow(InvalidTargetError);
    expect(() => parseTarget("DOMAIN", "https://user:pass@example.com/x")).toThrow(
      InvalidTargetError,
    );
  });
});

describe("URL target", () => {
  it("keeps a valid article URL as its full href", () => {
    expect(parseTarget("URL", ARTICLE)).toEqual({ type: "URL", value: ARTICLE });
  });

  it("refuses a non-http(s) or malformed URL", () => {
    expect(() => parseTarget("URL", "www.example.com/x")).toThrow(InvalidTargetError); // no scheme
    expect(() => parseTarget("URL", "ftp://example.com")).toThrow(InvalidTargetError);
  });
});

describe("the same URL under each chosen type", () => {
  it("is its full form as a URL and its host as a DOMAIN", () => {
    expect(parseTarget("URL", ARTICLE).value).toBe(ARTICLE);
    expect(parseTarget("DOMAIN", ARTICLE).value).toBe("www.hindustantimes.com");
  });
});

describe("the URL-to-host rule is only for the DOMAIN target", () => {
  it("does not loosen an email address's domain part: a URL there is still invalid", () => {
    expect(parseTarget("EMAIL_ADDRESS", "analyst@example.com")).toEqual({
      type: "EMAIL_ADDRESS",
      value: "analyst@example.com",
    });
    expect(() => parseTarget("EMAIL_ADDRESS", "analyst@https://evil.example.com")).toThrow(
      InvalidTargetError,
    );
  });
});

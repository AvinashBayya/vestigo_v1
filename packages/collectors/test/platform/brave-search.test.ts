import { parseTargetedQuery } from "@repo/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  UpstreamRejectedError,
  UpstreamResponseError,
  UpstreamUnavailableError,
} from "../../src/errors.ts";
import {
  braveSearchCollector,
  BraveMissingApiKeyError,
  BraveSearchDiscoveryProvider,
  type BraveSearchApiResponse,
} from "../../src/platform/brave-search.ts";

describe("BraveSearchDiscoveryProvider (offline)", () => {
  const provider = new BraveSearchDiscoveryProvider();

  it("throws BraveMissingApiKeyError when no API key is provided", async () => {
    const query = parseTargetedQuery("site:example.com report");
    await expect(provider.search(query)).rejects.toThrow(BraveMissingApiKeyError);
    await expect(provider.search(query, { apiKey: "" })).rejects.toThrow(BraveMissingApiKeyError);
    await expect(provider.search(query, { apiKey: "   " })).rejects.toThrow(
      BraveMissingApiKeyError,
    );
  });

  it("returns zero results without network calls for empty normalized query", async () => {
    const query = {
      rawQuery: "",
      normalizedQuery: "",
      textTerms: [],
      exactPhrases: [],
      operators: [],
      unsupportedOperators: [],
      excludedTerms: [],
      isValid: true,
      validationErrors: [],
    };
    const res = await provider.search(query, { apiKey: "test-token" });
    expect(res.results).toEqual([]);
    expect(res.totalEstimated).toBe(0);
  });

  describe("with mocked API fetch", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("parses and normalizes web results cleanly", async () => {
      const mockPayload: BraveSearchApiResponse = {
        query: { original: "site:reuters.com oil" },
        web: {
          total: 142,
          results: [
            {
              title: "Oil Prices Rise Following Report",
              url: "https://www.reuters.com/business/energy/oil-prices-rise-2026-10-20/",
              description: "Crude oil benchmarks gained 2% in London trade.",
              page_age: "2026-10-20T10:00:00Z",
              profile: { name: "Reuters" },
            },
            {
              title: "OPEC Production Survey",
              url: "https://www.reuters.com/business/energy/opec-survey-2026-10-15/",
              description: null,
              page_age: null,
            },
          ],
        },
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () => Promise.resolve(mockPayload),
      });

      const query = parseTargetedQuery("site:reuters.com oil");
      const res = await provider.search(query, { apiKey: "BSA-valid-key" });

      expect(res.provider).toBe("Brave Search API");
      expect(res.query).toBe("site:reuters.com oil");
      expect(res.totalEstimated).toBe(142);
      expect(res.results).toHaveLength(2);

      expect(res.results[0]).toEqual({
        title: "Oil Prices Rise Following Report",
        url: "https://www.reuters.com/business/energy/oil-prices-rise-2026-10-20/",
        snippet: "Crude oil benchmarks gained 2% in London trade.",
        publishedDate: "2026-10-20T10:00:00Z",
        sourceDomain: "www.reuters.com",
      });

      // Verifies no fabricated fallbacks: null stays null
      expect(res.results[1]?.snippet).toBeNull();
      expect(res.results[1]?.publishedDate).toBeNull();
    });

    it("throws UpstreamRejectedError on 401/403 unauthorized token", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
      });

      const query = parseTargetedQuery("site:example.com");
      await expect(provider.search(query, { apiKey: "bad-token" })).rejects.toThrow(
        UpstreamRejectedError,
      );
    });

    it("throws UpstreamUnavailableError on 429 rate limited", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
      });

      const query = parseTargetedQuery("site:example.com");
      await expect(provider.search(query, { apiKey: "rate-limited-token" })).rejects.toThrow(
        UpstreamUnavailableError,
      );
    });

    it("throws UpstreamResponseError on malformed response structure", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () => Promise.resolve({ unexpected: 123 }),
      });

      const query = parseTargetedQuery("site:example.com");
      await expect(provider.search(query, { apiKey: "valid-key" })).rejects.toThrow(
        UpstreamResponseError,
      );
    });
  });
});

describe("braveSearchCollector declaration", () => {
  it("declares exact metadata matching the catalogued source", () => {
    const decl = braveSearchCollector.declaration;
    expect(decl.id).toBe("brave-search");
    expect(decl.source).toBe("brave-search");
    expect(decl.discipline).toBe("TECHINT");
    expect(decl.collectionMode).toBe("PASSIVE_API");
    expect(decl.credentials.runsWithout).toBe(false);
    expect(decl.credentials.vaultIds).toEqual(["brave-search"]);
    expect(decl.claimStrength).toBe("REPORTED");
    expect(decl.timeoutMs).toBe(25_000);
    expect(decl.targetTypes).toEqual(["TOPIC", "ORGANIZATION", "DOMAIN"]);
  });
});

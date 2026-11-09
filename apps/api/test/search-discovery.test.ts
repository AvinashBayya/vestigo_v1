import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  Browser,
  createTestApi,
  provisionTestTenant,
  readyBrowser,
  type TestApi,
} from "./support.ts";

let api: TestApi;
let analyst: Browser;

beforeAll(async () => {
  api = await createTestApi();
  const provisioned = await provisionTestTenant(api, "search-disc");
  analyst = await readyBrowser(api, provisioned.owner, provisioned.tenantId);
});

afterAll(async () => {
  await api.close();
});

describe("POST /api/v1/search/discovery", () => {
  it("refuses unauthenticated requests with 401", async () => {
    const unauthed = new Browser(api);
    const res = await unauthed.request("POST", "/api/v1/search/discovery", {
      query: "site:example.com",
    });
    expect(res.status).toBe(401);
  });

  it("parses valid search operators and generates zero-cost browser search URLs", async () => {
    const res = await analyst.request("POST", "/api/v1/search/discovery", {
      query: 'site:reuters.com "oil spill" filetype:pdf -confidential',
      provider: "browser_fallback",
    });

    expect(res.status).toBe(200);
    const body = res.json<{
      query: string;
      parsed: {
        normalizedQuery: string;
        isValid: boolean;
        operators: { operator: string; normalizedValue: string }[];
        exactPhrases: string[];
        excludedTerms: string[];
      };
      browserUrls: { engine: string; url: string; mode: string }[];
      mode: string;
      requiresUserAction: boolean;
      disclaimer: string;
      credentialsStatus: string;
    }>();

    expect(body.mode).toBe("EXTERNAL_BROWSER_FALLBACK");
    expect(body.requiresUserAction).toBe(true);
    expect(body.credentialsStatus).toBe("NOT_REQUIRED");
    expect(body.disclaimer).toContain("user-initiated");
    expect(body.disclaimer).toContain("not automatically collected");

    expect(body.parsed.isValid).toBe(true);
    expect(body.parsed.operators).toContainEqual({
      operator: "site",
      normalizedValue: "reuters.com",
      rawValue: "reuters.com",
      negated: false,
    });
    expect(body.parsed.operators).toContainEqual({
      operator: "filetype",
      normalizedValue: "pdf",
      rawValue: "pdf",
      negated: false,
    });
    expect(body.parsed.exactPhrases).toEqual(["oil spill"]);
    expect(body.parsed.excludedTerms).toEqual(["confidential"]);

    expect(body.browserUrls).toHaveLength(3);
    const brave = body.browserUrls.find((u) => u.engine === "brave");
    const ddg = body.browserUrls.find((u) => u.engine === "duckduckgo");
    const google = body.browserUrls.find((u) => u.engine === "google");

    expect(brave?.url).toContain("https://search.brave.com/search?q=");
    expect(ddg?.url).toContain("https://duckduckgo.com/?q=");
    expect(google?.url).toContain("https://www.google.com/search?q=");
  });

  it("flags unsupported operators with honest alternative recommendations", async () => {
    const res = await analyst.request("POST", "/api/v1/search/discovery", {
      query: "cache:example.com related:cnn.com",
    });

    expect(res.status).toBe(200);
    const body = res.json<{
      parsed: {
        unsupportedOperators: { operator: string; reason: string }[];
      };
    }>();

    expect(body.parsed.unsupportedOperators).toHaveLength(2);
    expect(body.parsed.unsupportedOperators[0]?.operator).toBe("cache");
    expect(body.parsed.unsupportedOperators[0]?.reason).toContain("Wayback Machine");
    expect(body.parsed.unsupportedOperators[1]?.operator).toBe("related");
    expect(body.parsed.unsupportedOperators[1]?.reason).toContain("Wikidata");
  });

  it("handles provider=brave without configured key honestly with MISSING status and fallback URLs", async () => {
    const res = await analyst.request("POST", "/api/v1/search/discovery", {
      query: "site:example.com report",
      provider: "brave",
    });

    expect(res.status).toBe(200);
    const body = res.json<{
      mode: string;
      credentialsStatus: string;
      disclaimer: string;
      results: unknown[];
      browserUrls: unknown[];
    }>();

    expect(body.mode).toBe("EXTERNAL_BROWSER_FALLBACK");
    expect(body.credentialsStatus).toBe("MISSING");
    expect(body.disclaimer).toContain("No Brave Search API key is configured");
    expect(body.results).toEqual([]);
    expect(body.browserUrls).toHaveLength(3);
  });
});

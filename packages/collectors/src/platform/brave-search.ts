/**
 * Brave Search API: targeted search discovery and query-driven public web search
 * using the official Brave Search API.
 *
 * Implements:
 * 1. Provider-neutral search discovery (SearchDiscoveryProvider from @repo/core)
 * 2. Vestigo collector (braveSearchCollector) for official-API topic/domain discovery
 *
 * In accordance with Vestigo's zero-cost development model ($0 budget):
 * - No Brave key is required for application startup.
 * - No Brave key is required for core tests.
 * - If no key is provided, an honest MISSING_CREDENTIALS error is returned,
 *   directing the analyst to the zero-cost browser fallback or vault configuration.
 */
import {
  AppError,
  type SearchDiscoveryItem,
  type SearchDiscoveryProvider,
  type SearchDiscoveryResponse,
  type TargetedSearchQuery,
} from "@repo/core";
import { z } from "zod";
import { defineCollector, type Collector } from "../contract.ts";
import {
  UpstreamRejectedError,
  UpstreamResponseError,
  UpstreamUnavailableError,
} from "../errors.ts";
import type { CapturedResponse } from "../fetcher/capture.ts";

export const BRAVE_SEARCH_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const FETCH_TIMEOUT_MS = 25_000;
const MAX_SEARCH_RESULTS = 20;

export class BraveMissingApiKeyError extends AppError {
  readonly code = "MISSING_CREDENTIALS";

  constructor() {
    super(
      "No Brave Search API key configured. Provide an API key via tenant credentials or use the zero-cost browser search workflow.",
    );
    this.name = "BraveMissingApiKeyError";
  }
}

// ── What Brave sends ──────────────────────────────────────────────────────

export const BRAVE_WEB_RESULT_ITEM = z.object({
  title: z.string(),
  url: z.string(),
  description: z.string().nullable().optional(),
  page_age: z.string().nullable().optional(),
  profile: z
    .object({
      name: z.string().optional(),
    })
    .optional(),
});

export const BRAVE_SEARCH_RESPONSE_SCHEMA = z.object({
  query: z
    .object({
      original: z.string().optional(),
    })
    .optional(),
  web: z.object({
    total: z.number().nullable().optional(),
    results: z.array(BRAVE_WEB_RESULT_ITEM).optional().default([]),
  }),
});

export type BraveSearchApiResponse = z.infer<typeof BRAVE_SEARCH_RESPONSE_SCHEMA>;

// ── What the collector reports ────────────────────────────────────────────

export const BRAVE_SEARCH_RESULT = z.object({
  query: z.string(),
  resultsCount: z.number().int().min(0),
  results: z.array(
    z.object({
      url: z.string(),
      title: z.string(),
      snippet: z.string().nullable(),
      publishedDate: z.string().nullable(),
      sourceDomain: z.string(),
    }),
  ),
  derived: z.object({
    discoveredDomains: z.array(z.string()),
  }),
});

export type BraveSearchResult = z.infer<typeof BRAVE_SEARCH_RESULT>;

function extractHostname(urlString: string): string {
  return URL.canParse(urlString) ? new URL(urlString).hostname.toLowerCase() : "";
}

function refuseUnlessOk(response: CapturedResponse): void {
  if (response.status === 401 || response.status === 403) {
    throw new UpstreamRejectedError(
      `Brave Search refused the request (HTTP ${String(response.status)}). Check the API key.`,
    );
  }
  if (response.status === 429) {
    throw new UpstreamUnavailableError("Brave Search rate limit exceeded (HTTP 429).");
  }
  if (response.status < 200 || response.status >= 300) {
    throw new UpstreamResponseError(`Brave Search answered HTTP ${String(response.status)}`);
  }
}

/**
 * Transforms a parsed Brave Search API response into standard SearchDiscoveryItem records.
 */
export function transformBraveResults(data: BraveSearchApiResponse): SearchDiscoveryItem[] {
  const rawResults = data.web.results;
  return rawResults.slice(0, MAX_SEARCH_RESULTS).map((item) => ({
    url: item.url,
    title: item.title,
    snippet: item.description ?? null,
    publishedDate: item.page_age ?? null,
    sourceDomain: extractHostname(item.url),
  }));
}

export type FetchFunction = (
  input: string | URL,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    signal?: AbortSignal;
  },
) => Promise<{
  readonly status: number;
  readonly ok: boolean;
  readonly statusText?: string;
  json: () => Promise<unknown>;
}>;

/**
 * Provider-neutral Brave Search discovery provider.
 */
export class BraveSearchDiscoveryProvider implements SearchDiscoveryProvider {
  readonly name = "brave-search";
  private readonly customFetch: FetchFunction | undefined;

  constructor(customFetch?: FetchFunction) {
    this.customFetch = customFetch;
  }

  async search(
    query: TargetedSearchQuery,
    credentials?: { readonly apiKey?: string },
  ): Promise<SearchDiscoveryResponse> {
    const key = credentials?.apiKey?.trim();
    if (!key) {
      throw new BraveMissingApiKeyError();
    }

    const queryStr = query.normalizedQuery.trim();
    if (queryStr.length === 0) {
      return {
        provider: "Brave Search API",
        query: "",
        results: [],
        totalEstimated: 0,
        disclaimer: "Empty search query.",
      };
    }

    const url = new URL(BRAVE_SEARCH_ENDPOINT);
    url.searchParams.set("q", queryStr);
    url.searchParams.set("count", "20");

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, FETCH_TIMEOUT_MS);

    try {
      const caller =
        this.customFetch ??
        ((input, init) => (globalThis as unknown as { fetch: FetchFunction }).fetch(input, init));
      const response = await caller(url.toString(), {
        method: "GET",
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": key,
        },
        signal: controller.signal,
      });

      if (response.status === 401 || response.status === 403) {
        throw new UpstreamRejectedError(
          `Brave Search API key rejected (HTTP ${String(response.status)}).`,
        );
      }
      if (response.status === 429) {
        throw new UpstreamUnavailableError("Brave Search API rate limit reached (HTTP 429).");
      }
      if (!response.ok) {
        throw new UpstreamResponseError(
          `Brave Search API error HTTP ${String(response.status)}: ${response.statusText ?? "unknown"}`,
        );
      }

      const json = await response.json();
      const parsed = BRAVE_SEARCH_RESPONSE_SCHEMA.safeParse(json);
      if (!parsed.success) {
        throw new UpstreamResponseError("Brave Search API response did not match expected schema.");
      }

      const items = transformBraveResults(parsed.data);
      const totalEstimated = parsed.data.web.total ?? null;

      return {
        provider: "Brave Search API",
        query: queryStr,
        results: items,
        totalEstimated,
        disclaimer: "Results retrieved via official Brave Search API using configured credentials.",
      };
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        throw new UpstreamUnavailableError("Brave Search API request timed out.");
      }
      throw new UpstreamUnavailableError(
        `Failed to reach Brave Search API: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * Collector definition for Brave Search in the OSINT engine pipeline.
 */
export const braveSearchCollector: Collector = defineCollector(
  {
    id: "brave-search",
    version: "1.0.0",
    displayName: "Brave Search API",
    discipline: "TECHINT",
    targetTypes: ["TOPIC", "ORGANIZATION", "DOMAIN"],
    collectionMode: "PASSIVE_API",
    source: "brave-search",
    credentials: {
      vaultIds: ["brave-search"],
      runsWithout: false,
    },
    claimStrength: "REPORTED",
    timeoutMs: FETCH_TIMEOUT_MS,
    resultSchema: BRAVE_SEARCH_RESULT,
  },
  async (ctx) => {
    const cred = ctx.credentials.get("brave-search");
    if (cred === null) {
      throw new UpstreamRejectedError(
        "Missing required 'brave-search' credential in tenant vault.",
      );
    }

    const query = ctx.target.value;
    const url = new URL(BRAVE_SEARCH_ENDPOINT);
    url.searchParams.set("q", query);
    url.searchParams.set("count", "20");

    const response = await ctx.fetch(url.toString(), {
      method: "GET",
      timeoutMs: FETCH_TIMEOUT_MS,
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": cred.expose(),
      },
    });

    refuseUnlessOk(response);

    const parsed = BRAVE_SEARCH_RESPONSE_SCHEMA.safeParse(response.json());
    if (!parsed.success) {
      throw new UpstreamResponseError("Brave Search answer did not match expected schema.");
    }

    const items = transformBraveResults(parsed.data);
    if (items.length === 0) {
      return ctx.notFound(response, `Brave Search found no results for '${query}'.`);
    }

    const uniqueDomains = Array.from(
      new Set(items.map((i) => i.sourceDomain).filter((d) => d.length > 0)),
    );

    return ctx.found(
      {
        query,
        resultsCount: items.length,
        results: items,
        derived: {
          discoveredDomains: uniqueDomains,
        },
      },
      [{ response, observedAt: null }],
    );
  },
);

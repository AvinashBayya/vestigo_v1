import {
  generateBrowserSearchUrls,
  parseTargetedQuery,
  type SearchDiscoveryItem,
} from "@repo/core";
import { BraveSearchDiscoveryProvider } from "@repo/collectors";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { tenantOf } from "../http/access.ts";
import type { Services } from "../services.ts";
import { PROTECTED_ERRORS, SECURITY } from "./schemas.ts";

const SearchOperatorSchema = z.object({
  operator: z.enum(["site", "filetype", "inurl", "intitle"]),
  rawValue: z.string(),
  normalizedValue: z.string(),
  negated: z.boolean(),
});

const UnsupportedOperatorSchema = z.object({
  operator: z.string(),
  rawToken: z.string(),
  reason: z.string(),
});

const BrowserSearchLinkSchema = z.object({
  engine: z.enum(["brave", "duckduckgo", "google"]),
  name: z.string(),
  url: z.string(),
  mode: z.literal("EXTERNAL_BROWSER_FALLBACK"),
  requiresUserAction: z.literal(true),
  disclaimer: z.string(),
});

const SearchDiscoveryItemSchema = z.object({
  url: z.string(),
  title: z.string(),
  snippet: z.string().nullable(),
  publishedDate: z.string().nullable(),
  sourceDomain: z.string(),
});

export function searchDiscoveryRoutes(services: () => Services): FastifyPluginAsyncZod {
  return (app) => {
    app.post(
      "/api/v1/search/discovery",
      {
        config: { access: { permission: "investigation:read", action: "search.discovery" } },
        schema: {
          operationId: "searchDiscovery",
          summary:
            "Targeted public-web search discovery: query operator parsing and zero-cost browser search URL generation",
          description:
            "Accepts a query with targeted search operators (site:, filetype:, inurl:, intitle:, exact phrases, exclusions). Validates and normalizes operators, flags unsupported operators with honest explanations, and generates verified external browser-search URLs (Brave Search, DuckDuckGo, Google) for user-initiated research ($0 budget). If an official Brave Search API key is configured in tenant credentials or environment, official API discovery can be requested; otherwise returns honest MISSING_CREDENTIALS error with verified browser URLs.",
          tags: ["search"],
          security: SECURITY,
          body: z.object({
            query: z.string().trim().min(1).max(500),
            provider: z.enum(["browser_fallback", "brave"]).default("browser_fallback"),
          }),
          response: {
            200: z.object({
              query: z.string(),
              parsed: z.object({
                rawQuery: z.string(),
                normalizedQuery: z.string(),
                textTerms: z.array(z.string()),
                exactPhrases: z.array(z.string()),
                operators: z.array(SearchOperatorSchema),
                unsupportedOperators: z.array(UnsupportedOperatorSchema),
                excludedTerms: z.array(z.string()),
                isValid: z.boolean(),
                validationErrors: z.array(z.string()),
              }),
              browserUrls: z.array(BrowserSearchLinkSchema),
              mode: z.enum(["EXTERNAL_BROWSER_FALLBACK", "OFFICIAL_API"]),
              requiresUserAction: z.boolean(),
              disclaimer: z.string(),
              results: z.array(SearchDiscoveryItemSchema),
              totalEstimated: z.number().nullable(),
              credentialsStatus: z.enum(["NOT_REQUIRED", "CONFIGURED", "MISSING"]),
            }),
            ...PROTECTED_ERRORS,
          },
        },
      },
      async (request) => {
        const { query, provider } = request.body;
        const context = tenantOf(request);

        // Parse and normalize operators
        const parsed = parseTargetedQuery(query);
        const browserUrls = generateBrowserSearchUrls(parsed);

        const parsedResponse = {
          rawQuery: parsed.rawQuery,
          normalizedQuery: parsed.normalizedQuery,
          textTerms: [...parsed.textTerms],
          exactPhrases: [...parsed.exactPhrases],
          operators: parsed.operators.map((op) => ({ ...op })),
          unsupportedOperators: parsed.unsupportedOperators.map((op) => ({ ...op })),
          excludedTerms: [...parsed.excludedTerms],
          isValid: parsed.isValid,
          validationErrors: [...parsed.validationErrors],
        };

        if (provider === "brave") {
          let apiKey: string | null = null;
          try {
            const rows = await services().vault.list(context, { limit: 50 });
            const activeBrave = rows.find(
              (r) => r.provider === "brave-search" && r.revokedAt === null,
            );
            if (activeBrave !== undefined) {
              const principal = request.principal;
              const actor =
                principal?.kind === "session"
                  ? ({ kind: "USER", userId: principal.userId } as const)
                  : principal?.kind === "api_key"
                    ? ({ kind: "API_KEY", apiKeyId: principal.apiKeyId } as const)
                    : ({ kind: "SYSTEM" } as const);

              const authorization =
                principal?.kind === "session"
                  ? {
                      method: "SESSION" as const,
                      permission: "investigation:read" as const,
                      sessionId: principal.sessionId,
                    }
                  : principal?.kind === "api_key"
                    ? {
                        method: "API_KEY" as const,
                        permission: "investigation:read" as const,
                        sessionId: null,
                      }
                    : { method: "SYSTEM" as const, permission: null, sessionId: null };

              const revealed = await services().vault.reveal(context, activeBrave.id, {
                actor,
                authorization,
                purpose: "Brave Search Discovery",
                requestId: request.id,
              });
              apiKey = revealed.expose();
            }
          } catch {
            // Vault read not available
          }

          if (!apiKey && process.env.BRAVE_API_KEY) {
            apiKey = process.env.BRAVE_API_KEY.trim();
          }

          if (!apiKey) {
            return {
              query,
              parsed: parsedResponse,
              browserUrls,
              mode: "EXTERNAL_BROWSER_FALLBACK" as const,
              requiresUserAction: true,
              disclaimer:
                "No Brave Search API key is configured for this tenant. Use the verified browser search URLs below for zero-cost research, or configure a key in Settings > Credentials.",
              results: [],
              totalEstimated: null,
              credentialsStatus: "MISSING" as const,
            };
          }

          try {
            const braveProvider = new BraveSearchDiscoveryProvider();
            const discoveryRes = await braveProvider.search(parsed, { apiKey });
            return {
              query,
              parsed: parsedResponse,
              browserUrls,
              mode: "OFFICIAL_API" as const,
              requiresUserAction: false,
              disclaimer: discoveryRes.disclaimer,
              results: discoveryRes.results as SearchDiscoveryItem[],
              totalEstimated: discoveryRes.totalEstimated,
              credentialsStatus: "CONFIGURED" as const,
            };
          } catch (err) {
            return {
              query,
              parsed: parsedResponse,
              browserUrls,
              mode: "EXTERNAL_BROWSER_FALLBACK" as const,
              requiresUserAction: true,
              disclaimer: `Brave Search API failed: ${err instanceof Error ? err.message : String(err)}. Falling back to external browser search.`,
              results: [],
              totalEstimated: null,
              credentialsStatus: "CONFIGURED" as const,
            };
          }
        }

        return {
          query,
          parsed: parsedResponse,
          browserUrls,
          mode: "EXTERNAL_BROWSER_FALLBACK" as const,
          requiresUserAction: true,
          disclaimer:
            "External browser navigation is user-initiated. Results are not automatically collected into Vestigo. To generate evidence and claims, copy individual target URLs into Vestigo's URL investigation.",
          results: [],
          totalEstimated: null,
          credentialsStatus: "NOT_REQUIRED" as const,
        };
      },
    );
    return Promise.resolve();
  };
}

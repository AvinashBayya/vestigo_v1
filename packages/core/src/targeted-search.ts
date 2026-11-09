/**
 * Targeted search discovery: query and operator parsing, validation,
 * normalization, unsupported-operator detection, and no-key browser URL generation.
 *
 * Designed for targeted OSINT investigations ($0 budget, no paid API required).
 * Provides a provider-neutral interface for search discovery while generating
 * verified external browser URLs with an explicit user disclaimer.
 */
import { AppError } from "./errors.ts";

export interface SearchOperator {
  readonly operator: "site" | "filetype" | "inurl" | "intitle";
  readonly rawValue: string;
  readonly normalizedValue: string;
  readonly negated: boolean;
}

export interface UnsupportedOperator {
  readonly operator: string;
  readonly rawToken: string;
  readonly reason: string;
}

export interface TargetedSearchQuery {
  readonly rawQuery: string;
  readonly normalizedQuery: string;
  readonly textTerms: readonly string[];
  readonly exactPhrases: readonly string[];
  readonly operators: readonly SearchOperator[];
  readonly unsupportedOperators: readonly UnsupportedOperator[];
  readonly excludedTerms: readonly string[];
  readonly isValid: boolean;
  readonly validationErrors: readonly string[];
}

export interface BrowserSearchLink {
  readonly engine: "brave" | "duckduckgo" | "google";
  readonly name: string;
  readonly url: string;
  readonly mode: "EXTERNAL_BROWSER_FALLBACK";
  readonly requiresUserAction: true;
  readonly disclaimer: string;
}

export interface SearchDiscoveryItem {
  readonly url: string;
  readonly title: string;
  readonly snippet: string | null;
  readonly publishedDate: string | null;
  readonly sourceDomain: string;
}

export interface SearchDiscoveryResponse {
  readonly provider: string;
  readonly query: string;
  readonly results: readonly SearchDiscoveryItem[];
  readonly totalEstimated: number | null;
  readonly disclaimer: string;
}

export interface SearchDiscoveryProvider {
  readonly name: string;
  search(
    query: TargetedSearchQuery,
    credentials?: { readonly apiKey?: string },
  ): Promise<SearchDiscoveryResponse>;
}

export class EmptyQueryError extends AppError {
  readonly code = "QUERY_EMPTY";

  constructor() {
    super("Search query is empty: specify search terms or operators.");
    this.name = "EmptyQueryError";
  }
}

const KNOWN_UNSUPPORTED: Readonly<Record<string, string>> = {
  cache:
    "The cache: operator has been retired by major search engines. In Vestigo, inspect historical snapshots using the Wayback Machine collector.",
  related:
    "The related: operator is deprecated and unsupported across modern search engines. Use Wikidata entity graph exploration in Vestigo instead.",
  link: "The link: operator was retired by Google and Bing. Use Certificate Transparency log intelligence (crt.sh) in Vestigo instead.",
  info: "The info: operator was retired by Google.",
  daterange:
    "The daterange: operator requires Julian calendar dates and is unreliable. Use GDELT topic runs with ISO time-scoping in Vestigo instead.",
};

const SUPPORTED_OPERATOR_NAMES = new Set(["site", "filetype", "inurl", "intitle"]);
const DOMAIN_PATTERN = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;
const EXTENSION_PATTERN = /^[a-z0-9]{1,10}$/i;

/** Strips protocol, userinfo, port, path, and leading dots/wildcards from a domain input. */
export function normalizeSiteDomain(raw: string): string {
  let cleaned = raw.trim().toLowerCase();
  if (cleaned.startsWith("https://")) cleaned = cleaned.slice(8);
  else if (cleaned.startsWith("http://")) cleaned = cleaned.slice(7);
  // Strip path or query
  const slash = cleaned.indexOf("/");
  if (slash !== -1) cleaned = cleaned.slice(0, slash);
  const colon = cleaned.indexOf(":");
  if (colon !== -1) cleaned = cleaned.slice(0, colon);
  // Strip leading wildcard or dot
  cleaned = cleaned.replace(/^[*.]+/, "");
  return cleaned;
}

/** Normalizes a file extension (e.g. '.PDF' -> 'pdf'). */
export function normalizeFiletype(raw: string): string {
  return raw.trim().toLowerCase().replace(/^\.+/, "");
}

/**
 * Tokenizes a query string respecting straight and curly double quotes,
 * including negated phrases (-"phrase" or -“phrase”).
 */
function tokenizeQuery(raw: string): string[] {
  const tokens: string[] = [];
  const regex = /-?"[^"]*"|-?“[^”]*”|[^\s"“]+/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(raw)) !== null) {
    const token = match[0].trim();
    if (token.length > 0) tokens.push(token);
  }
  return tokens;
}

/**
 * Parses and validates a targeted search query with search operators.
 */
export function parseTargetedQuery(raw: string): TargetedSearchQuery {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new EmptyQueryError();
  }

  const tokens = tokenizeQuery(trimmed);
  const textTerms: string[] = [];
  const exactPhrases: string[] = [];
  const operators: SearchOperator[] = [];
  const unsupportedOperators: UnsupportedOperator[] = [];
  const excludedTerms: string[] = [];
  const validationErrors: string[] = [];

  for (const token of tokens) {
    // Exact quoted phrase
    if (
      (token.startsWith('"') && token.endsWith('"')) ||
      (token.startsWith("“") && token.endsWith("”"))
    ) {
      const phrase = token.slice(1, -1).trim();
      if (phrase.length > 0) {
        exactPhrases.push(phrase);
      }
      continue;
    }

    // Negated quoted phrase: -"phrase"
    if (
      (token.startsWith('-"') && token.endsWith('"')) ||
      (token.startsWith("-“") && token.endsWith("”"))
    ) {
      const phrase = token.slice(2, -1).trim();
      if (phrase.length > 0) {
        excludedTerms.push(`"${phrase}"`);
      }
      continue;
    }

    // Check for operator syntax: [optional -]key:value
    const isNegated = token.startsWith("-");
    const testToken = isNegated ? token.slice(1) : token;
    const colonIndex = testToken.indexOf(":");

    if (colonIndex > 0) {
      const opKey = testToken.slice(0, colonIndex).toLowerCase();
      const opVal = testToken.slice(colonIndex + 1);

      // Check unsupported
      if (opKey in KNOWN_UNSUPPORTED) {
        unsupportedOperators.push({
          operator: opKey,
          rawToken: token,
          reason: KNOWN_UNSUPPORTED[opKey] as string,
        });
        continue;
      }

      // Check supported
      if (SUPPORTED_OPERATOR_NAMES.has(opKey)) {
        if (opVal.length === 0) {
          validationErrors.push(`Operator '${opKey}:' requires a value.`);
          continue;
        }

        if (opKey === "site") {
          const normalized = normalizeSiteDomain(opVal);
          if (!DOMAIN_PATTERN.test(normalized)) {
            validationErrors.push(
              `Operator 'site:${opVal}' has an invalid domain format. Expected domain like 'example.com'.`,
            );
          } else {
            operators.push({
              operator: "site",
              rawValue: opVal,
              normalizedValue: normalized,
              negated: isNegated,
            });
          }
          continue;
        }

        if (opKey === "filetype") {
          const normalized = normalizeFiletype(opVal);
          if (!EXTENSION_PATTERN.test(normalized)) {
            validationErrors.push(
              `Operator 'filetype:${opVal}' has an invalid extension format. Expected extension like 'pdf', 'docx', 'csv'.`,
            );
          } else {
            operators.push({
              operator: "filetype",
              rawValue: opVal,
              normalizedValue: normalized,
              negated: isNegated,
            });
          }
          continue;
        }

        if (opKey === "inurl" || opKey === "intitle") {
          const normalized = opVal.trim();
          operators.push({
            operator: opKey,
            rawValue: opVal,
            normalizedValue: normalized,
            negated: isNegated,
          });
          continue;
        }
      }
    }

    // Plain negation: -word
    if (isNegated && testToken.length > 0) {
      excludedTerms.push(testToken);
      continue;
    }

    // Free text term
    textTerms.push(token);
  }

  // Rebuild normalized query string
  const normalizedParts: string[] = [];

  for (const op of operators) {
    const prefix = op.negated ? `-${op.operator}:` : `${op.operator}:`;
    normalizedParts.push(`${prefix}${op.normalizedValue}`);
  }

  for (const phrase of exactPhrases) {
    normalizedParts.push(`"${phrase}"`);
  }

  for (const term of textTerms) {
    normalizedParts.push(term);
  }

  for (const excl of excludedTerms) {
    if (excl.startsWith('"')) {
      normalizedParts.push(`-${excl}`);
    } else {
      normalizedParts.push(`-${excl}`);
    }
  }

  const normalizedQuery = normalizedParts.join(" ");

  return {
    rawQuery: trimmed,
    normalizedQuery,
    textTerms,
    exactPhrases,
    operators,
    unsupportedOperators,
    excludedTerms,
    isValid: validationErrors.length === 0,
    validationErrors,
  };
}

export const EXTERNAL_BROWSER_DISCLAIMER =
  "External browser navigation is user-initiated. Results are not automatically collected into Vestigo. To generate evidence and claims, copy individual target URLs into Vestigo's URL investigation.";

/**
 * Generates verified external browser search URLs for user-initiated targeted research ($0 no-key fallback).
 */
export function generateBrowserSearchUrls(
  query: string | TargetedSearchQuery,
): BrowserSearchLink[] {
  const parsed = typeof query === "string" ? parseTargetedQuery(query) : query;
  const encoded = encodeURIComponent(parsed.normalizedQuery);

  return [
    {
      engine: "brave",
      name: "Brave Search",
      url: `https://search.brave.com/search?q=${encoded}`,
      mode: "EXTERNAL_BROWSER_FALLBACK",
      requiresUserAction: true,
      disclaimer: EXTERNAL_BROWSER_DISCLAIMER,
    },
    {
      engine: "duckduckgo",
      name: "DuckDuckGo",
      url: `https://duckduckgo.com/?q=${encoded}`,
      mode: "EXTERNAL_BROWSER_FALLBACK",
      requiresUserAction: true,
      disclaimer: EXTERNAL_BROWSER_DISCLAIMER,
    },
    {
      engine: "google",
      name: "Google Search",
      url: `https://www.google.com/search?q=${encoded}`,
      mode: "EXTERNAL_BROWSER_FALLBACK",
      requiresUserAction: true,
      disclaimer: EXTERNAL_BROWSER_DISCLAIMER,
    },
  ];
}

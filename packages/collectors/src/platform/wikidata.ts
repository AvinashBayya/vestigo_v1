/**
 * Wikidata entity search: the items Wikidata's search matches to an
 * organisation name, with their labels, descriptions and claims exactly as
 * Wikidata states them.
 *
 * REWRITE, extracted from the previous codebase's news route (legacy
 * src/routes/news.tsx, the corporate registry search and the handle lookup).
 * The data-path defects this fixes, each with a regression test in
 * test/platform/wikidata.test.ts (docs/audit/REPORT.md, fabrication list):
 *   - A QID as a registration number: `fileNo = lei || entityId` rendered a
 *     Wikidata item id as a company file number. Here the item id is reported
 *     as the Wikidata item id and nothing else.
 *   - An invented status: `status: "Active"` for any hit asserted a live
 *     corporate registration. There is no status field; anything Wikidata
 *     states is a claim, reported as one.
 *   - An address fallback: headquarters fell back to the free-text
 *     description, then to "Registered Address Undisclosed". There is no
 *     headquarters field; P159, when present, is a claim like any other.
 *   - "Verified" matches: search hits were labelled "Verified Wikidata
 *     Profile". Every item here is a candidate that Wikidata's search matched
 *     by label or alias, and the result says so.
 *   - Variation probing: legacy searched derived variations of the query and
 *     took the first item with social claims. Here one search runs, for the
 *     target exactly as given, and every candidate is reported.
 */
import { z } from "zod";
import { defineCollector, type Collector } from "../contract.ts";
import {
  UpstreamRejectedError,
  UpstreamResponseError,
  UpstreamUnavailableError,
} from "../errors.ts";
import type { CapturedResponse } from "../fetcher/capture.ts";

const ENDPOINT = "https://www.wikidata.org/w/api.php";

/** How many candidates the search asks for. */
export const WIKIDATA_CANDIDATE_LIMIT = 5;
/** Labels, descriptions and the search itself are in English. */
export const WIKIDATA_LANGUAGE = "en";

const FETCH_TIMEOUT_MS = 20_000;
/** Claims of large organisations run to hundreds of kilobytes per item. */
const ENTITIES_MAX_BYTES = 20 * 1024 * 1024;

/** A fixed statement carried in every result, so no reader takes a match for an identity. */
export const WIKIDATA_CANDIDATE_NOTE =
  "Candidates are items Wikidata's search matched to the name by label or alias. A match is not a confirmed identity.";

// ── What Wikidata sends ──────────────────────────────────────────────────

const API_ERROR = z.object({
  error: z.object({ code: z.string(), info: z.string().optional() }),
});

const SEARCH = z.object({
  search: z.array(
    z.object({
      id: z.string().regex(/^Q\d+$/),
      match: z.object({ type: z.string(), text: z.string() }).optional(),
    }),
  ),
  "search-continue": z.number().optional(),
});

const MONOLINGUAL = z.record(z.string(), z.object({ language: z.string(), value: z.string() }));

const SNAK = z.object({
  snaktype: z.enum(["value", "somevalue", "novalue"]),
  property: z.string().regex(/^P\d+$/),
  datatype: z.string().optional(),
  datavalue: z.object({ type: z.string(), value: z.json() }).optional(),
});

const ENTITY = z.object({
  id: z.string().regex(/^Q\d+$/),
  modified: z.string().optional(),
  labels: MONOLINGUAL.optional(),
  descriptions: MONOLINGUAL.optional(),
  claims: z
    .record(
      z.string(),
      z.array(z.object({ mainsnak: SNAK, rank: z.enum(["preferred", "normal", "deprecated"]) })),
    )
    .optional(),
  missing: z.string().optional(),
});

const ENTITIES = z.object({ entities: z.record(z.string(), ENTITY) });

// ── What the collector reports ────────────────────────────────────────────

const CLAIM = z
  .object({
    rank: z.enum(["preferred", "normal", "deprecated"]),
    /** Wikidata's snak type: a value, an unknown value ("somevalue"), or none ("novalue"). */
    snakType: z.enum(["value", "somevalue", "novalue"]),
    /** Wikidata's datatype for the property; null when it gives none. */
    datatype: z.string().nullable(),
    /** Wikidata's datavalue exactly as given; null for "somevalue" and "novalue". */
    value: z.object({ type: z.string(), value: z.json() }).strict().nullable(),
  })
  .strict();

const CANDIDATE = z
  .object({
    /** The Wikidata item id (a QID). It identifies the Wikidata item and nothing else. */
    wikidataItemId: z.string().regex(/^Q\d+$/),
    /** How Wikidata's search matched this item, and the text it matched; null when it says neither. */
    matchedBy: z.string().nullable(),
    matchedText: z.string().nullable(),
    /** The English label and description; null when Wikidata has none. */
    label: z.string().nullable(),
    description: z.string().nullable(),
    /** When the Wikidata item was last edited, as Wikidata states; null when it gives none. */
    itemLastEditedAt: z.string().nullable(),
    /** Every claim Wikidata holds for the item, by property id, as Wikidata states it. */
    claims: z.record(z.string().regex(/^P\d+$/), z.array(CLAIM)),
  })
  .strict();

export const WIKIDATA_RESULT = z
  .object({
    candidates: z.array(CANDIDATE).min(1),
    /** What this collector asked for and stated; nothing here is Wikidata's (src/provenance.ts). */
    derived: z
      .object({
        search: z
          .object({
            /** The name searched for, exactly as the target gave it. */
            query: z.string().min(1),
            language: z.literal(WIKIDATA_LANGUAGE),
            limit: z.literal(WIKIDATA_CANDIDATE_LIMIT),
            /** Wikidata said more matches exist beyond the limit: the candidate list is partial. */
            moreMatchesExist: z.boolean(),
          })
          .strict(),
        note: z.literal(WIKIDATA_CANDIDATE_NOTE),
      })
      .strict(),
  })
  .strict();

export type WikidataResult = z.infer<typeof WIKIDATA_RESULT>;

/** Retry-After in milliseconds, in seconds or as an HTTP date; null when absent or unreadable. */
function retryAfterMs(response: CapturedResponse): number | null {
  const value = response.headers["retry-after"]?.trim();
  if (value === undefined || value.length === 0) return null;
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const at = Date.parse(value);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - response.receivedAt.getTime());
}

/** The body as JSON, after every non-200 status and every API-level error has been refused. */
function acceptedJson(response: CapturedResponse): unknown {
  const { status } = response;
  if (status === 429 || status >= 500) {
    throw new UpstreamUnavailableError(
      `Wikidata answered ${String(status)}`,
      retryAfterMs(response),
    );
  }
  if (status === 401 || status === 403) {
    throw new UpstreamRejectedError(`Wikidata refused the request with ${String(status)}`);
  }
  if (status !== 200) {
    throw new UpstreamResponseError(`Wikidata answered an unexpected status ${String(status)}`);
  }
  const body = response.json();
  const apiError = API_ERROR.safeParse(body);
  if (apiError.success) {
    // MediaWiki reports overload in the body of a 200: retry later.
    if (apiError.data.error.code === "maxlag" || apiError.data.error.code === "ratelimited") {
      throw new UpstreamUnavailableError(
        `Wikidata's API is overloaded (${apiError.data.error.code})`,
        retryAfterMs(response),
      );
    }
    throw new UpstreamResponseError(
      `Wikidata's API returned the error ${apiError.data.error.code}`,
    );
  }
  return body;
}

function english(values: z.infer<typeof MONOLINGUAL> | undefined): string | null {
  const value = values?.[WIKIDATA_LANGUAGE]?.value;
  return value === undefined || value.length === 0 ? null : value;
}

export const wikidataCollector: Collector = defineCollector(
  {
    id: "wikidata",
    version: "1.0.0",
    displayName: "Wikidata entity search",
    discipline: "SOCMINT",
    targetTypes: ["ORGANIZATION"],
    collectionMode: "PASSIVE_API",
    source: "wikidata",
    credentials: { vaultIds: [], runsWithout: true },
    claimStrength: "REPORTED",
    timeoutMs: 60_000,
    resultSchema: WIKIDATA_RESULT,
  },
  async (ctx) => {
    const query = ctx.target.value;
    const searchParams = new URLSearchParams({
      action: "wbsearchentities",
      search: query,
      language: WIKIDATA_LANGUAGE,
      uselang: WIKIDATA_LANGUAGE,
      type: "item",
      limit: String(WIKIDATA_CANDIDATE_LIMIT),
      format: "json",
    });
    const searched = await ctx.fetch(`${ENDPOINT}?${searchParams.toString()}`, {
      method: "GET",
      timeoutMs: FETCH_TIMEOUT_MS,
      headers: { accept: "application/json" },
    });
    const search = SEARCH.safeParse(acceptedJson(searched));
    if (!search.success) {
      throw new UpstreamResponseError("Wikidata's search answer is not the documented shape");
    }
    if (search.data.search.length === 0) {
      // The detail states the search's language, so absence is not read wider
      // than what was asked (Phase 3B review).
      return ctx.notFound(
        searched,
        `Wikidata's search, in language "${WIKIDATA_LANGUAGE}", matched no item's label or alias to this name.`,
      );
    }

    const ids = search.data.search.map((hit) => hit.id);
    const entityParams = new URLSearchParams({
      action: "wbgetentities",
      ids: ids.join("|"),
      props: "labels|descriptions|claims|info",
      languages: WIKIDATA_LANGUAGE,
      format: "json",
    });
    const read = await ctx.fetch(`${ENDPOINT}?${entityParams.toString()}`, {
      method: "GET",
      timeoutMs: FETCH_TIMEOUT_MS,
      headers: { accept: "application/json" },
      maxBytes: ENTITIES_MAX_BYTES,
    });
    const entities = ENTITIES.safeParse(acceptedJson(read));
    if (!entities.success) {
      throw new UpstreamResponseError("Wikidata's entity answer is not the documented shape");
    }

    const candidates = search.data.search.map((hit) => {
      const entity = entities.data.entities[hit.id];
      if (entity === undefined || entity.missing !== undefined) {
        // Found by the search, gone on read: report the inconsistency, never a guess.
        throw new UpstreamResponseError("an item Wikidata's search returned was missing on read");
      }
      const claims = Object.fromEntries(
        Object.entries(entity.claims ?? {}).map(([property, statements]) => [
          property,
          statements.map((statement) => ({
            rank: statement.rank,
            snakType: statement.mainsnak.snaktype,
            datatype: statement.mainsnak.datatype ?? null,
            value:
              statement.mainsnak.snaktype === "value" && statement.mainsnak.datavalue !== undefined
                ? {
                    type: statement.mainsnak.datavalue.type,
                    value: statement.mainsnak.datavalue.value,
                  }
                : null,
          })),
        ]),
      );
      return {
        wikidataItemId: entity.id,
        matchedBy: hit.match?.type ?? null,
        matchedText: hit.match?.text ?? null,
        label: english(entity.labels),
        description: english(entity.descriptions),
        itemLastEditedAt: entity.modified ?? null,
        claims,
      };
    });

    return ctx.found(
      {
        candidates,
        derived: {
          search: {
            query,
            language: WIKIDATA_LANGUAGE,
            limit: WIKIDATA_CANDIDATE_LIMIT,
            moreMatchesExist: search.data["search-continue"] !== undefined,
          },
          note: WIKIDATA_CANDIDATE_NOTE,
        },
      },
      // A Wikidata item states no date for its claims as a whole; the edit
      // time is when the item changed, not when anything happened.
      [
        { response: searched, observedAt: null },
        { response: read, observedAt: null },
      ],
    );
  },
);

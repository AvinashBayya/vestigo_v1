/**
 * The GDELT news coverage collector (REWRITE of the previous codebase's
 * collectors/existing/news.ts), run offline through the platform harness
 * against recorded GDELT DOC answers, with synthetic fixtures only for
 * conditions that cannot be provoked on demand.
 *
 * Ported from legacy tests/collectors-existing-news.test.ts: the empty-query
 * rejection, the successful query, the rate-limit failure and the no-fallback
 * failure. The normalize() cases that asserted a location entity and a
 * LOCATED_IN relationship asserted the defect this rewrite removes, and are
 * replaced by regression tests that assert the opposite.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  defineCollector,
  evidenceDrafts,
  PLATFORM_SOURCES,
  tenantRegistration,
  type CollectionOutcome,
  type Collector,
  type RateLimitAnswer,
  type UpstreamRateLimiter,
} from "../../src/index.ts";
import {
  NEWS_MAX_RECORDS,
  NEWS_RESULT,
  NEWS_SORT,
  NEWS_TIMESPAN,
  newsCollector,
} from "../../src/platform/news.ts";
import { ENTITLED, MemoryRateLimiter } from "../support.ts";
import { allFixturePaths, FIXTURE, loadFixture, startHarness, type Fixture } from "./harness.ts";

const GDELT_HOST = "api.gdeltproject.org";
const DOCS = "https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/";
const LABEL = "GDELT news coverage";

const FOUND = loadFixture("news", "found");
const NOT_FOUND = loadFixture("news", "not-found");
const SPARSE = loadFixture("news", "sparse-articles");

/** The domain a fixture's recorded GDELT query searched for. */
function targetOf(fixture: Fixture): string {
  const query = new URLSearchParams(fixture.request.path.split("?")[1]).get("query");
  expect(query).toMatch(/^".+"$/);
  return (query ?? "").slice(1, -1);
}

function expectStatus<S extends CollectionOutcome["status"]>(
  outcome: CollectionOutcome,
  status: S,
): Extract<CollectionOutcome, { status: S }> {
  expect(outcome.status, JSON.stringify(outcome)).toBe(status);
  return outcome as Extract<CollectionOutcome, { status: S }>;
}

/** Runs the news collector once, in a harness holding only `fixtures`. */
async function runNews(
  fixtures: readonly Fixture[],
  value: string,
  options: { readonly rateLimiter?: UpstreamRateLimiter } = {},
) {
  const harness = await startHarness({ collectors: [newsCollector], fixtures, ...options });
  try {
    const outcome = await harness.run("news", { type: "DOMAIN", value });
    return { outcome, harness };
  } finally {
    await harness.close();
  }
}

async function foundFrom(fixture: Fixture) {
  const { outcome, harness } = await runNews([fixture], targetOf(fixture));
  expect(harness.unmatched).toEqual([]);
  const found = expectStatus(outcome, "FOUND");
  return { found, result: NEWS_RESULT.parse(found.result), harness };
}

/** Runs one named fixture; checks the only request went to GDELT and no message repeats the target. */
async function outcomeFrom(name: string) {
  const fixture = loadFixture("news", name);
  const target = targetOf(fixture);
  const { outcome, harness } = await runNews([fixture], target);
  expect(harness.unmatched).toEqual([]);
  expect(harness.requests.map((request) => request.host)).toEqual([GDELT_HOST]);
  if (outcome.status === "FAILED" || outcome.status === "UNAVAILABLE") {
    // Outcome messages never repeat the target (CLAUDE.md §8, errors.ts).
    expect(outcome.error.message).not.toContain(target);
  }
  return outcome;
}

/** GDELT's compact seendate as the ISO 8601 instant it names. */
function isoFromSeenDate(raw: string): string {
  expect(raw).toMatch(/^\d{8}T\d{6}Z$/);
  return new Date(
    `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(9, 11)}:${raw.slice(11, 13)}:${raw.slice(13, 15)}Z`,
  ).toISOString();
}

/** Every key anywhere in a JSON value. */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)]);
  }
  return [];
}

/** Every string anywhere in a JSON value. */
function stringsOf(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsOf);
  if (typeof value === "object" && value !== null) return Object.values(value).flatMap(stringsOf);
  return [];
}

const RECORDED_ARTICLES = z.object({
  articles: z.array(
    z.object({
      url: z.string(),
      url_mobile: z.string(),
      title: z.string(),
      socialimage: z.string(),
      seendate: z.string(),
      domain: z.string(),
      language: z.string(),
      sourcecountry: z.string(),
    }),
  ),
});

/** A synthetic 200 for example.org's query path, built here because it is large and regular. */
function syntheticArticleList(articles: readonly object[], notes: string): Fixture {
  return FIXTURE.parse({
    provenance: { kind: "synthetic", source: DOCS, recordedOn: "2026-09-28", notes },
    request: { host: GDELT_HOST, path: SPARSE.request.path },
    response: {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ articles }),
    },
  });
}

describe("the news collector's registration", () => {
  it("is labelled by the registry, reads only gdelt-doc, and is passive and REPORTED", async () => {
    const harness = await startHarness({ collectors: [newsCollector], fixtures: [] });
    await harness.close();
    const entry = harness.runtime.registry.entry("news");
    expect(entry.label).toBe(LABEL);
    expect(entry.displayName).toBe(LABEL);
    expect(entry.version).toBe("1.0.0");
    expect(entry.source.id).toBe("gdelt-doc");
    expect(entry.source.network?.hosts).toEqual([GDELT_HOST]);
    expect(entry.commercialUse).toBe("PERMITTED");
    expect(entry.availability).toBe("AVAILABLE");
    expect(entry.collectionMode).toBe("PASSIVE_API");
    expect(entry.claimStrength).toBe("REPORTED");
    expect(entry.discipline).toBe("MEDIAINT");
    expect(entry.targetTypes).toEqual(["DOMAIN"]);
    expect(entry.credentials).toEqual({ vaultIds: [], runsWithout: true });
  });

  it("exposes GDELT's required citation and link wherever its data is shown", async () => {
    const harness = await startHarness({ collectors: [newsCollector], fixtures: [] });
    await harness.close();
    const attribution = harness.runtime.registry.attributionFor("news");
    const declared = PLATFORM_SOURCES.find((source) => source.id === "gdelt-doc")?.attribution;
    expect(attribution).not.toBeNull();
    expect(attribution).toEqual(declared);
    expect(attribution?.text).toContain("GDELT Project");
    expect(attribution?.url).toBe("https://www.gdeltproject.org/");
  });
});

describe("fixtures", () => {
  it("every news fixture is valid, names GDELT DOC, and a recorded one cites the exact URL fetched", () => {
    const paths = allFixturePaths().filter((path) => /[\\/]news[\\/]/.test(path));
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      const name = (path.split(/[\\/]/).at(-1) ?? "").replace(/\.json$/, "");
      const fixture = loadFixture("news", name);
      expect(fixture.request.host, path).toBe(GDELT_HOST);
      const url = `https://${fixture.request.host}${fixture.request.path}`;
      if (fixture.provenance.kind === "synthetic") {
        expect(fixture.provenance.source, path).toBe(DOCS);
        expect(fixture.provenance.notes, path).toMatch(/^Synthetic/);
      } else {
        expect(fixture.provenance.source, path).toBe(url);
      }
    }
  });
});

describe("FOUND: articles GDELT reports for the domain", () => {
  it("asks GDELT DOC for the target as a quoted phrase, with the stated window, order and cap", async () => {
    const { result, harness } = await foundFrom(FOUND);
    expect(harness.requests).toHaveLength(1);
    const [request] = harness.requests;
    expect(request?.host).toBe(GDELT_HOST);
    expect(request?.method).toBe("GET");
    const params = new URLSearchParams(request?.path.split("?")[1]);
    expect(request?.path.split("?")[0]).toBe("/api/v2/doc/doc");
    expect(Object.fromEntries(params)).toEqual({
      query: `"${targetOf(FOUND)}"`,
      mode: "artlist",
      format: "json",
      maxrecords: String(NEWS_MAX_RECORDS),
      timespan: NEWS_TIMESPAN,
      sort: NEWS_SORT,
    });
    expect(result.derived.search).toEqual({
      query: `"${targetOf(FOUND)}"`,
      timespan: "3months",
      sort: "datedesc",
      maxRecords: 250,
    });
  });

  it("reports every article exactly as GDELT gave it", async () => {
    const { result } = await foundFrom(FOUND);
    const recorded = RECORDED_ARTICLES.parse(JSON.parse(FOUND.response.body)).articles;
    expect(result.articles).toHaveLength(recorded.length);
    result.articles.forEach((article, index) => {
      const source = recorded[index];
      expect(source).toBeDefined();
      if (source === undefined) return;
      expect(article.url).toBe(source.url);
      const blankIsNull = (value: string) => (value.trim().length > 0 ? value : null);
      expect(article.mobileUrl).toBe(blankIsNull(source.url_mobile));
      expect(article.title).toBe(blankIsNull(source.title));
      expect(article.socialImageUrl).toBe(blankIsNull(source.socialimage));
      expect(article.outletDomain).toBe(source.domain);
      expect(article.language).toBe(source.language);
      expect(article.outletCountry).toBe(source.sourcecountry);
      expect(article.derived.seenByGdeltAt).toBe(isoFromSeenDate(source.seendate));
    });
  });

  it("states how many articles came back and that the list was not capped", async () => {
    const { result } = await foundFrom(FOUND);
    const recorded = RECORDED_ARTICLES.parse(JSON.parse(FOUND.response.body)).articles;
    expect(recorded.length).toBeLessThan(NEWS_MAX_RECORDS);
    expect(result.derived).toMatchObject({ returnedCount: recorded.length, capped: false });
  });

  it("cites the one GDELT response it read, byte for byte, dated by nothing GDELT did not state", async () => {
    const { found, harness } = await foundFrom(FOUND);
    expect(found.evidence).toHaveLength(1);
    const [item] = found.evidence;
    expect(item?.observedAt).toBeNull();
    expect(item?.response.kind).toBe("NETWORK");
    if (item?.response.kind !== "NETWORK") return;
    expect(item.response.status).toBe(200);
    expect(item.response.url).toBe(`https://${GDELT_HOST}${FOUND.request.path}`);
    expect(item.response.text()).toBe(FOUND.response.body);

    const entry = harness.runtime.registry.entry("news");
    const [draft] = evidenceDrafts(entry, found);
    expect(draft?.collectorId).toBe("news");
    expect(draft?.claimStrength).toBe("REPORTED");
    expect(draft?.observedAt).toBeNull();
    expect(draft?.collectedAt).toEqual(item.response.receivedAt);
    expect(new TextDecoder().decode(draft?.payload)).toBe(FOUND.response.body);
  });
});

describe("regressions: the legacy data-path defects stay fixed", () => {
  it("never names GDELT, or an article's outlet, as the evidence source (legacy geo.ts:538)", async () => {
    // Legacy: an article with no domain got the aggregator's name as its
    // source (the publisher), and evidence took its `source` from that string.
    const { found, result, harness } = await foundFrom(SPARSE);
    const entry = harness.runtime.registry.entry("news");
    expect(tenantRegistration(entry).sourceLabel).toBe(LABEL);
    const [draft] = evidenceDrafts(entry, found);
    expect(Object.keys(draft ?? {})).not.toContain("source");
    expect(Object.keys(draft ?? {})).not.toContain("label");
    expect(result.articles.map((article) => article.outletDomain)).toEqual([
      "news.example.org",
      null,
      null,
    ]);
    expect(stringsOf(result).some((value) => value.includes("GDELT"))).toBe(false);

    const recorded = await foundFrom(FOUND);
    expect(tenantRegistration(recorded.harness.runtime.registry.entry("news")).sourceLabel).toBe(
      LABEL,
    );
    const outlets = new Set(recorded.result.articles.map((article) => article.outletDomain));
    expect(outlets.has(LABEL)).toBe(false);
  });

  it("reports an absent title, language, domain or country as null, never a placeholder (legacy geo.ts:537-546)", async () => {
    // Legacy: "Untitled report", "unknown" and "" stood in for absent values.
    const { result } = await foundFrom(SPARSE);
    const [, blank, omitted] = result.articles;
    const absent = {
      mobileUrl: null,
      title: null,
      seendate: null,
      outletDomain: null,
      language: null,
      outletCountry: null,
      socialImageUrl: null,
      derived: { seenByGdeltAt: null },
    };
    expect(blank).toEqual({ url: "https://news.example.org/[article-2]", ...absent });
    expect(omitted).toEqual({ url: "https://news.example.org/[article-3]", ...absent });
    const strings = stringsOf(result);
    expect(strings).not.toContain("");
    expect(strings.some((value) => /untitled|unknown|n\/a/i.test(value))).toBe(false);
  });

  it("reports the outlet's country as the outlet's, never as a location or coordinate", async () => {
    // Legacy: sourcecountry became a country-centroid lat/lon, a location
    // entity and a LOCATED_IN relationship with an invented confidence.
    const { result } = await foundFrom(FOUND);
    const recorded = RECORDED_ARTICLES.parse(JSON.parse(FOUND.response.body)).articles;
    expect(result.articles.map((article) => article.outletCountry)).toEqual(
      recorded.map((article) => article.sourcecountry),
    );
    const keys = new Set(keysOf(result).map((key) => key.toLowerCase()));
    for (const forbidden of [
      "lat",
      "lon",
      "latitude",
      "longitude",
      "location",
      "coordinates",
      "precision",
      "locates",
      "relationships",
      "confidence",
      "credibility",
    ]) {
      expect(keys.has(forbidden), forbidden).toBe(false);
    }
  });

  it("keeps every article GDELT returned, including those with no country or date (legacy dropped them as unplaceable)", async () => {
    const { result } = await foundFrom(SPARSE);
    expect(result.articles).toHaveLength(3);
    expect(result.derived).toMatchObject({ returnedCount: 3, capped: false });
    expect(result.articles.map((article) => article.outletCountry)).toEqual([
      "[outlet country]",
      null,
      null,
    ]);
  });

  it("dates an article only by GDELT's seendate, never by the fetch time", async () => {
    const { found, result } = await foundFrom(SPARSE);
    expect(result.articles.map((article) => article.derived.seenByGdeltAt)).toEqual([
      "2026-09-27T12:00:00.000Z",
      null,
      null,
    ]);
    const [item] = found.evidence;
    expect(item?.observedAt).toBeNull();
    if (item?.response.kind !== "NETWORK") return;
    const fetchedAt = item.response.receivedAt.toISOString();
    expect(result.articles.map((article) => article.derived.seenByGdeltAt)).not.toContain(
      fetchedAt,
    );
  });

  it("never substitutes a subject for an empty target, and sends nothing (legacy searched 'conflict')", async () => {
    const harness = await startHarness({ collectors: [newsCollector], fixtures: [] });
    try {
      for (const value of ["", "  "]) {
        const outcome = await harness.runtime.execute("news", {
          target: { type: "DOMAIN", value },
          entitlement: ENTITLED,
          scopeAuthorisation: null,
          credentials: new Map(),
        });
        expect(expectStatus(outcome, "FAILED").error.code).toBe("TARGET_INVALID");
      }
      expect(harness.requests).toEqual([]);
    } finally {
      await harness.close();
    }
  });

  it("says when the list reached the cap, so a partial list is labelled partial (legacy asked for 50 silently)", async () => {
    const articles = Array.from({ length: NEWS_MAX_RECORDS }, (_, index) => ({
      url: `https://news.example.org/[article-${String(index + 1)}]`,
      title: `[synthetic headline ${String(index + 1)}]`,
      seendate: "20260927T120000Z",
      domain: "news.example.org",
      language: "[language]",
      sourcecountry: "[outlet country]",
    }));
    const fixture = syntheticArticleList(
      articles,
      "Synthetic: exactly maxrecords placeholder articles, to exercise the cap label.",
    );
    const { result } = await foundFrom(fixture);
    expect(result.articles).toHaveLength(NEWS_MAX_RECORDS);
    expect(result.derived).toMatchObject({ returnedCount: NEWS_MAX_RECORDS, capped: true });
    expect(result.derived.search.maxRecords).toBe(NEWS_MAX_RECORDS);
  });

  it("reports a GDELT failure as a failure, never masked by another source (legacy fell back to Google News RSS)", async () => {
    const outcome = await outcomeFrom("server-error");
    const unavailable = expectStatus(outcome, "UNAVAILABLE");
    expect(unavailable.error.code).toBe("UPSTREAM_UNAVAILABLE");
    expect(unavailable.retryAfterMs).toBeNull();
  });
});

describe("the shared gdelt-doc rate limit (legacy: six call sites, no shared limiter)", () => {
  /** Another collector on the same source, test code only. */
  const otherGdeltDocCollector: Collector = defineCollector(
    {
      id: "test.other-gdelt-doc",
      version: "0.0.1",
      displayName: "[Another gdelt-doc collector]",
      discipline: "MEDIAINT",
      targetTypes: ["DOMAIN"],
      collectionMode: "PASSIVE_API",
      source: "gdelt-doc",
      credentials: { vaultIds: [], runsWithout: true },
      claimStrength: "REPORTED",
      timeoutMs: 40_000,
      resultSchema: z.object({ status: z.number(), derived: z.object({}) }),
    },
    async (ctx) => {
      const response = await ctx.fetch(`https://${GDELT_HOST}${NOT_FOUND.request.path}`, {
        method: "GET",
        timeoutMs: 30_000,
      });
      return ctx.notFound(response, "[test collector: one GDELT DOC request]");
    },
  );

  it("holds a second GDELT request inside the five-second window until a slot frees", async () => {
    const memory = new MemoryRateLimiter();
    const asked: { sourceId: string; limit: number; intervalMs: number }[] = [];
    const answers: RateLimitAnswer[] = [];
    const rateLimiter: UpstreamRateLimiter = {
      acquire: async (sourceId, policy) => {
        asked.push({ sourceId, ...policy });
        const answer = await memory.acquire(sourceId, policy);
        answers.push(answer);
        return answer;
      },
    };
    const harness = await startHarness({
      collectors: [newsCollector, otherGdeltDocCollector],
      fixtures: [NOT_FOUND],
      rateLimiter,
    });
    try {
      const target = { type: "DOMAIN", value: targetOf(NOT_FOUND) } as const;
      const started = performance.now();
      expectStatus(await harness.run("test.other-gdelt-doc", target), "NOT_FOUND");
      expectStatus(await harness.run("news", target), "NOT_FOUND");
      const elapsed = performance.now() - started;

      expect(elapsed).toBeGreaterThanOrEqual(4_900);
      expect(harness.requests).toHaveLength(2);
      expect(harness.unmatched).toEqual([]);
      expect(new Set(asked.map((ask) => JSON.stringify(ask)))).toEqual(
        new Set([JSON.stringify({ sourceId: "gdelt-doc", limit: 1, intervalMs: 5_000 })]),
      );
      const refusals = answers.filter((answer) => !answer.allowed);
      expect(refusals.length).toBeGreaterThanOrEqual(1);
      for (const refusal of refusals) expect(refusal.retryAfterMs).toBeLessThanOrEqual(5_000);
    } finally {
      await harness.close();
    }
  }, 20_000);

  it("is UNAVAILABLE and sends nothing when no slot frees within the request's timeout", async () => {
    const saturated: UpstreamRateLimiter = {
      acquire: () => Promise.resolve({ allowed: false, retryAfterMs: 60_000 }),
    };
    const { outcome, harness } = await runNews([NOT_FOUND], targetOf(NOT_FOUND), {
      rateLimiter: saturated,
    });
    const unavailable = expectStatus(outcome, "UNAVAILABLE");
    expect(unavailable.error.code).toBe("UPSTREAM_RATE_LIMITED");
    expect(unavailable.retryAfterMs).toBe(60_000);
    expect(harness.requests).toEqual([]);
  });
});

describe("statuses", () => {
  it("NOT_FOUND: GDELT's recorded empty answer ({}) cites that response", async () => {
    const { outcome, harness } = await runNews([NOT_FOUND], targetOf(NOT_FOUND));
    expect(harness.unmatched).toEqual([]);
    const notFound = expectStatus(outcome, "NOT_FOUND");
    expect(notFound.detail).toContain(NEWS_TIMESPAN);
    expect(notFound.response.kind).toBe("NETWORK");
    if (notFound.response.kind === "NETWORK") {
      expect(notFound.response.status).toBe(200);
      expect(notFound.response.text()).toBe("{}");
    }
  });

  it("NOT_FOUND: an explicit empty article list", async () => {
    const outcome = await outcomeFrom("empty-list");
    expectStatus(outcome, "NOT_FOUND");
  });

  it("UNAVAILABLE: GDELT's recorded 429 is a rate limit, never zero results", async () => {
    const outcome = await outcomeFrom("rate-limited");
    const unavailable = expectStatus(outcome, "UNAVAILABLE");
    expect(unavailable.error.code).toBe("UPSTREAM_UNAVAILABLE");
    expect(unavailable.error.message).toContain("429");
    // GDELT sent no Retry-After, so none is invented.
    expect(unavailable.retryAfterMs).toBeNull();
  });

  it("UNAVAILABLE: a 503 honours Retry-After in seconds", async () => {
    const outcome = await outcomeFrom("service-unavailable");
    const unavailable = expectStatus(outcome, "UNAVAILABLE");
    expect(unavailable.error.code).toBe("UPSTREAM_UNAVAILABLE");
    expect(unavailable.retryAfterMs).toBe(120_000);
  });

  it("UNAVAILABLE: a 429 honours Retry-After given as an HTTP date", async () => {
    const retryAt = new Date(Date.now() + 60_000);
    const fixture = FIXTURE.parse({
      provenance: {
        kind: "synthetic",
        source: DOCS,
        recordedOn: "2026-09-28",
        notes:
          "Synthetic: a 429 whose Retry-After is an HTTP date one minute after the test starts.",
      },
      request: { host: GDELT_HOST, path: SPARSE.request.path },
      response: {
        status: 429,
        headers: { "content-type": "text/plain", "retry-after": retryAt.toUTCString() },
        body: "[synthetic rate-limit body]",
      },
    });
    const { outcome } = await runNews([fixture], targetOf(fixture));
    const unavailable = expectStatus(outcome, "UNAVAILABLE");
    expect(unavailable.retryAfterMs).toBeGreaterThan(50_000);
    expect(unavailable.retryAfterMs).toBeLessThanOrEqual(60_000);
  });

  it("FAILED: a 403 is a refusal, not a retry", async () => {
    const outcome = await outcomeFrom("forbidden");
    expect(expectStatus(outcome, "FAILED").error.code).toBe("UPSTREAM_REFUSED");
  });

  it("FAILED: a 404 means the endpoint is gone, never that the domain has no coverage", async () => {
    const outcome = await outcomeFrom("endpoint-missing");
    expect(expectStatus(outcome, "FAILED").error.code).toBe("UPSTREAM_RESPONSE_INVALID");
  });

  it("FAILED: a 200 carrying text instead of JSON (a refused query) is not 'nothing found'", async () => {
    const outcome = await outcomeFrom("text-answer");
    expect(expectStatus(outcome, "FAILED").error.code).toBe("UPSTREAM_RESPONSE_INVALID");
  });

  it("FAILED: JSON that is not the documented article list", async () => {
    const outcome = await outcomeFrom("wrong-shape");
    expect(expectStatus(outcome, "FAILED").error.code).toBe("UPSTREAM_RESPONSE_INVALID");
  });

  it("FAILED: a seendate that is not a calendar date is not repaired or dropped", async () => {
    const outcome = await outcomeFrom("impossible-seendate");
    expect(expectStatus(outcome, "FAILED").error.code).toBe("UPSTREAM_RESPONSE_INVALID");
  });

  it("FAILED: a seendate outside GDELT's documented format is not guessed at", async () => {
    const outcome = await outcomeFrom("unformatted-seendate");
    expect(expectStatus(outcome, "FAILED").error.code).toBe("UPSTREAM_RESPONSE_INVALID");
  });

  it("FAILED: an article with no URL is not given one", async () => {
    const outcome = await outcomeFrom("article-without-url");
    expect(expectStatus(outcome, "FAILED").error.code).toBe("UPSTREAM_RESPONSE_INVALID");
  });

  it("REFUSED: a target type other than DOMAIN never runs", async () => {
    const harness = await startHarness({ collectors: [newsCollector], fixtures: [] });
    try {
      const outcome = await harness.run("news", { type: "URL", value: "https://example.com/" });
      expect(expectStatus(outcome, "REFUSED").reason).toBe("TARGET_TYPE_NOT_ACCEPTED");
      expect(harness.requests).toEqual([]);
    } finally {
      await harness.close();
    }
  });
});

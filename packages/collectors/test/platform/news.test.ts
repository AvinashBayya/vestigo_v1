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
 *
 * RELEASE-BLOCKING since Track M Day 2 (the owner's tests): a topic returns
 * FOUND with each article's language and outlet country, from the live
 * recording; an empty answer is unconfirmed, never "no coverage" and never
 * zero; a full list is the newest 250 only and cannot be read as a rise; the
 * canary says GDELT is up, and no more.
 */
import type { TargetType } from "@repo/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createPlatformRegistry,
  defineCollector,
  evidenceDrafts,
  HELD_PLATFORM_COLLECTORS,
  PLATFORM_SOURCES,
  tenantRegistration,
  type CollectionOutcome,
  type Collector,
  type FoundOutcome,
  type RateLimitAnswer,
  type UpstreamRateLimiter,
} from "../../src/index.ts";
import {
  NEWS_CANARY_MAX_RECORDS,
  NEWS_CANARY_PASSED,
  NEWS_CANARY_QUERY,
  NEWS_EMPTY_UNCONFIRMED,
  NEWS_MAX_RECORDS,
  NEWS_RESULT,
  NEWS_SORT,
  NEWS_TIMESPAN,
  newsCollector,
  newsSearchUrl,
  type NewsResult,
} from "../../src/platform/news.ts";
import { ENTITLED, MemoryRateLimiter } from "../support.ts";
import { allFixturePaths, FIXTURE, loadFixture, startHarness, type Fixture } from "./harness.ts";

const GDELT_HOST = "api.gdeltproject.org";
const DOCS = "https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/";
const LABEL = "GDELT news coverage";

/** The live TOPIC recording: "climate change", 2026-10-15 (recorded-redacted). */
const FOUND = loadFixture("news", "found");
/** A domain's articles, synthetic: no live answer for a domain phrase has been recorded. */
const DOMAIN_FOUND = loadFixture("news", "domain-found");
/** GDELT's recorded empty answer, `{}`, for the domain example.com. */
const EMPTY = loadFixture("news", "empty-answer");
const SPARSE = loadFixture("news", "sparse-articles");
/** The canary's answer when GDELT is up. */
const CANARY_UP = loadFixture("news", "canary-found");

/** The path of one search, exactly as the collector sends it. */
const pathOf = (query: string, maxRecords: number = NEWS_MAX_RECORDS): string =>
  newsSearchUrl(query, maxRecords).slice(`https://${GDELT_HOST}`.length);
const CANARY_PATH = pathOf(NEWS_CANARY_QUERY, NEWS_CANARY_MAX_RECORDS);

/** The phrase a fixture's recorded GDELT query searched for: the query less its quote marks. */
function phraseOf(fixture: Fixture): string {
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

interface Target {
  readonly type: TargetType;
  readonly value: string;
}
const topic = (value: string): Target => ({ type: "TOPIC", value });
const domain = (value: string): Target => ({ type: "DOMAIN", value });

/** Runs the news collector once, in a harness holding only `fixtures`. */
async function runNews(
  fixtures: readonly Fixture[],
  target: Target,
  options: { readonly rateLimiter?: UpstreamRateLimiter } = {},
) {
  const harness = await startHarness({ collectors: [newsCollector], fixtures, ...options });
  try {
    const outcome = await harness.run("news", target);
    return { outcome, harness };
  } finally {
    await harness.close();
  }
}

async function foundFrom(fixture: Fixture, target: Target) {
  const { outcome, harness } = await runNews([fixture], target);
  expect(harness.unmatched).toEqual([]);
  const found = expectStatus(outcome, "FOUND");
  return { found, result: NEWS_RESULT.parse(found.result), harness };
}
const foundTopic = () => foundFrom(FOUND, topic(phraseOf(FOUND)));
const foundDomain = (fixture: Fixture = DOMAIN_FOUND) =>
  foundFrom(fixture, domain(phraseOf(fixture)));

/**
 * Runs one named domain fixture (with the canary up, in case it is asked);
 * checks every request went to GDELT and no message repeats the target.
 */
async function outcomeFrom(name: string) {
  const fixture = loadFixture("news", name);
  const target = phraseOf(fixture);
  const { outcome, harness } = await runNews([fixture, CANARY_UP], domain(target));
  expect(harness.unmatched).toEqual([]);
  expect(new Set(harness.requests.map((request) => request.host))).toEqual(new Set([GDELT_HOST]));
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

/** Every number anywhere in a JSON value, with where it is. */
function numbersOf(value: unknown, at = "result"): { at: string; value: number }[] {
  if (typeof value === "number") return [{ at, value }];
  if (Array.isArray(value))
    return value.flatMap((inner, i) => numbersOf(inner, `${at}[${String(i)}]`));
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, inner]) => numbersOf(inner, `${at}.${key}`));
  }
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
const recordedArticles = (fixture: Fixture) =>
  RECORDED_ARTICLES.parse(JSON.parse(fixture.response.body)).articles;

/** A synthetic GDELT answer, built here because it is regular, large or a failure on demand. */
function synthetic(path: string, response: Fixture["response"], notes: string): Fixture {
  return FIXTURE.parse({
    provenance: { kind: "synthetic", source: DOCS, recordedOn: "2026-10-15", notes },
    request: { host: GDELT_HOST, path },
    response,
  });
}
const json = (body: string, status = 200): Fixture["response"] => ({
  status,
  headers: { "content-type": "application/json; charset=utf-8" },
  body,
});
const syntheticArticleList = (path: string, articles: readonly object[], notes: string) =>
  synthetic(path, json(JSON.stringify({ articles })), notes);
/** `count` placeholder articles in GDELT's shape, one minute apart. */
const placeholderArticles = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    url: `https://news.example.org/[article-${String(index + 1)}]`,
    title: `[synthetic headline ${String(index + 1)}]`,
    seendate: `20261015T${String(16 - Math.floor(index / 60)).padStart(2, "0")}${String(59 - (index % 60)).padStart(2, "0")}00Z`,
    domain: "news.example.org",
    language: "[language]",
    sourcecountry: "[outlet country]",
  }));

// ── Registration ──────────────────────────────────────────────────────────

describe("the news collector's registration", () => {
  it("is labelled by the registry, reads only gdelt-doc, takes a domain or a topic, and is passive and REPORTED", async () => {
    const harness = await startHarness({ collectors: [newsCollector], fixtures: [] });
    await harness.close();
    const entry = harness.runtime.registry.entry("news");
    expect(entry.label).toBe(LABEL);
    expect(entry.displayName).toBe(LABEL);
    expect(entry.version).toBe("2.0.0");
    expect(entry.source.id).toBe("gdelt-doc");
    expect(entry.source.network?.hosts).toEqual([GDELT_HOST]);
    expect(entry.commercialUse).toBe("PERMITTED");
    expect(entry.availability).toBe("AVAILABLE");
    expect(entry.collectionMode).toBe("PASSIVE_API");
    expect(entry.claimStrength).toBe("REPORTED");
    expect(entry.discipline).toBe("MEDIAINT");
    expect(entry.targetTypes).toEqual(["DOMAIN", "TOPIC"]);
    expect(entry.credentials).toEqual({ vaultIds: [], runsWithout: true });
    // Its empty answers are declared unreliable, so the runtime refuses a not-found from it.
    expect(entry.emptyAnswersUnreliable).toBe(true);
  });

  it("is registered on the platform, and nothing is held any longer (Track M Day 2)", () => {
    const entry = createPlatformRegistry().entry("news");
    expect(entry.availability).toBe("AVAILABLE");
    expect(tenantRegistration(entry).sourceLabel).toBe(LABEL);
    expect(HELD_PLATFORM_COLLECTORS).toEqual([]);
  });

  it("exposes GDELT's required citation and link wherever its data is shown", () => {
    const attribution = createPlatformRegistry().attributionFor("news");
    const declared = PLATFORM_SOURCES.find((source) => source.id === "gdelt-doc")?.attribution;
    expect(attribution).not.toBeNull();
    expect(attribution).toEqual(declared);
    expect(attribution?.text).toContain("GDELT Project");
    expect(attribution?.url).toBe("https://www.gdeltproject.org/");
  });
});

// ── Fixtures ──────────────────────────────────────────────────────────────

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

  it("the FOUND fixture is the live recording, redacted only where it can name people (Track M Day 2)", () => {
    expect(FOUND.provenance.kind).toBe("recorded-redacted");
    expect(FOUND.provenance.recordedOn).toBe("2026-10-15");
    expect(FOUND.request.path).toBe(pathOf('"climate change"'));
    expect(FOUND.response.status).toBe(200);
    expect(FOUND.response.headers.server).toBe("GDELT Server");
    // The hash of the body as received is kept, so the redaction can be traced to it.
    expect(FOUND.provenance.notes).toContain(
      "9e6be5de39e03e423e36a111993d977ad27356758dae4332803d51ee9b1f7fb8",
    );
    const articles = recordedArticles(FOUND);
    expect(articles).toHaveLength(166);
    articles.forEach((article, index) => {
      const n = String(index + 1);
      // Titles and paths can name people: placeholders, keeping the scheme and host.
      expect(article.title).toBe(`[headline ${n}]`);
      expect(article.url).toMatch(new RegExp(`^https?://[^/]+/\\[article-${n}\\]$`));
      // What GDELT reported about the article, as received.
      expect(article.seendate).toMatch(/^20261015T\d{6}Z$/);
      expect(article.domain.length).toBeGreaterThan(0);
      expect(article.language.length).toBeGreaterThan(0);
    });
  });
});

// ── FOUND ─────────────────────────────────────────────────────────────────

describe("FOUND: a topic, from the live recording (RELEASE-BLOCKING, Track M Day 2)", () => {
  it("searches the topic as one exact phrase, with the stated window, order and cap", async () => {
    const { result, harness } = await foundTopic();
    expect(harness.requests).toHaveLength(1);
    const [request] = harness.requests;
    expect(request?.host).toBe(GDELT_HOST);
    expect(request?.method).toBe("GET");
    expect(request?.path).toBe(FOUND.request.path);
    expect(Object.fromEntries(new URLSearchParams(request?.path.split("?")[1]))).toEqual({
      query: '"climate change"',
      mode: "artlist",
      format: "json",
      maxrecords: String(NEWS_MAX_RECORDS),
      timespan: NEWS_TIMESPAN,
      sort: NEWS_SORT,
    });
    expect(result.derived.search).toEqual({
      query: '"climate change"',
      timespan: "3months",
      sort: "datedesc",
      maxRecords: 250,
    });
  });

  it("reports each article's language and outlet country exactly as GDELT gave them", async () => {
    const { result } = await foundTopic();
    const recorded = recordedArticles(FOUND);
    expect(result.articles).toHaveLength(recorded.length);
    const blankIsNull = (value: string) => (value.trim().length > 0 ? value : null);
    result.articles.forEach((article, index) => {
      const source = recorded[index];
      if (source === undefined) throw new Error(`no recorded article ${String(index)}`);
      expect(article.language, `article ${String(index)}`).toBe(blankIsNull(source.language));
      expect(article.outletCountry, `article ${String(index)}`).toBe(
        blankIsNull(source.sourcecountry),
      );
      expect(article.outletDomain).toBe(blankIsNull(source.domain));
      expect(article.url).toBe(source.url);
      expect(article.mobileUrl).toBe(blankIsNull(source.url_mobile));
      expect(article.socialImageUrl).toBe(blankIsNull(source.socialimage));
      expect(article.derived.seenByGdeltAt).toBe(isoFromSeenDate(source.seendate));
    });
    // GDELT's own names, never codes or guesses: as many languages and countries as it gave.
    const languages = new Set(result.articles.map((article) => article.language));
    expect(languages).toEqual(new Set(recorded.map((article) => article.language)));
    expect(languages.size).toBe(20);
    expect(languages.has("English")).toBe(true);
    // Three articles came with no outlet country: null, never a stand-in.
    expect(result.articles.filter((article) => article.outletCountry === null)).toHaveLength(3);
  });

  it("reads the same phrase however the topic is typed: bare, in straight quotes or in curly quotes", async () => {
    for (const typed of ["climate change", '"climate change"', "“climate change”"]) {
      const { outcome, harness } = await runNews([FOUND], topic(typed));
      expect(harness.unmatched, typed).toEqual([]);
      expectStatus(outcome, "FOUND");
      expect(
        harness.requests.map((request) => request.path),
        typed,
      ).toEqual([FOUND.request.path]);
    }
  });

  it("states the stretch of the window the list covers, never a count, and is not the newest 250 only under the cap", async () => {
    const { result } = await foundTopic();
    expect(result.derived.newest250Only).toBe(false);
    // 166 articles, under the cap, yet two and a half hours of the three months asked for.
    expect(result.derived.seenSpan).toEqual({
      newest: "2026-10-15T17:00:00.000Z",
      oldest: "2026-10-15T14:30:00.000Z",
    });
    expect(result.derived.volume).toEqual({
      count: null,
      reason: "NOT_MEASURED_BY_AN_ARTICLE_LIST",
    });
  });

  it("cites the one GDELT response it read, byte for byte, dated by nothing GDELT did not state", async () => {
    const { found, harness } = await foundTopic();
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
    expect(draft?.collectorVersion).toBe("2.0.0");
    expect(draft?.claimStrength).toBe("REPORTED");
    expect(draft?.observedAt).toBeNull();
    expect(draft?.collectedAt).toEqual(item.response.receivedAt);
    expect(new TextDecoder().decode(draft?.payload)).toBe(FOUND.response.body);
  });
});

describe("FOUND: a domain", () => {
  it("searches the domain as one exact phrase", async () => {
    const { result, harness } = await foundDomain();
    expect(harness.requests.map((request) => request.path)).toEqual([DOMAIN_FOUND.request.path]);
    expect(result.derived.search.query).toBe(`"${phraseOf(DOMAIN_FOUND)}"`);
  });

  it("reports every article exactly as GDELT gave it", async () => {
    const { result } = await foundDomain();
    const recorded = recordedArticles(DOMAIN_FOUND);
    expect(result.articles).toHaveLength(recorded.length);
    result.articles.forEach((article, index) => {
      const source = recorded[index];
      if (source === undefined) throw new Error(`no recorded article ${String(index)}`);
      const blankIsNull = (value: string) => (value.trim().length > 0 ? value : null);
      expect(article.url).toBe(source.url);
      expect(article.mobileUrl).toBe(blankIsNull(source.url_mobile));
      expect(article.title).toBe(blankIsNull(source.title));
      expect(article.socialImageUrl).toBe(blankIsNull(source.socialimage));
      expect(article.outletDomain).toBe(source.domain);
      expect(article.language).toBe(source.language);
      expect(article.outletCountry).toBe(source.sourcecountry);
      expect(article.derived.seenByGdeltAt).toBe(isoFromSeenDate(source.seendate));
    });
  });
});

// ── A topic GDELT cannot search as one phrase ─────────────────────────────

describe("a topic that cannot be one GDELT phrase is refused before anything is sent (Track M Day 2)", () => {
  it("refuses a quote mark inside, or nothing inside the quotes, and never repeats the topic", async () => {
    const harness = await startHarness({ collectors: [newsCollector], fixtures: [] });
    try {
      for (const value of [
        'climate "change" now',
        '"climate" OR "weather"',
        "climate “change”",
        '""',
        "“ ”",
      ]) {
        const outcome = await harness.run("news", topic(value));
        const failed = expectStatus(outcome, "FAILED");
        expect(failed.error.code, value).toBe("TARGET_NOT_SEARCHABLE");
        expect(failed.error.message, value).not.toContain(value);
      }
      expect(harness.requests).toEqual([]);
    } finally {
      await harness.close();
    }
  });

  it("sends a hashtag as typed, as one phrase, without guessing what GDELT makes of it", async () => {
    const hashtag = synthetic(
      pathOf('"#climatestrike"'),
      json("{}"),
      "Synthetic: an empty answer for a hashtag topic, to show the phrase sent. How GDELT reads '#' is not documented.",
    );
    const { outcome, harness } = await runNews([hashtag, CANARY_UP], topic("#climatestrike"));
    expect(harness.unmatched).toEqual([]);
    expect(harness.requests[0]?.path).toBe(hashtag.request.path);
    expectStatus(outcome, "EMPTY_UNCONFIRMED");
  });
});

// ── An empty answer ───────────────────────────────────────────────────────

describe("an empty answer is unconfirmed: never 'no coverage', never zero (RELEASE-BLOCKING, Track M Day 2)", () => {
  it("reads GDELT's recorded {} as EMPTY_UNCONFIRMED once the canary shows GDELT is up, citing the empty answer", async () => {
    const { outcome, harness } = await runNews([EMPTY, CANARY_UP], domain(phraseOf(EMPTY)));
    expect(harness.unmatched).toEqual([]);
    const unconfirmed = expectStatus(outcome, "EMPTY_UNCONFIRMED");
    expect(unconfirmed.detail).toBe(`${NEWS_EMPTY_UNCONFIRMED} ${NEWS_CANARY_PASSED}`);
    expect(unconfirmed.detail).toContain("returned nothing for this search — unconfirmed");
    expect(unconfirmed.response.kind).toBe("NETWORK");
    if (unconfirmed.response.kind === "NETWORK") {
      expect(unconfirmed.response.status).toBe(200);
      expect(unconfirmed.response.text()).toBe("{}");
    }
    // The search, then the canary: nothing else.
    expect(harness.requests.map((request) => request.path)).toEqual([
      EMPTY.request.path,
      CANARY_PATH,
    ]);
  });

  it("never says 'no articles' or a zero, and gives no result and no evidence to read one from", async () => {
    const { outcome, harness } = await runNews([EMPTY, CANARY_UP], domain(phraseOf(EMPTY)));
    const unconfirmed = expectStatus(outcome, "EMPTY_UNCONFIRMED");
    expect(unconfirmed.detail).not.toMatch(
      /\b0\b|zero articles|no articles|holds no|nothing found/i,
    );
    expect(Object.keys(unconfirmed).sort()).toEqual([
      "collectorId",
      "detail",
      "response",
      "status",
    ]);
    expect(() =>
      evidenceDrafts(
        harness.runtime.registry.entry("news"),
        unconfirmed as unknown as FoundOutcome,
      ),
    ).toThrow();
  });

  it("reads an empty article list, and a topic's empty answer, the same way", async () => {
    const list = await runNews(
      [loadFixture("news", "empty-list"), CANARY_UP],
      domain("example.org"),
    );
    expectStatus(list.outcome, "EMPTY_UNCONFIRMED");
    const topicEmpty = synthetic(
      pathOf('"[a topic with no articles]"'),
      json("{}"),
      "Synthetic: GDELT's empty answer, as recorded for a domain (empty-answer.json), for a topic.",
    );
    const forTopic = await runNews([topicEmpty, CANARY_UP], topic("[a topic with no articles]"));
    expect(forTopic.harness.unmatched).toEqual([]);
    expectStatus(forTopic.outcome, "EMPTY_UNCONFIRMED");
  });
});

// ── The canary ────────────────────────────────────────────────────────────

describe("the canary: GDELT is up, and no more (RELEASE-BLOCKING, Track M Day 2)", () => {
  it("says a passing canary means GDELT is up, not that any query found something", () => {
    expect(NEWS_CANARY_PASSED).toBe(
      "Canary: GDELT DOC answered a search that always has articles, so GDELT is up. A passing canary means GDELT is up — not that any query found something.",
    );
    expect(CANARY_PATH).toBe(CANARY_UP.request.path);
  });

  it("is asked only after an empty answer, once, in the same window", async () => {
    const found = await foundTopic();
    expect(found.harness.requests).toHaveLength(1);
    const empty = await runNews([EMPTY, CANARY_UP], domain(phraseOf(EMPTY)));
    const canary = empty.harness.requests[1];
    expect(empty.harness.requests).toHaveLength(2);
    expect(Object.fromEntries(new URLSearchParams(canary?.path.split("?")[1]))).toEqual({
      query: NEWS_CANARY_QUERY,
      mode: "artlist",
      format: "json",
      maxrecords: String(NEWS_CANARY_MAX_RECORDS),
      timespan: NEWS_TIMESPAN,
      sort: NEWS_SORT,
    });
  });

  it("an empty canary means GDELT is not answering searches: UNAVAILABLE, never unconfirmed", async () => {
    const canaryEmpty = synthetic(
      CANARY_PATH,
      json("{}"),
      "Synthetic: the canary answered with nothing, as GDELT does when it is not answering searches.",
    );
    const { outcome } = await runNews([EMPTY, canaryEmpty], domain(phraseOf(EMPTY)));
    const unavailable = expectStatus(outcome, "UNAVAILABLE");
    expect(unavailable.error.code).toBe("UPSTREAM_UNAVAILABLE");
    expect(unavailable.error.message).toMatch(/not answering searches now/);
    expect(unavailable.retryAfterMs).toBeNull();
  });

  it("a canary GDELT refuses is UNAVAILABLE, and says it was the canary", async () => {
    const rateLimited = loadFixture("news", "rate-limited");
    const canaryRefused = synthetic(
      CANARY_PATH,
      rateLimited.response,
      "Synthetic: GDELT's recorded 429 (rate-limited.json), as an answer to the canary.",
    );
    const { outcome } = await runNews([EMPTY, canaryRefused], domain(phraseOf(EMPTY)));
    const unavailable = expectStatus(outcome, "UNAVAILABLE");
    expect(unavailable.error.message).toContain("429 to its canary search");
  });

  it("a canary answered with text is a failure, never a pass", async () => {
    const canaryText = synthetic(
      CANARY_PATH,
      { status: 200, headers: { "content-type": "text/plain" }, body: "[synthetic refusal text]" },
      "Synthetic: a 200 carrying text instead of JSON, as an answer to the canary.",
    );
    const { outcome } = await runNews([EMPTY, canaryText], domain(phraseOf(EMPTY)));
    const failed = expectStatus(outcome, "FAILED");
    expect(failed.error.code).toBe("UPSTREAM_RESPONSE_INVALID");
    expect(failed.error.message).toContain("its canary search");
  });
});

// ── The cap ───────────────────────────────────────────────────────────────

describe("a full list is the newest 250 only, and nothing in a result can be read as a rise (RELEASE-BLOCKING, Track M Day 2)", () => {
  const capped = syntheticArticleList(
    pathOf('"[a busy topic]"'),
    placeholderArticles(NEWS_MAX_RECORDS),
    "Synthetic: exactly maxrecords placeholder articles, to exercise the cap.",
  );

  it("reads 'newest 250 only' when GDELT returned its most", async () => {
    const { result } = await foundFrom(capped, topic("[a busy topic]"));
    expect(result.articles).toHaveLength(NEWS_MAX_RECORDS);
    expect(result.derived.newest250Only).toBe(true);
    expect(result.derived.search.sort).toBe("datedesc");
    expect(result.derived.seenSpan).toEqual({
      newest: "2026-10-15T16:59:00.000Z",
      oldest: "2026-10-15T12:50:00.000Z",
    });
  });

  it("states no count of coverage, capped or not: the only figure is the request's own cap", async () => {
    for (const result of [
      (await foundFrom(capped, topic("[a busy topic]"))).result,
      (await foundTopic()).result,
    ]) {
      expect(result.derived.volume).toEqual({
        count: null,
        reason: "NOT_MEASURED_BY_AN_ARTICLE_LIST",
      });
      expect(numbersOf(result)).toEqual([{ at: "result.derived.search.maxRecords", value: 250 }]);
      const keys = new Set(keysOf(result).map((key) => key.toLowerCase()));
      for (const forbidden of ["returnedcount", "capped", "total", "rate", "trend", "spike"]) {
        expect(keys.has(forbidden), forbidden).toBe(false);
      }
    }
  });

  it("refuses a result that claims a count, or a span that runs backwards", () => {
    const base = {
      articles: [],
      derived: {
        search: { query: '"[x]"', timespan: NEWS_TIMESPAN, sort: NEWS_SORT, maxRecords: 250 },
        newest250Only: true,
        seenSpan: null,
        volume: { count: null, reason: "NOT_MEASURED_BY_AN_ARTICLE_LIST" },
      },
    };
    const article = {
      url: "https://news.example.org/[article-1]",
      mobileUrl: null,
      title: null,
      seendate: null,
      outletDomain: null,
      language: null,
      outletCountry: null,
      socialImageUrl: null,
      derived: { seenByGdeltAt: null },
    };
    const valid: NewsResult = { ...base, articles: [article] } as NewsResult;
    expect(NEWS_RESULT.safeParse(valid).success).toBe(true);
    const counted = {
      ...valid,
      derived: { ...valid.derived, volume: { count: 250, reason: "x" } },
    };
    expect(NEWS_RESULT.safeParse(counted).success).toBe(false);
    const backwards = {
      ...valid,
      derived: {
        ...valid.derived,
        seenSpan: { newest: "2026-10-15T14:30:00.000Z", oldest: "2026-10-15T17:00:00.000Z" },
      },
    };
    expect(NEWS_RESULT.safeParse(backwards).success).toBe(false);
  });
});

// ── Regressions ───────────────────────────────────────────────────────────

describe("regressions: the legacy data-path defects stay fixed", () => {
  it("never names GDELT, or an article's outlet, as the evidence source (legacy geo.ts:538)", async () => {
    // Legacy: an article with no domain got the aggregator's name as its
    // source (the publisher), and evidence took its `source` from that string.
    const { found, result, harness } = await foundDomain(SPARSE);
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

    const recorded = await foundTopic();
    expect(tenantRegistration(recorded.harness.runtime.registry.entry("news")).sourceLabel).toBe(
      LABEL,
    );
    const outlets = new Set(recorded.result.articles.map((article) => article.outletDomain));
    expect(outlets.has(LABEL)).toBe(false);
    expect(stringsOf(recorded.result).some((value) => value.includes("GDELT"))).toBe(false);
  });

  it("reports an absent title, language, domain or country as null, never a placeholder (legacy geo.ts:537-546)", async () => {
    // Legacy: "Untitled report", "unknown" and "" stood in for absent values.
    const { result } = await foundDomain(SPARSE);
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
    const { result } = await foundTopic();
    const recorded = recordedArticles(FOUND);
    expect(result.articles.map((article) => article.outletCountry)).toEqual(
      recorded.map((article) => (article.sourcecountry === "" ? null : article.sourcecountry)),
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
    const { result } = await foundDomain(SPARSE);
    expect(result.articles).toHaveLength(3);
    expect(result.derived.newest250Only).toBe(false);
    expect(result.articles.map((article) => article.outletCountry)).toEqual([
      "[outlet country]",
      null,
      null,
    ]);
  });

  it("dates an article only by GDELT's seendate, never by the fetch time", async () => {
    const { found, result } = await foundDomain(SPARSE);
    expect(result.articles.map((article) => article.derived.seenByGdeltAt)).toEqual([
      "2026-09-27T12:00:00.000Z",
      null,
      null,
    ]);
    // The span is of GDELT's dates only: the articles with none add nothing to it.
    expect(result.derived.seenSpan).toEqual({
      newest: "2026-09-27T12:00:00.000Z",
      oldest: "2026-09-27T12:00:00.000Z",
    });
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
      for (const type of ["DOMAIN", "TOPIC"] as const) {
        for (const value of ["", "  "]) {
          const outcome = await harness.runtime.execute("news", {
            target: { type, value },
            entitlement: ENTITLED,
            scopeAuthorisation: null,
            credentials: new Map(),
          });
          expect(expectStatus(outcome, "FAILED").error.code).toBe("TARGET_INVALID");
        }
      }
      expect(harness.requests).toEqual([]);
    } finally {
      await harness.close();
    }
  });

  it("reports a GDELT failure as a failure, never masked by another source (legacy fell back to Google News RSS)", async () => {
    const outcome = await outcomeFrom("server-error");
    const unavailable = expectStatus(outcome, "UNAVAILABLE");
    expect(unavailable.error.code).toBe("UPSTREAM_UNAVAILABLE");
    expect(unavailable.retryAfterMs).toBeNull();
  });
});

// ── The shared rate limit ─────────────────────────────────────────────────

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
      emptyAnswersUnreliable: true,
    },
    async (ctx) => {
      const response = await ctx.fetch(`https://${GDELT_HOST}${EMPTY.request.path}`, {
        method: "GET",
        timeoutMs: 30_000,
      });
      return ctx.emptyUnconfirmed(response, "[test collector: one GDELT DOC request]");
    },
  );

  it("holds every GDELT request, the canary's included, inside the five-second window until a slot frees", async () => {
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
      fixtures: [EMPTY, CANARY_UP],
      rateLimiter,
    });
    try {
      const target = domain(phraseOf(EMPTY));
      const started = performance.now();
      expectStatus(await harness.run("test.other-gdelt-doc", target), "EMPTY_UNCONFIRMED");
      // The news collector's search and then its canary: two more slots.
      expectStatus(await harness.run("news", target), "EMPTY_UNCONFIRMED");
      const elapsed = performance.now() - started;

      expect(elapsed).toBeGreaterThanOrEqual(9_800);
      expect(harness.requests).toHaveLength(3);
      expect(harness.unmatched).toEqual([]);
      expect(new Set(asked.map((ask) => JSON.stringify(ask)))).toEqual(
        new Set([JSON.stringify({ sourceId: "gdelt-doc", limit: 1, intervalMs: 5_000 })]),
      );
      const refusals = answers.filter((answer) => !answer.allowed);
      expect(refusals.length).toBeGreaterThanOrEqual(2);
      for (const refusal of refusals) expect(refusal.retryAfterMs).toBeLessThanOrEqual(5_000);
    } finally {
      await harness.close();
    }
  }, 30_000);

  it("is UNAVAILABLE and sends nothing when no slot frees within the request's timeout", async () => {
    const saturated: UpstreamRateLimiter = {
      acquire: () => Promise.resolve({ allowed: false, retryAfterMs: 60_000 }),
    };
    const { outcome, harness } = await runNews([FOUND], topic(phraseOf(FOUND)), {
      rateLimiter: saturated,
    });
    const unavailable = expectStatus(outcome, "UNAVAILABLE");
    expect(unavailable.error.code).toBe("UPSTREAM_RATE_LIMITED");
    expect(unavailable.retryAfterMs).toBe(60_000);
    expect(harness.requests).toEqual([]);
  });
});

// ── Statuses ──────────────────────────────────────────────────────────────

describe("statuses", () => {
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
    const fixture = synthetic(
      SPARSE.request.path,
      {
        status: 429,
        headers: { "content-type": "text/plain", "retry-after": retryAt.toUTCString() },
        body: "[synthetic rate-limit body]",
      },
      "Synthetic: a 429 whose Retry-After is an HTTP date one minute after the test starts.",
    );
    const { outcome } = await runNews([fixture], domain(phraseOf(fixture)));
    const unavailable = expectStatus(outcome, "UNAVAILABLE");
    expect(unavailable.retryAfterMs).toBeGreaterThan(50_000);
    expect(unavailable.retryAfterMs).toBeLessThanOrEqual(60_000);
  });

  it("FAILED: a 403 is a refusal, not a retry", async () => {
    const outcome = await outcomeFrom("forbidden");
    expect(expectStatus(outcome, "FAILED").error.code).toBe("UPSTREAM_REFUSED");
  });

  it("FAILED: a 404 means the endpoint is gone, never that the target has no coverage", async () => {
    const outcome = await outcomeFrom("endpoint-missing");
    expect(expectStatus(outcome, "FAILED").error.code).toBe("UPSTREAM_RESPONSE_INVALID");
  });

  it("FAILED: a 200 carrying text instead of JSON (a refused query) is not 'nothing returned'", async () => {
    const outcome = await outcomeFrom("text-answer");
    expect(expectStatus(outcome, "FAILED").error.code).toBe("UPSTREAM_RESPONSE_INVALID");
  });

  it("FAILED: JSON that is not the article list GDELT sends", async () => {
    const outcome = await outcomeFrom("wrong-shape");
    expect(expectStatus(outcome, "FAILED").error.code).toBe("UPSTREAM_RESPONSE_INVALID");
  });

  it("FAILED: a seendate that is not a calendar date is not repaired or dropped", async () => {
    const outcome = await outcomeFrom("impossible-seendate");
    expect(expectStatus(outcome, "FAILED").error.code).toBe("UPSTREAM_RESPONSE_INVALID");
  });

  it("FAILED: a seendate outside the form GDELT sends is not guessed at", async () => {
    const outcome = await outcomeFrom("unformatted-seendate");
    expect(expectStatus(outcome, "FAILED").error.code).toBe("UPSTREAM_RESPONSE_INVALID");
  });

  it("FAILED: an article with no URL is not given one", async () => {
    const outcome = await outcomeFrom("article-without-url");
    expect(expectStatus(outcome, "FAILED").error.code).toBe("UPSTREAM_RESPONSE_INVALID");
  });

  it("REFUSED: a target type other than a domain or a topic never runs", async () => {
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

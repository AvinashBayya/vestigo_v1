/**
 * The Wayback Machine captures collector, offline, against CDX answers
 * recorded from web.archive.org (and synthetic ones, marked as such, for
 * conditions that cannot be provoked live). The previous codebase had no test
 * file for this adapter (docs/audit/COLLECTORS.md row 8), so these are new:
 *   - FOUND: every capture as the archive states it, a partial result labelled
 *     partial with its count, and no single evidence date (observedAt null);
 *   - NOT_FOUND: only the archive's well-formed "no captures" answer;
 *   - UNAVAILABLE: 429 and 5xx, with the upstream's Retry-After;
 *   - FAILED: refusals, and every body the collector cannot read, including an
 *     empty one, which the previous adapter read as "nothing archived".
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captureResponse } from "../../src/fetcher/capture.ts";
import {
  COLLECTOR_USER_AGENT,
  CollectorRegistry,
  evidenceDrafts,
  PLATFORM_SOURCES,
  UpstreamResponseError,
  type CollectionOutcome,
  type RateLimitAnswer,
  type UpstreamRateLimiter,
} from "../../src/index.ts";
import {
  parseCdxRows,
  retryAfterMs,
  WAYBACK_RESULT,
  WAYBACK_ROW_LIMIT,
  waybackCollector,
  waybackTimestampToIso,
} from "../../src/platform/wayback.ts";
import { MemoryRateLimiter } from "../support.ts";
import { loadFixture, startHarness, type Harness } from "./harness.ts";

const ID = "wayback";
const TAIL =
  "&output=json&fl=timestamp%2Coriginal%2Cstatuscode%2Cmimetype%2Cdigest&collapse=urlkey&limit=201";
const cdxPath = (encodedUrl: string) => `/cdx/search/cdx?url=${encodedUrl}${TAIL}`;

const FIXTURES = [
  "domain-capped",
  "url-found",
  "domain-not-found",
  "header-only",
  "undated-capture",
  "unavailable-503",
  "rate-limited-429",
  "forbidden-403",
  "missing-404",
  "malformed-html",
  "malformed-columns",
  "malformed-row",
  "empty-body",
].map((name) => loadFixture(ID, name));

function expectStatus<S extends CollectionOutcome["status"]>(
  outcome: CollectionOutcome,
  status: S,
): Extract<CollectionOutcome, { status: S }> {
  expect(outcome.status, JSON.stringify(outcome)).toBe(status);
  return outcome as Extract<CollectionOutcome, { status: S }>;
}

const domain = (value: string) => ({ type: "DOMAIN", value }) as const;

describe("the wayback declaration", () => {
  const entry = new CollectorRegistry({
    sources: PLATFORM_SOURCES,
    collectors: [waybackCollector],
  }).entry(ID);

  it("is registered on the wayback-cdx source, and its evidence label is the registry's", () => {
    expect(entry.displayName).toBe("Wayback Machine captures");
    expect(entry.label).toBe("Wayback Machine captures");
    expect(entry.source.id).toBe("wayback-cdx");
    expect(entry.version).toBe("1.0.0");
  });

  it("is a passive, keyless, reported MEDIAINT collector for domains and URLs", () => {
    expect(entry.discipline).toBe("MEDIAINT");
    expect(entry.targetTypes).toEqual(["DOMAIN", "URL"]);
    expect(entry.collectionMode).toBe("PASSIVE_DATASET");
    expect(entry.claimStrength).toBe("REPORTED");
    expect(entry.credentials).toEqual({ vaultIds: [], runsWithout: true });
  });

  it("inherits its source's UNVERIFIED licence verdict", () => {
    expect(entry.commercialUse).toBe("UNVERIFIED");
    expect(entry.availability).toBe("UNVERIFIED");
  });
});

describe("the wayback collector against recorded CDX answers", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await startHarness({ collectors: [waybackCollector], fixtures: FIXTURES });
  });

  afterAll(async () => {
    await harness.close();
  });

  const run = async (target: { readonly type: "DOMAIN" | "URL"; readonly value: string }) => {
    const before = harness.requests.length;
    const outcome = await harness.run(ID, target);
    expect(harness.unmatched).toEqual([]);
    return { outcome, requests: harness.requests.slice(before) };
  };

  describe("FOUND", () => {
    it("asks the CDX index once, for every path of the domain, one row per URL key", async () => {
      const { requests } = await run(domain("example.net"));
      expect(requests.map((r) => [r.method, r.host, r.path])).toEqual([
        ["GET", "web.archive.org", cdxPath("example.net%2F*")],
      ]);
      expect(requests[0]?.headers.accept).toBe("application/json");
      expect(requests[0]?.headers["user-agent"]).toBe(COLLECTOR_USER_AGENT);
    });

    it("labels a capped result partial and says how many captures it holds", async () => {
      const { outcome } = await run(domain("example.net"));
      const result = WAYBACK_RESULT.parse(expectStatus(outcome, "FOUND").result);
      // The archive sent 201 rows for a 200-row limit: it holds more.
      expect(result.derived.coverage).toEqual({
        partial: true,
        rowLimit: WAYBACK_ROW_LIMIT,
        capturesReturned: 200,
      });
      expect(result.captures).toHaveLength(200);
      expect(result.derived.query).toEqual({ url: "example.net/*", collapse: "urlkey" });
      // The 201st row only proves there is more; it is not reported.
      expect(result.captures.at(-1)?.originalUrl).toBe(
        "http://example.net/007&h:p://services.exam",
      );
      expect(result.captures.map((c) => c.originalUrl)).not.toContain(
        "http://example.net/007&h:p://services.example.net/AN",
      );
    });

    it("reports each capture exactly as the archive states it", async () => {
      const { outcome } = await run(domain("example.net"));
      const result = WAYBACK_RESULT.parse(expectStatus(outcome, "FOUND").result);
      expect(result.captures[0]).toEqual({
        timestamp: "20020121023005",
        originalUrl: "http://www.example.net:80/",
        statusCode: "200",
        mimeType: "text/html",
        digest: "HT2DYGA5UKZCPBSFVCV3JOBXGW2G5UUA",
        derived: {
          capturedAt: "2002-01-21T02:30:05.000Z",
          replayUrl: "https://web.archive.org/web/20020121023005/http://www.example.net:80/",
        },
      });
    });

    it("reports the archive's '-' as null, never as a value", async () => {
      const { outcome } = await run(domain("example.net"));
      const result = WAYBACK_RESULT.parse(expectStatus(outcome, "FOUND").result);
      const revisit = result.captures.find((c) => c.timestamp === "20250422025312");
      expect(revisit).toEqual({
        timestamp: "20250422025312",
        originalUrl: "http://example.net/%20%3Cspan",
        statusCode: null,
        mimeType: "warc/revisit",
        digest: "JI6OR3QR4CI526JD6TMMNZNV4QPMPQCH",
        derived: {
          capturedAt: "2025-04-22T02:53:12.000Z",
          replayUrl: "https://web.archive.org/web/20250422025312/http://example.net/%20%3Cspan",
        },
      });
      expect(result.captures.filter((c) => c.statusCode === null)).toHaveLength(12);
      expect(result.captures.some((c) => c.statusCode === "-")).toBe(false);
    });

    it("computes first and newest capture over the returned rows only, and names them so", async () => {
      const { outcome } = await run(domain("example.net"));
      const found = expectStatus(outcome, "FOUND");
      const result = WAYBACK_RESULT.parse(found.result);
      expect(result.derived).toMatchObject({
        earliestCapturedAtInResult: "2002-01-21T02:30:05.000Z",
        newestCapturedAtInResult: "2026-08-26T10:15:20.000Z",
        capturesWithoutReadableTimestamp: 0,
      });
      // Regression (Phase 3B review): the newest first-capture over the first
      // 200 URLs is computed over a subset; it is never the evidence's date.
      expect(found.evidence).toHaveLength(1);
      expect(found.evidence[0]?.observedAt).toBeNull();
    });

    it("cites the CDX response itself as REPORTED evidence, byte for byte", async () => {
      const { outcome } = await run(domain("example.net"));
      const found = expectStatus(outcome, "FOUND");
      const [draft] = evidenceDrafts(harness.runtime.registry.entry(ID), found);
      const fixture = FIXTURES[0];
      expect(draft?.collectorId).toBe(ID);
      expect(draft?.claimStrength).toBe("REPORTED");
      expect(draft?.sourceUrl).toBe(`https://web.archive.org${cdxPath("example.net%2F*")}`);
      expect(new TextDecoder().decode(draft?.payload)).toBe(fixture?.response.body);
      expect(draft?.observedAt).toBeNull();
    });

    it("asks for an exact URL, and reports the URL the archive recorded, not the target", async () => {
      const { outcome, requests } = await run({ type: "URL", value: "https://example.net/" });
      expect(requests.map((r) => r.path)).toEqual([cdxPath("https%3A%2F%2Fexample.net%2F")]);
      const found = expectStatus(outcome, "FOUND");
      const result = WAYBACK_RESULT.parse(found.result);
      expect(result.derived.query).toEqual({ url: "https://example.net/", collapse: "urlkey" });
      expect(result.derived.coverage).toEqual({
        partial: false,
        rowLimit: WAYBACK_ROW_LIMIT,
        capturesReturned: 1,
      });
      expect(result.captures).toEqual([
        {
          timestamp: "20020121023005",
          originalUrl: "http://www.example.net:80/",
          statusCode: "200",
          mimeType: "text/html",
          digest: "HT2DYGA5UKZCPBSFVCV3JOBXGW2G5UUA",
          derived: {
            capturedAt: "2002-01-21T02:30:05.000Z",
            replayUrl: "https://web.archive.org/web/20020121023005/http://www.example.net:80/",
          },
        },
      ]);
      // The first capture of a URL is not an observation of it now.
      expect(found.evidence[0]?.observedAt).toBeNull();
    });

    it("keeps a capture with an unreadable timestamp, dated null, and observedAt null", async () => {
      const { outcome } = await run(domain("undated.example"));
      const found = expectStatus(outcome, "FOUND");
      const result = WAYBACK_RESULT.parse(found.result);
      expect(result.captures).toEqual([
        {
          timestamp: "[timestamp]",
          originalUrl: "https://undated.example/[path]",
          statusCode: null,
          mimeType: null,
          digest: null,
          derived: {
            capturedAt: null,
            replayUrl: "https://web.archive.org/web/[timestamp]/https://undated.example/[path]",
          },
        },
      ]);
      expect(result.derived).toMatchObject({
        earliestCapturedAtInResult: null,
        newestCapturedAtInResult: null,
        capturesWithoutReadableTimestamp: 1,
      });
      expect(found.evidence[0]?.observedAt).toBeNull();
    });
  });

  describe("NOT_FOUND", () => {
    it("is the archive's recorded answer for no captures: 200 with []", async () => {
      const { outcome, requests } = await run(domain("nothing-archived.example"));
      expect(requests.map((r) => r.path)).toEqual([cdxPath("nothing-archived.example%2F*")]);
      const notFound = expectStatus(outcome, "NOT_FOUND");
      expect(notFound.response.kind).toBe("NETWORK");
      if (notFound.response.kind === "NETWORK") expect(notFound.response.status).toBe(200);
      // Regression (Phase 3B review): the detail states that subdomains were not searched.
      expect(notFound.detail).toBe(
        "The Wayback CDX index lists no captures for any path on this domain's host. Its subdomains were not searched.",
      );
      expect(notFound.detail).not.toContain("nothing-archived");
    });

    it("is also a header row with no capture rows", async () => {
      const { outcome } = await run(domain("header-only.example"));
      expectStatus(outcome, "NOT_FOUND");
    });
  });

  describe("UNAVAILABLE", () => {
    it("is a 5xx, with no retry time when the archive states none", async () => {
      const { outcome } = await run(domain("unavailable.example"));
      const unavailable = expectStatus(outcome, "UNAVAILABLE");
      expect(unavailable.error.code).toBe("UPSTREAM_UNAVAILABLE");
      expect(unavailable.retryAfterMs).toBeNull();
      expect(unavailable.error.message).toContain("HTTP 503");
    });

    it("is the archive's own 429, honouring its Retry-After", async () => {
      const { outcome } = await run(domain("rate-limited.example"));
      const unavailable = expectStatus(outcome, "UNAVAILABLE");
      expect(unavailable.error.code).toBe("UPSTREAM_UNAVAILABLE");
      expect(unavailable.retryAfterMs).toBe(120_000);
      expect(unavailable.error.message).toContain("HTTP 429");
    });
  });

  describe("FAILED", () => {
    it("is a 403 refusal, never NOT_FOUND", async () => {
      const { outcome } = await run(domain("forbidden.example"));
      const failed = expectStatus(outcome, "FAILED");
      expect(failed.error.code).toBe("UPSTREAM_REFUSED");
      expect(failed.error.message).toContain("HTTP 403");
    });

    it("is a 404: the index says 'no captures' with 200 and [], never with a status", async () => {
      const { outcome } = await run(domain("missing.example"));
      const failed = expectStatus(outcome, "FAILED");
      expect(failed.error.code).toBe("UPSTREAM_RESPONSE_INVALID");
      expect(failed.error.message).toContain("HTTP 404");
    });

    it.each([
      ["a body that is not JSON", "malformed.example"],
      ["a header without the original column", "no-original-column.example"],
      ["a row that does not match the header", "short-row.example"],
      // Regression: the previous adapter completed with zero captures here,
      // so a broken answer read as "nothing archived".
      ["an empty body", "empty-body.example"],
    ])("is %s", async (_case, value) => {
      const { outcome } = await run(domain(value));
      const failed = expectStatus(outcome, "FAILED");
      expect(failed.error.code).toBe("UPSTREAM_RESPONSE_INVALID");
      expect(failed.error.message).not.toContain(value);
    });
  });
});

describe("the wayback collector's gates and limits", () => {
  it("is refused where unverified sources are not allowed, and sends nothing", async () => {
    const harness = await startHarness({
      collectors: [waybackCollector],
      fixtures: FIXTURES,
      allowUnverifiedSources: false,
    });
    try {
      const outcome = await harness.run(ID, domain("example.net"));
      expect(expectStatus(outcome, "REFUSED").reason).toBe("UNVERIFIED_SOURCE_NOT_ALLOWED");
      expect(harness.requests).toEqual([]);
    } finally {
      await harness.close();
    }
  });

  it("refuses target types it does not declare, and sends nothing", async () => {
    const harness = await startHarness({ collectors: [waybackCollector], fixtures: FIXTURES });
    try {
      const outcome = await harness.run(ID, { type: "EMAIL_ADDRESS", value: "[user]@example.net" });
      expect(expectStatus(outcome, "REFUSED").reason).toBe("TARGET_TYPE_NOT_ACCEPTED");
      expect(harness.requests).toEqual([]);
    } finally {
      await harness.close();
    }
  });

  it("is UNAVAILABLE, with nothing sent, when the shared limit has no slot in time", async () => {
    const full: UpstreamRateLimiter = {
      acquire: (): Promise<RateLimitAnswer> =>
        Promise.resolve({ allowed: false, retryAfterMs: 3_600_000 }),
    };
    const harness = await startHarness({
      collectors: [waybackCollector],
      fixtures: FIXTURES,
      rateLimiter: full,
    });
    try {
      const outcome = await harness.run(ID, domain("example.net"));
      const unavailable = expectStatus(outcome, "UNAVAILABLE");
      expect(unavailable.error.code).toBe("UPSTREAM_RATE_LIMITED");
      expect(unavailable.retryAfterMs).toBe(3_600_000);
      expect(harness.requests).toEqual([]);
    } finally {
      await harness.close();
    }
  });

  it("takes every request's slot from the wayback-cdx source's shared limit", async () => {
    const memory = new MemoryRateLimiter();
    const asked: { sourceId: string; limit: number; intervalMs: number }[] = [];
    const recording: UpstreamRateLimiter = {
      acquire: (sourceId, policy) => {
        asked.push({ sourceId, ...policy });
        return memory.acquire(sourceId, policy);
      },
    };
    const harness = await startHarness({
      collectors: [waybackCollector],
      fixtures: FIXTURES,
      rateLimiter: recording,
    });
    try {
      const started = performance.now();
      expectStatus(await harness.run(ID, domain("example.net")), "FOUND");
      expectStatus(await harness.run(ID, { type: "URL", value: "https://example.net/" }), "FOUND");
      // The catalogue's limit for this source is one request a second.
      expect(performance.now() - started).toBeGreaterThanOrEqual(900);
      expect(harness.requests).toHaveLength(2);
      expect(new Set(asked.map((a) => a.sourceId))).toEqual(new Set(["wayback-cdx"]));
      expect(asked[0]).toEqual({ sourceId: "wayback-cdx", limit: 1, intervalMs: 1000 });
    } finally {
      await harness.close();
    }
  });
});

describe("waybackTimestampToIso", () => {
  it("reads the archive's UTC timestamp", () => {
    expect(waybackTimestampToIso("20020121023005")).toBe("2002-01-21T02:30:05.000Z");
  });

  it.each([
    ["too short", "2002012102300"],
    ["too long", "200201210230051"],
    ["not digits", "2002-01-21T02:30"],
    ["blank", ""],
    ["month 13", "20021321023005"],
    ["day 32", "20020132023005"],
    ["30 February", "20020230023005"],
    ["hour 24", "20020121243005"],
  ])("returns null, never a guess, for %s", (_case, raw) => {
    expect(waybackTimestampToIso(raw)).toBeNull();
  });
});

describe("parseCdxRows", () => {
  const HEADER = ["timestamp", "original", "statuscode", "mimetype", "digest"];

  it("reads columns by the header, not by position", () => {
    const rows = parseCdxRows([
      ["digest", "original", "timestamp", "mimetype", "statuscode"],
      ["[digest]", "https://example.net/[path]", "20020121023005", "text/html", "200"],
    ]);
    expect(rows).toEqual([
      {
        timestamp: "20020121023005",
        originalUrl: "https://example.net/[path]",
        statusCode: "200",
        mimeType: "text/html",
        digest: "[digest]",
        derived: {
          capturedAt: "2002-01-21T02:30:05.000Z",
          replayUrl: "https://web.archive.org/web/20020121023005/https://example.net/[path]",
        },
      },
    ]);
  });

  it("reports a column the archive did not send as null", () => {
    const rows = parseCdxRows([
      ["timestamp", "original"],
      ["20020121023005", "https://example.net/[path]"],
    ]);
    expect(rows[0]).toMatchObject({ statusCode: null, mimeType: null, digest: null });
  });

  it("gives no rows for [] and for a header with no rows", () => {
    expect(parseCdxRows([])).toEqual([]);
    expect(parseCdxRows([HEADER])).toEqual([]);
  });

  it.each([
    ["an object", { rows: [] }],
    ["a string", "[]"],
    ["null", null],
    ["a header that is not a list of names", [[1, 2, 3]]],
    [
      "a header without timestamp",
      [
        ["original", "statuscode"],
        ["https://example.net/", "200"],
      ],
    ],
    ["a row that is not a list", [HEADER, "20020121023005 https://example.net/ 200"]],
    ["a row shorter than the header", [HEADER, ["20020121023005", "https://example.net/"]]],
    [
      "a row with a non-string cell",
      [HEADER, [20020121023005, "https://example.net/", "200", "-", "-"]],
    ],
    ["a row with no timestamp", [HEADER, ["-", "https://example.net/", "200", "-", "-"]]],
    ["a row with no original URL", [HEADER, ["20020121023005", "", "200", "-", "-"]]],
  ])("throws UpstreamResponseError, never an empty list, for %s", (_case, payload) => {
    expect(() => parseCdxRows(payload)).toThrow(UpstreamResponseError);
  });
});

describe("retryAfterMs", () => {
  const withRetryAfter = (value: string | null, receivedAt: Date) =>
    captureResponse(Symbol("test"), {
      url: "https://web.archive.org/cdx/search/cdx",
      status: 429,
      headers: value === null ? {} : { "retry-after": value },
      body: new Uint8Array(),
      receivedAt,
    });
  const EPOCH = new Date(0);

  it("reads delta-seconds", () => {
    expect(retryAfterMs(withRetryAfter("120", EPOCH))).toBe(120_000);
  });

  it("reads an HTTP date, measured from when the response arrived", () => {
    expect(retryAfterMs(withRetryAfter("Thu, 01 Jan 1970 00:02:00 GMT", EPOCH))).toBe(120_000);
  });

  it("is null when the header is absent or unreadable", () => {
    expect(retryAfterMs(withRetryAfter(null, EPOCH))).toBeNull();
    expect(retryAfterMs(withRetryAfter("[not a time]", EPOCH))).toBeNull();
  });
});

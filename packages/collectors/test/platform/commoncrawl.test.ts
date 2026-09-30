/**
 * The Common Crawl URL index collector (NEW), run offline through the platform
 * harness against Common Crawl's recorded index list and CDX answer, with
 * synthetic fixtures only for conditions that could not be recorded or
 * provoked on demand.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { evidenceDrafts, tenantRegistration, type CollectionOutcome } from "../../src/index.ts";
import {
  COMMONCRAWL_CAPTURE_LIMIT,
  COMMONCRAWL_HISTORICAL_NOTE,
  COMMONCRAWL_RESULT,
  commoncrawlCollector,
} from "../../src/platform/commoncrawl.ts";
import { loadFixture, startHarness, type Fixture } from "./harness.ts";

const HOST = "index.commoncrawl.org";
const LABEL = "Common Crawl URL index";
const NONE = "qzxwv-placeholder-nonexistent.example";

const INFO = loadFixture("commoncrawl", "collinfo");
const CDX = loadFixture("commoncrawl", "cdx-iana");
const FOUND_FIXTURES = [INFO, CDX];

function expectStatus<S extends CollectionOutcome["status"]>(
  outcome: CollectionOutcome,
  status: S,
): Extract<CollectionOutcome, { status: S }> {
  expect(outcome.status, JSON.stringify(outcome)).toBe(status);
  return outcome as Extract<CollectionOutcome, { status: S }>;
}

async function run(fixtures: readonly Fixture[], domain = "iana.org") {
  const harness = await startHarness({ collectors: [commoncrawlCollector], fixtures });
  try {
    const outcome = await harness.run("commoncrawl", { type: "DOMAIN", value: domain });
    return { outcome, harness };
  } finally {
    await harness.close();
  }
}

const RECORDED_INFO = z.array(
  z.object({ id: z.string(), name: z.string(), from: z.string(), to: z.string() }),
);
const RECORDED_LINE = z.object({
  url: z.string(),
  timestamp: z.string(),
  status: z.string(),
  filename: z.string(),
  offset: z.string(),
  length: z.string(),
});
const recordedLines = () =>
  CDX.response.body
    .trim()
    .split("\n")
    .map((line) => RECORDED_LINE.parse(JSON.parse(line)));

describe("registration", () => {
  it("is labelled by the registry, reads only the index host, under a self-imposed limit", async () => {
    const harness = await startHarness({ collectors: [commoncrawlCollector], fixtures: [] });
    await harness.close();
    const entry = harness.runtime.registry.entry("commoncrawl");
    expect(entry.label).toBe(LABEL);
    expect(tenantRegistration(entry).sourceLabel).toBe(LABEL);
    expect(entry.source.network?.hosts).toEqual([HOST]);
    expect(entry.source.network?.rateLimit).toMatchObject({
      requests: 1,
      intervalSeconds: 2,
      basis: "SELF_IMPOSED",
    });
    expect(entry.commercialUse).toBe("UNVERIFIED");
    expect(entry).toMatchObject({
      discipline: "TECHINT",
      targetTypes: ["DOMAIN"],
      collectionMode: "PASSIVE_API",
      claimStrength: "REPORTED",
      credentials: { vaultIds: [], runsWithout: true },
    });
  });
});

describe("FOUND: captures under the domain in the newest index", () => {
  it("reads the index list, then the newest index's CDX API for the domain and every host under it", async () => {
    const { harness } = await run(FOUND_FIXTURES);
    expect(harness.unmatched).toEqual([]);
    expect(harness.requests.map((r) => r.path)).toEqual([
      "/collinfo.json",
      `/CC-MAIN-2026-39-index?url=*.iana.org&output=json&limit=${String(COMMONCRAWL_CAPTURE_LIMIT)}`,
    ]);
  });

  it("names the index and its crawl dates exactly as Common Crawl states them", async () => {
    const { outcome } = await run(FOUND_FIXTURES);
    const result = COMMONCRAWL_RESULT.parse(expectStatus(outcome, "FOUND").result);
    const newest = RECORDED_INFO.parse(JSON.parse(INFO.response.body))[0];
    expect(result.index).toEqual({
      id: newest?.id,
      name: newest?.name,
      crawlStartedAsStated: newest?.from,
      crawlEndedAsStated: newest?.to,
    });
  });

  it("says in every result that the index is historical and lags by weeks", async () => {
    const { outcome } = await run(FOUND_FIXTURES);
    const result = COMMONCRAWL_RESULT.parse(expectStatus(outcome, "FOUND").result);
    expect(result.derived.note).toBe(COMMONCRAWL_HISTORICAL_NOTE);
    expect(COMMONCRAWL_HISTORICAL_NOTE).toMatch(/historical/);
    expect(COMMONCRAWL_HISTORICAL_NOTE).toMatch(/weeks after the crawl ends/);
  });

  it("reports every listed capture in order, with the index's UTC time in ISO form", async () => {
    const { outcome } = await run(FOUND_FIXTURES);
    const result = COMMONCRAWL_RESULT.parse(expectStatus(outcome, "FOUND").result);
    const lines = recordedLines();
    expect(result.captures.map((c) => c.url)).toEqual(lines.map((l) => l.url));
    const first = result.captures[0];
    const line = lines[0];
    expect(first?.derived.capturedAt).toBe(
      line?.timestamp.replace(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/, "$1-$2-$3T$4:$5:$6Z"),
    );
    expect(first).toMatchObject({
      timestamp: line?.timestamp,
      status: line?.status,
      warcFilename: line?.filename,
      warcOffset: line?.offset,
      warcLength: line?.length,
    });
  });

  it("says when the limit was reached, without claiming more captures exist", async () => {
    const { outcome } = await run(FOUND_FIXTURES);
    const result = COMMONCRAWL_RESULT.parse(expectStatus(outcome, "FOUND").result);
    expect(recordedLines()).toHaveLength(COMMONCRAWL_CAPTURE_LIMIT);
    expect(result.derived.limitReached).toBe(true);
    expect(result).not.toHaveProperty("partial");
  });

  it("reports fields the index omits as null, never an invented value", async () => {
    const { outcome } = await run(FOUND_FIXTURES);
    const result = COMMONCRAWL_RESULT.parse(expectStatus(outcome, "FOUND").result);
    const withoutLanguages = result.captures.filter((c) => c.languages === null);
    const withoutRedirect = result.captures.filter((c) => c.redirect === null);
    expect(withoutLanguages.length).toBeGreaterThan(0);
    expect(withoutRedirect.length).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toMatch(/"(languages|redirect|digest|mimeDetected)":""/);
  });

  it("chooses the newest index by its stated end time, not its position in the list", async () => {
    const { harness } = await run([loadFixture("commoncrawl", "collinfo-unordered"), CDX]);
    expect(harness.unmatched).toEqual([]);
    expect(harness.requests[1]?.path).toBe(CDX.request.path);
  });

  it("cites both responses byte for byte, dated by nothing Common Crawl did not state", async () => {
    const { outcome, harness } = await run(FOUND_FIXTURES);
    const drafts = evidenceDrafts(
      harness.runtime.registry.entry("commoncrawl"),
      expectStatus(outcome, "FOUND"),
    );
    expect(drafts.map((d) => [d.sourceUrl, d.observedAt])).toEqual(
      FOUND_FIXTURES.map((f) => [`https://${HOST}${f.request.path}`, null]),
    );
    expect(drafts.map((d) => new TextDecoder().decode(d.payload))).toEqual(
      FOUND_FIXTURES.map((f) => f.response.body),
    );
  });
});

describe("statuses", () => {
  it("NOT_FOUND: no captures in the newest index, stated as absence from that index only", async () => {
    const { outcome } = await run([INFO, loadFixture("commoncrawl", "cdx-no-captures")], NONE);
    const notFound = expectStatus(outcome, "NOT_FOUND");
    expect(notFound.detail).toContain("CC-MAIN-2026-39");
    expect(notFound.detail).toContain(COMMONCRAWL_HISTORICAL_NOTE);
  });

  it("UNAVAILABLE: the index server's recorded 504", async () => {
    const { outcome } = await run([INFO, loadFixture("commoncrawl", "cdx-504")], NONE);
    expect(expectStatus(outcome, "UNAVAILABLE").error.code).toBe("UPSTREAM_UNAVAILABLE");
  });

  it("UNAVAILABLE: a 429 honours Retry-After", async () => {
    const { outcome } = await run([INFO, loadFixture("commoncrawl", "cdx-429")]);
    expect(expectStatus(outcome, "UNAVAILABLE").retryAfterMs).toBe(10_000);
  });

  it("UNAVAILABLE: an index list outage stops before any CDX request", async () => {
    const { outcome, harness } = await run([loadFixture("commoncrawl", "collinfo-503")]);
    expectStatus(outcome, "UNAVAILABLE");
    expect(harness.requests).toHaveLength(1);
  });

  it.each([
    ["cdx-404-other"],
    ["cdx-empty-200"],
    ["cdx-bad-line"],
    ["cdx-bad-capture"],
    ["cdx-impossible-date"],
    ["collinfo-wrong-shape"],
  ] as const)("FAILED: %s is UPSTREAM_RESPONSE_INVALID, never an empty success", async (name) => {
    const fixture = loadFixture("commoncrawl", name);
    const fixtures = fixture.request.path === "/collinfo.json" ? [fixture] : [INFO, fixture];
    const { outcome } = await run(fixtures);
    expect(expectStatus(outcome, "FAILED").error.code).toBe("UPSTREAM_RESPONSE_INVALID");
  });

  it("REFUSED: a target type other than DOMAIN never runs", async () => {
    const harness = await startHarness({ collectors: [commoncrawlCollector], fixtures: [] });
    try {
      const outcome = await harness.run("commoncrawl", { type: "USERNAME", value: "iana" });
      expect(expectStatus(outcome, "REFUSED").reason).toBe("TARGET_TYPE_NOT_ACCEPTED");
      expect(harness.requests).toEqual([]);
    } finally {
      await harness.close();
    }
  });
});

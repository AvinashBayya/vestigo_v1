/**
 * The DNS collector against recorded Cloudflare DNS-over-HTTPS responses
 * (test/fixtures/dns). Ported from the previous codebase's
 * tests/collectors-existing-dns.test.ts; each legacy case is noted where it
 * lands. No test touches the network: the harness answers only from fixtures.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  evidenceDrafts,
  parseTarget,
  tenantRegistration,
  type CollectionOutcome,
  type FoundOutcome,
  type UpstreamRateLimiter,
} from "../../src/index.ts";
import { dnsCollector } from "../../src/platform/dns.ts";
import { MemoryRateLimiter } from "../support.ts";
import { loadFixture, startHarness, type Fixture, type Harness } from "./harness.ts";

const FIXTURE_NAMES = [
  "found-example-com",
  "found-cname-chain-www-github-com",
  "found-private-address-nip-io",
  "found-truncated",
  "truncated-no-a-records",
  "nxdomain-nonexistent-example",
  "nodata-co-uk",
  "nodata-cname-only-ipv6-google-com",
  "servfail-dnssec-failed-org",
  "http-429-retry-after-seconds",
  "http-429-retry-after-date",
  "http-429-no-retry-after",
  "http-503-retry-after",
  "http-502",
  "http-403",
  "http-404",
  "malformed-not-json",
  "malformed-missing-status",
  "malformed-a-record-data",
  "question-mismatch",
  "dns-refused",
] as const;
type FixtureName = (typeof FIXTURE_NAMES)[number];

const FIXTURES = new Map<FixtureName, Fixture>(
  FIXTURE_NAMES.map((name) => [name, loadFixture("dns", name)]),
);

function fixture(name: FixtureName): Fixture {
  const found = FIXTURES.get(name);
  if (found === undefined) throw new Error(`fixture ${name} is not loaded`);
  return found;
}

/** The name a fixture was recorded for, read from its request path. */
function nameOf(name: FixtureName): string {
  const query = new URLSearchParams(fixture(name).request.path.split("?")[1]);
  const value = query.get("name");
  if (value === null) throw new Error(`fixture ${name} has no name in its path`);
  return value;
}

const LABEL = "DNS over HTTPS (Cloudflare resolver)";

let harness: Harness;

beforeAll(async () => {
  harness = await startHarness({ collectors: [dnsCollector], fixtures: [...FIXTURES.values()] });
});

afterEach(() => {
  expect(harness.unmatched).toEqual([]);
  harness.requests.length = 0;
  harness.unmatched.length = 0;
});

afterAll(async () => {
  await harness.close();
});

function run(name: FixtureName): Promise<CollectionOutcome> {
  return harness.run("dns", { type: "DOMAIN", value: nameOf(name) });
}

function expectFound(outcome: CollectionOutcome): FoundOutcome {
  if (outcome.status !== "FOUND") {
    throw new Error(`expected FOUND, got ${outcome.status}: ${JSON.stringify(outcome)}`);
  }
  return outcome;
}

describe("the dns collector's declaration", () => {
  it("is registered under its own label, source and licence verdict", () => {
    const entry = harness.runtime.registry.entry("dns");
    expect(entry).toMatchObject({
      id: "dns",
      version: "1.0.0",
      displayName: LABEL,
      label: LABEL,
      discipline: "TECHINT",
      targetTypes: ["DOMAIN"],
      collectionMode: "PASSIVE_API",
      claimStrength: "REPORTED",
      credentials: { vaultIds: [], runsWithout: true },
      commercialUse: "UNVERIFIED",
      availability: "UNVERIFIED",
    });
    expect(entry.source.id).toBe("cloudflare-doh");
    expect(entry.source.network?.hosts).toEqual(["cloudflare-dns.com"]);
    expect(tenantRegistration(entry).sourceLabel).toBe(LABEL);
  });

  it("is refused, without a request, where unverified sources are not allowed", async () => {
    const strict = await startHarness({
      collectors: [dnsCollector],
      fixtures: [fixture("found-example-com")],
      allowUnverifiedSources: false,
    });
    try {
      const outcome = await strict.run("dns", { type: "DOMAIN", value: "example.com" });
      expect(outcome).toMatchObject({
        status: "REFUSED",
        reason: "UNVERIFIED_SOURCE_NOT_ALLOWED",
      });
      expect(strict.requests).toEqual([]);
    } finally {
      await strict.close();
    }
  });
});

describe("targets", () => {
  // Legacy: "rejects an IP-literal target — that belongs to the Shodan collector".
  it("fails an IP literal given as a domain, before any request", async () => {
    const outcome = await harness.runtime.execute("dns", {
      target: { type: "DOMAIN", value: "8.8.8.8" },
      entitlement: { plan: "TECHINT_AND_PERSON", vettingStatus: "APPROVED" },
      scopeAuthorisation: null,
      credentials: new Map(),
    });
    expect(outcome).toMatchObject({ status: "FAILED", error: { code: "TARGET_INVALID" } });
    expect(harness.requests).toEqual([]);
  });

  it("does not accept IP address targets", async () => {
    const outcome = await harness.run("dns", { type: "IP_ADDRESS", value: "8.8.8.8" });
    expect(outcome).toMatchObject({ status: "REFUSED", reason: "TARGET_TYPE_NOT_ACCEPTED" });
    expect(harness.requests).toEqual([]);
  });

  it("queries the normalised name: lower case, no trailing dot", async () => {
    const outcome = await harness.run("dns", { type: "DOMAIN", value: "EXAMPLE.com." });
    expect(outcome.status).toBe("FOUND");
    expect(harness.requests.map((r) => r.path)).toEqual(["/dns-query?name=example.com&type=A"]);
  });
});

describe("FOUND", () => {
  // Legacy: "resolves a domain to its public A records", and the normalize
  // case "one IP entity per address": each A record is in the result.
  it("reports every A record exactly as the resolver gave it", async () => {
    const found = expectFound(await run("found-example-com"));
    expect(found.result).toEqual({
      question: { name: "example.com", type: 1 },
      answer: [
        { name: "example.com", type: 1, ttlSeconds: 51, data: "172.66.147.243" },
        { name: "example.com", type: 1, ttlSeconds: 51, data: "104.20.23.154" },
      ],
      authenticatedData: true,
      truncated: false,
      derived: {},
    });
  });

  it("asks the declared host for A records in the DNS JSON format, once", async () => {
    await run("found-example-com");
    expect(harness.requests).toHaveLength(1);
    const [request] = harness.requests;
    expect(request?.host).toBe("cloudflare-dns.com");
    expect(request?.method).toBe("GET");
    expect(request?.path).toBe("/dns-query?name=example.com&type=A");
    expect(request?.headers.accept).toBe("application/dns-json");
  });

  it("cites the response as received, undated, under the registry's label", async () => {
    const found = expectFound(await run("found-example-com"));
    expect(found.evidence).toHaveLength(1);
    expect(found.evidence[0]?.observedAt).toBeNull();
    const entry = harness.runtime.registry.entry("dns");
    const [draft] = evidenceDrafts(entry, found);
    expect(draft).toMatchObject({
      collectorId: "dns",
      collectorVersion: "1.0.0",
      sourceUrl: "https://cloudflare-dns.com/dns-query?name=example.com&type=A",
      observedAt: null,
      claimStrength: "REPORTED",
    });
    expect(new TextDecoder().decode(draft?.payload)).toBe(
      fixture("found-example-com").response.body,
    );
    expect(tenantRegistration(entry).sourceLabel).toBe(LABEL);
  });

  it("keeps the CNAME chain the resolver followed, in its order", async () => {
    const found = expectFound(await run("found-cname-chain-www-github-com"));
    expect(found.result).toEqual({
      question: { name: "www.github.com", type: 1 },
      answer: [
        { name: "www.github.com", type: 5, ttlSeconds: 3600, data: "github.com." },
        { name: "github.com", type: 1, ttlSeconds: 60, data: "20.207.73.82" },
      ],
      authenticatedData: false,
      truncated: false,
      derived: {},
    });
  });

  // Legacy: "private-only resolution completes with zero addresses" asserted
  // that private addresses were silently dropped. The resolver's answer is
  // now reported whole.
  it("reports a private address as the resolver gave it, not dropped", async () => {
    const found = expectFound(await run("found-private-address-nip-io"));
    expect(found.result).toMatchObject({
      answer: [{ name: "10.0.0.1.nip.io", type: 1, ttlSeconds: 3600, data: "10.0.0.1" }],
    });
  });

  it("labels an answer the resolver says was truncated", async () => {
    const found = expectFound(await run("found-truncated"));
    expect(found.result).toMatchObject({ truncated: true });
  });
});

describe("NOT_FOUND", () => {
  // Legacy: "NXDOMAIN fails rather than resolving to an empty address list".
  // NXDOMAIN is the resolver's definite answer, so it is NOT_FOUND now; the
  // point kept is that it is never FOUND with an empty list.
  it("reports NXDOMAIN as not found, citing the answer that said so", async () => {
    const outcome = await run("nxdomain-nonexistent-example");
    expect(outcome.status).toBe("NOT_FOUND");
    if (outcome.status !== "NOT_FOUND") return;
    expect(outcome.detail).toMatch(/NXDOMAIN/);
    expect(outcome.response.kind).toBe("NETWORK");
    if (outcome.response.kind === "NETWORK") expect(outcome.response.status).toBe(200);
    expect(outcome).not.toHaveProperty("result");
  });

  // Legacy normalize: "zero addresses produces a warning, not a fabricated
  // resolution". A name with no A record is not found, never FOUND and empty.
  it("reports a name with no A record as not found", async () => {
    const outcome = await run("nodata-co-uk");
    expect(outcome).toMatchObject({ status: "NOT_FOUND" });
    if (outcome.status === "NOT_FOUND") expect(outcome.detail).toMatch(/no A records/);
  });

  it("reports an alias whose target has no A record as not found", async () => {
    const outcome = await run("nodata-cname-only-ipv6-google-com");
    expect(outcome).toMatchObject({ status: "NOT_FOUND" });
    if (outcome.status === "NOT_FOUND") expect(outcome.detail).toMatch(/alias/);
  });
});

describe("UNAVAILABLE", () => {
  // Legacy normalize: "failed execution returns an empty result carrying the
  // error, not entities". A failure carries a typed error, no result, no evidence.
  it("reports SERVFAIL as unavailable, with no result and no evidence", async () => {
    const outcome = await run("servfail-dnssec-failed-org");
    expect(outcome).toEqual({
      status: "UNAVAILABLE",
      collectorId: "dns",
      error: {
        code: "UPSTREAM_UNAVAILABLE",
        message: "The upstream is unavailable: the resolver answered SERVFAIL.",
      },
      retryAfterMs: null,
    });
  });

  it.each([
    ["http-429-retry-after-seconds", 30_000],
    ["http-429-retry-after-date", 120_000],
    ["http-429-no-retry-after", null],
    ["http-503-retry-after", 120_000],
    ["http-502", null],
  ] as const)("reports %s as unavailable, honouring Retry-After", async (name, retryAfterMs) => {
    const outcome = await run(name);
    expect(outcome).toMatchObject({
      status: "UNAVAILABLE",
      error: { code: "UPSTREAM_UNAVAILABLE" },
      retryAfterMs,
    });
    expect(outcome).not.toHaveProperty("result");
    expect(outcome).not.toHaveProperty("evidence");
  });

  it("takes a slot from the source's shared rate limit before each request", async () => {
    const calls: { sourceId: string; limit: number; intervalMs: number }[] = [];
    const recording: UpstreamRateLimiter = {
      acquire: (sourceId, policy) => {
        calls.push({ sourceId, ...policy });
        return Promise.resolve({ allowed: true });
      },
    };
    const limited = await startHarness({
      collectors: [dnsCollector],
      fixtures: [fixture("found-example-com")],
      rateLimiter: recording,
    });
    try {
      expect((await limited.run("dns", { type: "DOMAIN", value: "example.com" })).status).toBe(
        "FOUND",
      );
      expect(calls).toEqual([{ sourceId: "cloudflare-doh", limit: 1, intervalMs: 1000 }]);
    } finally {
      await limited.close();
    }
  });

  it("spaces back-to-back runs by the source's rate limit", async () => {
    const limited = await startHarness({
      collectors: [dnsCollector],
      fixtures: [fixture("found-example-com")],
      rateLimiter: new MemoryRateLimiter(),
    });
    try {
      const target = { type: "DOMAIN", value: "example.com" } as const;
      const started = performance.now();
      const first = await limited.run("dns", target);
      const second = await limited.run("dns", target);
      expect([first.status, second.status]).toEqual(["FOUND", "FOUND"]);
      expect(performance.now() - started).toBeGreaterThanOrEqual(900);
      expect(limited.requests).toHaveLength(2);
    } finally {
      await limited.close();
    }
  });

  it("is unavailable, without a request, when the shared limit has no slot in time", async () => {
    const exhausted: UpstreamRateLimiter = {
      acquire: () => Promise.resolve({ allowed: false, retryAfterMs: 60_000 }),
    };
    const limited = await startHarness({
      collectors: [dnsCollector],
      fixtures: [fixture("found-example-com")],
      rateLimiter: exhausted,
    });
    try {
      const outcome = await limited.run("dns", { type: "DOMAIN", value: "example.com" });
      expect(outcome).toMatchObject({
        status: "UNAVAILABLE",
        error: { code: "UPSTREAM_RATE_LIMITED" },
        retryAfterMs: 60_000,
      });
      expect(limited.requests).toEqual([]);
    } finally {
      await limited.close();
    }
  });
});

describe("FAILED", () => {
  it.each([
    ["http-403", /HTTP 403/],
    ["http-404", /HTTP 404/],
    ["malformed-not-json", /not valid JSON/],
    ["malformed-missing-status", /documented DNS answer shape/],
    ["malformed-a-record-data", /not an IPv4 address/],
    ["question-mismatch", /not for the question asked/],
    ["dns-refused", /DNS status 5/],
    // Regression (Phase 3B review): truncation may have lost the records, so
    // this is not the name having no address.
    ["truncated-no-a-records", /truncated \(TC\) and holds no A records/],
  ] as const)("fails %s with a typed error, never as found or not found", async (name, message) => {
    const outcome = await run(name);
    expect(outcome).toMatchObject({
      status: "FAILED",
      error: { code: "UPSTREAM_RESPONSE_INVALID" },
    });
    if (outcome.status === "FAILED") expect(outcome.error.message).toMatch(message);
    expect(outcome).not.toHaveProperty("result");
  });

  it("never repeats the target in an error message", async () => {
    const name = nameOf("question-mismatch");
    const outcome = await run("question-mismatch");
    expect(JSON.stringify(outcome)).not.toContain(name);
    expect(parseTarget("DOMAIN", name).value).toBe(name);
  });
});

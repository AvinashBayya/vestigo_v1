/**
 * The crt.sh Certificate Transparency collector, run through the platform
 * harness against recorded crt.sh answers (test/fixtures/crtsh). No test
 * touches the network.
 *
 * Ported from the previous codebase's tests/collectors-existing-crtsh.test.ts
 * and the crt.sh cases of tests/recon.test.ts. The central regression
 * (docs/audit/COLLECTORS.md row 1): the old lookup answered a crt.sh failure,
 * a rate limit, an unreadable body, or a genuine zero result by quietly
 * querying two other upstreams and labelling their rows as crt.sh's. Here a
 * failure is a typed outcome, a zero result is NOT_FOUND, and only crt.sh is
 * ever contacted.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CRTSH_RESULT,
  crtshCollector,
  deriveHostnames,
  isWithinDomain,
  parseIssuerOrganisation,
  type CrtshResult,
} from "../../src/platform/crtsh.ts";
import {
  COLLECTOR_USER_AGENT,
  evidenceDrafts,
  PLATFORM_SOURCES,
  tenantRegistration,
  type CollectionOutcome,
  type FoundOutcome,
  type UpstreamRateLimiter,
} from "../../src/index.ts";
import { ENTITLED, MemoryRateLimiter } from "../support.ts";
import { loadFixture, startHarness, type Harness } from "./harness.ts";

const LABEL = "crt.sh Certificate Transparency";
const EXAMPLE = { type: "DOMAIN", value: "example.com" } as const;
const SEARCH_PATH = "/?q=%25.example.com&output=json";
const SEARCH_URL = `https://crt.sh${SEARCH_PATH}`;
/** The hosts the previous codebase fell back to. Nothing here may reach them. */
const FALLBACK_HOSTS = ["api.hackertarget.com", "otx.alienvault.com"];

/** The recorded crt.sh entries for example.com, parsed from the fixture itself. */
interface RecordedEntry {
  readonly id: number;
  readonly issuer_ca_id: number;
  readonly issuer_name: string;
  readonly common_name: string;
  readonly name_value: string;
  readonly serial_number: string;
  readonly not_before: string;
  readonly not_after: string;
}
const RECORDED = loadFixture("crtsh", "found-example-com");
const RECORDED_ENTRIES = JSON.parse(RECORDED.response.body) as RecordedEntry[];

const open: Harness[] = [];

afterEach(async () => {
  await Promise.all(open.splice(0).map((harness) => harness.close()));
});

async function harnessWith(
  fixtures: readonly string[],
  rateLimiter?: UpstreamRateLimiter,
): Promise<Harness> {
  const harness = await startHarness({
    collectors: [crtshCollector],
    fixtures: fixtures.map((name) => loadFixture("crtsh", name)),
    ...(rateLimiter === undefined ? {} : { rateLimiter }),
  });
  open.push(harness);
  return harness;
}

/** Runs example.com against one fixture, returning the outcome and what reached the upstream. */
async function runAgainst(fixture: string) {
  const harness = await harnessWith([fixture]);
  const outcome = await harness.run("crtsh", EXAMPLE);
  return { harness, outcome };
}

function foundResult(outcome: CollectionOutcome): { found: FoundOutcome; result: CrtshResult } {
  expect(outcome.status).toBe("FOUND");
  const found = outcome as FoundOutcome;
  return { found, result: CRTSH_RESULT.parse(found.result) };
}

function hostname(result: CrtshResult, name: string) {
  const entry = result.derived.hostnames.find((candidate) => candidate.name === name);
  expect(entry, name).toBeDefined();
  return entry as CrtshResult["derived"]["hostnames"][number];
}

/** Only crt.sh was contacted, once, for the search: never a fallback upstream. */
function expectOnlyCrtsh(harness: Harness, path = SEARCH_PATH): void {
  expect(harness.requests.map((request) => [request.host, request.method, request.path])).toEqual([
    ["crt.sh", "GET", path],
  ]);
  for (const host of FALLBACK_HOSTS) {
    expect(harness.requests.some((request) => request.host === host)).toBe(false);
  }
  expect(harness.unmatched).toEqual([]);
}

describe("the crt.sh collector's declaration", () => {
  it("is labelled by its registry entry, on the crtsh source, passive, REPORTED, needing no credential", async () => {
    const harness = await harnessWith([]);
    const entry = harness.runtime.registry.entry("crtsh");
    expect(entry.label).toBe(LABEL);
    expect(entry.source.id).toBe("crtsh");
    expect(entry.discipline).toBe("TECHINT");
    expect(entry.collectionMode).toBe("PASSIVE_API");
    expect(entry.claimStrength).toBe("REPORTED");
    expect(entry.targetTypes).toEqual(["DOMAIN"]);
    expect(entry.credentials.vaultIds).toEqual([]);
    expect(tenantRegistration(entry).sourceLabel).toBe(LABEL);
  });
});

describe("FOUND: the recorded answer for example.com", () => {
  it("makes one GET to crt.sh's JSON search, with the platform user agent, and nothing else", async () => {
    const { harness, outcome } = await runAgainst("found-example-com");
    expect(outcome.status).toBe("FOUND");
    expectOnlyCrtsh(harness);
    const [request] = harness.requests;
    expect(request?.headers.accept).toBe("application/json");
    expect(request?.headers["user-agent"]).toBe(COLLECTOR_USER_AGENT);
  });

  it("reports every entry crt.sh sent, in its order, with each field exactly as sent", async () => {
    const { outcome } = await runAgainst("found-example-com");
    const { result } = foundResult(outcome);
    expect(RECORDED_ENTRIES.length).toBeGreaterThan(0);
    expect(result.certificates).toEqual(
      RECORDED_ENTRIES.map((entry) => ({
        id: entry.id,
        issuerCaId: entry.issuer_ca_id,
        issuerName: entry.issuer_name,
        commonName: entry.common_name,
        nameValue: entry.name_value,
        serialNumber: entry.serial_number,
        notBefore: entry.not_before,
        notAfter: entry.not_after,
        derived: { names: entry.name_value.split("\n") },
      })),
    );
  });

  it("keeps an issuer crt.sh reports as not found exactly as sent, and derives no organisation from it", async () => {
    const { outcome } = await runAgainst("found-example-com");
    const { result } = foundResult(outcome);
    const unknownIssuer = result.certificates.filter((c) => c.issuerName === "Issuer Not Found");
    expect(unknownIssuer.map((c) => c.issuerCaId)).toEqual([-1]);
    for (const entry of result.derived.hostnames) {
      expect(entry.issuerOrganisations).not.toContain("Issuer Not Found");
    }
  });

  it("cites the captured crt.sh answer as REPORTED evidence, with no invented date", async () => {
    const { harness, outcome } = await runAgainst("found-example-com");
    const { found } = foundResult(outcome);
    expect(found.evidence).toHaveLength(1);
    const [item] = found.evidence;
    expect(item?.observedAt).toBeNull();
    expect(item?.response.kind).toBe("NETWORK");
    if (item?.response.kind === "NETWORK") {
      expect(item.response.status).toBe(200);
      expect(item.response.url).toBe(SEARCH_URL);
    }
    const drafts = evidenceDrafts(harness.runtime.registry.entry("crtsh"), found);
    expect(drafts).toHaveLength(1);
    const [draft] = drafts;
    expect(draft?.collectorId).toBe("crtsh");
    expect(draft?.sourceUrl).toBe(SEARCH_URL);
    expect(draft?.claimStrength).toBe("REPORTED");
    expect(draft?.observedAt).toBeNull();
    expect(new TextDecoder().decode(draft?.payload)).toBe(RECORDED.response.body);
    // Measured by the fetcher when the answer arrived; never the upstream's say.
    if (item?.response.kind === "NETWORK") {
      expect(draft?.collectedAt.getTime()).toBe(item.response.receivedAt.getTime());
    }
  });

  it("derives the DNS names under the domain, sorted, keeping a wildcard as its own name", async () => {
    const { outcome } = await runAgainst("found-example-com");
    const { result } = foundResult(outcome);
    expect(result.derived.hostnames.map((h) => [h.name, h.wildcard])).toEqual([
      ["*.example.com", true],
      ["dev.example.com", false],
      ["example.com", false],
      ["m.example.com", false],
      ["products.example.com", false],
      ["support.example.com", false],
      ["www.example.com", false],
    ]);
  });

  it("leaves out email identities, free text, other domains and suffix collisions, which stay reported", async () => {
    const { outcome } = await runAgainst("found-example-com");
    const { result } = foundResult(outcome);
    const reported = result.certificates.flatMap((c) => [...c.derived.names, c.commonName]);
    const derived = result.derived.hostnames.map((h) => h.name);
    for (const name of [
      "user@example.com",
      "AS207960 Test Intermediate - example.com",
      "m.testexample.com",
      "www.example.org",
    ]) {
      expect(reported, name).toContain(name);
      expect(derived, name).not.toContain(name);
    }
  });

  it("lists every certificate naming a host, the earliest start and latest end among them", async () => {
    const { outcome } = await runAgainst("found-example-com");
    const { result } = foundResult(outcome);
    const apex = hostname(result, "example.com");
    const naming = RECORDED_ENTRIES.filter(
      (entry) =>
        entry.name_value.split("\n").includes("example.com") || entry.common_name === "example.com",
    );
    expect(apex.certificateIds).toEqual(naming.map((entry) => entry.id).sort((a, b) => a - b));
    expect(apex.earliestNotBefore).toBe(naming.map((e) => e.not_before).sort()[0]);
    expect(apex.latestNotAfter).toBe(
      naming
        .map((e) => e.not_after)
        .sort()
        .at(-1),
    );
    // The values themselves, as recorded, so a sort mistake cannot hide.
    expect(apex.earliestNotBefore).toBe("2014-11-06T00:00:00");
    expect(apex.latestNotAfter).toBe("2033-01-24T01:21:18");
  });

  it("reads issuer organisations from O=, including a quoted one with a comma", async () => {
    const { outcome } = await runAgainst("found-example-com");
    const { result } = foundResult(outcome);
    expect(hostname(result, "*.example.com").issuerOrganisations).toEqual([
      "CLOUDFLARE, INC.",
      "DigiCert Inc",
      "SSL Corporation",
      "Sectigo Limited",
      "thawte, Inc.",
    ]);
    expect(hostname(result, "m.example.com").issuerOrganisations).toEqual(["thawte, Inc."]);
  });

  it("looks up the normalised target", async () => {
    const harness = await harnessWith(["found-example-com"]);
    const outcome = await harness.run("crtsh", { type: "DOMAIN", value: "EXAMPLE.com." });
    expect(outcome.status).toBe("FOUND");
    expectOnlyCrtsh(harness);
  });
});

describe("FOUND: absent values stay absent (synthetic entries)", () => {
  it("reports null for every field crt.sh left out or sent as null, never a stand-in", async () => {
    const { outcome } = await runAgainst("entries-undated-200");
    const { result } = foundResult(outcome);
    expect(result.certificates.slice(0, 2)).toEqual([
      {
        id: 1,
        issuerCaId: null,
        issuerName: "C=[country], CN=[issuer without an organisation]",
        commonName: "undated.example.com",
        nameValue: "undated.example.com",
        serialNumber: null,
        notBefore: null,
        notAfter: null,
        derived: { names: ["undated.example.com"] },
      },
      {
        id: 2,
        issuerCaId: null,
        issuerName: null,
        commonName: null,
        nameValue: "mixed.example.com",
        serialNumber: null,
        notBefore: null,
        notAfter: null,
        derived: { names: ["mixed.example.com"] },
      },
    ]);
  });

  it("gives a host named only by undated certificates null dates, never today", async () => {
    const { outcome } = await runAgainst("entries-undated-200");
    const { result } = foundResult(outcome);
    expect(hostname(result, "undated.example.com")).toEqual({
      name: "undated.example.com",
      wildcard: false,
      certificateIds: [1],
      earliestNotBefore: null,
      latestNotAfter: null,
      issuerOrganisations: [],
    });
  });

  it("lets a real date beat a missing one", async () => {
    const { outcome } = await runAgainst("entries-undated-200");
    const { result } = foundResult(outcome);
    expect(hostname(result, "mixed.example.com")).toEqual({
      name: "mixed.example.com",
      wildcard: false,
      certificateIds: [2, 3],
      earliestNotBefore: "2000-02-01T00:00:00",
      latestNotAfter: "2000-03-01T00:00:00",
      issuerOrganisations: ["[Issuer, organisation]"],
    });
  });

  it("never fills a missing validity start from another date: not the end, not the log entry time", async () => {
    // Regression: the previous codebase used entry_timestamp (when a log
    // recorded the entry) as the certificate's first-seen date when
    // not_before was missing, presenting one date as another.
    const { outcome } = await runAgainst("entries-undated-200");
    const { result } = foundResult(outcome);
    const endOnly = result.certificates.find((certificate) => certificate.id === 4);
    expect(endOnly?.notBefore).toBeNull();
    expect(endOnly?.notAfter).toBe("2000-04-01T00:00:00");
    expect(hostname(result, "end-only.example.com")).toEqual({
      name: "end-only.example.com",
      wildcard: false,
      certificateIds: [4],
      earliestNotBefore: null,
      latestNotAfter: "2000-04-01T00:00:00",
      issuerOrganisations: [],
    });
  });

  it("lower-cases derived names and drops a trailing dot, reporting the name itself as sent", async () => {
    const { outcome } = await runAgainst("entries-undated-200");
    const { result } = foundResult(outcome);
    expect(result.certificates[2]?.derived.names).toEqual([
      "mixed.example.com",
      "API.Example.com.",
      "example.com.invalid",
    ]);
    expect(result.derived.hostnames.map((h) => h.name)).toEqual([
      "api.example.com",
      "end-only.example.com",
      "mixed.example.com",
      "undated.example.com",
    ]);
  });
});

describe("NOT_FOUND: a genuine zero result", () => {
  it("is NOT_FOUND citing crt.sh's empty list: no fallback, no rows, no evidence", async () => {
    const harness = await harnessWith(["empty-example-invalid"]);
    const outcome = await harness.run("crtsh", { type: "DOMAIN", value: "example.invalid" });
    expect(outcome.status).toBe("NOT_FOUND");
    if (outcome.status !== "NOT_FOUND") return;
    expect(outcome.collectorId).toBe("crtsh");
    expect(outcome.detail).toMatch(/empty list/);
    expect(outcome.detail).not.toContain("example.invalid");
    expect(outcome.response.kind).toBe("NETWORK");
    if (outcome.response.kind === "NETWORK") expect(outcome.response.status).toBe(200);
    expect(outcome.response.text()).toBe("[]");
    expect("result" in outcome).toBe(false);
    expect("evidence" in outcome).toBe(false);
    expectOnlyCrtsh(harness, "/?q=%25.example.invalid&output=json");
  });
});

describe("failures are typed outcomes: never empty, never FOUND, never a fallback", () => {
  const CASES = [
    {
      fixture: "status-500",
      status: "UNAVAILABLE",
      code: "UPSTREAM_UNAVAILABLE",
      retryAfterMs: null,
    },
    {
      fixture: "status-429-retry-after-seconds",
      status: "UNAVAILABLE",
      code: "UPSTREAM_UNAVAILABLE",
      retryAfterMs: 60_000,
    },
    {
      fixture: "status-503-retry-after-date",
      status: "UNAVAILABLE",
      code: "UPSTREAM_UNAVAILABLE",
      retryAfterMs: 120_000,
    },
    {
      fixture: "status-404-overloaded",
      status: "UNAVAILABLE",
      code: "UPSTREAM_UNAVAILABLE",
      retryAfterMs: null,
    },
    {
      fixture: "body-html-200",
      status: "FAILED",
      code: "UPSTREAM_RESPONSE_INVALID",
      retryAfterMs: null,
    },
    {
      fixture: "body-object-200",
      status: "FAILED",
      code: "UPSTREAM_RESPONSE_INVALID",
      retryAfterMs: null,
    },
    {
      fixture: "body-entry-invalid-200",
      status: "FAILED",
      code: "UPSTREAM_RESPONSE_INVALID",
      retryAfterMs: null,
    },
    {
      fixture: "status-403",
      status: "FAILED",
      code: "UPSTREAM_REFUSED",
      retryAfterMs: null,
    },
    {
      fixture: "status-400",
      status: "FAILED",
      code: "UPSTREAM_RESPONSE_INVALID",
      retryAfterMs: null,
    },
  ] as const;

  it.each(CASES)(
    "$fixture is $status ($code), after one request to crt.sh only",
    async ({ fixture, status, code, retryAfterMs }) => {
      const { harness, outcome } = await runAgainst(fixture);
      expect(outcome.status).toBe(status);
      expect("result" in outcome).toBe(false);
      expect("evidence" in outcome).toBe(false);
      if (outcome.status === "UNAVAILABLE") {
        expect(outcome.error.code).toBe(code);
        expect(outcome.retryAfterMs).toBe(retryAfterMs);
      } else if (outcome.status === "FAILED") {
        expect(outcome.error.code).toBe(code);
      }
      // One attempt: the worker retries UNAVAILABLE with backoff, not the collector.
      expectOnlyCrtsh(harness);
    },
  );

  it.each(CASES)(
    "$fixture's message never repeats the target or the search path",
    async ({ fixture }) => {
      const { outcome } = await runAgainst(fixture);
      expect(outcome.status === "UNAVAILABLE" || outcome.status === "FAILED").toBe(true);
      if (outcome.status !== "UNAVAILABLE" && outcome.status !== "FAILED") return;
      expect(outcome.error.message).not.toContain("example.com");
      expect(outcome.error.message).not.toContain("%25");
    },
  );

  it("a 429 says it was rate-limited", async () => {
    const { outcome } = await runAgainst("status-429-retry-after-seconds");
    expect(outcome.status).toBe("UNAVAILABLE");
    if (outcome.status === "UNAVAILABLE")
      expect(outcome.error.message).toMatch(/rate-limited.*429/);
  });

  it("a 500 names the status", async () => {
    const { outcome } = await runAgainst("status-500");
    expect(outcome.status).toBe("UNAVAILABLE");
    if (outcome.status === "UNAVAILABLE") expect(outcome.error.message).toMatch(/HTTP 500/);
  });

  it("a 404 is a service fault, never 'this domain has no certificates'", async () => {
    const { outcome } = await runAgainst("status-404-overloaded");
    expect(outcome.status).toBe("UNAVAILABLE");
    if (outcome.status === "UNAVAILABLE") expect(outcome.error.message).toMatch(/not a finding/);
  });

  it("an unreachable crt.sh is UNAVAILABLE, not an empty result", async () => {
    const harness = await startHarness({
      collectors: [crtshCollector],
      fixtures: [loadFixture("crtsh", "found-example-com")],
    });
    // Nothing is listening any more: the connection is refused.
    await harness.close();
    const outcome = await harness.run("crtsh", EXAMPLE);
    expect(outcome.status).toBe("UNAVAILABLE");
    if (outcome.status === "UNAVAILABLE") expect(outcome.error.code).toBe("UPSTREAM_UNREACHABLE");
    expect(harness.requests).toEqual([]);
  });
});

describe("crt.sh's shared rate limit", () => {
  it("waits for a free slot rather than sending early", async () => {
    const limiter = new MemoryRateLimiter();
    const policy = PLATFORM_SOURCES.find((source) => source.id === "crtsh")?.network?.rateLimit;
    expect(policy).toBeDefined();
    if (policy === undefined) return;
    const intervalMs = policy.intervalSeconds * 1000;
    // Another run holds every slot for this interval.
    for (let taken = 0; taken < policy.requests; taken++) {
      await limiter.acquire("crtsh", { limit: policy.requests, intervalMs });
    }
    const harness = await harnessWith(["found-example-com"], limiter);
    const started = performance.now();
    const outcome = await harness.run("crtsh", EXAMPLE);
    expect(outcome.status).toBe("FOUND");
    expect(performance.now() - started).toBeGreaterThanOrEqual(intervalMs / 2);
    expectOnlyCrtsh(harness);
  });

  it("is UNAVAILABLE, with nothing sent, when no slot frees within the fetch's timeout", async () => {
    const saturated: UpstreamRateLimiter = {
      acquire: () => Promise.resolve({ allowed: false, retryAfterMs: 120_000 }),
    };
    const harness = await harnessWith(["found-example-com"], saturated);
    const outcome = await harness.run("crtsh", EXAMPLE);
    expect(outcome.status).toBe("UNAVAILABLE");
    if (outcome.status === "UNAVAILABLE") {
      expect(outcome.error.code).toBe("UPSTREAM_RATE_LIMITED");
      expect(outcome.retryAfterMs).toBe(120_000);
    }
    expect(harness.requests).toEqual([]);
  });
});

describe("the runtime's gates, before any request", () => {
  it("refuses a target that is not a domain", async () => {
    const harness = await harnessWith(["found-example-com"]);
    const outcome = await harness.run("crtsh", {
      type: "EMAIL_ADDRESS",
      value: "user@example.com",
    });
    expect(outcome.status).toBe("REFUSED");
    if (outcome.status === "REFUSED") expect(outcome.reason).toBe("TARGET_TYPE_NOT_ACCEPTED");
    expect(harness.requests).toEqual([]);
  });

  it.each(["   ", "*.example.com"])(
    "fails the invalid domain %j as TARGET_INVALID",
    async (value) => {
      const harness = await harnessWith(["found-example-com"]);
      const outcome = await harness.runtime.execute("crtsh", {
        target: { type: "DOMAIN", value },
        entitlement: ENTITLED,
        scopeAuthorisation: null,
        credentials: new Map(),
      });
      expect(outcome.status).toBe("FAILED");
      if (outcome.status === "FAILED") expect(outcome.error.code).toBe("TARGET_INVALID");
      expect(harness.requests).toEqual([]);
    },
  );
});

describe("no fallback, structurally", () => {
  it("the crtsh source reaches crt.sh only, and the old fallback upstreams are blocked", () => {
    const byId = new Map(PLATFORM_SOURCES.map((source) => [source.id, source]));
    expect(byId.get("crtsh")?.network?.hosts).toEqual(["crt.sh"]);
    for (const id of ["hackertarget", "alienvault-otx"]) {
      expect(byId.get(id)?.licence.commercialUse, id).toBe("BLOCKED");
    }
  });

  it("the collector's code names no other upstream", () => {
    const source = readFileSync(
      join(import.meta.dirname, "..", "..", "src", "platform", "crtsh.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/hackertarget|alienvault|\botx\b/i);
    const urls = source.match(/https?:\/\/[^\s"'`)]+/g) ?? [];
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(url.startsWith("https://crt.sh/"), url).toBe(true);
  });
});

describe("parseIssuerOrganisation: never guesses an issuer", () => {
  it("reads the O= component", () => {
    expect(
      parseIssuerOrganisation(
        "C=GB, O=Sectigo Limited, CN=Sectigo Public Server Authentication CA DV E36",
      ),
    ).toBe("Sectigo Limited");
  });

  it("reads a quoted organisation containing a comma", () => {
    expect(
      parseIssuerOrganisation('C=US, O="CLOUDFLARE, INC.", CN=Cloudflare TLS Issuing ECC CA 1'),
    ).toBe("CLOUDFLARE, INC.");
  });

  it("is null when there is no O= component (OU= is not O=)", () => {
    expect(parseIssuerOrganisation("Issuer Not Found")).toBeNull();
    expect(parseIssuerOrganisation("C=[country], CN=[issuer]")).toBeNull();
    expect(parseIssuerOrganisation("C=[country], OU=[unit], CN=[issuer]")).toBeNull();
  });

  it("is null for a missing issuer or an empty O=", () => {
    expect(parseIssuerOrganisation(null)).toBeNull();
    expect(parseIssuerOrganisation("C=[country], O=, CN=[issuer]")).toBeNull();
  });
});

describe("isWithinDomain", () => {
  it("accepts the domain itself and names under it", () => {
    expect(isWithinDomain("example.com", "example.com")).toBe(true);
    expect(isWithinDomain("a.b.example.com", "example.com")).toBe(true);
  });

  it("rejects suffix collisions and unrelated names", () => {
    expect(isWithinDomain("m.testexample.com", "example.com")).toBe(false);
    expect(isWithinDomain("example.com.invalid", "example.com")).toBe(false);
    expect(isWithinDomain("www.example.org", "example.com")).toBe(false);
  });
});

describe("deriveHostnames on a large answer", () => {
  it("stays linear: a host named by every one of 100,000 certificates is folded within the run budget", () => {
    // Regression: a first version copied each host's id list per
    // certificate, which is quadratic and would spend a busy domain's run
    // budget. Ids and names are placeholders, not crt.sh data.
    const count = 100_000;
    const certificates = Array.from({ length: count }, (_, index) => ({
      id: index + 1,
      issuerCaId: null,
      issuerName: null,
      commonName: "example.com",
      nameValue: "example.com\n*.example.com",
      serialNumber: null,
      notBefore: null,
      notAfter: null,
      derived: { names: ["example.com", "*.example.com"] },
    }));
    const hostnames = deriveHostnames(certificates, "example.com");
    expect(hostnames.map((h) => [h.name, h.certificateIds.length])).toEqual([
      ["*.example.com", count],
      ["example.com", count],
    ]);
  }, 10_000);
});

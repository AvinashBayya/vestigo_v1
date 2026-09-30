/**
 * The RDAP collector, offline, against responses recorded from rdap.org and
 * the .com registry on 2026-09-28 (and synthetic ones for conditions that
 * cannot be provoked live). Ports legacy/tests/collectors-existing-rdap.test.ts
 * to the new contract, and adds the cases the audit calls for: rdap.org's own
 * 404 is not "not registered", an http-only registry fails honestly, and an
 * unreadable or absent registrar is never filled in.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  evidenceDrafts,
  type CapturedResponse,
  type CollectionOutcome,
  type UpstreamRateLimiter,
} from "../../src/index.ts";
import { rdapCollector, type RdapResult } from "../../src/platform/rdap.ts";
import { MemoryRateLimiter } from "../support.ts";
import { loadFixture, startHarness, type Harness } from "./harness.ts";

const EXAMPLE_COM = { type: "DOMAIN", value: "example.com" } as const;
const REGISTRY_URL = "https://rdap.verisign.com/com/v1/domain/example.com";

/** rdap.org's recorded redirect for example.com, then the registry's answer. */
const VIA_REDIRECT = (registryFixture: string) => [
  "rdap-org-example-com-redirect",
  registryFixture,
];

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

async function start(
  fixtures: readonly string[],
  options: { rateLimiter?: UpstreamRateLimiter; allowUnverifiedSources?: boolean } = {},
): Promise<Harness> {
  harness = await startHarness({
    collectors: [rdapCollector],
    fixtures: fixtures.map((name) => loadFixture("rdap", name)),
    ...options,
  });
  return harness;
}

async function run(
  fixtures: readonly string[],
  target: { readonly type: "DOMAIN"; readonly value: string } = EXAMPLE_COM,
): Promise<{ outcome: CollectionOutcome; harness: Harness }> {
  const started = await start(fixtures);
  return { outcome: await started.run("rdap", target), harness: started };
}

function expectStatus<S extends CollectionOutcome["status"]>(
  outcome: CollectionOutcome,
  status: S,
): Extract<CollectionOutcome, { status: S }> {
  expect(outcome.status, JSON.stringify(outcome)).toBe(status);
  return outcome as Extract<CollectionOutcome, { status: S }>;
}

function network(response: unknown): CapturedResponse {
  expect((response as CapturedResponse).kind).toBe("NETWORK");
  return response as CapturedResponse;
}

function hostsAndPaths(h: Harness): string[] {
  return h.requests.map((request) => `${request.host}${request.path}`);
}

describe("the declaration", () => {
  it("is a passive, keyless TECHINT domain lookup whose evidence is REPORTED by the registry", () => {
    expect(rdapCollector.declaration).toMatchObject({
      id: "rdap",
      version: "1.0.0",
      displayName: "RDAP registration data",
      discipline: "TECHINT",
      targetTypes: ["DOMAIN"],
      collectionMode: "PASSIVE_API",
      source: "rdap",
      credentials: { vaultIds: [], runsWithout: true },
      claimStrength: "REPORTED",
    });
  });
});

describe("a registered domain: the recorded two-hop lookup of example.com", () => {
  it("follows rdap.org's redirect to the registry and reports exactly what the record states", async () => {
    // Legacy: "extracts registrar (via vcard fn), created/expiration events and nameservers".
    const { outcome, harness: h } = await run(VIA_REDIRECT("verisign-example-com"));
    const found = expectStatus(outcome, "FOUND");
    const expected: RdapResult = {
      ldhName: "EXAMPLE.COM",
      unicodeName: null,
      handle: "2336799_DOMAIN_COM-VRSN",
      status: [
        "client delete prohibited",
        "client transfer prohibited",
        "client update prohibited",
      ],
      registrar: {
        name: "RESERVED-Internet Assigned Numbers Authority",
        handle: "376",
        ianaRegistrarId: "376",
      },
      events: [
        { action: "registration", date: "1995-08-14T04:00:00Z", actor: null },
        { action: "expiration", date: "2027-08-13T04:00:00Z", actor: null },
        { action: "last changed", date: "2026-08-14T08:01:43Z", actor: null },
        { action: "last update of RDAP database", date: "2026-09-28T10:40:43Z", actor: null },
      ],
      // As the registry states them; the legacy adapter lower-cased them.
      nameservers: [
        { ldhName: "ELLIOTT.NS.CLOUDFLARE.COM", unicodeName: null },
        { ldhName: "HERA.NS.CLOUDFLARE.COM", unicodeName: null },
      ],
      delegationSigned: true,
      derived: { respondingHost: "rdap.verisign.com" },
    };
    expect(found.result).toEqual(expected);
    expect(hostsAndPaths(h)).toEqual([
      "rdap.org/domain/example.com",
      "rdap.verisign.com/com/v1/domain/example.com",
    ]);
    expect(h.requests.map((request) => request.headers.accept)).toEqual([
      "application/rdap+json",
      "application/rdap+json",
    ]);
    expect(h.unmatched).toEqual([]);
  });

  it("cites only the registry's response, dated by the registry's own database-update event", async () => {
    // Legacy: "a registered domain with full data produces ... one evidence item".
    const { outcome } = await run(VIA_REDIRECT("verisign-example-com"));
    const found = expectStatus(outcome, "FOUND");
    expect(found.evidence).toHaveLength(1);
    const [item] = found.evidence;
    const response = network(item?.response);
    expect(response.url).toBe(REGISTRY_URL);
    expect(response.status).toBe(200);
    expect(item?.observedAt).toEqual(new Date("2026-09-28T10:40:43Z"));
    // Never the fetch time.
    expect(item?.observedAt?.getTime()).not.toBe(response.receivedAt.getTime());
  });

  it("carries the registry entry's label and claim strength, not anything the collector says", async () => {
    const { outcome, harness: h } = await run(VIA_REDIRECT("verisign-example-com"));
    const found = expectStatus(outcome, "FOUND");
    const entry = h.runtime.registry.entry("rdap");
    expect(entry.label).toBe("RDAP registration data");
    const drafts = evidenceDrafts(entry, found);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      collectorId: "rdap",
      collectorVersion: "1.0.0",
      sourceUrl: REGISTRY_URL,
      claimStrength: "REPORTED",
      observedAt: new Date("2026-09-28T10:40:43Z"),
    });
    expect(new TextDecoder().decode(drafts[0]?.payload)).toBe(
      loadFixture("rdap", "verisign-example-com").response.body,
    );
  });
});

describe("what the record does not state stays absent (legacy cases)", () => {
  it("reports a registrar's handle as its handle, never as its name, when the vCard has none", async () => {
    // Legacy: "falls back to the registrar entity's handle when vcard carries no fn". The
    // fallback put the handle in the name; here each is reported as what it is.
    const { outcome } = await run(VIA_REDIRECT("verisign-example-com-registrar-handle-only"));
    const found = expectStatus(outcome, "FOUND");
    const result = found.result as RdapResult;
    expect(result.registrar).toEqual({
      name: null,
      handle: "[registrar handle]",
      ianaRegistrarId: null,
    });
    expect(result.events).toEqual([]);
    expect(result.nameservers).toEqual([]);
    // The record states no database-update date, so there is none: not the fetch time.
    expect(found.evidence[0]?.observedAt).toBeNull();
  });

  it("leaves registrar null when the record names none, never a guessed or status string", async () => {
    // Legacy: "a record with no registrar entity leaves registrar null — never a guessed
    // string", and "... warns rather than omitting silently": the absence is stated as null.
    const { outcome } = await run(VIA_REDIRECT("verisign-example-com-no-registrar"));
    const found = expectStatus(outcome, "FOUND");
    const result = found.result as RdapResult;
    expect(result).toHaveProperty("registrar", null);
    expect(result).toMatchObject({
      ldhName: "EXAMPLE.COM",
      unicodeName: null,
      handle: null,
      status: null,
      delegationSigned: null,
    });
    // The old news route's inventions (docs/audit/REPORT.md §4).
    expect(JSON.stringify(result)).not.toMatch(/WHOIS|Unknown|Querying registry/i);
    expect(found.evidence[0]?.observedAt).toBeNull();
  });

  it("fails, rather than reporting no registrar, when the registrar's vCard cannot be read", async () => {
    const { outcome } = await run(VIA_REDIRECT("verisign-example-com-malformed-vcard"));
    expect(expectStatus(outcome, "FAILED").error.code).toBe("UPSTREAM_RESPONSE_INVALID");
  });

  it("fails when the record names two registrars, rather than picking one", async () => {
    const { outcome } = await run(VIA_REDIRECT("verisign-example-com-two-registrars"));
    expect(expectStatus(outcome, "FAILED").error.code).toBe("UPSTREAM_RESPONSE_INVALID");
  });
});

describe("not found", () => {
  it("is NOT_FOUND when the registry answers 404, citing that response", async () => {
    // Legacy: "a 404 is a completed 'not registered' finding, never a fabricated registrar",
    // and "an unregistered domain produces a warning naming the 404".
    const target = {
      type: "DOMAIN",
      value: "rdap-fixture-unregistered-name-2026-09-28.com",
    } as const;
    const { outcome, harness: h } = await run(
      ["rdap-org-unregistered-com-redirect", "verisign-unregistered-com"],
      target,
    );
    const notFound = expectStatus(outcome, "NOT_FOUND");
    expect(notFound.detail).toBe(
      "The registry's RDAP server (rdap.verisign.com) has no record of this domain (HTTP 404).",
    );
    const response = network(notFound.response);
    expect(response.status).toBe(404);
    expect(new URL(response.url).hostname).toBe("rdap.verisign.com");
    expect("result" in notFound).toBe(false);
    expect(hostsAndPaths(h)).toEqual([
      "rdap.org/domain/rdap-fixture-unregistered-name-2026-09-28.com",
      "rdap.verisign.com/com/v1/domain/rdap-fixture-unregistered-name-2026-09-28.com",
    ]);
  });

  it("is FAILED, not NOT_FOUND, when rdap.org itself has no RDAP service for the TLD", async () => {
    const { outcome, harness: h } = await run(["rdap-org-no-service-example-tld"], {
      type: "DOMAIN",
      value: "nonexistent.example",
    });
    const failed = expectStatus(outcome, "FAILED");
    expect(failed.error.code).toBe("UPSTREAM_RESPONSE_INVALID");
    expect(failed.error.message).toMatch(/no RDAP registry for this domain's TLD/);
    expect(hostsAndPaths(h)).toEqual(["rdap.org/domain/nonexistent.example"]);
  });
});

describe("a registry the fetcher may not reach", () => {
  it("is an honest FAILED DESTINATION_REFUSED for an http-only registry (.kg), never a record", async () => {
    const { outcome, harness: h } = await run(["rdap-org-example-kg-redirect"], {
      type: "DOMAIN",
      value: "example.kg",
    });
    const failed = expectStatus(outcome, "FAILED");
    expect(failed.error.code).toBe("DESTINATION_REFUSED");
    expect(failed.error.message).toContain("SCHEME_NOT_ALLOWED");
    expect(failed).not.toHaveProperty("result");
    // The redirect was read; the http registry was never contacted.
    expect(hostsAndPaths(h)).toEqual(["rdap.org/domain/example.kg"]);
    expect(h.unmatched).toEqual([]);
  });
});

describe("failures are typed, and never read as a result or as not found", () => {
  it("is FAILED as refused when rdap.org's Cloudflare front blocks the request (403)", async () => {
    const { outcome } = await run(["rdap-org-cloudflare-block"]);
    const failed = expectStatus(outcome, "FAILED");
    expect(failed.error.code).toBe("UPSTREAM_REFUSED");
    expect(failed.error.message).toContain("HTTP 403");
  });

  it("is UNAVAILABLE on a 429, honouring Retry-After in seconds", async () => {
    // Legacy: "a 429 fails with reason rate-limited".
    const { outcome } = await run(["rdap-org-rate-limited"]);
    const unavailable = expectStatus(outcome, "UNAVAILABLE");
    expect(unavailable.error.code).toBe("UPSTREAM_UNAVAILABLE");
    expect(unavailable.retryAfterMs).toBe(120_000);
  });

  it("is UNAVAILABLE on a 5xx, reading an HTTP-date Retry-After against the response's own Date", async () => {
    const { outcome } = await run(["rdap-org-unavailable-retry-after-date"]);
    const unavailable = expectStatus(outcome, "UNAVAILABLE");
    expect(unavailable.error.code).toBe("UPSTREAM_UNAVAILABLE");
    expect(unavailable.retryAfterMs).toBe(120_000);
  });

  it("is UNAVAILABLE with no retry time when the registry's 5xx states none", async () => {
    const { outcome } = await run(VIA_REDIRECT("verisign-example-com-unavailable"));
    const unavailable = expectStatus(outcome, "UNAVAILABLE");
    expect(unavailable.error.message).toContain("rdap.verisign.com answered HTTP 503");
    expect(unavailable.retryAfterMs).toBeNull();
  });

  it.each([
    ["an HTTP 400", "verisign-example-com-bad-request"],
    ["a 200 that is not JSON", "verisign-example-com-not-json"],
    ["a 200 that is not a domain object", "verisign-example-com-not-a-domain"],
    ["a 200 record for a different domain", "verisign-example-com-other-domain"],
  ])("is FAILED as an unusable response on %s", async (_label, fixture) => {
    const { outcome } = await run(VIA_REDIRECT(fixture));
    expect(expectStatus(outcome, "FAILED").error.code).toBe("UPSTREAM_RESPONSE_INVALID");
  });
});

describe("the source's shared rate limit", () => {
  it("covers both hops: the registry hop waits for its slot and the lookup still completes", async () => {
    const h = await start(VIA_REDIRECT("verisign-example-com"), {
      rateLimiter: new MemoryRateLimiter(),
    });
    const started = performance.now();
    expectStatus(await h.run("rdap", EXAMPLE_COM), "FOUND");
    // One request a second for the source: the second hop had to wait.
    expect(performance.now() - started).toBeGreaterThanOrEqual(900);
    expect(h.requests).toHaveLength(2);
  });

  it("is UNAVAILABLE, with nothing sent, when no slot frees up within the fetch's timeout", async () => {
    const h = await start(VIA_REDIRECT("verisign-example-com"), {
      rateLimiter: { acquire: () => Promise.resolve({ allowed: false, retryAfterMs: 120_000 }) },
    });
    const unavailable = expectStatus(await h.run("rdap", EXAMPLE_COM), "UNAVAILABLE");
    expect(unavailable.error.code).toBe("UPSTREAM_RATE_LIMITED");
    expect(unavailable.retryAfterMs).toBe(120_000);
    expect(h.requests).toEqual([]);
  });
});

describe("gates", () => {
  it("is refused, with nothing sent, where unverified sources are not allowed", async () => {
    const h = await start(VIA_REDIRECT("verisign-example-com"), { allowUnverifiedSources: false });
    const refused = expectStatus(await h.run("rdap", EXAMPLE_COM), "REFUSED");
    expect(refused.reason).toBe("UNVERIFIED_SOURCE_NOT_ALLOWED");
    expect(h.requests).toEqual([]);
  });

  it("accepts only domain targets", async () => {
    const h = await start([]);
    const refused = expectStatus(
      await h.run("rdap", { type: "IP_ADDRESS", value: "192.0.2.1" }),
      "REFUSED",
    );
    expect(refused.reason).toBe("TARGET_TYPE_NOT_ACCEPTED");
    expect(h.requests).toEqual([]);
  });
});

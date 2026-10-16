/**
 * The engine's rules in isolation: idempotency keys, retries by cause,
 * circuit verdicts, quota periods, planning with every exclusion reason, the
 * identifier rules ported from legacy entity resolution (with their
 * regressions), and every registered collector's extractor run against its
 * own recorded FOUND fixtures.
 */
import {
  CollectorRegistry,
  CollectorRuntime,
  defineCollector,
  PLATFORM_COLLECTORS,
  type CollectionOutcome,
  type SourceDeclaration,
} from "@repo/collectors";
import { loadFixture, startHarness, type Fixture } from "@repo/collectors/testing";
import { EmptyTargetError, type TargetType } from "@repo/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  circuitVerdict,
  ClaimPathError,
  EXTRACTORS,
  isDerivedPath,
  resolveClaims,
  jobIdempotencyKey,
  periodStart,
  planRun,
  retryDelayMs,
} from "../src/index.ts";
import {
  normaliseDomain,
  normaliseUrl,
  normaliseUsername,
  socialAccountIdentifier,
} from "../src/fusion/identifiers.ts";

// ── Idempotency ───────────────────────────────────────────────────────────

describe("job idempotency keys", () => {
  const base = {
    tenantId: "00000000-0000-4000-8000-000000000001",
    runId: "00000000-0000-4000-8000-000000000002",
    collectorId: "crtsh",
    target: { type: "DOMAIN" as TargetType, value: "example.com" },
    params: { depth: 1, include: ["a", "b"] },
  };

  it("is the same for the same work, whatever the parameters' key order", () => {
    expect(jobIdempotencyKey(base)).toBe(
      jobIdempotencyKey({ ...base, params: { include: ["a", "b"], depth: 1 } }),
    );
    expect(jobIdempotencyKey(base)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it.each([
    ["tenant", { tenantId: "00000000-0000-4000-8000-000000000009" }],
    ["run", { runId: "00000000-0000-4000-8000-000000000009" }],
    ["collector", { collectorId: "dns" }],
    ["target", { target: { type: "DOMAIN", value: "example.net" } as const }],
    ["parameters", { params: { depth: 2, include: ["a", "b"] } }],
  ])("differs when the %s differs", (_name, change) => {
    expect(jobIdempotencyKey({ ...base, ...change })).not.toBe(jobIdempotencyKey(base));
  });
});

// ── Retries and circuits ──────────────────────────────────────────────────

describe("retry delays", () => {
  const policy = { maxAttempts: 5, baseDelayMs: 1_000, maxDelayMs: 8_000 };

  it("doubles per attempt, capped, with at most a fifth added", () => {
    expect(retryDelayMs(policy, 1, null, () => 0)).toBe(1_000);
    expect(retryDelayMs(policy, 3, null, () => 0)).toBe(4_000);
    expect(retryDelayMs(policy, 10, null, () => 0)).toBe(8_000);
    expect(retryDelayMs(policy, 3, null, () => 1)).toBe(4_800);
  });

  it("never retries sooner than the upstream asked", () => {
    expect(retryDelayMs(policy, 1, 60_000, () => 0)).toBe(60_000);
  });
});

describe("what an outcome says about its source's health", () => {
  const outcome = (status: string, code: string | null): CollectionOutcome =>
    (code === null
      ? { status, collectorId: "x", detail: "[x]", result: null, evidence: [], response: null }
      : {
          status,
          collectorId: "x",
          error: { code, message: "[x]" },
          retryAfterMs: null,
        }) as CollectionOutcome;

  it.each([
    ["FOUND", null, "SUCCESS"],
    ["NOT_FOUND", null, "SUCCESS"],
    // The source answered; that its empty answer cannot be trusted says nothing of its health.
    ["EMPTY_UNCONFIRMED", null, "SUCCESS"],
    ["UNAVAILABLE", "UPSTREAM_UNAVAILABLE", "FAILURE"],
    ["UNAVAILABLE", "UPSTREAM_TIMEOUT", "FAILURE"],
    ["UNAVAILABLE", "COLLECTOR_TIMEOUT", "FAILURE"],
    ["FAILED", "UPSTREAM_RESPONSE_INVALID", "FAILURE"],
    // A rate limit is the source working as designed.
    ["UNAVAILABLE", "UPSTREAM_RATE_LIMITED", "NEUTRAL"],
    // A refusal, a missing credential or a bad target says nothing about the source.
    ["FAILED", "UPSTREAM_REFUSED", "NEUTRAL"],
    ["FAILED", "TARGET_INVALID", "NEUTRAL"],
  ])("%s %s is %s", (status, code, verdict) => {
    expect(circuitVerdict(outcome(status, code))).toBe(verdict);
  });
});

describe("quota periods", () => {
  it("start at the UTC day and month", () => {
    const now = new Date("2026-09-30T23:59:59.999Z");
    expect(periodStart("DAY", now).toISOString()).toBe("2026-09-30T00:00:00.000Z");
    expect(periodStart("MONTH", now).toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });
});

// ── Planning ──────────────────────────────────────────────────────────────

function source(
  id: string,
  commercialUse: "PERMITTED" | "BLOCKED" | "UNVERIFIED",
): SourceDeclaration {
  return {
    id,
    name: `[Source ${id}]`,
    licence: {
      commercialUse,
      reason: "[test]",
      check:
        commercialUse === "UNVERIFIED"
          ? null
          : {
              checkedOn: "2026-09-30",
              sourceUrl: "https://example.com/terms",
              recordedIn: "[test]",
            },
    },
    network: {
      protocol: "https",
      hosts: [`${id}.example`],
      rateLimit: { requests: 1, intervalSeconds: 1, basis: "SELF_IMPOSED", note: "[test]" },
      operators: [{ name: "fake", hosts: [`${id}.example`] }],
    },
    attribution: null,
  };
}

const NAMES = z.object({ names: z.array(z.string()), derived: z.object({}) });
const fake = (
  id: string,
  sourceId: string,
  declared: {
    readonly targetTypes: TargetType[];
    readonly discipline: "TECHINT" | "MEDIAINT" | "PERSON";
    readonly mode: "PASSIVE_API" | "ACTIVE";
  },
) =>
  defineCollector(
    {
      id,
      version: "1.0.0",
      displayName: `[fake ${id}]`,
      discipline: declared.discipline,
      targetTypes: declared.targetTypes,
      collectionMode: declared.mode,
      source: sourceId,
      credentials: { vaultIds: [], runsWithout: true },
      claimStrength: "REPORTED",
      timeoutMs: 1_000,
      resultSchema: NAMES,
    },
    () => Promise.reject(new Error("planning never runs a collector")),
  );

/** A passive TECHINT collector of domains: what each fake is, unless it says otherwise. */
const PASSIVE_DOMAIN = {
  targetTypes: ["DOMAIN"] as TargetType[],
  discipline: "TECHINT",
  mode: "PASSIVE_API",
} as const;

const runtime = new CollectorRuntime({
  registry: new CollectorRegistry({
    sources: [
      source("open", "PERMITTED"),
      source("blocked", "BLOCKED"),
      source("unchecked", "UNVERIFIED"),
    ],
    collectors: [
      fake("fake.domain", "open", PASSIVE_DOMAIN),
      fake("fake.username", "open", { ...PASSIVE_DOMAIN, targetTypes: ["USERNAME"] }),
      fake("fake.blocked", "blocked", PASSIVE_DOMAIN),
      fake("fake.unverified", "unchecked", PASSIVE_DOMAIN),
      fake("fake.person", "open", { ...PASSIVE_DOMAIN, discipline: "PERSON" }),
      fake("fake.active", "open", { ...PASSIVE_DOMAIN, mode: "ACTIVE" }),
    ],
  }),
  allowUnverifiedSources: false,
  network: { rateLimiter: { acquire: () => Promise.resolve({ allowed: true }) } },
});

const TECHINT = { plan: "TECHINT", vettingStatus: "NOT_SUBMITTED" } as const;

describe("planning a run", () => {
  it("plans what may run, and records every exclusion with its reason", async () => {
    const plan = await planRun(runtime, {
      input: "Example.COM",
      requestedType: null,
      entitlement: TECHINT,
      scopeFor: () => Promise.resolve(null),
    });
    expect(plan.detected).toEqual({ primaryType: "DOMAIN", alternateTypes: [] });
    expect(plan.targets).toEqual([{ type: "DOMAIN", value: "example.com" }]);
    expect(plan.jobs).toEqual([
      { collectorId: "fake.domain", target: { type: "DOMAIN", value: "example.com" } },
    ]);
    expect(Object.fromEntries(plan.excluded.map((e) => [e.collectorId, e.reason]))).toEqual({
      "fake.username": "TARGET_TYPE_NOT_ACCEPTED",
      "fake.blocked": "LICENCE_BLOCKED",
      "fake.unverified": "UNVERIFIED_SOURCE_NOT_ALLOWED",
      "fake.person": "MODULE_NOT_IN_PLAN",
      "fake.active": "SCOPE_AUTHORISATION_REQUIRED",
    });
  });

  it("runs an ACTIVE collector only with a scope authorisation for the exact target", async () => {
    const plan = await planRun(runtime, {
      input: "example.com",
      requestedType: "DOMAIN",
      entitlement: TECHINT,
      scopeFor: (target) =>
        Promise.resolve(
          target.value === "example.com"
            ? {
                id: "00000000-0000-4000-8000-00000000000a",
                targetType: "DOMAIN",
                target: "example.com",
              }
            : null,
        ),
    });
    expect(plan.jobs.map((job) => job.collectorId)).toContain("fake.active");
  });

  it("plans an ambiguous input under each plausible type, once per collector", async () => {
    const plan = await planRun(runtime, {
      input: "octocat",
      requestedType: null,
      entitlement: TECHINT,
      scopeFor: () => Promise.resolve(null),
    });
    expect(plan.detected).toEqual({ primaryType: "USERNAME", alternateTypes: ["ORGANIZATION"] });
    expect(plan.jobs).toEqual([
      { collectorId: "fake.username", target: { type: "USERNAME", value: "octocat" } },
    ]);
  });

  it("records an input that is not the requested type, and plans nothing on it", async () => {
    const plan = await planRun(runtime, {
      input: "not a domain",
      requestedType: "DOMAIN",
      entitlement: TECHINT,
      scopeFor: () => Promise.resolve(null),
    });
    expect(plan.targets).toEqual([{ type: "DOMAIN", invalid: expect.any(String) as string }]);
    expect(plan.jobs).toEqual([]);
  });

  it("refuses an empty input, rather than guessing a type for it", async () => {
    await expect(
      planRun(runtime, {
        input: "   ",
        requestedType: null,
        entitlement: TECHINT,
        scopeFor: () => Promise.resolve(null),
      }),
    ).rejects.toBeInstanceOf(EmptyTargetError);
  });
});

describe("planning a TOPIC: person data whatever collects it (RELEASE-BLOCKING)", () => {
  // A news collector, not a person one, that takes an organisation's name or a topic.
  const newsRuntime = new CollectorRuntime({
    registry: new CollectorRegistry({
      sources: [source("open", "PERMITTED")],
      collectors: [
        fake("fake.news", "open", {
          ...PASSIVE_DOMAIN,
          discipline: "MEDIAINT",
          targetTypes: ["ORGANIZATION", "TOPIC"],
        }),
      ],
    }),
    allowUnverifiedSources: false,
    network: { rateLimiter: { acquire: () => Promise.resolve({ allowed: true }) } },
  });
  const plan = (
    input: string,
    requestedType: TargetType | null,
    entitlement: {
      readonly plan: "TECHINT" | "TECHINT_AND_PERSON";
      readonly vettingStatus: "NOT_SUBMITTED" | "APPROVED" | "SUSPENDED";
    },
  ) =>
    planRun(newsRuntime, {
      input,
      requestedType,
      entitlement,
      scopeFor: () => Promise.resolve(null),
    });
  const ENTITLED = { plan: "TECHINT_AND_PERSON", vettingStatus: "APPROVED" } as const;
  const SUSPENDED = { plan: "TECHINT_AND_PERSON", vettingStatus: "SUSPENDED" } as const;

  it("refuses a chosen TOPIC without the plan or the vetting, as it refuses a PERSON collector", async () => {
    for (const [entitlement, reason] of [
      [TECHINT, "MODULE_NOT_IN_PLAN"],
      [SUSPENDED, "VETTING_NOT_APPROVED"],
    ] as const) {
      const refused = await plan("[a subject]", "TOPIC", entitlement);
      expect(refused.jobs).toEqual([]);
      expect(refused.excluded).toEqual([
        {
          collectorId: "fake.news",
          targetType: "TOPIC",
          reason,
          message: expect.stringMatching(/TOPIC target may name a person/) as string,
        },
      ]);
    }
    expect((await plan("[a subject]", "TOPIC", ENTITLED)).jobs).toEqual([
      { collectorId: "fake.news", target: { type: "TOPIC", value: "[a subject]" } },
    ]);
  });

  it("plans a TOPIC detected first (a hashtag) only for an entitled tenant", async () => {
    const refused = await plan("#elections", null, TECHINT);
    expect(refused.detected).toEqual({ primaryType: "TOPIC", alternateTypes: [] });
    expect(refused.jobs).toEqual([]);
    expect(refused.excluded.map((row) => row.reason)).toEqual(["MODULE_NOT_IN_PLAN"]);
    expect((await plan("#elections", null, ENTITLED)).jobs).toEqual([
      { collectorId: "fake.news", target: { type: "TOPIC", value: "#elections" } },
    ]);
  });

  it("never plans a TOPIC that detection offers only as an alternate, even for an entitled tenant", async () => {
    for (const entitlement of [TECHINT, ENTITLED]) {
      const planned = await plan("[two words]", null, entitlement);
      // Detection reports the alternate; the plan considers only the organisation's name.
      expect(planned.detected).toEqual({ primaryType: "ORGANIZATION", alternateTypes: ["TOPIC"] });
      expect(planned.targets).toEqual([{ type: "ORGANIZATION", value: "[two words]" }]);
      expect(planned.jobs).toEqual([
        { collectorId: "fake.news", target: { type: "ORGANIZATION", value: "[two words]" } },
      ]);
      // And the plan says so: what it left out, and why, never silently.
      expect(planned.notPlanned).toEqual([
        {
          type: "TOPIC",
          reason: "NOT_PLANNED_UNLESS_CHOSEN",
          message: expect.stringMatching(/^Not planned unless chosen: .*person data/) as string,
        },
      ]);
    }
    // A chosen or detected-first TOPIC leaves nothing out.
    expect((await plan("[a subject]", "TOPIC", ENTITLED)).notPlanned).toEqual([]);
    expect((await plan("#elections", null, ENTITLED)).notPlanned).toEqual([]);
  });
});

// ── Identifiers (legacy entity resolution, KEEP with three fixes) ─────────

describe("identifier rules", () => {
  it("normalises domains, keeping www as a different name", () => {
    expect(normaliseDomain(" Example.COM. ")).toBe("example.com");
    expect(normaliseDomain("www.example.com")).not.toBe(normaliseDomain("example.com"));
  });

  it("regression: keeps a username's case (legacy lower-cased it, merging distinct Hacker News accounts)", () => {
    expect(normaliseUsername("@PG")).toBe("PG");
    expect(socialAccountIdentifier("hackernews", "PG")).not.toBe(
      socialAccountIdentifier("hackernews", "pg"),
    );
    // Platforms whose handles are case-insensitive still resolve one account.
    expect(socialAccountIdentifier("github", "OctoCat")).toBe(
      socialAccountIdentifier("github", "octocat"),
    );
  });

  it("regression: gives an unparseable URL no identifier (legacy merged on its lower-cased text)", () => {
    expect(normaliseUrl("not a url")).toBeNull();
    expect(normaliseUrl("HTTPS://Example.COM/path/?q=1#frag")).toBe("https://example.com/path?q=1");
  });

  it("regression: invents no confidence (legacy scored merges 0.5 + 0.15 per extra source)", async () => {
    const source = await import("../src/fusion/identifiers.ts");
    expect(Object.keys(source).some((name) => /confidence|score/i.test(name))).toBe(false);
  });
});

// ── Every extractor, against its collector's recorded FOUND fixtures ──────

const FOUND_CASES: readonly {
  readonly collectorId: string;
  readonly target: { readonly type: TargetType; readonly value: string };
  readonly fixtures: readonly Fixture[];
}[] = [
  {
    collectorId: "crtsh",
    target: { type: "DOMAIN", value: "example.com" },
    fixtures: [loadFixture("crtsh", "found-example-com")],
  },
  {
    collectorId: "dns",
    target: { type: "DOMAIN", value: "example.com" },
    fixtures: [loadFixture("dns", "found-example-com")],
  },
  {
    collectorId: "rdap",
    target: { type: "DOMAIN", value: "example.com" },
    fixtures: [
      loadFixture("rdap", "rdap-org-example-com-redirect"),
      loadFixture("rdap", "verisign-example-com"),
    ],
  },
  {
    collectorId: "wayback",
    target: { type: "DOMAIN", value: "example.net" },
    fixtures: [loadFixture("wayback", "domain-capped")],
  },
  {
    collectorId: "contact.phone",
    target: { type: "PHONE_NUMBER", value: "+442079460000" },
    fixtures: [],
  },
  {
    collectorId: "wikidata",
    target: { type: "ORGANIZATION", value: "Internet Assigned Numbers Authority" },
    fixtures: [loadFixture("wikidata", "search-iana"), loadFixture("wikidata", "entities-iana")],
  },
  {
    collectorId: "github",
    target: { type: "USERNAME", value: "octocat" },
    fixtures: ["user-octocat", "repos-octocat", "commits-octocat"].map((name) =>
      loadFixture("github", name),
    ),
  },
  {
    collectorId: "hackernews",
    target: { type: "USERNAME", value: "fixture-user" },
    fixtures: [loadFixture("hackernews", "user-found"), loadFixture("hackernews", "search-found")],
  },
  {
    collectorId: "devto",
    target: { type: "USERNAME", value: "thepracticaldev" },
    fixtures: [loadFixture("devto", "user-thepracticaldev")],
  },
  {
    collectorId: "commoncrawl",
    target: { type: "DOMAIN", value: "iana.org" },
    fixtures: [loadFixture("commoncrawl", "collinfo"), loadFixture("commoncrawl", "cdx-iana")],
  },
];

/**
 * Extractors that check a FOUND result and draw nothing from it yet; the
 * evidence is kept and cited. news: articles become items in Track M's item
 * extractors, and until then no claim, and no count, is made from a list.
 */
const NOTHING_DRAWN_CASES: readonly {
  readonly collectorId: string;
  readonly target: { readonly type: TargetType; readonly value: string };
  readonly fixtures: readonly Fixture[];
}[] = [
  {
    collectorId: "news",
    target: { type: "TOPIC", value: "climate change" },
    fixtures: [loadFixture("news", "found")],
  },
  {
    collectorId: "news",
    target: { type: "DOMAIN", value: "example.net" },
    fixtures: [loadFixture("news", "domain-found")],
  },
];

describe("extractors", () => {
  it("every registered platform collector has one, and nothing else does", () => {
    expect(Object.keys(EXTRACTORS).sort()).toEqual(
      PLATFORM_COLLECTORS.map((collector) => collector.declaration.id).sort(),
    );
    const cased = new Set([...FOUND_CASES, ...NOTHING_DRAWN_CASES].map((c) => c.collectorId));
    expect([...cased].sort()).toEqual(Object.keys(EXTRACTORS).sort());
  });

  it.each(NOTHING_DRAWN_CASES)(
    "$collectorId on a $target.type: checks the result and draws nothing yet, so no entity, claim or count",
    async (testCase) => {
      const harness = await startHarness({
        collectors: PLATFORM_COLLECTORS.filter((c) => c.declaration.id === testCase.collectorId),
        fixtures: testCase.fixtures,
      });
      try {
        const outcome = await harness.run(testCase.collectorId, testCase.target);
        expect(outcome.status, JSON.stringify(outcome)).toBe("FOUND");
        if (outcome.status !== "FOUND") return;
        const extract = EXTRACTORS[testCase.collectorId];
        if (extract === undefined) throw new Error("no extractor");
        // A TOPIC has no entity kind: the extractor never asks for the target's entity.
        expect(extract({ target: testCase.target, result: outcome.result })).toEqual({
          entities: [],
          relationships: [],
          claims: [],
        });
        // What it is given is checked, as every extractor checks it.
        expect(() => extract({ target: testCase.target, result: { articles: [] } })).toThrow();
      } finally {
        await harness.close();
      }
    },
  );

  it.each(FOUND_CASES)(
    "$collectorId: every claim cites real evidence, names known entities, and takes its strength from its path",
    async (testCase) => {
      const harness = await startHarness({
        collectors: PLATFORM_COLLECTORS.filter((c) => c.declaration.id === testCase.collectorId),
        fixtures: testCase.fixtures,
      });
      try {
        const outcome = await harness.run(testCase.collectorId, testCase.target);
        expect(outcome.status, JSON.stringify(outcome)).toBe("FOUND");
        if (outcome.status !== "FOUND") return;
        const extract = EXTRACTORS[testCase.collectorId];
        if (extract === undefined) throw new Error("no extractor");
        const extraction = extract({ target: testCase.target, result: outcome.result });
        const entityKeys = new Set(extraction.entities.map((e) => e.key));
        const relationshipKeys = new Set(extraction.relationships.map((r) => r.key));
        expect(extraction.claims.length).toBeGreaterThan(0);
        for (const claim of extraction.claims) {
          expect(claim.evidence).toBeGreaterThanOrEqual(0);
          expect(claim.evidence).toBeLessThan(outcome.evidence.length);
          expect(claim.attribute).toMatch(/^[a-z][a-z0-9_]*$/);
          if ("entity" in claim.subject) {
            expect(entityKeys.has(claim.subject.entity)).toBe(true);
          } else {
            expect(relationshipKeys.has(claim.subject.relationship)).toBe(true);
          }
        }
        // Resolved as fusion resolves them: every path exists in the result.
        const resolved = resolveClaims(extraction.claims, outcome.result, "REPORTED");
        expect(resolved.length).toBeGreaterThan(0);
        const byDraft = extraction.claims.filter((claim) =>
          resolved.some((r) => r.subject === claim.subject && r.attribute === claim.attribute),
        );
        expect(byDraft.length).toBe(resolved.length);
        for (const claim of resolved) {
          if ("entity" in claim.subject) expect(claim.value).not.toBeNull();
          // A reported value never carries a computed field along with it.
          if (claim.strength !== "DERIVED")
            expect(JSON.stringify(claim.value)).not.toContain('"derived"');
        }
        extraction.claims.forEach((claim) => {
          const match = resolved.find(
            (r) => r.subject === claim.subject && r.attribute === claim.attribute,
          );
          if (match !== undefined && isDerivedPath(claim.path))
            expect(match.strength).toBe("DERIVED");
        });
        for (const entity of extraction.entities) {
          if (entity.kind === "PERSON" || entity.kind === "ORGANIZATION") {
            // Never a bare name: only an external registry's namespaced id.
            if (entity.identifier !== null) expect(entity.identifier).toMatch(/^[a-z]+:[^ ]+$/);
          }
        }
      } finally {
        await harness.close();
      }
    },
  );
});

// ── Claim strength from the derived contract (Phase 5) ────────────────────

describe("claim strength is decided by where the value is, never by the extractor", () => {
  const result = {
    count: 3,
    captures: [{ timestamp: "[raw timestamp]", derived: { capturedAt: "[parsed date]" } }],
    derived: { count: 3, note: "[computed note]" },
  };
  const subject = { entity: "DOMAIN|example.com" };

  it("makes a value inside `derived` DERIVED, even when it equals a reported value", () => {
    const [inside, outside] = resolveClaims(
      [
        { subject, attribute: "count", path: ["derived", "count"], evidence: 0 },
        { subject, attribute: "count", path: ["count"], evidence: 0 },
      ],
      result,
      "REPORTED",
    );
    expect(inside).toMatchObject({ value: 3, strength: "DERIVED" });
    expect(outside).toMatchObject({ value: 3, strength: "REPORTED" });
  });

  it("strips a nested `derived` block from a reported value", () => {
    const [capture] = resolveClaims(
      [{ subject, attribute: "capture", path: ["captures", 0], evidence: 0 }],
      result,
      "OBSERVED",
    );
    expect(capture).toMatchObject({
      value: { timestamp: "[raw timestamp]" },
      strength: "OBSERVED",
    });
  });

  it("gives a relationship claim no value, and its basis's strength", () => {
    const [relationship] = resolveClaims(
      [
        {
          subject: { relationship: "a>b" },
          attribute: "linked",
          path: ["derived", "note"],
          evidence: 0,
        },
      ],
      result,
      "REPORTED",
    );
    expect(relationship).toMatchObject({ value: null, strength: "DERIVED" });
  });

  it("drops a claim whose value is null: absence asserts nothing", () => {
    expect(
      resolveClaims(
        [{ subject, attribute: "gone", path: ["missing"], evidence: 0 }],
        { missing: null },
        "REPORTED",
      ),
    ).toEqual([]);
  });

  it("refuses a path the result does not have", () => {
    expect(() =>
      resolveClaims(
        [{ subject, attribute: "x", path: ["captures", 5] }].map((c) => ({ ...c, evidence: 0 })),
        result,
        "REPORTED",
      ),
    ).toThrow(ClaimPathError);
  });

  it("offers an extractor no way to supply a value or a strength", () => {
    // The draft type has no value or strength: resolveClaims is the only source of both.
    const draft = { subject, attribute: "count", path: ["count"], evidence: 0 } as const;
    expect(Object.keys(draft).sort()).toEqual(["attribute", "evidence", "path", "subject"]);
  });
});

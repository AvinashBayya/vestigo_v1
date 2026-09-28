/**
 * RELEASE-BLOCKING. The collector frame's guarantees, with fake in-memory
 * collectors (test code only) against a real HTTP server on loopback:
 *   - a BLOCKED collector cannot be executed by any path;
 *   - UNVERIFIED sources are refused where configuration does not allow them;
 *   - a collector cannot set, override or influence its source label, and two
 *     collectors on different upstreams produce distinguishable evidence;
 *   - collectors sharing an upstream share its rate limit;
 *   - ACTIVE needs a scope authorisation, PERSON needs plan and vetting;
 *   - a failure never becomes FOUND, an empty result, or evidence.
 */
import { allowsUnverifiedSources } from "@repo/config";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { registryInternals } from "../src/registry.ts";
import * as sdk from "../src/index.ts";
import {
  CollectorRegistry,
  CollectorRuntime,
  defineCollector,
  evidenceDrafts,
  foundBy,
  parseTarget,
  tenantRegistration,
  type CollectionOutcome,
  type Collector,
  type CollectorDeclaration,
  type CollectorImplementation,
  type CollectorReturn,
  type FoundOutcome,
  type SourceDeclaration,
} from "../src/index.ts";
import {
  ENTITLED,
  MemoryRateLimiter,
  NAMES_SCHEMA,
  startUpstream,
  testNetwork,
  testSource,
  type TestUpstream,
} from "./support.ts";

let upstream: TestUpstream;
const routes = new Map<string, (res: import("node:http").ServerResponse) => void>();

beforeAll(async () => {
  upstream = await startUpstream((req, res) => {
    const route = routes.get(`${req.headers.host ?? ""}${req.url ?? ""}`);
    if (route === undefined) res.writeHead(404).end("{}");
    else route(res);
  });
});

afterEach(() => {
  routes.clear();
  upstream.requests.length = 0;
});

afterAll(async () => {
  await upstream.close();
});

const BLOCKED_SOURCE = testSource("blocked", {
  licence: {
    commercialUse: "BLOCKED",
    reason: "[non-commercial licence]",
    check: { checkedOn: "2026-09-28", sourceUrl: null, recordedIn: "[test]" },
  },
});
const UNVERIFIED_SOURCE = testSource("unverified", {
  licence: { commercialUse: "UNVERIFIED", reason: "[terms not checked]", check: null },
});
const SOURCES: SourceDeclaration[] = [
  testSource("one"),
  testSource("two"),
  BLOCKED_SOURCE,
  UNVERIFIED_SOURCE,
];

function declaration(
  id: string,
  source: string,
  overrides: Partial<CollectorDeclaration<typeof NAMES_SCHEMA>> = {},
): CollectorDeclaration<typeof NAMES_SCHEMA> {
  return {
    id,
    version: "1.2.3",
    displayName: `[${id}]`,
    discipline: "TECHINT",
    targetTypes: ["DOMAIN"],
    collectionMode: "PASSIVE_API",
    source,
    credentials: { vaultIds: [], runsWithout: true },
    claimStrength: "REPORTED",
    timeoutMs: 3_000,
    resultSchema: NAMES_SCHEMA,
    ...overrides,
  };
}

/** A fake collector that reads its source and reports the names it finds. */
function namesFrom(
  host: string,
  calls: { count: number } = { count: 0 },
): CollectorImplementation<{ names: string[] }> {
  return async (ctx) => {
    calls.count += 1;
    const response = await ctx.fetch(`http://${host}/names?q=${ctx.target.value}`, {
      method: "GET",
      timeoutMs: 1_000,
    });
    if (response.status === 404) return ctx.notFound(response, "no names for this target");
    const names = z.array(z.string()).parse(response.json());
    return ctx.found({ names }, [{ response, observedAt: null }]);
  };
}

function runtimeWith(
  collectors: Collector[],
  options: { allowUnverifiedSources?: boolean; rateLimiter?: MemoryRateLimiter } = {},
): CollectorRuntime {
  return new CollectorRuntime({
    registry: new CollectorRegistry({ sources: SOURCES, collectors }),
    allowUnverifiedSources: options.allowUnverifiedSources ?? true,
    network: testNetwork(upstream, {
      answers: {
        "one.test": ["1.1.1.1"],
        "two.test": ["1.1.1.1"],
        "blocked.test": ["1.1.1.1"],
        "unverified.test": ["1.1.1.1"],
      },
      ...(options.rateLimiter === undefined ? {} : { rateLimiter: options.rateLimiter }),
    }),
  });
}

const DOMAIN = parseTarget("DOMAIN", "example.com");
const request = (overrides: Partial<sdk.DispatchRequest> = {}): sdk.DispatchRequest => ({
  target: DOMAIN,
  entitlement: ENTITLED,
  scopeAuthorisation: null,
  credentials: new Map(),
  ...overrides,
});

function expectStatus<S extends CollectionOutcome["status"]>(
  outcome: CollectionOutcome,
  status: S,
): Extract<CollectionOutcome, { status: S }> {
  expect(outcome.status, JSON.stringify(outcome)).toBe(status);
  return outcome as Extract<CollectionOutcome, { status: S }>;
}

describe("a BLOCKED collector cannot be executed by any path (RELEASE-BLOCKING)", () => {
  const calls = { count: 0 };
  const blocked = defineCollector(
    declaration("fake.blocked", "blocked"),
    namesFrom("blocked.test", calls),
  );

  it("is refused by the runtime, however the request is dressed up, and its code never runs", async () => {
    routes.set("blocked.test/names?q=example.com", (res) => res.end('["leaked"]'));
    const runtime = runtimeWith([blocked], { allowUnverifiedSources: true });
    const outcome = expectStatus(await runtime.execute("fake.blocked", request()), "REFUSED");
    expect(outcome.reason).toBe("LICENCE_BLOCKED");
    expect(outcome.message).toContain("[non-commercial licence]");
    expect(runtime.admit("fake.blocked", request())).toMatchObject({ reason: "LICENCE_BLOCKED" });
    expect(calls.count).toBe(0);
    expect(upstream.requests).toEqual([]);
  });

  it("is listed with its reason, but its implementation is never stored", () => {
    const registry = new CollectorRegistry({ sources: SOURCES, collectors: [blocked] });
    expect(registry.entry("fake.blocked").availability).toBe("BLOCKED");
    expect(registryInternals(registry).implementations.has("fake.blocked")).toBe(false);
  });

  it("exposes nothing callable, and the package exports nothing that reaches an implementation", () => {
    expect(Object.keys(blocked)).toEqual(["declaration"]);
    expect(
      Object.values(blocked.declaration).filter((value) => typeof value === "function"),
    ).toEqual([]);
    expect("run" in blocked).toBe(false);
    for (const internal of [
      "implementationOf",
      "registryInternals",
      "makeReturn",
      "capturedPayload",
    ]) {
      expect(Object.keys(sdk)).not.toContain(internal);
    }
  });

  it("can never have evidence drafted for it, even from a forged outcome", () => {
    const registry = new CollectorRegistry({ sources: SOURCES, collectors: [blocked] });
    const forged = {
      status: "FOUND",
      collectorId: "fake.blocked",
      result: { names: ["x"] },
      evidence: [],
    } as FoundOutcome;
    expect(() => evidenceDrafts(registry.entry("fake.blocked"), forged)).toThrow(
      sdk.CollectorDefinitionError,
    );
    expect(tenantRegistration(registry.entry("fake.blocked"))).toMatchObject({
      enabled: false,
      commercialUse: "BLOCKED",
    });
  });
});

describe("UNVERIFIED sources follow configuration (RELEASE-BLOCKING)", () => {
  const unverified = defineCollector(
    declaration("fake.unverified", "unverified"),
    namesFrom("unverified.test"),
  );

  it("is refused when the production flag is set, and runs where it is allowed", async () => {
    routes.set("unverified.test/names?q=example.com", (res) => res.end('["a"]'));
    const production = allowsUnverifiedSources({
      NODE_ENV: "production",
      COLLECTORS_ALLOW_UNVERIFIED: undefined,
    });
    expect(production).toBe(false);
    const refused = expectStatus(
      await runtimeWith([unverified], { allowUnverifiedSources: production }).execute(
        "fake.unverified",
        request(),
      ),
      "REFUSED",
    );
    expect(refused.reason).toBe("UNVERIFIED_SOURCE_NOT_ALLOWED");
    expect(upstream.requests).toEqual([]);

    const development = allowsUnverifiedSources({
      NODE_ENV: "development",
      COLLECTORS_ALLOW_UNVERIFIED: undefined,
    });
    expectStatus(
      await runtimeWith([unverified], { allowUnverifiedSources: development }).execute(
        "fake.unverified",
        request(),
      ),
      "FOUND",
    );
  });
});

describe("a collector cannot set or alter its source label (RELEASE-BLOCKING)", () => {
  it("has no way to state one: declarations, found() and return values reject it at compile time", () => {
    const blockedAtCompileTime = () => {
      defineCollector(
        // @ts-expect-error: a declaration has no source label field; the registry entry supplies it
        { ...declaration("fake.labelled", "one"), sourceLabel: "crt.sh" },
        namesFrom("one.test"),
      );
      defineCollector(declaration("fake.extra-arg", "one"), async (ctx) => {
        const response = await ctx.fetch("http://one.test/names", {
          method: "GET",
          timeoutMs: 500,
        });
        // @ts-expect-error: found() takes a result and its evidence, nothing that could carry a label
        return ctx.found({ names: ["a"] }, [{ response, observedAt: null }], {
          sourceLabel: "crt.sh",
        });
      });
      // @ts-expect-error: a collector cannot build its own return value; only found() and notFound() can make one
      defineCollector(declaration("fake.hand-built", "one"), async (ctx) => {
        const response = await ctx.fetch("http://one.test/names", {
          method: "GET",
          timeoutMs: 500,
        });
        return {
          kind: "FOUND",
          result: { names: ["a"] },
          evidence: [{ response, observedAt: null }],
          sourceLabel: "crt.sh",
        };
      });
    };
    expect(typeof blockedAtCompileTime).toBe("function");
  });

  it("gets its label from the registry, whatever its code does at run time", async () => {
    routes.set("one.test/names?q=example.com", (res) => res.end('["a"]'));
    const smuggler = defineCollector(declaration("fake.smuggler", "one"), async (ctx) => {
      const response = await ctx.fetch("http://one.test/names?q=example.com", {
        method: "GET",
        timeoutMs: 1_000,
      });
      return {
        kind: "FOUND",
        result: { names: ["a"] },
        evidence: [{ response, observedAt: null }],
        sourceLabel: "crt.sh",
      } as unknown as CollectorReturn<{ names: string[] }>;
    });
    const mutator = defineCollector(declaration("fake.mutator", "one"), async (ctx) => {
      const response = await ctx.fetch("http://one.test/names?q=example.com", {
        method: "GET",
        timeoutMs: 1_000,
      });
      const returned = ctx.found({ names: ["a"] }, [{ response, observedAt: null }]);
      Object.assign(returned, { sourceLabel: "crt.sh" });
      return returned;
    });
    const runtime = runtimeWith([smuggler, mutator]);

    const smuggled = expectStatus(await runtime.execute("fake.smuggler", request()), "FAILED");
    expect(smuggled.error.code).toBe("COLLECTOR_CONTRACT_VIOLATION");
    // The return value is frozen: an attempt to add a label fails the run.
    expectStatus(await runtime.execute("fake.mutator", request()), "FAILED");

    expect(tenantRegistration(runtime.registry.entry("fake.smuggler")).sourceLabel).toBe(
      "[fake.smuggler]",
    );
  });

  it("two collectors on different upstreams produce distinguishable evidence", async () => {
    routes.set("one.test/names?q=example.com", (res) => res.end('["from-one"]'));
    routes.set("two.test/names?q=example.com", (res) => res.end('["from-two"]'));
    const runtime = runtimeWith([
      defineCollector(declaration("fake.one", "one"), namesFrom("one.test")),
      defineCollector(declaration("fake.two", "two"), namesFrom("two.test")),
    ]);
    const drafts = [];
    for (const id of ["fake.one", "fake.two"]) {
      const found = expectStatus(await runtime.execute(id, request()), "FOUND");
      drafts.push(...evidenceDrafts(runtime.registry.entry(id), found));
    }
    expect(drafts.map((draft) => [draft.collectorId, new URL(draft.sourceUrl).host])).toEqual([
      ["fake.one", "one.test"],
      ["fake.two", "two.test"],
    ]);
    expect(
      ["fake.one", "fake.two"].map(
        (id) => tenantRegistration(runtime.registry.entry(id)).sourceLabel,
      ),
    ).toEqual(["[fake.one]", "[fake.two]"]);
  });

  it("cannot fall back to another upstream inside itself", async () => {
    routes.set("two.test/names?q=example.com", (res) => res.end('["from-two"]'));
    const fallback = defineCollector(declaration("fake.fallback", "one"), async (ctx) => {
      const response = await ctx.fetch("http://two.test/names?q=example.com", {
        method: "GET",
        timeoutMs: 1_000,
      });
      return ctx.found({ names: ["from-two"] }, [{ response, observedAt: null }]);
    });
    const outcome = expectStatus(
      await runtimeWith([fallback]).execute("fake.fallback", request()),
      "FAILED",
    );
    expect(outcome.error.code).toBe("DESTINATION_REFUSED");
    expect(upstream.requests).toEqual([]);
  });
});

describe("collectors sharing an upstream share its rate limit (RELEASE-BLOCKING)", () => {
  it("throttles the second collector on the same upstream, and not one on another upstream", async () => {
    routes.set("one.test/names?q=example.com", (res) => res.end('["a"]'));
    routes.set("two.test/names?q=example.com", (res) => res.end('["b"]'));
    const strictOne = testSource("one", {
      network: {
        protocol: "http",
        hosts: ["one.test"],
        rateLimit: { requests: 1, intervalSeconds: 5, basis: "UPSTREAM_STATED", note: "[test]" },
      },
    });
    const runtime = new CollectorRuntime({
      registry: new CollectorRegistry({
        sources: [strictOne, testSource("two")],
        collectors: [
          defineCollector(declaration("fake.first", "one"), namesFrom("one.test")),
          defineCollector(declaration("fake.second", "one"), namesFrom("one.test")),
          defineCollector(declaration("fake.other", "two"), namesFrom("two.test")),
        ],
      }),
      allowUnverifiedSources: true,
      network: testNetwork(upstream, {
        rateLimiter: new MemoryRateLimiter(),
        answers: { "one.test": ["1.1.1.1"], "two.test": ["1.1.1.1"] },
      }),
    });
    expectStatus(await runtime.execute("fake.first", request()), "FOUND");
    const throttled = expectStatus(await runtime.execute("fake.second", request()), "UNAVAILABLE");
    expect(throttled.error.code).toBe("UPSTREAM_RATE_LIMITED");
    expect(throttled.retryAfterMs).toBeGreaterThan(0);
    expectStatus(await runtime.execute("fake.other", request()), "FOUND");
    expect(upstream.requests.map((r) => r.host)).toEqual(["one.test", "two.test"]);
  });
});

describe("ACTIVE and PERSON collectors are gated (RELEASE-BLOCKING)", () => {
  it("refuses an ACTIVE collector without a scope authorisation for the exact target", async () => {
    routes.set("one.test/names?q=example.com", (res) => res.end('["a"]'));
    const calls = { count: 0 };
    const runtime = runtimeWith([
      defineCollector(
        declaration("fake.active", "one", { collectionMode: "ACTIVE" }),
        namesFrom("one.test", calls),
      ),
    ]);
    expect(expectStatus(await runtime.execute("fake.active", request()), "REFUSED").reason).toBe(
      "SCOPE_AUTHORISATION_REQUIRED",
    );
    const elsewhere = { id: "[auth]", targetType: "DOMAIN", target: "example.org" } as const;
    expect(
      expectStatus(
        await runtime.execute("fake.active", request({ scopeAuthorisation: elsewhere })),
        "REFUSED",
      ).reason,
    ).toBe("SCOPE_AUTHORISATION_REQUIRED");
    expect(calls.count).toBe(0);
    const inForce = { id: "[auth]", targetType: "DOMAIN", target: "example.com" } as const;
    expectStatus(
      await runtime.execute("fake.active", request({ scopeAuthorisation: inForce })),
      "FOUND",
    );
  });

  it("refuses a PERSON collector without approved vetting, or without the plan", async () => {
    routes.set("one.test/names?q=example.com", (res) => res.end('["a"]'));
    const calls = { count: 0 };
    const runtime = runtimeWith([
      defineCollector(
        declaration("fake.person", "one", { discipline: "PERSON" }),
        namesFrom("one.test", calls),
      ),
    ]);
    const notVetted = { plan: "TECHINT_AND_PERSON", vettingStatus: "PENDING" } as const;
    expect(
      expectStatus(
        await runtime.execute("fake.person", request({ entitlement: notVetted })),
        "REFUSED",
      ).reason,
    ).toBe("VETTING_NOT_APPROVED");
    const noPlan = { plan: "TECHINT", vettingStatus: "APPROVED" } as const;
    expect(
      expectStatus(
        await runtime.execute("fake.person", request({ entitlement: noPlan })),
        "REFUSED",
      ).reason,
    ).toBe("MODULE_NOT_IN_PLAN");
    expect(calls.count).toBe(0);
    expectStatus(await runtime.execute("fake.person", request()), "FOUND");
  });
});

describe("a failure never becomes a result (RELEASE-BLOCKING)", () => {
  const collectorThat = (
    id: string,
    implementation: CollectorImplementation<{ names: string[] }>,
    schema = NAMES_SCHEMA,
  ) => defineCollector({ ...declaration(id, "one"), resultSchema: schema }, implementation);

  it("reports an unreachable upstream as UNAVAILABLE, and a thrown error as FAILED without its message", async () => {
    const closed = await startUpstream(() => undefined);
    await closed.close();
    const runtime = new CollectorRuntime({
      registry: new CollectorRegistry({
        sources: SOURCES,
        collectors: [collectorThat("fake.down", namesFrom("one.test"))],
      }),
      allowUnverifiedSources: true,
      network: testNetwork(closed, { answers: { "one.test": ["1.1.1.1"] } }),
    });
    expect(
      expectStatus(await runtime.execute("fake.down", request()), "UNAVAILABLE").error.code,
    ).toBe("UPSTREAM_UNREACHABLE");
    const thrower = collectorThat("fake.thrower", () =>
      Promise.reject(new Error("token=s3cr3t for example.com")),
    );
    const failed = expectStatus(
      await runtimeWith([thrower]).execute("fake.thrower", request()),
      "FAILED",
    );
    expect(failed.error.code).toBe("COLLECTOR_ERROR");
    expect(JSON.stringify(failed)).not.toContain("s3cr3t");
  });

  it("refuses FOUND built on a failed response, an empty result, or no evidence", async () => {
    routes.set("one.test/error", (res) => res.writeHead(500).end("[]"));
    routes.set("one.test/empty", (res) => res.end("[]"));
    const loose = z.object({ names: z.array(z.string()) });
    const cases: [string, CollectorImplementation<{ names: string[] }>, z.ZodType][] = [
      [
        "a 500 response cited as evidence",
        async (ctx) => {
          const response = await ctx.fetch("http://one.test/error", {
            method: "GET",
            timeoutMs: 1_000,
          });
          return ctx.found({ names: ["x"] }, [{ response, observedAt: null }]);
        },
        NAMES_SCHEMA,
      ],
      [
        "an empty list presented as a result",
        async (ctx) => {
          const response = await ctx.fetch("http://one.test/empty", {
            method: "GET",
            timeoutMs: 1_000,
          });
          return ctx.found({ names: [] }, [{ response, observedAt: null }]);
        },
        loose,
      ],
      [
        "no evidence at all",
        (ctx) => Promise.resolve(ctx.found({ names: ["x"] }, [] as unknown as [never])),
        NAMES_SCHEMA,
      ],
      [
        "not-found claimed from a 500",
        async (ctx) => {
          const response = await ctx.fetch("http://one.test/error", {
            method: "GET",
            timeoutMs: 1_000,
          });
          return ctx.notFound(response, "nothing");
        },
        NAMES_SCHEMA,
      ],
    ];
    for (const [label, implementation, schema] of cases) {
      const outcome = await runtimeWith([
        collectorThat("fake.bad", implementation, schema as typeof NAMES_SCHEMA),
      ]).execute("fake.bad", request());
      expect(outcome.status, label).toBe("FAILED");
      expect(foundBy(outcome), label).toBeNull();
    }
  });

  it("refuses a zero presented as a result", async () => {
    routes.set("one.test/count", (res) => res.end("0"));
    const counter = defineCollector(
      { ...declaration("fake.count", "one"), resultSchema: z.object({ count: z.number() }) },
      async (ctx) => {
        const response = await ctx.fetch("http://one.test/count", {
          method: "GET",
          timeoutMs: 1_000,
        });
        return ctx.found({ count: Number(response.text()) }, [{ response, observedAt: null }]);
      },
    );
    const outcome = expectStatus(
      await runtimeWith([counter]).execute("fake.count", request()),
      "FAILED",
    );
    expect(outcome.error.code).toBe("COLLECTOR_CONTRACT_VIOLATION");
  });

  it("validates FOUND against the declared schema", async () => {
    routes.set("one.test/names?q=example.com", (res) => res.end("[42]"));
    const sloppy = collectorThat("fake.sloppy", async (ctx) => {
      const response = await ctx.fetch("http://one.test/names?q=example.com", {
        method: "GET",
        timeoutMs: 1_000,
      });
      return ctx.found(response.json() as { names: string[] }, [{ response, observedAt: null }]);
    });
    expect(
      expectStatus(await runtimeWith([sloppy]).execute("fake.sloppy", request()), "FAILED").error
        .code,
    ).toBe("RESULT_SCHEMA_INVALID");
  });

  it("distinguishes NOT_FOUND, NEEDS_CREDENTIALS and a run that overruns its budget", async () => {
    const runtime = runtimeWith([
      collectorThat("fake.missing", namesFrom("one.test")),
      defineCollector(
        declaration("fake.keyed", "one", {
          credentials: { vaultIds: ["one-key"], runsWithout: false },
        }),
        namesFrom("one.test"),
      ),
      defineCollector(
        declaration("fake.slow", "one", { timeoutMs: 100 }),
        () => new Promise(() => undefined),
      ),
    ]);
    expect(
      expectStatus(await runtime.execute("fake.missing", request()), "NOT_FOUND").detail,
    ).toMatch(/no names/);
    expect(
      expectStatus(await runtime.execute("fake.keyed", request()), "NEEDS_CREDENTIALS").missing,
    ).toEqual(["one-key"]);
    expect(
      expectStatus(await runtime.execute("fake.slow", request()), "UNAVAILABLE").error.code,
    ).toBe("COLLECTOR_TIMEOUT");
  });

  it("drafts evidence only from FOUND, keeping observedAt null and collectedAt measured", async () => {
    routes.set("one.test/names?q=example.com", (res) => res.end('["a"]'));
    const runtime = runtimeWith([collectorThat("fake.ok", namesFrom("one.test"))]);
    const found = expectStatus(await runtime.execute("fake.ok", request()), "FOUND");
    const [draft] = evidenceDrafts(runtime.registry.entry("fake.ok"), found);
    expect(draft).toMatchObject({
      collectorId: "fake.ok",
      collectorVersion: "1.2.3",
      observedAt: null,
    });
    expect(draft?.collectedAt).toEqual(found.evidence[0]?.response.receivedAt);
    expect(new TextDecoder().decode(draft?.payload)).toBe('["a"]');
  });
});

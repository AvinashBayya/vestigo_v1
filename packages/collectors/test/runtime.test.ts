/**
 * RELEASE-BLOCKING. The collector frame's guarantees, with fake in-memory
 * collectors (test code only) against a real HTTP server on loopback:
 *   - a BLOCKED collector cannot be executed by any path;
 *   - a BLOCKED or UNVERIFIED source never runs, in any environment and any
 *     access configuration (access methods, 2026-10-16, acceptance b);
 *   - a source runs only via an access method enabled here; the operator
 *     method is off unless the deployment names it (acceptance a), and a
 *     collector is handed no credential of a method that is not enabled;
 *   - something that cannot run says so with null, never 0 or an empty list
 *     (acceptance c);
 *   - a collector cannot set, override or influence its source label, and two
 *     collectors on different upstreams produce distinguishable evidence;
 *   - collectors sharing an upstream share its rate limit;
 *   - ACTIVE needs a scope authorisation, PERSON needs plan and vetting, and
 *     so does a TOPIC target, whatever the collector's discipline;
 *   - a failure never becomes FOUND, an empty result, or evidence.
 */
import { ACCESS_METHODS, enabledAccessMethods, loadEnv } from "@repo/config";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { registryInternals } from "../src/registry.ts";
import { replayRecordedAnswers } from "../src/runtime.ts";
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
  type AccessMethod,
  type CollectorReturn,
  type FoundOutcome,
  type SourceDeclaration,
} from "../src/index.ts";
import {
  ENTITLED,
  MemoryRateLimiter,
  NAMES_SCHEMA,
  startUpstream,
  type Names,
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
  // Open, or with a tenant key for more, like GitHub's API.
  testSource("one", { access: ["open", "official"] }),
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
): CollectorImplementation<Names> {
  return async (ctx) => {
    calls.count += 1;
    const response = await ctx.fetch(`http://${host}/names?q=${ctx.target.value}`, {
      method: "GET",
      timeoutMs: 1_000,
    });
    if (response.status === 404) return ctx.notFound(response, "no names for this target");
    const names = z.array(z.string()).parse(response.json());
    return ctx.found({ names, derived: {} }, [{ response, observedAt: null }]);
  };
}

/**
 * A runtime as a deployment builds one, unless `replay` gives it the fixture
 * harness's grant to replay UNVERIFIED sources (the most permissive path that
 * exists). `accessMethods` defaults as a deployment's does.
 */
function runtimeWith(
  collectors: Collector[],
  options: {
    accessMethods?: readonly AccessMethod[];
    replay?: boolean;
    rateLimiter?: MemoryRateLimiter;
  } = {},
): CollectorRuntime {
  const runtime = new CollectorRuntime({
    registry: new CollectorRegistry({ sources: SOURCES, collectors }),
    ...(options.accessMethods === undefined ? {} : { accessMethods: options.accessMethods }),
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
  if (options.replay === true) replayRecordedAnswers(runtime);
  return runtime;
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
    // The most permissive runtime there is: the harness's replay grant, every method enabled.
    const runtime = runtimeWith([blocked], { replay: true, accessMethods: ACCESS_METHODS });
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
      "replayRecordedAnswers",
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

/** What a deployment must set; the rest is left to the defaults. */
const DEPLOYMENT_ENV = {
  DATABASE_URL: "postgres://app_runtime:app_runtime@127.0.0.1:5432/app",
  DATABASE_AUTH_URL: "postgres://app_auth:app_auth@127.0.0.1:5432/app",
  REDIS_URL: "redis://127.0.0.1:6379",
  AUTH_SECRET: "x".repeat(32),
  AUTH_BASE_URL: "http://127.0.0.1:3000",
  WEB_ORIGIN: "http://localhost:5173",
  VAULT_MASTER_KEY: "[test master key]",
  VAULT_MASTER_KEY_ID: "test-1",
};

describe("a BLOCKED or UNVERIFIED source never runs (RELEASE-BLOCKING; access methods, acceptance b)", () => {
  const calls = { count: 0 };
  const unverified = defineCollector(
    declaration("fake.unverified", "unverified"),
    namesFrom("unverified.test", calls),
  );
  const blocked = defineCollector(
    declaration("fake.blocked-too", "blocked"),
    namesFrom("blocked.test", calls),
  );

  it.each(["development", "test", "production"] as const)(
    "NODE_ENV=%s: refused however the deployment is configured, the retired flag included, and its code never runs",
    async (nodeEnv) => {
      routes.set("unverified.test/names?q=example.com", (res) => res.end('["a"]'));
      routes.set("blocked.test/names?q=example.com", (res) => res.end('["a"]'));
      for (const methods of [undefined, "open,official,licensed,operator"]) {
        // Loaded as the API and the worker load theirs, the retired flag set:
        // loadEnv drops it, and the runtime takes nothing else from the
        // environment, NODE_ENV included.
        const env = loadEnv({
          ...DEPLOYMENT_ENV,
          NODE_ENV: nodeEnv,
          COLLECTORS_ALLOW_UNVERIFIED: "true",
          COLLECTORS_ACCESS_METHODS: methods,
        });
        expect(Object.keys(env)).not.toContain("COLLECTORS_ALLOW_UNVERIFIED");
        const runtime = runtimeWith([unverified, blocked], {
          accessMethods: enabledAccessMethods(env),
        });
        for (const [id, reason] of [
          ["fake.unverified", "UNVERIFIED_SOURCE_NOT_ALLOWED"],
          ["fake.blocked-too", "LICENCE_BLOCKED"],
        ] as const) {
          expect(runtime.access(id)).toMatchObject({ runsVia: null, refusal: reason });
          expect(runtime.admit(id, request())).toMatchObject({ status: "REFUSED", reason });
          expect(expectStatus(await runtime.execute(id, request()), "REFUSED").reason).toBe(reason);
        }
      }
      expect(calls.count).toBe(0);
      expect(upstream.requests).toEqual([]);
    },
  );

  it("says why, in words a reader can act on", () => {
    expect(runtimeWith([unverified]).access("fake.unverified").reason).toBe(
      "[Test source unverified]'s licence is unverified, and an unverified source never runs: its terms must be checked and a verdict recorded first.",
    );
  });

  it("offers a deployment no way to ask for one: the runtime takes no such option", async () => {
    routes.set("unverified.test/names?q=example.com", (res) => res.end('["a"]'));
    const runtime = new CollectorRuntime({
      registry: new CollectorRegistry({ sources: SOURCES, collectors: [unverified] }),
      // @ts-expect-error: retired on 2026-10-16, an UNVERIFIED source never runs, so there is no allowance to give
      allowUnverifiedSources: true,
      network: testNetwork(upstream, { answers: { "unverified.test": ["1.1.1.1"] } }),
    });
    expect(
      expectStatus(await runtime.execute("fake.unverified", request()), "REFUSED").reason,
    ).toBe("UNVERIFIED_SOURCE_NOT_ALLOWED");
    expect(calls.count).toBe(0);
    expect(upstream.requests).toEqual([]);
  });

  it("is replayed only by the fixture harness's grant, so a collector's parsing is still tested offline", async () => {
    routes.set("unverified.test/names?q=example.com", (res) => res.end('["a"]'));
    const replayed = defineCollector(
      declaration("fake.unverified", "unverified"),
      namesFrom("unverified.test"),
    );
    const runtime = runtimeWith([replayed], { replay: true });
    expect(runtime.access("fake.unverified").runsVia).toEqual(["open"]);
    expectStatus(await runtime.execute("fake.unverified", request()), "FOUND");
  });
});

describe("a source runs only via an access method enabled here (RELEASE-BLOCKING; access methods)", () => {
  /** An operator's own source and collector: test code only, as the product ships none. */
  const OPERATOR_SOURCE = testSource("operator.own", { access: ["operator"] });
  const seen: (string | null)[] = [];
  const calls = { count: 0 };
  const own = defineCollector(
    declaration("operator.fake", "operator.own", {
      discipline: "PERSON",
      credentials: { vaultIds: ["own-account"], runsWithout: false },
    }),
    async (ctx) => {
      calls.count += 1;
      const key = ctx.credentials.get("own-account");
      seen.push(key === null ? null : key.expose());
      const response = await ctx.fetch(`http://operator.own.test/names?q=${ctx.target.value}`, {
        method: "GET",
        timeoutMs: 1_000,
      });
      const names = z.array(z.string()).parse(response.json());
      return ctx.found({ names, derived: {} }, [{ response, observedAt: null }]);
    },
  );
  const ownAccount = new Map([["own-account", { expose: () => "[operator account]" }]]);
  const operatorRuntime = (accessMethods?: readonly AccessMethod[]) =>
    new CollectorRuntime({
      registry: new CollectorRegistry({
        sources: [...SOURCES, OPERATOR_SOURCE],
        collectors: [own],
      }),
      ...(accessMethods === undefined ? {} : { accessMethods }),
      network: testNetwork(upstream, { answers: { "operator.own.test": ["1.1.1.1"] } }),
    });

  it("keeps the operator method off unless the deployment names it, its code unrun and its account unread (acceptance a)", async () => {
    routes.set("operator.own.test/names?q=example.com", (res) => res.end('["a"]'));
    const byDefault = operatorRuntime();
    expect(byDefault.accessMethods).toEqual(["open", "official", "licensed"]);
    expect(byDefault.access("operator.fake")).toEqual({
      methods: [{ kind: "operator", enabled: false, licenceVerdict: "PERMITTED", runnable: false }],
      vaultIds: [],
      runsVia: null,
      refusal: "ACCESS_METHOD_NOT_ENABLED",
      reason: "Its only access method, operator, is not enabled in this deployment.",
    });
    const refused = expectStatus(
      await byDefault.execute("operator.fake", request({ credentials: ownAccount })),
      "REFUSED",
    );
    expect(refused.reason).toBe("ACCESS_METHOD_NOT_ENABLED");
    expect([calls.count, seen, upstream.requests]).toEqual([0, [], []]);

    const named = operatorRuntime(["open", "operator"]);
    expect(named.access("operator.fake")).toMatchObject({
      runsVia: ["operator"],
      vaultIds: ["own-account"],
    });
    expectStatus(
      await named.execute("operator.fake", request({ credentials: ownAccount })),
      "FOUND",
    );
    expect(seen).toEqual(["[operator account]"]);
  });

  it("still gates it as person data once enabled: it needs the person module and approved vetting", () => {
    const named = operatorRuntime(["open", "operator"]);
    const unvetted = { plan: "TECHINT_AND_PERSON", vettingStatus: "PENDING" } as const;
    expect(
      named.admit("operator.fake", request({ entitlement: unvetted, credentials: ownAccount })),
    ).toMatchObject({ reason: "VETTING_NOT_APPROVED" });
    expect(
      named.admit("operator.fake", {
        ...request(),
        entitlement: { plan: "TECHINT", vettingStatus: "APPROVED" },
      }),
    ).toMatchObject({ reason: "MODULE_NOT_IN_PLAN" });
  });

  it("hands a key only to an enabled keyed method: with official off, an optional-key collector runs open, handed nothing", async () => {
    routes.set("one.test/names?q=example.com", (res) => res.end('["a"]'));
    const keys: (string | null)[] = [];
    const optional = defineCollector(
      declaration("fake.optional", "one", {
        credentials: { vaultIds: ["one-key"], runsWithout: true },
      }),
      async (ctx) => {
        const key = ctx.credentials.get("one-key");
        keys.push(key === null ? null : key.expose());
        return namesFrom("one.test")(ctx);
      },
    );
    const handed = new Map([["one-key", { expose: () => "[tenant key]" }]]);
    const openOnly = runtimeWith([optional], { accessMethods: ["open"] });
    expect(openOnly.access("fake.optional")).toMatchObject({ runsVia: ["open"], vaultIds: [] });
    expectStatus(
      await openOnly.execute("fake.optional", request({ credentials: handed })),
      "FOUND",
    );
    const both = runtimeWith([optional]);
    expect(both.access("fake.optional")).toMatchObject({
      runsVia: ["open", "official"],
      vaultIds: ["one-key"],
    });
    expectStatus(await both.execute("fake.optional", request({ credentials: handed })), "FOUND");
    expect(keys).toEqual([null, "[tenant key]"]);
  });

  it("refuses a collector whose only method is off, and one that needs a key it was not handed", async () => {
    const keyed = defineCollector(
      declaration("fake.keyed", "one", {
        credentials: { vaultIds: ["one-key"], runsWithout: false },
      }),
      namesFrom("one.test"),
    );
    expect(
      expectStatus(
        await runtimeWith([keyed], { accessMethods: ["open"] }).execute("fake.keyed", request()),
        "REFUSED",
      ).reason,
    ).toBe("ACCESS_METHOD_NOT_ENABLED");
    expect(
      expectStatus(await runtimeWith([keyed]).execute("fake.keyed", request()), "NEEDS_CREDENTIALS")
        .missing,
    ).toEqual(["one-key"]);
    expect(upstream.requests).toEqual([]);
  });

  it("refuses at registration a source without a method, and a collector its source's methods do not fit", () => {
    const register = (sources: SourceDeclaration[], collectors: Collector[]) => () =>
      new CollectorRegistry({ sources, collectors });
    const noMethods = { ...testSource("none"), access: [] } as unknown as SourceDeclaration;
    expect(register([noMethods], [])).toThrow(/at least one access method/);
    expect(register([testSource("twice", { access: ["official", "licensed"] })], [])).toThrow(
      /more than one keyed method/,
    );
    expect(register([testSource("operator.shared", { access: ["open", "operator"] })], [])).toThrow(
      /stands alone/,
    );
    expect(register([testSource("unprefixed", { access: ["operator"] })], [])).toThrow(
      /exactly when the source is reached through the operator method/,
    );
    const keyedOnOpen = defineCollector(
      declaration("fake.keyed-open", "two", {
        credentials: { vaultIds: ["two-key"], runsWithout: false },
      }),
      namesFrom("two.test"),
    );
    expect(register([testSource("two")], [keyedOnOpen])).toThrow(/must declare a keyed method/);
    const openOnKeyed = defineCollector(declaration("fake.open-keyed", "keyed"), namesFrom("x"));
    expect(register([testSource("keyed", { access: ["official"] })], [openOnKeyed])).toThrow(
      /does not declare it/,
    );
    const technical = defineCollector(
      declaration("operator.fake-technical", "operator.own", {
        credentials: { vaultIds: ["own-account"], runsWithout: false },
      }),
      namesFrom("operator.own.test"),
    );
    expect(register([OPERATOR_SOURCE], [technical])).toThrow(/person collector/);
  });

  it("refuses a source on Instagram, Facebook or X by any method, a backstop for CLAUDE.md §3", () => {
    for (const host of ["www.instagram.com", "graph.facebook.com", "api.x.com", "twitter.com"]) {
      const network = {
        protocol: "https" as const,
        hosts: [host],
        rateLimit: {
          requests: 1,
          intervalSeconds: 1,
          basis: "SELF_IMPOSED" as const,
          note: "[test]",
        },
        operators: [{ name: "fake", hosts: [host] }],
      };
      for (const source of [
        testSource("social", { network }),
        testSource("operator.social", { access: ["operator"], network }),
      ]) {
        expect(() => new CollectorRegistry({ sources: [source], collectors: [] })).toThrow(
          /never collected from/,
        );
      }
    }
  });
});

describe("what cannot run says so with null, never 0 or an empty list (RELEASE-BLOCKING; access methods, acceptance c)", () => {
  it("gives every source and collector that cannot run a null runsVia and a reason, and every one that can a method", () => {
    const runtime = runtimeWith(
      [
        defineCollector(declaration("fake.unverified", "unverified"), namesFrom("unverified.test")),
        defineCollector(declaration("fake.blocked", "blocked"), namesFrom("blocked.test")),
        defineCollector(
          declaration("fake.keyed", "one", {
            credentials: { vaultIds: ["one-key"], runsWithout: false },
          }),
          namesFrom("one.test"),
        ),
        defineCollector(declaration("fake.ok", "two"), namesFrom("two.test")),
      ],
      { accessMethods: ["open"] },
    );
    const sources = new Map(runtime.sources().map((source) => [source.id, source]));
    for (const id of ["unverified", "blocked"]) {
      const source = sources.get(id);
      expect(source?.enabled).toBe(false);
      expect(source?.runsVia).toBeNull();
      expect(source?.reason?.trim().length).toBeGreaterThan(0);
    }
    expect(sources.get("two")).toMatchObject({ enabled: true, runsVia: ["open"], reason: null });
    for (const id of ["fake.unverified", "fake.blocked", "fake.keyed"]) {
      const access = runtime.access(id);
      expect(access.runsVia, id).toBeNull();
      expect(access.refusal, id).not.toBeNull();
      expect(access.reason?.trim().length, id).toBeGreaterThan(0);
    }
    expect(runtime.access("fake.ok").runsVia).toEqual(["open"]);
    // Nothing a reader could count: no empty list, no zero, anywhere in what is said.
    const said = JSON.stringify([...sources.values(), runtime.access("fake.keyed")]);
    expect(said).not.toContain('"runsVia":[]');
    expect(said).not.toMatch(/:0[,}]/);
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
        return ctx.found({ names: ["a"], derived: {} }, [{ response, observedAt: null }], {
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
          result: { names: ["a"], derived: {} },
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
      } as unknown as CollectorReturn<Names>;
    });
    const mutator = defineCollector(declaration("fake.mutator", "one"), async (ctx) => {
      const response = await ctx.fetch("http://one.test/names?q=example.com", {
        method: "GET",
        timeoutMs: 1_000,
      });
      const returned = ctx.found({ names: ["a"], derived: {} }, [{ response, observedAt: null }]);
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
    expect(
      drafts.map((draft) => [
        draft.collectorId,
        draft.sourceUrl === null ? null : new URL(draft.sourceUrl).host,
      ]),
    ).toEqual([
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
      return ctx.found({ names: ["from-two"], derived: {} }, [{ response, observedAt: null }]);
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
        operators: [{ name: "fake", hosts: ["one.test"] }],
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

describe("no collector credential comes from the environment (RELEASE-BLOCKING)", () => {
  it("gives a collector only the credentials it was handed, whatever the environment holds", async () => {
    routes.set("one.test/names?q=example.com", (res) => res.end('["a"]'));
    const spellings = ["ONE_KEY", "ONE_KEY_API_KEY", "ONE_KEY_TOKEN", "one-key", "HIBP_API_KEY"];
    const saved = new Map(spellings.map((name) => [name, process.env[name]]));
    const seen: (string | null)[] = [];
    const optional = defineCollector(
      declaration("fake.optional", "one", {
        credentials: { vaultIds: ["one-key"], runsWithout: true },
      }),
      async (ctx) => {
        const key = ctx.credentials.get("one-key");
        seen.push(key === null ? null : key.expose());
        const response = await ctx.fetch("http://one.test/names?q=example.com", {
          method: "GET",
          timeoutMs: 1_000,
          ...(key === null ? {} : { headers: { authorization: `Bearer ${key.expose()}` } }),
        });
        return ctx.found({ names: ["a"], derived: {} }, [{ response, observedAt: null }]);
      },
    );
    try {
      for (const name of spellings) process.env[name] = "environment-secret-value";
      const runtime = runtimeWith([optional]);
      expectStatus(await runtime.execute("fake.optional", request()), "FOUND");
      const handed = new Map([["one-key", { expose: () => "handed-secret-value" }]]);
      expectStatus(
        await runtime.execute("fake.optional", request({ credentials: handed })),
        "FOUND",
      );
    } finally {
      for (const [name, value] of saved) {
        if (value === undefined) Reflect.deleteProperty(process.env, name);
        else process.env[name] = value;
      }
    }
    expect(seen).toEqual([null, "handed-secret-value"]);
    expect(upstream.requests.map((r) => r.headers.authorization)).toEqual([
      undefined,
      "Bearer handed-secret-value",
    ]);
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

  it("refuses a TOPIC target without the person plan and vetting, whatever the collector's discipline", async () => {
    // A news collector (MEDIAINT) that takes a domain or a topic: the domain
    // needs nothing more, the topic needs what a PERSON collector needs.
    routes.set("one.test/names?q=elections", (res) => res.end('["a"]'));
    routes.set("one.test/names?q=example.com", (res) => res.end('["a"]'));
    const calls = { count: 0 };
    const runtime = runtimeWith([
      defineCollector(
        declaration("fake.news", "one", {
          discipline: "MEDIAINT",
          targetTypes: ["DOMAIN", "TOPIC"],
        }),
        namesFrom("one.test", calls),
      ),
    ]);
    const topic = parseTarget("TOPIC", "elections");
    const noPlan = { plan: "TECHINT", vettingStatus: "APPROVED" } as const;
    const noVetting = { plan: "TECHINT_AND_PERSON", vettingStatus: "SUSPENDED" } as const;
    const onTopic = (entitlement: sdk.DispatchRequest["entitlement"]) =>
      runtime.execute("fake.news", request({ target: topic, entitlement }));
    const refusal = expectStatus(await onTopic(noPlan), "REFUSED");
    expect(refusal.reason).toBe("MODULE_NOT_IN_PLAN");
    expect(refusal.message).toMatch(/TOPIC target may name a person/);
    expect(expectStatus(await onTopic(noVetting), "REFUSED").reason).toBe("VETTING_NOT_APPROVED");
    expect(
      runtime.admit("fake.news", { target: topic, entitlement: noPlan, scopeAuthorisation: null }),
    ).toMatchObject({ status: "REFUSED", reason: "MODULE_NOT_IN_PLAN" });
    expect(calls.count).toBe(0);
    // The same collector on a domain runs for the plan without the person module.
    expectStatus(await runtime.execute("fake.news", request({ entitlement: noPlan })), "FOUND");
    expect(calls.count).toBe(1);
    // And on the topic once the tenant holds the plan and approved vetting.
    expectStatus(await onTopic(ENTITLED), "FOUND");
    expect(calls.count).toBe(2);
  });

  it("parses a TOPIC as typed, its spacing made single, within its length", () => {
    expect(parseTarget("TOPIC", "  #elections ")).toEqual({ type: "TOPIC", value: "#elections" });
    expect(parseTarget("TOPIC", '"a   quoted\tphrase"')).toEqual({
      type: "TOPIC",
      value: '"a quoted phrase"',
    });
    expect(() => parseTarget("TOPIC", "   ")).toThrow(sdk.InvalidTargetError);
    expect(() => parseTarget("TOPIC", "x".repeat(301))).toThrow(sdk.InvalidTargetError);
  });
});

describe("local analysis cites its own recorded analysis (RELEASE-BLOCKING)", () => {
  const OFFLINE = testSource("offline", { network: null });
  const localDeclaration = (id: string) => ({
    ...declaration(id, "offline"),
    collectionMode: "LOCAL_ANALYSIS" as const,
    claimStrength: "DERIVED" as const,
  });
  const localRuntime = (collectors: Collector[]) =>
    new CollectorRuntime({
      registry: new CollectorRegistry({ sources: [...SOURCES, OFFLINE], collectors }),
      network: testNetwork(upstream),
    });

  it("records the collector, the target and the output as DERIVED evidence with no source URL", async () => {
    const analyser = defineCollector(localDeclaration("fake.local"), (ctx) => {
      const record = ctx.record({ names: ["derived"] });
      return Promise.resolve(
        ctx.found({ names: ["derived"], derived: {} }, [{ response: record, observedAt: null }]),
      );
    });
    const runtime = localRuntime([analyser]);
    const found = expectStatus(await runtime.execute("fake.local", request()), "FOUND");
    const [draft] = evidenceDrafts(runtime.registry.entry("fake.local"), found);
    expect(draft).toMatchObject({ sourceUrl: null, claimStrength: "DERIVED", observedAt: null });
    expect(JSON.parse(new TextDecoder().decode(draft?.payload))).toEqual({
      collector: { id: "fake.local", version: "1.2.3" },
      target: { type: "DOMAIN", value: "example.com" },
      output: { names: ["derived"] },
    });
    expect(draft?.collectedAt).toBeInstanceOf(Date);
    expect(upstream.requests).toEqual([]);
  });

  it("cannot reach the network, and cannot cite a network response", async () => {
    routes.set("one.test/names?q=example.com", (res) => res.end('["a"]'));
    const reaching = defineCollector(localDeclaration("fake.reaching"), async (ctx) => {
      const response = await ctx.fetch("http://one.test/names?q=example.com", {
        method: "GET",
        timeoutMs: 1_000,
      });
      return ctx.found({ names: ["a"], derived: {} }, [{ response, observedAt: null }]);
    });
    expect(
      expectStatus(await localRuntime([reaching]).execute("fake.reaching", request()), "FAILED")
        .error.code,
    ).toBe("DESTINATION_REFUSED");
    expect(upstream.requests).toEqual([]);
  });

  it("is the only kind of collector that can record an analysis", async () => {
    const pretender = defineCollector(declaration("fake.pretender", "one"), (ctx) => {
      const record = ctx.record({ names: ["made up"] });
      return Promise.resolve(
        ctx.found({ names: ["made up"], derived: {} }, [{ response: record, observedAt: null }]),
      );
    });
    expect(
      expectStatus(await runtimeWith([pretender]).execute("fake.pretender", request()), "FAILED")
        .error.code,
    ).toBe("COLLECTOR_DEFINITION_INVALID");
  });
});

describe("a failure never becomes a result (RELEASE-BLOCKING)", () => {
  const collectorThat = (
    id: string,
    implementation: CollectorImplementation<Names>,
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
    const loose = z.object({ names: z.array(z.string()), derived: z.object({}) });
    const cases: [string, CollectorImplementation<Names>, z.ZodType][] = [
      [
        "a 500 response cited as evidence",
        async (ctx) => {
          const response = await ctx.fetch("http://one.test/error", {
            method: "GET",
            timeoutMs: 1_000,
          });
          return ctx.found({ names: ["x"], derived: {} }, [{ response, observedAt: null }]);
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
          return ctx.found({ names: [], derived: {} }, [{ response, observedAt: null }]);
        },
        loose,
      ],
      [
        "no evidence at all",
        (ctx) =>
          Promise.resolve(ctx.found({ names: ["x"], derived: {} }, [] as unknown as [never])),
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

  describe("provenance (Phase 3B review): what the collector computed lives under derived", () => {
    const COUNTED = z.object({
      names: z.array(z.string()).min(1),
      count: z.number().optional(),
      derived: z.object({ count: z.number().optional() }),
    });
    /** A fake that computes a count (names × 7, a value no response holds) and places it. */
    const counting = (id: string, placeCountIn: "result" | "derived") =>
      defineCollector({ ...declaration(id, "one"), resultSchema: COUNTED }, async (ctx) => {
        const response = await ctx.fetch("http://one.test/names?q=example.com", {
          method: "GET",
          timeoutMs: 1_000,
        });
        const names = z.array(z.string()).parse(response.json());
        const count = names.length * 7;
        return ctx.found(
          placeCountIn === "result" ? { names, count, derived: {} } : { names, derived: { count } },
          [{ response, observedAt: null }],
        );
      });

    it("refuses at registration a non-local schema with no derived block", () => {
      expect(
        () =>
          new CollectorRegistry({
            sources: SOURCES,
            collectors: [
              defineCollector(
                {
                  ...declaration("fake.flat", "one"),
                  resultSchema: z.object({ names: z.array(z.string()) }),
                },
                namesFrom("one.test") as unknown as sdk.CollectorImplementation<{
                  names: string[];
                }>,
              ),
            ],
          }),
      ).toThrow(/derived object/);
    });

    it("fails a run whose computed value sits outside derived, naming the field, not the value", async () => {
      routes.set("one.test/names?q=example.com", (res) => res.end('["a","b"]'));
      const outcome = expectStatus(
        await runtimeWith([counting("fake.computed", "result")]).execute(
          "fake.computed",
          request(),
        ),
        "FAILED",
      );
      expect(outcome.error.code).toBe("COLLECTOR_CONTRACT_VIOLATION");
      expect(outcome.error.message).toContain("result.count");
      expect(outcome.error.message).not.toContain("14");
    });

    it("accepts the same computed value under derived", async () => {
      routes.set("one.test/names?q=example.com", (res) => res.end('["a","b"]'));
      const found = expectStatus(
        await runtimeWith([counting("fake.derived", "derived")]).execute("fake.derived", request()),
        "FOUND",
      );
      expect(found.result).toEqual({ names: ["a", "b"], derived: { count: 14 } });
    });

    it("refuses a result that holds only derived values: nothing was reported", async () => {
      routes.set("one.test/names?q=example.com", (res) => res.end('["a","b"]'));
      const loose = z.object({
        names: z.array(z.string()),
        derived: z.object({ count: z.number() }),
      });
      const collector = defineCollector(
        { ...declaration("fake.onlyderived", "one"), resultSchema: loose },
        async (ctx) => {
          const response = await ctx.fetch("http://one.test/names?q=example.com", {
            method: "GET",
            timeoutMs: 1_000,
          });
          return ctx.found({ names: [], derived: { count: 2 } }, [{ response, observedAt: null }]);
        },
      );
      const outcome = expectStatus(
        await runtimeWith([collector]).execute("fake.onlyderived", request()),
        "FAILED",
      );
      expect(outcome.error.code).toBe("COLLECTOR_CONTRACT_VIOLATION");
      expect(outcome.error.message).toMatch(/empty/);
    });
  });

  it("refuses a zero presented as a result", async () => {
    routes.set("one.test/count", (res) => res.end("0"));
    const counter = defineCollector(
      {
        ...declaration("fake.count", "one"),
        resultSchema: z.object({ count: z.number(), derived: z.object({}) }),
      },
      async (ctx) => {
        const response = await ctx.fetch("http://one.test/count", {
          method: "GET",
          timeoutMs: 1_000,
        });
        return ctx.found({ count: Number(response.text()), derived: {} }, [
          { response, observedAt: null },
        ]);
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
      return ctx.found(response.json() as Names, [{ response, observedAt: null }]);
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
    const cited = found.evidence[0]?.response;
    expect(cited?.kind).toBe("NETWORK");
    expect(draft?.collectedAt).toEqual(cited?.kind === "NETWORK" ? cited.receivedAt : undefined);
    expect(new TextDecoder().decode(draft?.payload)).toBe('["a"]');
  });
});

describe("an empty answer that cannot be trusted is unconfirmed, never not found (RELEASE-BLOCKING, Track M Day 2)", () => {
  const unreliable = (id: string, implementation: CollectorImplementation<Names>) =>
    defineCollector(declaration(id, "one", { emptyAnswersUnreliable: true }), implementation);
  /** Asks one.test once, then answers with whatever `answer` makes of the response. */
  const answering =
    (
      path: string,
      answer: (
        ctx: Parameters<CollectorImplementation<Names>>[0],
        response: sdk.CapturedResponse,
      ) => CollectorReturn<Names>,
    ): CollectorImplementation<Names> =>
    async (ctx) =>
      answer(ctx, await ctx.fetch(`http://one.test${path}`, { method: "GET", timeoutMs: 1_000 }));

  it("is EMPTY_UNCONFIRMED, citing the empty response, with no result, no evidence and no zero", async () => {
    routes.set("one.test/empty", (res) => res.end("{}"));
    const runtime = runtimeWith([
      unreliable(
        "fake.unreliable",
        answering("/empty", (ctx, response) =>
          ctx.emptyUnconfirmed(response, "[the source answered with nothing]"),
        ),
      ),
    ]);
    const outcome = expectStatus(
      await runtime.execute("fake.unreliable", request()),
      "EMPTY_UNCONFIRMED",
    );
    expect(outcome.detail).toBe("[the source answered with nothing]");
    expect(outcome.response.kind).toBe("NETWORK");
    if (outcome.response.kind === "NETWORK") expect(outcome.response.text()).toBe("{}");
    expect(Object.keys(outcome).sort()).toEqual(["collectorId", "detail", "response", "status"]);
    expect(foundBy(outcome)).toBeNull();
    expect(() =>
      evidenceDrafts(runtime.registry.entry("fake.unreliable"), outcome as unknown as FoundOutcome),
    ).toThrow(sdk.CollectorDefinitionError);
  });

  it("refuses a not-found from a collector whose upstream's empty answers are unreliable", async () => {
    routes.set("one.test/empty", (res) => res.end("{}"));
    const confident = unreliable(
      "fake.confident",
      answering("/empty", (ctx, response) => ctx.notFound(response, "[no coverage]")),
    );
    const outcome = expectStatus(
      await runtimeWith([confident]).execute("fake.confident", request()),
      "FAILED",
    );
    expect(outcome.error.code).toBe("COLLECTOR_CONTRACT_VIOLATION");
    expect(outcome.error.message).toMatch(/unconfirmed, never as not found/);
    // The same not-found from a collector whose source's empty answers are reliable stands.
    const reliable = defineCollector(
      declaration("fake.reliable", "one"),
      answering("/empty", (ctx, response) => ctx.notFound(response, "[no coverage]")),
    );
    expectStatus(await runtimeWith([reliable]).execute("fake.reliable", request()), "NOT_FOUND");
  });

  it("cites a 2xx response this run received, and says what came back empty", async () => {
    routes.set("one.test/error", (res) => res.writeHead(500).end("{}"));
    routes.set("one.test/gone", (res) => res.writeHead(404).end("{}"));
    routes.set("one.test/empty", (res) => res.end("{}"));
    const cases: [string, CollectorImplementation<Names>][] = [
      [
        "a 500",
        answering("/error", (ctx, response) => ctx.emptyUnconfirmed(response, "[nothing]")),
      ],
      ["a 404", answering("/gone", (ctx, response) => ctx.emptyUnconfirmed(response, "[nothing]"))],
      [
        "a blank detail",
        answering("/empty", (ctx, response) => ctx.emptyUnconfirmed(response, " ")),
      ],
    ];
    for (const [label, implementation] of cases) {
      const outcome = expectStatus(
        await runtimeWith([unreliable("fake.bad", implementation)]).execute("fake.bad", request()),
        "FAILED",
      );
      expect(outcome.error.code, label).toBe("COLLECTOR_CONTRACT_VIOLATION");
    }
  });

  it("belongs to a network collector: a local analysis can neither declare it nor give one", async () => {
    const OFFLINE = testSource("offline", { network: null });
    const local = (id: string, overrides: Partial<CollectorDeclaration<typeof NAMES_SCHEMA>>) => ({
      ...declaration(id, "offline"),
      collectionMode: "LOCAL_ANALYSIS" as const,
      claimStrength: "DERIVED" as const,
      ...overrides,
    });
    expect(
      () =>
        new CollectorRegistry({
          sources: [...SOURCES, OFFLINE],
          collectors: [
            defineCollector(local("fake.local", { emptyAnswersUnreliable: true }), namesFrom("x")),
          ],
        }),
    ).toThrow(/no upstream whose empty answers are unreliable/);
    const analyser = defineCollector(local("fake.local", {}), (ctx) =>
      Promise.resolve(ctx.emptyUnconfirmed(ctx.record({ names: [] }), "[nothing]")),
    );
    const runtime = new CollectorRuntime({
      registry: new CollectorRegistry({ sources: [...SOURCES, OFFLINE], collectors: [analyser] }),
      network: testNetwork(upstream),
    });
    const outcome = expectStatus(await runtime.execute("fake.local", request()), "FAILED");
    expect(outcome.error.code).toBe("COLLECTOR_CONTRACT_VIOLATION");
  });

  it("lists whether each collector's empty answers are unreliable: only one that declares it", () => {
    const registry = new CollectorRegistry({
      sources: SOURCES,
      collectors: [
        defineCollector(declaration("fake.default", "one"), namesFrom("one.test")),
        unreliable("fake.unreliable", namesFrom("one.test")),
      ],
    });
    expect(registry.entry("fake.default").emptyAnswersUnreliable).toBe(false);
    expect(registry.entry("fake.unreliable").emptyAnswersUnreliable).toBe(true);
    for (const odd of [false, "true", 1]) {
      expect(
        () =>
          new CollectorRegistry({
            sources: SOURCES,
            collectors: [
              defineCollector(
                declaration("fake.odd", "one", { emptyAnswersUnreliable: odd as true }),
                namesFrom("one.test"),
              ),
            ],
          }),
        String(odd),
      ).toThrow(/either true or left out/);
    }
  });
});

describe("metering: every request a run sends is counted, and nothing else (Phase 4)", () => {
  const counting = () => {
    const sent: { sourceId: string; host: string }[] = [];
    const meter: sdk.UsageMeter = {
      requestSent: (sourceId, host) => {
        sent.push({ sourceId, host });
      },
    };
    return { sent, meter };
  };

  it("counts each hop of a redirect and a request whose answer failed", async () => {
    routes.set("one.test/start", (res) => res.writeHead(302, { location: "/names?q=x" }).end());
    routes.set("one.test/names?q=x", (res) => res.end('["a"]'));
    routes.set("one.test/error", (res) => res.writeHead(500).end("[]"));
    const collector = defineCollector(declaration("fake.metered", "one"), async (ctx) => {
      const failed = await ctx.fetch("http://one.test/error", { method: "GET", timeoutMs: 1_000 });
      expect(failed.status).toBe(500);
      const response = await ctx.fetch("http://one.test/start", {
        method: "GET",
        timeoutMs: 1_000,
      });
      return ctx.found({ names: ["a"], derived: {} }, [{ response, observedAt: null }]);
    });
    const { sent, meter } = counting();
    expectStatus(
      await runtimeWith([collector]).execute("fake.metered", request({ meter })),
      "FOUND",
    );
    expect(sent).toEqual([
      { sourceId: "one", host: "one.test" },
      { sourceId: "one", host: "one.test" },
      { sourceId: "one", host: "one.test" },
    ]);
    expect(upstream.requests).toHaveLength(3);
  });

  it("does not count a request the rate limiter stopped before it was sent", async () => {
    routes.set("one.test/names?q=example.com", (res) => res.end('["a"]'));
    const strict = testSource("one", {
      network: {
        protocol: "http",
        hosts: ["one.test"],
        rateLimit: { requests: 1, intervalSeconds: 5, basis: "UPSTREAM_STATED", note: "[test]" },
        operators: [{ name: "fake", hosts: ["one.test"] }],
      },
    });
    const twice = defineCollector(declaration("fake.twice", "one"), async (ctx) => {
      const response = await ctx.fetch("http://one.test/names?q=example.com", {
        method: "GET",
        timeoutMs: 1_000,
      });
      await ctx.fetch("http://one.test/names?q=example.com", { method: "GET", timeoutMs: 1_000 });
      return ctx.found({ names: ["a"], derived: {} }, [{ response, observedAt: null }]);
    });
    const runtime = new CollectorRuntime({
      registry: new CollectorRegistry({ sources: [strict], collectors: [twice] }),
      network: testNetwork(upstream, {
        rateLimiter: new MemoryRateLimiter(),
        answers: { "one.test": ["1.1.1.1"] },
      }),
    });
    const { sent, meter } = counting();
    expectStatus(await runtime.execute("fake.twice", request({ meter })), "UNAVAILABLE");
    expect(sent).toHaveLength(1);
    expect(upstream.requests).toHaveLength(1);
  });

  it("counts nothing for a collector refused before it runs", async () => {
    const { sent, meter } = counting();
    const runtime = runtimeWith([
      defineCollector(declaration("fake.blocked-meter", "blocked"), namesFrom("blocked.test")),
    ]);
    expectStatus(await runtime.execute("fake.blocked-meter", request({ meter })), "REFUSED");
    expect(sent).toEqual([]);
  });
});

describe("a run that overruns its budget is UNAVAILABLE, however the collector stops (Phase 4)", () => {
  it("regression: a collector that rejects as soon as its signal aborts is still a timeout, not a failure", async () => {
    const stopsOnAbort = defineCollector(
      declaration("fake.stops-on-abort", "one", { timeoutMs: 200 }),
      (ctx) =>
        new Promise((_resolve, reject) => {
          ctx.signal.addEventListener("abort", () => {
            reject(new Error("[stopped on abort]"));
          });
        }),
    );
    const outcome = expectStatus(
      await runtimeWith([stopsOnAbort]).execute("fake.stops-on-abort", request()),
      "UNAVAILABLE",
    );
    expect(outcome.error.code).toBe("COLLECTOR_TIMEOUT");
  });
});

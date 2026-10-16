/**
 * RELEASE-BLOCKING (access methods, owner instruction 2026-10-16). The
 * platform's sources each declare how they are reached, and a source runs only
 * via an access method enabled in the deployment whose licence verdict is
 * PERMITTED. Checked here on the platform registry, with runtimes built as the
 * API and the worker build theirs from the environment:
 *   (a) the operator method is off unless configuration names it;
 *   (b) a BLOCKED or UNVERIFIED source never runs;
 *   (c) what cannot run says so with null and a reason, never 0;
 *   GDELT's DOC API is the first source on the seam: open and PERMITTED, it
 *   runs as before, handed no credential.
 * The product ships no operator collector, only the interface one is attached
 * to; the attachment's rules are checked last.
 */
import { enabledAccessMethods, loadEnv } from "@repo/config";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  CollectorRuntime,
  createPlatformRegistry,
  defineCollector,
  OPERATOR_ID_PREFIX,
  PLATFORM_COLLECTORS,
  PLATFORM_SOURCES,
  type Admission,
  type Collector,
  type OperatorAttachment,
  type SourceDeclaration,
} from "../../src/index.ts";
import { ENTITLED } from "../support.ts";
import { loadFixture, startHarness } from "./harness.ts";

const NODE_ENVS = ["development", "test", "production"] as const;

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

/**
 * The runtime a deployment builds: the platform registry and the setting
 * loadEnv reads from the whole environment, the retired flag set in it. The
 * runtime takes no other input from the environment, NODE_ENV included.
 */
function deploymentRuntime(
  nodeEnv: (typeof NODE_ENVS)[number],
  accessMethods?: string,
  registry = createPlatformRegistry(),
): CollectorRuntime {
  const env = loadEnv({
    ...DEPLOYMENT_ENV,
    NODE_ENV: nodeEnv,
    COLLECTORS_ACCESS_METHODS: accessMethods,
    // Retired: an UNVERIFIED source never runs, whatever this once said.
    COLLECTORS_ALLOW_UNVERIFIED: "true",
  });
  return new CollectorRuntime({
    registry,
    accessMethods: enabledAccessMethods(env),
    network: { rateLimiter: { acquire: () => Promise.resolve({ allowed: true }) } },
  });
}

describe("every platform source declares how it is reached", () => {
  it("declares at least one access method, at most one keyed, and never the operator method", () => {
    expect(PLATFORM_SOURCES.length).toBeGreaterThan(40);
    for (const source of PLATFORM_SOURCES) {
      expect(source.access.length, source.id).toBeGreaterThan(0);
      expect(source.access, source.id).not.toContain("operator");
      expect(source.id.startsWith(OPERATOR_ID_PREFIX), source.id).toBe(false);
    }
  });

  it("names a keyed method only where the audit records a key, token or paid account", () => {
    const keyed = Object.fromEntries(
      PLATFORM_SOURCES.filter((source) => source.access.some((method) => method !== "open")).map(
        (source) => [source.id, source.access],
      ),
    );
    expect(keyed).toEqual({
      ucdp: ["official"],
      reliefweb: ["official"],
      hibp: ["official"],
      bluesky: ["open", "official"],
      "reddit-api": ["official"],
      "jina-reader": ["open", "official"],
      "brave-search": ["official"],
      "github-api": ["open", "official"],
      kpler: ["licensed"],
      "youtube-data-api": ["official"],
    });
  });
});

describe("the operator method is off unless configuration names it (RELEASE-BLOCKING, acceptance a)", () => {
  it.each(NODE_ENVS)(
    "NODE_ENV=%s: a deployment's runtime enables open, official and licensed only",
    (nodeEnv) => {
      const runtime = deploymentRuntime(nodeEnv);
      expect(runtime.accessMethods).toEqual(["open", "official", "licensed"]);
      for (const source of runtime.sources()) {
        for (const method of source.methods) {
          if (method.kind === "operator") expect(method.enabled).toBe(false);
        }
      }
    },
  );

  it("ships no collector that reads through it", () => {
    for (const entry of createPlatformRegistry().list()) {
      expect(entry.accessMethods, entry.id).not.toContain("operator");
    }
  });
});

describe("a BLOCKED or UNVERIFIED platform source never runs (RELEASE-BLOCKING, acceptance b)", () => {
  const target = { type: "DOMAIN", value: "example.com" } as const;

  it.each(NODE_ENVS)(
    "NODE_ENV=%s: every collector on a BLOCKED or UNVERIFIED source is refused, every method enabled or not",
    (nodeEnv) => {
      for (const methods of [undefined, "open,official,licensed,operator"]) {
        const runtime = deploymentRuntime(nodeEnv, methods);
        const entries = runtime.registry.list();
        const notPermitted = entries.filter((entry) => entry.commercialUse !== "PERMITTED");
        expect(notPermitted.map((entry) => entry.id).sort()).toEqual([
          "commoncrawl",
          "crtsh",
          "devto",
          "dns",
          "github",
          "hackernews",
          "rdap",
          "wayback",
        ]);
        for (const entry of notPermitted) {
          const refusal =
            entry.commercialUse === "BLOCKED" ? "LICENCE_BLOCKED" : "UNVERIFIED_SOURCE_NOT_ALLOWED";
          expect(runtime.access(entry.id), entry.id).toMatchObject({ runsVia: null, refusal });
          // Refused on its licence, before its target is even read.
          const admission: Admission = { target, entitlement: ENTITLED, scopeAuthorisation: null };
          expect(runtime.admit(entry.id, admission), entry.id).toMatchObject({
            status: "REFUSED",
            reason: refusal,
          });
        }
      }
    },
  );

  it("plans a domain on PERMITTED collectors only: GDELT's news, and nothing UNVERIFIED", () => {
    const runtime = deploymentRuntime("production");
    const admitted = runtime.registry
      .list()
      .filter((entry) => entry.targetTypes.includes("DOMAIN"))
      .filter(
        (entry) =>
          runtime.admit(entry.id, { target, entitlement: ENTITLED, scopeAuthorisation: null }) ===
          null,
      )
      .map((entry) => entry.id);
    expect(admitted).toEqual(["news"]);
  });
});

describe("what cannot run says so with null and a reason, never 0 (RELEASE-BLOCKING, acceptance c)", () => {
  it("gives every platform collector and source either a method to run via, or null and why", () => {
    const runtime = deploymentRuntime("production");
    for (const entry of runtime.registry.list()) {
      const access = runtime.access(entry.id);
      if (access.runsVia === null) {
        expect(access.reason.trim().length, entry.id).toBeGreaterThan(0);
        expect(access.vaultIds, entry.id).toEqual([]);
      } else {
        expect(access.runsVia.length, entry.id).toBeGreaterThan(0);
        expect(access.reason, entry.id).toBeNull();
      }
    }
    for (const source of runtime.sources()) {
      expect(source.enabled, source.id).toBe(source.runsVia !== null);
      if (source.runsVia === null)
        expect(source.reason.trim().length, source.id).toBeGreaterThan(0);
    }
    expect(JSON.stringify(runtime.sources())).not.toContain('"runsVia":[]');
  });
});

describe("GDELT's DOC API, the first source on access methods: open, PERMITTED, runs as before", () => {
  it("declares exactly the open method, PERMITTED, enabled here; news runs via it and is handed no credential", () => {
    const declared = PLATFORM_SOURCES.find((source) => source.id === "gdelt-doc");
    expect(declared?.access).toEqual(["open"]);
    expect(declared?.licence.commercialUse).toBe("PERMITTED");
    for (const nodeEnv of NODE_ENVS) {
      const runtime = deploymentRuntime(nodeEnv);
      expect(runtime.sources().find((source) => source.id === "gdelt-doc")).toEqual({
        id: "gdelt-doc",
        label: "GDELT DOC 2.0 API",
        methods: [{ kind: "open", enabled: true, licenceVerdict: "PERMITTED", runnable: true }],
        licenceVerdict: "PERMITTED",
        enabled: true,
        runsVia: ["open"],
        refusal: null,
        reason: null,
      });
      expect(runtime.access("news")).toEqual({
        methods: [{ kind: "open", enabled: true, licenceVerdict: "PERMITTED", runnable: true }],
        vaultIds: [],
        runsVia: ["open"],
        refusal: null,
        reason: null,
      });
    }
  });

  it("sends no credential, even when the tenant holds one", async () => {
    const harness = await startHarness({
      collectors: PLATFORM_COLLECTORS.filter((collector) => collector.declaration.id === "news"),
      fixtures: [loadFixture("news", "found")],
      allowUnverifiedSources: false,
    });
    try {
      const outcome = await harness.run(
        "news",
        { type: "TOPIC", value: "climate change" },
        { credentials: new Map([["github", { expose: () => "[a tenant key]" }]]) },
      );
      expect(outcome.status).toBe("FOUND");
      const authorization = harness.requests.map((request) => request.headers.authorization);
      expect(authorization).toEqual([undefined]);
    } finally {
      await harness.close();
    }
  });

  it("hands GitHub's key only while the official method is enabled: off, it runs open and sends none", async () => {
    // A platform collector that does read a key (github-api is open or official).
    const github = PLATFORM_COLLECTORS.filter((collector) => collector.declaration.id === "github");
    const fixtures = ["user-octocat", "repos-octocat", "commits-octocat"].map((name) =>
      loadFixture("github", name),
    );
    const key = new Map([["github", { expose: () => "[tenant key]" }]]);
    for (const [accessMethods, sent] of [
      [["open"], undefined],
      [["open", "official"], "Bearer [tenant key]"],
    ] as const) {
      // Its source is UNVERIFIED: the harness replays its recorded answers.
      const harness = await startHarness({ collectors: github, fixtures, accessMethods });
      try {
        const outcome = await harness.run(
          "github",
          { type: "USERNAME", value: "octocat" },
          { credentials: key },
        );
        expect(outcome.status, accessMethods.join()).toBe("FOUND");
        expect(new Set(harness.requests.map((request) => request.headers.authorization))).toEqual(
          new Set([sent]),
        );
      } finally {
        await harness.close();
      }
    }
  });

  it("stops if open is not enabled: a deployment that turns open off turns GDELT off, and says so", () => {
    const access = deploymentRuntime("production", "official,licensed").access("news");
    expect(access).toMatchObject({ runsVia: null, refusal: "ACCESS_METHOD_NOT_ENABLED" });
    expect(access.reason).toBe("Its only access method, open, is not enabled in this deployment.");
  });
});

// ── The attach interface ──────────────────────────────────────────────────

/** An operator's own source, test code only: the product ships none. */
function operatorSource(overrides: Partial<SourceDeclaration> = {}): SourceDeclaration {
  return {
    id: "operator.own",
    name: "[Operator's own service]",
    access: ["operator"],
    licence: {
      commercialUse: "PERMITTED",
      reason: "[the operator's own terms, read by the operator]",
      check: {
        checkedOn: "2026-10-16",
        sourceUrl: "https://example.com/terms",
        recordedIn: "[test]",
      },
    },
    network: {
      protocol: "https",
      hosts: ["own.example.com"],
      rateLimit: { requests: 1, intervalSeconds: 1, basis: "SELF_IMPOSED", note: "[test]" },
      operators: [{ name: "Operator", hosts: ["own.example.com"] }],
    },
    attribution: null,
    ...overrides,
  };
}

function operatorCollector(
  overrides: {
    readonly id?: string;
    readonly discipline?: "PERSON" | "TECHINT";
    readonly source?: string;
    readonly credentials?: { readonly vaultIds: readonly string[]; readonly runsWithout: boolean };
  } = {},
): Collector {
  return defineCollector(
    {
      id: "operator.own-collector",
      version: "0.0.1",
      displayName: "[Operator collector]",
      discipline: "PERSON",
      targetTypes: ["USERNAME"],
      collectionMode: "PASSIVE_API",
      source: "operator.own",
      credentials: { vaultIds: ["operator-account"], runsWithout: false },
      claimStrength: "REPORTED",
      timeoutMs: 5_000,
      resultSchema: z.object({ derived: z.object({}) }),
      ...overrides,
    },
    () => Promise.reject(new Error("[test: never run]")),
  );
}

describe("the operator attach interface: an operator's own collector, attached, off by default", () => {
  const attach = (attachment: OperatorAttachment) => () =>
    createPlatformRegistry({ operatorAttachments: [attachment] });

  it("registers one under its own label and source, refused until the deployment names operator", () => {
    const registry = attach({ source: operatorSource(), collector: operatorCollector() })();
    expect(registry.entry("operator.own-collector")).toMatchObject({
      label: "[Operator collector]",
      discipline: "PERSON",
      accessMethods: ["operator"],
    });
    expect(
      deploymentRuntime("production", undefined, registry).access("operator.own-collector"),
    ).toMatchObject({
      runsVia: null,
      refusal: "ACCESS_METHOD_NOT_ENABLED",
    });
    expect(
      deploymentRuntime("production", "open,operator", registry).access("operator.own-collector"),
    ).toMatchObject({ runsVia: ["operator"], vaultIds: ["operator-account"] });
  });

  it("never runs one whose own verdict is not PERMITTED, operator enabled or not", () => {
    const registry = attach({
      source: operatorSource({
        licence: { commercialUse: "UNVERIFIED", reason: "[not checked]", check: null },
      }),
      collector: operatorCollector(),
    })();
    expect(
      deploymentRuntime("production", "open,operator", registry).access("operator.own-collector"),
    ).toMatchObject({ runsVia: null, refusal: "UNVERIFIED_SOURCE_NOT_ALLOWED" });
  });

  it("refuses an attachment that is not the operator's own: a platform host, another method, a platform id, its own source unread", () => {
    const gdeltHost = {
      protocol: "https" as const,
      hosts: ["api.gdeltproject.org"],
      rateLimit: {
        requests: 100,
        intervalSeconds: 1,
        basis: "SELF_IMPOSED" as const,
        note: "[test]",
      },
      operators: [{ name: "GDELT", hosts: ["api.gdeltproject.org"] }],
    };
    expect(
      attach({ source: operatorSource({ network: gdeltHost }), collector: operatorCollector() }),
    ).toThrow(/another source's/);
    expect(
      attach({
        source: operatorSource({ id: "own", access: ["official"] }),
        collector: operatorCollector({ source: "own" }),
      }),
    ).toThrow(/operator method alone/);
    expect(
      attach({ source: operatorSource(), collector: operatorCollector({ id: "own-collector" }) }),
    ).toThrow(/exactly when the collector reads through the operator method/);
    expect(
      attach({ source: operatorSource(), collector: operatorCollector({ source: "gdelt-doc" }) }),
    ).toThrow(/reads the attachment's own source/);
  });

  it("refuses one that names another source's tenant key: a key reaches only the source it was set for", () => {
    // The tenant's GitHub key is github-api's, for its official method.
    expect(
      attach({
        source: operatorSource(),
        collector: operatorCollector({ credentials: { vaultIds: ["github"], runsWithout: false } }),
      }),
    ).toThrow(/vault id "github" belongs to source "github-api"/);
  });

  it("refuses one not declared a person collector: it may read people whatever it says (fail closed)", () => {
    expect(
      attach({ source: operatorSource(), collector: operatorCollector({ discipline: "TECHINT" }) }),
    ).toThrow(/person collector/);
  });

  it("refuses one on Instagram, Facebook or X", () => {
    for (const host of ["i.instagram.com", "m.facebook.com", "api.x.com"]) {
      const network = {
        protocol: "https" as const,
        hosts: [host],
        rateLimit: {
          requests: 1,
          intervalSeconds: 1,
          basis: "SELF_IMPOSED" as const,
          note: "[test]",
        },
        operators: [{ name: "Operator", hosts: [host] }],
      };
      expect(
        attach({ source: operatorSource({ network }), collector: operatorCollector() }),
      ).toThrow(/never collected from/);
    }
  });
});

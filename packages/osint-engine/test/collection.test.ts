/**
 * RELEASE-BLOCKING. The collector frame end to end: real Postgres (this
 * suite's own database, as the application role), real Redis, and a real HTTP
 * server on loopback standing in for upstreams, reached only after the
 * fetcher has run every production check. Collectors here are fakes defined
 * in this file; no real collector exists yet (Phase 3B).
 *
 * Each describe block is one of the Phase 3A release-blocking requirements.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { connect, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CollectorRegistry,
  CollectorRuntime,
  defineCollector,
  type Collector,
  type CollectorDeclaration,
  type CollectorImplementation,
  type SourceDeclaration,
} from "@repo/collectors";
import { allowsUnverifiedSources } from "@repo/config";
import { parseTenantId, type TenantId } from "@repo/core";
import {
  CollectorNotEnabledError,
  contentRef,
  createDatabase,
  FileSystemContentStore,
  hashContent,
  type Database,
} from "@repo/db";
import {
  createRedisClient,
  CredentialVault,
  MasterKey,
  SlidingLogRateLimiter,
  waitForRedisReady,
} from "@repo/integrations";
import type { Redis } from "ioredis";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  CollectionExecutor,
  redisUpstreamRateLimiter,
  VaultCredentialSource,
  type CollectionReport,
} from "../src/index.ts";
import { TEST_ENGINE } from "./config.ts";

// ── The world: database, Redis, content store, vault, one loopback upstream ──

let db: Database;
let owner: pg.Client;
let redis: Redis;
let contentDir: string;
let contentStore: FileSystemContentStore;
let vault: CredentialVault;
let upstreamPort: number;
let closeUpstream: () => Promise<void>;
const requests: { host: string; path: string; headers: Record<string, unknown> }[] = [];
const routes = new Map<string, (res: ServerResponse) => void>();

/** Checked, never contacted: sockets go to the loopback server after every check. */
const PUBLIC_TEST_ADDRESS = "1.1.1.1";

beforeAll(async () => {
  db = createDatabase({
    connectionString: TEST_ENGINE.databaseUrl,
    onIdleClientError: () => undefined,
  });
  owner = new pg.Client({ connectionString: TEST_ENGINE.databaseOwnerUrl });
  await owner.connect();
  redis = createRedisClient({
    url: TEST_ENGINE.redisUrl,
    commandTimeoutMs: 2_000,
    connectTimeoutMs: 2_000,
  });
  await waitForRedisReady(redis, { timeoutMs: 5_000 });
  contentDir = await mkdtemp(join(tmpdir(), "engine-content-"));
  contentStore = new FileSystemContentStore(contentDir);
  vault = new CredentialVault(
    new MasterKey({ keyId: "test-1", keyBase64: randomBytes(32).toString("base64") }),
  );

  const server = createServer((req, res) => {
    const key = `${req.headers.host ?? ""}${req.url ?? ""}`;
    requests.push({ host: req.headers.host ?? "", path: req.url ?? "", headers: req.headers });
    const route = routes.get(key);
    if (route === undefined) res.writeHead(404).end("[]");
    else route(res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  upstreamPort = (server.address() as AddressInfo).port;
  closeUpstream = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => {
        resolve();
      });
    });
});

afterEach(() => {
  routes.clear();
  requests.length = 0;
});

afterAll(async () => {
  await closeUpstream();
  await redis.quit();
  await owner.end();
  await db.close();
  await rm(contentDir, { recursive: true, force: true });
});

// ── Sources, fake collectors and the engine ─────────────────────────────────

function source(id: string, overrides: Partial<SourceDeclaration> = {}): SourceDeclaration {
  return {
    id,
    name: `[Source ${id}]`,
    licence: {
      commercialUse: "PERMITTED",
      reason: "[test source]",
      check: {
        checkedOn: "2026-09-28",
        sourceUrl: "https://example.com/terms",
        recordedIn: "[test]",
      },
    },
    network: {
      protocol: "http",
      hosts: [`${id}.test`],
      rateLimit: { requests: 100, intervalSeconds: 1, basis: "SELF_IMPOSED", note: "[test]" },
    },
    attribution: null,
    ...overrides,
  };
}

const SOURCES: SourceDeclaration[] = [
  source("one"),
  source("two"),
  source("strict", {
    network: {
      protocol: "http",
      hosts: ["strict.test"],
      rateLimit: {
        requests: 1,
        intervalSeconds: 5,
        basis: "UPSTREAM_STATED",
        note: "[test: like GDELT]",
      },
    },
  }),
  source("blocked", {
    licence: {
      commercialUse: "BLOCKED",
      reason: "[non-commercial licence]",
      check: { checkedOn: "2026-09-28", sourceUrl: null, recordedIn: "[test]" },
    },
  }),
  source("unverified", {
    licence: { commercialUse: "UNVERIFIED", reason: "[terms not checked]", check: null },
  }),
];

const NAMES = z.object({ names: z.array(z.string()).min(1), source: z.string().optional() });
type Names = z.output<typeof NAMES>;

function declaration(
  id: string,
  sourceId: string,
  overrides: Partial<CollectorDeclaration<typeof NAMES>> = {},
): CollectorDeclaration<typeof NAMES> {
  return {
    id,
    version: "2.0.1",
    displayName: `[Label of ${id}]`,
    discipline: "TECHINT",
    targetTypes: ["DOMAIN"],
    collectionMode: "PASSIVE_API",
    source: sourceId,
    credentials: { vaultIds: [], runsWithout: true },
    claimStrength: "REPORTED",
    timeoutMs: 5_000,
    resultSchema: NAMES,
    ...overrides,
  };
}

/** Every collector whose code ran, in order. */
const called: string[] = [];

/** Reads `http://<host>/names?q=<target>` and reports the names, citing that response. */
function namesFrom(host: string, id: string): CollectorImplementation<Names> {
  return async (ctx) => {
    called.push(id);
    const key = ctx.credentials.get("one-key");
    const response = await ctx.fetch(`http://${host}/names?q=${ctx.target.value}`, {
      method: "GET",
      timeoutMs: 800,
      ...(key === null ? {} : { headers: { authorization: `Bearer ${key.expose()}` } }),
    });
    if (response.status === 404) return ctx.notFound(response, "no names for this target");
    const names = z.array(z.string()).parse(response.json());
    // The payload even claims another source; the evidence label ignores it.
    return ctx.found({ names, source: "crtsh" }, [{ response, observedAt: null }]);
  };
}

const COLLECTORS: Collector[] = [
  defineCollector(declaration("fake.one", "one"), namesFrom("one.test", "fake.one")),
  defineCollector(declaration("fake.two", "two"), namesFrom("two.test", "fake.two")),
  defineCollector(
    declaration("fake.strict-a", "strict"),
    namesFrom("strict.test", "fake.strict-a"),
  ),
  defineCollector(
    declaration("fake.strict-b", "strict"),
    namesFrom("strict.test", "fake.strict-b"),
  ),
  defineCollector(
    declaration("fake.blocked", "blocked"),
    namesFrom("blocked.test", "fake.blocked"),
  ),
  defineCollector(
    declaration("fake.unverified", "unverified"),
    namesFrom("unverified.test", "fake.unverified"),
  ),
  defineCollector(
    declaration("fake.active", "one", { collectionMode: "ACTIVE" }),
    namesFrom("one.test", "fake.active"),
  ),
  defineCollector(
    declaration("fake.person", "one", { discipline: "PERSON" }),
    namesFrom("one.test", "fake.person"),
  ),
  defineCollector(
    declaration("fake.keyed", "two", {
      credentials: { vaultIds: ["one-key"], runsWithout: false },
    }),
    namesFrom("two.test", "fake.keyed"),
  ),
  defineCollector(declaration("fake.errors", "one"), async (ctx) => {
    const response = await ctx.fetch("http://one.test/error", { method: "GET", timeoutMs: 800 });
    return ctx.found({ names: ["from a failed request"] }, [{ response, observedAt: null }]);
  }),
];

function engine(
  options: {
    allowUnverifiedSources?: boolean;
    limiterPrefix?: string;
    answers?: Record<string, string[]>;
    port?: number;
  } = {},
): CollectionExecutor {
  const answers: Record<string, string[]> = options.answers ?? {
    "one.test": [PUBLIC_TEST_ADDRESS],
    "two.test": [PUBLIC_TEST_ADDRESS],
    "strict.test": [PUBLIC_TEST_ADDRESS],
    "blocked.test": [PUBLIC_TEST_ADDRESS],
    "unverified.test": [PUBLIC_TEST_ADDRESS],
  };
  const limiter = new SlidingLogRateLimiter({
    redis,
    keyPrefix: options.limiterPrefix ?? `test:${randomUUID()}`,
  });
  const runtime = new CollectorRuntime({
    registry: new CollectorRegistry({ sources: SOURCES, collectors: COLLECTORS }),
    allowUnverifiedSources: options.allowUnverifiedSources ?? true,
    network: {
      rateLimiter: redisUpstreamRateLimiter(limiter),
      resolver: (host) =>
        Promise.resolve(
          (answers[host] ?? []).map((address) => ({
            address,
            family: address.includes(":") ? (6 as const) : (4 as const),
          })),
        ),
      socketFactory: () => connect(options.port ?? upstreamPort, "127.0.0.1"),
    },
  });
  return new CollectionExecutor({
    db,
    runtime,
    contentStore,
    credentials: new VaultCredentialSource(vault),
  });
}

// ── Tenants ─────────────────────────────────────────────────────────────────

async function newTenant(tag: string): Promise<{ tenantId: TenantId; userId: string }> {
  const tenantId = parseTenantId(randomUUID());
  await db.provisionTenant({ tenantId, name: `[Tenant ${tag}]`, region: "IN" });
  const user = await db.withTenant(tenantId, ({ repos }) =>
    repos.users.create({
      email: `analyst-${tag}@example.com`,
      displayName: `[Analyst ${tag}]`,
      status: "ACTIVE",
    }),
  );
  return { tenantId, userId: user.id };
}

/** Changes a tenant's plan or vetting as an operator would: the application role cannot. */
async function setEntitlement(
  tenantId: TenantId,
  plan: string,
  vettingStatus: string,
): Promise<void> {
  await owner.query("begin");
  try {
    await owner.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    await owner.query("update public.tenants set plan = $1, vetting_status = $2", [
      plan,
      vettingStatus,
    ]);
    await owner.query("commit");
  } catch (error) {
    await owner.query("rollback");
    throw error;
  }
}

async function evidenceCount(tenantId: TenantId): Promise<number> {
  return (await db.withTenant(tenantId, ({ repos }) => repos.evidence.list({ limit: 1_000 })))
    .length;
}

async function credentialReads(tenantId: TenantId): Promise<number> {
  const rows = await db.withTenant(tenantId, ({ repos }) => repos.auditLog.list({ limit: 1_000 }));
  return rows.filter((row) => row.action === "credential.read").length;
}

const DOMAIN = { type: "DOMAIN", value: "Example.COM" } as const;
const collect = (executor: CollectionExecutor, tenantId: TenantId, collectorId: string) =>
  executor.collect(tenantId, { collectorId, target: DOMAIN, jobId: null, requestId: null });

function status(report: CollectionReport): string {
  return report.outcome.status === "REFUSED"
    ? `REFUSED:${report.outcome.reason}`
    : report.outcome.status === "FAILED" || report.outcome.status === "UNAVAILABLE"
      ? `${report.outcome.status}:${report.outcome.error.code}`
      : report.outcome.status;
}

// ── The requirements ────────────────────────────────────────────────────────

describe("a BLOCKED collector cannot be executed by any path (RELEASE-BLOCKING)", () => {
  it("is refused before its code runs, reads no credential, reaches no upstream and writes no evidence", async () => {
    const { tenantId } = await newTenant("blocked");
    routes.set("blocked.test/names?q=example.com", (res) => res.end('["leaked"]'));
    const report = await collect(
      engine({ allowUnverifiedSources: true }),
      tenantId,
      "fake.blocked",
    );
    expect(status(report)).toBe("REFUSED:LICENCE_BLOCKED");
    expect(report.evidenceIds).toEqual([]);
    expect(called).not.toContain("fake.blocked");
    expect(requests).toEqual([]);
    expect(await evidenceCount(tenantId)).toBe(0);
    expect(await credentialReads(tenantId)).toBe(0);
  });

  it("is recorded for the tenant as blocked, and the database refuses its evidence written directly", async () => {
    const { tenantId } = await newTenant("blocked-db");
    await collect(engine(), tenantId, "fake.blocked");
    const row = await db.withTenant(tenantId, ({ repos }) =>
      repos.collectorsRegistry.find("fake.blocked"),
    );
    expect(row).toMatchObject({
      enabled: false,
      commercialUse: "BLOCKED",
      sourceLabel: "[Label of fake.blocked]",
    });
    const payload = randomBytes(8);
    const hash = hashContent(payload);
    await expect(
      db.withTenant(tenantId, ({ repos }) =>
        repos.evidence.record({
          collectorId: "fake.blocked",
          collectorVersion: "2.0.1",
          jobId: null,
          sourceUrl: "http://blocked.test/names",
          contentHash: hash,
          payloadRef: contentRef(tenantId, hash),
          observedAt: null,
          collectedAt: null,
          claimStrength: "REPORTED",
        }),
      ),
    ).rejects.toBeInstanceOf(CollectorNotEnabledError);
  });
});

describe("an UNVERIFIED collector is refused when the production flag is set (RELEASE-BLOCKING)", () => {
  it("refuses in production by default, and runs only when explicitly allowed", async () => {
    const { tenantId } = await newTenant("unverified");
    routes.set("unverified.test/names?q=example.com", (res) => res.end('["a"]'));
    const production = allowsUnverifiedSources({
      NODE_ENV: "production",
      COLLECTORS_ALLOW_UNVERIFIED: undefined,
    });
    const refused = await collect(
      engine({ allowUnverifiedSources: production }),
      tenantId,
      "fake.unverified",
    );
    expect(status(refused)).toBe("REFUSED:UNVERIFIED_SOURCE_NOT_ALLOWED");
    expect(requests).toEqual([]);
    expect(await evidenceCount(tenantId)).toBe(0);

    const optedIn = allowsUnverifiedSources({
      NODE_ENV: "production",
      COLLECTORS_ALLOW_UNVERIFIED: "true",
    });
    expect(
      status(
        await collect(engine({ allowUnverifiedSources: optedIn }), tenantId, "fake.unverified"),
      ),
    ).toBe("FOUND");
  });
});

describe("evidence takes its source label from the registry, never from the collector (RELEASE-BLOCKING)", () => {
  it("labels each collector's evidence from its registry entry, distinguishably, whatever the payload claims", async () => {
    const { tenantId } = await newTenant("labels");
    routes.set("one.test/names?q=example.com", (res) => res.end('["from-one"]'));
    routes.set("two.test/names?q=example.com", (res) => res.end('["from-two"]'));
    const executor = engine();
    const reports = [
      await collect(executor, tenantId, "fake.one"),
      await collect(executor, tenantId, "fake.two"),
    ];
    const rows = await db.withTenant(tenantId, async ({ repos }) =>
      Promise.all(
        reports
          .flatMap((report) => report.evidenceIds)
          .map(async (id) => {
            const row = await repos.evidence.findById(id);
            const registration =
              row === null ? null : await repos.collectorsRegistry.find(row.collectorId);
            return {
              collectorId: row?.collectorId,
              label: registration?.sourceLabel,
              host: row?.sourceUrl === null || row === null ? null : new URL(row.sourceUrl).host,
            };
          }),
      ),
    );
    expect(rows).toEqual([
      { collectorId: "fake.one", label: "[Label of fake.one]", host: "one.test" },
      { collectorId: "fake.two", label: "[Label of fake.two]", host: "two.test" },
    ]);
  });
});

describe("the shared rate limiter throttles across collectors sharing an upstream (RELEASE-BLOCKING)", () => {
  it("holds two collectors, in two separate workers, to one upstream's limit, and leaves other upstreams alone", async () => {
    const { tenantId } = await newTenant("limits");
    routes.set("strict.test/names?q=example.com", (res) => res.end('["a"]'));
    routes.set("one.test/names?q=example.com", (res) => res.end('["b"]'));
    const prefix = `test:${randomUUID()}`;
    const workerA = engine({ limiterPrefix: prefix });
    const workerB = engine({ limiterPrefix: prefix });
    expect(status(await collect(workerA, tenantId, "fake.strict-a"))).toBe("FOUND");
    expect(status(await collect(workerB, tenantId, "fake.strict-b"))).toBe(
      "UNAVAILABLE:UPSTREAM_RATE_LIMITED",
    );
    expect(status(await collect(workerB, tenantId, "fake.one"))).toBe("FOUND");
    expect(requests.map((request) => request.host)).toEqual(["strict.test", "one.test"]);
  });
});

describe("SSRF protection (RELEASE-BLOCKING)", () => {
  it.each([
    ["loopback", ["127.0.0.1"]],
    ["the cloud metadata endpoint", ["169.254.169.254"]],
    ["a private range", ["10.0.0.7"]],
  ])(
    "refuses a declared host that resolves to %s, and records nothing",
    async (_label, addresses) => {
      const { tenantId } = await newTenant("ssrf");
      routes.set("one.test/names?q=example.com", (res) => res.end('["internal"]'));
      const report = await collect(
        engine({ answers: { "one.test": addresses } }),
        tenantId,
        "fake.one",
      );
      expect(status(report)).toBe("FAILED:DESTINATION_REFUSED");
      expect(requests).toEqual([]);
      expect(await evidenceCount(tenantId)).toBe(0);
    },
  );
});

describe("an ACTIVE collector needs a scope authorisation from the database (RELEASE-BLOCKING)", () => {
  it("refuses without one, with one for another target, or with another tenant's; runs with one in force", async () => {
    const tenant = await newTenant("active");
    const other = await newTenant("active-other");
    routes.set("one.test/names?q=example.com", (res) => res.end('["a"]'));
    const executor = engine();
    const at = (iso: string) => new Date(Date.parse(iso));
    const authorise = (who: { tenantId: TenantId; userId: string }, target: string) =>
      db.withTenant(who.tenantId, ({ repos }) =>
        repos.scopeAuthorisations.create({
          targetType: "DOMAIN",
          target,
          authorisedByUserId: who.userId,
          basis: "[signed engagement letter]",
          validFrom: at("2020-01-01T00:00:00Z"),
          validUntil: at("2090-01-01T00:00:00Z"),
        }),
      );

    expect(status(await collect(executor, tenant.tenantId, "fake.active"))).toBe(
      "REFUSED:SCOPE_AUTHORISATION_REQUIRED",
    );
    await authorise(tenant, "example.org");
    await authorise(other, "example.com");
    expect(status(await collect(executor, tenant.tenantId, "fake.active"))).toBe(
      "REFUSED:SCOPE_AUTHORISATION_REQUIRED",
    );
    expect(called).not.toContain("fake.active");
    expect(await evidenceCount(tenant.tenantId)).toBe(0);

    const granted = await authorise(tenant, "example.com");
    const allowed = await collect(executor, tenant.tenantId, "fake.active");
    expect(status(allowed)).toBe("FOUND");
    expect(allowed.evidenceIds).toHaveLength(1);

    await db.withTenant(tenant.tenantId, ({ repos }) =>
      repos.scopeAuthorisations.revoke(granted.id),
    );
    expect(status(await collect(executor, tenant.tenantId, "fake.active"))).toBe(
      "REFUSED:SCOPE_AUTHORISATION_REQUIRED",
    );
  });
});

describe("a PERSON collector needs entitlement AND approved vetting (RELEASE-BLOCKING)", () => {
  it("refuses on the default plan, refuses without approved vetting, and runs with both", async () => {
    const { tenantId } = await newTenant("person");
    routes.set("one.test/names?q=example.com", (res) => res.end('["a"]'));
    const executor = engine();
    expect(status(await collect(executor, tenantId, "fake.person"))).toBe(
      "REFUSED:MODULE_NOT_IN_PLAN",
    );
    await setEntitlement(tenantId, "TECHINT_AND_PERSON", "PENDING");
    expect(status(await collect(executor, tenantId, "fake.person"))).toBe(
      "REFUSED:VETTING_NOT_APPROVED",
    );
    await setEntitlement(tenantId, "TECHINT", "APPROVED");
    expect(status(await collect(executor, tenantId, "fake.person"))).toBe(
      "REFUSED:MODULE_NOT_IN_PLAN",
    );
    expect(called).not.toContain("fake.person");
    expect(await evidenceCount(tenantId)).toBe(0);
    await setEntitlement(tenantId, "TECHINT_AND_PERSON", "APPROVED");
    expect(status(await collect(executor, tenantId, "fake.person"))).toBe("FOUND");
  });
});

describe("a failed collection never produces evidence, a zero or an empty result (RELEASE-BLOCKING)", () => {
  it("records nothing for an unreachable upstream, a failed response, or nothing found", async () => {
    const { tenantId } = await newTenant("failures");
    routes.set("one.test/error", (res) => res.writeHead(500).end('["from a 500"]'));
    const down = await (async () => {
      const server = createServer(() => undefined);
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const { port } = server.address() as AddressInfo;
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      );
      return port;
    })();
    const reports = [
      await collect(engine({ port: down }), tenantId, "fake.one"),
      await collect(engine(), tenantId, "fake.errors"),
      await collect(engine(), tenantId, "fake.two"),
    ];
    expect(reports.map(status)).toEqual([
      "UNAVAILABLE:UPSTREAM_UNREACHABLE",
      "FAILED:COLLECTOR_CONTRACT_VIOLATION",
      "NOT_FOUND",
    ]);
    for (const report of reports) {
      expect(report.evidenceIds).toEqual([]);
      expect("result" in report.outcome).toBe(false);
    }
    expect(await evidenceCount(tenantId)).toBe(0);
  });

  it("writes FOUND evidence exactly: payload by hash, observed_at null, collected_at measured", async () => {
    const { tenantId } = await newTenant("found");
    routes.set("one.test/names?q=example.com", (res) => res.end('["a","b"]'));
    const report = await collect(engine(), tenantId, "fake.one");
    expect(report.outcome.status).toBe("FOUND");
    const [id] = report.evidenceIds;
    const row = await db.withTenant(tenantId, ({ repos }) => repos.evidence.findById(id ?? ""));
    const expectedHash = `sha256:${createHash("sha256").update('["a","b"]').digest("hex")}`;
    expect(row).toMatchObject({
      collectorId: "fake.one",
      collectorVersion: "2.0.1",
      jobId: null,
      sourceUrl: "http://one.test/names?q=example.com",
      contentHash: expectedHash,
      observedAt: null,
      claimStrength: "REPORTED",
    });
    expect(row?.collectedAt).toBeInstanceOf(Date);
    const stored = await contentStore.get(tenantId, expectedHash);
    expect(new TextDecoder().decode(stored)).toBe('["a","b"]');
  });
});

describe("credentials", () => {
  it("reports NEEDS_CREDENTIALS without one, and reads the tenant's vault, audited, when there is one", async () => {
    const { tenantId } = await newTenant("credentials");
    routes.set("two.test/names?q=example.com", (res) => res.end('["keyed"]'));
    const executor = engine();
    const missing = await collect(executor, tenantId, "fake.keyed");
    expect(missing.outcome).toMatchObject({ status: "NEEDS_CREDENTIALS", missing: ["one-key"] });
    expect(requests).toEqual([]);

    await db.withTenant(tenantId, (ctx) =>
      vault.store(ctx, { provider: "one-key", label: "[Test key]", secret: "tenant-secret-value" }),
    );
    const found = await collect(executor, tenantId, "fake.keyed");
    expect(found.outcome.status).toBe("FOUND");
    expect(requests[0]?.headers.authorization).toBe("Bearer tenant-secret-value");
    expect(await credentialReads(tenantId)).toBe(1);
  });
});

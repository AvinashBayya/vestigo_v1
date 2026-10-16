/**
 * RELEASE-BLOCKING. Phase 4 end to end: real Postgres (this suite's own
 * database, as the application role), real Redis, real BullMQ queues and
 * worker pools, and the real registered collectors answering from the
 * collectors package's recorded fixtures (@repo/collectors/testing). No test
 * reaches the network.
 *
 * Each describe block is one Phase 4 requirement: an investigation with one
 * collector failing completes as PARTIAL with the failure shown; a replayed
 * job neither double-charges nor duplicates evidence; a hung collector does
 * not stall other queues; a failing source opens its circuit; a spent quota
 * refuses before dispatch; retries distinguish cause; and a PERSON collector
 * is gated in the worker by @repo/access; and a hung or failing case analysis
 * holds only its own queue's slots (R1-b).
 */
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { connect, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  CollectorRegistry,
  CollectorRuntime,
  defineCollector,
  PLATFORM_COLLECTORS,
  PLATFORM_SOURCES,
  type Collector,
  type SourceDeclaration,
} from "@repo/collectors";
import { loadFixture, startHarness, type Fixture, type Harness } from "@repo/collectors/testing";
import { ENGINE_VERSION } from "@repo/case-engine";
import { parseTenantId, type TargetType, type TenantId } from "@repo/core";
import { createDatabase, FileSystemContentStore, type Database, type Job } from "@repo/db";
import {
  createRedisClient,
  CredentialVault,
  MasterKey,
  RedisCircuitBreaker,
  waitForRedisReady,
  type CircuitPolicy,
} from "@repo/integrations";
import { Queue } from "bullmq";
import type { Redis } from "ioredis";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  CASE_ANALYSES_QUEUE,
  CaseAnalysisProcessor,
  CaseAnalysisQueue,
  caseInputHash,
  CollectionExecutor,
  CollectorJobProcessor,
  collectQueueName,
  DEAD_LETTER_MESSAGE,
  DEAD_LETTER_QUEUE,
  InvestigationQueue,
  JobNotReplayableError,
  JobReplayer,
  readCaseAnalysisInput,
  ReportGenerator,
  ReportQueue,
  RunCoordinator,
  RunFusion,
  selectQueues,
  startWorkerPool,
  VaultCredentialSource,
  type CaseAnalysisProcessorOptions,
  type Extractor,
  type QueueConnection,
  type RetryPolicy,
  type WorkerPool,
} from "../src/index.ts";
import { createCaseFixture, FIXTURE_COLLECTORS, type CaseFixture } from "./case-fixture.ts";
import { TEST_ENGINE } from "./config.ts";

// ── The world ─────────────────────────────────────────────────────────────

let db: Database;
let owner: pg.Client;
let redis: Redis;
let contentDir: string;
let contentStore: FileSystemContentStore;
let vault: CredentialVault;

beforeAll(async () => {
  db = createDatabase({
    connectionString: TEST_ENGINE.databaseUrl,
    onConnectionError: () => undefined,
  });
  owner = new pg.Client({ connectionString: TEST_ENGINE.databaseOwnerUrl });
  await owner.connect();
  redis = createRedisClient({
    url: TEST_ENGINE.redisUrl,
    commandTimeoutMs: 2_000,
    connectTimeoutMs: 2_000,
  });
  await waitForRedisReady(redis, { timeoutMs: 5_000 });
  contentDir = await mkdtemp(join(tmpdir(), "engine-pipeline-"));
  contentStore = new FileSystemContentStore(contentDir);
  vault = new CredentialVault(
    new MasterKey({ keyId: "test-1", keyBase64: randomBytes(32).toString("base64") }),
  );
});

afterAll(async () => {
  await redis.quit();
  await owner.end();
  await db.close();
  await rm(contentDir, { recursive: true, force: true });
});

const FAST_RETRY: RetryPolicy = { maxAttempts: 3, baseDelayMs: 20, maxDelayMs: 100 };
const LONG_COOLING: CircuitPolicy = {
  failureThreshold: 3,
  failureWindowMs: 60_000,
  coolingMs: 60_000,
  probeLeaseMs: 60_000,
};

interface Engine {
  readonly connection: QueueConnection;
  readonly breaker: RedisCircuitBreaker;
  readonly processor: CollectorJobProcessor;
  readonly investigations: InvestigationQueue;
  readonly reports: ReportQueue;
  readonly analyses: CaseAnalysisQueue;
  readonly replayer: JobReplayer;
  readonly pools: readonly WorkerPool[];
  close(): Promise<void>;
}

/**
 * The whole engine over one runtime, in its own queue and circuit namespace,
 * deployed as two pools selected by queue name: one for planning and fusion,
 * one for every source's collector queue.
 */
async function startEngine(
  runtime: CollectorRuntime,
  options: {
    readonly retry?: RetryPolicy;
    readonly circuit?: CircuitPolicy;
    readonly collectConcurrency?: number;
    readonly extractors?: Readonly<Record<string, Extractor>>;
    /** Reports and case analyses, consumed by the planning pool when given. */
    readonly reports?: ReportGenerator;
    readonly caseAnalyses?: {
      readonly processor: CaseAnalysisProcessor;
      readonly concurrency: number;
    };
  } = {},
): Promise<Engine> {
  const namespace = `vt-${randomUUID().slice(0, 8)}`;
  const connection: QueueConnection = { url: TEST_ENGINE.redisUrl, prefix: namespace };
  const retry = options.retry ?? FAST_RETRY;
  const breaker = new RedisCircuitBreaker({
    redis,
    keyPrefix: namespace,
    policy: options.circuit ?? LONG_COOLING,
  });
  const executor = new CollectionExecutor({
    db,
    runtime,
    contentStore,
    credentials: new VaultCredentialSource(vault),
  });
  const processor = new CollectorJobProcessor({ db, executor, runtime, circuit: breaker, retry });
  const coordinator = new RunCoordinator({ db, runtime });
  const fusion = new RunFusion({
    db,
    registry: runtime.registry,
    ...(options.extractors === undefined ? {} : { extractors: options.extractors }),
  });
  const sourceIds = [...new Set(runtime.registry.list().map((entry) => entry.source.id))];
  const common = {
    connection,
    sourceIds,
    coordinator,
    processor,
    fusion,
    retry,
    collectConcurrency: () => options.collectConcurrency ?? 1,
    investigationConcurrency: 2,
    fusionConcurrency: 2,
    ...(options.reports === undefined
      ? {}
      : { reports: { generator: options.reports, concurrency: 1 } }),
    ...(options.caseAnalyses === undefined ? {} : { caseAnalyses: options.caseAnalyses }),
  };
  const planning = [
    "investigations",
    "fusion",
    ...(options.reports === undefined ? [] : ["reports"]),
    ...(options.caseAnalyses === undefined ? [] : [CASE_ANALYSES_QUEUE]),
  ];
  const pools = [
    await startWorkerPool({ ...common, queues: planning }),
    await startWorkerPool({ ...common, queues: ["collect.*"] }),
  ];
  const investigations = new InvestigationQueue(connection, retry);
  const reports = new ReportQueue(connection, retry);
  const analyses = new CaseAnalysisQueue(connection, retry);
  const replayer = new JobReplayer({ db, registry: runtime.registry, connection, retry });
  return {
    connection,
    breaker,
    processor,
    investigations,
    reports,
    analyses,
    replayer,
    pools,
    async close() {
      await Promise.all(pools.map((pool) => pool.close()));
      await investigations.close();
      await reports.close();
      await analyses.close();
      await replayer.close();
    },
  };
}

// ── Tenants and runs ──────────────────────────────────────────────────────

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

/** Changes a tenant's plan or vetting, or sets a quota, as an operator would. */
async function asOwner(tenantId: TenantId, sql: string, params: unknown[]): Promise<void> {
  await owner.query("begin");
  try {
    await owner.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    await owner.query(sql, params);
    await owner.query("commit");
  } catch (error) {
    await owner.query("rollback");
    throw error;
  }
}

/** What the API does: an investigation, a QUEUED run, and its planning job. */
async function startRun(
  engine: Engine,
  tenant: { tenantId: TenantId; userId: string },
  target: string,
  requestedTargetType: TargetType | null = null,
): Promise<string> {
  const run = await db.withTenant(tenant.tenantId, async ({ repos }) => {
    const investigation = await repos.investigations.create({
      title: `[Investigation of ${target}]`,
      target,
      createdByUserId: tenant.userId,
    });
    return repos.runs.create({
      investigationId: investigation.id,
      status: "QUEUED",
      requestedByUserId: tenant.userId,
      requestedTargetType,
    });
  });
  await engine.investigations.enqueueRun(tenant.tenantId, run.id);
  return run.id;
}

async function waitFor<T>(
  what: string,
  read: () => Promise<T>,
  done: (value: T) => boolean,
  timeoutMs = 20_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline)
      throw new Error(`timed out waiting for ${what}: ${JSON.stringify(value)}`);
    await sleep(50);
  }
}

const TERMINAL_RUN = new Set(["SUCCEEDED", "PARTIAL", "FAILED", "CANCELLED"]);

async function finishedRun(tenantId: TenantId, runId: string) {
  return waitFor(
    "the run to finish",
    () => db.withTenant(tenantId, ({ repos }) => repos.runs.findById(runId)),
    (run) => run !== null && TERMINAL_RUN.has(run.status),
  );
}

function jobsOf(tenantId: TenantId, runId: string): Promise<Job[]> {
  return db.withTenant(tenantId, ({ repos }) => repos.jobs.listForRun(runId, { limit: 100 }));
}

async function evidenceIdsOf(tenantId: TenantId): Promise<string[]> {
  const rows = await db.withTenant(tenantId, ({ repos }) => repos.evidence.list({ limit: 1000 }));
  return rows.map((row) => row.id).sort();
}

async function usageOf(tenantId: TenantId) {
  const rows = await db.withTenant(tenantId, ({ repos }) =>
    repos.usageEvents.list({ limit: 1000 }),
  );
  return rows
    .filter((row) => row.unit === "UPSTREAM_REQUEST")
    .map((row) => ({ jobId: row.jobId, attempt: row.attempt, quantity: row.quantity }))
    .sort((a, b) =>
      `${String(a.jobId)}${String(a.attempt)}`.localeCompare(
        `${String(b.jobId)}${String(b.attempt)}`,
      ),
    );
}

const byCollector = (jobs: readonly Job[], collectorId: string): Job => {
  const job = jobs.find((row) => row.collectorId === collectorId);
  if (job === undefined) throw new Error(`no ${collectorId} job`);
  return job;
};

// ── Fixtures: the real registered collectors, against example.com ─────────

const platform = (ids: readonly string[]): Collector[] =>
  PLATFORM_COLLECTORS.filter((collector) => ids.includes(collector.declaration.id));

/**
 * The deliberate failure: the wayback collector's recorded 503 fixture (a
 * synthetic one; the archive cannot be made to fail on demand), re-pointed at
 * example.com's query path. Every delivery of it is UNAVAILABLE.
 */
function waybackUnavailableFor(domain: string): Fixture {
  const fixture = loadFixture("wayback", "unavailable-503");
  return {
    ...fixture,
    provenance: {
      ...fixture.provenance,
      notes: `${fixture.provenance.notes} Re-pointed at ${domain} by the Phase 4 pipeline test, as its deliberately failing collector.`,
    },
    request: {
      ...fixture.request,
      path: fixture.request.path.replace("unavailable.example", domain),
    },
  };
}

const EXAMPLE_COM_FOUND: readonly Fixture[] = [
  loadFixture("crtsh", "found-example-com"),
  loadFixture("dns", "found-example-com"),
  loadFixture("rdap", "rdap-org-example-com-redirect"),
  loadFixture("rdap", "verisign-example-com"),
];

// ── CHECKPOINT ────────────────────────────────────────────────────────────

describe("an investigation with one collector failing completes as PARTIAL, the failure shown (RELEASE-BLOCKING)", () => {
  let harness: Harness;
  let engine: Engine;
  let tenant: { tenantId: TenantId; userId: string };
  let runId: string;

  beforeAll(async () => {
    harness = await startHarness({
      collectors: platform(["crtsh", "dns", "rdap", "wayback"]),
      fixtures: [...EXAMPLE_COM_FOUND, waybackUnavailableFor("example.com")],
    });
    engine = await startEngine(harness.runtime);
    tenant = await newTenant("checkpoint");
    runId = await startRun(engine, tenant, "example.com");
    await finishedRun(tenant.tenantId, runId);
  }, 60_000);

  afterAll(async () => {
    await engine.close();
    await harness.close();
  });

  it("plans the four registered collectors that accept a domain, and dispatches each on its source's queue", async () => {
    const run = await db.withTenant(tenant.tenantId, ({ repos }) => repos.runs.findById(runId));
    const plan = z
      .object({
        detected: z.object({ primaryType: z.string() }),
        jobs: z.array(z.object({ collectorId: z.string() })),
      })
      .parse(run?.plan);
    expect(plan.detected.primaryType).toBe("DOMAIN");
    expect(plan.jobs.map((job) => job.collectorId).sort()).toEqual([
      "crtsh",
      "dns",
      "rdap",
      "wayback",
    ]);
    expect([...(engine.pools[1]?.queues ?? [])].sort()).toEqual(
      ["crtsh", "cloudflare-doh", "rdap", "wayback-cdx"].map(collectQueueName).sort(),
    );
  });

  it("reports the run PARTIAL, never an empty success: three found, one dead-lettered with its cause", async () => {
    const run = await db.withTenant(tenant.tenantId, ({ repos }) => repos.runs.findById(runId));
    expect(run?.status).toBe("PARTIAL");
    expect(run?.finishedAt).not.toBeNull();
    const jobs = await jobsOf(tenant.tenantId, runId);
    expect(
      jobs
        .map((job) => [job.collectorId, job.status, job.outcome, job.lastErrorCode])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ).toEqual([
      ["crtsh", "SUCCEEDED", "FOUND", null],
      ["dns", "SUCCEEDED", "FOUND", null],
      ["rdap", "SUCCEEDED", "FOUND", null],
      ["wayback", "DEAD_LETTERED", "UNAVAILABLE", "UPSTREAM_UNAVAILABLE"],
    ]);
    const wayback = byCollector(jobs, "wayback");
    expect(wayback.attempts).toBe(FAST_RETRY.maxAttempts);
    expect(wayback.deadLetteredAt).not.toBeNull();
    expect(wayback.result).toBeNull();
    expect(wayback.evidenceIds).toBeNull();
    expect(harness.unmatched).toEqual([]);
  });

  it("writes evidence only for what was found, one row per cited response", async () => {
    const jobs = await jobsOf(tenant.tenantId, runId);
    const cited = jobs.flatMap((job) => job.evidenceIds ?? []).sort();
    expect(cited).toHaveLength(3);
    expect(await evidenceIdsOf(tenant.tenantId)).toEqual(cited);
  });

  it("meters every upstream request against the tenant, once per attempt", async () => {
    const jobs = await jobsOf(tenant.tenantId, runId);
    const usage = await usageOf(tenant.tenantId);
    const wayback = byCollector(jobs, "wayback");
    const rdap = byCollector(jobs, "rdap");
    expect(usage.filter((row) => row.jobId === wayback.id).map((row) => row.attempt)).toEqual([
      1, 2, 3,
    ]);
    // rdap.org's redirect and the registry's answer: two requests, one attempt.
    expect(usage.filter((row) => row.jobId === rdap.id)).toEqual([
      { jobId: rdap.id, attempt: 1, quantity: 2 },
    ]);
  });

  it("puts the failed job in the dead-letter queue, inspectable", async () => {
    const jobs = await jobsOf(tenant.tenantId, runId);
    const wayback = byCollector(jobs, "wayback");
    const queue = new Queue(DEAD_LETTER_QUEUE, {
      connection: { url: engine.connection.url },
      prefix: engine.connection.prefix,
    });
    try {
      const letters = await waitFor(
        "the dead-letter record",
        async () =>
          (await queue.getJobs(["waiting", "wait"])).map((job) =>
            DEAD_LETTER_MESSAGE.parse(job.data),
          ),
        (rows) => rows.some((row) => row.jobId === wayback.id),
      );
      expect(letters.find((row) => row.jobId === wayback.id)).toMatchObject({
        kind: "COLLECT",
        tenantId: tenant.tenantId,
        runId,
        queue: collectQueueName("wayback-cdx"),
      });
    } finally {
      await queue.close();
    }
  });

  it("fuses what was found: one example.com entity for three collectors, its address, and claims citing evidence", async () => {
    const jobs = await jobsOf(tenant.tenantId, runId);
    for (const job of jobs.filter((row) => row.outcome === "FOUND")) {
      expect(job.fusedAt, job.collectorId).not.toBeNull();
    }
    const { entities, claims } = await db.withTenant(tenant.tenantId, async ({ repos }) => ({
      entities: await repos.entities.list({ limit: 1000 }),
      claims: await repos.claims.list({ limit: 1000 }),
    }));
    const domains = entities.filter((e) => e.kind === "DOMAIN" && e.identifier === "example.com");
    expect(domains).toHaveLength(1);
    expect(entities.some((e) => e.kind === "IP_ADDRESS")).toBe(true);
    const evidence = new Set(await evidenceIdsOf(tenant.tenantId));
    expect(claims.length).toBeGreaterThan(0);
    for (const claim of claims) expect(evidence.has(claim.evidenceId)).toBe(true);
    expect(new Set(claims.map((c) => c.strength))).toEqual(new Set(["REPORTED", "DERIVED"]));
  });

  it("fusing the run again fuses nothing twice", async () => {
    const count = () =>
      db.withTenant(tenant.tenantId, async ({ repos }) => ({
        entities: (await repos.entities.list({ limit: 1000 })).length,
        relationships: (await repos.entityRelationships.list({ limit: 1000 })).length,
        claims: (await repos.claims.list({ limit: 1000 })).length,
      }));
    const before = await count();
    const again = await new RunFusion({ db, registry: harness.runtime.registry }).fuseRun(
      tenant.tenantId,
      runId,
    );
    expect(again).toEqual({ fusedJobIds: [], status: "PARTIAL" });
    expect(await count()).toEqual(before);
  });

  it("opens the failing source's circuit", async () => {
    expect((await engine.breaker.state("wayback-cdx")).status).toBe("OPEN");
    expect((await engine.breaker.state("crtsh")).status).toBe("CLOSED");
  });
});

// ── Replay ────────────────────────────────────────────────────────────────

describe("a replayed job neither double-charges nor duplicates evidence (RELEASE-BLOCKING)", () => {
  let harness: Harness;
  let engine: Engine;
  let tenant: { tenantId: TenantId; userId: string };
  let runId: string;

  beforeAll(async () => {
    harness = await startHarness({
      collectors: platform(["crtsh", "dns", "rdap", "wayback"]),
      fixtures: [...EXAMPLE_COM_FOUND, waybackUnavailableFor("example.com")],
    });
    // The circuit never opens here, so a replayed attempt really calls the
    // archive (and is charged); the open-circuit case is its own test below.
    engine = await startEngine(harness.runtime, {
      circuit: { ...LONG_COOLING, failureThreshold: 1000 },
    });
    tenant = await newTenant("replay");
    runId = await startRun(engine, tenant, "example.com");
    await finishedRun(tenant.tenantId, runId);
  }, 60_000);

  afterAll(async () => {
    await engine.close();
    await harness.close();
  });

  it("a finished job delivered again does nothing: no request, no evidence, no charge", async () => {
    const jobs = await jobsOf(tenant.tenantId, runId);
    const crtsh = byCollector(jobs, "crtsh");
    const before = {
      evidence: await evidenceIdsOf(tenant.tenantId),
      usage: await usageOf(tenant.tenantId),
      requests: harness.requests.length,
    };
    // Straight to the processor, as a redelivery would reach it...
    expect(
      await engine.processor.process(tenant.tenantId, crtsh.id, { finalAttempt: false }),
    ).toEqual({
      kind: "SKIPPED",
      status: "SUCCEEDED",
    });
    // ...and through the queue, as a duplicate delivery.
    const queue = new Queue(collectQueueName("crtsh"), {
      connection: { url: engine.connection.url },
      prefix: engine.connection.prefix,
    });
    try {
      const delivery = await queue.add(
        "collect",
        { tenantId: tenant.tenantId, runId, jobId: crtsh.id },
        { jobId: `job-${crtsh.id}-duplicate` },
      );
      await waitFor(
        "the duplicate delivery",
        () => delivery.getState(),
        (state) => state === "completed" || state === "failed",
      );
      expect(await delivery.getState()).toBe("completed");
    } finally {
      await queue.close();
    }
    expect({
      evidence: await evidenceIdsOf(tenant.tenantId),
      usage: await usageOf(tenant.tenantId),
      requests: harness.requests.length,
    }).toEqual(before);
    expect(await jobsOf(tenant.tenantId, runId)).toEqual(jobs);
  });

  it("refuses to replay a job that succeeded", async () => {
    const crtsh = byCollector(await jobsOf(tenant.tenantId, runId), "crtsh");
    await expect(engine.replayer.replay(tenant.tenantId, crtsh.id)).rejects.toBeInstanceOf(
      JobNotReplayableError,
    );
  });

  it("replays a dead-lettered job under the same row: earlier attempts' charges stand, each new attempt is charged once", async () => {
    const wayback = byCollector(await jobsOf(tenant.tenantId, runId), "wayback");
    const usageBefore = await usageOf(tenant.tenantId);
    const evidenceBefore = await evidenceIdsOf(tenant.tenantId);
    const sentBefore = harness.requests.length;
    await engine.replayer.replay(tenant.tenantId, wayback.id);
    const after = await waitFor(
      "the replay to finish",
      () => db.withTenant(tenant.tenantId, ({ repos }) => repos.jobs.findById(wayback.id)),
      (job) => job !== null && job.status === "DEAD_LETTERED" && job.attempts > wayback.attempts,
    );
    // The same row, under the same key; a fresh budget of attempts, numbered on.
    expect(after?.id).toBe(wayback.id);
    expect(after?.idempotencyKey).toBe(wayback.idempotencyKey);
    expect(after?.attempts).toBe(wayback.attempts + FAST_RETRY.maxAttempts);
    const usageAfter = await usageOf(tenant.tenantId);
    // Every earlier charge is untouched...
    expect(
      usageAfter.filter(
        (row) =>
          row.jobId !== wayback.id || (row.attempt !== null && row.attempt <= wayback.attempts),
      ),
    ).toEqual(usageBefore);
    // ...and each replayed attempt, which sent one request, is charged once.
    expect(
      usageAfter
        .filter(
          (row) =>
            row.jobId === wayback.id && row.attempt !== null && row.attempt > wayback.attempts,
        )
        .map((row) => [row.attempt, row.quantity]),
    ).toEqual([
      [wayback.attempts + 1, 1],
      [wayback.attempts + 2, 1],
      [wayback.attempts + 3, 1],
    ]);
    expect(harness.requests.length - sentBefore).toBe(FAST_RETRY.maxAttempts);
    expect(await evidenceIdsOf(tenant.tenantId)).toEqual(evidenceBefore);
    // Replaying reopened the run; it settles again, still PARTIAL.
    expect((await finishedRun(tenant.tenantId, runId))?.status).toBe("PARTIAL");
  });

  it("two deliveries of one job running at once write its evidence once and charge one attempt", async () => {
    const run = await db.withTenant(tenant.tenantId, async ({ repos }) => {
      const investigation = await repos.investigations.create({
        title: "[concurrent]",
        target: "example.com",
        createdByUserId: tenant.userId,
      });
      return repos.runs.create({
        investigationId: investigation.id,
        status: "RUNNING",
        requestedByUserId: tenant.userId,
      });
    });
    const job = await db.withTenant(
      tenant.tenantId,
      async ({ repos }) =>
        (
          await repos.jobs.createOrFind({
            runId: run.id,
            collectorId: "dns",
            idempotencyKey: `concurrent:${run.id}`,
            status: "QUEUED",
            targetType: "DOMAIN",
            target: "example.com",
          })
        ).job,
    );
    const evidenceBefore = await evidenceIdsOf(tenant.tenantId);
    const dispositions = await Promise.all([
      engine.processor.process(tenant.tenantId, job.id, { finalAttempt: false }),
      engine.processor.process(tenant.tenantId, job.id, { finalAttempt: false }),
    ]);
    expect(dispositions.map((d) => d.kind).sort()).toEqual(["COMPLETED", "SKIPPED"]);
    const finished = await db.withTenant(tenant.tenantId, ({ repos }) =>
      repos.jobs.findById(job.id),
    );
    expect(finished?.evidenceIds).toHaveLength(1);
    expect((await evidenceIdsOf(tenant.tenantId)).length).toBe(evidenceBefore.length + 1);
    expect((await usageOf(tenant.tenantId)).filter((row) => row.jobId === job.id)).toHaveLength(1);
  });
});

// ── Bulkheads ─────────────────────────────────────────────────────────────

function fakeSource(id: string, network: boolean): SourceDeclaration {
  return {
    id,
    name: `[Source ${id}]`,
    licence: {
      commercialUse: "PERMITTED",
      reason: "[test source]",
      check: {
        checkedOn: "2026-09-30",
        sourceUrl: "https://example.com/terms",
        recordedIn: "[test]",
      },
    },
    network: network
      ? {
          protocol: "https",
          hosts: [`${id}.example`],
          rateLimit: { requests: 100, intervalSeconds: 1, basis: "SELF_IMPOSED", note: "[test]" },
          operators: [{ name: "fake", hosts: [`${id}.example`] }],
        }
      : null,
    attribution: null,
  };
}

const LOCAL_RESULT = z.object({ analysed: z.string() });

/** Answers at once: a local analysis of the target. */
const fastCollector = defineCollector(
  {
    id: "fake.fast",
    version: "1.0.0",
    displayName: "[fake fast analysis]",
    discipline: "TECHINT",
    targetTypes: ["DOMAIN"],
    collectionMode: "LOCAL_ANALYSIS",
    source: "fast-local",
    credentials: { vaultIds: [], runsWithout: true },
    claimStrength: "DERIVED",
    timeoutMs: 5_000,
    resultSchema: LOCAL_RESULT,
  },
  (ctx) => {
    const result = { analysed: ctx.target.value };
    return Promise.resolve(ctx.found(result, [{ response: ctx.record(result), observedAt: null }]));
  },
);

/** Hangs until its run budget ends it: a source that never answers. */
const hungCollector = defineCollector(
  {
    id: "fake.hung",
    version: "1.0.0",
    displayName: "[fake hung lookup]",
    discipline: "TECHINT",
    targetTypes: ["DOMAIN"],
    collectionMode: "PASSIVE_API",
    source: "slow-upstream",
    credentials: { vaultIds: [], runsWithout: true },
    claimStrength: "REPORTED",
    timeoutMs: 1_500,
    resultSchema: z.object({ names: z.array(z.string()), derived: z.object({}) }),
  },
  (ctx) =>
    new Promise((_resolve, reject) => {
      ctx.signal.addEventListener("abort", () => {
        reject(new Error("aborted by the run budget"));
      });
    }),
);

describe("a hung collector does not stall other queues (RELEASE-BLOCKING)", () => {
  it("finishes every fast job while the hung source's jobs still wait their turn", async () => {
    const runtime = new CollectorRuntime({
      registry: new CollectorRegistry({
        sources: [fakeSource("slow-upstream", true), fakeSource("fast-local", false)],
        collectors: [hungCollector, fastCollector],
      }),
      allowUnverifiedSources: false,
      network: {
        rateLimiter: { acquire: () => Promise.resolve({ allowed: true }) },
        resolver: () => Promise.resolve([{ address: "1.1.1.1", family: 4 }]),
      },
    });
    const engine = await startEngine(runtime, {
      retry: { maxAttempts: 1, baseDelayMs: 20, maxDelayMs: 100 },
      collectConcurrency: 1,
      extractors: { "fake.fast": () => ({ entities: [], relationships: [], claims: [] }) },
    });
    try {
      const tenant = await newTenant("bulkhead");
      const runs: string[] = [];
      for (let i = 0; i < 3; i++) runs.push(await startRun(engine, tenant, "example.com"));

      const fastDone = await waitFor(
        "every fast job",
        async () => (await Promise.all(runs.map((id) => jobsOf(tenant.tenantId, id)))).flat(),
        (jobs) =>
          jobs.filter((job) => job.collectorId === "fake.fast" && job.status === "SUCCEEDED")
            .length === 3,
      );
      const hung = fastDone.filter((job) => job.collectorId === "fake.hung");
      // One slot for the hung source: at most one of its jobs has finished
      // while all three fast ones did.
      expect(
        hung.filter((job) => job.status !== "QUEUED" && job.status !== "RUNNING").length,
      ).toBeLessThanOrEqual(1);

      for (const id of runs) {
        const run = await finishedRun(tenant.tenantId, id);
        expect(run?.status).toBe("PARTIAL");
      }
      const all = (await Promise.all(runs.map((id) => jobsOf(tenant.tenantId, id)))).flat();
      for (const job of all.filter((row) => row.collectorId === "fake.hung")) {
        expect([job.status, job.lastErrorCode]).toEqual(["DEAD_LETTERED", "COLLECTOR_TIMEOUT"]);
      }
    } finally {
      await engine.close();
    }
  }, 30_000);
});

// ── Case analyses ─────────────────────────────────────────────────────────

/** Records a request for a case's analysis as the API does, and enqueues its attempt 1. */
async function requestAnalysis(engine: Engine, fixture: CaseFixture): Promise<string> {
  const analysisId = await db.withTenant(
    fixture.tenantId,
    async ({ repos, reads }) => {
      const read = await readCaseAnalysisInput(reads, fixture.caseId, FIXTURE_COLLECTORS);
      const { analysis } = await repos.caseAnalyses.findOrCreate({
        caseId: fixture.caseId,
        inputHash: caseInputHash(read),
        engineVersion: ENGINE_VERSION,
        requestedByUserId: fixture.userId,
        requestedAt: new Date(),
        basis: {
          evidenceIds: read.input.evidence.map((e) => e.id),
          runIds: read.input.runs.map((r) => r.id),
        },
      });
      await repos.caseAnalysisEvents.request({
        analysisId: analysis.id,
        attempt: 1,
        requestedByUserId: fixture.userId,
        at: new Date(),
      });
      return analysis.id;
    },
    { snapshot: true },
  );
  await engine.analyses.enqueueAnalysis(fixture.tenantId, analysisId, 1);
  return analysisId;
}

function standingOf(fixture: CaseFixture, analysisId: string) {
  return db.withTenant(fixture.tenantId, ({ repos }) =>
    repos.caseAnalysisEvents.standing(analysisId),
  );
}

describe("a hung or failing case analysis holds only its own slots (RELEASE-BLOCKING)", () => {
  it("collection, a report and another case finish while one analysis hangs and one fails; each is failed with its code and dead-lettered", async () => {
    const entitled = async (tag: string): Promise<CaseFixture> => {
      const fixture = await createCaseFixture(db, tag);
      await asOwner(fixture.tenantId, "update public.tenants set plan = $1, vetting_status = $2", [
        "TECHINT_AND_PERSON",
        "APPROVED",
      ]);
      return fixture;
    };
    const hung = await entitled("analysis-hung");
    const failing = await entitled("analysis-failing");
    const other = await entitled("analysis-other");

    // The hung case's read waits until released; the failing case's read throws.
    const hang = { started: false, release: (): void => undefined };
    const released = new Promise<void>((resolve) => {
      hang.release = resolve;
    });
    const readInput: NonNullable<CaseAnalysisProcessorOptions["readInput"]> = async (
      reads,
      caseId,
      collectors,
    ) => {
      if (caseId === hung.caseId) {
        hang.started = true;
        await released;
      }
      if (caseId === failing.caseId) throw new Error("[injected analysis failure]");
      return readCaseAnalysisInput(reads, caseId, collectors);
    };
    const runtime = new CollectorRuntime({
      registry: new CollectorRegistry({
        sources: [fakeSource("fast-local", false)],
        collectors: [fastCollector],
      }),
      allowUnverifiedSources: false,
      network: { rateLimiter: { acquire: () => Promise.resolve({ allowed: true }) } },
    });
    const engine = await startEngine(runtime, {
      extractors: { "fake.fast": () => ({ entities: [], relationships: [], claims: [] }) },
      reports: new ReportGenerator({
        db,
        registry: runtime.registry,
        llm: { unavailable: "[none]" },
        defaultHandlingMarking: null,
        producedBy: "[product]",
        retry: FAST_RETRY,
      }),
      caseAnalyses: {
        processor: new CaseAnalysisProcessor({
          db,
          collectors: FIXTURE_COLLECTORS,
          timeoutMs: 8_000,
          readInput,
        }),
        concurrency: 2,
      },
    });
    const letters = new Queue(DEAD_LETTER_QUEUE, {
      connection: { url: engine.connection.url },
      prefix: engine.connection.prefix,
    });
    try {
      const hungId = await requestAnalysis(engine, hung);
      await waitFor(
        "the hung analysis to take its slot",
        () => Promise.resolve(hang.started),
        Boolean,
      );
      const failingId = await requestAnalysis(engine, failing);
      const otherId = await requestAnalysis(engine, other);

      // Collection and a report, while the hung analysis holds its slot.
      const tenant = await newTenant("analysis-beside");
      const runId = await startRun(engine, tenant, "example.com");
      expect((await finishedRun(tenant.tenantId, runId))?.status).toBe("SUCCEEDED");
      const report = await db.withTenant(tenant.tenantId, ({ repos }) =>
        repos.reports.create({ runId, includeSynthesis: false, requestedByUserId: null }),
      );
      await engine.reports.enqueueReport(tenant.tenantId, report.id);
      const generated = await waitFor(
        "the report to finish",
        () => db.withTenant(tenant.tenantId, ({ repos }) => repos.reports.findById(report.id)),
        (row) => row !== null && (row.status === "SUCCEEDED" || row.status === "FAILED"),
      );
      expect(generated?.status).toBe("SUCCEEDED");

      // Another case completes; the failing one is retried, then failed with a code.
      const completed = await waitFor(
        "the other case's analysis",
        () => standingOf(other, otherId),
        (standing) => standing?.status === "COMPLETE",
      );
      expect(completed?.event.document).not.toBeNull();
      const failed = await waitFor(
        "the failing case's analysis",
        () => standingOf(failing, failingId),
        (standing) => standing?.status === "FAILED",
      );
      expect(failed?.event).toMatchObject({ errorCode: "WORKER_ERROR", document: null });

      // All of that while the hung analysis was still running.
      expect((await standingOf(hung, hungId))?.status).toBe("PENDING");

      // Its timeout fails it with a code, never a document.
      const timedOut = await waitFor(
        "the hung analysis to time out",
        () => standingOf(hung, hungId),
        (standing) => standing?.status === "FAILED",
      );
      expect(timedOut?.event).toMatchObject({
        errorCode: "CASE_ANALYSIS_TIMEOUT",
        document: null,
      });

      const dead = await waitFor(
        "both analyses dead-lettered",
        async () =>
          (await letters.getJobs(["waiting", "wait"]))
            .map((job) => DEAD_LETTER_MESSAGE.parse(job.data))
            .filter((row) => row.kind === "CASE_ANALYSIS"),
        (rows) => rows.length === 2,
      );
      expect(
        dead
          .map((row) => [row.caseAnalysisId, row.errorCode, row.queue, row.runId, row.reportId])
          .sort(),
      ).toEqual(
        [
          [hungId, "CASE_ANALYSIS_TIMEOUT", CASE_ANALYSES_QUEUE, null, null],
          [failingId, "WORKER_ERROR", CASE_ANALYSES_QUEUE, null, null],
        ].sort(),
      );
    } finally {
      hang.release();
      await letters.close();
      await engine.close();
    }
  }, 60_000);
});

describe("a case analysis whose last attempt cannot be failed is still dead-lettered, and resumes (RELEASE-BLOCKING)", () => {
  it("dead-letters it while the database refuses the cleanup; enqueueing it again delivers it again", async () => {
    const fixture = await createCaseFixture(db, "analysis-unrecorded");
    await asOwner(fixture.tenantId, "update public.tenants set plan = $1, vetting_status = $2", [
      "TECHINT_AND_PERSON",
      "APPROVED",
    ]);
    // Every delivery fails while "the database is down", and so does the
    // dead-letter step's attempt to record the failure.
    const outage = { on: true };
    class DuringAnOutage extends CaseAnalysisProcessor {
      override async failUnrecorded(
        ...args: Parameters<CaseAnalysisProcessor["failUnrecorded"]>
      ): Promise<void> {
        if (outage.on) throw new Error("[database unreachable]");
        return super.failUnrecorded(...args);
      }
    }
    const processor = new DuringAnOutage({
      db,
      collectors: FIXTURE_COLLECTORS,
      timeoutMs: 8_000,
      readInput: async (reads, caseId, collectors) => {
        if (outage.on) throw new Error("[database unreachable]");
        return readCaseAnalysisInput(reads, caseId, collectors);
      },
    });
    const runtime = new CollectorRuntime({
      registry: new CollectorRegistry({ sources: [], collectors: [] }),
      allowUnverifiedSources: false,
      network: { rateLimiter: { acquire: () => Promise.resolve({ allowed: true }) } },
    });
    const engine = await startEngine(runtime, { caseAnalyses: { processor, concurrency: 1 } });
    const letters = new Queue(DEAD_LETTER_QUEUE, {
      connection: { url: engine.connection.url },
      prefix: engine.connection.prefix,
    });
    try {
      const analysisId = await requestAnalysis(engine, fixture);
      const dead = await waitFor(
        "the dead-letter record",
        async () =>
          (await letters.getJobs(["waiting", "wait"]))
            .map((job) => DEAD_LETTER_MESSAGE.parse(job.data))
            .filter((row) => row.caseAnalysisId === analysisId),
        (rows) => rows.length === 1,
      );
      expect(dead[0]).toMatchObject({ kind: "CASE_ANALYSIS", errorCode: "WORKER_ERROR" });
      // The cleanup could not record the failure: the attempt is still pending.
      expect((await standingOf(fixture, analysisId))?.status).toBe("PENDING");

      // Requested again while the outage lasts: delivered again, it fails again,
      // and that failure has its own dead-letter record.
      await engine.analyses.enqueueAnalysis(fixture.tenantId, analysisId, 1);
      await waitFor(
        "a second dead-letter record",
        async () =>
          (await letters.getJobs(["waiting", "wait"]))
            .map((job) => DEAD_LETTER_MESSAGE.parse(job.data))
            .filter((row) => row.caseAnalysisId === analysisId),
        (rows) => rows.length === 2,
      );
      expect((await standingOf(fixture, analysisId))?.status).toBe("PENDING");

      // The database is back. Requesting the analysis again enqueues the same
      // attempt: its failed job is delivered again, and it completes.
      outage.on = false;
      await engine.analyses.enqueueAnalysis(fixture.tenantId, analysisId, 1);
      const completed = await waitFor(
        "the resumed attempt",
        () => standingOf(fixture, analysisId),
        (standing) => standing?.status === "COMPLETE",
      );
      expect(completed).toMatchObject({ attempt: 1, status: "COMPLETE" });
    } finally {
      await letters.close();
      await engine.close();
    }
  }, 60_000);
});

// ── Circuits ──────────────────────────────────────────────────────────────

describe("a failing source opens its circuit, and is not called while it is open (RELEASE-BLOCKING)", () => {
  it("stops calling the archive after repeated failures, and says so on the job", async () => {
    const harness = await startHarness({
      collectors: platform(["wayback"]),
      fixtures: [waybackUnavailableFor("example.com")],
    });
    const engine = await startEngine(harness.runtime, {
      retry: { maxAttempts: 3, baseDelayMs: 20, maxDelayMs: 100 },
    });
    try {
      const tenant = await newTenant("circuit");
      const first = await startRun(engine, tenant, "example.com");
      expect((await finishedRun(tenant.tenantId, first))?.status).toBe("FAILED");
      expect((await engine.breaker.state("wayback-cdx")).status).toBe("OPEN");
      const sentBefore = harness.requests.length;
      expect(sentBefore).toBe(3);

      // While the circuit is open, the next run's job is not sent: it waits,
      // scheduled for when the circuit may let a probe through.
      const second = await startRun(engine, tenant, "example.com");
      const waiting = await waitFor(
        "the job to be held by the open circuit",
        async () => (await jobsOf(tenant.tenantId, second))[0],
        (job) => job?.lastErrorCode === "CIRCUIT_OPEN",
      );
      expect([waiting?.status, waiting?.outcome]).toEqual(["QUEUED", "UNAVAILABLE"]);
      const state = await engine.breaker.state("wayback-cdx");
      expect(waiting?.nextAttemptAt?.getTime()).toBeGreaterThan(Date.now() + 30_000);
      expect(state.retryAfterMs).toBeGreaterThan(30_000);
      expect(harness.requests.length).toBe(sentBefore);
      // Not smoothed into a result either way: the run is still running.
      const run = await db.withTenant(tenant.tenantId, ({ repos }) => repos.runs.findById(second));
      expect(run?.status).toBe("RUNNING");
    } finally {
      await engine.close();
      await harness.close();
    }
  }, 30_000);
});

// ── Quotas ────────────────────────────────────────────────────────────────

describe("a spent quota refuses before anything is dispatched", () => {
  it("refuses every job of the run, sends nothing, and says which quota", async () => {
    const harness = await startHarness({
      collectors: platform(["crtsh", "dns"]),
      fixtures: EXAMPLE_COM_FOUND,
    });
    const engine = await startEngine(harness.runtime);
    try {
      const tenant = await newTenant("quota");
      await asOwner(
        tenant.tenantId,
        `insert into public.tenant_quotas (tenant_id, unit, period, max_quantity)
         values ($1, 'UPSTREAM_REQUEST', 'DAY', 0)`,
        [tenant.tenantId],
      );
      const runId = await startRun(engine, tenant, "example.com");
      expect((await finishedRun(tenant.tenantId, runId))?.status).toBe("FAILED");
      const jobs = await jobsOf(tenant.tenantId, runId);
      expect(jobs.map((job) => [job.status, job.outcome, job.lastErrorCode, job.attempts])).toEqual(
        [
          ["FAILED", "REFUSED", "QUOTA_EXCEEDED", 0],
          ["FAILED", "REFUSED", "QUOTA_EXCEEDED", 0],
        ],
      );
      expect(harness.requests).toEqual([]);
      expect(await usageOf(tenant.tenantId)).toEqual([]);
    } finally {
      await engine.close();
      await harness.close();
    }
  }, 30_000);
});

// ── Retries by cause ──────────────────────────────────────────────────────

describe("an empty answer its source cannot be trusted on is recorded as such (RELEASE-BLOCKING, Track M Day 2)", () => {
  it("completes the job EMPTY_UNCONFIRMED with the collector's words: no evidence, no retry, no zero", async () => {
    // A local upstream that answers every request 200 with nothing in it.
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" }).end("{}");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const unconfirmed = defineCollector(
      {
        id: "fake.unconfirmed",
        version: "1.0.0",
        displayName: "[fake unconfirmed search]",
        discipline: "TECHINT",
        targetTypes: ["DOMAIN"],
        collectionMode: "PASSIVE_API",
        source: "unconfirmed-upstream",
        credentials: { vaultIds: [], runsWithout: true },
        claimStrength: "REPORTED",
        timeoutMs: 5_000,
        resultSchema: z.object({ names: z.array(z.string()), derived: z.object({}) }),
        emptyAnswersUnreliable: true,
      },
      async (ctx) => {
        const response = await ctx.fetch("https://unconfirmed-upstream.example/search", {
          method: "GET",
          timeoutMs: 2_000,
        });
        return ctx.emptyUnconfirmed(response, "[fake: the source answered with nothing]");
      },
    );
    const runtime = new CollectorRuntime({
      registry: new CollectorRegistry({
        sources: [fakeSource("unconfirmed-upstream", true)],
        collectors: [unconfirmed],
      }),
      allowUnverifiedSources: false,
      network: {
        rateLimiter: { acquire: () => Promise.resolve({ allowed: true }) },
        resolver: () => Promise.resolve([{ address: "1.1.1.1", family: 4 }]),
        socketFactory: () => connect(port, "127.0.0.1"),
      },
    });
    const engine = await startEngine(runtime);
    try {
      const tenant = await newTenant("unconfirmed");
      const runId = await startRun(engine, tenant, "example.com");
      const run = await finishedRun(tenant.tenantId, runId);
      // Every job finished: the run is complete, and its coverage says what is unconfirmed.
      expect(run?.status).toBe("SUCCEEDED");
      const job = byCollector(await jobsOf(tenant.tenantId, runId), "fake.unconfirmed");
      expect({
        status: job.status,
        outcome: job.outcome,
        outcomeDetail: job.outcomeDetail,
        attempts: job.attempts,
        evidenceIds: job.evidenceIds,
        result: job.result,
        lastErrorCode: job.lastErrorCode,
      }).toEqual({
        status: "SUCCEEDED",
        outcome: "EMPTY_UNCONFIRMED",
        outcomeDetail: "[fake: the source answered with nothing]",
        attempts: 1,
        evidenceIds: null,
        result: null,
        lastErrorCode: null,
      });
      expect(await evidenceIdsOf(tenant.tenantId)).toEqual([]);
      // The request it sent is charged once, like any other.
      expect(await usageOf(tenant.tenantId)).toEqual([{ jobId: job.id, attempt: 1, quantity: 1 }]);
    } finally {
      await engine.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    }
  }, 30_000);
});

describe("retries distinguish cause", () => {
  it("fails a refused request at once, with no retry; retries only UNAVAILABLE", async () => {
    const forbidden = loadFixture("wayback", "forbidden-403");
    const harness = await startHarness({
      collectors: platform(["wayback"]),
      fixtures: [forbidden, waybackUnavailableFor("example.com")],
    });
    const engine = await startEngine(harness.runtime);
    try {
      const tenant = await newTenant("retries");
      const refused = await startRun(engine, tenant, "forbidden.example");
      await finishedRun(tenant.tenantId, refused);
      const permanent = byCollector(await jobsOf(tenant.tenantId, refused), "wayback");
      expect([
        permanent.status,
        permanent.outcome,
        permanent.lastErrorCode,
        permanent.attempts,
      ]).toEqual(["FAILED", "FAILED", "UPSTREAM_REFUSED", 1]);
      const unavailable = await startRun(engine, tenant, "example.com");
      await finishedRun(tenant.tenantId, unavailable);
      const retried = byCollector(await jobsOf(tenant.tenantId, unavailable), "wayback");
      expect([retried.status, retried.attempts]).toEqual(["DEAD_LETTERED", FAST_RETRY.maxAttempts]);
    } finally {
      await engine.close();
      await harness.close();
    }
  }, 30_000);

  it("an invalid target never becomes a job", async () => {
    const harness = await startHarness({ collectors: platform(["dns"]), fixtures: [] });
    const engine = await startEngine(harness.runtime);
    try {
      const tenant = await newTenant("invalid");
      const runId = await startRun(engine, tenant, "not a domain at all", "DOMAIN");
      const run = await finishedRun(tenant.tenantId, runId);
      expect(run?.status).toBe("FAILED");
      expect(await jobsOf(tenant.tenantId, runId)).toEqual([]);
      const plan = z
        .object({ targets: z.array(z.object({ type: z.string(), invalid: z.string() })) })
        .parse(run?.plan);
      expect(plan.targets[0]?.type).toBe("DOMAIN");
      expect(harness.requests).toEqual([]);
    } finally {
      await engine.close();
      await harness.close();
    }
  }, 30_000);
});

// ── PERSON gating in the worker ───────────────────────────────────────────

describe("the worker gates PERSON collectors by plan and vetting, through @repo/access (RELEASE-BLOCKING)", () => {
  it("excludes a PERSON collector at planning, refuses it at dispatch, and runs it once entitled", async () => {
    const harness = await startHarness({ collectors: platform(["contact.phone"]), fixtures: [] });
    const engine = await startEngine(harness.runtime);
    try {
      const tenant = await newTenant("person");
      const planned = await startRun(engine, tenant, "+44 20 7946 0000");
      const run = await finishedRun(tenant.tenantId, planned);
      expect(run?.status).toBe("FAILED");
      const plan = z
        .object({ excluded: z.array(z.object({ collectorId: z.string(), reason: z.string() })) })
        .parse(run?.plan);
      expect(plan.excluded).toEqual([
        expect.objectContaining({ collectorId: "contact.phone", reason: "MODULE_NOT_IN_PLAN" }),
      ]);

      // A job that reaches the worker anyway is refused there, by the same rules.
      const forced = await db.withTenant(tenant.tenantId, async ({ repos }) => {
        await repos.collectorsRegistry.sync({
          collectorId: "contact.phone",
          sourceLabel: harness.runtime.registry.entry("contact.phone").label,
          discipline: "PERSON",
          collectionMode: "LOCAL_ANALYSIS",
          dataLicence: "[synced for the test]",
          commercialUse: "PERMITTED",
          enabled: true,
          disabledReason: null,
        });
        return (
          await repos.jobs.createOrFind({
            runId: planned,
            collectorId: "contact.phone",
            idempotencyKey: `forced:${planned}`,
            status: "QUEUED",
            targetType: "PHONE_NUMBER",
            target: "+442079460000",
          })
        ).job;
      });
      expect(
        await engine.processor.process(tenant.tenantId, forced.id, { finalAttempt: true }),
      ).toEqual({
        kind: "COMPLETED",
        status: "FAILED",
        outcome: "REFUSED",
      });
      const refused = await db.withTenant(tenant.tenantId, ({ repos }) =>
        repos.jobs.findById(forced.id),
      );
      expect(refused?.lastErrorCode).toBe("MODULE_NOT_IN_PLAN");
      expect(await evidenceIdsOf(tenant.tenantId)).toEqual([]);

      await asOwner(tenant.tenantId, "update public.tenants set plan = $1, vetting_status = $2", [
        "TECHINT_AND_PERSON",
        "APPROVED",
      ]);
      const entitled = await startRun(engine, tenant, "+44 20 7946 0000");
      expect((await finishedRun(tenant.tenantId, entitled))?.status).toBe("SUCCEEDED");
      expect(byCollector(await jobsOf(tenant.tenantId, entitled), "contact.phone").outcome).toBe(
        "FOUND",
      );
    } finally {
      await engine.close();
      await harness.close();
    }
  }, 30_000);
});

// ── Pools ─────────────────────────────────────────────────────────────────

describe("one worker codebase, deployed as pools selected by queue", () => {
  it("selects queues by exact name, by the collect.* family, or all", () => {
    const available = ["investigations", "fusion", "collect.crtsh", "collect.rdap"];
    expect(selectQueues(["collect.*"], available)).toEqual(["collect.crtsh", "collect.rdap"]);
    expect(selectQueues(["investigations", "collect.rdap"], available)).toEqual([
      "investigations",
      "collect.rdap",
    ]);
    expect(selectQueues(["*"], available)).toEqual(available);
    expect(selectQueues([], available)).toEqual([]);
  });

  it("every platform source with a registered collector has a collect queue", () => {
    const sources = new Set(PLATFORM_SOURCES.map((source) => source.id));
    for (const collector of PLATFORM_COLLECTORS) {
      expect(sources.has(collector.declaration.source)).toBe(true);
    }
  });
});

/** A local analysis that takes a topic: a collector that is not a person one. */
const topicCollector = defineCollector(
  {
    id: "fake.topic",
    version: "1.0.0",
    displayName: "[fake topic analysis]",
    discipline: "MEDIAINT",
    targetTypes: ["TOPIC"],
    collectionMode: "LOCAL_ANALYSIS",
    source: "topic-local",
    credentials: { vaultIds: [], runsWithout: true },
    claimStrength: "DERIVED",
    timeoutMs: 5_000,
    resultSchema: LOCAL_RESULT,
  },
  (ctx) => {
    const result = { analysed: ctx.target.value };
    return Promise.resolve(ctx.found(result, [{ response: ctx.record(result), observedAt: null }]));
  },
);

describe("a TOPIC job only ever sits in a person-bearing run (RELEASE-BLOCKING; Day 1, D-M1)", () => {
  it("collects in a run recorded as person-bearing, and refuses, at once and visibly, one that is not", async () => {
    const runtime = new CollectorRuntime({
      registry: new CollectorRegistry({
        sources: [fakeSource("topic-local", false)],
        collectors: [topicCollector],
      }),
      allowUnverifiedSources: false,
      network: { rateLimiter: { acquire: () => Promise.resolve({ allowed: true }) } },
    });
    const engine = await startEngine(runtime, {
      extractors: { "fake.topic": () => ({ entities: [], relationships: [], claims: [] }) },
    });
    const letters = new Queue(DEAD_LETTER_QUEUE, {
      connection: { url: engine.connection.url },
      prefix: engine.connection.prefix,
    });
    try {
      const tenant = await newTenant("topic-record");
      await asOwner(
        tenant.tenantId,
        "update public.tenants set plan = 'TECHINT_AND_PERSON', vetting_status = 'APPROVED'",
        [],
      );
      // As the repository records it: a hashtag is a topic, so the run is person-bearing.
      const recorded = await startRun(engine, tenant, "#elections");
      const finished = await finishedRun(tenant.tenantId, recorded);
      expect(finished).toMatchObject({ personBearing: true, status: "SUCCEEDED" });
      expect((await jobsOf(tenant.tenantId, recorded)).map((job) => job.targetType)).toEqual([
        "TOPIC",
      ]);

      // A run whose record says otherwise, as one still queued when migration 0025
      // ran would: the database refuses its TOPIC job, and no retry changes that.
      const evidenceBefore = await evidenceIdsOf(tenant.tenantId);
      const investigation = await db.withTenant(tenant.tenantId, ({ repos }) =>
        repos.investigations.create({
          title: "[queued before the record existed]",
          target: "#elections",
          createdByUserId: tenant.userId,
        }),
      );
      const stale = randomUUID();
      await asOwner(
        tenant.tenantId,
        `insert into public.runs (tenant_id, id, investigation_id, status, person_bearing)
         values ($1, $2, $3, 'QUEUED', false)`,
        [tenant.tenantId, stale, investigation.id],
      );
      await engine.investigations.enqueueRun(tenant.tenantId, stale);
      const dead = await waitFor(
        "the planning job's dead-letter record",
        async () =>
          (await letters.getJobs(["waiting", "wait"]))
            .map((job) => DEAD_LETTER_MESSAGE.parse(job.data))
            .filter((letter) => letter.runId === stale),
        (rows) => rows.length > 0,
      );
      expect(dead).toEqual([
        expect.objectContaining({
          kind: "INVESTIGATION",
          tenantId: tenant.tenantId,
          errorCode: "PERSON_TARGET_OUTSIDE_PERSON_RUN",
        }),
      ]);
      // No job and nothing collected; the run is failed with the reason, never left queued.
      expect(await jobsOf(tenant.tenantId, stale)).toEqual([]);
      const run = await db.withTenant(tenant.tenantId, ({ repos }) => repos.runs.findById(stale));
      expect(run).toMatchObject({
        status: "FAILED",
        personBearing: false,
        plan: {
          error: {
            code: "PERSON_TARGET_OUTSIDE_PERSON_RUN",
            message: expect.stringMatching(/nothing was collected/) as string,
          },
        },
      });
      expect(await evidenceIdsOf(tenant.tenantId)).toEqual(evidenceBefore);
    } finally {
      await letters.close();
      await engine.close();
    }
  });
});

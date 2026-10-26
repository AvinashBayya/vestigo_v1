/**
 * M5 real-provider synthesis canary — OPT-IN, FIXTURE-ONLY.
 *
 * This is the bounded, metered first run of report synthesis against a REAL
 * open-weight provider, over a synthetic in-repo article run. It exists to be
 * run once, deliberately, by a human who has configured a provider; it is
 * skipped by default and makes no external request otherwise.
 *
 * What it does NOT do:
 *   - It never invokes the real `article` collector, the SSRF fetcher, or any
 *     publisher. The "article" is a LOCAL_ANALYSIS synthetic collector (no
 *     network) plus a seeded, grounded `article_statements` claim — exactly the
 *     shape the M4-4 extraction job writes. The only network call this file ever
 *     makes, and only when opted in, is the synthesis call to the configured
 *     provider.
 *   - It never falls back to the scripted provider: if opted in while no READY
 *     provider is configured, it fails loudly rather than pass on a stand-in.
 *
 * Opt in with `M5_SYNTHESIS_CANARY=1` AND a configured provider
 * (LLM_HOSTED_BASE_URL + LLM_HOSTED_API_KEY, an allowlisted LLM_LARGE_MODEL).
 * See docs / the M5 plan for the full runbook. Do not commit a configured run.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  CollectorRegistry,
  CollectorRuntime,
  defineCollector,
  type SourceDeclaration,
} from "@repo/collectors";
import {
  allowedModel,
  loadEnvSubset,
  resolveLlmConfiguration,
  type LlmVariables,
} from "@repo/config";
import { parseTenantId, type ReportDocument } from "@repo/core";
import { createDatabase, FileSystemContentStore, type Database } from "@repo/db";
import {
  CredentialVault,
  MasterKey,
  RedisCircuitBreaker,
  createRedisClient,
  waitForRedisReady,
} from "@repo/integrations";
import { createLlmClient, type LlmClient } from "@repo/llm";
import type { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ARTICLE_STATEMENTS_ATTRIBUTE,
  CollectionExecutor,
  CollectorJobProcessor,
  InvestigationQueue,
  ReportGenerator,
  ReportQueue,
  ReportRenderer,
  RunCoordinator,
  RunFusion,
  startWorkerPool,
  VaultCredentialSource,
  type Extractor,
  type QueueConnection,
  type RetryPolicy,
  type WorkerPool,
} from "../src/index.ts";
import { TEST_ENGINE } from "./config.ts";

const OPT_IN = process.env.M5_SYNTHESIS_CANARY === "1";
const FAST_RETRY: RetryPolicy = { maxAttempts: 3, baseDelayMs: 20, maxDelayMs: 100 };

// ── Always on: the no-provider degradation contract (no network, no DB) ──────

/** LLM settings with no hosted base URL: the "no provider configured" case. */
const NO_PROVIDER: LlmVariables = {
  LLM_PROFILE: "hosted",
  LLM_HOSTED_STRUCTURED_OUTPUT: "none",
  LLM_VLLM_ENABLED: "false",
  LLM_VLLM_BASE_URL: "http://127.0.0.1:8000/v1",
  LLM_SMALL_MODEL: "Qwen/Qwen3-8B",
  LLM_LARGE_MODEL: "Qwen/Qwen3-32B",
  LLM_REQUEST_TIMEOUT_MS: 120_000,
};

describe("M5 synthesis: no-provider degradation (always on, no request)", () => {
  it("resolves to NOT_CONFIGURED and yields an unavailable client, calling no provider", () => {
    const configuration = resolveLlmConfiguration(NO_PROVIDER);
    expect(configuration.status).toBe("NOT_CONFIGURED");
    const client = createLlmClient(configuration, {
      redis: null,
      keyPrefix: "m5-canary-no-provider",
      cacheTtlSeconds: 60,
    });
    expect("unavailable" in client).toBe(true);
  });
});

// ── The fixture article run (synthetic, no publisher, no network) ───────────

const ARTICLE_URL = "https://news.example.com/report-article";

const ARTICLE_SOURCE: SourceDeclaration = {
  id: "m5-canary-article-local",
  name: "[M5 canary article source]",
  access: ["open"],
  licence: {
    commercialUse: "PERMITTED",
    reason: "[test source]",
    check: {
      checkedOn: "2026-09-30",
      sourceUrl: "https://example.com/terms",
      recordedIn: "[test]",
    },
  },
  network: null,
  attribution: null,
};

/**
 * Grounded statements as M4-4 extraction persists them. Bracketed placeholders.
 * The `start`/`end` offsets are illustrative only: this fixture-only canary seeds
 * the claim directly and never retrieves body text, so the spans are inert data
 * the synthesis path does not read.
 */
const ARTICLE_STATEMENTS: {
  subjectType: string;
  subject: string;
  attribute: string;
  value: string;
  quote: string;
  start: number;
  end: number;
}[] = [
  {
    subjectType: "ORGANIZATION",
    subject: "[Acme Corp]",
    attribute: "was founded in",
    value: "[1998]",
    quote: "[Acme Corp was founded in 1998]",
    start: 0,
    end: 31,
  },
  {
    subjectType: "PERSON",
    subject: "[Jordan Rao]",
    attribute: "is described as the chief executive of",
    value: "[Acme Corp]",
    quote: "[Jordan Rao, the chief executive of Acme Corp]",
    start: 40,
    end: 86,
  },
];

/** A local article collector: one headline, no network. */
const articleCollector = defineCollector(
  {
    id: "fake.article",
    version: "1.0.0",
    displayName: "[fake direct article fetch]",
    discipline: "MEDIAINT",
    targetTypes: ["URL"],
    collectionMode: "LOCAL_ANALYSIS",
    source: "m5-canary-article-local",
    credentials: { vaultIds: [], runsWithout: true },
    claimStrength: "DERIVED",
    timeoutMs: 5_000,
    resultSchema: z.object({ headline: z.string() }),
  },
  (ctx) => {
    const result = { headline: "[Example headline]" };
    return Promise.resolve(ctx.found(result, [{ response: ctx.record(result), observedAt: null }]));
  },
);

const ARTICLE_EXTRACTOR: Extractor = () => ({
  entities: [{ key: "u", kind: "URL", identifier: ARTICLE_URL, displayName: ARTICLE_URL }],
  relationships: [],
  claims: [
    { subject: { entity: "u" }, attribute: "article_headline", path: ["headline"], evidence: 0 },
  ],
});

// ── Opt-in: the real-provider synthesis canary ──────────────────────────────

interface Engine {
  readonly investigations: InvestigationQueue;
  readonly reports: ReportQueue;
  close(): Promise<void>;
}

describe.runIf(OPT_IN)("M5 synthesis against the configured real provider (opt-in)", () => {
  let db: Database;
  let redis: Redis;
  let contentDir: string;
  let vault: CredentialVault;
  let engine: Engine;
  let runId: string;
  let evidenceId: string;
  let document: ReportDocument;
  let expectedModelId: string;
  let expectedEndpointHost: string;
  let reportUsage: {
    unit: string;
    attempt: number | null;
    quantity: number;
    modelCalls: number;
  }[] = [];

  const waitFor = async <T>(
    what: string,
    read: () => Promise<T>,
    done: (value: T) => boolean,
    timeoutMs = 60_000,
  ): Promise<T> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = await read();
      if (done(value)) return value;
      if (Date.now() > deadline)
        throw new Error(`timed out waiting for ${what}: ${JSON.stringify(value)}`);
      await sleep(50);
    }
  };

  const startEngine = async (runtime: CollectorRuntime, llm: LlmClient): Promise<Engine> => {
    const namespace = `m5c-${randomUUID().slice(0, 8)}`;
    const connection: QueueConnection = { url: TEST_ENGINE.redisUrl, prefix: namespace };
    const breaker = new RedisCircuitBreaker({
      redis,
      keyPrefix: namespace,
      policy: {
        failureThreshold: 1000,
        failureWindowMs: 60_000,
        coolingMs: 60_000,
        probeLeaseMs: 60_000,
      },
    });
    const executor = new CollectionExecutor({
      db,
      runtime,
      contentStore: new FileSystemContentStore(contentDir),
      credentials: new VaultCredentialSource(vault),
    });
    const pool: WorkerPool = await startWorkerPool({
      connection,
      queues: ["*"],
      sourceIds: [...new Set(runtime.registry.list().map((entry) => entry.source.id))],
      coordinator: new RunCoordinator({ db, runtime }),
      processor: new CollectorJobProcessor({
        db,
        executor,
        runtime,
        circuit: breaker,
        retry: FAST_RETRY,
      }),
      fusion: new RunFusion({
        db,
        registry: runtime.registry,
        extractors: { "fake.article": ARTICLE_EXTRACTOR },
      }),
      retry: FAST_RETRY,
      collectConcurrency: () => 1,
      investigationConcurrency: 2,
      fusionConcurrency: 2,
      reports: {
        generator: new ReportGenerator({
          db,
          registry: runtime.registry,
          llm,
          defaultHandlingMarking: null,
          producedBy: "[canary]",
          retry: FAST_RETRY,
        }),
        concurrency: 1,
      },
      renders: {
        renderer: new ReportRenderer({
          db,
          contentStore: new FileSystemContentStore(contentDir),
          retry: FAST_RETRY,
        }),
        concurrency: 1,
      },
    });
    const investigations = new InvestigationQueue(connection, FAST_RETRY);
    const reports = new ReportQueue(connection, FAST_RETRY);
    return {
      investigations,
      reports,
      async close() {
        await pool.close();
        await investigations.close();
        await reports.close();
      },
    };
  };

  beforeAll(async () => {
    // Build the REAL client from validated env. Never fall back to a stand-in:
    // opt-in with no READY provider is a loud failure, not a scripted pass.
    const llmEnv = loadEnvSubset([
      "LLM_PROFILE",
      "LLM_HOSTED_BASE_URL",
      "LLM_HOSTED_API_KEY",
      "LLM_HOSTED_STRUCTURED_OUTPUT",
      "LLM_VLLM_ENABLED",
      "LLM_VLLM_BASE_URL",
      "LLM_VLLM_API_KEY",
      "LLM_SMALL_MODEL",
      "LLM_LARGE_MODEL",
      "LLM_MODEL_NAMES",
      "LLM_REQUEST_TIMEOUT_MS",
    ]);
    const configuration = resolveLlmConfiguration(llmEnv);
    if (configuration.status !== "READY") {
      throw new Error(
        "M5 canary opted in (M5_SYNTHESIS_CANARY=1) but no READY LLM provider is configured: " +
          configuration.reason,
      );
    }
    expectedModelId = configuration.endpoint.large.model.id;
    expectedEndpointHost = new URL(configuration.endpoint.baseUrl).hostname;
    // No response cache (redis: null), so the model is actually called and metered
    // exactly once, not served from a prior cached answer.
    const llm = createLlmClient(configuration, {
      redis: null,
      keyPrefix: `m5-canary-${randomUUID()}`,
      cacheTtlSeconds: 60,
    });
    if ("unavailable" in llm) throw new Error("unreachable: a READY configuration yields a client");

    db = createDatabase({
      connectionString: TEST_ENGINE.databaseUrl,
      onConnectionError: () => undefined,
    });
    redis = createRedisClient({
      url: TEST_ENGINE.redisUrl,
      commandTimeoutMs: 2_000,
      connectTimeoutMs: 2_000,
    });
    await waitForRedisReady(redis, { timeoutMs: 5_000 });
    contentDir = await mkdtemp(join(tmpdir(), "m5-canary-"));
    vault = new CredentialVault(
      new MasterKey({ keyId: "test-1", keyBase64: randomBytes(32).toString("base64") }),
    );

    const runtime = new CollectorRuntime({
      registry: new CollectorRegistry({
        sources: [ARTICLE_SOURCE],
        collectors: [articleCollector],
      }),
      network: { rateLimiter: { acquire: () => Promise.resolve({ allowed: true }) } },
    });
    engine = await startEngine(runtime, llm);

    const tenantId = parseTenantId(randomUUID());
    await db.provisionTenant({ tenantId, name: "[Canary tenant]", region: "IN" });
    const user = await db.withTenant(tenantId, ({ repos }) =>
      repos.users.create({ email: "canary@example.com", displayName: null, status: "ACTIVE" }),
    );
    // Settle a synthetic article run (no network): plan -> collect (local) -> fuse.
    const run = await db.withTenant(tenantId, async ({ repos }) => {
      const investigation = await repos.investigations.create({
        title: "[Canary investigation]",
        target: ARTICLE_URL,
        createdByUserId: user.id,
      });
      return repos.runs.create({
        investigationId: investigation.id,
        status: "QUEUED",
        requestedByUserId: user.id,
        requestedTargetType: null,
      });
    });
    runId = run.id;
    await engine.investigations.enqueueRun(tenantId, runId);
    await waitFor(
      "the run to settle",
      () =>
        db.withTenant(tenantId, async ({ repos }) => ({
          run: await repos.runs.findById(runId),
          jobs: await repos.jobs.listForRun(runId, { limit: 100 }),
        })),
      ({ run: row, jobs }) =>
        row !== null &&
        ["SUCCEEDED", "PARTIAL", "FAILED"].includes(row.status) &&
        jobs.every((job) => job.outcome !== "FOUND" || job.fusedAt !== null),
    );

    // Seed the grounded article_statements claim exactly as M4-4 extraction does.
    evidenceId = await db.withTenant(tenantId, async ({ repos }) => {
      const jobs = await repos.jobs.listForRun(runId, { limit: 100 });
      const id = jobs.flatMap((job) => (job.outcome === "FOUND" ? (job.evidenceIds ?? []) : []))[0];
      if (id === undefined) throw new Error("no article evidence was recorded");
      const claims = await repos.claims.listForEvidence([id], { limit: 100 });
      const headline = claims.find((claim) => claim.attribute === "article_headline");
      if (headline === undefined || headline.entityId === null) {
        throw new Error("fusion recorded no URL entity");
      }
      await repos.claims.createOnce({
        evidenceId: id,
        subject: { entityId: headline.entityId },
        attribute: ARTICLE_STATEMENTS_ATTRIBUTE,
        value: ARTICLE_STATEMENTS,
        strength: "DERIVED",
      });
      return id;
    });

    // Request the report WITH synthesis: this makes the one real provider call.
    const report = await db.withTenant(tenantId, ({ repos }) =>
      repos.reports.create({ runId, includeSynthesis: true, requestedByUserId: null }),
    );
    await engine.reports.enqueueReport(tenantId, report.id);
    const finished = await waitFor(
      "the report to finish",
      () => db.withTenant(tenantId, ({ repos }) => repos.reports.findById(report.id)),
      (row) => row !== null && (row.status === "SUCCEEDED" || row.status === "FAILED"),
      120_000,
    );
    if (finished?.status !== "SUCCEEDED") {
      throw new Error(
        `canary report failed: ${String(finished?.errorCode)} ${String(finished?.errorMessage)}`,
      );
    }
    document = finished.document as ReportDocument;

    const usageRows = await db.withTenant(tenantId, ({ repos }) =>
      repos.usageEvents.list({ limit: 1000 }),
    );
    reportUsage = usageRows
      .filter((row) => row.reportId === report.id)
      .map((row) => ({
        unit: row.unit,
        attempt: row.attempt,
        quantity: row.quantity,
        modelCalls: (row.modelCalls ?? []).length,
      }));
  }, 180_000);

  afterAll(async () => {
    // Each resource is closed independently; any that setup never reached throws
    // and is ignored, so one missing resource cannot mask the others.
    try {
      await engine.close();
    } catch {
      // engine may not have started
    }
    try {
      await redis.quit();
    } catch {
      // redis may not have connected
    }
    try {
      await db.close();
    } catch {
      // db may not have been created
    }
    try {
      await rm(contentDir, { recursive: true, force: true });
    } catch {
      // the temp dir may not have been made
    }
  });

  it("produces a GENERATED synthesis over the article run", () => {
    expect(document.synthesis.status).toBe("GENERATED");
  });

  it("resolves every synthesis statement to the article evidence id", () => {
    if (document.synthesis.status !== "GENERATED")
      return expect.unreachable("a generated synthesis");
    const articleSource = document.sources.find((source) => source.evidenceId === evidenceId);
    expect(articleSource).toBeDefined();
    if (articleSource === undefined) return;
    const numbers = new Set(document.sources.map((source) => source.number));
    expect(document.synthesis.statements.length).toBeGreaterThan(0);
    for (const statement of document.synthesis.statements) {
      expect(statement.citations.length).toBeGreaterThan(0);
      for (const n of statement.citations) expect(numbers.has(n)).toBe(true);
    }
    const cited = new Set(document.synthesis.statements.flatMap((s) => s.citations));
    expect([...cited]).toEqual([articleSource.number]);
  });

  it("uses only the allowed synthesis strengths", () => {
    if (document.synthesis.status !== "GENERATED")
      return expect.unreachable("a generated synthesis");
    const allowed = new Set(["CORRELATED", "INFERRED", "HYPOTHESIS"]);
    for (const statement of document.synthesis.statements) {
      expect(allowed.has(statement.strength)).toBe(true);
    }
  });

  it("meters the model call exactly once for input and once for output tokens", () => {
    const input = reportUsage.filter((row) => row.unit === "LLM_INPUT_TOKEN");
    const output = reportUsage.filter((row) => row.unit === "LLM_OUTPUT_TOKEN");
    expect(input).toHaveLength(1);
    expect(output).toHaveLength(1);
    expect(input[0]?.quantity).toBeGreaterThan(0);
    expect(output[0]?.quantity).toBeGreaterThan(0);
    // A legitimate validation retry aggregates two calls into the same usage row;
    // the exactly-once-metering guarantee is the single row per unit asserted above.
    expect(input[0]?.modelCalls).toBeGreaterThanOrEqual(1);
    expect(output[0]?.modelCalls).toBeGreaterThanOrEqual(1);
  });

  it("records the real model's provenance from the allowlisted configuration", () => {
    if (document.synthesis.status !== "GENERATED")
      return expect.unreachable("a generated synthesis");
    const model = document.synthesis.model;
    expect(model.id).toBe(expectedModelId);
    expect(allowedModel(model.id)).not.toBeNull();
    expect(["Apache-2.0", "MIT"]).toContain(model.licence);
    expect(model.endpointHost).toBe(expectedEndpointHost);
    expect(Array.isArray(model.regionHeaders)).toBe(true);
  });
});

/**
 * The queue wiring for article prose extraction (M4-4B), end to end over real
 * Redis and BullMQ: after a run is fused, the fusion worker fans out one
 * extraction per FOUND article job onto the extractions queue, and the
 * extractions worker processes it into one DERIVED claim. It also pins the
 * off-by-default rule: with extraction disabled (no model), fusion runs but
 * nothing is fanned out or written.
 *
 * The collector machinery (coordinator, collector-job processor) is wired
 * because startWorkerPool requires it, but this pool consumes only the fusion
 * and extractions queues, so none of it runs: the article job is pre-recorded
 * FOUND and fused, as the collect→fuse flow would have left it.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { CollectorRegistry, CollectorRuntime } from "@repo/collectors";
import { parseTenantId, type TenantId } from "@repo/core";
import {
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
  RedisCircuitBreaker,
  waitForRedisReady,
} from "@repo/integrations";
import { Queue } from "bullmq";
import type { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ArticleExtractionProcessor,
  ARTICLE_STATEMENTS_ATTRIBUTE,
  CollectionExecutor,
  CollectorJobProcessor,
  EXTRACTIONS_QUEUE,
  FUSION_QUEUE,
  RunCoordinator,
  RunFusion,
  startWorkerPool,
  VaultCredentialSource,
  type QueueConnection,
  type WorkerPool,
} from "../src/index.ts";
import { clientWith, extractionAnswer, ScriptedProvider } from "./llm-fake.ts";
import { TEST_ENGINE } from "./config.ts";

let db: Database;
let redis: Redis;
let contentDir: string;
let contentStore: FileSystemContentStore;
let vault: CredentialVault;

const AT = new Date(Date.parse("2026-10-23T09:00:00.000Z"));
const URL_VALUE = "https://news.example.com/world/story-77";
const BODY_TEXT = "Northwind Trading opened a branch in Harbour City in 2019.";
const RETRY = { maxAttempts: 3, baseDelayMs: 20, maxDelayMs: 100 } as const;

const ARTICLE_RESULT_VALUE = {
  headline: "Northwind opens a branch",
  derived: {
    url: URL_VALUE,
    outletDomain: "news.example.com",
    dedupKey: URL_VALUE,
    canonicalUrl: null,
    title: "Northwind opens a branch",
    author: null,
    language: "en",
    publishedAt: null,
    extractionStatus: "FULL_TEXT",
    bodyText: BODY_TEXT,
    bodyTextTruncated: false,
    mentions: [],
  },
};

const groundedAnswer = extractionAnswer([
  {
    subjectType: "ORGANIZATION",
    subject: "Northwind Trading",
    attribute: "opened_branch_in",
    value: "Harbour City",
    quote: BODY_TEXT,
  },
]);

beforeAll(async () => {
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
  contentDir = await mkdtemp(join(tmpdir(), "engine-extraction-"));
  contentStore = new FileSystemContentStore(contentDir);
  vault = new CredentialVault(
    new MasterKey({ keyId: "test-1", keyBase64: randomBytes(32).toString("base64") }),
  );
});

afterAll(async () => {
  await redis.quit();
  await db.close();
  await rm(contentDir, { recursive: true, force: true });
});

/** A pool over the fusion and extractions queues, with extraction wired on/off. */
async function startPool(
  enabled: boolean,
  llm: ReturnType<typeof clientWith> | { readonly unavailable: string },
): Promise<{
  readonly pool: WorkerPool;
  readonly connection: QueueConnection;
  close: () => Promise<void>;
}> {
  const namespace = `xt-${randomUUID().slice(0, 8)}`;
  const connection: QueueConnection = { url: TEST_ENGINE.redisUrl, prefix: namespace };
  const runtime = new CollectorRuntime({
    registry: new CollectorRegistry({ sources: [], collectors: [] }),
    network: { rateLimiter: { acquire: () => Promise.resolve({ allowed: true }) } },
  });
  const executor = new CollectionExecutor({
    db,
    runtime,
    contentStore,
    credentials: new VaultCredentialSource(vault),
  });
  const pool = await startWorkerPool({
    connection,
    queues: [FUSION_QUEUE, EXTRACTIONS_QUEUE],
    sourceIds: [],
    coordinator: new RunCoordinator({ db, runtime }),
    processor: new CollectorJobProcessor({
      db,
      executor,
      runtime,
      circuit: new RedisCircuitBreaker({
        redis,
        keyPrefix: namespace,
        policy: {
          failureThreshold: 5,
          failureWindowMs: 60_000,
          coolingMs: 60_000,
          probeLeaseMs: 60_000,
        },
      }),
      retry: RETRY,
    }),
    fusion: new RunFusion({ db, registry: runtime.registry }),
    retry: RETRY,
    collectConcurrency: () => 1,
    investigationConcurrency: 1,
    fusionConcurrency: 1,
    extraction: {
      processor: new ArticleExtractionProcessor({ db, llm, retry: RETRY }),
      concurrency: 1,
      enabled,
    },
  });
  const fusionQueue = new Queue(FUSION_QUEUE, {
    connection: { url: connection.url },
    prefix: namespace,
  });
  return {
    pool,
    connection,
    async close() {
      await fusionQueue.close();
      await pool.close();
    },
  };
}

/** A tenant with a FOUND, fused article job and its evidence, as collect→fuse leaves it. */
async function articleRun(tag: string): Promise<{
  readonly tenantId: TenantId;
  readonly runId: string;
  readonly evidenceId: string;
}> {
  const tenantId = parseTenantId(randomUUID());
  await db.provisionTenant({ tenantId, name: `[Tenant ${tag}]`, region: "IN" });
  return db.withTenant(tenantId, async ({ repos }) => {
    const user = await repos.users.create({
      email: `a-${tag}@example.com`,
      displayName: null,
      status: "ACTIVE",
    });
    await repos.collectorsRegistry.register({
      collectorId: "article",
      sourceLabel: "Direct article fetch",
      discipline: "MEDIAINT",
      collectionMode: "ACTIVE",
      dataLicence: "[not applicable: test fixture]",
      commercialUse: "UNVERIFIED",
      enabled: true,
      disabledReason: null,
    });
    const investigation = await repos.investigations.create({
      title: `[Investigation ${tag}]`,
      target: URL_VALUE,
      createdByUserId: user.id,
    });
    const run = await repos.runs.create({
      investigationId: investigation.id,
      status: "RUNNING",
      requestedByUserId: user.id,
    });
    const job = await repos.jobs.create({
      runId: run.id,
      collectorId: "article",
      idempotencyKey: `${tag}:article`,
      status: "QUEUED",
      targetType: "URL",
      target: URL_VALUE,
    });
    const hash = hashContent(new TextEncoder().encode(`[article bytes ${tag}]`));
    const evidence = await repos.evidence.record({
      collectorId: "article",
      collectorVersion: "1.0.0",
      jobId: job.id,
      sourceUrl: URL_VALUE,
      contentHash: hash,
      payloadRef: contentRef(tenantId, hash),
      observedAt: null,
      collectedAt: AT,
      claimStrength: "REPORTED",
    });
    await repos.jobs.transition(job.id, {
      status: "SUCCEEDED",
      attempts: 1,
      outcome: "FOUND",
      result: ARTICLE_RESULT_VALUE,
      evidenceIds: [evidence.id],
      finishedAt: AT,
      fusedAt: AT,
    });
    return { tenantId, runId: run.id, evidenceId: evidence.id };
  });
}

async function enqueueFusion(
  connection: QueueConnection,
  tenantId: TenantId,
  runId: string,
): Promise<void> {
  const queue = new Queue(FUSION_QUEUE, {
    connection: { url: connection.url },
    prefix: connection.prefix,
  });
  try {
    await queue.add("fuse", { tenantId, runId }, { jobId: `fuse-${runId}` });
  } finally {
    await queue.close();
  }
}

async function waitFor<T>(
  read: () => Promise<T>,
  done: (v: T) => boolean,
  timeoutMs = 20_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error(`timed out: ${JSON.stringify(value)}`);
    await sleep(50);
  }
}

const statementClaims = (tenantId: TenantId, evidenceId: string) =>
  db.withTenant(tenantId, async ({ repos }) =>
    (await repos.claims.listForEvidence([evidenceId], { limit: 100 })).filter(
      (c) => c.attribute === ARTICLE_STATEMENTS_ATTRIBUTE,
    ),
  );

describe("the fusion worker fans out extraction after a run is fused (M4-4B)", () => {
  it("writes one DERIVED article_statements claim for the run's FOUND article job", async () => {
    const engine = await startPool(true, clientWith(new ScriptedProvider([groundedAnswer])));
    try {
      const { tenantId, runId, evidenceId } = await articleRun("queue-on");
      await enqueueFusion(engine.connection, tenantId, runId);
      const claims = await waitFor(
        () => statementClaims(tenantId, evidenceId),
        (rows) => rows.length === 1,
      );
      expect(claims[0]?.strength).toBe("DERIVED");
      expect(claims[0]?.entityId).not.toBeNull();
    } finally {
      await engine.close();
    }
  }, 40_000);

  it("fans out nothing and writes no claim when extraction is disabled (no model)", async () => {
    const engine = await startPool(false, { unavailable: "No hosted LLM provider is configured." });
    try {
      const { tenantId, runId, evidenceId } = await articleRun("queue-off");
      await enqueueFusion(engine.connection, tenantId, runId);
      // Let the fusion job settle, then confirm no extraction was fanned out.
      await waitFor(
        () => db.withTenant(tenantId, ({ repos }) => repos.runs.findById(runId)),
        (run) => run !== null && run.status !== "RUNNING",
      );
      await sleep(500);
      expect(await statementClaims(tenantId, evidenceId)).toEqual([]);
    } finally {
      await engine.close();
    }
  }, 40_000);
});

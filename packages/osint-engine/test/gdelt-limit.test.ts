/**
 * RELEASE-BLOCKING (Track M Day 2). GDELT asks for one request every five
 * seconds, and the gdelt-doc source declares it (catalogue.ts). The limit is
 * shared across tenants and processes through the one Redis sliding log,
 * keyed by the source alone. Here two workers, each with its own Redis
 * connection as two worker processes have, run the real news collector on a
 * topic for two tenants at the same moment: GDELT is asked twice, five seconds
 * apart on Redis's own clock, and the one key the limit keeps names no tenant.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createPlatformRegistry,
  PLATFORM_COLLECTORS,
  tenantRegistration,
  type RateLimitAnswer,
  type UpstreamRateLimiter,
} from "@repo/collectors";
import { loadFixture, startHarness, type Harness } from "@repo/collectors/testing";
import { parseTenantId, type TenantId } from "@repo/core";
import { createDatabase, FileSystemContentStore, type Database } from "@repo/db";
import {
  createRedisClient,
  CredentialVault,
  MasterKey,
  SlidingLogRateLimiter,
  waitForRedisReady,
} from "@repo/integrations";
import type { Redis } from "ioredis";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  CollectionExecutor,
  CollectorJobProcessor,
  redisUpstreamRateLimiter,
  VaultCredentialSource,
} from "../src/index.ts";
import { TEST_ENGINE } from "./config.ts";

/** The live recording of a topic search (test/fixtures/news/found.json). */
const FOUND = loadFixture("news", "found");
const TOPIC = "climate change";

let db: Database;
let owner: pg.Client;
let contentDir: string;
let contentStore: FileSystemContentStore;
let vault: CredentialVault;
const clients: Redis[] = [];

beforeAll(async () => {
  db = createDatabase({
    connectionString: TEST_ENGINE.databaseUrl,
    onConnectionError: () => undefined,
  });
  owner = new pg.Client({ connectionString: TEST_ENGINE.databaseOwnerUrl });
  await owner.connect();
  contentDir = await mkdtemp(join(tmpdir(), "engine-gdelt-"));
  contentStore = new FileSystemContentStore(contentDir);
  vault = new CredentialVault(
    new MasterKey({ keyId: "test-1", keyBase64: randomBytes(32).toString("base64") }),
  );
});

afterAll(async () => {
  await Promise.all(clients.map((client) => client.quit()));
  await owner.end();
  await db.close();
  await rm(contentDir, { recursive: true, force: true });
});

/** A tenant whose plan and vetting allow a TOPIC, with a queued news job on one. */
async function tenantWithTopicJob(tag: string): Promise<{ tenantId: TenantId; jobId: string }> {
  const tenantId = parseTenantId(randomUUID());
  await db.provisionTenant({ tenantId, name: `[Tenant ${tag}]`, region: "IN" });
  // As an operator would: the application role cannot change a plan or vetting.
  await owner.query("begin");
  try {
    await owner.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    await owner.query("update public.tenants set plan = $1, vetting_status = $2", [
      "TECHINT_AND_PERSON",
      "APPROVED",
    ]);
    await owner.query("commit");
  } catch (error) {
    await owner.query("rollback");
    throw error;
  }
  const jobId = await db.withTenant(tenantId, async ({ repos }) => {
    const user = await repos.users.create({
      email: `analyst-${tag}@example.com`,
      displayName: `[Analyst ${tag}]`,
      status: "ACTIVE",
    });
    const investigation = await repos.investigations.create({
      title: `[Investigation ${tag}]`,
      target: TOPIC,
      createdByUserId: user.id,
    });
    const run = await repos.runs.create({
      investigationId: investigation.id,
      status: "RUNNING",
      requestedByUserId: user.id,
      requestedTargetType: "TOPIC",
    });
    // As planning does: the tenant's copy of the registry entry, labelled from it.
    await repos.collectorsRegistry.register(
      tenantRegistration(createPlatformRegistry().entry("news")),
    );
    const job = await repos.jobs.create({
      runId: run.id,
      collectorId: "news",
      idempotencyKey: `gdelt-limit:${tag}:${run.id}`,
      status: "QUEUED",
      targetType: "TOPIC",
      target: TOPIC,
    });
    return job.id;
  });
  return { tenantId, jobId };
}

/** Every key matching `pattern`, the whole keyspace scanned (other suites share this database). */
async function keysMatching(client: Redis | undefined, pattern: string): Promise<string[]> {
  if (client === undefined) throw new Error("no Redis client");
  const keys: string[] = [];
  let cursor = "0";
  do {
    const [next, batch] = await client.scan(cursor, "MATCH", pattern, "COUNT", 1000);
    keys.push(...batch);
    cursor = next;
  } while (cursor !== "0");
  return keys;
}

interface Worker {
  readonly harness: Harness;
  readonly processor: CollectorJobProcessor;
  readonly asked: { sourceId: string; limit: number; intervalMs: number }[];
}

/**
 * One worker process: its own Redis connection and sliding log, under the
 * prefix every worker of a deployment shares, and its own collector runtime.
 * `admitted` collects, on Redis's clock, when each request it sent was let through.
 */
async function startWorker(prefix: string, admitted: number[]): Promise<Worker> {
  const client = createRedisClient({
    url: TEST_ENGINE.redisUrl,
    commandTimeoutMs: 2_000,
    connectTimeoutMs: 2_000,
  });
  clients.push(client);
  await waitForRedisReady(client, { timeoutMs: 5_000 });
  const shared = redisUpstreamRateLimiter(
    new SlidingLogRateLimiter({ redis: client, keyPrefix: prefix }),
  );
  const asked: Worker["asked"] = [];
  const rateLimiter: UpstreamRateLimiter = {
    acquire: async (sourceId, policy): Promise<RateLimitAnswer> => {
      asked.push({ sourceId, ...policy });
      const answer = await shared.acquire(sourceId, policy);
      if (answer.allowed) {
        // The newest entry of the log is the one just admitted: its score is
        // Redis's own time for it, in microseconds (the bounds are strings, as
        // ioredis types them; the answer is the one member with its score).
        const [, score] = z
          .tuple([z.string(), z.string()])
          .parse(await client.zrange(`{${prefix}:upstream:${sourceId}}`, "-1", "-1", "WITHSCORES"));
        admitted.push(Number(score));
      }
      return answer;
    },
  };
  const harness = await startHarness({
    collectors: PLATFORM_COLLECTORS.filter((collector) => collector.declaration.id === "news"),
    fixtures: [FOUND],
    rateLimiter,
  });
  const executor = new CollectionExecutor({
    db,
    runtime: harness.runtime,
    contentStore,
    credentials: new VaultCredentialSource(vault),
  });
  const processor = new CollectorJobProcessor({
    db,
    executor,
    runtime: harness.runtime,
    circuit: null,
    retry: { maxAttempts: 1, baseDelayMs: 10, maxDelayMs: 10 },
  });
  return { harness, processor, asked };
}

describe("GDELT's one request every five seconds holds across two workers and two tenants (RELEASE-BLOCKING, Track M Day 2)", () => {
  it("spaces two workers' GDELT requests five seconds apart on Redis's clock, under one key that names no tenant", async () => {
    // Every worker of one deployment uses the same prefix (worker.ts: `${QUEUE_PREFIX}:upstream`).
    const prefix = `test:${randomUUID().slice(0, 8)}:upstream`;
    const admitted: number[] = [];
    const workers = [await startWorker(prefix, admitted), await startWorker(prefix, admitted)];
    try {
      const tenants = [await tenantWithTopicJob("gdelt-a"), await tenantWithTopicJob("gdelt-b")];
      const dispositions = await Promise.all(
        workers.map((worker, i) => {
          const tenant = tenants[i];
          if (tenant === undefined) throw new Error("no tenant");
          return worker.processor.process(tenant.tenantId, tenant.jobId, { finalAttempt: true });
        }),
      );
      for (const disposition of dispositions) {
        expect(disposition).toEqual({ kind: "COMPLETED", status: "SUCCEEDED", outcome: "FOUND" });
      }
      // GDELT was asked once by each worker, for its own tenant's topic.
      for (const worker of workers) {
        expect(worker.harness.unmatched).toEqual([]);
        expect(worker.harness.requests.map((request) => request.path)).toEqual([
          FOUND.request.path,
        ]);
        expect(new Set(worker.asked.map((ask) => JSON.stringify(ask)))).toEqual(
          new Set([JSON.stringify({ sourceId: "gdelt-doc", limit: 1, intervalMs: 5_000 })]),
        );
      }
      // Two admissions, at least five seconds apart by the one clock both workers share.
      expect(admitted).toHaveLength(2);
      const [first, second] = [...admitted].sort((a, b) => a - b);
      if (first === undefined || second === undefined) throw new Error("two admissions expected");
      expect(second - first).toBeGreaterThanOrEqual(5_000_000);
      // One limit for the source, whoever asks: its keys name the source, never a tenant.
      const keys = await keysMatching(clients[0], `{${prefix}:*`);
      expect(keys.sort()).toEqual(
        [`{${prefix}:upstream:gdelt-doc}`, `{${prefix}:upstream:gdelt-doc}:seq`].sort(),
      );
      for (const tenant of tenants) {
        expect(keys.some((key) => key.includes(tenant.tenantId))).toBe(false);
      }
      // Each tenant's evidence is its own: one GDELT response each.
      for (const tenant of tenants) {
        const job = await db.withTenant(tenant.tenantId, ({ repos }) =>
          repos.jobs.findById(tenant.jobId),
        );
        expect([job?.outcome, job?.evidenceIds?.length]).toEqual(["FOUND", 1]);
      }
    } finally {
      await Promise.all(workers.map((worker) => worker.harness.close()));
    }
  }, 30_000);
});

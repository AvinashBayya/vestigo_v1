import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { loadEnvSubset } from "@repo/config";
import { parseTenantId } from "@repo/core";
import { createDatabase, type Database } from "@repo/db";
import { collectQueueName, InvestigationQueue } from "@repo/osint-engine";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_WORKER } from "../test/config.ts";
import { startWorker, WORKER_ENV, type WorkerEnv } from "./worker.ts";

const entry = join(import.meta.dirname, "index.ts");

function runWorker(extraEnv: Record<string, string>) {
  const env: Record<string, string> = { ...extraEnv };
  for (const name of ["PATH", "SystemRoot", "SYSTEMROOT"]) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return spawnSync(process.execPath, [entry], { env, encoding: "utf8", timeout: 20_000 });
}

describe("worker entry point", () => {
  it("fails fast on invalid config before doing anything else", () => {
    const run = runWorker({});
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("CONFIG_INVALID");
    expect(run.stderr).toContain("DATABASE_URL");
    expect(run.stderr).toContain("VAULT_MASTER_KEY");
  });
});

describe("the worker, deployed as pools selected by queue", () => {
  let contentDir: string;
  let db: Database;
  const silent = pino({ level: "silent" });

  const envFor = (queues: string): WorkerEnv =>
    loadEnvSubset(WORKER_ENV, {
      NODE_ENV: "test",
      DATABASE_URL: TEST_WORKER.databaseUrl,
      REDIS_URL: TEST_WORKER.redisUrl,
      VAULT_MASTER_KEY: randomBytes(32).toString("base64"),
      VAULT_MASTER_KEY_ID: "test-1",
      CONTENT_STORE_DIR: contentDir,
      QUEUE_PREFIX: `wt-${randomUUID().slice(0, 8)}`,
      WORKER_QUEUES: queues,
    });

  beforeAll(async () => {
    contentDir = await mkdtemp(join(tmpdir(), "worker-content-"));
    db = createDatabase({
      connectionString: TEST_WORKER.databaseUrl,
      onConnectionError: () => undefined,
    });
  });

  afterAll(async () => {
    await db.close();
    await rm(contentDir, { recursive: true, force: true });
  });

  it("consumes exactly the queues WORKER_QUEUES names", async () => {
    const planning = await startWorker(envFor("investigations,fusion"), silent);
    const collecting = await startWorker(envFor("collect.*"), silent);
    const analysing = await startWorker(envFor("case-analyses"), silent);
    try {
      expect(planning.pool.queues).toEqual(["investigations", "fusion"]);
      // Case analyses: their own queue, consumed alone when named alone.
      expect(analysing.pool.queues).toEqual(["case-analyses"]);
      // One queue per source a registered collector reads: its own bulkhead.
      expect(collecting.pool.queues).toContain(collectQueueName("crtsh"));
      expect(collecting.pool.queues).toContain(collectQueueName("hacker-news"));
      expect(collecting.pool.queues).not.toContain("investigations");
      expect(collecting.pool.queues.every((name) => name.startsWith("collect."))).toBe(true);
    } finally {
      await planning.close();
      await collecting.close();
      await analysing.close();
    }
  });

  it("refuses to start without somewhere to store evidence", async () => {
    const env = envFor("*");
    await expect(startWorker({ ...env, CONTENT_STORE_DIR: undefined }, silent)).rejects.toThrow(
      /CONTENT_STORE_DIR/,
    );
  });

  it("a planning pool plans a run and queues its collector jobs, without collecting anything", async () => {
    const env = envFor("investigations");
    const worker = await startWorker(env, silent);
    const queue = new InvestigationQueue(
      { url: env.REDIS_URL, prefix: env.QUEUE_PREFIX },
      { maxAttempts: 1, baseDelayMs: 10, maxDelayMs: 10 },
    );
    try {
      const tenantId = parseTenantId(randomUUID());
      await db.provisionTenant({ tenantId, name: "[Tenant worker]", region: "IN" });
      const run = await db.withTenant(tenantId, async ({ repos }) => {
        const investigation = await repos.investigations.create({
          title: "[Investigation]",
          target: "example.com",
          createdByUserId: null,
        });
        return repos.runs.create({
          investigationId: investigation.id,
          status: "QUEUED",
          requestedByUserId: null,
        });
      });
      await queue.enqueueRun(tenantId, run.id);
      const deadline = Date.now() + 15_000;
      let jobs = await db.withTenant(tenantId, ({ repos }) =>
        repos.jobs.listForRun(run.id, { limit: 100 }),
      );
      while (jobs.length === 0 && Date.now() < deadline) {
        await sleep(100);
        jobs = await db.withTenant(tenantId, ({ repos }) =>
          repos.jobs.listForRun(run.id, { limit: 100 }),
        );
      }
      const planned = await db.withTenant(tenantId, ({ repos }) => repos.runs.findById(run.id));
      expect(planned?.status).toBe("RUNNING");
      // Every domain collector planned; none run, because no pool here collects.
      expect(jobs.map((job) => job.collectorId).sort()).toEqual([
        "commoncrawl",
        "crtsh",
        "dns",
        "rdap",
        "wayback",
      ]);
      expect(jobs.every((job) => job.status === "QUEUED" && job.attempts === 0)).toBe(true);
    } finally {
      await queue.close();
      await worker.close();
    }
  });
});

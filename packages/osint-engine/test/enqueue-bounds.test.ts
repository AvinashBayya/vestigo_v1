/**
 * RELEASE-BLOCKING. No enqueue waits without bound (CLAUDE.md §5). While Redis
 * cannot be reached, a BullMQ add waits in the client's offline queue and
 * reconnects forever; every producer gives up past its bound with
 * QUEUE_UNAVAILABLE instead: the run's planning job, a report's generation, a
 * report's PDF render, a case analysis attempt, and a job's replay (which has
 * marked the job QUEUED first, and says so through the API).
 */
import { randomUUID } from "node:crypto";
import { createPlatformRegistry } from "@repo/collectors";
import { parseTenantId, type TenantId } from "@repo/core";
import { createDatabase, type Database } from "@repo/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CaseAnalysisQueue,
  InvestigationQueue,
  JobReplayer,
  QueueUnavailableError,
  ReportQueue,
  ReportRenderQueue,
  type QueueConnection,
} from "../src/index.ts";
import { provisionTenant } from "./case-fixture.ts";
import { TEST_ENGINE } from "./config.ts";

const BOUND_MS = 300;
const RETRY = { maxAttempts: 1, baseDelayMs: 10, maxDelayMs: 10 };

/** Nothing listens on port 1: the client keeps trying to connect. */
const unreachable = (): QueueConnection => ({
  url: "redis://127.0.0.1:1",
  prefix: `unreachable-${randomUUID().slice(0, 8)}`,
});

let db: Database;

beforeAll(() => {
  db = createDatabase({
    connectionString: TEST_ENGINE.databaseUrl,
    onConnectionError: () => undefined,
  });
});

afterAll(async () => {
  await db.close();
});

/** Runs `enqueue` and expects QUEUE_UNAVAILABLE, well before the 5 s default would have passed. */
async function expectGivesUp(enqueue: () => Promise<unknown>): Promise<void> {
  const started = Date.now();
  const refused = await enqueue().catch((error: unknown) => error);
  expect(refused).toBeInstanceOf(QueueUnavailableError);
  expect(refused).toMatchObject({ code: "QUEUE_UNAVAILABLE" });
  expect(Date.now() - started).toBeLessThan(3_000);
}

/** Closing a producer that never connected must not hold the suite open. */
const settle = (close: () => Promise<void>) =>
  Promise.race([close(), new Promise((resolve) => setTimeout(resolve, 2_000))]);

describe("every enqueue gives up past its bound when the queue cannot be reached (RELEASE-BLOCKING)", () => {
  const tenantId: TenantId = parseTenantId(randomUUID());

  it("a run's planning job", async () => {
    const queue = new InvestigationQueue(unreachable(), RETRY, { enqueueTimeoutMs: BOUND_MS });
    try {
      await expectGivesUp(() => queue.enqueueRun(tenantId, randomUUID()));
    } finally {
      await settle(() => queue.close());
    }
  });

  it("a report's generation", async () => {
    const queue = new ReportQueue(unreachable(), RETRY, { enqueueTimeoutMs: BOUND_MS });
    try {
      await expectGivesUp(() => queue.enqueueReport(tenantId, randomUUID()));
    } finally {
      await settle(() => queue.close());
    }
  });

  it("a report's PDF render", async () => {
    const queue = new ReportRenderQueue(unreachable(), RETRY, { enqueueTimeoutMs: BOUND_MS });
    try {
      await expectGivesUp(() => queue.enqueueRender(tenantId, randomUUID()));
    } finally {
      await settle(() => queue.close());
    }
  });

  it("a case analysis attempt", async () => {
    const queue = new CaseAnalysisQueue(unreachable(), RETRY, { enqueueTimeoutMs: BOUND_MS });
    try {
      await expectGivesUp(() => queue.enqueueAnalysis(tenantId, randomUUID(), 1));
    } finally {
      await settle(() => queue.close());
    }
  });

  it("a job's replay, after marking the job QUEUED", async () => {
    const tenant = await provisionTenant(db, "enqueue-replay");
    const jobId = await db.withTenant(tenant.tenantId, async ({ repos }) => {
      await repos.collectorsRegistry.register({
        collectorId: "crtsh",
        sourceLabel: "[crtsh]",
        discipline: "TECHINT",
        collectionMode: "PASSIVE_API",
        dataLicence: "[not applicable: test fixture]",
        commercialUse: "UNVERIFIED",
        enabled: true,
        disabledReason: null,
      });
      const investigation = await repos.investigations.create({
        title: "[Investigation]",
        target: "example.com",
        createdByUserId: tenant.userId,
      });
      const run = await repos.runs.create({
        investigationId: investigation.id,
        status: "PARTIAL",
        requestedByUserId: tenant.userId,
      });
      const job = await repos.jobs.create({
        runId: run.id,
        collectorId: "crtsh",
        idempotencyKey: `enqueue-replay:${run.id}`,
        status: "QUEUED",
        targetType: "DOMAIN",
        target: "example.com",
      });
      await repos.jobs.transition(job.id, {
        status: "FAILED",
        attempts: 1,
        finishedAt: new Date(Date.parse("2026-10-09T09:00:00.000Z")),
      });
      return job.id;
    });
    const replayer = new JobReplayer({
      db,
      registry: createPlatformRegistry(),
      connection: unreachable(),
      retry: RETRY,
      enqueueTimeoutMs: BOUND_MS,
    });
    try {
      await expectGivesUp(() => replayer.replay(tenant.tenantId, jobId));
      // The job was marked for replay before the enqueue: it stays queued.
      const job = await db.withTenant(tenant.tenantId, ({ repos }) => repos.jobs.findById(jobId));
      expect(job?.status).toBe("QUEUED");
    } finally {
      await settle(() => replayer.close());
    }
  });
});

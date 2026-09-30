/**
 * RELEASE-BLOCKING. Runs through the public API, with real worker pools
 * behind it: the API only enqueues, and returns at once; a run with one
 * collector failing reads PARTIAL with that failure shown, over GET and over
 * the progress stream; replays, quotas, permissions and tenant isolation hold
 * at the HTTP boundary. Collectors are the real registered ones, answering
 * from the collectors package's recorded fixtures; nothing reaches the network.
 */
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { PLATFORM_COLLECTORS } from "@repo/collectors";
import { loadFixture, startHarness, type Fixture, type Harness } from "@repo/collectors/testing";
import type { TenantId } from "@repo/core";
import { FileSystemContentStore } from "@repo/db";
import {
  createRedisClient,
  CredentialVault,
  MasterKey,
  RedisCircuitBreaker,
  waitForRedisReady,
} from "@repo/integrations";
import {
  CollectionExecutor,
  CollectorJobProcessor,
  RunCoordinator,
  RunFusion,
  startWorkerPool,
  VaultCredentialSource,
  type WorkerPool,
} from "@repo/osint-engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { TEST_API } from "./config.ts";
import {
  asOwner,
  Browser,
  createTestApi,
  joinAs,
  provisionTestTenant,
  readyBrowser,
  type TestApi,
} from "./support.ts";

// ── The API, and worker pools consuming its queues ────────────────────────

let api: TestApi;
let harness: Harness;
let redis: ReturnType<typeof createRedisClient>;
let contentDir: string;
let pools: WorkerPool[];
let owner: Browser;
let tenantId: TenantId;

function waybackUnavailableFor(domain: string): Fixture {
  const fixture = loadFixture("wayback", "unavailable-503");
  return {
    ...fixture,
    provenance: {
      ...fixture.provenance,
      notes: `${fixture.provenance.notes} Re-pointed at ${domain} by the API run tests, as the deliberately failing collector.`,
    },
    request: {
      ...fixture.request,
      path: fixture.request.path.replace("unavailable.example", domain),
    },
  };
}

beforeAll(async () => {
  harness = await startHarness({
    collectors: PLATFORM_COLLECTORS.filter((c) =>
      ["crtsh", "dns", "rdap", "wayback"].includes(c.declaration.id),
    ),
    fixtures: [
      loadFixture("crtsh", "found-example-com"),
      loadFixture("dns", "found-example-com"),
      loadFixture("rdap", "rdap-org-example-com-redirect"),
      loadFixture("rdap", "verisign-example-com"),
      waybackUnavailableFor("example.com"),
    ],
  });
  api = await createTestApi({ registry: harness.runtime.registry });
  redis = createRedisClient({
    url: TEST_API.redisUrl,
    commandTimeoutMs: 2_000,
    connectTimeoutMs: 2_000,
  });
  await waitForRedisReady(redis, { timeoutMs: 5_000 });
  contentDir = await mkdtemp(join(tmpdir(), "api-runs-"));

  const runtime = harness.runtime;
  const executor = new CollectionExecutor({
    db: api.db,
    runtime,
    contentStore: new FileSystemContentStore(contentDir),
    credentials: new VaultCredentialSource(
      new CredentialVault(
        new MasterKey({ keyId: "t", keyBase64: randomBytes(32).toString("base64") }),
      ),
    ),
  });
  const common = {
    connection: api.queue,
    sourceIds: [...new Set(runtime.registry.list().map((entry) => entry.source.id))],
    coordinator: new RunCoordinator({ db: api.db, runtime }),
    processor: new CollectorJobProcessor({
      db: api.db,
      executor,
      runtime,
      circuit: new RedisCircuitBreaker({
        redis,
        keyPrefix: api.queue.prefix,
        policy: {
          failureThreshold: 1000,
          failureWindowMs: 60_000,
          coolingMs: 60_000,
          probeLeaseMs: 60_000,
        },
      }),
      retry: api.retry,
    }),
    fusion: new RunFusion({ db: api.db, registry: runtime.registry }),
    retry: api.retry,
    collectConcurrency: () => 2,
    investigationConcurrency: 2,
    fusionConcurrency: 2,
  };
  pools = [
    await startWorkerPool({ ...common, queues: ["investigations", "fusion"] }),
    await startWorkerPool({ ...common, queues: ["collect.*"] }),
  ];

  const provisioned = await provisionTestTenant(api, "runs");
  tenantId = provisioned.tenantId;
  owner = await readyBrowser(api, provisioned.owner, tenantId);
}, 60_000);

afterAll(async () => {
  await Promise.all(pools.map((pool) => pool.close()));
  await api.close();
  await harness.close();
  await redis.quit();
  await rm(contentDir, { recursive: true, force: true });
});

// ── Helpers ───────────────────────────────────────────────────────────────

const JobShape = z.object({
  id: z.uuid(),
  collectorId: z.string(),
  sourceLabel: z.string(),
  status: z.string(),
  outcome: z.string().nullable(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  attempts: z.number(),
  evidenceIds: z.array(z.uuid()),
});
const RunShape = z.object({
  id: z.uuid(),
  status: z.string(),
  settled: z.boolean(),
  counts: z.record(z.string(), z.number()),
  jobs: z.array(JobShape),
});

async function investigation(browser: Browser, target: string): Promise<string> {
  const created = await browser.request("POST", "/api/v1/investigations", {
    title: `[Investigation of ${target}]`,
    target,
  });
  expect(created.status).toBe(201);
  return created.json<{ id: string }>().id;
}

async function settledRun(browser: Browser, runId: string) {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const read = await browser.request("GET", `/api/v1/runs/${runId}`);
    expect(read.status).toBe(200);
    const run = RunShape.parse(read.json());
    if (run.settled) return run;
    if (Date.now() > deadline) throw new Error(`run not settled: ${read.body}`);
    await sleep(100);
  }
}

// ── The checkpoint, through the API ───────────────────────────────────────

describe("an investigation through the API: partial completion, the failure surfaced (RELEASE-BLOCKING)", () => {
  let runId: string;
  let started: z.infer<typeof RunShape>;
  let startedInMs: number;

  beforeAll(async () => {
    const id = await investigation(owner, "example.com");
    const before = performance.now();
    const response = await owner.request("POST", `/api/v1/investigations/${id}/runs`, {});
    startedInMs = performance.now() - before;
    expect(response.status).toBe(202);
    started = RunShape.parse(response.json());
    runId = started.id;
  }, 30_000);

  it("returns at once with the queued run: the API does no collection work", () => {
    expect(started.status).toBe("QUEUED");
    expect(started.jobs).toEqual([]);
    expect(startedInMs).toBeLessThan(2_000);
  });

  it("reads PARTIAL, never an empty success, with the one failure shown and labelled", async () => {
    const run = await settledRun(owner, runId);
    expect(run.status).toBe("PARTIAL");
    expect(
      run.jobs
        .map((job) => [job.collectorId, job.status, job.outcome, job.error?.code ?? null])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ).toEqual([
      ["crtsh", "SUCCEEDED", "FOUND", null],
      ["dns", "SUCCEEDED", "FOUND", null],
      ["rdap", "SUCCEEDED", "FOUND", null],
      ["wayback", "DEAD_LETTERED", "UNAVAILABLE", "UPSTREAM_UNAVAILABLE"],
    ]);
    const wayback = run.jobs.find((job) => job.collectorId === "wayback");
    expect(wayback?.sourceLabel).toBe("Wayback Machine captures");
    expect(wayback?.error?.message).toMatch(/503/);
    expect(run.counts).toMatchObject({ SUCCEEDED: 3, DEAD_LETTERED: 1 });
  });

  it("streams the run's progress, then ends with its status", async () => {
    const id = await investigation(owner, "example.com");
    const start = await owner.request("POST", `/api/v1/investigations/${id}/runs`, {});
    const streamed = await owner.request(
      "GET",
      `/api/v1/runs/${RunShape.parse(start.json()).id}/events`,
    );
    expect(streamed.status).toBe(200);
    expect(String(streamed.headers["content-type"])).toMatch(/^text\/event-stream/);
    const events = streamed.body
      .split("\n\n")
      .filter((block) => block.startsWith("event: "))
      .map((block) => {
        const [eventLine = "", dataLine = ""] = block.split("\n");
        return {
          event: eventLine.slice(7),
          data: JSON.parse(dataLine.slice(6)) as Record<string, unknown>,
        };
      });
    expect(events[0]?.event).toBe("run");
    expect(events.at(-1)).toEqual({ event: "end", data: { status: "PARTIAL" } });
    const jobEvents = events.filter((e) => e.event === "job").map((e) => JobShape.parse(e.data));
    expect(new Set(jobEvents.map((job) => job.collectorId))).toEqual(
      new Set(["crtsh", "dns", "rdap", "wayback"]),
    );
    // The failing job's progress was streamed as it happened: queued for a
    // retry, then dead-lettered.
    const wayback = jobEvents.filter((job) => job.collectorId === "wayback");
    expect(wayback.at(-1)?.status).toBe("DEAD_LETTERED");
    expect(wayback.length).toBeGreaterThan(1);
  }, 30_000);

  it("replays a dead-lettered job, refuses to replay one that succeeded, and 404s one that does not exist", async () => {
    const run = await settledRun(owner, runId);
    const crtsh = run.jobs.find((job) => job.collectorId === "crtsh");
    const wayback = run.jobs.find((job) => job.collectorId === "wayback");
    const refused = await owner.request("POST", `/api/v1/jobs/${String(crtsh?.id)}/replay`, {});
    expect(refused.status).toBe(409);
    expect(refused.json()).toMatchObject({ code: "JOB_NOT_REPLAYABLE" });
    const missing = await owner.request(
      "POST",
      "/api/v1/jobs/00000000-0000-4000-8000-000000000000/replay",
      {},
    );
    expect(missing.status).toBe(404);

    const evidenceBefore = run.jobs.flatMap((job) => job.evidenceIds).sort();
    const replayed = await owner.request("POST", `/api/v1/jobs/${String(wayback?.id)}/replay`, {});
    expect(replayed.status).toBe(202);
    expect(replayed.json()).toEqual({ runId });
    const deadline = Date.now() + 20_000;
    let after = RunShape.parse((await owner.request("GET", `/api/v1/runs/${runId}`)).json());
    if (wayback === undefined) throw new Error("no wayback job");
    const waybackAttempts = (current: z.infer<typeof RunShape>): number => {
      const job = current.jobs.find((j) => j.collectorId === "wayback");
      if (job === undefined) throw new Error("no wayback job");
      return job.attempts;
    };
    while (!(after.settled && waybackAttempts(after) > wayback.attempts)) {
      if (Date.now() > deadline) throw new Error("replay did not finish");
      await sleep(100);
      after = RunShape.parse((await owner.request("GET", `/api/v1/runs/${runId}`)).json());
    }
    expect(after.status).toBe("PARTIAL");
    expect(after.jobs.flatMap((job) => job.evidenceIds).sort()).toEqual(evidenceBefore);
  }, 30_000);

  it("reports the tenant's usage: every upstream request metered", async () => {
    const usage = await owner.request("GET", "/api/v1/usage");
    expect(usage.status).toBe(200);
    const body = z
      .object({
        lines: z.array(
          z.object({ period: z.string(), used: z.number(), maxQuantity: z.number().nullable() }),
        ),
        exceeded: z.boolean(),
      })
      .parse(usage.json());
    expect(body.exceeded).toBe(false);
    const day = body.lines.find((line) => line.period === "DAY");
    expect(day?.used).toBeGreaterThan(0);
    expect(day?.maxQuantity).toBeNull();
  });
});

// ── Quotas, permissions, isolation ────────────────────────────────────────

describe("runs at the HTTP boundary", () => {
  it("refuses to start a run once a quota is spent, before anything is queued", async () => {
    const provisioned = await provisionTestTenant(api, "runs-quota");
    const browser = await readyBrowser(api, provisioned.owner, provisioned.tenantId);
    await asOwner(
      provisioned.tenantId,
      `insert into public.tenant_quotas (tenant_id, unit, period, max_quantity)
       values ($1, 'UPSTREAM_REQUEST', 'MONTH', 0)`,
      [provisioned.tenantId],
    );
    const id = await investigation(browser, "example.com");
    const refused = await browser.request("POST", `/api/v1/investigations/${id}/runs`, {});
    expect(refused.status).toBe(429);
    expect(refused.json()).toMatchObject({ code: "QUOTA_EXCEEDED" });
    const runs = await browser.request("GET", `/api/v1/investigations/${id}/runs`);
    expect(runs.json()).toEqual({ items: [], hasMore: false });
  });

  it("lets a viewer read runs, and not start or replay them", async () => {
    const viewer = await joinAs(api, owner, tenantId, "viewer", "runs-viewer");
    const id = await investigation(owner, "example.com");
    expect((await viewer.request("POST", `/api/v1/investigations/${id}/runs`, {})).status).toBe(
      403,
    );
    const started = await owner.request("POST", `/api/v1/investigations/${id}/runs`, {});
    const runId = RunShape.parse(started.json()).id;
    expect((await viewer.request("GET", `/api/v1/runs/${runId}`)).status).toBe(200);
    expect((await viewer.request("GET", `/api/v1/investigations/${id}/runs`)).status).toBe(200);
    const run = await settledRun(owner, runId);
    const job = run.jobs[0];
    const replay = await viewer.request("POST", `/api/v1/jobs/${String(job?.id)}/replay`, {});
    expect(replay.status).toBe(403);
    expect(replay.json()).toMatchObject({ code: "PERMISSION_DENIED" });
  }, 30_000);

  it("never shows, streams or replays another tenant's run (RELEASE-BLOCKING)", async () => {
    const id = await investigation(owner, "example.com");
    const started = await owner.request("POST", `/api/v1/investigations/${id}/runs`, {});
    const runId = RunShape.parse(started.json()).id;
    const run = await settledRun(owner, runId);
    const other = await provisionTestTenant(api, "runs-other");
    const stranger = await readyBrowser(api, other.owner, other.tenantId);
    expect((await stranger.request("GET", `/api/v1/runs/${runId}`)).status).toBe(404);
    expect((await stranger.request("GET", `/api/v1/runs/${runId}/events`)).status).toBe(404);
    expect((await stranger.request("GET", `/api/v1/investigations/${id}/runs`)).status).toBe(404);
    expect((await stranger.request("POST", `/api/v1/investigations/${id}/runs`, {})).status).toBe(
      404,
    );
    const job = run.jobs.find((row) => row.status === "DEAD_LETTERED");
    expect(
      (await stranger.request("POST", `/api/v1/jobs/${String(job?.id)}/replay`, {})).status,
    ).toBe(404);
  }, 30_000);
});

/**
 * RELEASE-BLOCKING (Track M Day 2; CLAUDE.md §9). GDELT, held since Phase 3B,
 * is registered for a TOPIC behind the Day 1 gate. Here the real news
 * collector runs a topic through the API and the workers, against GDELT's live
 * answer as recorded (test/fixtures/news/found.json):
 *   - its evidence carries the label from the registry and GDELT's required
 *     citation and link, never anything an article says;
 *   - a run that used only GDELT, a MEDIAINT source, is person data because
 *     its target is a TOPIC: once the organisation's plan or vetting no longer
 *     allows person investigation, every read of the run, its evidence, its
 *     entities and its pins is refused whole, with the Locked detail.
 */
import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { PLATFORM_COLLECTORS } from "@repo/collectors";
import { loadFixture, startHarness, type Harness } from "@repo/collectors/testing";
import type { TenantId } from "@repo/core";
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
  createTestApi,
  provisionTestTenant,
  readyBrowser,
  setEntitlement,
  type Browser,
  type TestApi,
} from "./support.ts";

let api: TestApi;
let harness: Harness;
let redis: ReturnType<typeof createRedisClient>;
let pool: WorkerPool;
let owner: Browser;
let tenantId: TenantId;

beforeAll(async () => {
  harness = await startHarness({
    collectors: PLATFORM_COLLECTORS.filter((collector) => collector.declaration.id === "news"),
    fixtures: [loadFixture("news", "found")],
  });
  api = await createTestApi({ registry: harness.runtime.registry });
  redis = createRedisClient({
    url: TEST_API.redisUrl,
    commandTimeoutMs: 2_000,
    connectTimeoutMs: 2_000,
  });
  await waitForRedisReady(redis, { timeoutMs: 5_000 });
  const runtime = harness.runtime;
  const executor = new CollectionExecutor({
    db: api.db,
    runtime,
    contentStore: api.services.runs.contentStore,
    credentials: new VaultCredentialSource(
      new CredentialVault(
        new MasterKey({ keyId: "t", keyBase64: randomBytes(32).toString("base64") }),
      ),
    ),
  });
  pool = await startWorkerPool({
    connection: api.queue,
    queues: ["*"],
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
    collectConcurrency: () => 1,
    investigationConcurrency: 1,
    fusionConcurrency: 1,
  });
  const provisioned = await provisionTestTenant(api, "gdelt-topic");
  tenantId = provisioned.tenantId;
  owner = await readyBrowser(api, provisioned.owner, tenantId);
}, 60_000);

afterAll(async () => {
  await pool.close();
  await api.close();
  await harness.close();
  await redis.quit();
});

const RunShape = z.object({
  settled: z.boolean(),
  status: z.string(),
  jobs: z.array(
    z.object({
      collectorId: z.string(),
      sourceLabel: z.string(),
      outcome: z.string().nullable(),
      evidenceIds: z.array(z.string()),
    }),
  ),
});

const EvidenceShape = z.object({
  collectorId: z.string(),
  sourceLabel: z.string().nullable(),
  attribution: z.object({ text: z.string(), url: z.string() }).nullable(),
  strength: z.string(),
  runId: z.string().nullable(),
  claimCount: z.number(),
});

interface LockedBody {
  code: string;
  locked: { reason: string; withheld: string; nextStep: string };
}

/** A TOPIC run started through the API, as an analyst would, once its jobs have settled. */
async function settledTopicRun(
  topic: string,
): Promise<{ runId: string; run: z.infer<typeof RunShape> }> {
  const created = await owner.request("POST", "/api/v1/investigations", {
    title: "[Investigation of a topic]",
    target: topic,
  });
  expect(created.status).toBe(201);
  const started = await owner.request(
    "POST",
    `/api/v1/investigations/${created.json<{ id: string }>().id}/runs`,
    { targetType: "TOPIC" },
  );
  expect(started.status, started.body).toBe(202);
  const runId = started.json<{ id: string }>().id;
  const deadline = Date.now() + 30_000;
  for (;;) {
    const read = await owner.request("GET", `/api/v1/runs/${runId}`);
    const run = RunShape.parse(read.json());
    if (run.settled) return { runId, run };
    if (Date.now() > deadline) throw new Error(`the run did not settle: ${read.body}`);
    await sleep(100);
  }
}

describe("a TOPIC run on GDELT alone, through the API (RELEASE-BLOCKING, Track M Day 2)", () => {
  let runId: string;
  let evidenceId: string;
  let caseId: string;

  beforeAll(async () => {
    await setEntitlement(tenantId, { plan: "TECHINT_AND_PERSON", vettingStatus: "APPROVED" });
    const settled = await settledTopicRun("climate change");
    runId = settled.runId;
    // GDELT alone was planned for the topic, and found something.
    expect(settled.run.status).toBe("SUCCEEDED");
    expect(settled.run.jobs).toHaveLength(1);
    const [job] = settled.run.jobs;
    expect([job?.collectorId, job?.outcome, job?.evidenceIds.length]).toEqual(["news", "FOUND", 1]);
    evidenceId = job?.evidenceIds[0] ?? "";
    const created = await owner.request("POST", "/api/v1/cases", {
      title: "[A case on a topic]",
      description: null,
    });
    expect(created.status).toBe(201);
    caseId = created.json<{ id: string }>().id;
    const pinned = await owner.request("POST", `/api/v1/cases/${caseId}/pins`, {
      target: { type: "evidence", id: evidenceId },
      note: null,
    });
    expect(pinned.status, pinned.body).toBe(201);
  }, 60_000);

  it("labels its evidence from the registry, with GDELT's required citation and link", async () => {
    const read = await owner.request("GET", `/api/v1/evidence/${evidenceId}`);
    expect(read.status).toBe(200);
    const evidence = EvidenceShape.parse(read.json());
    // The label, attribution, link and strength come from the registry, never
    // from an article (CLAUDE.md source labelling).
    expect(evidence).toMatchObject({
      collectorId: "news",
      sourceLabel: "GDELT news coverage",
      attribution: { text: "Source: The GDELT Project", url: "https://www.gdeltproject.org/" },
      strength: "REPORTED",
      runId,
    });
    // The articles are now drawn into the graph (their URLs and outlets, with
    // their fields), so claims cite this one GDELT response.
    expect(evidence.claimCount).toBeGreaterThan(0);
    const run = RunShape.parse((await owner.request("GET", `/api/v1/runs/${runId}`)).json());
    expect(run.jobs[0]?.sourceLabel).toBe("GDELT news coverage");
  });

  it("an estimate for a topic plans GDELT with the plan and the vetting, and names it as refused without them (Day 1's open item)", async () => {
    interface EstimateBody {
      collectors: { collectorId: string; sourceLabel: string; targetType: string }[];
      excluded: { collectorId: string; targetType: string | null; reason: string }[];
    }
    const estimate = async () => {
      const response = await owner.request("POST", "/api/v1/estimates", {
        target: "climate change",
        targetType: "TOPIC",
      });
      expect(response.status, response.body).toBe(200);
      return response.json<EstimateBody>();
    };
    expect((await estimate()).collectors).toEqual([
      expect.objectContaining({
        collectorId: "news",
        sourceLabel: "GDELT news coverage",
        targetType: "TOPIC",
      }),
    ]);
    try {
      for (const [entitlement, code] of [
        [{ plan: "TECHINT", vettingStatus: "APPROVED" }, "MODULE_NOT_IN_PLAN"],
        [{ plan: "TECHINT_AND_PERSON", vettingStatus: "PENDING" }, "VETTING_NOT_APPROVED"],
      ] as const) {
        await setEntitlement(tenantId, entitlement);
        const refused = await estimate();
        expect(refused.collectors, code).toEqual([]);
        expect(refused.excluded, code).toEqual([
          expect.objectContaining({ collectorId: "news", targetType: "TOPIC", reason: code }),
        ]);
      }
    } finally {
      await setEntitlement(tenantId, { plan: "TECHINT_AND_PERSON", vettingStatus: "APPROVED" });
    }
  });

  const reads = () => [
    `/api/v1/runs/${runId}`,
    `/api/v1/evidence/${evidenceId}`,
    `/api/v1/entities?runId=${runId}`,
    `/api/v1/timeline?runId=${runId}`,
    `/api/v1/cases/${caseId}/pins`,
  ];

  it("is person data: refused whole on every read without the plan or the vetting, and read in full with both", async () => {
    try {
      for (const [entitlement, code] of [
        [{ plan: "TECHINT", vettingStatus: "APPROVED" }, "MODULE_NOT_IN_PLAN"],
        [{ plan: "TECHINT_AND_PERSON", vettingStatus: "SUSPENDED" }, "VETTING_NOT_APPROVED"],
      ] as const) {
        await setEntitlement(tenantId, entitlement);
        for (const path of reads()) {
          const response = await owner.request("GET", path);
          expect(response.status, `${code} ${path}`).toBe(403);
          const body = response.json<LockedBody>();
          expect(body, path).toMatchObject({ code, locked: { reason: code } });
          // Refused whole: nothing of the run, its evidence or GDELT's articles is in the refusal.
          expect(response.body, path).not.toContain(evidenceId);
          expect(response.body, path).not.toContain("gdeltproject");
        }
      }
    } finally {
      await setEntitlement(tenantId, { plan: "TECHINT_AND_PERSON", vettingStatus: "APPROVED" });
    }
    for (const path of reads()) {
      expect((await owner.request("GET", path)).status, path).toBe(200);
    }
  });
});

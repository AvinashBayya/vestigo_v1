/**
 * RELEASE-BLOCKING. Reports through the public API, with real worker pools
 * behind it (collection, fusion and report generation): the API only
 * enqueues; a report from a PARTIAL run says so and names the failure; every
 * export format downloads; permissions, the person-data gate, the handling
 * marking and tenant isolation hold at the HTTP boundary.
 *
 * No model provider is configured here (synthesisUnavailable), as in this
 * repository's development environment: a synthesis request is refused with
 * the reason, and reports are generated without one.
 */
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { PLATFORM_COLLECTORS } from "@repo/collectors";
import { loadFixture, startHarness, type Fixture, type Harness } from "@repo/collectors/testing";
import type { ReportDocument, TenantId } from "@repo/core";
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
  ReportGenerator,
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
  Browser,
  createTestApi,
  joinAs,
  provisionTestTenant,
  readyBrowser,
  setEntitlement,
  type TestApi,
} from "./support.ts";

let api: TestApi;
let harness: Harness;
let redis: ReturnType<typeof createRedisClient>;
let contentDir: string;
let pool: WorkerPool;
let owner: Browser;
let tenantId: TenantId;

function waybackUnavailableFor(domain: string): Fixture {
  const fixture = loadFixture("wayback", "unavailable-503");
  return {
    ...fixture,
    provenance: {
      ...fixture.provenance,
      notes: `${fixture.provenance.notes} Re-pointed at ${domain} by the API report tests, as the deliberately failing collector.`,
    },
    request: {
      ...fixture.request,
      path: fixture.request.path.replace("unavailable.example", domain),
    },
  };
}

const NO_PROVIDER = "No hosted LLM provider is configured (LLM_HOSTED_BASE_URL is not set).";

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
  api = await createTestApi({
    registry: harness.runtime.registry,
    synthesisUnavailable: NO_PROVIDER,
  });
  redis = createRedisClient({
    url: TEST_API.redisUrl,
    commandTimeoutMs: 2_000,
    connectTimeoutMs: 2_000,
  });
  await waitForRedisReady(redis, { timeoutMs: 5_000 });
  contentDir = await mkdtemp(join(tmpdir(), "api-reports-"));
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
    collectConcurrency: () => 2,
    investigationConcurrency: 2,
    fusionConcurrency: 2,
    reports: {
      generator: new ReportGenerator({
        db: api.db,
        registry: runtime.registry,
        llm: { unavailable: NO_PROVIDER },
        defaultHandlingMarking: null,
        producedBy: "[product]",
        retry: api.retry,
      }),
      concurrency: 1,
    },
  });
  const provisioned = await provisionTestTenant(api, "reports");
  tenantId = provisioned.tenantId;
  owner = await readyBrowser(api, provisioned.owner, tenantId);
}, 60_000);

afterAll(async () => {
  await pool.close();
  await api.close();
  await harness.close();
  await redis.quit();
  await rm(contentDir, { recursive: true, force: true });
});

const ReportShape = z.object({
  id: z.uuid(),
  runId: z.uuid(),
  status: z.string(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  document: z.unknown().nullable(),
});

async function settledRun(browser: Browser): Promise<string> {
  const created = await browser.request("POST", "/api/v1/investigations", {
    title: "[Investigation of example.com]",
    target: "example.com",
  });
  const start = await browser.request(
    "POST",
    `/api/v1/investigations/${created.json<{ id: string }>().id}/runs`,
    {},
  );
  const runId = start.json<{ id: string }>().id;
  const deadline = Date.now() + 30_000;
  for (;;) {
    const run = (await browser.request("GET", `/api/v1/runs/${runId}`)).json<{
      settled: boolean;
    }>();
    if (run.settled) return runId;
    if (Date.now() > deadline) throw new Error("run did not settle");
    await sleep(100);
  }
}

async function generatedReport(browser: Browser, reportId: string) {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const read = await browser.request("GET", `/api/v1/reports/${reportId}`);
    expect(read.status).toBe(200);
    const report = ReportShape.parse(read.json());
    if (report.status === "SUCCEEDED" || report.status === "FAILED") return report;
    if (Date.now() > deadline) throw new Error(`report not finished: ${read.body}`);
    await sleep(100);
  }
}

describe("a report through the API, from a PARTIAL run (RELEASE-BLOCKING)", () => {
  let runId: string;
  let reportId: string;
  let document: ReportDocument;

  beforeAll(async () => {
    const marked = await owner.request("PUT", "/api/v1/settings/report-handling-marking", {
      marking: "[TENANT MARKING]",
    });
    expect(marked.status).toBe(200);
    runId = await settledRun(owner);
    const created = await owner.request("POST", `/api/v1/runs/${runId}/reports`, {
      synthesis: false,
    });
    expect(created.status).toBe(202);
    const queued = ReportShape.parse(created.json());
    expect(queued.status).toBe("QUEUED");
    reportId = queued.id;
    const finished = await generatedReport(owner, reportId);
    expect(finished.status, JSON.stringify(finished.error)).toBe("SUCCEEDED");
    document = finished.document as ReportDocument;
  }, 60_000);

  it("says the run was partial and names the failed collector with its cause", () => {
    expect(document.coverage.partial).toBe(true);
    expect(document.coverage.headline).toMatch(/^PARTIAL RUN/);
    expect(document.coverage.entries.find((e) => e.collectorId === "wayback")).toMatchObject({
      state: "FAILED",
      reasonCode: "UPSTREAM_UNAVAILABLE",
    });
    expect(document.synthesis).toEqual({ status: "NOT_REQUESTED" });
    expect(document.handlingMarking).toBe("[TENANT MARKING]");
  });

  it("refuses a synthesis when no model provider is configured, saying why", async () => {
    const refused = await owner.request("POST", `/api/v1/runs/${runId}/reports`, {
      synthesis: true,
    });
    expect(refused.status).toBe(409);
    expect(refused.json()).toMatchObject({ code: "SYNTHESIS_UNAVAILABLE", detail: NO_PROVIDER });
  });

  it.each([
    ["pdf", "application/pdf"],
    ["json", "application/json"],
    ["csv", "text/csv; charset=utf-8"],
    ["maltego", "text/csv; charset=utf-8"],
  ])("exports %s", async (format, contentType) => {
    const exported = await owner.request("GET", `/api/v1/reports/${reportId}/export/${format}`);
    expect(exported.status).toBe(200);
    expect(exported.headers["content-type"]).toBe(contentType);
    expect(String(exported.headers["content-disposition"])).toContain(`report-${reportId}`);
    if (format === "pdf") expect(exported.body.startsWith("%PDF-")).toBe(true);
    if (format === "json") expect(JSON.parse(exported.body)).toEqual(document);
    if (format !== "pdf") expect(exported.body).toContain("[TENANT MARKING]");
  });

  it("lists the run's reports", async () => {
    const listed = await owner.request("GET", `/api/v1/runs/${runId}/reports`);
    expect(listed.status).toBe(200);
    expect(listed.json<{ items: { id: string }[] }>().items.map((r) => r.id)).toContain(reportId);
  });

  it("refuses to export a report that is not generated yet", async () => {
    const pending = await api.db.withTenant(tenantId, ({ repos }) =>
      repos.reports.create({ runId, includeSynthesis: false, requestedByUserId: null }),
    );
    const exported = await owner.request("GET", `/api/v1/reports/${pending.id}/export/pdf`);
    expect(exported.status).toBe(409);
    expect(exported.json()).toMatchObject({ code: "REPORT_NOT_READY" });
  });

  it("refuses a report from a run that has not settled", async () => {
    const running = await api.db.withTenant(tenantId, async ({ repos }) => {
      const investigation = await repos.investigations.create({
        title: "[running]",
        target: "example.com",
        createdByUserId: null,
      });
      return repos.runs.create({
        investigationId: investigation.id,
        status: "RUNNING",
        requestedByUserId: null,
        requestedTargetType: null,
      });
    });
    const refused = await owner.request("POST", `/api/v1/runs/${running.id}/reports`, {
      synthesis: false,
    });
    expect(refused.status).toBe(409);
    expect(refused.json()).toMatchObject({ code: "RUN_NOT_SETTLED" });
  });

  it("lets a viewer read and export, but not request a report or set the marking", async () => {
    const viewer = await joinAs(api, owner, tenantId, "viewer", "report-viewer");
    expect((await viewer.request("GET", `/api/v1/reports/${reportId}`)).status).toBe(200);
    expect((await viewer.request("GET", `/api/v1/reports/${reportId}/export/csv`)).status).toBe(
      200,
    );
    expect(
      (await viewer.request("POST", `/api/v1/runs/${runId}/reports`, { synthesis: false })).status,
    ).toBe(403);
    expect(
      (await viewer.request("PUT", "/api/v1/settings/report-handling-marking", { marking: "[x]" }))
        .status,
    ).toBe(403);
  });

  it("never shows one tenant's report to another", async () => {
    const other = await provisionTestTenant(api, "reports-other");
    const stranger = await readyBrowser(api, other.owner, other.tenantId);
    expect((await stranger.request("GET", `/api/v1/reports/${reportId}`)).status).toBe(404);
    expect((await stranger.request("GET", `/api/v1/reports/${reportId}/export/pdf`)).status).toBe(
      404,
    );
  });

  it("rejects a marking with control characters or over 80 characters", async () => {
    for (const marking of ["[line]\n[break]", "x".repeat(81), ""]) {
      const refused = await owner.request("PUT", "/api/v1/settings/report-handling-marking", {
        marking,
      });
      expect(refused.status, JSON.stringify(marking)).toBe(400);
    }
  });
});

describe("a run holding person data is gated like the run itself (RELEASE-BLOCKING)", () => {
  it("refuses its reports to a tenant whose plan or vetting does not cover person data", async () => {
    const provisioned = await provisionTestTenant(api, "reports-person");
    const browser = await readyBrowser(api, provisioned.owner, provisioned.tenantId);
    const report = await api.db.withTenant(provisioned.tenantId, async ({ repos }) => {
      await repos.collectorsRegistry.sync({
        collectorId: "contact.phone",
        sourceLabel: "[phone analysis]",
        discipline: "PERSON",
        collectionMode: "LOCAL_ANALYSIS",
        dataLicence: "[licence]",
        commercialUse: "PERMITTED",
        enabled: true,
        disabledReason: null,
      });
      const investigation = await repos.investigations.create({
        title: "[person]",
        target: "[phone]",
        createdByUserId: null,
      });
      const run = await repos.runs.create({
        investigationId: investigation.id,
        status: "FAILED",
        requestedByUserId: null,
        requestedTargetType: null,
      });
      await repos.jobs.create({
        runId: run.id,
        collectorId: "contact.phone",
        idempotencyKey: `[person]:${run.id}`,
        status: "FAILED",
      });
      return repos.reports.create({
        runId: run.id,
        includeSynthesis: false,
        requestedByUserId: null,
      });
    });
    const refused = await browser.request("GET", `/api/v1/reports/${report.id}`);
    expect(refused.status).toBe(403);
    expect(refused.json()).toMatchObject({ code: "MODULE_NOT_IN_PLAN" });
    await setEntitlement(provisioned.tenantId, {
      plan: "TECHINT_AND_PERSON",
      vettingStatus: "APPROVED",
    });
    expect((await browser.request("GET", `/api/v1/reports/${report.id}`)).status).toBe(200);
  });
});

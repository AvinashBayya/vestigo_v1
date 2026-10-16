/**
 * RELEASE-BLOCKING. Phase 5 end to end: a report generated from a real
 * Phase 4 run (real Postgres, Redis, BullMQ, and the registered collectors
 * answering from recorded fixtures, wayback deliberately failing), through
 * the reports queue and worker, with every claim cited, the coverage section
 * accurate about the failure, and the PDF rendering it.
 *
 * No model is called. The synthesis comes from a SCRIPTED provider that
 * answers like a compliant model; it is a test double, never presented as a
 * model's output. The model-facing guarantees are exercised against it:
 * validation, retry-then-fail, metering, and charging once.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  CollectorRegistry,
  CollectorRuntime,
  defineCollector,
  HELD_PLATFORM_COLLECTORS,
  PLATFORM_COLLECTORS,
  type Collector,
  type SourceDeclaration,
} from "@repo/collectors";
import { loadFixture, startHarness, type Fixture, type Harness } from "@repo/collectors/testing";
import { allowedModel, type LlmEndpoint } from "@repo/config";
import { parseTenantId, REPORT_WORDING, type ReportDocument, type TenantId } from "@repo/core";
import {
  createDatabase,
  FileSystemContentStore,
  hashContent,
  type ContentStore,
  type Database,
} from "@repo/db";
import {
  CredentialVault,
  MasterKey,
  RedisCircuitBreaker,
  createRedisClient,
  renderReportPdf,
  waitForRedisReady,
} from "@repo/integrations";
import {
  LlmRequestRejectedError,
  LlmUnavailableError,
  type CallProvenance,
  type CompletionRequest,
  type CompletionResult,
  type LlmClient,
  type LlmProvider,
} from "@repo/llm";
import type { Redis } from "ioredis";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  CollectionExecutor,
  CollectorJobProcessor,
  InvestigationQueue,
  ReportGenerator,
  ReportNotRenderableError,
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

// ── The world ─────────────────────────────────────────────────────────────

let db: Database;
let redis: Redis;
let contentDir: string;
let vault: CredentialVault;

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
  contentDir = await mkdtemp(join(tmpdir(), "engine-reports-"));
  vault = new CredentialVault(
    new MasterKey({ keyId: "test-1", keyBase64: randomBytes(32).toString("base64") }),
  );
});

afterAll(async () => {
  await redis.quit();
  await db.close();
  await rm(contentDir, { recursive: true, force: true });
});

const FAST_RETRY: RetryPolicy = { maxAttempts: 3, baseDelayMs: 20, maxDelayMs: 100 };

function model(id: string) {
  const found = allowedModel(id);
  if (found === null) throw new Error(`not allowlisted: ${id}`);
  return found;
}

const ENDPOINT: LlmEndpoint = {
  profile: "hosted",
  baseUrl: "https://llm-provider.invalid/v1",
  apiKey: "[platform key]",
  structuredOutput: "none",
  timeoutMs: 5_000,
  small: { model: model("Qwen/Qwen3-8B"), servedName: "Qwen/Qwen3-8B" },
  large: { model: model("Qwen/Qwen3-32B"), servedName: "Qwen/Qwen3-32B" },
};

/** The host of ENDPOINT's base URL. */
const ENDPOINT_HOST = "llm-provider.invalid";
/** A region header as an endpoint might send it; recorded raw. */
const REGION_HEADER = { name: "x-example-region", value: "[region]" };

/** A call's provenance via ENDPOINT: the provider it names, and its raw region headers. */
const via = (
  servedBy: string | null,
  regionHeaders: readonly { name: string; value: string }[] = [],
): CallProvenance => ({ endpointHost: ENDPOINT_HOST, servedBy, regionHeaders });

/** A scripted stand-in for a model. Not a model; it answers from a script. */
class ScriptedProvider implements LlmProvider {
  readonly profile = "hosted";
  readonly requests: CompletionRequest[] = [];
  readonly #script: ((request: CompletionRequest) => string | Error)[];
  readonly #provenance: CallProvenance[];

  /** `provenance`: what each answer reports, in turn; `via(null)` once exhausted. */
  constructor(
    script: readonly ((request: CompletionRequest) => string | Error)[],
    provenance: readonly CallProvenance[] = [],
  ) {
    this.#script = [...script];
    this.#provenance = [...provenance];
  }

  complete(request: CompletionRequest): Promise<CompletionResult> {
    this.requests.push(request);
    const next = this.#script.shift();
    if (next === undefined) return Promise.reject(new Error("the script has no more answers"));
    const answer = next(request);
    if (answer instanceof Error) return Promise.reject(answer);
    return Promise.resolve({
      text: answer,
      usage: { inputTokens: 1200, outputTokens: 80 },
      provenance: this.#provenance.shift() ?? via(null),
    });
  }
}

const client = (provider: ScriptedProvider): LlmClient => ({
  endpoint: ENDPOINT,
  provider,
  cache: null,
  cacheTtlSeconds: 60,
});

/** The refs and sources the request's data block offers, read back from the prompt. */
function offered(request: CompletionRequest): { ref: string; source: string }[] {
  const user = request.messages.find((message) => message.role === "user")?.content ?? "";
  const json = user.split("\n").find((line) => line.startsWith("[{"));
  if (json === undefined) throw new Error("no data block in the request");
  return z.array(z.object({ ref: z.string(), source: z.string() })).parse(JSON.parse(json));
}

/** What a compliant model would answer: cited statements with permitted strengths. */
function compliantAnswer(request: CompletionRequest): string {
  const records = offered(request);
  const [first, ...rest] = records;
  if (first === undefined) throw new Error("no records offered");
  const other = rest.find((record) => record.source !== first.source);
  const statements = [
    {
      text: "The cited records describe the target's certificates, name resolution and registration, each as its source reported it.",
      strength: other === undefined ? "INFERRED" : "CORRELATED",
      refs: other === undefined ? [first.ref] : [first.ref, other.ref],
    },
    {
      text: "The records do not establish who operates the target; that would need sources this run did not consult.",
      strength: "HYPOTHESIS",
      refs: [first.ref],
    },
  ];
  return JSON.stringify({ statements });
}

const uncited = () =>
  JSON.stringify({ statements: [{ text: "[finding]", strength: "INFERRED", refs: [] }] });

// ── The engine, with a reports pool ───────────────────────────────────────

interface Engine {
  readonly connection: QueueConnection;
  readonly investigations: InvestigationQueue;
  readonly reports: ReportQueue;
  readonly pools: readonly WorkerPool[];
  close(): Promise<void>;
}

async function startEngine(
  runtime: CollectorRuntime,
  generator: (registry: CollectorRegistry) => ReportGenerator,
  extractors?: Readonly<Record<string, Extractor>>,
): Promise<Engine> {
  const namespace = `vr-${randomUUID().slice(0, 8)}`;
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
  const pool = await startWorkerPool({
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
      ...(extractors === undefined ? {} : { extractors }),
    }),
    retry: FAST_RETRY,
    collectConcurrency: () => 1,
    investigationConcurrency: 2,
    fusionConcurrency: 2,
    reports: { generator: generator(runtime.registry), concurrency: 1 },
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
    connection,
    investigations,
    reports,
    pools: [pool],
    async close() {
      await pool.close();
      await investigations.close();
      await reports.close();
    },
  };
}

async function newTenant(tag: string): Promise<{ tenantId: TenantId; userId: string }> {
  const tenantId = parseTenantId(randomUUID());
  await db.provisionTenant({ tenantId, name: `[Tenant ${tag}]`, region: "IN" });
  const user = await db.withTenant(tenantId, ({ repos }) =>
    repos.users.create({
      email: `analyst-${tag}@example.com`,
      displayName: null,
      status: "ACTIVE",
    }),
  );
  return { tenantId, userId: user.id };
}

async function waitFor<T>(
  what: string,
  read: () => Promise<T>,
  done: (value: T) => boolean,
  timeoutMs = 30_000,
) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline)
      throw new Error(`timed out waiting for ${what}: ${JSON.stringify(value)}`);
    await sleep(50);
  }
}

async function runToSettled(engine: Engine, tenantId: TenantId, userId: string, target: string) {
  const run = await db.withTenant(tenantId, async ({ repos }) => {
    const investigation = await repos.investigations.create({
      title: `[Investigation of ${target}]`,
      target,
      createdByUserId: userId,
    });
    return repos.runs.create({
      investigationId: investigation.id,
      status: "QUEUED",
      requestedByUserId: userId,
      requestedTargetType: null,
    });
  });
  await engine.investigations.enqueueRun(tenantId, run.id);
  await waitFor(
    "the run to settle",
    () =>
      db.withTenant(tenantId, async ({ repos }) => ({
        run: await repos.runs.findById(run.id),
        jobs: await repos.jobs.listForRun(run.id, { limit: 100 }),
      })),
    ({ run: row, jobs }) =>
      row !== null &&
      ["SUCCEEDED", "PARTIAL", "FAILED"].includes(row.status) &&
      jobs.every((job) => job.outcome !== "FOUND" || job.fusedAt !== null),
  );
  return run.id;
}

async function requestReport(
  engine: Engine,
  tenantId: TenantId,
  runId: string,
  synthesis: boolean,
) {
  const report = await db.withTenant(tenantId, ({ repos }) =>
    repos.reports.create({ runId, includeSynthesis: synthesis, requestedByUserId: null }),
  );
  await engine.reports.enqueueReport(tenantId, report.id);
  return waitFor(
    "the report to finish",
    () => db.withTenant(tenantId, ({ repos }) => repos.reports.findById(report.id)),
    (row) => row !== null && (row.status === "SUCCEEDED" || row.status === "FAILED"),
  );
}

async function tokenUsage(tenantId: TenantId, reportId: string) {
  const rows = await db.withTenant(tenantId, ({ repos }) =>
    repos.usageEvents.list({ limit: 1000 }),
  );
  return rows
    .filter((row) => row.reportId === reportId)
    .map((row) => ({
      unit: row.unit,
      attempt: row.attempt,
      quantity: row.quantity,
      modelCalls: row.modelCalls,
    }))
    .sort((a, b) => `${String(a.attempt)}${a.unit}`.localeCompare(`${String(b.attempt)}${b.unit}`));
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocument({ data: bytes.slice(), disableFontFace: true }).promise;
  const parts: string[] = [];
  for (let n = 1; n <= pdf.numPages; n += 1) {
    const content = await (await pdf.getPage(n)).getTextContent();
    for (const item of content.items) if ("str" in item) parts.push(item.str);
  }
  return parts.join(" ");
}

// ── Fixtures: the Phase 4 checkpoint run ──────────────────────────────────

const platform = (ids: readonly string[]): Collector[] =>
  PLATFORM_COLLECTORS.filter((collector) => ids.includes(collector.declaration.id));

function waybackUnavailableFor(domain: string): Fixture {
  const fixture = loadFixture("wayback", "unavailable-503");
  return {
    ...fixture,
    provenance: {
      ...fixture.provenance,
      notes: `${fixture.provenance.notes} Re-pointed at ${domain} by the Phase 5 report test, as its deliberately failing collector.`,
    },
    request: {
      ...fixture.request,
      path: fixture.request.path.replace("unavailable.example", domain),
    },
  };
}

const CHECKPOINT_FIXTURES: readonly Fixture[] = [
  loadFixture("crtsh", "found-example-com"),
  loadFixture("dns", "found-example-com"),
  loadFixture("rdap", "rdap-org-example-com-redirect"),
  loadFixture("rdap", "verisign-example-com"),
  waybackUnavailableFor("example.com"),
];

// ── CHECKPOINT ────────────────────────────────────────────────────────────

describe("a report from a real Phase 4 run with one collector failing (RELEASE-BLOCKING)", () => {
  let harness: Harness;
  let engine: Engine;
  let provider: ScriptedProvider;
  let tenant: { tenantId: TenantId; userId: string };
  let runId: string;
  let document: ReportDocument;
  let reportId: string;

  beforeAll(async () => {
    harness = await startHarness({
      collectors: platform(["crtsh", "dns", "rdap", "wayback"]),
      fixtures: CHECKPOINT_FIXTURES,
    });
    provider = new ScriptedProvider([compliantAnswer], [via("[provider a]", [REGION_HEADER])]);
    engine = await startEngine(
      harness.runtime,
      (registry) =>
        new ReportGenerator({
          db,
          registry,
          llm: client(provider),
          defaultHandlingMarking: null,
          producedBy: "[product]",
          retry: FAST_RETRY,
        }),
    );
    tenant = await newTenant("report-checkpoint");
    await db.withTenant(tenant.tenantId, ({ repos }) =>
      repos.tenants.setReportHandlingMarking("[TENANT HANDLING MARKING]"),
    );
    runId = await runToSettled(engine, tenant.tenantId, tenant.userId, "example.com");
    const report = await requestReport(engine, tenant.tenantId, runId, true);
    if (report?.status !== "SUCCEEDED") {
      throw new Error(
        `report did not succeed: ${String(report?.errorCode)} ${String(report?.errorMessage)}`,
      );
    }
    reportId = report.id;
    document = report.document as ReportDocument;
  }, 90_000);

  afterAll(async () => {
    await engine.close();
    await harness.close();
  });

  it("cites every claim, relationship and synthesis statement to evidence from this run", async () => {
    const numbers = new Set(document.sources.map((source) => source.number));
    const claims = document.findings.flatMap((finding) => finding.claims);
    expect(claims.length).toBeGreaterThan(0);
    for (const claim of claims) {
      expect(claim.citations.length).toBeGreaterThan(0);
      for (const n of claim.citations) expect(numbers.has(n)).toBe(true);
    }
    for (const relationship of document.relationships) {
      expect(relationship.citations.every((n) => numbers.has(n))).toBe(true);
    }
    if (document.synthesis.status !== "GENERATED") return expect.unreachable("synthesis expected");
    for (const statement of document.synthesis.statements) {
      expect(statement.citations.length).toBeGreaterThan(0);
      expect(statement.citations.every((n) => numbers.has(n))).toBe(true);
    }
    const runEvidence = await db.withTenant(tenant.tenantId, async ({ repos }) =>
      (await repos.jobs.listForRun(runId, { limit: 100 })).flatMap((job) => job.evidenceIds ?? []),
    );
    expect(document.sources.map((s) => s.evidenceId).sort()).toEqual([...runEvidence].sort());
  });

  it("states the run was partial, and names the failed collector with its recorded cause", () => {
    expect(document.coverage.partial).toBe(true);
    expect(document.coverage.headline).toMatch(
      /^PARTIAL RUN: 1 of 4 planned collectors did not complete/,
    );
    const wayback = document.coverage.entries.find((entry) => entry.collectorId === "wayback");
    expect(wayback).toMatchObject({
      state: "FAILED",
      sourceLabel: "Wayback Machine captures",
      reasonCode: "UPSTREAM_UNAVAILABLE",
      detail: "The upstream is unavailable: the Wayback CDX API answered HTTP 503.",
      evidenceCount: 0,
      attempts: 3,
    });
    for (const id of ["crtsh", "dns", "rdap"]) {
      expect(document.coverage.entries.find((entry) => entry.collectorId === id)?.state).toBe(
        "COLLECTED",
      );
    }
  });

  it("names no collector as held: news, held until Track M Day 2, is registered now", () => {
    // The HELD state itself is held to its golden files (coverage-golden.test.ts).
    expect(HELD_PLATFORM_COLLECTORS).toEqual([]);
    expect(document.coverage.entries.filter((entry) => entry.state === "HELD")).toEqual([]);
  });

  it("labels claims from source values with the evidence's strength, and computed values DERIVED", () => {
    const strengths = new Set(document.findings.flatMap((f) => f.claims.map((c) => c.strength)));
    expect(strengths).toEqual(new Set(["REPORTED", "DERIVED"]));
    const responding = document.findings
      .flatMap((f) => f.claims)
      .find((claim) => claim.attribute === "rdap_responding_host");
    expect(responding?.strength).toBe("DERIVED");
  });

  it("writes the synthesis from the report's own records, delimited, and meters it once", async () => {
    if (document.synthesis.status !== "GENERATED") return expect.unreachable("synthesis expected");
    // Where the synthesis was produced: the configured host, the provider the
    // endpoint named, and its region header exactly as sent.
    expect(document.synthesis.model).toEqual({
      id: "Qwen/Qwen3-32B",
      licence: "Apache-2.0",
      profile: "hosted",
      endpointHost: ENDPOINT_HOST,
      servedBy: "[provider a]",
      regionHeaders: [REGION_HEADER],
    });
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]?.messages[0]?.content).not.toContain("example.com");
    const call = (quantity: number) => ({
      modelId: "Qwen/Qwen3-32B",
      endpointHost: ENDPOINT_HOST,
      servedBy: "[provider a]",
      regionHeaders: [REGION_HEADER],
      quantity,
    });
    expect(await tokenUsage(tenant.tenantId, reportId)).toEqual([
      { unit: "LLM_INPUT_TOKEN", attempt: 1, quantity: 1200, modelCalls: [call(1200)] },
      { unit: "LLM_OUTPUT_TOKEN", attempt: 1, quantity: 80, modelCalls: [call(80)] },
    ]);
  });

  it("does nothing, and charges nothing, when a finished report is delivered again", async () => {
    const generator = new ReportGenerator({
      db,
      registry: harness.runtime.registry,
      llm: client(new ScriptedProvider([])),
      defaultHandlingMarking: null,
      producedBy: "[product]",
      retry: FAST_RETRY,
    });
    const disposition = await generator.process(tenant.tenantId, reportId, { finalAttempt: false });
    expect(disposition).toEqual({ kind: "SKIPPED", status: "SUCCEEDED" });
    expect(await tokenUsage(tenant.tenantId, reportId)).toHaveLength(2);
  });

  it("stores the glossary it was generated with, OBSERVED included, the analysis model named", () => {
    expect(document.wording.glossary).toEqual([
      {
        strength: "OBSERVED",
        definition: "Seen directly by the platform, not taken from anyone's statement.",
      },
      {
        strength: "REPORTED",
        definition:
          "Stated by the cited source. The platform recorded the statement; it did not verify the fact.",
      },
      {
        strength: "DERIVED",
        definition:
          "Computed by the platform from recorded values (a count, a parsed date, a split list). No source stated it.",
      },
      {
        strength: "CORRELATED",
        definition:
          "A link drawn by the analysis model between two or more independent cited sources.",
      },
      {
        strength: "INFERRED",
        definition:
          "An analytic inference drawn by the analysis model from the cited evidence. No source stated it.",
      },
      {
        strength: "HYPOTHESIS",
        definition: "A possibility the cited evidence permits but does not establish.",
      },
    ]);
    expect(document.producedBy).toBe("[product]");
  });

  // An evidence artefact: downloading a report later must produce the same document.
  it("renders an already-generated report identically after the glossary text in code changes", async () => {
    const stored = async () => {
      const row = await db.withTenant(tenant.tenantId, ({ repos }) =>
        repos.reports.findById(reportId),
      );
      return row?.document as ReportDocument;
    };
    const before = await renderReportPdf(await stored());
    const original = structuredClone(REPORT_WORDING);
    const inCode = REPORT_WORDING as unknown as {
      glossary: { strength: string; definition: string }[];
    };
    try {
      // What a later edit to CLAIM_STRENGTH_DEFINITIONS would do to the wording in code.
      for (const entry of inCode.glossary) entry.definition = `[changed in code] ${entry.strength}`;

      const after = await renderReportPdf(await stored());
      expect(Buffer.from(after).equals(Buffer.from(before))).toBe(true);
      expect(await pdfText(after)).not.toContain("[changed in code]");

      // The snapshot is taken at generation: a report generated now carries the new text.
      const fresh = await requestReport(engine, tenant.tenantId, runId, false);
      const freshDocument = fresh?.document as ReportDocument;
      expect(freshDocument.wording.glossary.map((g) => g.definition)).toContain(
        "[changed in code] CORRELATED",
      );
      expect(await pdfText(await renderReportPdf(freshDocument))).toContain(
        "[changed in code] CORRELATED",
      );
    } finally {
      Object.assign(REPORT_WORDING, original);
    }
  }, 120_000);

  it("carries the tenant's handling marking", () => {
    expect(document.handlingMarking).toBe("[TENANT HANDLING MARKING]");
  });

  it("renders its PDF once in the worker and stores it: every download is that file", async () => {
    const pdf = await waitFor(
      "the report's PDF to render",
      () =>
        db.withTenant(tenant.tenantId, ({ repos }) => repos.reportPdfs.findByReportId(reportId)),
      (row) => row?.status === "READY" || row?.status === "FAILED",
    );
    expect(pdf).toMatchObject({ status: "READY", attempts: 1, errorCode: null });
    if (pdf === null || pdf.contentHash === null) return expect.unreachable("a stored PDF");
    const stored = await new FileSystemContentStore(contentDir).get(
      tenant.tenantId,
      pdf.contentHash,
    );
    // The stored file is the document rendered, byte for byte, with the hash and size recorded.
    expect(Buffer.from(stored).equals(Buffer.from(await renderReportPdf(document)))).toBe(true);
    expect(hashContent(stored)).toBe(pdf.contentHash);
    expect(pdf.byteLength).toBe(stored.byteLength);
  }, 60_000);

  it("renders the PDF with the limitations, the failure and every citation", async () => {
    const bytes = await renderReportPdf(document);
    const text = await pdfText(bytes);
    expect(text).toContain("PARTIAL RUN");
    expect(text).toContain("Wayback Machine captures:");
    expect(text).toContain("UPSTREAM_UNAVAILABLE");
    expect(text).toContain("HANDLING: [TENANT HANDLING MARKING]");
    expect(text).toContain("[REPORTED]");
    for (const source of document.sources)
      expect(text.replace(/\s+/g, "")).toContain(source.evidenceId);

    const out = process.env.REPORT_CHECKPOINT_DIR;
    if (out !== undefined) {
      await writeFile(join(out, "checkpoint-report.pdf"), bytes);
      await writeFile(join(out, "checkpoint-report.json"), JSON.stringify(document, null, 2));
      const lines = [
        `REPORT ${document.reportId} run ${document.runId} status ${document.run.status}`,
        `HEADLINE ${document.coverage.headline}`,
        ...document.coverage.entries.map(
          (e) =>
            `  ${e.state.padEnd(14)} ${e.collectorId.padEnd(8)} ${e.sourceLabel}${e.reasonCode === null ? "" : ` | ${e.reasonCode}`}${e.detail === null ? "" : ` | ${e.detail}`}${e.attempts === null ? "" : ` | attempts ${String(e.attempts)}`}`,
        ),
        `CLAIMS ${String(document.findings.flatMap((f) => f.claims).length)} (all cited), RELATIONSHIPS ${String(document.relationships.length)}, SOURCES ${String(document.sources.length)}, OMITTED ${String(document.omittedClaims)}`,
        `SYNTHESIS ${document.synthesis.status}${document.synthesis.status === "GENERATED" ? ` ${String(document.synthesis.statements.length)} statements, attempts ${String(document.synthesis.attempts)} (scripted provider)` : ""}`,
        `PDF ${String(bytes.length)} bytes`,
      ];
      process.stdout.write(`${lines.join("\n")}\n`);
    }
  });
});

// ── Generation failures, each with its cause ──────────────────────────────

describe("report generation fails honestly, never with a partial answer", () => {
  let harness: Harness;
  let engine: Engine;
  let tenant: { tenantId: TenantId; userId: string };
  let runId: string;

  beforeAll(async () => {
    harness = await startHarness({
      collectors: platform(["crtsh", "dns", "rdap", "wayback"]),
      fixtures: CHECKPOINT_FIXTURES,
    });
    engine = await startEngine(
      harness.runtime,
      (registry) =>
        new ReportGenerator({
          db,
          registry,
          llm: { unavailable: "[not configured]" },
          defaultHandlingMarking: null,
          producedBy: "[product]",
          retry: FAST_RETRY,
        }),
    );
    tenant = await newTenant("report-failures");
    runId = await runToSettled(engine, tenant.tenantId, tenant.userId, "example.com");
  }, 90_000);

  afterAll(async () => {
    await engine.close();
    await harness.close();
  });

  const generatorWith = (provider: ScriptedProvider) =>
    new ReportGenerator({
      db,
      registry: harness.runtime.registry,
      llm: client(provider),
      defaultHandlingMarking: "[PLATFORM MARKING]",
      producedBy: "[product]",
      retry: FAST_RETRY,
    });

  const newReport = (synthesis: boolean) =>
    db.withTenant(tenant.tenantId, ({ repos }) =>
      repos.reports.create({ runId, includeSynthesis: synthesis, requestedByUserId: null }),
    );

  it("fails the report when the model's answer is uncited twice, keeping no document, and meters both calls", async () => {
    const report = await newReport(true);
    const provider = new ScriptedProvider([uncited, uncited], [via("[provider a]"), via(null)]);
    const disposition = await generatorWith(provider).process(tenant.tenantId, report.id, {
      finalAttempt: false,
    });
    expect(disposition).toEqual({
      kind: "COMPLETED",
      status: "FAILED",
      errorCode: "LLM_OUTPUT_REJECTED",
    });
    const row = await db.withTenant(tenant.tenantId, ({ repos }) =>
      repos.reports.findById(report.id),
    );
    expect(row).toMatchObject({
      status: "FAILED",
      document: null,
      errorCode: "LLM_OUTPUT_REJECTED",
    });
    expect(row?.errorMessage).toContain("CITATION_MISSING");
    // Both calls, the rejected ones, reached a provider: each is recorded with
    // the provider it reported, or null where it reported none.
    const calls = (quantity: number) => [
      { modelId: "Qwen/Qwen3-32B", ...via("[provider a]"), quantity },
      { modelId: "Qwen/Qwen3-32B", ...via(null), quantity },
    ];
    expect(await tokenUsage(tenant.tenantId, report.id)).toEqual([
      { unit: "LLM_INPUT_TOKEN", attempt: 1, quantity: 2400, modelCalls: calls(1200) },
      { unit: "LLM_OUTPUT_TOKEN", attempt: 1, quantity: 160, modelCalls: calls(80) },
    ]);
  });

  it("retries an unavailable model with backoff, then succeeds without charging twice", async () => {
    const report = await newReport(true);
    const generator = generatorWith(
      new ScriptedProvider([
        () => new LlmUnavailableError("[503]", { status: 503, retryAfterMs: 50 }),
        compliantAnswer,
      ]),
    );
    const first = await generator.process(tenant.tenantId, report.id, { finalAttempt: false });
    expect(first.kind).toBe("RETRY");
    if (first.kind === "RETRY") expect(first.delayMs).toBeGreaterThanOrEqual(50);
    const waiting = await db.withTenant(tenant.tenantId, ({ repos }) =>
      repos.reports.findById(report.id),
    );
    expect(waiting).toMatchObject({ status: "QUEUED", errorCode: "LLM_UNAVAILABLE" });
    const second = await generator.process(tenant.tenantId, report.id, { finalAttempt: false });
    expect(second).toEqual({ kind: "COMPLETED", status: "SUCCEEDED", errorCode: null });
    // The unavailable first call reported no usage and no provider: nothing is recorded for it.
    const call = (quantity: number) => [{ modelId: "Qwen/Qwen3-32B", ...via(null), quantity }];
    expect(await tokenUsage(tenant.tenantId, report.id)).toEqual([
      { unit: "LLM_INPUT_TOKEN", attempt: 2, quantity: 1200, modelCalls: call(1200) },
      { unit: "LLM_OUTPUT_TOKEN", attempt: 2, quantity: 80, modelCalls: call(80) },
    ]);
  });

  it("fails an unavailable model on the last attempt, saying why", async () => {
    const report = await newReport(true);
    const generator = generatorWith(
      new ScriptedProvider([() => new LlmUnavailableError("[503]", { status: 503 })]),
    );
    expect(await generator.process(tenant.tenantId, report.id, { finalAttempt: true })).toEqual({
      kind: "COMPLETED",
      status: "FAILED",
      errorCode: "LLM_UNAVAILABLE",
    });
  });

  describe("its PDF, rendered once in the background", () => {
    /** A generated report (no synthesis asked for). */
    const generated = async () => {
      const report = await newReport(false);
      const disposition = await generatorWith(new ScriptedProvider([])).process(
        tenant.tenantId,
        report.id,
        { finalAttempt: false },
      );
      expect(disposition).toMatchObject({ kind: "COMPLETED", status: "SUCCEEDED" });
      return report.id;
    };
    const pdfOf = (reportId: string) =>
      db.withTenant(tenant.tenantId, ({ repos }) => repos.reportPdfs.findByReportId(reportId));
    /** A stand-in for the renderer's output. Not a PDF. */
    const STAND_IN = new TextEncoder().encode("[stand-in rendered bytes]");
    const storeWith = (overrides: Partial<ContentStore> = {}): ContentStore => {
      const real = new FileSystemContentStore(contentDir);
      return {
        put: (id, bytes) => real.put(id, bytes),
        get: (id, hash) => real.get(id, hash),
        has: (id, hash) => real.has(id, hash),
        ...overrides,
      };
    };
    const rendererWith = (options: {
      render?: () => Promise<Uint8Array>;
      contentStore?: ContentStore;
    }) =>
      new ReportRenderer({
        db,
        contentStore: options.contentStore ?? storeWith(),
        retry: FAST_RETRY,
        render: options.render ?? (() => Promise.resolve(STAND_IN)),
      });

    it("is recorded PENDING when the report is generated, in the same transaction", async () => {
      const reportId = await generated();
      expect(await pdfOf(reportId)).toMatchObject({ status: "PENDING", attempts: 0 });
    });

    it("renders and stores once; a delivery after that does nothing", async () => {
      const reportId = await generated();
      let renders = 0;
      const renderer = rendererWith({
        render: () => {
          renders += 1;
          return Promise.resolve(STAND_IN);
        },
      });
      const first = await renderer.process(tenant.tenantId, reportId, { finalAttempt: false });
      expect(first).toEqual({ kind: "COMPLETED", status: "READY", errorCode: null });
      const again = await renderer.process(tenant.tenantId, reportId, { finalAttempt: false });
      expect(again).toEqual({ kind: "SKIPPED", status: "READY" });
      expect(renders).toBe(1);
      const pdf = await pdfOf(reportId);
      expect(pdf).toMatchObject({ status: "READY", attempts: 1, byteLength: STAND_IN.byteLength });
      if (pdf?.contentHash == null) return expect.unreachable("a stored file");
      expect(await storeWith().get(tenant.tenantId, pdf.contentHash)).toEqual(STAND_IN);
    });

    it("fails a render that throws at once, with attempts left, storing nothing", async () => {
      const reportId = await generated();
      let stored = 0;
      const disposition = await rendererWith({
        render: () => Promise.reject(new RangeError("[layout failure]")),
        contentStore: storeWith({
          put: () => {
            stored += 1;
            return Promise.reject(new Error("[must not be called]"));
          },
        }),
      }).process(tenant.tenantId, reportId, { finalAttempt: false });
      expect(disposition).toEqual({
        kind: "COMPLETED",
        status: "FAILED",
        errorCode: "REPORT_RENDER_FAILED",
      });
      expect(stored).toBe(0);
      expect(await pdfOf(reportId)).toMatchObject({
        status: "FAILED",
        errorCode: "REPORT_RENDER_FAILED",
        // The error's class, never the content being rendered.
        errorMessage: "The PDF could not be rendered from the stored report: RangeError.",
        contentHash: null,
      });
    });

    it("retries storage that is unavailable, then fails on the last attempt", async () => {
      const reportId = await generated();
      const renderer = rendererWith({
        contentStore: storeWith({ put: () => Promise.reject(new Error("[disk unavailable]")) }),
      });
      const first = await renderer.process(tenant.tenantId, reportId, { finalAttempt: false });
      expect(first).toMatchObject({ kind: "RETRY", errorCode: "REPORT_PDF_STORAGE_UNAVAILABLE" });
      expect(await pdfOf(reportId)).toMatchObject({ status: "PENDING", attempts: 1 });
      const last = await renderer.process(tenant.tenantId, reportId, { finalAttempt: true });
      expect(last).toEqual({
        kind: "COMPLETED",
        status: "FAILED",
        errorCode: "REPORT_PDF_STORAGE_UNAVAILABLE",
      });
      expect(await pdfOf(reportId)).toMatchObject({ status: "FAILED", attempts: 2 });
    });

    it("refuses to render a report that has no document, and records nothing", async () => {
      const report = await newReport(false);
      await expect(
        rendererWith({}).process(tenant.tenantId, report.id, { finalAttempt: false }),
      ).rejects.toBeInstanceOf(ReportNotRenderableError);
      expect(await pdfOf(report.id)).toBeNull();
    });

    it("fails a render whose last delivery crashed, and leaves a finished one alone", async () => {
      const crashed = await generated();
      await db.withTenant(tenant.tenantId, ({ repos }) =>
        repos.reportPdfs.transition(crashed, {
          status: "RENDERING",
          attempts: 3,
          startedAt: new Date(),
        }),
      );
      const renderer = rendererWith({});
      const failure = { code: "WORKER_ERROR", message: "[crashed]" };
      await renderer.failUnrecorded(tenant.tenantId, crashed, failure);
      expect(await pdfOf(crashed)).toMatchObject({ status: "FAILED", errorCode: "WORKER_ERROR" });

      const finished = await generated();
      await renderer.process(tenant.tenantId, finished, { finalAttempt: false });
      await renderer.failUnrecorded(tenant.tenantId, finished, failure);
      expect(await pdfOf(finished)).toMatchObject({ status: "READY", errorCode: null });
    });
  });

  it("fails a refused request at once, with retries left, keeping what the endpoint said", async () => {
    const report = await newReport(true);
    const said =
      'The hosted model endpoint refused the request with HTTP 402. The endpoint said: "[no credit left]".';
    const generator = generatorWith(
      new ScriptedProvider([
        () => new LlmRequestRejectedError(said, 402, { code: null, message: "[no credit left]" }),
      ]),
    );
    expect(await generator.process(tenant.tenantId, report.id, { finalAttempt: false })).toEqual({
      kind: "COMPLETED",
      status: "FAILED",
      errorCode: "LLM_REQUEST_REJECTED",
    });
    const row = await db.withTenant(tenant.tenantId, ({ repos }) =>
      repos.reports.findById(report.id),
    );
    expect(row).toMatchObject({ status: "FAILED", errorMessage: said });
  });

  it("fails a synthesis request when no provider is configured, through the queue", async () => {
    const report = await requestReport(engine, tenant.tenantId, runId, true);
    expect(report).toMatchObject({
      status: "FAILED",
      errorCode: "LLM_NOT_CONFIGURED",
      errorMessage: "[not configured]",
    });
  });

  it("generates without a synthesis when none is asked for, using the platform marking", async () => {
    const report = await newReport(false);
    await generatorWith(new ScriptedProvider([])).process(tenant.tenantId, report.id, {
      finalAttempt: false,
    });
    const row = await db.withTenant(tenant.tenantId, ({ repos }) =>
      repos.reports.findById(report.id),
    );
    const document = row?.document as ReportDocument;
    expect(document.synthesis).toEqual({ status: "NOT_REQUESTED" });
    expect(document.handlingMarking).toBe("[PLATFORM MARKING]");
    expect(await tokenUsage(tenant.tenantId, report.id)).toEqual([]);
  });

  it("refuses a run that has not settled", async () => {
    const pending = await db.withTenant(tenant.tenantId, async ({ repos }) => {
      const investigation = await repos.investigations.create({
        title: "[pending]",
        target: "example.com",
        createdByUserId: null,
      });
      const run = await repos.runs.create({
        investigationId: investigation.id,
        status: "RUNNING",
        requestedByUserId: null,
        requestedTargetType: null,
      });
      return repos.reports.create({
        runId: run.id,
        includeSynthesis: false,
        requestedByUserId: null,
      });
    });
    expect(
      await generatorWith(new ScriptedProvider([])).process(tenant.tenantId, pending.id, {
        finalAttempt: false,
      }),
    ).toEqual({
      kind: "COMPLETED",
      status: "FAILED",
      errorCode: "RUN_NOT_SETTLED",
    });
  });

  // REGRESSION (legacy cases/case-report.ts): coverage read stored evidence
  // only, so "ran and found nothing" and "failed" looked the same, and the
  // plan was recomputed at report time rather than read from the run.
  it("tells nothing-found from failed, and reads exclusions from the run's own recorded plan", async () => {
    const report = await db.withTenant(tenant.tenantId, async ({ repos }) => {
      const investigation = await repos.investigations.create({
        title: "[outcomes]",
        target: "example.com",
        createdByUserId: null,
      });
      const run = await repos.runs.create({
        investigationId: investigation.id,
        status: "QUEUED",
        requestedByUserId: null,
        requestedTargetType: null,
      });
      await repos.runs.setPlan(run.id, {
        input: "example.com",
        requestedType: null,
        detected: { primaryType: "DOMAIN", alternateTypes: [] },
        targets: [{ type: "DOMAIN", value: "example.com" }],
        jobs: [],
        excluded: [
          {
            collectorId: "[plan-only collector]",
            targetType: "DOMAIN",
            reason: "VETTING_NOT_APPROVED",
            message: "[recorded at planning]",
          },
          {
            collectorId: "github",
            targetType: null,
            reason: "TARGET_TYPE_NOT_ACCEPTED",
            message: "[recorded]",
          },
        ],
      });
      const outcomes = [
        ["crtsh", "SUCCEEDED", "NOT_FOUND", null],
        ["dns", "FAILED", "FAILED", { code: "UPSTREAM_RESPONSE_INVALID", message: "[invalid]" }],
        [
          "rdap",
          "FAILED",
          "NEEDS_CREDENTIALS",
          { code: "CREDENTIALS_MISSING", message: "[no key]" },
        ],
        ["wayback", "FAILED", "REFUSED", { code: "UPSTREAM_REFUSED", message: "[refused]" }],
      ] as const;
      for (const [collectorId, status, outcome, error] of outcomes) {
        const job = await repos.jobs.create({
          runId: run.id,
          collectorId,
          idempotencyKey: `[outcomes]:${run.id}:${collectorId}`,
          status: "QUEUED",
          targetType: "DOMAIN",
          target: "example.com",
        });
        await repos.jobs.transition(job.id, {
          status,
          outcome,
          attempts: 1,
          ...(outcome === "NOT_FOUND" ? { outcomeDetail: "[nothing for this name]" } : {}),
          ...(error === null ? {} : { lastError: error }),
        });
      }
      await repos.runs.transition(run.id, { status: "PARTIAL", finishedAt: new Date() });
      return repos.reports.create({
        runId: run.id,
        includeSynthesis: false,
        requestedByUserId: null,
      });
    });
    await generatorWith(new ScriptedProvider([])).process(tenant.tenantId, report.id, {
      finalAttempt: false,
    });
    const row = await db.withTenant(tenant.tenantId, ({ repos }) =>
      repos.reports.findById(report.id),
    );
    const document = row?.document as ReportDocument;
    const state = (id: string) => document.coverage.entries.find((e) => e.collectorId === id);
    expect(state("crtsh")).toMatchObject({
      state: "NOTHING_FOUND",
      detail: "[nothing for this name]",
    });
    expect(state("dns")).toMatchObject({
      state: "FAILED",
      reasonCode: "UPSTREAM_RESPONSE_INVALID",
    });
    expect(state("rdap")).toMatchObject({
      state: "NEEDS_CREDENTIALS",
      reasonCode: "CREDENTIALS_MISSING",
    });
    expect(state("wayback")).toMatchObject({ state: "REFUSED", reasonCode: "UPSTREAM_REFUSED" });
    expect(state("[plan-only collector]")).toMatchObject({
      state: "EXCLUDED",
      reasonCode: "VETTING_NOT_APPROVED",
      detail: "[recorded at planning]",
    });
    expect(document.coverage.notApplicable.map((n) => n.collectorId)).toEqual(["github"]);
    expect(document.synthesis).toEqual({ status: "NOT_REQUESTED" });
  });
});

// ── Attribution travels with the data ─────────────────────────────────────

const ATTRIBUTED: SourceDeclaration = {
  id: "attributed-local",
  name: "[Attributed source]",
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
  attribution: { text: "[Attribution the source requires]", url: "https://attribution.example/" },
};

const attributedCollector = defineCollector(
  {
    id: "fake.attributed",
    version: "1.0.0",
    displayName: "[fake attributed analysis]",
    discipline: "TECHINT",
    targetTypes: ["DOMAIN"],
    collectionMode: "LOCAL_ANALYSIS",
    source: "attributed-local",
    credentials: { vaultIds: [], runsWithout: true },
    claimStrength: "DERIVED",
    timeoutMs: 5_000,
    resultSchema: z.object({ analysed: z.string() }),
  },
  (ctx) => {
    const result = { analysed: ctx.target.value };
    return Promise.resolve(ctx.found(result, [{ response: ctx.record(result), observedAt: null }]));
  },
);

describe("attribution required by a source is carried into the report (RELEASE-BLOCKING)", () => {
  it("lists the attribution in the document and prints it in the PDF", async () => {
    const runtime = new CollectorRuntime({
      registry: new CollectorRegistry({ sources: [ATTRIBUTED], collectors: [attributedCollector] }),
      network: { rateLimiter: { acquire: () => Promise.resolve({ allowed: true }) } },
    });
    const engine = await startEngine(
      runtime,
      (registry) =>
        new ReportGenerator({
          db,
          registry,
          llm: { unavailable: "[none]" },
          defaultHandlingMarking: null,
          producedBy: "[product]",
          retry: FAST_RETRY,
        }),
      {
        "fake.attributed": () => ({
          entities: [
            { key: "t", kind: "DOMAIN", identifier: "example.com", displayName: "example.com" },
          ],
          relationships: [],
          claims: [
            { subject: { entity: "t" }, attribute: "analysed", path: ["analysed"], evidence: 0 },
          ],
        }),
      },
    );
    try {
      const tenant = await newTenant("attribution");
      const runId = await runToSettled(engine, tenant.tenantId, tenant.userId, "example.com");
      const report = await requestReport(engine, tenant.tenantId, runId, false);
      expect(report?.status).toBe("SUCCEEDED");
      const document = report?.document as ReportDocument;
      expect(document.attributions).toEqual([
        {
          sourceId: "attributed-local",
          text: "[Attribution the source requires]",
          url: "https://attribution.example/",
          collectorIds: ["fake.attributed"],
        },
      ]);
      const text = await pdfText(await renderReportPdf(document));
      expect(text).toContain("[Attribution the source requires]");
      expect(text).toContain("https://attribution.example/");
    } finally {
      await engine.close();
    }
  }, 60_000);
});

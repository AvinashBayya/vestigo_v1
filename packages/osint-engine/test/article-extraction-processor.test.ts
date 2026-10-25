/**
 * ArticleExtractionProcessor against the real database (M4-4B): the queue unit
 * of work that extracts one FOUND article job. It pins the integration
 * guarantees the brief calls for — durable, concurrency-safe idempotency and
 * accurate per-tenant token metering — without Redis (the processor is
 * queue-agnostic; the queue wiring is exercised in extraction-queue.test.ts).
 *
 * Pinned here: a successful extraction writes one DERIVED claim and charges its
 * tokens once; a duplicate delivery and two CONCURRENT deliveries each leave
 * exactly one claim and one usage row per unit (the partial unique index is the
 * guard, not the in-process check); a rejected answer is terminal, writes no
 * claim, leaves the evidence, and still charges the provider's tokens once; no
 * model configured is SKIPPED and charges nothing; an unavailable endpoint is
 * RETRY with attempts left and terminal on the last; a foreign/non-article job
 * is SKIPPED; usage and claims stay within the collecting tenant; and
 * pendingForRun offers only FOUND, fused article jobs.
 */
import { randomUUID } from "node:crypto";
import { parseTenantId, type TenantId } from "@repo/core";
import { contentRef, createDatabase, hashContent, type Database } from "@repo/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ArticleExtractionProcessor, ARTICLE_STATEMENTS_ATTRIBUTE } from "../src/index.ts";
import { TEST_ENGINE } from "./config.ts";
import { clientWith, extractionAnswer, ScriptedProvider, UnavailableProvider } from "./llm-fake.ts";

let db: Database;

const AT = new Date(Date.parse("2026-10-23T09:00:00.000Z"));
const URL_VALUE = "https://news.example.com/world/story-42";
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

const grounded = () =>
  extractionAnswer([
    {
      subjectType: "ORGANIZATION",
      subject: "Northwind Trading",
      attribute: "opened_branch_in",
      value: "Harbour City",
      quote: BODY_TEXT,
    },
  ]);

const ungrounded = () =>
  extractionAnswer([
    { subject: "x", attribute: "y", value: "z", quote: "A quote that is absent from the body." },
  ]);

beforeAll(() => {
  db = createDatabase({
    connectionString: TEST_ENGINE.databaseUrl,
    onConnectionError: () => undefined,
  });
});
afterAll(async () => {
  await db.close();
});

/** A tenant with one FOUND, fused article job, its evidence, and the stored result. */
async function articleCase(
  tag: string,
  options: { readonly fused?: boolean; readonly outcome?: "FOUND" | "NOT_FOUND" } = {},
): Promise<{
  readonly tenantId: TenantId;
  readonly runId: string;
  readonly jobId: string;
  readonly evidenceId: string;
}> {
  const { fused = true, outcome = "FOUND" } = options;
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
      outcome,
      result: outcome === "FOUND" ? ARTICLE_RESULT_VALUE : null,
      ...(outcome === "FOUND" ? { evidenceIds: [evidence.id] } : {}),
      finishedAt: AT,
      ...(fused && outcome === "FOUND" ? { fusedAt: AT } : {}),
    });
    return { tenantId, runId: run.id, jobId: job.id, evidenceId: evidence.id };
  });
}

const claimsFor = (tenantId: TenantId, evidenceId: string) =>
  db.withTenant(tenantId, ({ repos }) =>
    repos.claims.listForEvidence([evidenceId], { limit: 100 }),
  );

async function llmUsageFor(tenantId: TenantId, jobId: string) {
  const rows = await db.withTenant(tenantId, ({ repos }) =>
    repos.usageEvents.list({ limit: 1000 }),
  );
  return rows
    .filter(
      (row) =>
        row.jobId === jobId && (row.unit === "LLM_INPUT_TOKEN" || row.unit === "LLM_OUTPUT_TOKEN"),
    )
    .map((row) => ({ unit: row.unit, quantity: row.quantity, attempt: row.attempt }))
    .sort((a, b) => a.unit.localeCompare(b.unit));
}

const processorWith = (provider: ScriptedProvider | UnavailableProvider) =>
  new ArticleExtractionProcessor({ db, llm: clientWith(provider), retry: RETRY });

const DELIVERY = { attempt: 1, finalAttempt: false } as const;

describe("ArticleExtractionProcessor against the database", () => {
  it("extracts a FOUND article: one DERIVED claim on the URL entity, tokens charged once", async () => {
    const { tenantId, jobId, evidenceId } = await articleCase("proc-ok");
    const disposition = await processorWith(new ScriptedProvider([grounded()])).process(
      tenantId,
      jobId,
      DELIVERY,
    );
    expect(disposition).toEqual({ kind: "COMPLETED", status: "SUCCEEDED", errorCode: null });

    const claims = (await claimsFor(tenantId, evidenceId)).filter(
      (c) => c.attribute === ARTICLE_STATEMENTS_ATTRIBUTE,
    );
    expect(claims).toHaveLength(1);
    expect(claims[0]?.strength).toBe("DERIVED");
    expect(claims[0]?.entityId).not.toBeNull();
    // The scripted model reports 100 input / 20 output tokens for its one call.
    expect(await llmUsageFor(tenantId, jobId)).toEqual([
      { unit: "LLM_INPUT_TOKEN", quantity: 100, attempt: 1 },
      { unit: "LLM_OUTPUT_TOKEN", quantity: 20, attempt: 1 },
    ]);
  });

  it("a duplicate delivery writes no second claim, makes no model call, and charges nothing more", async () => {
    const { tenantId, jobId, evidenceId } = await articleCase("proc-dup");
    await processorWith(new ScriptedProvider([grounded()])).process(tenantId, jobId, DELIVERY);
    const usageBefore = await llmUsageFor(tenantId, jobId);

    const provider = new ScriptedProvider([grounded()]);
    const again = await processorWith(provider).process(tenantId, jobId, DELIVERY);
    expect(again).toMatchObject({ kind: "SKIPPED" });
    expect(provider.requests).toHaveLength(0); // the pre-check skipped before any model call
    expect(
      (await claimsFor(tenantId, evidenceId)).filter(
        (c) => c.attribute === ARTICLE_STATEMENTS_ATTRIBUTE,
      ),
    ).toHaveLength(1);
    expect(await llmUsageFor(tenantId, jobId)).toEqual(usageBefore);
  });

  it("two concurrent deliveries write exactly one claim and one usage row per unit", async () => {
    const { tenantId, jobId, evidenceId } = await articleCase("proc-race");
    // One processor, one client, two scripted answers: both deliveries really
    // call the model, but only one claim and one charge survive the unique index.
    const processor = processorWith(new ScriptedProvider([grounded(), grounded()]));
    const dispositions = await Promise.all([
      processor.process(tenantId, jobId, DELIVERY),
      processor.process(tenantId, jobId, DELIVERY),
    ]);
    // Both are non-failing; at least one SUCCEEDED, neither duplicated anything.
    for (const d of dispositions) expect(d.kind).not.toBe("RETRY");
    expect(
      (await claimsFor(tenantId, evidenceId)).filter(
        (c) => c.attribute === ARTICLE_STATEMENTS_ATTRIBUTE,
      ),
    ).toHaveLength(1);
    expect(await llmUsageFor(tenantId, jobId)).toEqual([
      { unit: "LLM_INPUT_TOKEN", quantity: 100, attempt: 1 },
      { unit: "LLM_OUTPUT_TOKEN", quantity: 20, attempt: 1 },
    ]);
  });

  it("a rejected answer is terminal, writes no claim, leaves the evidence, and charges its tokens once", async () => {
    const { tenantId, jobId, evidenceId } = await articleCase("proc-reject");
    // generateValidated retries the rejected answer once: two provider calls,
    // each 100/20, so 200/40 are charged — once, at the fixed attempt.
    const disposition = await processorWith(
      new ScriptedProvider([ungrounded(), ungrounded()]),
    ).process(tenantId, jobId, { attempt: 1, finalAttempt: true });
    expect(disposition).toEqual({
      kind: "COMPLETED",
      status: "FAILED",
      errorCode: "EXTRACTION_REJECTED",
    });
    expect(
      (await claimsFor(tenantId, evidenceId)).some(
        (c) => c.attribute === ARTICLE_STATEMENTS_ATTRIBUTE,
      ),
    ).toBe(false);
    const evidence = await db.withTenant(tenantId, ({ repos }) =>
      repos.evidence.findById(evidenceId),
    );
    expect(evidence).not.toBeNull();
    expect(await llmUsageFor(tenantId, jobId)).toEqual([
      { unit: "LLM_INPUT_TOKEN", quantity: 200, attempt: 1 },
      { unit: "LLM_OUTPUT_TOKEN", quantity: 40, attempt: 1 },
    ]);
  });

  it("is SKIPPED with no model configured, writing no claim and charging nothing", async () => {
    const { tenantId, jobId, evidenceId } = await articleCase("proc-off");
    const processor = new ArticleExtractionProcessor({
      db,
      llm: { unavailable: "No hosted LLM provider is configured." },
      retry: RETRY,
    });
    expect(await processor.process(tenantId, jobId, DELIVERY)).toMatchObject({ kind: "SKIPPED" });
    expect(
      (await claimsFor(tenantId, evidenceId)).some(
        (c) => c.attribute === ARTICLE_STATEMENTS_ATTRIBUTE,
      ),
    ).toBe(false);
    expect(await llmUsageFor(tenantId, jobId)).toEqual([]);
  });

  it("retries an unavailable endpoint with attempts left, and fails terminally on the last", async () => {
    const { tenantId, jobId } = await articleCase("proc-unavail");
    const processor = processorWith(new UnavailableProvider());
    const retry = await processor.process(tenantId, jobId, { attempt: 1, finalAttempt: false });
    expect(retry.kind).toBe("RETRY");
    if (retry.kind === "RETRY") {
      expect(retry.errorCode).toBe("LLM_UNAVAILABLE");
      expect(retry.delayMs).toBeGreaterThan(0);
    }
    const terminal = await processor.process(tenantId, jobId, { attempt: 3, finalAttempt: true });
    expect(terminal).toEqual({ kind: "COMPLETED", status: "FAILED", errorCode: "LLM_UNAVAILABLE" });
    // A provider that never reported usage is never charged.
    expect(await llmUsageFor(tenantId, jobId)).toEqual([]);
  });

  it("SKIPs a non-article job id, touching nothing", async () => {
    const { tenantId } = await articleCase("proc-foreign");
    expect(
      await processorWith(new ScriptedProvider([])).process(tenantId, randomUUID(), DELIVERY),
    ).toMatchObject({ kind: "SKIPPED" });
  });

  it("keeps claims and usage within the collecting tenant", async () => {
    const a = await articleCase("proc-tenant-a");
    await processorWith(new ScriptedProvider([grounded()])).process(a.tenantId, a.jobId, DELIVERY);
    const other = parseTenantId(randomUUID());
    await db.provisionTenant({ tenantId: other, name: "[Tenant other]", region: "IN" });
    const seen = await db.withTenant(other, async ({ repos }) => ({
      claims: await repos.claims.list({ limit: 100 }),
      usage: await repos.usageEvents.list({ limit: 100 }),
    }));
    expect(seen.claims).toEqual([]);
    expect(seen.usage).toEqual([]);
  });

  it("offers for extraction only FOUND, fused article jobs", async () => {
    const found = await articleCase("proc-pending-found");
    const processor = processorWith(new ScriptedProvider([]));
    expect(await processor.pendingForRun(found.tenantId, found.runId)).toEqual([found.jobId]);

    const notFused = await articleCase("proc-pending-unfused", { fused: false });
    expect(await processor.pendingForRun(notFused.tenantId, notFused.runId)).toEqual([]);

    const notFound = await articleCase("proc-pending-notfound", { outcome: "NOT_FOUND" });
    expect(await processor.pendingForRun(notFound.tenantId, notFound.runId)).toEqual([]);
  });
});

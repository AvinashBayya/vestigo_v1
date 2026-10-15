/**
 * RELEASE-BLOCKING. Requesting a case analysis (R1-b), against the database:
 * the same input is one analysis; a case past the size one analysis reads, or
 * an archived case, is refused before anything is recorded; two requests
 * racing to retry a failed analysis record one attempt, and the other is told
 * to send again; and
 * enqueueing an attempt never waits past its bound on a queue it cannot reach.
 */
import { ENGINE_VERSION } from "@repo/case-engine";
import {
  CaseAnalysisEventsRepository,
  CaseScopeRepository,
  createDatabase,
  type Database,
} from "@repo/db";
import { Queue, type Job } from "bullmq";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parseTenantId } from "@repo/core";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  analysisRecord,
  CaseAnalysisQueue,
  CaseAnalysisRequestConflictError,
  CaseArchivedError,
  CaseTooLargeError,
  currentInput,
  QueueUnavailableError,
  readView,
  REPEATING_FAILURES,
  requestCaseAnalysis,
  requestedView,
} from "../src/index.ts";
import { createCaseFixture, FIXTURE_COLLECTORS } from "./case-fixture.ts";
import { TEST_ENGINE } from "./config.ts";

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

const AT = new Date(Date.parse("2026-10-09T10:00:00.000Z"));

describe("enqueueing an attempt (RELEASE-BLOCKING)", () => {
  it("gives up past its bound when the queue cannot be reached (QUEUE_UNAVAILABLE)", async () => {
    // Nothing listens on port 1: the client keeps trying to connect.
    const queue = new CaseAnalysisQueue(
      { url: "redis://127.0.0.1:1", prefix: `unreachable-${randomUUID().slice(0, 8)}` },
      { maxAttempts: 1, baseDelayMs: 10, maxDelayMs: 10 },
      { enqueueTimeoutMs: 300 },
    );
    const started = Date.now();
    try {
      const refused = await queue
        .enqueueAnalysis(parseTenantId(randomUUID()), randomUUID(), 1)
        .catch((error: unknown) => error);
      expect(refused).toBeInstanceOf(QueueUnavailableError);
      expect(refused).toMatchObject({ code: "QUEUE_UNAVAILABLE" });
      expect(Date.now() - started).toBeLessThan(5_000);
    } finally {
      // Closing a queue that never connected must not hold the suite open.
      await Promise.race([queue.close(), new Promise((resolve) => setTimeout(resolve, 2_000))]);
    }
  });
});

describe("resuming an attempt whose job is kept as failed (RELEASE-BLOCKING)", () => {
  it("answers as enqueued when another request delivered it first and a worker holds it", async () => {
    const queue = new CaseAnalysisQueue(
      { url: TEST_ENGINE.redisUrl, prefix: `resume-${randomUUID().slice(0, 8)}` },
      { maxAttempts: 1, baseDelayMs: 10, maxDelayMs: 10 },
    );
    // The kept job reads as failed, then, once another request has removed it,
    // added it again and a worker has locked it, refuses to be removed.
    const kept = {
      getState: vi.fn().mockResolvedValueOnce("failed").mockResolvedValueOnce("active"),
      remove: vi.fn().mockRejectedValue(new Error("[locked by another worker]")),
    };
    const found = vi.spyOn(Queue.prototype, "getJob").mockResolvedValue(kept as unknown as Job);
    const added = vi.spyOn(Queue.prototype, "add");
    try {
      await queue.enqueueAnalysis(parseTenantId(randomUUID()), randomUUID(), 1);
      expect(kept.remove).toHaveBeenCalledTimes(1);
      // Already on its way: nothing is added twice, and no error is raised.
      expect(added).not.toHaveBeenCalled();
    } finally {
      found.mockRestore();
      added.mockRestore();
      await queue.close();
    }
  });
});

describe("requesting a case analysis (RELEASE-BLOCKING)", () => {
  it("is one analysis per input: CREATED once, then EXISTING", async () => {
    const fixture = await createCaseFixture(db, "request-once");
    const request = () =>
      db.withTenant(fixture.tenantId, (context) =>
        requestCaseAnalysis(context, {
          caseId: fixture.caseId,
          collectors: FIXTURE_COLLECTORS,
          requestedByUserId: fixture.userId,
          at: AT,
        }),
      );
    const first = await request();
    expect(first).toMatchObject({ kind: "CREATED", enqueue: true, record: { attempt: 1 } });
    expect(first.record.analysis.engineVersion).toBe(ENGINE_VERSION);
    const second = await request();
    expect(second).toMatchObject({ kind: "EXISTING", enqueue: true });
    expect(second.record.analysis.id).toBe(first.record.analysis.id);
  });

  it("refuses a case past the size bound before reading it, recording nothing", async () => {
    const fixture = await createCaseFixture(db, "request-too-large");
    const loads = vi.spyOn(CaseScopeRepository.prototype, "records");
    const refused = await db
      .withTenant(fixture.tenantId, (context) =>
        requestCaseAnalysis(context, {
          caseId: fixture.caseId,
          collectors: FIXTURE_COLLECTORS,
          requestedByUserId: null,
          at: AT,
          maxRecords: 1,
        }),
      )
      .catch((error: unknown) => error)
      .finally(() => {
        loads.mockRestore();
      });
    expect(refused).toBeInstanceOf(CaseTooLargeError);
    // Counted in the database: the case was never loaded.
    expect(loads).not.toHaveBeenCalled();
    const analyses = await db.withTenant(fixture.tenantId, ({ repos }) =>
      repos.caseAnalyses.listForCase(fixture.caseId, { limit: 10 }),
    );
    expect(analyses).toEqual([]);
  });

  it("refuses an archived case before counting or reading it, recording nothing", async () => {
    const fixture = await createCaseFixture(db, "request-archived");
    await db.withTenant(fixture.tenantId, ({ repos }) => repos.cases.archive(fixture.caseId));
    const counts = vi.spyOn(CaseScopeRepository.prototype, "count");
    const loads = vi.spyOn(CaseScopeRepository.prototype, "records");
    const refused = await db
      .withTenant(fixture.tenantId, (context) =>
        requestCaseAnalysis(context, {
          caseId: fixture.caseId,
          collectors: FIXTURE_COLLECTORS,
          requestedByUserId: null,
          at: AT,
        }),
      )
      .catch((error: unknown) => error)
      .finally(() => {
        counts.mockRestore();
        loads.mockRestore();
      });
    expect(refused).toBeInstanceOf(CaseArchivedError);
    expect(refused).toMatchObject({ code: "CASE_ARCHIVED" });
    expect(counts).not.toHaveBeenCalled();
    expect(loads).not.toHaveBeenCalled();
    const analyses = await db.withTenant(fixture.tenantId, ({ repos }) =>
      repos.caseAnalyses.listForCase(fixture.caseId, { limit: 10 }),
    );
    expect(analyses).toEqual([]);
  });

  it("returns a failure the same input repeats, and tries any other again", async () => {
    const fixture = await createCaseFixture(db, "request-repeating");
    const request = () =>
      db.withTenant(fixture.tenantId, (context) =>
        requestCaseAnalysis(context, {
          caseId: fixture.caseId,
          collectors: FIXTURE_COLLECTORS,
          requestedByUserId: null,
          at: AT,
        }),
      );
    const created = await request();
    const analysisId = created.record.analysis.id;
    await db.withTenant(fixture.tenantId, ({ repos }) =>
      repos.caseAnalysisEvents.fail({
        analysisId,
        attempt: 1,
        error: { code: "CASE_INPUT_INVALID", message: "[contradiction]" },
        at: AT,
      }),
    );
    const repeated = await request();
    expect(repeated).toMatchObject({
      kind: "EXISTING",
      enqueue: false,
      record: { attempt: 1, status: "FAILED", error: { code: "CASE_INPUT_INVALID" } },
    });
    expect(requestedView(repeated)).toMatchObject({
      state: "FAILED",
      reason: expect.stringContaining("inputs are unchanged") as unknown,
    });
    expect([...REPEATING_FAILURES]).toEqual(["CASE_INPUT_INVALID"]);

    // Any other failure depends on more than the input: a new attempt.
    const other = await createCaseFixture(db, "request-not-repeating");
    const requestOther = () =>
      db.withTenant(other.tenantId, (context) =>
        requestCaseAnalysis(context, {
          caseId: other.caseId,
          collectors: FIXTURE_COLLECTORS,
          requestedByUserId: null,
          at: AT,
        }),
      );
    const first = await requestOther();
    await db.withTenant(other.tenantId, ({ repos }) =>
      repos.caseAnalysisEvents.fail({
        analysisId: first.record.analysis.id,
        attempt: 1,
        error: { code: "CASE_ANALYSIS_TIMEOUT", message: "[timed out]" },
        at: AT,
      }),
    );
    expect(await requestOther()).toMatchObject({
      kind: "RETRIED",
      enqueue: true,
      record: { attempt: 2 },
    });
  });

  it("two requests retrying a failed analysis at once record one attempt", async () => {
    const fixture = await createCaseFixture(db, "request-race");
    const request = () =>
      db.withTenant(fixture.tenantId, (context) =>
        requestCaseAnalysis(context, {
          caseId: fixture.caseId,
          collectors: FIXTURE_COLLECTORS,
          requestedByUserId: null,
          at: AT,
        }),
      );
    const created = await request();
    const analysisId = created.record.analysis.id;
    await db.withTenant(fixture.tenantId, ({ repos }) =>
      repos.caseAnalysisEvents.fail({
        analysisId,
        attempt: 1,
        error: { code: "WORKER_ERROR", message: "[failed]" },
        at: AT,
      }),
    );
    // Both read the failure before either records its retry: a real race.
    // eslint-disable-next-line @typescript-eslint/unbound-method -- called below with each instance as `this`
    const original = CaseAnalysisEventsRepository.prototype.request;
    let arrived = 0;
    let release: () => void = () => undefined;
    const together = new Promise<void>((resolve) => {
      release = resolve;
    });
    const spy = vi
      .spyOn(CaseAnalysisEventsRepository.prototype, "request")
      .mockImplementation(async function (this: CaseAnalysisEventsRepository, input) {
        arrived += 1;
        if (arrived === 2) release();
        await together;
        return original.call(this, input);
      });
    const both = await Promise.allSettled([request(), request()]).finally(() => {
      spy.mockRestore();
    });
    const retried = both.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    const refused = both.flatMap((r) => (r.status === "rejected" ? [r.reason as unknown] : []));
    expect(retried.map((r) => [r.kind, r.record.attempt])).toEqual([["RETRIED", 2]]);
    expect(refused).toHaveLength(1);
    expect(refused[0]).toBeInstanceOf(CaseAnalysisRequestConflictError);
    const events = await db.withTenant(fixture.tenantId, ({ repos }) =>
      repos.caseAnalysisEvents.listForAnalysis(analysisId),
    );
    expect(events.map((e) => [e.attempt, e.status])).toEqual([
      [1, "PENDING"],
      [1, "FAILED"],
      [2, "PENDING"],
    ]);
  });
});

describe("reading an analysis an earlier engine version stored (RELEASE-BLOCKING)", () => {
  it("reads a document ENGINE_VERSION 4 stored as STALE, with its document, never failing", async () => {
    // Written by ENGINE_VERSION 4's own code (a546de9) and stored as the job
    // stores it. A read re-parses it with today's schema: a value it holds that
    // today's schema refused would make every read of it fail.
    const stored = JSON.parse(
      readFileSync(new URL("./fixtures/case-analysis-engine-v4.json", import.meta.url), "utf8"),
    ) as { readonly document: { readonly inputHash: string }; readonly wording: unknown };
    const fixture = await createCaseFixture(db, "request-stored-v4");
    const view = await db.withTenant(fixture.tenantId, async (context) => {
      const { analysis } = await context.repos.caseAnalyses.findOrCreate({
        caseId: fixture.caseId,
        inputHash: stored.document.inputHash,
        engineVersion: 4,
        requestedByUserId: null,
        requestedAt: AT,
        basis: { evidenceIds: [fixture.evidenceId], runIds: [fixture.runId] },
      });
      await context.repos.caseAnalysisEvents.request({
        analysisId: analysis.id,
        attempt: 1,
        requestedByUserId: null,
        at: AT,
      });
      await context.repos.caseAnalysisEvents.complete({
        analysisId: analysis.id,
        attempt: 1,
        document: stored.document,
        wording: stored.wording,
        at: AT,
      });
      const { inputHash } = await currentInput(context, fixture.caseId, FIXTURE_COLLECTORS);
      return readView(fixture.caseId, inputHash, await analysisRecord(context, analysis));
    });
    expect(view.state).toBe("STALE");
    expect(view.analysis).toMatchObject({
      status: "COMPLETE",
      document: { engineVersion: 4, formatVersion: 1 },
    });
  });
});

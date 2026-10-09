/**
 * RELEASE-BLOCKING. Requesting a case analysis (R1-b), against the database:
 * the same input is one analysis; a case past the size one analysis reads is
 * refused before anything is recorded; two requests racing to retry a failed
 * analysis record one attempt, and the other is told to send again; and
 * enqueueing an attempt never waits past its bound on a queue it cannot reach.
 */
import { ENGINE_VERSION } from "@repo/case-engine";
import { CaseAnalysisEventsRepository, createDatabase, type Database } from "@repo/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parseTenantId } from "@repo/core";
import { randomUUID } from "node:crypto";
import {
  CaseAnalysisQueue,
  CaseAnalysisRequestConflictError,
  CaseTooLargeError,
  QueueUnavailableError,
  requestCaseAnalysis,
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

  it("refuses a case past the size bound, recording nothing", async () => {
    const fixture = await createCaseFixture(db, "request-too-large");
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
      .catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(CaseTooLargeError);
    const analyses = await db.withTenant(fixture.tenantId, ({ repos }) =>
      repos.caseAnalyses.listForCase(fixture.caseId, { limit: 10 }),
    );
    expect(analyses).toEqual([]);
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

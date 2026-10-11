/**
 * RELEASE-BLOCKING. When the job queue does not take a job within its bound
 * (QueueUnavailableError, CLAUDE.md §5), the API answers 503 QUEUE_UNAVAILABLE
 * and says truthfully what was recorded:
 *   - starting a run enqueues inside the run's transaction, so nothing is
 *     recorded: no run;
 *   - a replay marks the job QUEUED first, so the answer says the job stays
 *     queued and is not collected until the queue takes it.
 * The bound itself is pinned per producer in
 * packages/osint-engine/test/enqueue-bounds.test.ts.
 */
import { parseTenantId } from "@repo/core";
import { QueueUnavailableError } from "@repo/osint-engine";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createTestApi,
  provisionTestTenant,
  readyBrowser,
  type Browser,
  type TestApi,
} from "./support.ts";

let api: TestApi;
let browser: Browser;
let tenantId: string;
let userId: string;

beforeAll(async () => {
  api = await createTestApi();
  const tenant = await provisionTestTenant(api, "queue-unavailable");
  tenantId = tenant.tenantId;
  userId = tenant.ownerUserId;
  browser = await readyBrowser(api, tenant.owner, tenant.tenantId);
});

afterAll(async () => {
  await api.close();
});

describe("the queue not taking a job in time (RELEASE-BLOCKING)", () => {
  it("starting a run answers 503 and records no run", async () => {
    const created = await browser.request("POST", "/api/v1/investigations", {
      title: "[Investigation]",
      target: "example.com",
    });
    expect(created.status).toBe(201);
    const investigationId = created.json<{ id: string }>().id;
    const spy = vi
      .spyOn(api.services.runs.investigations, "enqueueRun")
      .mockRejectedValue(new QueueUnavailableError(5_000));
    try {
      const response = await browser.request(
        "POST",
        `/api/v1/investigations/${investigationId}/runs`,
        {},
      );
      expect(response.status).toBe(503);
      expect(response.json()).toMatchObject({ code: "QUEUE_UNAVAILABLE" });
    } finally {
      spy.mockRestore();
    }
    const runs = await browser.request("GET", `/api/v1/investigations/${investigationId}/runs`);
    expect(runs.json<{ items: unknown[] }>().items).toEqual([]);
  });

  it("a replay answers 503, saying the job stays queued and is not collected", async () => {
    const jobId = await api.db.withTenant(parseTenantId(tenantId), async ({ repos }) => {
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
        createdByUserId: userId,
      });
      const run = await repos.runs.create({
        investigationId: investigation.id,
        status: "PARTIAL",
        requestedByUserId: userId,
      });
      const job = await repos.jobs.create({
        runId: run.id,
        collectorId: "crtsh",
        idempotencyKey: `queue-unavailable:${run.id}`,
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
    const spy = vi
      .spyOn(api.services.runs.replayer, "replay")
      .mockRejectedValue(new QueueUnavailableError(5_000));
    try {
      const response = await browser.request("POST", `/api/v1/jobs/${jobId}/replay`, {});
      expect(response.status).toBe(503);
      expect(response.json()).toMatchObject({
        code: "QUEUE_UNAVAILABLE",
        detail: expect.stringContaining("stays queued and is not collected") as unknown,
      });
    } finally {
      spy.mockRestore();
    }
  });
});

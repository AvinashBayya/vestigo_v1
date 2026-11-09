import type { TenantId } from "@repo/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  Browser,
  createTestApi,
  provisionTestTenant,
  readyBrowser,
  type TestApi,
} from "./support.ts";

let api: TestApi;
let analyst: Browser;
let otherTenantAnalyst: Browser;
let tenant1Id: TenantId;

beforeAll(async () => {
  api = await createTestApi();
  const tenant1 = await provisionTestTenant(api, "monitors-t1");
  tenant1Id = tenant1.tenantId;
  analyst = await readyBrowser(api, tenant1.owner, tenant1.tenantId);

  const tenant2 = await provisionTestTenant(api, "monitors-t2");
  otherTenantAnalyst = await readyBrowser(api, tenant2.owner, tenant2.tenantId);
});

afterAll(async () => {
  await api.close();
});

describe("Monitors API (/api/v1/monitors)", () => {
  it("refuses unauthenticated requests with 401", async () => {
    const unauthed = new Browser(api);
    const res = await unauthed.request("GET", "/api/v1/monitors");
    expect(res.status).toBe(401);
  });

  it("validates monitor input and rejects invalid cron schedules", async () => {
    const invalidCron = await analyst.request("POST", "/api/v1/monitors", {
      name: "Bad Cron Monitor",
      target: "example.com",
      scheduleCron: "not-a-cron",
    });
    expect(invalidCron.status).toBe(400);
    const err = invalidCron.json<{ code: string }>();
    expect(err.code).toBe("INVALID_CRON");

    const blankName = await analyst.request("POST", "/api/v1/monitors", {
      name: "   ",
      target: "example.com",
      scheduleCron: "0 * * * *",
    });
    expect(blankName.status).toBe(400);
  });

  it("creates, inspects, updates, enables/disables, and deactivates monitors", async () => {
    // 1. Create
    const createRes = await analyst.request("POST", "/api/v1/monitors", {
      name: "Primary Domain Watch",
      target: "example.com",
      scheduleCron: "0 6 * * *",
      enabled: true,
    });
    expect(createRes.status).toBe(201);
    const created = createRes.json<{
      id: string;
      name: string;
      target: string;
      scheduleCron: string;
      enabled: boolean;
      createdAt: string;
    }>();

    expect(created.id).toBeDefined();
    expect(created.name).toBe("Primary Domain Watch");
    expect(created.target).toBe("example.com");
    expect(created.scheduleCron).toBe("0 6 * * *");
    expect(created.enabled).toBe(true);

    const monitorId = created.id;

    // 2. Inspect
    const inspectRes = await analyst.request("GET", `/api/v1/monitors/${monitorId}`);
    expect(inspectRes.status).toBe(200);
    expect(inspectRes.json<{ id: string }>().id).toBe(monitorId);

    // 3. Disable explicitly
    const disableRes = await analyst.request("POST", `/api/v1/monitors/${monitorId}/disable`);
    expect(disableRes.status).toBe(200);
    expect(disableRes.json<{ enabled: boolean }>().enabled).toBe(false);

    // 4. Tick while disabled is rejected
    const tickDisabled = await analyst.request("POST", `/api/v1/monitors/${monitorId}/tick`);
    expect(tickDisabled.status).toBe(400);
    expect(tickDisabled.json<{ code: string }>().code).toBe("MONITOR_DISABLED");

    // 5. Re-enable
    const enableRes = await analyst.request("POST", `/api/v1/monitors/${monitorId}/enable`);
    expect(enableRes.status).toBe(200);
    expect(enableRes.json<{ enabled: boolean }>().enabled).toBe(true);

    // 6. Update schedule and name
    const updateRes = await analyst.request("PATCH", `/api/v1/monitors/${monitorId}`, {
      name: "Updated Domain Watch",
      scheduleCron: "*/30 * * * *",
    });
    expect(updateRes.status).toBe(200);
    const updated = updateRes.json<{ name: string; scheduleCron: string }>();
    expect(updated.name).toBe("Updated Domain Watch");
    expect(updated.scheduleCron).toBe("*/30 * * * *");

    // 7. List
    const listRes = await analyst.request("GET", "/api/v1/monitors");
    expect(listRes.status).toBe(200);
    const list = listRes.json<{ items: { id: string }[]; hasMore: boolean }>();
    expect(list.items.some((m) => m.id === monitorId)).toBe(true);

    // 8. Safe tick execution when no matching evidence
    const tickRes = await analyst.request("POST", `/api/v1/monitors/${monitorId}/tick`);
    expect(tickRes.status).toBe(200);
    const tickBody = tickRes.json<{
      monitorId: string;
      target: string;
      status: string;
      message: string;
      alertId: string | null;
    }>();
    expect(tickBody.monitorId).toBe(monitorId);
    expect(tickBody.target).toBe("example.com");
    expect(tickBody.status).toBe("NO_NEW_DATA");
    expect(tickBody.alertId).toBeNull();

    // 9. Deactivate via DELETE endpoint
    const deleteRes = await analyst.request("DELETE", `/api/v1/monitors/${monitorId}`);
    expect(deleteRes.status).toBe(204);

    const recheck = await analyst.request("GET", `/api/v1/monitors/${monitorId}`);
    expect(recheck.status).toBe(200);
    expect(recheck.json<{ enabled: boolean }>().enabled).toBe(false);
  });

  it("strictly enforces tenant isolation for monitors", async () => {
    // Created in Tenant 1
    const createRes = await analyst.request("POST", "/api/v1/monitors", {
      name: "Tenant 1 Watch",
      target: "tenant1.example.org",
      scheduleCron: "0 * * * *",
    });
    expect(createRes.status).toBe(201);
    const t1MonitorId = createRes.json<{ id: string }>().id;

    // Tenant 2 cannot inspect Tenant 1's monitor
    const t2Inspect = await otherTenantAnalyst.request("GET", `/api/v1/monitors/${t1MonitorId}`);
    expect(t2Inspect.status).toBe(404);

    // Tenant 2 cannot update Tenant 1's monitor
    const t2Update = await otherTenantAnalyst.request("PATCH", `/api/v1/monitors/${t1MonitorId}`, {
      name: "Hijacked",
    });
    expect(t2Update.status).toBe(404);

    // Tenant 2 cannot tick Tenant 1's monitor
    const t2Tick = await otherTenantAnalyst.request("POST", `/api/v1/monitors/${t1MonitorId}/tick`);
    expect(t2Tick.status).toBe(404);

    // Tenant 2 cannot delete/deactivate Tenant 1's monitor
    const t2Delete = await otherTenantAnalyst.request("DELETE", `/api/v1/monitors/${t1MonitorId}`);
    expect(t2Delete.status).toBe(404);
  });

  it("executes tick safely, correlates evidence, and deduplicates generated alerts", async () => {
    // 1. Create a monitor for a specific target
    const monRes = await analyst.request("POST", "/api/v1/monitors", {
      name: "Correlated Evidence Watch",
      target: "target-evidence.org",
      scheduleCron: "0 */2 * * *",
    });
    expect(monRes.status).toBe(201);
    const monitorId = monRes.json<{ id: string }>().id;

    // 2. Insert evidence directly in tenant 1 with sourceUrl matching the target
    await api.db.withTenant(tenant1Id, async ({ repos }) => {
      await repos.collectorsRegistry.register({
        collectorId: "watch-fixture",
        sourceLabel: "[Watch fixture collector]",
        discipline: "TECHINT",
        collectionMode: "LOCAL_ANALYSIS",
        dataLicence: "[not applicable: test fixture]",
        commercialUse: "UNVERIFIED",
        enabled: true,
        disabledReason: null,
      });
      const investigation = await repos.investigations.create({
        title: "[watch investigation]",
        target: "target-evidence.org",
        createdByUserId: null,
      });
      const run = await repos.runs.create({
        investigationId: investigation.id,
        status: "QUEUED",
        requestedByUserId: null,
      });
      const job = await repos.jobs.create({
        runId: run.id,
        collectorId: "watch-fixture",
        idempotencyKey: `watch:${run.id}`,
        status: "QUEUED",
      });
      const payload = new TextEncoder().encode("<html>[watch payload]</html>");
      const stored = await api.services.runs.contentStore.put(tenant1Id, payload);
      await repos.evidence.record({
        collectorId: "watch-fixture",
        collectorVersion: "1.0.0",
        jobId: job.id,
        sourceUrl: "https://target-evidence.org/advisory",
        contentHash: stored.contentHash,
        payloadRef: stored.ref,
        observedAt: null,
        collectedAt: new Date(),
        claimStrength: "OBSERVED",
      });
    });

    // 3. First tick: finds correlated evidence and generates a new alert
    const firstTick = await analyst.request("POST", `/api/v1/monitors/${monitorId}/tick`);
    expect(firstTick.status).toBe(200);
    const firstTickBody = firstTick.json<{
      status: string;
      alertId: string | null;
      message: string;
    }>();
    expect(firstTickBody.status).toBe("EXECUTED");
    expect(firstTickBody.alertId).not.toBeNull();
    const generatedAlertId = firstTickBody.alertId;

    // 4. Second tick: runs against the same evidence and deduplicates (returns same alertId, no duplicate alert)
    const secondTick = await analyst.request("POST", `/api/v1/monitors/${monitorId}/tick`);
    expect(secondTick.status).toBe(200);
    const secondTickBody = secondTick.json<{
      status: string;
      alertId: string | null;
    }>();
    expect(secondTickBody.status).toBe("EXECUTED");
    expect(secondTickBody.alertId).toBe(generatedAlertId);

    // 5. Verify only 1 alert was created for this monitor
    const alertListRes = await analyst.request("GET", `/api/v1/alerts?monitorId=${monitorId}`);
    expect(alertListRes.status).toBe(200);
    const alertList = alertListRes.json<{ items: { id: string }[] }>();
    expect(alertList.items.filter((a) => a.id === generatedAlertId).length).toBe(1);
  });
});

describe("Alerts API (/api/v1/alerts)", () => {
  it("lists alerts, inspects detail, and supports acknowledgement with idempotency and tenant isolation", async () => {
    // 1. Create a monitor to associate alerts with
    const monRes = await analyst.request("POST", "/api/v1/monitors", {
      name: "Alert Test Monitor",
      target: "target-alert.org",
      scheduleCron: "0 0 * * *",
    });
    expect(monRes.status).toBe(201);
    const monitorId = monRes.json<{ id: string }>().id;

    // Create an alert directly via repos in tenant 1
    const createdAlert = await api.db.withTenant(tenant1Id, async ({ repos }) =>
      repos.alerts.create({
        monitorId,
        title: "Discovered new subdomains for target-alert.org",
        evidenceId: null,
      }),
    );

    // 2. List alerts
    const listRes = await analyst.request("GET", "/api/v1/alerts");
    expect(listRes.status).toBe(200);
    const listBody = listRes.json<{
      items: { id: string; title: string; acknowledgedAt: string | null }[];
    }>();
    expect(listBody.items.some((a) => a.id === createdAlert.id)).toBe(true);

    // Filter by monitorId
    const filteredRes = await analyst.request("GET", `/api/v1/alerts?monitorId=${monitorId}`);
    expect(filteredRes.status).toBe(200);
    const filteredBody = filteredRes.json<{ items: { id: string }[] }>();
    expect(filteredBody.items.some((a) => a.id === createdAlert.id)).toBe(true);

    // Filter by acknowledged=false
    const unackedRes = await analyst.request("GET", "/api/v1/alerts?acknowledged=false");
    expect(unackedRes.status).toBe(200);
    expect(
      unackedRes.json<{ items: { id: string }[] }>().items.some((a) => a.id === createdAlert.id),
    ).toBe(true);

    // 3. Inspect detail
    const detailRes = await analyst.request("GET", `/api/v1/alerts/${createdAlert.id}`);
    expect(detailRes.status).toBe(200);
    const detail = detailRes.json<{ id: string; title: string; acknowledgedAt: string | null }>();
    expect(detail.id).toBe(createdAlert.id);
    expect(detail.acknowledgedAt).toBeNull();

    // 4. Acknowledge alert
    const ackRes = await analyst.request("POST", `/api/v1/alerts/${createdAlert.id}/ack`);
    expect(ackRes.status).toBe(200);
    const ackBody = ackRes.json<{
      id: string;
      acknowledgedAt: string | null;
      acknowledgedByUserId: string | null;
    }>();
    expect(ackBody.acknowledgedAt).not.toBeNull();
    expect(ackBody.acknowledgedByUserId).toBeDefined();

    // 5. Acknowledge again is idempotent
    const ackAgain = await analyst.request("POST", `/api/v1/alerts/${createdAlert.id}/ack`);
    expect(ackAgain.status).toBe(200);
    expect(ackAgain.json<{ acknowledgedAt: string | null }>().acknowledgedAt).toBe(
      ackBody.acknowledgedAt,
    );

    // 6. Tenant isolation for alerts
    const t2AlertInspect = await otherTenantAnalyst.request(
      "GET",
      `/api/v1/alerts/${createdAlert.id}`,
    );
    expect(t2AlertInspect.status).toBe(404);

    const t2AlertAck = await otherTenantAnalyst.request(
      "POST",
      `/api/v1/alerts/${createdAlert.id}/ack`,
    );
    expect(t2AlertAck.status).toBe(404);
  });
});

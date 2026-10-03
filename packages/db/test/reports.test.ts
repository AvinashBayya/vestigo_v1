/**
 * The database's guarantees under Phase 5 reports: a report's document is
 * written once and only with SUCCEEDED; a finished report keeps its status,
 * whatever role writes it; a generation attempt's token usage is charged
 * once; and a tenant's handling marking stays within its bounds.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database, TenantContext } from "../src/database.ts";
import type { ModelCallUsage } from "../src/repositories/operations.ts";
import { ConstraintViolationError, ReportRecordedOnceError } from "../src/errors.ts";
import {
  asTenant,
  createTenantFixture,
  openDatabase,
  rawClient,
  sqlStateOf,
  type TenantFixture,
} from "./support.ts";
import { TEST_DATABASE } from "./config.ts";

let db: Database;
let tenant: TenantFixture;

beforeAll(async () => {
  db = openDatabase();
  tenant = await createTenantFixture(db, "reports");
});

afterAll(async () => {
  await db.close();
});

const DOCUMENT = { formatVersion: 1, note: "[fixture document]" };

async function newReport() {
  return db.withTenant(tenant.tenantId, ({ repos }) =>
    repos.reports.create({ runId: tenant.runId, includeSynthesis: false, requestedByUserId: null }),
  );
}

async function succeeded() {
  const report = await newReport();
  await db.withTenant(tenant.tenantId, ({ repos }) =>
    repos.reports.transition(report.id, {
      status: "SUCCEEDED",
      attempts: 1,
      document: DOCUMENT,
      finishedAt: new Date(),
    }),
  );
  return report;
}

describe("report lifecycle", () => {
  it("creates a report QUEUED, with no attempts and no document", async () => {
    const report = await newReport();
    expect(report).toMatchObject({ status: "QUEUED", attempts: 0, document: null });
  });

  it("stores a document only with SUCCEEDED", async () => {
    const report = await newReport();
    await expect(
      db.withTenant(tenant.tenantId, ({ repos }) =>
        repos.reports.transition(report.id, { status: "RUNNING", document: DOCUMENT }),
      ),
    ).rejects.toBeInstanceOf(ConstraintViolationError);
    await expect(
      db.withTenant(tenant.tenantId, ({ repos }) =>
        repos.reports.transition(report.id, { status: "SUCCEEDED" }),
      ),
    ).rejects.toBeInstanceOf(ConstraintViolationError);
  });

  it("never replaces a written document", async () => {
    const report = await succeeded();
    await expect(
      db.withTenant(tenant.tenantId, ({ repos }) =>
        repos.reports.transition(report.id, { document: { forged: true } }),
      ),
    ).rejects.toBeInstanceOf(ReportRecordedOnceError);
  });

  it("keeps a finished report's status", async () => {
    const report = await succeeded();
    await expect(
      db.withTenant(tenant.tenantId, ({ repos }) =>
        repos.reports.transition(report.id, {
          status: "FAILED",
          document: null,
          error: { code: "LATE", message: "[late failure]" },
        }),
      ),
    ).rejects.toBeInstanceOf(ReportRecordedOnceError);
  });

  it("holds for the schema owner too, beneath the application", async () => {
    const report = await succeeded();
    const owner = await rawClient(TEST_DATABASE.ownerUrl);
    try {
      const state = await asTenant(owner, tenant.tenantId, () =>
        sqlStateOf(() =>
          owner.query(`update public.reports set document = '{"forged": true}' where id = $1`, [
            report.id,
          ]),
        ),
      );
      expect(state).toBe("REP01");
    } finally {
      await owner.end();
    }
  });

  it("lets the application move only the lifecycle columns", async () => {
    const report = await newReport();
    const runtime = await rawClient(TEST_DATABASE.runtimeUrl);
    try {
      const state = await asTenant(runtime, tenant.tenantId, () =>
        sqlStateOf(() =>
          runtime.query(`update public.reports set include_synthesis = true where id = $1`, [
            report.id,
          ]),
        ),
      );
      expect(state).toBe("42501");
    } finally {
      await runtime.end();
    }
  });
});

describe("report usage", () => {
  it("charges one generation attempt once per unit", async () => {
    const report = await newReport();
    const record = () =>
      db.withTenant(tenant.tenantId, ({ repos }) =>
        repos.usageEvents.recordReportAttempt({
          unit: "LLM_OUTPUT_TOKEN",
          quantity: 250,
          reportId: report.id,
          attempt: 1,
          modelCalls: [
            {
              modelId: "[model]",
              endpointHost: "[endpoint host]",
              servedBy: "[provider]",
              regionHeaders: [],
              quantity: 250,
            },
          ],
        }),
      );
    expect(await record()).toBe(true);
    expect(await record()).toBe(false);
    const secondAttempt = await db.withTenant(tenant.tenantId, ({ repos }) =>
      repos.usageEvents.recordReportAttempt({
        unit: "LLM_OUTPUT_TOKEN",
        quantity: 90,
        reportId: report.id,
        attempt: 2,
        modelCalls: [
          {
            modelId: "[model]",
            endpointHost: "[endpoint host]",
            servedBy: null,
            regionHeaders: [],
            quantity: 90,
          },
        ],
      }),
    );
    expect(secondAttempt).toBe(true);
  });

  it("stores each model call's provider and share with the attempt's usage", async () => {
    const report = await newReport();
    const modelCalls = [
      {
        modelId: "[model]",
        endpointHost: "[endpoint host]",
        servedBy: "[provider a]",
        regionHeaders: [{ name: "x-example-region", value: "[region]" }],
        quantity: 700,
      },
      {
        modelId: "[model]",
        endpointHost: "[endpoint host]",
        servedBy: null,
        regionHeaders: [],
        quantity: 300,
      },
    ];
    const rows = await db.withTenant(tenant.tenantId, async ({ repos }) => {
      await repos.usageEvents.recordReportAttempt({
        unit: "LLM_INPUT_TOKEN",
        quantity: 1000,
        reportId: report.id,
        attempt: 1,
        modelCalls,
      });
      return repos.usageEvents.list({ limit: 1000 });
    });
    const row = rows.find((r) => r.reportId === report.id);
    expect(row?.quantity).toBe(1000);
    expect(row?.modelCalls).toEqual(modelCalls);
  });

  it("refuses model calls that do not account for the quantity exactly, or none at all", async () => {
    const report = await newReport();
    const attempt = (quantity: number, modelCalls: ModelCallUsage[]) =>
      db.withTenant(tenant.tenantId, ({ repos }) =>
        repos.usageEvents.recordReportAttempt({
          unit: "LLM_INPUT_TOKEN",
          quantity,
          reportId: report.id,
          attempt: 1,
          modelCalls,
        }),
      );
    await expect(
      attempt(100, [
        {
          modelId: "[model]",
          endpointHost: "[endpoint host]",
          servedBy: "[provider]",
          regionHeaders: [],
          quantity: 60,
        },
      ]),
    ).rejects.toThrow(/add up to the usage quantity/);
    await expect(attempt(100, [])).rejects.toThrow(/must list the model calls/);
    await expect(
      attempt(100, [
        {
          modelId: "[model]",
          endpointHost: "[endpoint host]",
          servedBy: "",
          regionHeaders: [],
          quantity: 100,
        },
      ]),
    ).rejects.toThrow(/its provider or null/);
    await expect(
      attempt(100, [
        { modelId: "[model]", endpointHost: "", servedBy: null, regionHeaders: [], quantity: 100 },
      ]),
    ).rejects.toThrow(/endpoint host/);
  });

  it("refuses model calls on a usage row that is not a report's", async () => {
    const runtime = await rawClient(TEST_DATABASE.runtimeUrl);
    try {
      const state = await asTenant(runtime, tenant.tenantId, () =>
        sqlStateOf(() =>
          runtime.query(
            `insert into public.usage_events (tenant_id, unit, quantity, job_id, attempt, model_calls)
             values ($1, 'LLM_INPUT_TOKEN', 1, $2, 1, '[{"modelId":"[model]","servedBy":null,"quantity":1}]')`,
            [tenant.tenantId, tenant.jobId],
          ),
        ),
      );
      expect(state).toBe("23514");
    } finally {
      await runtime.end();
    }
  });

  it("refuses a usage row naming both a job and a report", async () => {
    const report = await newReport();
    const runtime = await rawClient(TEST_DATABASE.runtimeUrl);
    try {
      const state = await asTenant(runtime, tenant.tenantId, () =>
        sqlStateOf(() =>
          runtime.query(
            `insert into public.usage_events (tenant_id, unit, quantity, job_id, report_id, attempt)
             values ($1, 'LLM_INPUT_TOKEN', 1, $2, $3, 1)`,
            [tenant.tenantId, tenant.jobId, report.id],
          ),
        ),
      );
      expect(state).toBe("23514");
    } finally {
      await runtime.end();
    }
  });
});

describe("the tenant's handling marking", () => {
  it("is set and cleared by the tenant", async () => {
    const set = await db.withTenant(tenant.tenantId, ({ repos }) =>
      repos.tenants.setReportHandlingMarking("[marking]"),
    );
    expect(set?.reportHandlingMarking).toBe("[marking]");
    const cleared = await db.withTenant(tenant.tenantId, ({ repos }) =>
      repos.tenants.setReportHandlingMarking(null),
    );
    expect(cleared?.reportHandlingMarking).toBeNull();
  });

  it("refuses blank, padded, over-long or multi-line markings", async () => {
    for (const marking of ["", " [padded] ", "x".repeat(81), "[line one]\n[line two]"]) {
      await expect(
        db.withTenant(tenant.tenantId, ({ repos }) =>
          repos.tenants.setReportHandlingMarking(marking),
        ),
        JSON.stringify(marking),
      ).rejects.toBeInstanceOf(ConstraintViolationError);
    }
  });
});

describe("a report's stored PDF", () => {
  const HASH = `sha256:${"a".repeat(64)}`;
  const inTenant = <T>(work: (context: TenantContext) => Promise<T>): Promise<T> =>
    db.withTenant(tenant.tenantId, work);

  it("is created PENDING, once per report, and rendered to READY with its file", async () => {
    const report = await succeeded();
    const created = await inTenant(({ repos }) => repos.reportPdfs.create(report.id));
    expect(created).toMatchObject({
      status: "PENDING",
      attempts: 0,
      contentHash: null,
      byteLength: null,
      errorCode: null,
    });
    // ensure() returns the existing row unchanged rather than creating a second.
    const ensured = await inTenant(({ repos }) => repos.reportPdfs.ensure(report.id));
    expect(ensured).toEqual(created);

    await inTenant(({ repos }) =>
      repos.reportPdfs.transition(report.id, {
        status: "RENDERING",
        attempts: 1,
        startedAt: new Date(),
      }),
    );
    const ready = await inTenant(({ repos }) =>
      repos.reportPdfs.transition(report.id, {
        status: "READY",
        file: { contentHash: HASH, byteLength: 1234 },
        finishedAt: new Date(),
      }),
    );
    expect(ready).toMatchObject({ status: "READY", contentHash: HASH, byteLength: 1234 });
  });

  it("REGRESSION guard: keeps a stored file and a finished status, whatever a retry writes", async () => {
    const report = await succeeded();
    await inTenant(async ({ repos }) => {
      await repos.reportPdfs.create(report.id);
      await repos.reportPdfs.transition(report.id, {
        status: "READY",
        file: { contentHash: HASH, byteLength: 10 },
      });
    });
    await expect(
      inTenant(({ repos }) =>
        repos.reportPdfs.transition(report.id, {
          file: { contentHash: `sha256:${"b".repeat(64)}`, byteLength: 10 },
        }),
      ),
    ).rejects.toBeInstanceOf(ReportRecordedOnceError);
    await expect(
      inTenant(({ repos }) =>
        repos.reportPdfs.transition(report.id, {
          status: "FAILED",
          error: { code: "[code]", message: "[message]" },
        }),
      ),
    ).rejects.toBeInstanceOf(ReportRecordedOnceError);

    const failed = await succeeded();
    await inTenant(async ({ repos }) => {
      await repos.reportPdfs.create(failed.id);
      await repos.reportPdfs.transition(failed.id, {
        status: "FAILED",
        error: { code: "[code]", message: "[message]" },
      });
    });
    await expect(
      inTenant(({ repos }) =>
        repos.reportPdfs.transition(failed.id, { status: "PENDING", error: null }),
      ),
    ).rejects.toBeInstanceOf(ReportRecordedOnceError);
  });

  it("holds a file exactly when READY, and an error exactly when FAILED", async () => {
    const report = await succeeded();
    await inTenant(({ repos }) => repos.reportPdfs.create(report.id));
    for (const change of [
      { status: "READY" as const },
      { status: "RENDERING" as const, file: { contentHash: HASH, byteLength: 10 } },
      { status: "FAILED" as const },
      { status: "READY" as const, file: { contentHash: "sha256:not-a-hash", byteLength: 10 } },
      { status: "READY" as const, file: { contentHash: HASH, byteLength: 0 } },
    ]) {
      await expect(
        inTenant(({ repos }) => repos.reportPdfs.transition(report.id, change)),
      ).rejects.toBeInstanceOf(ConstraintViolationError);
    }
  });

  it("lets the application move only the render lifecycle columns", async () => {
    const report = await succeeded();
    await inTenant(({ repos }) => repos.reportPdfs.create(report.id));
    const runtime = await rawClient(TEST_DATABASE.runtimeUrl);
    try {
      const state = await asTenant(runtime, tenant.tenantId, () =>
        sqlStateOf(() =>
          runtime.query("update public.report_pdfs set report_id = $1 where report_id = $1", [
            report.id,
          ]),
        ),
      );
      expect(state).toBe("42501");
    } finally {
      await runtime.end();
    }
  });
});

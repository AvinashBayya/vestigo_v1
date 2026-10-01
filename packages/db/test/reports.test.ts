/**
 * The database's guarantees under Phase 5 reports: a report's document is
 * written once and only with SUCCEEDED; a finished report keeps its status,
 * whatever role writes it; a generation attempt's token usage is charged
 * once; and a tenant's handling marking stays within its bounds.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../src/database.ts";
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
      }),
    );
    expect(secondAttempt).toBe(true);
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

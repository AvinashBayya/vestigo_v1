/**
 * RELEASE-BLOCKING in part. The database's guarantees under the Phase 4 job
 * system: a job enqueued twice is one row; an attempt's usage is recorded
 * once; what a job recorded (its FOUND outcome, result, evidence and fusion)
 * is never replaced, whatever role writes it; quotas are read-only to the
 * application; and an identifier resolves to one entity.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../src/database.ts";
import { ConstraintViolationError, JobRecordedOnceError } from "../src/errors.ts";
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
  tenant = await createTenantFixture(db, "jobs");
});

afterAll(async () => {
  await db.close();
});

function newJob(key: string) {
  return {
    runId: tenant.runId,
    collectorId: tenant.collectorId,
    idempotencyKey: key,
    status: "QUEUED" as const,
    targetType: "DOMAIN" as const,
    target: "example.com",
  };
}

describe("idempotent job creation", () => {
  it("creates a job once; a second enqueue under the same key returns the same row", async () => {
    const first = await db.withTenant(tenant.tenantId, ({ repos }) =>
      repos.jobs.createOrFind(newJob("idempotent:1")),
    );
    const second = await db.withTenant(tenant.tenantId, ({ repos }) =>
      repos.jobs.createOrFind(newJob("idempotent:1")),
    );
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.job.id).toBe(first.job.id);
  });

  it("concurrent enqueues under one key land on one row", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        db.withTenant(tenant.tenantId, ({ repos }) =>
          repos.jobs.createOrFind(newJob("idempotent:concurrent")),
        ),
      ),
    );
    expect(new Set(results.map((r) => r.job.id)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
  });

  it("a job's target is both type and value, or neither", async () => {
    await expect(
      db.withTenant(tenant.tenantId, ({ repos }) =>
        repos.jobs.create({
          runId: tenant.runId,
          collectorId: tenant.collectorId,
          idempotencyKey: "half-target",
          status: "QUEUED",
          targetType: "DOMAIN",
        }),
      ),
    ).rejects.toBeInstanceOf(ConstraintViolationError);
  });
});

describe("usage is recorded once per attempt (RELEASE-BLOCKING)", () => {
  it("records an attempt's units once; a replayed record charges nothing", async () => {
    const { job } = await db.withTenant(tenant.tenantId, ({ repos }) =>
      repos.jobs.createOrFind(newJob("usage:1")),
    );
    const record = () =>
      db.withTenant(tenant.tenantId, ({ repos }) =>
        repos.usageEvents.recordAttempt({
          unit: "UPSTREAM_REQUEST",
          quantity: 3,
          collectorId: tenant.collectorId,
          jobId: job.id,
          attempt: 1,
        }),
      );
    expect(await record()).toBe(true);
    expect(await record()).toBe(false);
    const next = await db.withTenant(tenant.tenantId, ({ repos }) =>
      repos.usageEvents.recordAttempt({
        unit: "UPSTREAM_REQUEST",
        quantity: 2,
        collectorId: tenant.collectorId,
        jobId: job.id,
        attempt: 2,
      }),
    );
    expect(next).toBe(true);
    const total = await db.withTenant(tenant.tenantId, ({ repos }) =>
      repos.usageEvents.totalSince("UPSTREAM_REQUEST", new Date(0)),
    );
    expect(total).toBe(5);
  });

  it("totals a unit nothing consumed as a measured zero", async () => {
    const total = await db.withTenant(tenant.tenantId, ({ repos }) =>
      repos.usageEvents.totalSince("SEARCH_QUERY", new Date(0)),
    );
    expect(total).toBe(0);
  });
});

describe("what a job recorded is written once (RELEASE-BLOCKING)", () => {
  async function foundJob(key: string) {
    return db.withTenant(tenant.tenantId, async ({ repos }) => {
      const { job } = await repos.jobs.createOrFind(newJob(key));
      const done = await repos.jobs.transition(job.id, {
        status: "SUCCEEDED",
        outcome: "FOUND",
        result: { reported: "[value]" },
        evidenceIds: [tenant.evidenceId],
      });
      if (done === null) throw new Error("fixture job was not updated");
      return done;
    });
  }

  it.each([
    ["result", { result: { reported: "[replaced]" } }],
    ["evidence", { evidenceIds: [] as string[] }],
    ["outcome", { outcome: "NOT_FOUND" as const }],
  ])("refuses to replace a FOUND job's %s", async (name, change) => {
    const job = await foundJob(`once:${name}`);
    await expect(
      db.withTenant(tenant.tenantId, ({ repos }) =>
        repos.jobs.transition(job.id, { status: "SUCCEEDED", ...change }),
      ),
    ).rejects.toBeInstanceOf(JobRecordedOnceError);
  });

  it("fuses a job once", async () => {
    const job = await foundJob("once:fused");
    await db.withTenant(tenant.tenantId, ({ repos }) =>
      repos.jobs.transition(job.id, { status: "SUCCEEDED", fusedAt: new Date() }),
    );
    await expect(
      db.withTenant(tenant.tenantId, ({ repos }) =>
        repos.jobs.transition(job.id, { status: "SUCCEEDED", fusedAt: new Date() }),
      ),
    ).rejects.toBeInstanceOf(JobRecordedOnceError);
  });

  it("holds for the schema owner too, beneath the application", async () => {
    const job = await foundJob("once:owner");
    const owner = await rawClient(TEST_DATABASE.ownerUrl);
    try {
      const state = await asTenant(owner, tenant.tenantId, () =>
        sqlStateOf(() =>
          owner.query(`update public.jobs set result = '{"forged": true}' where id = $1`, [job.id]),
        ),
      );
      expect(state).toBe("JOB01");
    } finally {
      await owner.end();
    }
  });

  it("allows a result only with a FOUND outcome", async () => {
    const { job } = await db.withTenant(tenant.tenantId, ({ repos }) =>
      repos.jobs.createOrFind(newJob("once:not-found-result")),
    );
    await expect(
      db.withTenant(tenant.tenantId, ({ repos }) =>
        repos.jobs.transition(job.id, {
          status: "SUCCEEDED",
          outcome: "NOT_FOUND",
          result: { invented: true },
        }),
      ),
    ).rejects.toBeInstanceOf(ConstraintViolationError);
  });

  it("keeps what came back empty for a not-found and for an unconfirmed empty answer, and for nothing else (Track M Day 2)", async () => {
    for (const outcome of ["NOT_FOUND", "EMPTY_UNCONFIRMED"] as const) {
      const done = await db.withTenant(tenant.tenantId, async ({ repos }) => {
        const { job } = await repos.jobs.createOrFind(newJob(`detail:${outcome}`));
        return repos.jobs.transition(job.id, {
          status: "SUCCEEDED",
          outcome,
          outcomeDetail: "[what came back empty]",
        });
      });
      expect([done?.outcome, done?.outcomeDetail, done?.result, done?.evidenceIds]).toEqual([
        outcome,
        "[what came back empty]",
        null,
        null,
      ]);
    }
    for (const outcome of ["FOUND", "FAILED", "UNAVAILABLE"] as const) {
      await expect(
        db.withTenant(tenant.tenantId, async ({ repos }) => {
          const { job } = await repos.jobs.createOrFind(newJob(`detail:refused:${outcome}`));
          return repos.jobs.transition(job.id, {
            status: outcome === "FOUND" ? "SUCCEEDED" : "FAILED",
            outcome,
            outcomeDetail: "[a detail no empty answer gave]",
          });
        }),
        outcome,
      ).rejects.toBeInstanceOf(ConstraintViolationError);
    }
  });
});

describe("quotas are set by operators only", () => {
  it("the application reads its quota, and cannot insert or change one", async () => {
    const quota = await db.withTenant(tenant.tenantId, ({ repos }) =>
      repos.tenantQuotas.find("UPSTREAM_REQUEST", "DAY"),
    );
    expect(quota?.maxQuantity).toBe(1000);
    const runtime = await rawClient();
    try {
      for (const statement of [
        `insert into public.tenant_quotas (tenant_id, unit, period, max_quantity)
         values ($1, 'SEARCH_QUERY', 'DAY', 5)`,
        `update public.tenant_quotas set max_quantity = 999999 where tenant_id = $1`,
        `delete from public.tenant_quotas where tenant_id = $1`,
      ]) {
        const state = await asTenant(runtime, tenant.tenantId, () =>
          sqlStateOf(() => runtime.query(statement, [tenant.tenantId])),
        );
        expect(state, statement).toBe("42501");
      }
    } finally {
      await runtime.end();
    }
  });

  it("a tenant with no quota for a unit has none", async () => {
    const quota = await db.withTenant(tenant.tenantId, ({ repos }) =>
      repos.tenantQuotas.find("SEARCH_QUERY", "MONTH"),
    );
    expect(quota).toBeNull();
  });

  it("refuses a negative quota", async () => {
    const owner = await rawClient(TEST_DATABASE.ownerUrl);
    try {
      const state = await asTenant(owner, tenant.tenantId, () =>
        sqlStateOf(() =>
          owner.query(
            `insert into public.tenant_quotas (tenant_id, unit, period, max_quantity)
             values ($1, 'API_CREDIT', 'MONTH', -1)`,
            [tenant.tenantId],
          ),
        ),
      );
      expect(state).toBe("23514");
    } finally {
      await owner.end();
    }
  });
});

describe("an identifier resolves to one entity", () => {
  it("returns the same entity for the same kind and identifier, concurrently", async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        db.withTenant(tenant.tenantId, ({ repos }) =>
          repos.entities.resolveByIdentifier({
            kind: "IP_ADDRESS",
            identifier: "192.0.2.10",
            displayName: "192.0.2.10",
          }),
        ),
      ),
    );
    expect(new Set(results.map((r) => r.entity.id)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
  });

  it("keeps kinds apart: one identifier under two kinds is two entities", async () => {
    const [asDomain, asUsername] = await db.withTenant(tenant.tenantId, async ({ repos }) => [
      await repos.entities.resolveByIdentifier({
        kind: "DOMAIN",
        identifier: "example.net",
        displayName: "example.net",
      }),
      await repos.entities.resolveByIdentifier({
        kind: "USERNAME",
        identifier: "example.net",
        displayName: "example.net",
      }),
    ]);
    expect(asDomain.entity.id).not.toBe(asUsername.entity.id);
  });

  it("never identifies a person or organisation by a bare name", async () => {
    for (const kind of ["PERSON", "ORGANIZATION"] as const) {
      await expect(
        db.withTenant(tenant.tenantId, ({ repos }) =>
          repos.entities.resolveByIdentifier({
            kind,
            identifier: "[Some Name]",
            displayName: "[Some Name]",
          }),
        ),
      ).rejects.toBeInstanceOf(ConstraintViolationError);
    }
    const external = await db.withTenant(tenant.tenantId, ({ repos }) =>
      repos.entities.resolveByIdentifier({
        kind: "ORGANIZATION",
        identifier: "wikidata:Q0",
        displayName: "[Organisation]",
      }),
    );
    expect(external.created).toBe(true);
  });
});

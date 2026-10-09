/**
 * RELEASE-BLOCKING. The database's guarantees under case analyses (R1-b): one
 * analysis per case and input; an analysis, and every record of where it
 * stands, written once, whatever role writes it; events only in order
 * (requested, then one finish, a retry only after a failure, nothing after a
 * document); a document only with COMPLETE; no time ever defaulted; and a
 * delete, the future retention path, never blocked by the write-once trigger.
 */
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../src/database.ts";
import {
  CaseAnalysisOutOfOrderError,
  ConstraintViolationError,
  UniqueConflictError,
} from "../src/errors.ts";
import { TEST_DATABASE } from "./config.ts";
import {
  asTenant,
  createTenantFixture,
  openDatabase,
  rawClient,
  sqlStateOf,
  type TenantFixture,
} from "./support.ts";

let db: Database;
let tenant: TenantFixture;

beforeAll(async () => {
  db = openDatabase();
  tenant = await createTenantFixture(db, "case-analyses");
});

afterAll(async () => {
  await db.close();
});

const at = (iso: string): Date => new Date(Date.parse(iso));
let inputs = 0;
const nextHash = (): string => {
  inputs += 1;
  return `sha256:${createHash("sha256")
    .update(`[input ${String(inputs)}]`)
    .digest("hex")}`;
};
const DOCUMENT = { kind: "[fixture document]" };
const WORDING = { kind: "[fixture wording]" };

async function newAnalysis(inputHash = nextHash()) {
  return db.withTenant(tenant.tenantId, ({ repos }) =>
    repos.caseAnalyses.findOrCreate({
      caseId: tenant.caseId,
      inputHash,
      engineVersion: 3,
      requestedByUserId: tenant.userId,
      requestedAt: at("2026-10-09T12:00:00.000Z"),
      basis: { evidenceIds: [tenant.evidenceId], runIds: [tenant.runId] },
    }),
  );
}

async function requested(attempt = 1) {
  const { analysis } = await newAnalysis();
  await db.withTenant(tenant.tenantId, ({ repos }) =>
    repos.caseAnalysisEvents.request({
      analysisId: analysis.id,
      attempt,
      requestedByUserId: tenant.userId,
      at: at("2026-10-09T12:00:00.000Z"),
    }),
  );
  return analysis;
}

async function completed() {
  const analysis = await requested();
  await db.withTenant(tenant.tenantId, ({ repos }) =>
    repos.caseAnalysisEvents.complete({
      analysisId: analysis.id,
      attempt: 1,
      document: DOCUMENT,
      wording: WORDING,
      at: at("2026-10-09T12:00:05.000Z"),
    }),
  );
  return analysis;
}

describe("one analysis per case and input (RELEASE-BLOCKING)", () => {
  it("returns the existing analysis for the same input, and creates none", async () => {
    const hash = nextHash();
    const first = await newAnalysis(hash);
    const second = await newAnalysis(hash);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.analysis.id).toBe(first.analysis.id);
  });

  it("lands two concurrent requests for the same input on one row", async () => {
    const hash = nextHash();
    const results = await Promise.all([newAnalysis(hash), newAnalysis(hash)]);
    expect(new Set(results.map((result) => result.analysis.id)).size).toBe(1);
    expect(results.filter((result) => result.created)).toHaveLength(1);
  });

  it("refuses an input hash that is not sha256 hex", async () => {
    await expect(newAnalysis("sha256:not-hex")).rejects.toBeInstanceOf(ConstraintViolationError);
  });
});

describe("events in order (RELEASE-BLOCKING)", () => {
  it("refuses a finish with no request", async () => {
    const { analysis } = await newAnalysis();
    await expect(
      db.withTenant(tenant.tenantId, ({ repos }) =>
        repos.caseAnalysisEvents.complete({
          analysisId: analysis.id,
          attempt: 1,
          document: DOCUMENT,
          wording: WORDING,
          at: at("2026-10-09T12:00:05.000Z"),
        }),
      ),
    ).rejects.toBeInstanceOf(CaseAnalysisOutOfOrderError);
  });

  it("refuses a retry before the attempt failed, and a first request numbered past 1", async () => {
    const pending = await requested();
    await expect(
      db.withTenant(tenant.tenantId, ({ repos }) =>
        repos.caseAnalysisEvents.request({
          analysisId: pending.id,
          attempt: 2,
          requestedByUserId: null,
          at: at("2026-10-09T12:00:01.000Z"),
        }),
      ),
    ).rejects.toBeInstanceOf(CaseAnalysisOutOfOrderError);
    const { analysis } = await newAnalysis();
    await expect(
      db.withTenant(tenant.tenantId, ({ repos }) =>
        repos.caseAnalysisEvents.request({
          analysisId: analysis.id,
          attempt: 2,
          requestedByUserId: null,
          at: at("2026-10-09T12:00:01.000Z"),
        }),
      ),
    ).rejects.toBeInstanceOf(CaseAnalysisOutOfOrderError);
  });

  it("refuses a second request or a second finish of one attempt", async () => {
    const pending = await requested();
    await expect(
      db.withTenant(tenant.tenantId, ({ repos }) =>
        repos.caseAnalysisEvents.request({
          analysisId: pending.id,
          attempt: 1,
          requestedByUserId: null,
          at: at("2026-10-09T12:00:01.000Z"),
        }),
      ),
    ).rejects.toBeInstanceOf(UniqueConflictError);
    const done = await completed();
    await expect(
      db.withTenant(tenant.tenantId, ({ repos }) =>
        repos.caseAnalysisEvents.fail({
          analysisId: done.id,
          attempt: 1,
          error: { code: "LATE", message: "[late failure]" },
          at: at("2026-10-09T12:00:09.000Z"),
        }),
      ),
    ).rejects.toBeInstanceOf(UniqueConflictError);
  });

  it("accepts a retry after a failure, and nothing after a document", async () => {
    const analysis = await requested();
    await db.withTenant(tenant.tenantId, async ({ repos }) => {
      await repos.caseAnalysisEvents.fail({
        analysisId: analysis.id,
        attempt: 1,
        error: { code: "CASE_ANALYSIS_TIMEOUT", message: "[timed out]" },
        at: at("2026-10-09T12:00:02.000Z"),
      });
      await repos.caseAnalysisEvents.request({
        analysisId: analysis.id,
        attempt: 2,
        requestedByUserId: tenant.userId,
        at: at("2026-10-09T12:00:03.000Z"),
      });
      await repos.caseAnalysisEvents.complete({
        analysisId: analysis.id,
        attempt: 2,
        document: DOCUMENT,
        wording: WORDING,
        at: at("2026-10-09T12:00:04.000Z"),
      });
    });
    const standing = await db.withTenant(tenant.tenantId, ({ repos }) =>
      repos.caseAnalysisEvents.standing(analysis.id),
    );
    expect(standing).toMatchObject({ attempt: 2, status: "COMPLETE" });
    await expect(
      db.withTenant(tenant.tenantId, ({ repos }) =>
        repos.caseAnalysisEvents.request({
          analysisId: analysis.id,
          attempt: 3,
          requestedByUserId: null,
          at: at("2026-10-09T12:00:05.000Z"),
        }),
      ),
    ).rejects.toBeInstanceOf(CaseAnalysisOutOfOrderError);
  });
});

describe("what an event holds (RELEASE-BLOCKING)", () => {
  it("holds a document and its wording only with COMPLETE, and an error only with FAILED", async () => {
    const analysis = await requested();
    const runtime = await rawClient(TEST_DATABASE.runtimeUrl);
    try {
      const states = await asTenant(runtime, tenant.tenantId, async () => {
        const tryInsert = (columns: string, values: string) =>
          sqlStateOf(async () => {
            await runtime.query("savepoint s");
            try {
              await runtime.query(
                `insert into public.case_analysis_events (tenant_id, analysis_id, attempt, ${columns}, occurred_at)
                 values ($1, $2, 1, ${values}, now())`,
                [tenant.tenantId, analysis.id],
              );
            } finally {
              await runtime.query("rollback to savepoint s");
            }
          });
        return [
          await tryInsert("status, document", `'FAILED', '{}'::jsonb`),
          await tryInsert("status, document, wording", `'COMPLETE', '{}'::jsonb, null`),
          await tryInsert("status, error_code, error_message", `'COMPLETE', 'X', 'y'`),
          await tryInsert("status, error_code, error_message", `'FAILED', ' ', 'y'`),
          await tryInsert("status, requested_by_user_id", `'FAILED', '${tenant.userId}'`),
        ];
      });
      expect(states).toEqual(["23514", "23514", "23514", "23514", "23514"]);
    } finally {
      await runtime.end();
    }
  });

  it("never defaults a time: a request and an event each need theirs", async () => {
    const runtime = await rawClient(TEST_DATABASE.runtimeUrl);
    try {
      const states = await asTenant(runtime, tenant.tenantId, async () => [
        await sqlStateOf(() =>
          runtime.query(
            `insert into public.case_analyses (tenant_id, case_id, input_hash, engine_version)
             values ($1, $2, $3, 3)`,
            [tenant.tenantId, tenant.caseId, nextHash()],
          ),
        ),
      ]);
      expect(states).toEqual(["23502"]);
    } finally {
      await runtime.end();
    }
  });
});

describe("what an analysis rests on (RELEASE-BLOCKING)", () => {
  it("records the evidence and runs of its input with the request, as given", async () => {
    const { analysis } = await newAnalysis();
    expect(analysis.basisEvidenceIds).toEqual([tenant.evidenceId]);
    expect(analysis.basisRunIds).toEqual([tenant.runId]);
  });

  it("refuses a basis that is not ids, and a row with half a basis", async () => {
    const malformed = await db
      .withTenant(tenant.tenantId, ({ repos }) =>
        repos.caseAnalyses.findOrCreate({
          caseId: tenant.caseId,
          inputHash: nextHash(),
          engineVersion: 3,
          requestedByUserId: null,
          requestedAt: at("2026-10-09T12:00:00.000Z"),
          basis: { evidenceIds: ["[not an id]"], runIds: [] },
        }),
      )
      .catch((error: unknown) => error);
    expect(malformed).toMatchObject({ code: "INVALID_IDENTIFIER" });
    const owner = await rawClient(TEST_DATABASE.ownerUrl);
    try {
      const state = await asTenant(owner, tenant.tenantId, () =>
        sqlStateOf(async () => {
          await owner.query(
            `insert into public.case_analyses
               (tenant_id, case_id, input_hash, engine_version, requested_at, basis_evidence_ids, basis_run_ids)
             values ($1, $2, $3, 3, now(), '{}', null)`,
            [tenant.tenantId, tenant.caseId, nextHash()],
          );
        }),
      );
      expect(state).toBe("23514");
    } finally {
      await owner.end();
    }
  });
});

describe("written once, whatever role writes (RELEASE-BLOCKING)", () => {
  it("gives the application no UPDATE or DELETE on either table", async () => {
    const analysis = await completed();
    const runtime = await rawClient(TEST_DATABASE.runtimeUrl);
    try {
      const states = await asTenant(runtime, tenant.tenantId, async () => {
        const attempt = (statement: string) =>
          sqlStateOf(async () => {
            await runtime.query("savepoint s");
            try {
              await runtime.query(statement, [analysis.id]);
            } finally {
              await runtime.query("rollback to savepoint s");
            }
          });
        return [
          await attempt(`update public.case_analyses set engine_version = 99 where id = $1`),
          await attempt(`delete from public.case_analyses where id = $1`),
          await attempt(
            `update public.case_analysis_events set document = '{"forged": true}' where analysis_id = $1`,
          ),
          await attempt(`delete from public.case_analysis_events where analysis_id = $1`),
        ];
      });
      expect(states).toEqual(["42501", "42501", "42501", "42501"]);
    } finally {
      await runtime.end();
    }
  });

  it("refuses the schema owner an edit of an analysis or an event, and a truncate", async () => {
    const analysis = await completed();
    const owner = await rawClient(TEST_DATABASE.ownerUrl);
    try {
      const states = await asTenant(owner, tenant.tenantId, async () => {
        const attempt = (statement: string, params: unknown[] = [analysis.id]) =>
          sqlStateOf(async () => {
            await owner.query("savepoint s");
            try {
              await owner.query(statement, params);
            } finally {
              await owner.query("rollback to savepoint s");
            }
          });
        return [
          await attempt(`update public.case_analyses set input_hash = input_hash where id = $1`),
          await attempt(`update public.case_analyses set basis_run_ids = '{}' where id = $1`),
          await attempt(
            `update public.case_analysis_events set document = '{"forged": true}' where analysis_id = $1`,
          ),
          // A statement-level trigger: refused even when no row matches.
          await attempt(`update public.case_analysis_events set attempt = attempt where false`, []),
          await attempt(`truncate public.case_analysis_events, public.case_analyses`, []),
        ];
      });
      expect(states).toEqual(["CAN01", "CAN01", "CAN01", "CAN01", "CAN01"]);
    } finally {
      await owner.end();
    }
  });

  it("never blocks a delete: the owner removing an analysis with its events succeeds", async () => {
    // The future retention path (CLAUDE.md §9): rolled back here, so the rows stay.
    const analysis = await completed();
    const owner = await rawClient(TEST_DATABASE.ownerUrl);
    try {
      const removed = await asTenant(owner, tenant.tenantId, async () => {
        const events = await owner.query(
          `delete from public.case_analysis_events where analysis_id = $1`,
          [analysis.id],
        );
        const rows = await owner.query(`delete from public.case_analyses where id = $1`, [
          analysis.id,
        ]);
        return [events.rowCount, rows.rowCount];
      });
      expect(removed).toEqual([2, 1]);
    } finally {
      await owner.end();
    }
    const still = await db.withTenant(tenant.tenantId, ({ repos }) =>
      repos.caseAnalyses.findById(analysis.id),
    );
    expect(still?.id).toBe(analysis.id);
  });
});

/**
 * RELEASE-BLOCKING. The audit log cannot be updated or deleted, by grant for
 * the application role and by trigger for every role. Evidence cannot be
 * updated, and a missing observed_at stays null.
 */
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashContent, contentRef } from "../src/content-store.ts";
import type { Database } from "../src/database.ts";
import { TEST_DATABASE } from "./config.ts";
import {
  asTenant,
  createTenantFixture,
  FIXTURE_COLLECTOR_ID,
  openDatabase,
  rawClient,
  sqlStateOf,
  type TenantFixture,
} from "./support.ts";

const INSUFFICIENT_PRIVILEGE = "42501";
const APPEND_ONLY = "APP01";

let db: Database;
let runtime: pg.Client;
let owner: pg.Client;
let tenant: TenantFixture;

beforeAll(async () => {
  db = openDatabase();
  tenant = await createTenantFixture(db, "log");
  runtime = await rawClient(TEST_DATABASE.runtimeUrl);
  owner = await rawClient(TEST_DATABASE.ownerUrl);
});

afterAll(async () => {
  await runtime.end();
  await owner.end();
  await db.close();
});

describe("audit log is insert-only (RELEASE-BLOCKING)", () => {
  it.each([
    ["UPDATE", "update public.audit_log set action = 'tampered.action' where id = $1"],
    ["DELETE", "delete from public.audit_log where id = $1"],
  ])("the application role cannot %s an audit row: no grant", async (_verb, statement) => {
    const state = await asTenant(runtime, tenant.tenantId, () =>
      sqlStateOf(() => runtime.query(statement, [tenant.auditEntryId])),
    );
    expect(state).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it("the application role cannot TRUNCATE the audit log", async () => {
    const state = await asTenant(runtime, tenant.tenantId, () =>
      sqlStateOf(() => runtime.query("truncate public.audit_log")),
    );
    expect(state).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it.each([
    ["UPDATE", "update public.audit_log set action = 'tampered.action' where id = $1"],
    ["DELETE", "delete from public.audit_log where id = $1"],
  ])(
    "even the schema owner cannot %s an audit row: the trigger refuses",
    async (_verb, statement) => {
      const state = await asTenant(owner, tenant.tenantId, () =>
        sqlStateOf(() => owner.query(statement, [tenant.auditEntryId])),
      );
      expect(state).toBe(APPEND_ONLY);
    },
  );

  it("even the schema owner cannot TRUNCATE the audit log", async () => {
    const state = await asTenant(owner, tenant.tenantId, () =>
      sqlStateOf(() => owner.query("truncate public.audit_log")),
    );
    expect(state).toBe(APPEND_ONLY);
  });

  it("the audit row is intact afterwards", async () => {
    const entry = await db.withTenant(tenant.tenantId, ({ repos }) =>
      repos.auditLog.findById(tenant.auditEntryId),
    );
    expect(entry?.action).toBe("fixture.create");
  });

  it("the repository offers no way to update or delete", async () => {
    await db.withTenant(tenant.tenantId, ({ repos }) => {
      expect("update" in repos.auditLog).toBe(false);
      expect("delete" in repos.auditLog).toBe(false);
      return Promise.resolve();
    });
  });
});

describe("evidence is append-only and keeps unknown timestamps unknown (RELEASE-BLOCKING)", () => {
  const payload = new TextEncoder().encode("[evidence timestamp test payload]");
  const contentHash = hashContent(payload);

  it("a missing observed_at stays null after a round trip through the repository", async () => {
    const collectedAt = new Date("2026-09-25T10:00:00.000Z");
    const { recorded, reread } = await db.withTenant(tenant.tenantId, async ({ repos }) => {
      const recorded = await repos.evidence.record({
        collectorId: FIXTURE_COLLECTOR_ID,
        collectorVersion: "0.0.0-test",
        jobId: null,
        sourceUrl: null,
        contentHash,
        payloadRef: contentRef(tenant.tenantId, contentHash),
        observedAt: null,
        collectedAt,
        claimStrength: "REPORTED",
      });
      return { recorded, reread: await repos.evidence.findById(recorded.id) };
    });

    expect(recorded.observedAt).toBeNull();
    expect(reread?.observedAt).toBeNull();
    // Never filled from collected_at, nor from the clock.
    expect(reread?.collectedAt?.toISOString()).toBe(collectedAt.toISOString());
    expect(reread?.claimStrength).toBe("REPORTED");
  });

  it("a missing collected_at stays null too", async () => {
    const reread = await db.withTenant(tenant.tenantId, async ({ repos }) => {
      const recorded = await repos.evidence.record({
        collectorId: FIXTURE_COLLECTOR_ID,
        collectorVersion: "0.0.0-test",
        jobId: null,
        sourceUrl: null,
        contentHash,
        payloadRef: contentRef(tenant.tenantId, contentHash),
        observedAt: null,
        collectedAt: null,
        claimStrength: "HYPOTHESIS",
      });
      return repos.evidence.findById(recorded.id);
    });
    expect(reread?.observedAt).toBeNull();
    expect(reread?.collectedAt).toBeNull();
    expect(reread?.createdAt).toBeInstanceOf(Date);
  });

  it("the id is a UUIDv7 whose timestamp is created_at, stored in that month's partition", async () => {
    const result = await asTenant(owner, tenant.tenantId, () =>
      owner.query<{ version: string; matches: boolean; partition: string; expected: string }>(
        `select substr(id::text, 15, 1) as version,
                created_at = app.uuid_v7_timestamp(id) as matches,
                tableoid::regclass::text as partition,
                'evidence_partitions.evidence_' || to_char(created_at at time zone 'UTC', 'YYYY_MM') as expected
         from public.evidence where id = $1`,
        [tenant.evidenceId],
      ),
    );
    const row = result.rows[0];
    expect(row?.version).toBe("7");
    expect(row?.matches).toBe(true);
    expect(row?.partition).toBe(row?.expected);
  });

  it("the application role cannot update or delete evidence: no grant", async () => {
    for (const statement of [
      "update public.evidence set claim_strength = 'OBSERVED' where id = $1",
      "delete from public.evidence where id = $1",
    ]) {
      const state = await asTenant(runtime, tenant.tenantId, () =>
        sqlStateOf(() => runtime.query(statement, [tenant.evidenceId])),
      );
      expect(state, statement).toBe(INSUFFICIENT_PRIVILEGE);
    }
  });

  it("even the schema owner cannot update evidence: the trigger refuses", async () => {
    const state = await asTenant(owner, tenant.tenantId, () =>
      sqlStateOf(() =>
        owner.query("update public.evidence set claim_strength = 'OBSERVED' where id = $1", [
          tenant.evidenceId,
        ]),
      ),
    );
    expect(state).toBe(APPEND_ONLY);
  });

  it("claim strength accepts only the six labels", async () => {
    const state = await asTenant(runtime, tenant.tenantId, () =>
      sqlStateOf(() =>
        runtime.query(
          `insert into public.evidence (tenant_id, collector_id, collector_version, content_hash, payload_ref, claim_strength)
           values ($1, $2, '0.0.0-test', $3, 'x', 'CERTAIN')`,
          [tenant.tenantId, FIXTURE_COLLECTOR_ID, contentHash],
        ),
      ),
    );
    expect(state).toBe("22P02");
  });
});

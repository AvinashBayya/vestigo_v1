/**
 * RELEASE-BLOCKING (D-35, D-36). The person probe still finds person data at
 * the deepest hop, whether a claim about an entity or about a relationship
 * carries it, on a tenant large enough that the probe before D-35 ran out of
 * time (buildProbeGraph). Here it must answer inside a 2 s statement timeout:
 * on this graph the probe before D-35 took 5 to 14 s with JIT off, and longer
 * with it (docs/PLAN.md, D-35 and D-36). The graph store and the probe take
 * their walk from the one reachCte, so the graph a read shows and the set the
 * probe checks cannot differ.
 */
import { readdirSync, readFileSync } from "node:fs";
import type { TenantId } from "@repo/core";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { requireLiveTransaction } from "../src/scope.ts";
import { buildProbeGraph, PROBE_GRAPH_DOMAINS, type ProbeGraphCounts } from "../src/testing.ts";
import { TEST_DATABASE } from "./config.ts";
import { newTenantId, openDatabase } from "./support.ts";

/** Building and analysing the graph is slow by design, more so beside the other suites. */
const SETUP_TIMEOUT_MS = 180_000;

/** The time the probe must answer within on this graph. */
const PROBE_TIME_LIMIT_MS = 2_000;

let db: Database;
let tenantId: TenantId;
let entityCaseId: string;
let relationshipCaseId: string;
let counts: ProbeGraphCounts;

beforeAll(async () => {
  const setup = openDatabase();
  tenantId = newTenantId();
  await setup.provisionTenant({ tenantId, name: "[Tenant probe depth]", region: "IN" });
  const made = await setup.withTenant(tenantId, async ({ repos }) => {
    const register = (collectorId: string, discipline: "TECHINT" | "PERSON") =>
      repos.collectorsRegistry.register({
        collectorId,
        sourceLabel: `[${collectorId} fixture]`,
        discipline,
        collectionMode: "LOCAL_ANALYSIS",
        dataLicence: "[not applicable: test fixture]",
        commercialUse: "UNVERIFIED",
        enabled: true,
        disabledReason: null,
      });
    await register("depth-technical", "TECHINT");
    await register("depth-person", "PERSON");
    const record = (collectorId: string, hash: string) =>
      repos.evidence.record({
        collectorId,
        collectorVersion: "0.0.0-test",
        jobId: null,
        sourceUrl: null,
        contentHash: `sha256:${hash.repeat(32)}`,
        payloadRef: "[depth payload]",
        observedAt: null,
        collectedAt: null,
        claimStrength: "REPORTED",
      });
    const caseFor = (title: string) =>
      repos.cases.create({ title, description: null, createdByUserId: null });
    return {
      technical: await record("depth-technical", "d1"),
      person: await record("depth-person", "e2"),
      entityCase: await caseFor("[Case: person entity three out]"),
      relationshipCase: await caseFor("[Case: person relationship three out]"),
    };
  });
  await setup.close();
  entityCaseId = made.entityCase.id;
  relationshipCaseId = made.relationshipCase.id;
  counts = await buildProbeGraph({
    runtimeUrl: TEST_DATABASE.runtimeUrl,
    ownerUrl: TEST_DATABASE.ownerUrl,
    tenantId,
    technicalEvidenceId: made.technical.id,
    personEvidenceId: made.person.id,
    entityCaseId,
    relationshipCaseId,
  });
  db = createDatabase({
    connectionString: TEST_DATABASE.runtimeUrl,
    statementTimeoutMs: PROBE_TIME_LIMIT_MS,
    onConnectionError: (error) => {
      console.error("database connection error", error);
    },
  });
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await db.close();
});

const probe = (caseId: string, hops: number) =>
  db.withTenant(tenantId, ({ reads }) =>
    reads.exploration.touchesPersonData({ scopeEntities: { scope: { caseId }, hops } }),
  );

describe("the person probe at the deepest hop, on a large tenant (RELEASE-BLOCKING)", () => {
  it("is the size it was measured at", () => {
    // Domains and their addresses, eight nameservers, seven chain entities and the person;
    // three relationships per domain and eight chain links; a claim on each, and two more.
    expect(counts).toEqual({
      entities: 2 * PROBE_GRAPH_DOMAINS + 16,
      relationships: 3 * PROBE_GRAPH_DOMAINS + 8,
      claims: 5 * PROBE_GRAPH_DOMAINS + 26,
    });
  });

  it("refuses person data on an entity three relationships out, within the time limit, never nearer", async () => {
    // REGRESSION (D-35): the probe before D-35 ran out of time on this graph from one hop.
    const found: boolean[] = [];
    for (const hops of [0, 1, 2, 3]) found.push(await probe(entityCaseId, hops));
    expect(found).toEqual([false, false, false, true]);
  });

  it("refuses person data on a relationship at an entity three relationships out, within the time limit, never nearer", async () => {
    const found: boolean[] = [];
    for (const hops of [0, 1, 2, 3]) found.push(await probe(relationshipCaseId, hops));
    expect(found).toEqual([false, false, false, true]);
  });

  it("puts the JIT setting back after the probe, so the rest of the transaction plans as before", async () => {
    const after = await db.withTenant(tenantId, async ({ scope, reads }) => {
      const tx = requireLiveTransaction(scope);
      await tx.execute(sql`select set_config('jit', 'on', true)`);
      await reads.exploration.touchesPersonData({
        scopeEntities: { scope: { caseId: entityCaseId }, hops: 1 },
      });
      const result = await tx.execute<{ jit: string }>(sql`select current_setting('jit') as jit`);
      return result.rows[0]?.jit;
    });
    expect(after).toBe("on");
  });
});

describe("the one walk (D-36)", () => {
  const repositories = new URL("../src/repositories/", import.meta.url);
  const source = (file: string) => readFileSync(new URL(file, repositories), "utf8");

  it("the graph store and the probe both take their walk from reachCte, and nothing else walks", () => {
    for (const file of ["graph.ts", "exploration.ts"]) {
      expect(source(file), file).toContain("reachCte(");
    }
    const walks = readdirSync(repositories).filter(
      (file) => file.endsWith(".ts") && /reach\(entity_id, hop\) as \(/.test(source(file)),
    );
    expect(walks).toEqual(["walk.ts"]);
  });
});

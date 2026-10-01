import { createHash, randomBytes, randomUUID } from "node:crypto";
import { parseTenantId, type TenantId } from "@repo/core";
import pg from "pg";
import { contentRef, hashContent } from "../src/content-store.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { TEST_DATABASE } from "./config.ts";

export function newTenantId(): TenantId {
  return parseTenantId(randomUUID());
}

export function openDatabase(connectionString: string = TEST_DATABASE.runtimeUrl): Database {
  return createDatabase({
    connectionString,
    onIdleClientError: (error) => {
      console.error("idle database client error", error);
    },
  });
}

/** A raw connection, for tests that must go beneath the repositories. */
export async function rawClient(
  connectionString: string = TEST_DATABASE.runtimeUrl,
): Promise<pg.Client> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  return client;
}

/** Runs `work` in a transaction with the tenant set, then rolls it back. */
export async function asTenant<T>(
  client: pg.Client,
  tenantId: string,
  work: () => Promise<T>,
): Promise<T> {
  await client.query("begin");
  try {
    await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    return await work();
  } finally {
    await client.query("rollback");
  }
}

/** The SQLSTATE of a rejected query, or null if it succeeded. */
export async function sqlStateOf(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string"
    ) {
      return error.code;
    }
    throw error;
  }
}

/** Ids of one row in every table, all belonging to one tenant. */
export interface TenantFixture {
  readonly tenantId: TenantId;
  readonly userId: string;
  readonly apiKeyId: string;
  readonly auditEntryId: string;
  readonly collectorId: string;
  readonly investigationId: string;
  readonly runId: string;
  readonly jobId: string;
  readonly evidenceId: string;
  readonly contentHash: string;
  readonly entityId: string;
  readonly otherEntityId: string;
  readonly mergedEntityId: string;
  readonly relationshipId: string;
  readonly mergeId: string;
  readonly claimId: string;
  readonly caseId: string;
  readonly casePinId: string;
  readonly monitorId: string;
  readonly alertId: string;
  readonly credentialId: string;
  readonly usageEventId: string;
  readonly scopeAuthorisationId: string;
  readonly reportId: string;
  /** An entity resolved by identifier; both fixtures use the same identifier. */
  readonly identifiedEntityId: string;
  /** Written as the schema owner: the application cannot write quotas. */
  readonly tenantQuotaId: string;
}

/** The identifier both tenants' fixtures resolve, so a leak would return the other's row. */
export const SHARED_IDENTIFIER = "shared.example.com";

/** Inserts a quota row as the schema owner, as an operator would. */
async function insertQuotaAsOwner(tenantId: TenantId): Promise<string> {
  const client = await rawClient(TEST_DATABASE.ownerUrl);
  try {
    await client.query("begin");
    await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await client.query<{ id: string }>(
      `insert into public.tenant_quotas (tenant_id, unit, period, max_quantity)
       values ($1, 'UPSTREAM_REQUEST', 'DAY', 1000) returning id`,
      [tenantId],
    );
    await client.query("commit");
    const id = result.rows[0]?.id;
    if (id === undefined) throw new Error("quota fixture was not inserted");
    return id;
  } finally {
    await client.end();
  }
}

export const FIXTURE_COLLECTOR_ID = "fixture";

/**
 * Provisions a tenant and writes one row to every table through the
 * repositories. Values are bracketed placeholders or reserved example.com
 * names (CLAUDE.md §1); nothing here imitates real data.
 */
export async function createTenantFixture(db: Database, tag: string): Promise<TenantFixture> {
  const tenantId = newTenantId();
  await db.provisionTenant({ tenantId, name: `[Tenant ${tag}]`, region: "IN" });

  const rows = await db.withTenant(tenantId, async ({ repos }) => {
    const user = await repos.users.create({
      email: `analyst-${tag}@example.com`,
      displayName: `[Analyst ${tag}]`,
      status: "ACTIVE",
    });
    const apiKey = await repos.apiKeys.create({
      id: randomUUID(),
      name: `[key ${tag}]`,
      keyPrefix: `fx_${tag}_${randomBytes(3).toString("hex")}`,
      keyHash: createHash("sha256").update(randomBytes(32)).digest("hex"),
      createdByUserId: user.id,
      expiresAt: null,
      permissions: ["investigation:read"],
      rotatedFromId: null,
    });
    const audit = await repos.auditLog.append({
      actor: { kind: "USER", userId: user.id },
      action: "fixture.create",
      target: null,
      details: null,
      authorization: { method: "SESSION", permission: "investigation:create", sessionId: null },
      outcome: "ALLOWED",
      requestId: null,
    });
    const collector = await repos.collectorsRegistry.register({
      collectorId: FIXTURE_COLLECTOR_ID,
      sourceLabel: "[Fixture collector]",
      discipline: "TECHINT",
      collectionMode: "LOCAL_ANALYSIS",
      dataLicence: "[not applicable: test fixture]",
      commercialUse: "UNVERIFIED",
      // Enabled: the database refuses evidence from a collector that is not.
      enabled: true,
      disabledReason: null,
    });
    const investigation = await repos.investigations.create({
      title: `[Investigation ${tag}]`,
      target: "example.com",
      createdByUserId: user.id,
    });
    const run = await repos.runs.create({
      investigationId: investigation.id,
      status: "QUEUED",
      requestedByUserId: user.id,
    });
    const job = await repos.jobs.create({
      runId: run.id,
      collectorId: collector.collectorId,
      idempotencyKey: `fixture:${tag}`,
      status: "QUEUED",
    });
    const payload = new TextEncoder().encode(`[fixture payload ${tag}]`);
    const contentHash = hashContent(payload);
    const evidence = await repos.evidence.record({
      collectorId: collector.collectorId,
      collectorVersion: "0.0.0-test",
      jobId: job.id,
      sourceUrl: "https://example.com/",
      contentHash,
      payloadRef: contentRef(tenantId, contentHash),
      observedAt: null,
      collectedAt: null,
      claimStrength: "HYPOTHESIS",
    });
    const entity = await repos.entities.create({ kind: "DOMAIN", displayName: "example.com" });
    const other = await repos.entities.create({ kind: "DOMAIN", displayName: "www.example.com" });
    const identified = await repos.entities.resolveByIdentifier({
      kind: "DOMAIN",
      identifier: SHARED_IDENTIFIER,
      displayName: SHARED_IDENTIFIER,
    });
    const merged = await repos.entities.create({
      kind: "DOMAIN",
      displayName: "[duplicate example.com]",
    });
    const relationship = await repos.entityRelationships.create({
      sourceEntityId: other.id,
      targetEntityId: entity.id,
      kind: "subdomain_of",
    });
    const merge = await repos.entityMerges.merge({
      survivingEntityId: entity.id,
      mergedEntityId: merged.id,
      reason: "[fixture: same registrable domain]",
      confidence: 1,
      matchSignals: ["DOMAIN"],
      decidedBy: { kind: "USER", userId: user.id },
    });
    const claim = await repos.claims.create({
      evidenceId: evidence.id,
      subject: { entityId: entity.id },
      attribute: "registrar",
      value: "[registrar]",
      strength: "HYPOTHESIS",
    });
    const caseRow = await repos.cases.create({
      title: `[Case ${tag}]`,
      description: null,
      createdByUserId: user.id,
    });
    const pin = await repos.casePins.pin({
      caseId: caseRow.id,
      target: { evidenceId: evidence.id },
      pinnedByUserId: user.id,
      note: null,
    });
    const monitor = await repos.monitors.create({
      name: `[Monitor ${tag}]`,
      target: "example.com",
      scheduleCron: "0 * * * *",
      enabled: false,
      createdByUserId: user.id,
    });
    const alert = await repos.alerts.create({
      monitorId: monitor.id,
      title: `[Alert ${tag}]`,
      evidenceId: evidence.id,
    });
    const credential = await repos.credentials.create({
      id: randomUUID(),
      provider: "fixture",
      label: `[Credential ${tag}]`,
      ciphertext: randomBytes(32),
      encryptedDataKey: randomBytes(32),
      masterKeyVersion: "test",
    });
    const usage = await repos.usageEvents.record({
      unit: "API_CREDIT",
      quantity: 1,
      collectorId: collector.collectorId,
      jobId: job.id,
    });

    const scope = await repos.scopeAuthorisations.create({
      targetType: "DOMAIN",
      target: "example.com",
      authorisedByUserId: user.id,
      basis: `[fixture authorisation ${tag}]`,
      validFrom: new Date(Date.parse("2026-01-01T00:00:00Z")),
      validUntil: new Date(Date.parse("2030-01-01T00:00:00Z")),
    });

    const report = await repos.reports.create({
      runId: run.id,
      includeSynthesis: false,
      requestedByUserId: user.id,
    });

    return {
      tenantId,
      userId: user.id,
      apiKeyId: apiKey.id,
      auditEntryId: audit.id,
      collectorId: collector.collectorId,
      investigationId: investigation.id,
      runId: run.id,
      jobId: job.id,
      evidenceId: evidence.id,
      contentHash,
      entityId: entity.id,
      otherEntityId: other.id,
      mergedEntityId: merged.id,
      relationshipId: relationship.id,
      mergeId: merge.id,
      claimId: claim.id,
      caseId: caseRow.id,
      casePinId: pin.id,
      monitorId: monitor.id,
      alertId: alert.id,
      credentialId: credential.id,
      usageEventId: usage.id,
      scopeAuthorisationId: scope.id,
      reportId: report.id,
      identifiedEntityId: identified.entity.id,
    };
  });
  return { ...rows, tenantQuotaId: await insertQuotaAsOwner(tenantId) };
}

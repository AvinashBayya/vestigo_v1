/**
 * Development seed: two tenants with distinct data, for checking isolation by
 * hand. Everything goes through withTenant() and the repositories as the
 * application role, exactly like application code.
 *
 * Values are bracketed placeholders, RFC 2606 example domains and RFC 5737
 * documentation addresses; nothing imitates real data (CLAUDE.md §1). No
 * PERSON entities are created: person investigation is plan- and
 * vetting-gated, and seeds never bypass that (CLAUDE.md §9).
 */
import { parseTenantId, type TenantId } from "@repo/core";
import type { ContentStore } from "../src/content-store.ts";
import type { Database } from "../src/database.ts";

/** Fixed so the seed is idempotent and the ids can be pasted into manual checks. */
export const SEED_TENANTS = [
  {
    tenantId: parseTenantId("00000000-0000-4000-8000-00000000000a"),
    name: "[Seed tenant A]",
    domain: "example.com",
    subdomain: "www.example.com",
    address: "192.0.2.10",
  },
  {
    tenantId: parseTenantId("00000000-0000-4000-8000-00000000000b"),
    name: "[Seed tenant B]",
    domain: "example.org",
    subdomain: "www.example.org",
    address: "198.51.100.20",
  },
] as const;

export const SEED_COLLECTOR_ID = "dev-seed";

export interface SeededTenant {
  readonly tenantId: TenantId;
  readonly name: string;
  /** False when the tenant already existed and was left untouched. */
  readonly created: boolean;
  readonly caseId: string | null;
  readonly evidenceId: string | null;
}

type SeedSpec = (typeof SEED_TENANTS)[number];

async function seedTenant(
  db: Database,
  store: ContentStore,
  spec: SeedSpec,
): Promise<SeededTenant> {
  const existing = await db.withTenant(spec.tenantId, ({ repos }) => repos.tenants.current());
  if (existing !== null) {
    return {
      tenantId: spec.tenantId,
      name: existing.name,
      created: false,
      caseId: null,
      evidenceId: null,
    };
  }

  const payload = new TextEncoder().encode(
    `[development seed payload for ${spec.name}: ${spec.domain} resolves to ${spec.address}]`,
  );
  const stored = await store.put(spec.tenantId, payload);

  return db.withTenant(spec.tenantId, async ({ repos }) => {
    await repos.tenants.create({ name: spec.name, region: "IN" });
    const user = await repos.users.create({
      email: `analyst@${spec.domain}`,
      displayName: `[Analyst, ${spec.name}]`,
      status: "ACTIVE",
    });
    await repos.collectorsRegistry.register({
      collectorId: SEED_COLLECTOR_ID,
      sourceLabel: "[Development seed]",
      discipline: "TECHINT",
      collectionMode: "PASSIVE",
      dataLicence: "[not applicable: development seed, collects nothing]",
      commercialUse: "UNVERIFIED",
      enabled: false,
      disabledReason: "[development seed; never collects]",
    });
    const investigation = await repos.investigations.create({
      title: `[Seed investigation: ${spec.domain}]`,
      target: spec.domain,
      createdByUserId: user.id,
    });
    const run = await repos.runs.create({
      investigationId: investigation.id,
      status: "QUEUED",
      requestedByUserId: user.id,
    });
    const job = await repos.jobs.create({
      runId: run.id,
      collectorId: SEED_COLLECTOR_ID,
      idempotencyKey: `seed:${spec.domain}`,
      status: "QUEUED",
    });
    // Nothing was observed or collected: both timestamps are honestly unknown.
    const evidence = await repos.evidence.record({
      collectorId: SEED_COLLECTOR_ID,
      collectorVersion: "0.0.0-seed",
      jobId: job.id,
      sourceUrl: `https://${spec.domain}/`,
      contentHash: stored.contentHash,
      payloadRef: stored.ref,
      observedAt: null,
      collectedAt: null,
      claimStrength: "HYPOTHESIS",
    });
    const domain = await repos.entities.create({ kind: "DOMAIN", displayName: spec.domain });
    const subdomain = await repos.entities.create({ kind: "DOMAIN", displayName: spec.subdomain });
    const address = await repos.entities.create({ kind: "IP_ADDRESS", displayName: spec.address });
    const relationship = await repos.entityRelationships.create({
      sourceEntityId: subdomain.id,
      targetEntityId: domain.id,
      kind: "subdomain_of",
    });
    await repos.claims.create({
      evidenceId: evidence.id,
      subject: { relationshipId: relationship.id },
      attribute: "asserted_by",
      value: "[seed]",
      strength: "HYPOTHESIS",
    });
    await repos.claims.create({
      evidenceId: evidence.id,
      subject: { entityId: address.id },
      attribute: "resolves_from",
      value: spec.domain,
      strength: "HYPOTHESIS",
    });
    const caseRow = await repos.cases.create({
      title: `[Seed case: ${spec.domain}]`,
      description: `[Development seed data for ${spec.name}]`,
      createdByUserId: user.id,
    });
    await repos.casePins.pin({
      caseId: caseRow.id,
      target: { evidenceId: evidence.id },
      pinnedByUserId: user.id,
      note: "[seed pin]",
    });
    await repos.monitors.create({
      name: `[Seed monitor: ${spec.domain}]`,
      target: spec.domain,
      scheduleCron: "0 6 * * *",
      enabled: false,
      createdByUserId: user.id,
    });
    await repos.auditLog.append({
      actor: { kind: "SYSTEM" },
      action: "seed.create",
      target: { type: "tenant", id: spec.tenantId },
      details: { note: "[development seed]" },
      authorization: { method: "SYSTEM", permission: null, sessionId: null },
      outcome: "ALLOWED",
      requestId: null,
    });
    return {
      tenantId: spec.tenantId,
      name: spec.name,
      created: true,
      caseId: caseRow.id,
      evidenceId: evidence.id,
    };
  });
}

/** Seeds both development tenants. Safe to run repeatedly. */
export async function seedDevelopmentTenants(
  db: Database,
  store: ContentStore,
): Promise<SeededTenant[]> {
  const seeded: SeededTenant[] = [];
  for (const spec of SEED_TENANTS) seeded.push(await seedTenant(db, store, spec));
  return seeded;
}

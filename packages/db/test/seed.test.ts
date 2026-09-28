import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SEED_TENANTS, seedDevelopmentTenants } from "../scripts/seed-data.ts";
import { FileSystemContentStore } from "../src/content-store.ts";
import type { Database } from "../src/database.ts";
import { openDatabase } from "./support.ts";

let db: Database;
let root = "";
let store: FileSystemContentStore;

beforeAll(async () => {
  db = openDatabase();
  root = await mkdtemp(join(tmpdir(), "seed-store-"));
  store = new FileSystemContentStore(root);
});

afterAll(async () => {
  await db.close();
  await rm(root, { recursive: true, force: true });
});

describe("development seed", () => {
  it("creates two tenants, each seeing only its own data", async () => {
    const seeded = await seedDevelopmentTenants(db, store);
    expect(seeded.map((tenant) => tenant.created)).toEqual([true, true]);

    for (const spec of SEED_TENANTS) {
      const view = await db.withTenant(spec.tenantId, async ({ repos }) => ({
        tenants: [await repos.tenants.current()],
        cases: await repos.cases.list({ limit: 100 }),
        investigations: await repos.investigations.list({ limit: 100 }),
        entities: await repos.entities.list({ limit: 100 }),
        evidence: await repos.evidence.list({ limit: 100 }),
      }));
      expect(view.tenants.map((tenant) => tenant?.name)).toEqual([spec.name]);
      expect(view.cases.map((row) => row.title)).toEqual([`[Seed case: ${spec.domain}]`]);
      expect(view.investigations.map((row) => row.target)).toEqual([spec.domain]);
      for (const table of Object.values(view)) {
        for (const row of table) expect(row?.tenantId).toBe(spec.tenantId);
      }
      // Seed evidence was never observed or collected: both stay unknown.
      expect(view.evidence.map((row) => [row.observedAt, row.collectedAt])).toEqual([[null, null]]);
      // No person data: person investigation is vetting-gated (CLAUDE.md §9).
      expect(view.entities.filter((entity) => entity.kind === "PERSON")).toEqual([]);
    }
  });

  it("stores each tenant's payload, retrievable by its evidence hash", async () => {
    for (const spec of SEED_TENANTS) {
      const [evidence] = await db.withTenant(spec.tenantId, ({ repos }) =>
        repos.evidence.list({ limit: 1 }),
      );
      expect(evidence).toBeDefined();
      if (evidence === undefined) return;
      const bytes = await store.get(spec.tenantId, evidence.contentHash);
      expect(new TextDecoder().decode(bytes)).toContain(spec.domain);
    }
  });

  it("is idempotent: a second run changes nothing", async () => {
    const before = await db.withTenant(SEED_TENANTS[0].tenantId, ({ repos }) =>
      repos.cases.list({ limit: 100 }),
    );
    const again = await seedDevelopmentTenants(db, store);
    expect(again.map((tenant) => tenant.created)).toEqual([false, false]);
    const after = await db.withTenant(SEED_TENANTS[0].tenantId, ({ repos }) =>
      repos.cases.list({ limit: 100 }),
    );
    expect(after).toEqual(before);
  });
});

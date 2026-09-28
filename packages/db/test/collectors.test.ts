/**
 * RELEASE-BLOCKING in part. The database's own layer under the collector
 * frame: evidence is refused from any collector that is not enabled for the
 * tenant, whatever path writes it, and a BLOCKED collector can never be
 * enabled. Also: the registry sync is idempotent, and a scope authorisation
 * is in force only between its start and end, until revoked, by the
 * database clock.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contentRef, hashContent } from "../src/content-store.ts";
import type { Database } from "../src/database.ts";
import { CollectorNotEnabledError, ConstraintViolationError } from "../src/errors.ts";
import type { NewCollectorRegistration, Repositories } from "../src/repositories/index.ts";
import { createTenantFixture, openDatabase, type TenantFixture } from "./support.ts";

let db: Database;
let tenant: TenantFixture;

beforeAll(async () => {
  db = openDatabase();
  tenant = await createTenantFixture(db, "collectors");
});

afterAll(async () => {
  await db.close();
});

function registration(
  collectorId: string,
  state: Pick<NewCollectorRegistration, "commercialUse" | "enabled" | "disabledReason">,
): NewCollectorRegistration {
  return {
    collectorId,
    sourceLabel: `[${collectorId}]`,
    discipline: "TECHINT",
    collectionMode: "PASSIVE_API",
    dataLicence: "[licence text]",
    ...state,
  };
}

function evidenceFrom(repos: Repositories, collectorId: string) {
  const payload = randomBytes(16);
  const contentHash = hashContent(payload);
  return repos.evidence.record({
    collectorId,
    collectorVersion: "1.0.0",
    jobId: null,
    sourceUrl: "https://example.com/",
    contentHash,
    payloadRef: contentRef(tenant.tenantId, contentHash),
    observedAt: null,
    collectedAt: null,
    claimStrength: "REPORTED",
  });
}

describe("evidence only from an enabled collector (RELEASE-BLOCKING)", () => {
  it("accepts evidence from an enabled collector", async () => {
    await db.withTenant(tenant.tenantId, async ({ repos }) => {
      await repos.collectorsRegistry.sync(
        registration("enabled.one", {
          commercialUse: "PERMITTED",
          enabled: true,
          disabledReason: null,
        }),
      );
      await expect(evidenceFrom(repos, "enabled.one")).resolves.toMatchObject({
        collectorId: "enabled.one",
      });
    });
  });

  it("refuses evidence written straight through the repository for a disabled collector", async () => {
    await expect(
      db.withTenant(tenant.tenantId, async ({ repos }) => {
        await repos.collectorsRegistry.sync(
          registration("disabled.one", {
            commercialUse: "UNVERIFIED",
            enabled: false,
            disabledReason: "[switched off]",
          }),
        );
        return evidenceFrom(repos, "disabled.one");
      }),
    ).rejects.toBeInstanceOf(CollectorNotEnabledError);
  });

  it("refuses evidence for a BLOCKED collector, which cannot be enabled in the first place", async () => {
    await expect(
      db.withTenant(tenant.tenantId, ({ repos }) =>
        repos.collectorsRegistry.sync(
          registration("blocked.one", {
            commercialUse: "BLOCKED",
            enabled: true,
            disabledReason: null,
          }),
        ),
      ),
    ).rejects.toBeInstanceOf(ConstraintViolationError);

    await expect(
      db.withTenant(tenant.tenantId, async ({ repos }) => {
        await repos.collectorsRegistry.sync(
          registration("blocked.one", {
            commercialUse: "BLOCKED",
            enabled: false,
            disabledReason: "[non-commercial licence]",
          }),
        );
        return evidenceFrom(repos, "blocked.one");
      }),
    ).rejects.toBeInstanceOf(CollectorNotEnabledError);
  });

  it("refuses evidence once a collector is blocked, even though it wrote evidence before", async () => {
    await db.withTenant(tenant.tenantId, async ({ repos }) => {
      await repos.collectorsRegistry.sync(
        registration("later.blocked", {
          commercialUse: "UNVERIFIED",
          enabled: true,
          disabledReason: null,
        }),
      );
      await evidenceFrom(repos, "later.blocked");
    });
    await expect(
      db.withTenant(tenant.tenantId, async ({ repos }) => {
        await repos.collectorsRegistry.sync(
          registration("later.blocked", {
            commercialUse: "BLOCKED",
            enabled: false,
            disabledReason: "[licence withdrawn]",
          }),
        );
        return evidenceFrom(repos, "later.blocked");
      }),
    ).rejects.toBeInstanceOf(CollectorNotEnabledError);
  });
});

describe("the tenant's registry copy", () => {
  it("sync inserts once and then brings the row up to date", async () => {
    await db.withTenant(tenant.tenantId, async ({ repos }) => {
      const state = { commercialUse: "UNVERIFIED", enabled: true, disabledReason: null } as const;
      await repos.collectorsRegistry.sync(registration("synced.one", state));
      const updated = await repos.collectorsRegistry.sync({
        ...registration("synced.one", state),
        sourceLabel: "[renamed in the catalogue]",
      });
      expect(updated.sourceLabel).toBe("[renamed in the catalogue]");
      const rows = (await repos.collectorsRegistry.list({ limit: 1000 })).filter(
        (row) => row.collectorId === "synced.one",
      );
      expect(rows).toHaveLength(1);
    });
  });
});

describe("scope authorisations", () => {
  const at = (iso: string) => new Date(Date.parse(iso));

  it("is in force only between its start and its end, until revoked", async () => {
    await db.withTenant(tenant.tenantId, async ({ repos }) => {
      const make = (target: string, validFrom: string, validUntil: string) =>
        repos.scopeAuthorisations.create({
          targetType: "DOMAIN",
          target,
          authorisedByUserId: tenant.userId,
          basis: "[engagement letter]",
          validFrom: at(validFrom),
          validUntil: at(validUntil),
        });
      await make("expired.example.com", "2000-01-01T00:00:00Z", "2001-01-01T00:00:00Z");
      await make("future.example.com", "2090-01-01T00:00:00Z", "2091-01-01T00:00:00Z");
      const current = await make(
        "current.example.com",
        "2000-01-01T00:00:00Z",
        "2090-01-01T00:00:00Z",
      );

      expect(
        await repos.scopeAuthorisations.findInForce("DOMAIN", "expired.example.com"),
      ).toBeNull();
      expect(
        await repos.scopeAuthorisations.findInForce("DOMAIN", "future.example.com"),
      ).toBeNull();
      expect(
        (await repos.scopeAuthorisations.findInForce("DOMAIN", "current.example.com"))?.id,
      ).toBe(current.id);
      // Exact target and type only.
      expect(
        await repos.scopeAuthorisations.findInForce("DOMAIN", "sub.current.example.com"),
      ).toBeNull();
      expect(await repos.scopeAuthorisations.findInForce("URL", "current.example.com")).toBeNull();

      await repos.scopeAuthorisations.revoke(current.id);
      expect(
        await repos.scopeAuthorisations.findInForce("DOMAIN", "current.example.com"),
      ).toBeNull();
      expect(await repos.scopeAuthorisations.revoke(current.id)).toBeNull();
    });
  });

  it("must end after it starts, and must state its basis", async () => {
    for (const bad of [
      {
        validFrom: at("2030-01-01T00:00:00Z"),
        validUntil: at("2029-01-01T00:00:00Z"),
        basis: "[x]",
      },
      {
        validFrom: at("2029-01-01T00:00:00Z"),
        validUntil: at("2030-01-01T00:00:00Z"),
        basis: "  ",
      },
    ]) {
      await expect(
        db.withTenant(tenant.tenantId, ({ repos }) =>
          repos.scopeAuthorisations.create({
            targetType: "DOMAIN",
            target: "example.net",
            authorisedByUserId: tenant.userId,
            ...bad,
          }),
        ),
      ).rejects.toBeInstanceOf(ConstraintViolationError);
    }
  });
});

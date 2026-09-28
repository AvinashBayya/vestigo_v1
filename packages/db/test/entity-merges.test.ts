/**
 * RELEASE-BLOCKING. Merges are reversible records: undoing one loses nothing,
 * people and organisations are never auto-merged on a name alone, and merges
 * cannot form cycles, even when made concurrently.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contentRef, hashContent } from "../src/content-store.ts";
import type { Database } from "../src/database.ts";
import { MergeRuleViolationError } from "../src/errors.ts";
import type { Repositories } from "../src/repositories/index.ts";
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

let db: Database;
let tenant: TenantFixture;

beforeAll(async () => {
  db = openDatabase();
  tenant = await createTenantFixture(db, "merge");
});

afterAll(async () => {
  await db.close();
});

const inTenant = <T>(work: (repos: Repositories) => Promise<T>) =>
  db.withTenant(tenant.tenantId, ({ repos }) => work(repos));

async function personWithEvidence(repos: Repositories, label: string) {
  const person = await repos.entities.create({
    kind: "PERSON",
    displayName: "[Person with a common name]",
  });
  const payload = new TextEncoder().encode(`[profile payload ${label}]`);
  const contentHash = hashContent(payload);
  const evidence = await repos.evidence.record({
    collectorId: FIXTURE_COLLECTOR_ID,
    collectorVersion: "0.0.0-test",
    jobId: null,
    sourceUrl: "https://example.com/profile",
    contentHash,
    payloadRef: contentRef(tenant.tenantId, contentHash),
    observedAt: null,
    collectedAt: null,
    claimStrength: "OBSERVED",
  });
  const claim = await repos.claims.create({
    evidenceId: evidence.id,
    subject: { entityId: person.id },
    attribute: "handle",
    value: `[handle ${label}]`,
    strength: "OBSERVED",
  });
  return { person, evidence, claim };
}

const analyst = () => ({ kind: "USER", userId: tenant.userId }) as const;

describe("entity merges (RELEASE-BLOCKING)", () => {
  it("can be undone, and the merged entity's evidence and claims survive untouched", async () => {
    const { first, second } = await inTenant(async (repos) => ({
      first: await personWithEvidence(repos, "1"),
      second: await personWithEvidence(repos, "2"),
    }));

    const merge = await inTenant((repos) =>
      repos.entityMerges.merge({
        survivingEntityId: first.person.id,
        mergedEntityId: second.person.id,
        reason: "[analyst matched both profiles to one person]",
        confidence: 0.9,
        matchSignals: ["NAME", "ANALYST_REVIEW"],
        decidedBy: analyst(),
      }),
    );

    const merged = await inTenant(async (repos) => ({
      resolved: await repos.entityMerges.resolve(second.person.id),
      members: await repos.entityMerges.members(first.person.id),
    }));
    expect(merged.resolved).toBe(first.person.id);
    expect([...merged.members].sort()).toEqual([first.person.id, second.person.id].sort());
    const mergedClaims = await inTenant((repos) => repos.claims.listForEntities(merged.members));
    expect(mergedClaims.map((claim) => claim.id).sort()).toEqual(
      [first.claim.id, second.claim.id].sort(),
    );

    const reverted = await inTenant((repos) =>
      repos.entityMerges.undo(merge.id, {
        decidedBy: analyst(),
        reason: "[different people after review]",
      }),
    );
    expect(reverted?.revertedAt).toBeInstanceOf(Date);
    expect(reverted?.revertReason).toBe("[different people after review]");

    const after = await inTenant(async (repos) => ({
      resolved: await repos.entityMerges.resolve(second.person.id),
      members: await repos.entityMerges.members(first.person.id),
      entity: await repos.entities.findById(second.person.id),
      evidence: await repos.evidence.findById(second.evidence.id),
      claim: await repos.claims.findById(second.claim.id),
      record: await repos.entityMerges.findById(merge.id),
    }));
    expect(after.resolved).toBe(second.person.id);
    expect(after.members).toEqual([first.person.id]);
    expect(after.entity).toEqual(second.person);
    expect(after.evidence).toEqual(second.evidence);
    expect(after.claim).toEqual(second.claim);
    // The decision itself is kept, with who reverted it and why.
    expect(after.record?.reason).toBe(merge.reason);
    expect(after.record?.revertedByUserId).toBe(tenant.userId);
  });

  it("refuses to revert the same merge twice", async () => {
    const { a, b } = await inTenant(async (repos) => ({
      a: await repos.entities.create({ kind: "DOMAIN", displayName: "example.org" }),
      b: await repos.entities.create({ kind: "DOMAIN", displayName: "[example.org duplicate]" }),
    }));
    const merge = await inTenant((repos) =>
      repos.entityMerges.merge({
        survivingEntityId: a.id,
        mergedEntityId: b.id,
        reason: "[same domain]",
        confidence: 1,
        matchSignals: ["DOMAIN"],
        decidedBy: { kind: "RULE", rule: "[domain-equality]" },
      }),
    );
    const undo = () =>
      inTenant((repos) =>
        repos.entityMerges.undo(merge.id, { decidedBy: analyst(), reason: "[undo]" }),
      );
    await undo();
    await expect(undo()).rejects.toMatchObject({
      code: "MERGE_RULE_VIOLATION",
      rule: "ALREADY_REVERTED",
    });
  });

  it.each(["PERSON", "ORGANIZATION"] as const)(
    "never auto-merges a %s on a name match alone: refused by the repository",
    async (kind) => {
      const attempt = inTenant(async (repos) => {
        const a = await repos.entities.create({ kind, displayName: "[Common name]" });
        const b = await repos.entities.create({ kind, displayName: "[Common name]" });
        return repos.entityMerges.merge({
          survivingEntityId: a.id,
          mergedEntityId: b.id,
          reason: "[same name]",
          confidence: 1,
          matchSignals: ["NAME"],
          decidedBy: { kind: "RULE", rule: "[name-equality]" },
        });
      });
      await expect(attempt).rejects.toMatchObject({
        code: "MERGE_RULE_VIOLATION",
        rule: "NAME_ONLY_AUTOMERGE",
      });
    },
  );

  it("never auto-merges a person on a name alone: refused by the database itself", async () => {
    const { a, b } = await inTenant(async (repos) => ({
      a: await repos.entities.create({ kind: "PERSON", displayName: "[Common name]" }),
      b: await repos.entities.create({ kind: "PERSON", displayName: "[Common name]" }),
    }));
    const client = await rawClient(TEST_DATABASE.runtimeUrl);
    try {
      const state = await asTenant(client, tenant.tenantId, () =>
        sqlStateOf(() =>
          client.query(
            `insert into public.entity_merges (tenant_id, entity_kind, surviving_entity_id, merged_entity_id,
               reason, confidence, match_signals, merged_by_kind, merged_by_rule)
             values ($1, 'PERSON', $2, $3, '[same name]', 1, '{NAME}', 'RULE', '[name-equality]')`,
            [tenant.tenantId, a.id, b.id],
          ),
        ),
      );
      expect(state).toBe("23514");
    } finally {
      await client.end();
    }
  });

  it("allows a person merge on name plus a stronger signal, and an analyst's own decision", async () => {
    const merge = await inTenant(async (repos) => {
      const a = await repos.entities.create({ kind: "PERSON", displayName: "[Common name]" });
      const b = await repos.entities.create({ kind: "PERSON", displayName: "[Common name]" });
      return repos.entityMerges.merge({
        survivingEntityId: a.id,
        mergedEntityId: b.id,
        reason: "[same name and the same verified email]",
        confidence: 0.95,
        matchSignals: ["NAME", "EMAIL_ADDRESS"],
        decidedBy: { kind: "RULE", rule: "[name-and-email]" },
      });
    });
    expect(merge.mergedByRule).toBe("[name-and-email]");
  });

  it("refuses to merge entities of different kinds", async () => {
    const attempt = inTenant(async (repos) => {
      const person = await repos.entities.create({ kind: "PERSON", displayName: "[Person]" });
      const org = await repos.entities.create({
        kind: "ORGANIZATION",
        displayName: "[Organisation]",
      });
      return repos.entityMerges.merge({
        survivingEntityId: org.id,
        mergedEntityId: person.id,
        reason: "[x]",
        confidence: 1,
        matchSignals: ["ANALYST_REVIEW"],
        decidedBy: analyst(),
      });
    });
    await expect(attempt).rejects.toMatchObject({ rule: "KIND_MISMATCH" });
  });

  it("refuses to merge one entity into two survivors at once", async () => {
    const attempt = inTenant(async (repos) => {
      // Sequential: a transaction is one connection, which runs one query at a time.
      const a = await repos.entities.create({ kind: "DOMAIN", displayName: "[one]" });
      const b = await repos.entities.create({ kind: "DOMAIN", displayName: "[two]" });
      const c = await repos.entities.create({ kind: "DOMAIN", displayName: "[three]" });
      const decision = {
        reason: "[x]",
        confidence: 1,
        matchSignals: ["DOMAIN"],
        decidedBy: analyst(),
      } as const;
      await repos.entityMerges.merge({
        ...decision,
        survivingEntityId: a.id,
        mergedEntityId: c.id,
      });
      return repos.entityMerges.merge({
        ...decision,
        survivingEntityId: b.id,
        mergedEntityId: c.id,
      });
    });
    await expect(attempt).rejects.toMatchObject({ rule: "ALREADY_MERGED" });
  });

  it("cannot form a cycle: the survivor must not itself be merged away", async () => {
    const { x, y } = await inTenant(async (repos) => ({
      x: await repos.entities.create({ kind: "DOMAIN", displayName: "[x]" }),
      y: await repos.entities.create({ kind: "DOMAIN", displayName: "[y]" }),
    }));
    const decision = {
      reason: "[x]",
      confidence: 1,
      matchSignals: ["DOMAIN"],
      decidedBy: analyst(),
    } as const;
    await inTenant((repos) =>
      repos.entityMerges.merge({ ...decision, survivingEntityId: y.id, mergedEntityId: x.id }),
    );
    await expect(
      inTenant((repos) =>
        repos.entityMerges.merge({ ...decision, survivingEntityId: x.id, mergedEntityId: y.id }),
      ),
    ).rejects.toMatchObject({ rule: "SURVIVOR_ALREADY_MERGED" });
  });

  it("cannot form a cycle even when both directions are merged concurrently", async () => {
    const { x, y } = await inTenant(async (repos) => ({
      x: await repos.entities.create({ kind: "DOMAIN", displayName: "[x concurrent]" }),
      y: await repos.entities.create({ kind: "DOMAIN", displayName: "[y concurrent]" }),
    }));
    const insert = `insert into public.entity_merges (tenant_id, entity_kind, surviving_entity_id, merged_entity_id,
        reason, confidence, match_signals, merged_by_kind, merged_by_user_id)
      values ($1, 'DOMAIN', $2, $3, '[concurrent]', 1, '{DOMAIN}', 'USER', $4)`;
    const first = await rawClient(TEST_DATABASE.runtimeUrl);
    const second = await rawClient(TEST_DATABASE.runtimeUrl);
    try {
      for (const client of [first, second]) {
        await client.query("begin");
        await client.query("select set_config('app.tenant_id', $1, true)", [tenant.tenantId]);
      }
      const secondPid = (await second.query<{ pid: number }>("select pg_backend_pid() as pid"))
        .rows[0]?.pid;
      await first.query(insert, [tenant.tenantId, y.id, x.id, tenant.userId]);
      const racing = sqlStateOf(() =>
        second.query(insert, [tenant.tenantId, x.id, y.id, tenant.userId]),
      );
      // Deterministic interleaving: commit `first` only once `second` is
      // provably waiting on a lock, or has already finished its insert (which
      // is what happens if the per-tenant merge lock is missing).
      const settled = racing.then(() => "settled");
      let blocked = false;
      for (let attempt = 0; attempt < 200 && !blocked; attempt++) {
        const state = await Promise.race([
          settled,
          first
            .query<{ waiting: boolean }>(
              "select cardinality(pg_blocking_pids($1)) > 0 as waiting",
              [secondPid],
            )
            .then((result) => (result.rows[0]?.waiting === true ? "blocked" : "running")),
        ]);
        if (state === "settled") break;
        blocked = state === "blocked";
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 25));
      }
      await first.query("commit");
      expect(blocked, "the second merge should wait on the per-tenant merge lock").toBe(true);
      expect(await racing).toBe("MRG01");
      await second.query("rollback");
    } finally {
      await first.end();
      await second.end();
    }
  });

  it("allows only a revert as an update, even for the schema owner", async () => {
    const owner = await rawClient(TEST_DATABASE.ownerUrl);
    const runtime = await rawClient(TEST_DATABASE.runtimeUrl);
    try {
      const runtimeState = await asTenant(runtime, tenant.tenantId, () =>
        sqlStateOf(() =>
          runtime.query("update public.entity_merges set reason = '[rewritten]' where id = $1", [
            tenant.mergeId,
          ]),
        ),
      );
      expect(runtimeState).toBe("42501");
      const ownerState = await asTenant(owner, tenant.tenantId, () =>
        sqlStateOf(() =>
          owner.query("update public.entity_merges set reason = '[rewritten]' where id = $1", [
            tenant.mergeId,
          ]),
        ),
      );
      expect(ownerState).toBe("MRG03");
    } finally {
      await owner.end();
      await runtime.end();
    }
  });

  it("exposes merge violations as typed errors", () => {
    expect(new MergeRuleViolationError("KIND_MISMATCH", "x").code).toBe("MERGE_RULE_VIOLATION");
  });
});

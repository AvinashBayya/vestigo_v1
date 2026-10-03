/**
 * Phase 6a: the API surface the web application needs. Each endpoint is
 * exercised, nulls are checked on the wire, and (RELEASE-BLOCKING) tenant B
 * can reach none of tenant A's records through any of them.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { contentRef, hashContent } from "@repo/db";
import type { TenantId } from "@repo/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  Browser,
  callProvider,
  createTestApi,
  asOwner,
  auditRows,
  joinAs,
  provisionTestTenant,
  readyBrowser,
  setEntitlement,
  type TestApi,
} from "./support.ts";

let api: TestApi;
let tenantA: TenantId;
let a: Browser;
let b: Browser;

interface Seed {
  runId: string;
  evidenceId: string;
  entityId: string;
  otherEntityId: string;
  twinId: string;
  claimId: string;
  relationshipId: string;
  organizationId: string;
  jobId: string;
  payload: Uint8Array;
  contentHash: string;
  payloadRef: string;
}
let seedA: Seed;

async function seed(tenantId: TenantId, userId: string): Promise<Seed> {
  return api.db.withTenant(tenantId, async ({ repos }) => {
    await repos.collectorsRegistry.register({
      collectorId: "fixture",
      sourceLabel: "[Fixture collector]",
      discipline: "TECHINT",
      collectionMode: "LOCAL_ANALYSIS",
      dataLicence: "[not applicable: test fixture]",
      commercialUse: "UNVERIFIED",
      enabled: true,
      disabledReason: null,
    });
    const investigation = await repos.investigations.create({
      title: "[investigation]",
      target: "example.com",
      createdByUserId: userId,
    });
    const run = await repos.runs.create({
      investigationId: investigation.id,
      status: "QUEUED",
      requestedByUserId: userId,
    });
    const job = await repos.jobs.create({
      runId: run.id,
      collectorId: "fixture",
      idempotencyKey: `explore:${run.id}`,
      status: "QUEUED",
    });
    const payload = new TextEncoder().encode(`<html>[payload ${run.id}]</html>`);
    const stored = await api.services.runs.contentStore.put(tenantId, payload);
    const evidence = await repos.evidence.record({
      collectorId: "fixture",
      collectorVersion: "0.0.0-test",
      jobId: job.id,
      sourceUrl: "https://example.com/",
      contentHash: stored.contentHash,
      payloadRef: stored.ref,
      observedAt: null,
      collectedAt: new Date("2026-05-01T00:00:00Z"),
      claimStrength: "OBSERVED",
    });
    const entity = await repos.entities.create({ kind: "DOMAIN", displayName: "example.com" });
    const other = await repos.entities.create({ kind: "DOMAIN", displayName: "www.example.com" });
    const twin = await repos.entities.create({ kind: "DOMAIN", displayName: "Example.com " });
    const organization = await repos.entities.create({
      kind: "ORGANIZATION",
      displayName: "[an organisation]",
    });
    const relationship = await repos.entityRelationships.create({
      sourceEntityId: other.id,
      targetEntityId: entity.id,
      kind: "subdomain_of",
    });
    const claim = await repos.claims.create({
      evidenceId: evidence.id,
      subject: { entityId: entity.id },
      attribute: "registrar",
      value: null,
      strength: "OBSERVED",
    });
    await repos.claims.create({
      evidenceId: evidence.id,
      subject: { entityId: twin.id },
      attribute: "note",
      value: "[note]",
      strength: "DERIVED",
    });
    return {
      runId: run.id,
      jobId: job.id,
      payload,
      contentHash: stored.contentHash,
      payloadRef: stored.ref,
      evidenceId: evidence.id,
      entityId: entity.id,
      otherEntityId: other.id,
      twinId: twin.id,
      claimId: claim.id,
      relationshipId: relationship.id,
      organizationId: organization.id,
    };
  });
}

beforeAll(async () => {
  api = await createTestApi();
  const [ta, tb] = await Promise.all([
    provisionTestTenant(api, "x-a"),
    provisionTestTenant(api, "x-b"),
  ]);
  tenantA = ta.tenantId;
  a = await readyBrowser(api, ta.owner, tenantA);
  b = await readyBrowser(api, tb.owner, tb.tenantId);
  seedA = await seed(tenantA, ta.ownerUserId);
});

afterAll(async () => {
  await api.close();
});

// The type parameter only labels the body, as response.json<T>() does.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
const json = <T>(response: { json: <U>() => U }): T => response.json<T>();

describe("cases and pins", () => {
  it("creates, lists, reads, updates and archives a case", async () => {
    const created = await a.request("POST", "/api/v1/cases", { title: "  [Case one]  " });
    expect(created.status).toBe(201);
    const row = json<{ id: string; title: string; description: unknown; pinCount: number }>(
      created,
    );
    expect(row).toMatchObject({ title: "[Case one]", description: null, pinCount: 0 });

    const list = json<{ items: { id: string; pinCount: number }[] }>(
      await a.request("GET", "/api/v1/cases"),
    );
    expect(list.items.find((item) => item.id === row.id)?.pinCount).toBe(0);

    const renamed = await a.request("PATCH", `/api/v1/cases/${row.id}`, {
      title: "[Renamed]",
      description: "[why]",
    });
    expect(json<{ title: string; description: string }>(renamed)).toMatchObject({
      title: "[Renamed]",
      description: "[why]",
    });
    expect((await a.request("PATCH", `/api/v1/cases/${row.id}`, {})).status).toBe(400);

    const archived = await a.request("PATCH", `/api/v1/cases/${row.id}`, { archived: true });
    expect(json<{ archivedAt: string | null }>(archived).archivedAt).not.toBeNull();
    const again = await a.request("PATCH", `/api/v1/cases/${row.id}`, { archived: true });
    expect(again.status).toBe(200);
    const blocked = await a.request("POST", `/api/v1/cases/${row.id}/pins`, {
      target: { type: "entity", id: seedA.entityId },
    });
    expect(blocked.status).toBe(409);
    expect(json<{ code: string }>(blocked).code).toBe("CASE_ARCHIVED");
  });

  it("pins evidence, an entity and a claim by type and id, idempotently, and unpins", async () => {
    const { id } = json<{ id: string }>(
      await a.request("POST", "/api/v1/cases", { title: "[Pins]" }),
    );
    const pin = async (type: string, target: string) =>
      a.request("POST", `/api/v1/cases/${id}/pins`, { target: { type, id: target }, note: "[n]" });

    const first = await pin("evidence", seedA.evidenceId);
    expect(first.status).toBe(201);
    const second = await pin("evidence", seedA.evidenceId);
    expect(second.status).toBe(200);
    expect(json<{ id: string }>(second).id).toBe(json<{ id: string }>(first).id);
    expect((await pin("entity", seedA.entityId)).status).toBe(201);
    expect((await pin("claim", seedA.claimId)).status).toBe(201);
    // Something that does not exist is not pinned, and says so.
    expect((await pin("entity", "00000000-0000-4000-8000-000000000000")).status).toBe(404);

    const listed = json<{
      items: {
        id: string;
        subject: {
          type: string;
          observedAt?: unknown;
          sourceLabel?: unknown;
          value?: unknown;
        } | null;
      }[];
    }>(await a.request("GET", `/api/v1/cases/${id}/pins`));
    expect(listed.items.map((item) => item.subject?.type)).toEqual(["evidence", "entity", "claim"]);
    const [evidence, , claim] = listed.items;
    // Unknown stays null on the wire: observedAt, an unregistered source label, a stated null value.
    expect(evidence?.subject).toMatchObject({ observedAt: null, sourceLabel: null });
    expect(claim?.subject).toMatchObject({ value: null });

    const counted = json<{ items: { id: string; pinCount: number }[] }>(
      await a.request("GET", "/api/v1/cases"),
    );
    expect(counted.items.find((item) => item.id === id)?.pinCount).toBe(3);

    const pinId = listed.items[0]?.id ?? "";
    expect((await a.request("DELETE", `/api/v1/cases/${id}/pins/${pinId}`)).status).toBe(204);
    expect((await a.request("DELETE", `/api/v1/cases/${id}/pins/${pinId}`)).status).toBe(404);
  });
});

describe("entities, merges, graph and timeline", () => {
  it("lists a run's entities with measured counts and requires exactly one scope", async () => {
    const list = await a.request("GET", `/api/v1/entities?runId=${seedA.runId}`);
    expect(list.status).toBe(200);
    const items = json<{
      items: { id: string; claimCount: number; relationshipCount: number; strengths: string[] }[];
    }>(list).items;
    const entity = items.find((item) => item.id === seedA.entityId);
    expect(entity).toMatchObject({ claimCount: 1, relationshipCount: 1, strengths: ["OBSERVED"] });
    expect(items.find((item) => item.id === seedA.twinId)?.strengths).toEqual(["DERIVED"]);

    expect((await a.request("GET", "/api/v1/entities")).status).toBe(400);
    const both = `runId=${seedA.runId}&caseId=${seedA.runId}`;
    expect((await a.request("GET", `/api/v1/entities?${both}`)).status).toBe(400);
    const unknown = "00000000-0000-4000-8000-000000000000";
    expect((await a.request("GET", `/api/v1/entities?runId=${unknown}`)).status).toBe(404);
  });

  it("reads an entity with claims (a stated null survives), relationships and a truncation flag", async () => {
    const read = await a.request("GET", `/api/v1/entities/${seedA.entityId}`);
    expect(read.status).toBe(200);
    expect(read.body).toContain('"value":null');
    const detail = json<{
      claims: { attribute: string; value: unknown }[];
      claimsTruncated: boolean;
      relationships: { direction: string; otherEntity: { id: string } }[];
    }>(read);
    expect(detail.claims).toHaveLength(1);
    expect(detail.claims[0]?.value).toBeNull();
    expect(detail.claimsTruncated).toBe(false);
    expect(detail.relationships[0]).toMatchObject({
      direction: "INCOMING",
      otherEntity: { id: seedA.otherEntityId },
    });
  });

  it("suggests candidates, merges, lists, undoes, and refuses a second undo", async () => {
    const candidates = json<{
      items: {
        first: { id: string };
        second: { id: string };
        strength: string;
        nameOnly: boolean;
      }[];
    }>(await a.request("GET", `/api/v1/entities/merge-candidates?runId=${seedA.runId}`));
    expect(candidates.items).toHaveLength(1);
    expect(candidates.items[0]).toMatchObject({ strength: "INFERRED", nameOnly: true });
    const ids = new Set([candidates.items[0]?.first.id, candidates.items[0]?.second.id]);
    expect(ids).toEqual(new Set([seedA.entityId, seedA.twinId]));

    const mismatch = await a.request("POST", "/api/v1/entity-merges", {
      survivingEntityId: seedA.entityId,
      mergedEntityId: seedA.organizationId,
      reason: "[wrong kind]",
      confidence: 0.5,
      matchSignals: ["ANALYST_REVIEW"],
    });
    expect(mismatch.status).toBe(409);

    const merged = await a.request("POST", "/api/v1/entity-merges", {
      survivingEntityId: seedA.entityId,
      mergedEntityId: seedA.twinId,
      reason: "[same domain, different case]",
      confidence: 0.9,
      matchSignals: ["NAME", "ANALYST_REVIEW"],
    });
    expect(merged.status).toBe(201);
    const merge = json<{ id: string; reversible: boolean; reverted: unknown; confidence: number }>(
      merged,
    );
    expect(merge).toMatchObject({ reversible: true, reverted: null, confidence: 0.9 });

    const entity = json<{ entity: { mergedEntityCount: number } }>(
      await a.request("GET", `/api/v1/entities/${seedA.entityId}`),
    );
    expect(entity.entity.mergedEntityCount).toBe(1);

    const listed = json<{ items: { id: string }[] }>(
      await a.request("GET", `/api/v1/entity-merges?entityId=${seedA.entityId}`),
    );
    expect(listed.items.map((item) => item.id)).toEqual([merge.id]);

    const undone = await a.request("POST", `/api/v1/entity-merges/${merge.id}/undo`, {
      reason: "[changed my mind]",
    });
    expect(undone.status).toBe(200);
    expect(
      json<{ reversible: boolean; reverted: { reason: string } | null }>(undone),
    ).toMatchObject({
      reversible: false,
      reverted: { reason: "[changed my mind]" },
    });
    const twice = await a.request("POST", `/api/v1/entity-merges/${merge.id}/undo`, {
      reason: "[again]",
    });
    expect(twice.status).toBe(409);
  });

  it("returns the graph to a hop limit, marks truncation, and rejects a hop limit beyond bounds", async () => {
    const graph = (query: string) =>
      a.request("GET", `/api/v1/graph?runId=${seedA.runId}&${query}`);
    const zero = json<{ nodes: { id: string }[]; edges: unknown[]; truncated: boolean }>(
      await graph("hops=0"),
    );
    expect(zero.edges).toEqual([]);
    expect(zero.nodes.map((node) => node.id)).not.toContain(seedA.otherEntityId);
    const one = json<{ nodes: { id: string; hop: number }[]; edges: { id: string }[] }>(
      await graph("hops=1"),
    );
    expect(one.nodes.find((node) => node.id === seedA.otherEntityId)?.hop).toBe(1);
    expect(one.edges.map((edge) => edge.id)).toEqual([seedA.relationshipId]);
    const cut = json<{ truncated: boolean }>(await graph("hops=1&maxNodes=1"));
    expect(cut.truncated).toBe(true);
    expect((await graph("hops=4")).status).toBe(400);
  });

  it("keeps observedAt and collectedAt distinct, with null as JSON null", async () => {
    const response = await a.request("GET", `/api/v1/timeline?runId=${seedA.runId}`);
    expect(response.status).toBe(200);
    expect(response.body).toContain('"observedAt":null');
    const timeline = json<{
      items: { observedAt: string | null; collectedAt: string | null; strength: string }[];
      total: number;
      withoutObservedAt: number;
      withoutCollectedAt: number;
    }>(response);
    expect(timeline.items).toHaveLength(1);
    expect(timeline.items[0]).toMatchObject({
      observedAt: null,
      collectedAt: "2026-05-01T00:00:00.000Z",
      strength: "OBSERVED",
    });
    expect(timeline).toMatchObject({ total: 1, withoutObservedAt: 1, withoutCollectedAt: 0 });
  });
});

describe("retention", () => {
  it("is null until set, set and cleared by an administrator, and bounded", async () => {
    const read = () => a.request("GET", "/api/v1/settings/retention");
    expect(json<{ retentionDays: number | null; enforced: boolean }>(await read())).toEqual({
      retentionDays: null,
      enforced: false,
    });
    const set = await a.request("PUT", "/api/v1/settings/retention", { retentionDays: 90 });
    expect(json<{ retentionDays: number }>(set).retentionDays).toBe(90);
    expect(json<{ retentionDays: number }>(await read()).retentionDays).toBe(90);
    expect(
      (await a.request("PUT", "/api/v1/settings/retention", { retentionDays: 0 })).status,
    ).toBe(400);
    expect(
      (await a.request("PUT", "/api/v1/settings/retention", { retentionDays: 90.5 })).status,
    ).toBe(400);
    const cleared = await a.request("PUT", "/api/v1/settings/retention", { retentionDays: null });
    expect(json<{ retentionDays: number | null }>(cleared).retentionDays).toBeNull();
  });

  it("an analyst can read it but not change it", async () => {
    const analyst = await joinAs(api, a, tenantA, "analyst", "x-ret");
    expect((await analyst.request("GET", "/api/v1/settings/retention")).status).toBe(200);
    const denied = await analyst.request("PUT", "/api/v1/settings/retention", {
      retentionDays: 30,
    });
    expect(denied.status).toBe(403);
  });
});

describe("the credit estimate", () => {
  it("detects the type, lists collectors and exclusions, and never invents a cost", async () => {
    const response = await a.request("POST", "/api/v1/estimates", { target: "example.com" });
    expect(response.status).toBe(200);
    const estimate = json<{
      detectedType: string;
      alternateTypes: string[];
      collectors: {
        collectorId: string;
        estimatedCredits: number | null;
        estimatedCreditsReason: string;
      }[];
      excluded: { collectorId: string; reason: string }[];
      total: { estimatedCredits: number | null; estimatedCreditsReason: string };
    }>(response);
    expect(estimate.detectedType).toBe("DOMAIN");
    expect(estimate.collectors.length).toBeGreaterThan(0);
    for (const collector of estimate.collectors) {
      expect(collector.estimatedCredits).toBeNull();
      expect(collector.estimatedCreditsReason).toMatch(/no credit cost/i);
    }
    expect(estimate.total.estimatedCredits).toBeNull();
    expect(estimate.excluded.length).toBeGreaterThan(0);
    expect(response.body).toContain('"estimatedCredits":null');
  });

  it("returns alternates for an ambiguous bare word, and starts nothing", async () => {
    const response = await a.request("POST", "/api/v1/estimates", { target: "somehandle" });
    const estimate = json<{ detectedType: string; alternateTypes: string[] }>(response);
    expect(estimate.detectedType).toBe("USERNAME");
    expect(estimate.alternateTypes).toContain("ORGANIZATION");
    const runs = json<{ items: unknown[] }>(await a.request("GET", "/api/v1/investigations"));
    expect(runs.items.every((item) => typeof item === "object")).toBe(true);
  });

  it("refuses an empty target", async () => {
    expect((await a.request("POST", "/api/v1/estimates", { target: "   " })).status).toBe(400);
  });
});

describe("members", () => {
  it("lists members with roles, invites, changes a role and removes", async () => {
    await joinAs(api, a, tenantA, "analyst", "x-mem");
    const list = json<{ items: { userId: string; role: string | null; email: string }[] }>(
      await a.request("GET", "/api/v1/members"),
    );
    expect(list.items.some((member) => member.role === "owner")).toBe(true);
    const target = list.items.find((member) => member.email.startsWith("x-mem"));
    expect(target?.role).toBe("analyst");

    const invited = await a.request("POST", "/api/v1/members/invitations", {
      email: "[invitee]@example.com".replace(/[[\]]/g, ""),
      role: "viewer",
    });
    expect(invited.status).toBe(201);
    expect(json<{ enrolmentToken: string | null }>(invited).enrolmentToken).toMatch(/^mfa_/);

    const changed = await a.request("PATCH", `/api/v1/members/${target?.userId ?? ""}`, {
      role: "viewer",
    });
    expect(changed.status).toBe(200);
    const after = json<{ items: { userId: string; role: string | null }[] }>(
      await a.request("GET", "/api/v1/members"),
    );
    expect(after.items.find((member) => member.userId === target?.userId)?.role).toBe("viewer");

    expect((await a.request("DELETE", `/api/v1/members/${target?.userId ?? ""}`)).status).toBe(204);
    const removed = json<{ items: { userId: string; role: string | null; status: string }[] }>(
      await a.request("GET", "/api/v1/members"),
    );
    expect(removed.items.find((member) => member.userId === target?.userId)).toMatchObject({
      role: null,
      status: "DISABLED",
    });
  });

  it("every role can see the team; only administrators change it", async () => {
    const someone = "00000000-0000-4000-8000-000000000000";
    for (const role of ["viewer", "analyst"] as const) {
      const browser = await joinAs(api, a, tenantA, role, `x-see-${role}`);
      for (const url of ["/api/v1/members", "/api/v1/members/invitations"]) {
        expect((await browser.request("GET", url)).status, `${role} GET ${url}`).toBe(200);
      }
      for (const [method, url, body] of [
        ["POST", "/api/v1/members/invitations", { email: "nobody@example.com", role: "viewer" }],
        ["PATCH", `/api/v1/members/${someone}`, { role: "viewer" }],
        ["DELETE", `/api/v1/members/${someone}`, undefined],
      ] as const) {
        expect((await browser.request(method, url, body)).status, `${role} ${method} ${url}`).toBe(
          403,
        );
      }
    }
  });

  it("lists pending invitations, without the token, until cancelled or expired", async () => {
    const invite = async (email: string) => {
      const response = await a.request("POST", "/api/v1/members/invitations", {
        email,
        role: "analyst",
      });
      expect(response.status).toBe(201);
      return json<{ invitationId: string; enrolmentToken: string }>(response);
    };
    const pending = async () =>
      json<{ items: { id: string }[] }>(await a.request("GET", "/api/v1/members/invitations"))
        .items;

    const keep = await invite("pending-keep@example.com");
    const cancel = await invite("pending-cancel@example.com");
    const expire = await invite("pending-expire@example.com");
    const listed = await a.request("GET", "/api/v1/members/invitations");
    expect(listed.status).toBe(200);
    // The enrolment token is shown once, at invitation; the list can never reveal it or its hash.
    expect(listed.body).not.toContain(keep.enrolmentToken);
    expect(listed.body).not.toMatch(/sha256:|enrolment/i);
    const items = json<{ items: { id: string; email: string; roles: string[] }[] }>(listed).items;
    expect(items.find((item) => item.id === keep.invitationId)).toMatchObject({
      email: "pending-keep@example.com",
      roles: ["analyst"],
    });

    // No documented route cancels an invitation yet, and the identity provider's
    // own endpoint is not reachable over HTTP: the fixture cancels it in-process.
    const cancelled = await callProvider(api, a, "POST", "/organization/cancel-invitation", {
      invitationId: cancel.invitationId,
    });
    expect(cancelled.status).toBe(200);
    await asOwner(
      tenantA,
      `update auth.invitation set expires_at = now() - interval '1 hour' where id = $1`,
      [expire.invitationId],
    );
    const ids = (await pending()).map((item) => item.id);
    expect(ids).toContain(keep.invitationId);
    expect(ids).not.toContain(cancel.invitationId);
    expect(ids).not.toContain(expire.invitationId);
  });

  it("an API key can read the team but never change it", async () => {
    const issued = json<{ plaintext: string }>(
      await a.request("POST", "/api/v1/api-keys", {
        name: "[member key]",
        permissions: [
          "member:read",
          "member:create",
          "member:update",
          "member:delete",
          "invitation:create",
        ],
        expiresAt: null,
      }),
    );
    const call = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, body?: unknown) =>
      api.app.inject({
        method,
        url,
        headers: {
          authorization: `Bearer ${issued.plaintext}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
      });
    expect((await call("GET", "/api/v1/members")).statusCode).toBe(200);
    expect((await call("GET", "/api/v1/members/invitations")).statusCode).toBe(200);
    const someone = "00000000-0000-4000-8000-000000000000";
    for (const [method, url, body] of [
      ["POST", "/api/v1/members/invitations", { email: "key-invite@example.com", role: "viewer" }],
      ["PATCH", `/api/v1/members/${someone}`, { role: "viewer" }],
      ["DELETE", `/api/v1/members/${someone}`, undefined],
    ] as const) {
      const response = await call(method, url, body);
      expect(response.statusCode, `${method} ${url}`).toBe(403);
      expect(response.json<{ code: string }>().code).toBe("SESSION_REQUIRED");
    }
  });
});

describe("an API key cannot make or undo a merge", () => {
  it("is refused with SESSION_REQUIRED, and nothing is merged", async () => {
    const issued = json<{ plaintext: string }>(
      await a.request("POST", "/api/v1/api-keys", {
        name: "[merge key]",
        permissions: ["case:write", "evidence:read"],
        expiresAt: null,
      }),
    );
    const call = (url: string, body: unknown) =>
      api.app.inject({
        method: "POST",
        url,
        headers: {
          authorization: `Bearer ${issued.plaintext}`,
          "content-type": "application/json",
        },
        payload: JSON.stringify(body),
      });
    const mergesBefore = json<{ items: unknown[] }>(await a.request("GET", "/api/v1/entity-merges"))
      .items.length;
    const made = await call("/api/v1/entity-merges", {
      survivingEntityId: seedA.entityId,
      mergedEntityId: seedA.otherEntityId,
      reason: "[a program's guess]",
      confidence: 0.9,
      matchSignals: ["NAME"],
    });
    expect(made.statusCode).toBe(403);
    expect(made.json<{ code: string }>().code).toBe("SESSION_REQUIRED");
    expect(
      json<{ items: unknown[] }>(await a.request("GET", "/api/v1/entity-merges")).items.length,
    ).toBe(mergesBefore);

    // A merge a person made cannot be undone by a key either.
    const mergeId = json<{ id: string }>(
      await a.request("POST", "/api/v1/entity-merges", {
        survivingEntityId: seedA.entityId,
        mergedEntityId: seedA.otherEntityId,
        reason: "[a person's judgement]",
        confidence: 0.7,
        matchSignals: ["ANALYST_REVIEW"],
      }),
    ).id;
    const undone = await call(`/api/v1/entity-merges/${mergeId}/undo`, {
      reason: "[a program's change of mind]",
    });
    expect(undone.statusCode).toBe(403);
    const merge = json<{
      items: { id: string; reversible: boolean; mergedBy: { userId: string | null } }[];
    }>(await a.request("GET", "/api/v1/entity-merges")).items.find((item) => item.id === mergeId);
    // Still in force, and attributed to the person who decided it.
    expect(merge?.reversible).toBe(true);
    expect(merge?.mergedBy.userId).not.toBeNull();
    // Tidy: the person undoes their own merge.
    const tidy = await a.request("POST", `/api/v1/entity-merges/${mergeId}/undo`, {
      reason: "[done]",
    });
    expect(tidy.status).toBe(200);
  });
});

describe("evidence and its payload", () => {
  const sha = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

  it("reads the full record: both times, null preserved, stated and derived claims apart", async () => {
    const response = await a.request("GET", `/api/v1/evidence/${seedA.evidenceId}`);
    expect(response.status).toBe(200);
    expect(response.body).toContain('"observedAt":null');
    const evidence = json<{
      stated: { attribute: string; value: unknown; strength: string }[];
      derived: { attribute: string; strength: string }[];
    }>(response);
    expect(json<Record<string, unknown>>(response)).toMatchObject({
      id: seedA.evidenceId,
      collectorId: "fixture",
      collectorVersion: "0.0.0-test",
      // The fixture collector is not in the platform registry: unknown stays null.
      sourceLabel: null,
      attribution: null,
      sourceUrl: "https://example.com/",
      jobId: seedA.jobId,
      runId: seedA.runId,
      contentHash: seedA.contentHash,
      observedAt: null,
      collectedAt: "2026-05-01T00:00:00.000Z",
      strength: "OBSERVED",
      claimCount: 2,
      claimsTruncated: false,
    });
    expect(evidence.stated.map((claim) => [claim.attribute, claim.strength])).toEqual([
      ["registrar", "OBSERVED"],
    ]);
    expect(evidence.stated[0]?.value).toBeNull();
    expect(evidence.derived.map((claim) => [claim.attribute, claim.strength])).toEqual([
      ["note", "DERIVED"],
    ]);
    // The payload's storage key is internal and is not exposed.
    expect(response.body).not.toContain(seedA.payloadRef);
  });

  it("marks a claim list that was cut", async () => {
    const response = await a.request("GET", `/api/v1/evidence/${seedA.evidenceId}?claimLimit=1`);
    const evidence = json<{
      claimCount: number;
      claimsTruncated: boolean;
      stated: unknown[];
      derived: unknown[];
    }>(response);
    expect(evidence.claimCount).toBe(2);
    expect(evidence.claimsTruncated).toBe(true);
    expect(evidence.stated.length + evidence.derived.length).toBe(1);
    const invalid = await a.request("GET", `/api/v1/evidence/${seedA.evidenceId}?claimLimit=0`);
    expect(invalid.status).toBe(400);
  });

  it("is 404 for evidence that does not exist", async () => {
    const unknown = "00000000-0000-4000-8000-000000000000";
    expect((await a.request("GET", `/api/v1/evidence/${unknown}`)).status).toBe(404);
    expect((await a.request("GET", `/api/v1/evidence/${unknown}/payload`)).status).toBe(404);
  });

  it("serves the payload byte for byte, as an untyped attachment, and audits the download", async () => {
    const response = await a.request("GET", `/api/v1/evidence/${seedA.evidenceId}/payload`);
    expect(response.status).toBe(200);
    expect(Buffer.compare(response.raw, Buffer.from(seedA.payload))).toBe(0);
    expect(sha(response.raw)).toBe(seedA.contentHash);
    expect(response.headers["content-type"]).toBe("application/octet-stream");
    expect(response.headers["content-disposition"]).toBe(
      `attachment; filename="evidence-${seedA.evidenceId}.bin"`,
    );
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["content-security-policy"]).toContain("sandbox");
    expect(response.headers["x-content-hash"]).toBe(seedA.contentHash);
    expect(response.headers["cache-control"]).toBe("no-store");
    const rows = await auditRows(api, tenantA);
    expect(
      rows.some(
        (row) =>
          row.action === "evidence.payload" &&
          row.outcome === "ALLOWED" &&
          row.targetId === seedA.evidenceId,
      ),
    ).toBe(true);
  });

  it("refuses a payload that no longer matches its hash, and says why; a missing one is 404", async () => {
    const fresh = await api.db.withTenant(tenantA, async ({ repos }) => {
      const record = (contentHash: string, payloadRef: string) =>
        repos.evidence.record({
          collectorId: "fixture",
          collectorVersion: "0.0.0-test",
          jobId: null,
          sourceUrl: null,
          contentHash,
          payloadRef,
          observedAt: null,
          collectedAt: null,
          claimStrength: "OBSERVED",
        });
      const stored = await api.services.runs.contentStore.put(
        tenantA,
        new TextEncoder().encode("[payload to be tampered with]"),
      );
      const tampered = await record(stored.contentHash, stored.ref);
      // Recorded, but never put in the store.
      const absentHash = hashContent(new TextEncoder().encode("[payload never stored]"));
      const absent = await record(absentHash, contentRef(tenantA, absentHash));
      return { tamperedId: tampered.id, ref: stored.ref, absentId: absent.id };
    });
    const file = join(api.contentDir, fresh.ref);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, "[someone changed these bytes]");

    const refused = await a.request("GET", `/api/v1/evidence/${fresh.tamperedId}/payload`);
    expect(refused.status).toBe(500);
    expect(json<{ code: string }>(refused).code).toBe("EVIDENCE_PAYLOAD_INTEGRITY_FAILED");
    expect(refused.body).not.toContain("someone changed");
    // The record itself still reads: only the payload was refused.
    expect((await a.request("GET", `/api/v1/evidence/${fresh.tamperedId}`)).status).toBe(200);

    const missing = await a.request("GET", `/api/v1/evidence/${fresh.absentId}/payload`);
    expect(missing.status).toBe(404);
    expect(json<{ code: string }>(missing).code).toBe("EVIDENCE_PAYLOAD_NOT_FOUND");
  });

  it("person evidence is readable only while the plan and vetting allow it", async () => {
    const c = await provisionTestTenant(api, "x-person");
    const browser = await readyBrowser(api, c.owner, c.tenantId);
    const evidenceId = await api.db.withTenant(c.tenantId, async ({ repos }) => {
      await repos.collectorsRegistry.register({
        collectorId: "fixture-person",
        sourceLabel: "[Person fixture]",
        discipline: "PERSON",
        collectionMode: "LOCAL_ANALYSIS",
        dataLicence: "[not applicable: test fixture]",
        commercialUse: "UNVERIFIED",
        enabled: true,
        disabledReason: null,
      });
      const stored = await api.services.runs.contentStore.put(
        c.tenantId,
        new TextEncoder().encode("[person payload]"),
      );
      const row = await repos.evidence.record({
        collectorId: "fixture-person",
        collectorVersion: "0.0.0-test",
        jobId: null,
        sourceUrl: null,
        contentHash: stored.contentHash,
        payloadRef: stored.ref,
        observedAt: null,
        collectedAt: null,
        claimStrength: "REPORTED",
      });
      return row.id;
    });
    for (const path of [
      `/api/v1/evidence/${evidenceId}`,
      `/api/v1/evidence/${evidenceId}/payload`,
    ]) {
      const locked = await browser.request("GET", path);
      expect(locked.status, path).toBe(403);
      expect(json<{ code: string }>(locked).code).toBe("MODULE_NOT_IN_PLAN");
    }
    await setEntitlement(c.tenantId, { plan: "TECHINT_AND_PERSON", vettingStatus: "PENDING" });
    const pending = await browser.request("GET", `/api/v1/evidence/${evidenceId}`);
    expect(json<{ code: string }>(pending).code).toBe("VETTING_NOT_APPROVED");
    await setEntitlement(c.tenantId, { vettingStatus: "APPROVED" });
    expect((await browser.request("GET", `/api/v1/evidence/${evidenceId}`)).status).toBe(200);
    const open = await browser.request("GET", `/api/v1/evidence/${evidenceId}/payload`);
    expect(open.status).toBe(200);
    await setEntitlement(c.tenantId, { vettingStatus: "SUSPENDED" });
    expect((await browser.request("GET", `/api/v1/evidence/${evidenceId}`)).status).toBe(403);
  });
});

describe("tenant B cannot reach tenant A through any new endpoint (RELEASE-BLOCKING)", () => {
  let caseA: string;
  let pinA: string;
  let mergeA: string;

  beforeAll(async () => {
    caseA = json<{ id: string }>(
      await a.request("POST", "/api/v1/cases", { title: "[A case]" }),
    ).id;
    pinA = json<{ id: string }>(
      await a.request("POST", `/api/v1/cases/${caseA}/pins`, {
        target: { type: "entity", id: seedA.entityId },
      }),
    ).id;
    mergeA = json<{ id: string }>(
      await a.request("POST", "/api/v1/entity-merges", {
        survivingEntityId: seedA.entityId,
        mergedEntityId: seedA.twinId,
        reason: "[isolation fixture]",
        confidence: 0.5,
        matchSignals: ["ANALYST_REVIEW"],
      }),
    ).id;
  });

  it("the fixture is real: A sees all of it", async () => {
    expect((await a.request("GET", `/api/v1/cases/${caseA}`)).status).toBe(200);
    expect((await a.request("GET", `/api/v1/cases/${caseA}/pins`)).status).toBe(200);
    expect((await a.request("GET", `/api/v1/entities?caseId=${caseA}`)).status).toBe(200);
  });

  it("cases: read, update, pins and unpin are 404", async () => {
    expect((await b.request("GET", `/api/v1/cases/${caseA}`)).status).toBe(404);
    expect((await b.request("PATCH", `/api/v1/cases/${caseA}`, { title: "[taken]" })).status).toBe(
      404,
    );
    expect((await b.request("GET", `/api/v1/cases/${caseA}/pins`)).status).toBe(404);
    const pin = await b.request("POST", `/api/v1/cases/${caseA}/pins`, {
      target: { type: "entity", id: seedA.entityId },
    });
    expect(pin.status).toBe(404);
    expect((await b.request("DELETE", `/api/v1/cases/${caseA}/pins/${pinA}`)).status).toBe(404);
    const own = json<{ id: string }>(
      await b.request("POST", "/api/v1/cases", { title: "[B case]" }),
    );
    // B's own case cannot pin A's records either: they do not exist for B.
    for (const [type, id] of [
      ["entity", seedA.entityId],
      ["evidence", seedA.evidenceId],
      ["claim", seedA.claimId],
    ] as const) {
      const response = await b.request("POST", `/api/v1/cases/${own.id}/pins`, {
        target: { type, id },
      });
      expect(response.status, type).toBe(404);
    }
    // A's pin is still there, and A's title is unchanged.
    expect(json<{ title: string }>(await a.request("GET", `/api/v1/cases/${caseA}`)).title).toBe(
      "[A case]",
    );
    expect(
      json<{ items: unknown[] }>(await a.request("GET", `/api/v1/cases/${caseA}/pins`)).items,
    ).toHaveLength(1);
  });

  it("the case list holds none of A's cases", async () => {
    const list = json<{ items: { id: string }[] }>(await b.request("GET", "/api/v1/cases"));
    expect(list.items.map((item) => item.id)).not.toContain(caseA);
  });

  it("entities, graph, timeline and candidates by A's case or run are 404; by A's entity id too", async () => {
    for (const scope of [`caseId=${caseA}`, `runId=${seedA.runId}`]) {
      for (const path of ["entities", "entities/merge-candidates", "graph", "timeline"]) {
        const response = await b.request("GET", `/api/v1/${path}?${scope}`);
        expect(response.status, `${path} ${scope}`).toBe(404);
      }
    }
    expect((await b.request("GET", `/api/v1/entities/${seedA.entityId}`)).status).toBe(404);
  });

  it("merges: A's cannot be listed, made or undone by B", async () => {
    const listed = json<{ items: unknown[] }>(
      await b.request("GET", `/api/v1/entity-merges?entityId=${seedA.entityId}`),
    );
    expect(listed.items).toEqual([]);
    expect(
      json<{ items: { id: string }[] }>(await b.request("GET", "/api/v1/entity-merges")).items,
    ).toEqual([]);
    const made = await b.request("POST", "/api/v1/entity-merges", {
      survivingEntityId: seedA.entityId,
      mergedEntityId: seedA.otherEntityId,
      reason: "[attack]",
      confidence: 1,
      matchSignals: ["ANALYST_REVIEW"],
    });
    expect(made.status).toBe(404);
    const undone = await b.request("POST", `/api/v1/entity-merges/${mergeA}/undo`, {
      reason: "[attack]",
    });
    expect(undone.status).toBe(404);
    const still = json<{ items: { reversible: boolean }[] }>(
      await a.request("GET", `/api/v1/entity-merges?entityId=${seedA.entityId}`),
    );
    expect(still.items.some((item) => item.reversible)).toBe(true);
  });

  it("evidence and its payload are 404 for B, and B's invitation list is its own", async () => {
    expect((await b.request("GET", `/api/v1/evidence/${seedA.evidenceId}`)).status).toBe(404);
    const payload = await b.request("GET", `/api/v1/evidence/${seedA.evidenceId}/payload`);
    expect(payload.status).toBe(404);
    expect(Buffer.compare(payload.raw, Buffer.from(seedA.payload))).not.toBe(0);
    const invited = json<{ items: { email: string }[] }>(
      await a.request("GET", "/api/v1/members/invitations"),
    ).items;
    expect(invited.length).toBeGreaterThan(0);
    const mine = json<{ items: { email: string }[] }>(
      await b.request("GET", "/api/v1/members/invitations"),
    ).items;
    for (const row of invited) expect(mine.map((item) => item.email)).not.toContain(row.email);
    // A's evidence is still readable by A.
    expect((await a.request("GET", `/api/v1/evidence/${seedA.evidenceId}`)).status).toBe(200);
  });

  it("members, retention and estimates are each tenant's own", async () => {
    const members = json<{ items: { userId: string }[] }>(
      await b.request("GET", "/api/v1/members"),
    );
    const ownA = json<{ items: { userId: string }[] }>(await a.request("GET", "/api/v1/members"));
    const bIds = new Set(members.items.map((member) => member.userId));
    for (const member of ownA.items) expect(bIds.has(member.userId)).toBe(false);
    expect(
      (
        await b.request("PATCH", `/api/v1/members/${ownA.items[0]?.userId ?? ""}`, {
          role: "viewer",
        })
      ).status,
    ).toBe(404);
    expect(
      (await b.request("DELETE", `/api/v1/members/${ownA.items[0]?.userId ?? ""}`)).status,
    ).toBe(404);

    await a.request("PUT", "/api/v1/settings/retention", { retentionDays: 45 });
    expect(
      json<{ retentionDays: number | null }>(await b.request("GET", "/api/v1/settings/retention"))
        .retentionDays,
    ).toBeNull();
    await a.request("PUT", "/api/v1/settings/retention", { retentionDays: null });
  });
});

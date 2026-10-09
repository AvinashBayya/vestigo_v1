/**
 * RELEASE-BLOCKING. D-32: a request whose route declares a snapshot runs its
 * transaction on one (REPEATABLE READ). A snapshot that conflicts with a
 * concurrent commit wrote nothing, so the request is run again once, from the
 * start, in a new transaction; a second conflict is answered 409
 * SNAPSHOT_CONFLICT. A route with no snapshot is never run twice.
 *
 * Real database and audit rows; only authentication is stubbed.
 */
import { randomUUID } from "node:crypto";
import type { TenantId } from "@repo/core";
import { SnapshotConflictError, type TenantTransactionOptions } from "@repo/db";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { enforceRouteAccess } from "../src/http/access.ts";
import { registerErrorHandling } from "../src/http/errors.ts";
import { createTestApi, provisionTestTenant, type TestApi } from "./support.ts";

let api: TestApi;
let tenantId: TenantId;
let app: FastifyInstance;
/** The options each transaction was opened with, and how often each handler ran. */
let opened: (TenantTransactionOptions | undefined)[];
let runs: number;
let lastRequestId = "";

const auditFor = async (requestId: string) =>
  (await api.db.withTenant(tenantId, ({ repos }) => repos.auditLog.recent({ limit: 100 })))
    .filter((row) => row.requestId === requestId)
    .map((row) => row.outcome)
    .sort();

beforeAll(async () => {
  api = await createTestApi();
  const provisioned = await provisionTestTenant(api, "snapshot-retry");
  tenantId = provisioned.tenantId;
  app = Fastify({ exposeHeadRoutes: false });
  registerErrorHandling(app);
  enforceRouteAccess(
    app,
    () => ({
      authenticate: () =>
        Promise.resolve({
          kind: "session",
          tenantId,
          userId: provisioned.ownerUserId,
          sessionId: randomUUID(),
          permissions: new Set(["case:read"] as const),
        }),
      withTenant: (id, work, options) => {
        opened.push(options);
        return api.db.withTenant(id, work, options);
      },
    }),
    [],
  );
  const snapshot = { permission: "case:read", action: "case.read", snapshot: true } as const;
  const plain = { permission: "case:read", action: "case.read" } as const;
  app.get("/conflicts-once", { config: { access: snapshot } }, (request) => {
    lastRequestId = request.id;
    runs += 1;
    if (runs === 1) return Promise.reject(new SnapshotConflictError());
    return Promise.resolve({ runs });
  });
  app.get("/conflicts-always", { config: { access: snapshot } }, (request) => {
    lastRequestId = request.id;
    runs += 1;
    return Promise.reject(new SnapshotConflictError());
  });
  app.get("/no-snapshot", { config: { access: plain } }, (request) => {
    lastRequestId = request.id;
    runs += 1;
    return Promise.reject(new SnapshotConflictError());
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await api.close();
});

describe("a snapshot request that conflicts with a concurrent commit (RELEASE-BLOCKING)", () => {
  it("runs once more, from the start, on a new snapshot, and is answered", async () => {
    opened = [];
    runs = 0;
    const response = await app.inject({ method: "GET", url: "/conflicts-once" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ runs: 2 });
    expect(opened).toEqual([{ snapshot: true }, { snapshot: true }]);
    // The first run's transaction rolled back with its audit row; the second committed.
    expect(await auditFor(lastRequestId)).toEqual(["ALLOWED"]);
  });

  it("is refused 409 SNAPSHOT_CONFLICT after a second conflict, never run a third time", async () => {
    opened = [];
    runs = 0;
    const response = await app.inject({ method: "GET", url: "/conflicts-always" });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "SNAPSHOT_CONFLICT" });
    expect(runs).toBe(2);
    expect(await auditFor(lastRequestId)).toEqual(["FAILED"]);
  });

  it("is never run twice when its route declares no snapshot", async () => {
    opened = [];
    runs = 0;
    const response = await app.inject({ method: "GET", url: "/no-snapshot" });
    expect(response.statusCode).toBe(409);
    expect(runs).toBe(1);
    expect(opened[0]).toEqual({ snapshot: false });
  });
});

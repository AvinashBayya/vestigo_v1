/**
 * Work a handler defers with afterCommit runs only once the request's tenant
 * transaction has committed, its ALLOWED audit row included, and outside any
 * transaction. REGRESSION (Phase 5 live checkpoint): the PDF export rendered
 * inside the request's transaction, the connection sat idle in transaction
 * past the server's timeout, and the server ended it.
 *
 * Real database and audit rows; only authentication is stubbed.
 */
import { randomUUID } from "node:crypto";
import { AppError, type TenantId } from "@repo/core";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { afterCommit, enforceRouteAccess, tenantOf } from "../src/http/access.ts";
import { createTestApi, provisionTestTenant, type TestApi } from "./support.ts";

class DeferredWorkFailed extends AppError {
  readonly code = "DEFERRED_WORK_FAILED";
}

let api: TestApi;
let tenantId: TenantId;
let app: FastifyInstance;
/** What happened, in order, across the request and its transaction. */
let events: string[];
let lastRequestId = "";

const auditFor = async (requestId: string) =>
  (await api.db.withTenant(tenantId, ({ repos }) => repos.auditLog.recent({ limit: 100 })))
    .filter((row) => row.requestId === requestId)
    .map((row) => row.outcome);

beforeAll(async () => {
  api = await createTestApi();
  const provisioned = await provisionTestTenant(api, "defer");
  tenantId = provisioned.tenantId;
  app = Fastify({ exposeHeadRoutes: false });
  enforceRouteAccess(
    app,
    () => ({
      authenticate: () =>
        Promise.resolve({
          kind: "session",
          tenantId,
          userId: provisioned.ownerUserId,
          sessionId: randomUUID(),
          permissions: new Set(["report:read"] as const),
        }),
      withTenant: async (id, work) => {
        const result = await api.db.withTenant(id, work);
        events.push("committed");
        return result;
      },
    }),
    [],
  );
  const access = { permission: "report:read", action: "report.export" } as const;
  app.get("/deferred", { config: { access } }, (request) => {
    events.push("handler");
    afterCommit(request, async () => {
      events.push("deferred");
      // No tenant transaction here, and the handler's audit row is already committed.
      expect(() => tenantOf(request)).toThrow();
      expect(await auditFor(request.id)).toEqual(["ALLOWED"]);
      return { delivered: true };
    });
    return Promise.resolve({ delivered: false });
  });
  app.get("/deferred-fails", { config: { access } }, (request) => {
    lastRequestId = request.id;
    afterCommit(request, () => Promise.reject(new DeferredWorkFailed("[render failed]")));
    return Promise.resolve({});
  });
  app.get("/handler-fails", { config: { access } }, (request) => {
    afterCommit(request, () => {
      events.push("deferred");
      return Promise.resolve({});
    });
    return Promise.reject(new DeferredWorkFailed("[handler failed]"));
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await api.close();
});

describe("work deferred until the request's transaction commits", () => {
  it("runs after the commit, outside any transaction, and answers the request", async () => {
    events = [];
    const response = await app.inject({ method: "GET", url: "/deferred" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ delivered: true });
    expect(events).toEqual(["handler", "committed", "deferred"]);
  });

  it("is audited FAILED, besides the committed ALLOWED row, when it throws", async () => {
    events = [];
    const response = await app.inject({ method: "GET", url: "/deferred-fails" });
    expect(response.statusCode).toBe(500);
    expect((await auditFor(lastRequestId)).sort()).toEqual(["ALLOWED", "FAILED"]);
  });

  it("never runs when the handler's own transaction fails", async () => {
    events = [];
    const response = await app.inject({ method: "GET", url: "/handler-fails" });
    expect(response.statusCode).toBe(500);
    expect(events).not.toContain("deferred");
  });
});

/**
 * REGRESSION (Phase 5 live checkpoint): one request losing its database
 * connection must fail only that request. The live checkpoint's PDF export
 * held its transaction until the server ended it, the connection's error went
 * unhandled, and the whole API process exited: every tenant's requests failed
 * with it. A bulkhead violation (CLAUDE.md §5).
 *
 * Here a request is held mid-transaction (it waits on a table lock), its
 * database backend is terminated, and the API must answer that request with a
 * typed, retryable error and keep serving: the same tenant, and another.
 */
import { setTimeout as sleep } from "node:timers/promises";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_API } from "./config.ts";
import {
  createTestApi,
  provisionTestTenant,
  readyBrowser,
  type Browser,
  type TestApi,
} from "./support.ts";

let api: TestApi;
let first: Browser;
let second: Browser;

beforeAll(async () => {
  api = await createTestApi();
  const a = await provisionTestTenant(api, "conn-a");
  const b = await provisionTestTenant(api, "conn-b");
  first = await readyBrowser(api, a.owner, a.tenantId);
  second = await readyBrowser(api, b.owner, b.tenantId);
});

afterAll(async () => {
  await api.close();
});

/** The backend of the API's request that is waiting on a lock, once it is waiting. */
async function waitingBackend(observer: pg.Client): Promise<number> {
  for (let tries = 0; tries < 100; tries += 1) {
    const { rows } = await observer.query<{ pid: number }>(
      `select pid from pg_stat_activity
        where application_name = 'app-runtime' and wait_event_type = 'Lock' and pid <> pg_backend_pid()`,
    );
    const [row] = rows;
    if (row !== undefined) return row.pid;
    await sleep(50);
  }
  throw new Error("no API request ever waited on the lock");
}

describe("a request whose database connection is lost", () => {
  it("fails alone, with a typed retryable error; the API keeps serving every tenant", async () => {
    const created = await first.request("POST", "/api/v1/investigations", {
      title: "[investigation]",
      target: "example.com",
    });
    expect(created.status).toBe(201);
    const { id } = created.json<{ id: string }>();

    // The schema owner locks the table, so the request below waits mid-transaction.
    const locker = new pg.Client({ connectionString: TEST_API.ownerUrl });
    // The runtime role may signal its own role's backends: no superuser is involved.
    const observer = new pg.Client({ connectionString: TEST_API.runtimeUrl });
    await Promise.all([locker.connect(), observer.connect()]);
    let held: Awaited<ReturnType<Browser["request"]>>;
    try {
      await locker.query("begin");
      await locker.query("lock table public.investigations in access exclusive mode");
      const pending = first.request("GET", `/api/v1/investigations/${id}`);
      const pid = await waitingBackend(observer);
      await observer.query("select pg_terminate_backend($1)", [pid]);
      held = await pending;
    } finally {
      await locker.query("rollback").catch(() => undefined);
      await Promise.all([locker.end(), observer.end()]);
    }

    // The request that lost its connection is told so, and may retry.
    expect(held.status).toBe(503);
    expect(held.json<{ code: string }>().code).toBe("DB_CONNECTION_LOST");

    // The process survived: the same request now succeeds, and another tenant is served.
    const again = await first.request("GET", `/api/v1/investigations/${id}`);
    expect(again.status).toBe(200);
    expect((await second.request("GET", "/api/v1/me")).status).toBe(200);
    expect((await second.request("GET", "/api/v1/investigations")).status).toBe(200);
  });
});

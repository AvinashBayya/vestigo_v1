/**
 * REGRESSION (Phase 5 live checkpoint): a connection that fails while it is
 * checked out of the pool must fail only the work using it, never the
 * process. pg-pool listens for a connection's errors only while it is idle;
 * a checked-out connection that the server ends between statements emitted
 * an 'error' event nobody handled, and Node ended the whole API process (a
 * PDF export held its transaction idle past the server's timeout: SQLSTATE
 * 25P03). One tenant's slow request took every other tenant's down with it.
 */
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabase } from "../src/database.ts";
import { DatabaseConnectionLostError } from "../src/errors.ts";
import { TEST_DATABASE } from "./config.ts";
import { newTenantId } from "./support.ts";

/** A short server-side idle-in-transaction timeout, so the server ends the transaction quickly. */
const IDLE_TIMEOUT_MS = 250;

describe("a connection that fails while checked out", () => {
  const reported: Error[] = [];
  const db = createDatabase({
    connectionString: TEST_DATABASE.runtimeUrl,
    statementTimeoutMs: IDLE_TIMEOUT_MS,
    onConnectionError: (error) => reported.push(error),
  });
  afterAll(() => db.close());

  it("fails only its own work, with a typed error, and the next work proceeds", async () => {
    const tenantId = newTenantId();
    const failed = await db
      .withTenant(tenantId, async ({ repos }) => {
        await repos.tenants.current();
        // Idle inside the transaction past the server's timeout: the server
        // ends the connection while it is still checked out.
        await sleep(IDLE_TIMEOUT_MS * 4);
        return repos.tenants.current();
      })
      .catch((error: unknown) => error);

    expect(failed).toBeInstanceOf(DatabaseConnectionLostError);
    expect(failed).toMatchObject({ code: "DB_CONNECTION_LOST" });
    // The connection's error reached the host's handler instead of crashing the process.
    expect(reported.map((error) => (error as Error & { code?: string }).code)).toEqual(["25P03"]);

    // The broken connection was discarded; the pool serves the next work.
    await expect(
      db.withTenant(tenantId, ({ repos }) => repos.tenants.current()),
    ).resolves.toBeNull();
  });
});

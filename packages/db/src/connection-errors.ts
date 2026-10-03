import type pg from "pg";

/**
 * Every pooled connection reports its errors for its whole life.
 *
 * pg-pool listens for a connection's 'error' events only while the connection
 * is idle in the pool, and removes that listener while it is checked out. A
 * checked-out connection that fails between statements (the server ending an
 * idle transaction, an operator terminating the backend, a restart, a network
 * drop) then emits an 'error' event nobody handles, and Node ends the whole
 * process: one tenant's request takes every other tenant's down with it (seen
 * at the Phase 5 live checkpoint, SQLSTATE 25P03; CLAUDE.md §5 bulkheads).
 *
 * With a listener on every connection from the moment the pool creates it,
 * such an error is reported to the host and the process carries on. pg-pool
 * discards the broken connection when it is released, and the work using it
 * fails on its next statement with DatabaseConnectionLostError.
 */
export function reportConnectionErrors(pool: pg.Pool, report: (error: Error) => void): void {
  // Every connection the pool opens is announced here before first use.
  pool.on("connect", (client) => {
    // A connection fails once, but the driver can emit twice for it: the
    // server's reason (e.g. 25P03), then "Connection terminated unexpectedly"
    // when the socket closes. The first, which says why, is reported.
    let failed = false;
    client.on("error", (error: Error) => {
      if (failed) return;
      failed = true;
      report(error);
    });
  });
  // pg-pool also re-emits an idle connection's error on the pool itself, and
  // an 'error' event with no listener would end the process. The
  // connection's own listener above has already reported it.
  pool.on("error", () => undefined);
}

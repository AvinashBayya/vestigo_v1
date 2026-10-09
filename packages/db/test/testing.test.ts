/**
 * The test setup when the database server is down: a clear failure that says
 * where it looked and how to start the server, instead of an unhandled
 * connection error, and never the credentials in the URL.
 */
import { describe, expect, it } from "vitest";
import { recreateTestDatabase, TestDatabaseUnreachableError } from "../src/testing.ts";

describe("recreateTestDatabase with no server to reach", () => {
  it("fails with where it looked and how to start the server, never the credentials", async () => {
    // Port 1 on the loopback address: nothing listens there.
    const attempt = recreateTestDatabase({
      ownerUrl: "postgres://placeholder_user:placeholder-password@127.0.0.1:1/unreachable_test",
      connectRoles: [],
    });
    const error: unknown = await attempt.then(
      () => expect.fail("[test] the setup reached a server on port 1"),
      (failure: unknown) => failure,
    );
    expect(error).toBeInstanceOf(TestDatabaseUnreachableError);
    expect(error).toMatchObject({ code: "TEST_DATABASE_UNREACHABLE" });
    const message = error instanceof Error ? error.message : "";
    expect(message).toMatch(
      /^The test database server is not reachable at 127\.0\.0\.1:1 \((ECONNREFUSED|timed out)\)\. /,
    );
    expect(message).toContain('"docker compose up -d --wait"');
    expect(message).not.toContain("placeholder-password");
    expect(message).not.toContain("placeholder_user");
  }, 20_000);
});

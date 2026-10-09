/**
 * Test support, exported as `@repo/db/testing`. Never imported by application
 * code: it drops and recreates databases.
 */
import { AppError } from "@repo/core";
import pg from "pg";
import { migrateDatabase } from "./migrate.ts";

export class UnsafeTestDatabaseError extends AppError {
  readonly code = "TEST_DATABASE_UNSAFE";

  constructor(message: string) {
    super(message);
    this.name = "UnsafeTestDatabaseError";
  }
}

/**
 * The test database server could not be reached. Says where it looked (host
 * and port, never the credentials) and how to start it, instead of an
 * unhandled connection error.
 */
export class TestDatabaseUnreachableError extends AppError {
  readonly code = "TEST_DATABASE_UNREACHABLE";

  constructor(where: string, cause: string) {
    super(
      `The test database server is not reachable at ${where} (${cause}). Start it from the repository root with "docker compose up -d --wait", then run the tests again.`,
    );
    this.name = "TestDatabaseUnreachableError";
  }
}

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/** How long a test setup waits for the database server before saying it is unreachable. */
const CONNECT_TIMEOUT_MS = 5_000;

/** Connection failures that mean no server answered, as the driver reports them. */
const UNREACHABLE = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
]);

/** Connects, or fails with TestDatabaseUnreachableError when no server answers. */
async function connectOrExplain(client: pg.Client, url: URL): Promise<void> {
  try {
    await client.connect();
  } catch (error) {
    const code =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : null;
    const timedOut = error instanceof Error && /timeout/i.test(error.message);
    if ((code !== null && UNREACHABLE.has(code)) || timedOut) {
      const where =
        url.port === "" ? `${url.hostname} (default port)` : `${url.hostname}:${url.port}`;
      throw new TestDatabaseUnreachableError(where, code === null ? "timed out" : code);
    }
    throw error;
  }
}

/**
 * Drops and recreates the database named in `ownerUrl`, grants CONNECT to the
 * given roles, and applies every migration, so a suite always runs against
 * exactly what the migrations produce. Refuses any database whose name does
 * not end in `_test`, so a misconfigured URL cannot drop a real database, and
 * fails with TestDatabaseUnreachableError, saying how to start the server,
 * when no server answers.
 */
export async function recreateTestDatabase(options: {
  readonly ownerUrl: string;
  readonly connectRoles: readonly string[];
}): Promise<void> {
  const owner = new URL(options.ownerUrl);
  const databaseName = owner.pathname.slice(1);
  if (!IDENTIFIER.test(databaseName) || !databaseName.endsWith("_test")) {
    throw new UnsafeTestDatabaseError(
      `refusing to recreate "${databaseName}": a test database name must end in _test`,
    );
  }
  for (const role of options.connectRoles) {
    if (!IDENTIFIER.test(role))
      throw new UnsafeTestDatabaseError(`"${role}" is not a plain role name`);
  }

  const maintenance = new URL(options.ownerUrl);
  maintenance.pathname = "/postgres";
  const client = new pg.Client({
    connectionString: maintenance.toString(),
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
  });
  await connectOrExplain(client, maintenance);
  try {
    await client.query(`drop database if exists ${databaseName} with (force)`);
    await client.query(`create database ${databaseName}`);
    await client.query(`revoke all on database ${databaseName} from public`);
    if (options.connectRoles.length > 0) {
      await client.query(
        `grant connect on database ${databaseName} to ${options.connectRoles.join(", ")}`,
      );
    }
  } finally {
    await client.end();
  }

  await migrateDatabase(options.ownerUrl);
}

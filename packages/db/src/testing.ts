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

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/**
 * Drops and recreates the database named in `ownerUrl`, grants CONNECT to the
 * given roles, and applies every migration, so a suite always runs against
 * exactly what the migrations produce. Refuses any database whose name does
 * not end in `_test`, so a misconfigured URL cannot drop a real database.
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
  const client = new pg.Client({ connectionString: maintenance.toString() });
  await client.connect();
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

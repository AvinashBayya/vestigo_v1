import pg from "pg";
import { MigrationRoleError, migrateDatabase } from "../src/migrate.ts";
import { TEST_DATABASE } from "./config.ts";

/**
 * Recreates the test database from nothing and applies every migration, so
 * the suite always runs against exactly what the migrations produce.
 */
export default async function setup(): Promise<void> {
  const owner = new URL(TEST_DATABASE.ownerUrl);
  const databaseName = owner.pathname.slice(1);
  const runtimeRole = new URL(TEST_DATABASE.runtimeUrl).username;

  // Guard against a misconfigured URL dropping a real database.
  if (!/^[a-z_][a-z0-9_]*_test$/.test(databaseName)) {
    throw new MigrationRoleError(
      `refusing to recreate "${databaseName}": the test database name must end in _test`,
    );
  }
  if (!/^[a-z_][a-z0-9_]*$/.test(runtimeRole)) {
    throw new MigrationRoleError(
      "the runtime role name in TEST_DATABASE_URL is not a plain identifier",
    );
  }

  const maintenance = new URL(TEST_DATABASE.ownerUrl);
  maintenance.pathname = "/postgres";
  const client = new pg.Client({ connectionString: maintenance.toString() });
  await client.connect();
  try {
    await client.query(`drop database if exists ${databaseName} with (force)`);
    await client.query(`create database ${databaseName}`);
    await client.query(`revoke all on database ${databaseName} from public`);
    await client.query(`grant connect on database ${databaseName} to ${runtimeRole}`);
  } finally {
    await client.end();
  }

  await migrateDatabase(TEST_DATABASE.ownerUrl);
}

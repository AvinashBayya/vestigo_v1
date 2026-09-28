/**
 * Applies pending migrations as the schema owner (DATABASE_MIGRATION_URL).
 * Forward-only: there are no down migrations. Run with `pnpm db:migrate`.
 */
import { ConfigError, loadEnvSubset } from "@repo/config";
import { migrateDatabase } from "../src/migrate.ts";

const { DATABASE_MIGRATION_URL } = loadEnvSubset(["DATABASE_MIGRATION_URL"]);
if (DATABASE_MIGRATION_URL === undefined) {
  throw new ConfigError([
    { variable: "DATABASE_MIGRATION_URL", problem: "required by db:migrate but not set" },
  ]);
}

const result = await migrateDatabase(DATABASE_MIGRATION_URL);
console.log(
  `Migrations applied as ${result.role}. Evidence partitions created this run: ${String(result.partitionsCreated)}.`,
);

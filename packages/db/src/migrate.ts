import { fileURLToPath } from "node:url";
import { AppError } from "@repo/core";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

export class MigrationRoleError extends AppError {
  readonly code = "MIGRATION_ROLE_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "MigrationRoleError";
  }
}

/** Months of evidence partitions kept ahead of today on every migrate run. */
const PARTITION_MONTHS_AHEAD = 13;

export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../migrations", import.meta.url));

export interface MigrationResult {
  readonly role: string;
  readonly partitionsCreated: number;
}

/**
 * Applies pending migrations (forward-only) as the schema owner, then makes
 * sure evidence partitions exist for the current month and the next twelve.
 * Refuses to run as a superuser or a BYPASSRLS role.
 */
export async function migrateDatabase(ownerConnectionString: string): Promise<MigrationResult> {
  const pool = new pg.Pool({
    connectionString: ownerConnectionString,
    max: 1,
    connectionTimeoutMillis: 5_000,
    application_name: "app-migrate",
  });
  try {
    const role = await pool.query<{ role: string; rolsuper: boolean; rolbypassrls: boolean }>(
      "select current_user as role, rolsuper, rolbypassrls from pg_roles where rolname = current_user",
    );
    const current = role.rows[0];
    if (current === undefined) throw new MigrationRoleError("could not read the connecting role");
    if (current.rolsuper || current.rolbypassrls) {
      throw new MigrationRoleError(
        `refusing to migrate as "${current.role}": migrations run as the schema owner, never a superuser or BYPASSRLS role`,
      );
    }

    await migrate(drizzle({ client: pool }), { migrationsFolder: MIGRATIONS_FOLDER });

    const ensured = await pool.query<{ created: number }>(
      "select app.ensure_evidence_partitions((now() at time zone 'UTC')::date, $1) as created",
      [PARTITION_MONTHS_AHEAD],
    );
    const created = ensured.rows[0]?.created;
    if (created === undefined)
      throw new MigrationRoleError("partition maintenance returned no result");
    return { role: current.role, partitionsCreated: created };
  } finally {
    await pool.end();
  }
}

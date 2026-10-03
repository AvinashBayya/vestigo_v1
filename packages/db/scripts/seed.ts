/**
 * Seeds two development tenants with distinct data, as the application role.
 * Run with `pnpm db:seed` after `pnpm db:migrate`. Idempotent.
 */
import { ConfigError, loadEnvSubset, resolveContentStoreDir } from "@repo/config";
import { FileSystemContentStore } from "../src/content-store.ts";
import { createDatabase } from "../src/database.ts";
import { seedDevelopmentTenants } from "./seed-data.ts";

const env = loadEnvSubset(["DATABASE_URL", "CONTENT_STORE_DIR"]);
if (env.CONTENT_STORE_DIR === undefined) {
  throw new ConfigError([
    { variable: "CONTENT_STORE_DIR", problem: "required by db:seed but not set" },
  ]);
}

const db = createDatabase({
  connectionString: env.DATABASE_URL,
  onConnectionError: (error) => {
    console.error("database connection error:", error.message);
  },
});
const store = new FileSystemContentStore(resolveContentStoreDir(env.CONTENT_STORE_DIR));

try {
  const seeded = await seedDevelopmentTenants(db, store);
  console.table(
    seeded.map((tenant) => ({
      tenant_id: tenant.tenantId,
      name: tenant.name,
      result: tenant.created ? "created" : "already present, left untouched",
      case_id: tenant.caseId ?? "—",
      evidence_id: tenant.evidenceId ?? "—",
    })),
  );
} finally {
  await db.close();
}

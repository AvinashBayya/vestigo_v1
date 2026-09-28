/**
 * Test connections. Defaults match docker-compose.yml; override with the
 * TEST_INTEGRATIONS_DATABASE_* and TEST_REDIS_URL variables. The test
 * database is dropped and recreated on every run, so it must be separate from
 * the development database and from packages/db's test database.
 */
export const TEST_CONFIG = {
  /** The application role: what every test runs as. */
  databaseUrl:
    process.env.TEST_INTEGRATIONS_DATABASE_URL ??
    "postgres://app_runtime:app_runtime@127.0.0.1:5432/app_integrations_test",
  /** The schema owner: recreates the database and applies migrations. */
  databaseOwnerUrl:
    process.env.TEST_INTEGRATIONS_DATABASE_OWNER_URL ??
    "postgres://app_owner:app_owner@127.0.0.1:5432/app_integrations_test",
  /** Logical database 15, so tests never touch development keys. */
  redisUrl: process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:6379/15",
} as const;

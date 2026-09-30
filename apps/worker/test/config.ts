/**
 * The worker suite's own database and Redis. Separate from the other suites'
 * databases, because turbo runs them in parallel and each recreates its
 * database from nothing.
 */
export const TEST_WORKER = {
  /** The application role: what the worker runs as. */
  databaseUrl:
    process.env.TEST_WORKER_DATABASE_URL ??
    "postgres://app_runtime:app_runtime@127.0.0.1:5432/app_worker_test",
  /** The schema owner: recreates the database. */
  databaseOwnerUrl:
    process.env.TEST_WORKER_DATABASE_OWNER_URL ??
    "postgres://app_owner:app_owner@127.0.0.1:5432/app_worker_test",
  /** Logical database 15, so tests never touch development keys. */
  redisUrl: process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:6379/15",
} as const;

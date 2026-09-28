/**
 * The API suite's own database and Redis. Separate from the db and
 * integrations suites' databases, because turbo runs them in parallel and
 * each recreates its database from nothing.
 */
export const TEST_API = {
  runtimeUrl:
    process.env.TEST_API_DATABASE_URL ??
    "postgres://app_runtime:app_runtime@127.0.0.1:5432/app_api_test",
  authUrl:
    process.env.TEST_API_DATABASE_AUTH_URL ??
    "postgres://app_auth:app_auth@127.0.0.1:5432/app_api_test",
  ownerUrl:
    process.env.TEST_API_DATABASE_OWNER_URL ??
    "postgres://app_owner:app_owner@127.0.0.1:5432/app_api_test",
  redisUrl: process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:6379/15",
} as const;

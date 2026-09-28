/**
 * Test database connections. Defaults match docker-compose.yml; override with
 * the TEST_DATABASE_* variables. The test database is dropped and recreated
 * on every run, so it must be separate from the development database.
 */
export const TEST_DATABASE = {
  /** The application role: what every repository test runs as. */
  runtimeUrl:
    process.env.TEST_DATABASE_URL ?? "postgres://app_runtime:app_runtime@127.0.0.1:5432/app_test",
  /** The schema owner: migrations, and owner-level checks of the triggers. */
  ownerUrl:
    process.env.TEST_DATABASE_OWNER_URL ?? "postgres://app_owner:app_owner@127.0.0.1:5432/app_test",
  /** The identity role: the auth schema only. */
  authUrl:
    process.env.TEST_DATABASE_AUTH_URL ?? "postgres://app_auth:app_auth@127.0.0.1:5432/app_test",
  /** A superuser, used only to prove the application refuses to run as one. */
  superuserUrl:
    process.env.TEST_DATABASE_SUPERUSER_URL ??
    "postgres://postgres:postgres@127.0.0.1:5432/app_test",
} as const;

// The package's public surface. The connection pool, the raw Drizzle client and
// the scope registry are deliberately not exported: tenant data is reachable
// only through Database.withTenant() and the repositories it hands out.
export { createDatabase, UnsafeDatabaseRoleError } from "./database.ts";
export type { Database, DatabaseOptions, TenantContext } from "./database.ts";
export { TenantScope } from "./scope.ts";
export { createAuthStore, UnsafeAuthRoleError } from "./auth-store.ts";
export type {
  AuthStore,
  AuthStoreOptions,
  PendingInvitation,
  SessionStanding,
} from "./auth-store.ts";
export { AUTH_TABLE_NAMES, authTables } from "./schema/auth.ts";
export { migrateDatabase, MigrationRoleError, MIGRATIONS_FOLDER } from "./migrate.ts";
export type { MigrationResult } from "./migrate.ts";
export {
  contentRef,
  ContentIntegrityError,
  ContentNotFoundError,
  FileSystemContentStore,
  hashContent,
  InvalidContentHashError,
} from "./content-store.ts";
export type { ContentHash, ContentStore, StoredContent } from "./content-store.ts";
export * from "./errors.ts";
export * from "./repositories/index.ts";

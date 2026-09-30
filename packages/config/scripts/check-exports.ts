/**
 * CI gate: every package entry point still exports the symbols listed below.
 * Wired into the turbo `test` task. When a package gains public API that other
 * code will depend on, add it here in the same change.
 */
import { checkExports } from "./exports.ts";
import { findRepoRoot } from "./repo-root.ts";

const REQUIRED_EXPORTS: Readonly<Record<string, readonly string[]>> = {
  "packages/config/src/index.ts": [
    "PRODUCT_NAME",
    "envSchema",
    "loadEnv",
    "loadEnvSubset",
    "allowsUnverifiedSources",
    "Env",
    "EnvSource",
    "ConfigError",
    "ConfigIssue",
  ],
  "packages/core/src/index.ts": [
    "AppError",
    "NotImplementedError",
    "parseTenantId",
    "TenantId",
    "InvalidTenantIdError",
    "CLAIM_STRENGTHS",
    "ClaimStrength",
    "ENTITY_KINDS",
    "NAME_ONLY_AUTOMERGE_FORBIDDEN",
    "detectTargetType",
    "EmptyTargetError",
    "JOB_OUTCOMES",
    "QUOTA_PERIODS",
  ],
  // Who may do what, for the API and the workers alike.
  "packages/access/src/index.ts": [
    "PERMISSIONS",
    "Permission",
    "isPermission",
    "ROLE_PERMISSIONS",
    "permissionsForRoles",
    "PERMISSION_MODULE",
    "decideModuleAccess",
    "decidePermissionModuleAccess",
    "PLANS",
    "VETTING_STATUSES",
    "generateApiKey",
    "parseApiKey",
    "hashApiKeySecret",
    "secretMatches",
    "grantableApiKeyScope",
    "capApiKeyPermissions",
    "ApiKeyScopeError",
    "decideDisciplineAccess",
  ],
  // The collector frame: catalogue, registry, runtime and the evidence path's pure half.
  "packages/collectors/src/index.ts": [
    "PLATFORM_SOURCES",
    "defineCollector",
    "declareCollector",
    "CollectorRegistry",
    "CollectorRuntime",
    "evidenceDrafts",
    "tenantRegistration",
    "parseTarget",
    "validateSource",
    "Collector",
    "CollectionOutcome",
    "UpstreamRateLimiter",
    "UsageMeter",
    "PLATFORM_COLLECTORS",
    "createPlatformRegistry",
  ],
  // The one path from a collector's result to evidence rows, and the job
  // system around it: planning, per-source queues, fault isolation, fusion.
  "packages/osint-engine/src/index.ts": [
    "CollectionExecutor",
    "VaultCredentialSource",
    "redisUpstreamRateLimiter",
    "planRun",
    "RunCoordinator",
    "CollectorJobProcessor",
    "RunFusion",
    "InvestigationQueue",
    "JobReplayer",
    "startWorkerPool",
    "readRunProgress",
    "usageSummary",
    "jobIdempotencyKey",
  ],
  // The only way to tenant data: withTenant() and the repositories it issues.
  "packages/db/src/index.ts": [
    "createDatabase",
    "Database",
    "TenantContext",
    "TenantScope",
    "UnsafeDatabaseRoleError",
    "migrateDatabase",
    "createRepositories",
    "REPOSITORY_TABLES",
    "TenantRepository",
    "EvidenceRepository",
    "EntityMergesRepository",
    "AuditLogRepository",
    "TenantContextError",
    "FileSystemContentStore",
    "ContentStore",
    "hashContent",
    "contentRef",
    "createAuthStore",
    "AuthStore",
    "AUTH_TABLE_NAMES",
    "CollectorNotEnabledError",
    "ScopeAuthorisationsRepository",
    "TenantQuotasRepository",
    "JobRecordedOnceError",
  ],
  // Secrets, API key storage and rate limits: the only paths to each.
  "packages/integrations/src/index.ts": [
    "CredentialVault",
    "MasterKey",
    "SecretValue",
    "ApiKeyService",
    "FixedWindowRateLimiter",
    "SlidingLogRateLimiter",
    "RateLimiterUnavailableError",
    "createRedisClient",
    "RedisCircuitBreaker",
    "CircuitBreakerUnavailableError",
  ],
};

const root = findRepoRoot(process.cwd());
const { checked, problems } = checkExports(root, REQUIRED_EXPORTS);

for (const problem of problems) {
  if (problem.problem === "missing-file") {
    console.error(`❌ Entry point not found: ${problem.entry}`);
  } else {
    console.error(`❌ MISSING EXPORT in ${problem.entry}: ${String(problem.symbol)}`);
  }
}

if (problems.length > 0) {
  console.error(`\ncheck-exports FAILED — ${String(problems.length)} problem(s).`);
  process.exit(1);
}
const files = Object.keys(REQUIRED_EXPORTS).length;
console.log(
  `check-exports passed — ${String(checked)} symbols across ${String(files)} entry points.`,
);

import {
  allowsUnverifiedSources,
  ConfigError,
  loadEnv,
  resolveContentStoreDir,
  resolveLlmConfiguration,
  type Env,
} from "@repo/config";
import { createAuthStore, createDatabase, FileSystemContentStore } from "@repo/db";
import {
  ApiKeyService,
  CredentialVault,
  createRedisClient,
  waitForRedisReady,
  FixedWindowRateLimiter,
  MasterKey,
  SlidingLogRateLimiter,
} from "@repo/integrations";
import {
  CollectorRuntime,
  createPlatformRegistry,
  HELD_PLATFORM_COLLECTORS,
} from "@repo/collectors";
import {
  CaseAnalysisQueue,
  caseAnalysisCollectors,
  InvestigationQueue,
  JobReplayer,
  redisUpstreamRateLimiter,
  ReportQueue,
  ReportRenderQueue,
} from "@repo/osint-engine";
import { buildApp } from "./app.ts";
import { createAuth } from "./auth/better-auth.ts";

function loadEnvOrExit(): Env {
  try {
    return loadEnv();
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`[${error.code}] ${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
}

const env = loadEnvOrExit();
const logConnectionError = (error: Error) => {
  process.stderr.write(`database connection error: ${error.message}\n`);
};

const db = createDatabase({
  connectionString: env.DATABASE_URL,
  onConnectionError: logConnectionError,
});
const authStore = createAuthStore({
  connectionString: env.DATABASE_AUTH_URL,
  onConnectionError: logConnectionError,
});
// Refuse to start on an identity role that could reach tenant data.
await authStore.verifyRole();

const redis = createRedisClient({
  url: env.REDIS_URL,
  commandTimeoutMs: 1_000,
  connectTimeoutMs: 2_000,
});
await waitForRedisReady(redis, { timeoutMs: 5_000 });
const trustedOrigins = new Set([env.WEB_ORIGIN, new URL(env.AUTH_BASE_URL).origin]);

// The API only enqueues work; the worker pools do it (ARCHITECTURE-DECISIONS §6).
const queueConnection = { url: env.REDIS_URL, prefix: env.QUEUE_PREFIX };
const retry = {
  maxAttempts: env.JOB_MAX_ATTEMPTS,
  baseDelayMs: env.JOB_RETRY_BASE_MS,
  maxDelayMs: env.JOB_RETRY_MAX_MS,
};
const registry = createPlatformRegistry();
// Admission only, to estimate a run before it starts: the API never fetches.
const unverifiedSourcesAllowed = allowsUnverifiedSources(env);
const planner = new CollectorRuntime({
  registry,
  allowUnverifiedSources: unverifiedSourcesAllowed,
  network: {
    rateLimiter: redisUpstreamRateLimiter(
      new SlidingLogRateLimiter({ redis, keyPrefix: `${env.QUEUE_PREFIX}:upstream` }),
    ),
  },
});
const investigations = new InvestigationQueue(queueConnection, retry);
const replayer = new JobReplayer({ db, registry, connection: queueConnection, retry });
const reports = new ReportQueue(queueConnection, retry);
const renders = new ReportRenderQueue(queueConnection, retry);
const caseAnalyses = new CaseAnalysisQueue(queueConnection, retry);
// Report PDFs are served from the store the worker renders them into.
if (env.CONTENT_STORE_DIR === undefined) {
  throw new ConfigError([
    { variable: "CONTENT_STORE_DIR", problem: "required by the API, to serve stored report PDFs" },
  ]);
}
const contentStore = new FileSystemContentStore(resolveContentStoreDir(env.CONTENT_STORE_DIR));
// Resolved here as the worker resolves it, so a misconfigured profile stops startup.
const llm = resolveLlmConfiguration(env);

const app = await buildApp({
  logger: { level: env.LOG_LEVEL },
  services: {
    db,
    authStore,
    auth: createAuth({
      authStore,
      db,
      secret: env.AUTH_SECRET,
      baseUrl: env.AUTH_BASE_URL,
      trustedOrigins: [...trustedOrigins],
      rateLimit: { enabled: true },
      logLevel: env.LOG_LEVEL,
    }),
    vault: new CredentialVault(
      new MasterKey({ keyId: env.VAULT_MASTER_KEY_ID, keyBase64: env.VAULT_MASTER_KEY }),
    ),
    apiKeys: new ApiKeyService(),
    rateLimiter: new FixedWindowRateLimiter({ redis, keyPrefix: "rate-limit:" }),
    apiKeyRateLimit: { limit: env.API_KEY_RATE_LIMIT_PER_MINUTE, windowSeconds: 60 },
    trustedOrigins,
    runs: {
      investigations,
      replayer,
      registry,
      planner,
      unverifiedSourcesAllowed,
      eventsPollMs: env.RUN_EVENTS_POLL_MS,
      reports,
      renders,
      contentStore,
      synthesisUnavailable: llm.status === "READY" ? null : llm.reason,
      caseAnalyses,
      caseAnalysisCollectors: caseAnalysisCollectors(registry, HELD_PLATFORM_COLLECTORS),
    },
  },
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, "shutting down");
    void app
      .close()
      .then(() =>
        Promise.all([
          investigations.close(),
          replayer.close(),
          reports.close(),
          renders.close(),
          caseAnalyses.close(),
        ]),
      )
      .then(() => Promise.all([db.close(), authStore.close(), redis.quit()]))
      .then(() => process.exit(0));
  });
}

await app.listen({ host: env.API_HOST, port: env.API_PORT });

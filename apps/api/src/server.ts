import { ConfigError, loadEnv, type Env } from "@repo/config";
import { createAuthStore, createDatabase } from "@repo/db";
import {
  ApiKeyService,
  CredentialVault,
  createRedisClient,
  waitForRedisReady,
  FixedWindowRateLimiter,
  MasterKey,
} from "@repo/integrations";
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
const logIdleError = (error: Error) => {
  process.stderr.write(`idle database connection error: ${error.message}\n`);
};

const db = createDatabase({ connectionString: env.DATABASE_URL, onIdleClientError: logIdleError });
const authStore = createAuthStore({
  connectionString: env.DATABASE_AUTH_URL,
  onIdleClientError: logIdleError,
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
  },
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, "shutting down");
    void app
      .close()
      .then(() => Promise.all([db.close(), authStore.close(), redis.quit()]))
      .then(() => process.exit(0));
  });
}

await app.listen({ host: env.API_HOST, port: env.API_PORT });

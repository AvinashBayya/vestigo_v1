/**
 * The worker's composition root: one codebase, deployed as pools selected by
 * WORKER_QUEUES (ARCHITECTURE-DECISIONS §6). Everything here is wiring; the
 * logic lives in @repo/osint-engine and the packages under it.
 */
import { allowsUnverifiedSources, resolveLlmConfiguration, type Env } from "@repo/config";
import { CollectorRuntime, createPlatformRegistry } from "@repo/collectors";
import { createDatabase, FileSystemContentStore, type Database } from "@repo/db";
import {
  createRedisClient,
  CredentialVault,
  MasterKey,
  RedisCircuitBreaker,
  SlidingLogRateLimiter,
  waitForRedisReady,
} from "@repo/integrations";
import { createLlmClient } from "@repo/llm";
import {
  CollectionExecutor,
  CollectorJobProcessor,
  ReportGenerator,
  redisUpstreamRateLimiter,
  RunCoordinator,
  RunFusion,
  startWorkerPool,
  VaultCredentialSource,
  type WorkerPool,
} from "@repo/osint-engine";
import { ConfigError } from "@repo/config";
import type { Logger } from "pino";

/** What the worker validates at startup. It never holds the session secret. */
export const WORKER_ENV = [
  "NODE_ENV",
  "LOG_LEVEL",
  "DATABASE_URL",
  "REDIS_URL",
  // Collector credentials come only from each tenant's vault; the worker
  // reveals them for the collector that needs them, and every reveal is audited.
  "VAULT_MASTER_KEY",
  "VAULT_MASTER_KEY_ID",
  "CONTENT_STORE_DIR",
  "COLLECTORS_ALLOW_UNVERIFIED",
  "QUEUE_PREFIX",
  "WORKER_QUEUES",
  "COLLECT_CONCURRENCY",
  "JOB_MAX_ATTEMPTS",
  "JOB_RETRY_BASE_MS",
  "JOB_RETRY_MAX_MS",
  "CIRCUIT_FAILURE_THRESHOLD",
  "CIRCUIT_FAILURE_WINDOW_MS",
  "CIRCUIT_COOLING_MS",
  "CIRCUIT_PROBE_LEASE_MS",
  // Report synthesis (Phase 5): the platform's model endpoint and key.
  "LLM_PROFILE",
  "LLM_HOSTED_BASE_URL",
  "LLM_HOSTED_API_KEY",
  "LLM_HOSTED_STRUCTURED_OUTPUT",
  "LLM_VLLM_ENABLED",
  "LLM_VLLM_BASE_URL",
  "LLM_VLLM_API_KEY",
  "LLM_SMALL_MODEL",
  "LLM_LARGE_MODEL",
  "LLM_MODEL_NAMES",
  "LLM_REQUEST_TIMEOUT_MS",
  "LLM_CACHE_TTL_SECONDS",
  "REPORT_CONCURRENCY",
  "REPORT_HANDLING_MARKING",
] as const satisfies readonly (keyof Env)[];

export type WorkerEnv = Pick<Env, (typeof WORKER_ENV)[number]>;

export interface RunningWorker {
  readonly pool: WorkerPool;
  /** Stops taking work, lets running jobs finish, then closes every connection. */
  close(): Promise<void>;
}

const REDIS_TIMEOUT_MS = 5_000;

export async function startWorker(env: WorkerEnv, logger: Logger): Promise<RunningWorker> {
  if (env.CONTENT_STORE_DIR === undefined) {
    // The only payload store built so far is the filesystem one (S3 is a
    // carry-forward); without it, evidence could not be stored.
    throw new ConfigError([
      { variable: "CONTENT_STORE_DIR", problem: "required by the worker, to store evidence" },
    ]);
  }
  const db: Database = createDatabase({
    connectionString: env.DATABASE_URL,
    onIdleClientError: (error) => {
      logger.error({ err: error }, "idle database client error");
    },
  });
  const redis = createRedisClient({
    url: env.REDIS_URL,
    commandTimeoutMs: REDIS_TIMEOUT_MS,
    connectTimeoutMs: REDIS_TIMEOUT_MS,
    onError: (error) => {
      logger.warn({ err: error }, "redis connection error");
    },
  });
  await waitForRedisReady(redis, { timeoutMs: REDIS_TIMEOUT_MS });

  const runtime = new CollectorRuntime({
    registry: createPlatformRegistry(),
    allowUnverifiedSources: allowsUnverifiedSources(env),
    network: {
      rateLimiter: redisUpstreamRateLimiter(
        new SlidingLogRateLimiter({ redis, keyPrefix: `${env.QUEUE_PREFIX}:upstream` }),
      ),
    },
  });
  const executor = new CollectionExecutor({
    db,
    runtime,
    contentStore: new FileSystemContentStore(env.CONTENT_STORE_DIR),
    credentials: new VaultCredentialSource(
      new CredentialVault(
        new MasterKey({ keyId: env.VAULT_MASTER_KEY_ID, keyBase64: env.VAULT_MASTER_KEY }),
      ),
    ),
  });
  const retry = {
    maxAttempts: env.JOB_MAX_ATTEMPTS,
    baseDelayMs: env.JOB_RETRY_BASE_MS,
    maxDelayMs: env.JOB_RETRY_MAX_MS,
  };
  const processor = new CollectorJobProcessor({
    db,
    executor,
    runtime,
    circuit: new RedisCircuitBreaker({
      redis,
      keyPrefix: env.QUEUE_PREFIX,
      policy: {
        failureThreshold: env.CIRCUIT_FAILURE_THRESHOLD,
        failureWindowMs: env.CIRCUIT_FAILURE_WINDOW_MS,
        coolingMs: env.CIRCUIT_COOLING_MS,
        probeLeaseMs: env.CIRCUIT_PROBE_LEASE_MS,
      },
    }),
    retry,
    observer: {
      circuitRecordFailed: (sourceId, error) => {
        logger.warn({ sourceId, err: error }, "could not record an outcome on the circuit");
      },
    },
  });

  // Resolved at startup: a vLLM profile selected while disabled stops the worker here.
  const llmConfiguration = resolveLlmConfiguration(env);
  if (llmConfiguration.status === "NOT_CONFIGURED") {
    logger.warn({ reason: llmConfiguration.reason }, "report synthesis is unavailable");
  }
  const llm = createLlmClient(llmConfiguration, {
    redis,
    keyPrefix: env.QUEUE_PREFIX,
    cacheTtlSeconds: env.LLM_CACHE_TTL_SECONDS,
    onCacheError: (error) => {
      logger.warn({ err: error }, "model response cache unavailable; calling the model");
    },
  });
  const reports = new ReportGenerator({
    db,
    registry: runtime.registry,
    llm,
    defaultHandlingMarking: env.REPORT_HANDLING_MARKING ?? null,
    retry,
  });

  const pool = await startWorkerPool({
    connection: { url: env.REDIS_URL, prefix: env.QUEUE_PREFIX },
    queues: env.WORKER_QUEUES.split(",")
      .map((name) => name.trim())
      .filter(Boolean),
    sourceIds: [...new Set(runtime.registry.list().map((entry) => entry.source.id))],
    coordinator: new RunCoordinator({ db, runtime }),
    processor,
    fusion: new RunFusion({ db, registry: runtime.registry }),
    retry,
    collectConcurrency: () => env.COLLECT_CONCURRENCY,
    investigationConcurrency: 4,
    fusionConcurrency: 4,
    reports: { generator: reports, concurrency: env.REPORT_CONCURRENCY },
    observer: {
      // Ids and codes only: a job's target can be personal data (CLAUDE.md §8).
      deliveryFailed: (queue, final, error) => {
        logger.warn({ queue, final, code: codeOf(error) }, "job delivery failed");
      },
      deadLetterFailed: (queue, error) => {
        logger.error({ queue, err: error }, "could not dead-letter a failed job");
      },
    },
  });
  logger.info({ queues: pool.queues }, "worker pool started");

  return {
    pool,
    async close() {
      await pool.close();
      await redis.quit();
      await db.close();
    },
  };
}

function codeOf(error: Error): string {
  return "code" in error && typeof error.code === "string" ? error.code : error.name;
}

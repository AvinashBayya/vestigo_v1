import { Redis } from "ioredis";
import { RateLimiterConfigError, RateLimiterUnavailableError } from "./errors.ts";

export interface RedisClientOptions {
  /** `redis://` or `rediss://`. Never logged: it can carry a password. */
  readonly url: string;
  /** Cap on every command's round trip. Required: no unbounded waits (CLAUDE.md §5). */
  readonly commandTimeoutMs: number;
  /** Cap on establishing each connection. */
  readonly connectTimeoutMs: number;
  /**
   * Receives connection errors (the client reconnects on its own). Where the
   * host process logs them; without it, ioredis prints them to stderr.
   */
  readonly onError?: (error: Error) => void;
}

/** Reconnection backs off linearly and never waits longer than this between attempts. */
const MAX_RECONNECT_DELAY_MS = 2_000;
const RECONNECT_STEP_MS = 100;

function requirePositiveInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RateLimiterConfigError(`${name} must be a positive integer of milliseconds`);
  }
}

/**
 * A Redis client that fails fast. Commands are never queued while
 * disconnected (they fail at once instead), each command is bounded by
 * `commandTimeoutMs`, and reconnection backs off to at most 2 s and keeps
 * trying, so the client recovers when Redis returns.
 */
export function createRedisClient(options: RedisClientOptions): Redis {
  requirePositiveInteger("commandTimeoutMs", options.commandTimeoutMs);
  requirePositiveInteger("connectTimeoutMs", options.connectTimeoutMs);
  let protocol: string;
  try {
    protocol = new URL(options.url).protocol;
  } catch {
    throw new RateLimiterConfigError("the Redis URL is not a valid URL");
  }
  if (protocol !== "redis:" && protocol !== "rediss:") {
    throw new RateLimiterConfigError("the Redis URL must use redis: or rediss:");
  }

  const client = new Redis(options.url, {
    lazyConnect: false,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    commandTimeout: options.commandTimeoutMs,
    connectTimeout: options.connectTimeoutMs,
    retryStrategy: (attempt) => Math.min(attempt * RECONNECT_STEP_MS, MAX_RECONNECT_DELAY_MS),
  });
  if (options.onError !== undefined) client.on("error", options.onError);
  return client;
}

/**
 * Resolves once the client is ready for commands, or rejects with
 * RateLimiterUnavailableError after `timeoutMs` or if the client is closed.
 * A fail-fast client refuses commands until it is ready, so a host awaits
 * this at startup before serving traffic.
 */
export async function waitForRedisReady(
  redis: Redis,
  options: { readonly timeoutMs: number },
): Promise<void> {
  requirePositiveInteger("timeoutMs", options.timeoutMs);
  if (redis.status === "ready") return;
  if (redis.status === "end") throw new RateLimiterUnavailableError("the Redis client is closed");
  await new Promise<void>((resolve, reject) => {
    const cleanUp = (): void => {
      clearTimeout(timer);
      redis.off("ready", onReady);
      redis.off("end", onEnd);
    };
    const onReady = (): void => {
      cleanUp();
      resolve();
    };
    const onEnd = (): void => {
      cleanUp();
      reject(new RateLimiterUnavailableError("the Redis client closed before it was ready"));
    };
    const timer = setTimeout(() => {
      cleanUp();
      reject(
        new RateLimiterUnavailableError(
          `Redis was not ready within ${String(options.timeoutMs)} ms`,
        ),
      );
    }, options.timeoutMs);
    redis.on("ready", onReady);
    redis.on("end", onEnd);
  });
}

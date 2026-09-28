import type { Redis } from "ioredis";
import { RateLimiterConfigError, RateLimiterUnavailableError } from "./errors.ts";

export interface RateLimitPolicy {
  /** Requests allowed per window. */
  readonly limit: number;
  readonly windowSeconds: number;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly limit: number;
  /** Requests left in the current window after this one. */
  readonly remaining: number;
  /** Seconds until a refused caller may try again. Null when this request was allowed. */
  readonly retryAfterSeconds: number | null;
  /** Seconds until the current window ends, as Redis measured it (at least 1). */
  readonly resetSeconds: number;
}

/**
 * One atomic step: count this request and read the window's remaining time.
 * The window starts at the first request (EXPIRE only when the count is 1).
 * A counter that somehow has no expiry is given one, so it cannot lock a
 * caller out forever.
 */
const CONSUME_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
  ttl = redis.call('PTTL', KEYS[1])
end
return {count, ttl}
`;

const KEY_PREFIX = /^[A-Za-z0-9:._-]{1,64}$/;
const MAX_KEY_LENGTH = 256;
const MAX_WINDOW_SECONDS = 7 * 24 * 60 * 60;

function parseReply(reply: unknown): { readonly count: number; readonly ttlMs: number } {
  if (Array.isArray(reply) && reply.length === 2) {
    const items: readonly unknown[] = reply;
    const count = items[0];
    const ttlMs = items[1];
    if (
      typeof count === "number" &&
      typeof ttlMs === "number" &&
      Number.isSafeInteger(count) &&
      Number.isSafeInteger(ttlMs) &&
      count >= 1 &&
      ttlMs >= 1
    ) {
      return { count, ttlMs };
    }
  }
  throw new RateLimiterUnavailableError("Redis returned an unexpected reply to the limiter script");
}

/**
 * Fixed-window counter in Redis, shared by every API and worker process.
 *
 * Fails closed: any Redis error, timeout, disconnection or malformed reply is
 * a RateLimiterUnavailableError, never an "allowed" decision. The client must
 * bound every command and must not queue commands while disconnected (as
 * `createRedisClient` configures it); a client that could wait unbounded is
 * refused at construction.
 */
export class FixedWindowRateLimiter {
  readonly #redis: Redis;
  readonly #keyPrefix: string;

  constructor(options: { readonly redis: Redis; readonly keyPrefix: string }) {
    if (!KEY_PREFIX.test(options.keyPrefix)) {
      throw new RateLimiterConfigError("keyPrefix must match ^[A-Za-z0-9:._-]{1,64}$");
    }
    const { commandTimeout, enableOfflineQueue } = options.redis.options;
    if (commandTimeout === undefined || !(commandTimeout > 0)) {
      throw new RateLimiterConfigError("the Redis client must set a positive commandTimeout");
    }
    if (enableOfflineQueue !== false) {
      throw new RateLimiterConfigError("the Redis client must disable the offline queue");
    }
    this.#redis = options.redis;
    this.#keyPrefix = options.keyPrefix;
  }

  /** Counts one request against `key` and decides whether it is allowed. */
  async consume(key: string, policy: RateLimitPolicy): Promise<RateLimitDecision> {
    if (key.length === 0 || key.length > MAX_KEY_LENGTH) {
      throw new RateLimiterConfigError(
        `a rate limit key must be 1 to ${String(MAX_KEY_LENGTH)} characters`,
      );
    }
    if (!Number.isSafeInteger(policy.limit) || policy.limit < 1) {
      throw new RateLimiterConfigError("limit must be a positive integer");
    }
    if (
      !Number.isSafeInteger(policy.windowSeconds) ||
      policy.windowSeconds < 1 ||
      policy.windowSeconds > MAX_WINDOW_SECONDS
    ) {
      throw new RateLimiterConfigError(
        `windowSeconds must be an integer from 1 to ${String(MAX_WINDOW_SECONDS)}`,
      );
    }

    let reply: unknown;
    try {
      reply = await this.#redis.eval(
        CONSUME_SCRIPT,
        1,
        `${this.#keyPrefix}:${key}`,
        policy.windowSeconds,
      );
    } catch (error) {
      throw new RateLimiterUnavailableError("the Redis command failed or timed out", {
        cause: error,
      });
    }
    const { count, ttlMs } = parseReply(reply);
    const allowed = count <= policy.limit;
    const resetSeconds = Math.max(1, Math.ceil(ttlMs / 1000));
    return {
      allowed,
      limit: policy.limit,
      remaining: Math.max(policy.limit - count, 0),
      retryAfterSeconds: allowed ? null : resetSeconds,
      resetSeconds,
    };
  }
}

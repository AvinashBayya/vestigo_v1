import type { Redis } from "ioredis";
import { RateLimiterConfigError, RateLimiterUnavailableError } from "./errors.ts";

export interface IntervalPolicy {
  /** Requests allowed in any interval of this length. */
  readonly limit: number;
  readonly intervalMs: number;
}

export type SlidingLogDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      /** Milliseconds until the oldest counted request leaves the interval (at least 1). */
      readonly retryAfterMs: number;
    };

/**
 * One atomic step on Redis's own clock, so every process agrees on time:
 * forget requests older than the interval; if fewer than `limit` remain, count
 * this one; otherwise report when the oldest leaves. A per-key sequence keeps
 * members unique when two requests share a microsecond.
 */
const ACQUIRE_SCRIPT = `
local limit = tonumber(ARGV[1])
local interval = tonumber(ARGV[2])
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000000 + tonumber(t[2])
local window = interval * 1000
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
local count = redis.call('ZCARD', KEYS[1])
if count < limit then
  local seq = redis.call('INCR', KEYS[2])
  redis.call('ZADD', KEYS[1], now, now .. '-' .. seq)
  redis.call('PEXPIRE', KEYS[1], interval)
  redis.call('PEXPIRE', KEYS[2], interval)
  return {1, 0}
end
local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
local retry = math.ceil((tonumber(oldest[2]) + window - now) / 1000)
if retry < 1 then retry = 1 end
return {0, retry}
`;

const KEY_PREFIX = /^[A-Za-z0-9:._-]{1,64}$/;
const MAX_KEY_LENGTH = 256;
const MAX_LIMIT = 10_000;
const MAX_INTERVAL_MS = 24 * 60 * 60 * 1000;

function parseReply(reply: unknown): SlidingLogDecision {
  if (Array.isArray(reply) && reply.length === 2) {
    const items: readonly unknown[] = reply;
    const [allowed, retryAfterMs] = items;
    if (allowed === 1 && retryAfterMs === 0) return { allowed: true };
    if (
      allowed === 0 &&
      typeof retryAfterMs === "number" &&
      Number.isSafeInteger(retryAfterMs) &&
      retryAfterMs >= 1
    ) {
      return { allowed: false, retryAfterMs };
    }
  }
  throw new RateLimiterUnavailableError("Redis returned an unexpected reply to the limiter script");
}

/**
 * At most `limit` requests in ANY interval of `intervalMs`, shared by every
 * process through Redis. Unlike a fixed window, it never lets a burst through
 * at a window boundary, which matters for upstreams that enforce a strict
 * spacing (GDELT: one request per five seconds).
 *
 * Fails closed: any Redis error, timeout or malformed reply is a
 * RateLimiterUnavailableError, never an "allowed" decision. The client must
 * bound every command and must not queue while disconnected (as
 * `createRedisClient` configures it).
 */
export class SlidingLogRateLimiter {
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

  /** Takes one request slot for `key` if the interval has one free. */
  async acquire(key: string, policy: IntervalPolicy): Promise<SlidingLogDecision> {
    if (key.length === 0 || key.length > MAX_KEY_LENGTH) {
      throw new RateLimiterConfigError(
        `a rate limit key must be 1 to ${String(MAX_KEY_LENGTH)} characters`,
      );
    }
    if (!Number.isSafeInteger(policy.limit) || policy.limit < 1 || policy.limit > MAX_LIMIT) {
      throw new RateLimiterConfigError(`limit must be an integer from 1 to ${String(MAX_LIMIT)}`);
    }
    if (
      !Number.isSafeInteger(policy.intervalMs) ||
      policy.intervalMs < 1 ||
      policy.intervalMs > MAX_INTERVAL_MS
    ) {
      throw new RateLimiterConfigError(
        `intervalMs must be an integer from 1 to ${String(MAX_INTERVAL_MS)}`,
      );
    }
    // One hash tag, so both keys live on the same node if Redis is ever clustered.
    const base = `{${this.#keyPrefix}:${key}}`;
    let reply: unknown;
    try {
      reply = await this.#redis.eval(
        ACQUIRE_SCRIPT,
        2,
        base,
        `${base}:seq`,
        policy.limit,
        policy.intervalMs,
      );
    } catch (error) {
      throw new RateLimiterUnavailableError("the Redis command failed or timed out", {
        cause: error,
      });
    }
    return parseReply(reply);
  }
}

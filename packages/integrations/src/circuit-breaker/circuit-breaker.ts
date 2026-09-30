import type { Redis } from "ioredis";
import { AppError } from "@repo/core";

/**
 * When to stop calling an upstream, and for how long (CLAUDE.md §5).
 */
export interface CircuitPolicy {
  /** Consecutive failures, each within `failureWindowMs` of the last, that open the circuit. */
  readonly failureThreshold: number;
  /** A failure older than this no longer counts towards opening. */
  readonly failureWindowMs: number;
  /** How long an open circuit refuses calls before letting one probe through. */
  readonly coolingMs: number;
  /**
   * How long a half-open probe holds the one slot. A probe that neither
   * succeeds nor fails in that time (its worker died) frees the slot for the
   * next probe, so the circuit can never stick half-open.
   */
  readonly probeLeaseMs: number;
}

export type CircuitStatus = "CLOSED" | "OPEN" | "HALF_OPEN";

export type CircuitAdmission =
  | {
      readonly allowed: true;
      /** This call is the one probe of a half-open circuit: its result decides the circuit. */
      readonly probe: boolean;
    }
  | {
      readonly allowed: false;
      readonly status: "OPEN" | "HALF_OPEN";
      /** Milliseconds until a call may be tried again (at least 1). */
      readonly retryAfterMs: number;
    };

export interface CircuitState {
  readonly status: CircuitStatus;
  /** Consecutive failures counted while closed. */
  readonly consecutiveFailures: number;
  /** While open: milliseconds until a probe may run. Null when closed or half-open. */
  readonly retryAfterMs: number | null;
}

/** The breaker could not reach a decision. Callers fail closed: the call is not made. */
export class CircuitBreakerUnavailableError extends AppError {
  readonly code = "CIRCUIT_BREAKER_UNAVAILABLE";

  constructor(reason: string, options?: { readonly cause: unknown }) {
    super(`Circuit breaker unavailable: ${reason}.`, options);
    this.name = "CircuitBreakerUnavailableError";
  }
}

export class CircuitBreakerConfigError extends AppError {
  readonly code = "CIRCUIT_BREAKER_CONFIG_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "CircuitBreakerConfigError";
  }
}

/**
 * One atomic step on Redis's own clock, so every worker agrees on time.
 * The circuit is a hash: status, consecutive failures, when the last failure
 * was, when it opened, and until when a half-open probe holds the slot.
 *
 * ARGV: action (admit | success | failure | state), threshold, windowMs,
 * coolingMs, probeLeaseMs. Times are in microseconds inside the script.
 * Replies: {code, a, b}, parsed below.
 */
const SCRIPT = `
local action = ARGV[1]
local threshold = tonumber(ARGV[2])
local window = tonumber(ARGV[3]) * 1000
local cooling = tonumber(ARGV[4]) * 1000
local lease = tonumber(ARGV[5]) * 1000
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000000 + tonumber(t[2])
local key = KEYS[1]
local ttl = math.ceil((window + cooling + lease) / 1000) * 2

local status = redis.call('HGET', key, 'status') or 'CLOSED'
local failures = tonumber(redis.call('HGET', key, 'failures') or '0')
local lastFailure = tonumber(redis.call('HGET', key, 'last_failure') or '0')
local openedAt = tonumber(redis.call('HGET', key, 'opened_at') or '0')
local probeUntil = tonumber(redis.call('HGET', key, 'probe_until') or '0')

local function ms(us)
  local v = math.ceil(us / 1000)
  if v < 1 then v = 1 end
  return v
end

local function open()
  redis.call('HSET', key, 'status', 'OPEN', 'failures', 0, 'opened_at', now, 'probe_until', 0)
  redis.call('PEXPIRE', key, ttl)
end

if action == 'admit' then
  if status == 'CLOSED' then return {1, 0, 0} end
  if status == 'OPEN' then
    if now < openedAt + cooling then return {0, 1, ms(openedAt + cooling - now)} end
    redis.call('HSET', key, 'status', 'HALF_OPEN', 'probe_until', now + lease)
    redis.call('PEXPIRE', key, ttl)
    return {1, 1, 0}
  end
  -- HALF_OPEN: one probe at a time, until its lease runs out.
  if now < probeUntil then return {0, 2, ms(probeUntil - now)} end
  redis.call('HSET', key, 'probe_until', now + lease)
  redis.call('PEXPIRE', key, ttl)
  return {1, 1, 0}
end

if action == 'success' then
  redis.call('DEL', key)
  return {3, 0, 0}
end

if action == 'failure' then
  if status == 'HALF_OPEN' then
    open()
    return {4, 0, 0}
  end
  if status == 'OPEN' then return {4, 0, 0} end
  if lastFailure > 0 and now - lastFailure > window then failures = 0 end
  failures = failures + 1
  if failures >= threshold then
    open()
    return {4, 0, 0}
  end
  redis.call('HSET', key, 'status', 'CLOSED', 'failures', failures, 'last_failure', now)
  redis.call('PEXPIRE', key, ttl)
  return {5, failures, 0}
end

-- state
if status == 'OPEN' then
  local remaining = openedAt + cooling - now
  if remaining > 0 then return {6, 0, ms(remaining)} end
  return {6, 0, 1}
end
if status == 'HALF_OPEN' then return {7, 0, 0} end
if lastFailure > 0 and now - lastFailure > window then failures = 0 end
return {8, failures, 0}
`;

const KEY_PREFIX = /^[A-Za-z0-9:._-]{1,64}$/;
const CIRCUIT_KEY = /^[A-Za-z0-9:._-]{1,128}$/;
const MAX_MS = 24 * 60 * 60 * 1000;

function validatePolicy(policy: CircuitPolicy): void {
  if (
    !Number.isSafeInteger(policy.failureThreshold) ||
    policy.failureThreshold < 1 ||
    policy.failureThreshold > 1000
  ) {
    throw new CircuitBreakerConfigError("failureThreshold must be an integer from 1 to 1000");
  }
  for (const [name, value] of [
    ["failureWindowMs", policy.failureWindowMs],
    ["coolingMs", policy.coolingMs],
    ["probeLeaseMs", policy.probeLeaseMs],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 1 || value > MAX_MS) {
      throw new CircuitBreakerConfigError(`${name} must be an integer from 1 to ${String(MAX_MS)}`);
    }
  }
}

function numbers(reply: unknown): readonly [number, number, number] {
  if (Array.isArray(reply) && reply.length === 3) {
    const items: readonly unknown[] = reply;
    const [a, b, c] = items;
    if (
      typeof a === "number" &&
      typeof b === "number" &&
      typeof c === "number" &&
      [a, b, c].every((n) => Number.isSafeInteger(n))
    ) {
      return [a, b, c];
    }
  }
  throw new CircuitBreakerUnavailableError(
    "Redis returned an unexpected reply to the circuit script",
  );
}

/**
 * A circuit breaker per upstream, shared by every worker through Redis. After
 * `failureThreshold` consecutive failures it opens: calls are refused for
 * `coolingMs`, then one probe is let through; its success closes the circuit
 * and its failure opens it again.
 *
 * Fails closed: a Redis error, timeout or malformed reply is a
 * CircuitBreakerUnavailableError, never an admission. The Redis client must
 * bound every command and must not queue while disconnected.
 */
export class RedisCircuitBreaker {
  readonly #redis: Redis;
  readonly #keyPrefix: string;
  readonly #policy: CircuitPolicy;

  constructor(options: {
    readonly redis: Redis;
    readonly keyPrefix: string;
    readonly policy: CircuitPolicy;
  }) {
    if (!KEY_PREFIX.test(options.keyPrefix)) {
      throw new CircuitBreakerConfigError("keyPrefix must match ^[A-Za-z0-9:._-]{1,64}$");
    }
    const { commandTimeout, enableOfflineQueue } = options.redis.options;
    if (commandTimeout === undefined || !(commandTimeout > 0)) {
      throw new CircuitBreakerConfigError("the Redis client must set a positive commandTimeout");
    }
    if (enableOfflineQueue !== false) {
      throw new CircuitBreakerConfigError("the Redis client must disable the offline queue");
    }
    validatePolicy(options.policy);
    this.#redis = options.redis;
    this.#keyPrefix = options.keyPrefix;
    this.#policy = options.policy;
  }

  get policy(): CircuitPolicy {
    return this.#policy;
  }

  async #call(action: string, circuit: string): Promise<readonly [number, number, number]> {
    if (!CIRCUIT_KEY.test(circuit)) {
      throw new CircuitBreakerConfigError("a circuit key must match ^[A-Za-z0-9:._-]{1,128}$");
    }
    const { failureThreshold, failureWindowMs, coolingMs, probeLeaseMs } = this.#policy;
    let reply: unknown;
    try {
      reply = await this.#redis.eval(
        SCRIPT,
        1,
        `{${this.#keyPrefix}:circuit:${circuit}}`,
        action,
        failureThreshold,
        failureWindowMs,
        coolingMs,
        probeLeaseMs,
      );
    } catch (error) {
      throw new CircuitBreakerUnavailableError("the Redis command failed or timed out", {
        cause: error,
      });
    }
    return numbers(reply);
  }

  /** Whether a call to this upstream may be made now. */
  async admit(circuit: string): Promise<CircuitAdmission> {
    const [code, a, b] = await this.#call("admit", circuit);
    if (code === 1) return { allowed: true, probe: a === 1 };
    if (code === 0 && b >= 1) {
      return { allowed: false, status: a === 1 ? "OPEN" : "HALF_OPEN", retryAfterMs: b };
    }
    throw new CircuitBreakerUnavailableError("the circuit script returned an unknown admission");
  }

  /** The upstream answered: the circuit closes and its failures are forgotten. */
  async recordSuccess(circuit: string): Promise<void> {
    const [code] = await this.#call("success", circuit);
    if (code !== 3) throw new CircuitBreakerUnavailableError("the success was not recorded");
  }

  /** The upstream failed. Returns the circuit's status afterwards. */
  async recordFailure(circuit: string): Promise<CircuitStatus> {
    const [code] = await this.#call("failure", circuit);
    if (code === 4) return "OPEN";
    if (code === 5) return "CLOSED";
    throw new CircuitBreakerUnavailableError("the failure was not recorded");
  }

  /** The circuit as it stands, without changing it: for status screens. */
  async state(circuit: string): Promise<CircuitState> {
    const [code, a, b] = await this.#call("state", circuit);
    if (code === 6) return { status: "OPEN", consecutiveFailures: 0, retryAfterMs: b };
    if (code === 7) return { status: "HALF_OPEN", consecutiveFailures: 0, retryAfterMs: null };
    if (code === 8) return { status: "CLOSED", consecutiveFailures: a, retryAfterMs: null };
    throw new CircuitBreakerUnavailableError("the circuit script returned an unknown state");
  }
}

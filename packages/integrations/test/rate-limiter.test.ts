/**
 * The shared fixed-window limiter against the compose Redis (logical database
 * 15). Every test uses its own random key prefix, so runs never collide.
 * Failure must be loud and closed: an unreachable or slow Redis is an error,
 * never an "allowed".
 */
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createRedisClient,
  FixedWindowRateLimiter,
  RateLimiterConfigError,
  RateLimiterUnavailableError,
  waitForRedisReady,
  type RateLimitDecision,
} from "../src/index.ts";
import { TEST_CONFIG } from "./config.ts";
import { rejectionOf } from "./support.ts";

/** Nothing listens here in the compose setup. */
const CLOSED_PORT_URL = "redis://127.0.0.1:6390";

let redis: Redis;
const connectionErrors: Error[] = [];

beforeAll(async () => {
  redis = createRedisClient({
    url: TEST_CONFIG.redisUrl,
    commandTimeoutMs: 2_000,
    connectTimeoutMs: 2_000,
    onError: (error) => connectionErrors.push(error),
  });
  await waitForRedisReady(redis, { timeoutMs: 5_000 });
});

afterAll(async () => {
  await redis.quit();
  expect(connectionErrors).toEqual([]);
});

function limiter(): { readonly limiter: FixedWindowRateLimiter; readonly prefix: string } {
  const prefix = `test:${randomUUID()}`;
  return { limiter: new FixedWindowRateLimiter({ redis, keyPrefix: prefix }), prefix };
}

describe("fixed window", () => {
  it("allows exactly `limit` requests, then refuses with a retry-after inside the window", async () => {
    const { limiter: rl } = limiter();
    const policy = { limit: 3, windowSeconds: 60 };
    const allowed: RateLimitDecision[] = [];
    for (let i = 0; i < 3; i++) allowed.push(await rl.consume("caller", policy));
    expect(allowed.map((decision) => decision.allowed)).toEqual([true, true, true]);
    expect(allowed.map((decision) => decision.remaining)).toEqual([2, 1, 0]);
    expect(allowed.map((decision) => decision.retryAfterSeconds)).toEqual([null, null, null]);

    for (let i = 0; i < 2; i++) {
      const refused = await rl.consume("caller", policy);
      expect(refused.allowed).toBe(false);
      expect(refused.limit).toBe(3);
      expect(refused.remaining).toBe(0);
      expect(refused.retryAfterSeconds).toBeGreaterThanOrEqual(1);
      expect(refused.retryAfterSeconds).toBeLessThanOrEqual(60);
      expect(refused.resetSeconds).toBe(refused.retryAfterSeconds);
    }
  });

  it("starts a new window once the old one expires", async () => {
    const { limiter: rl } = limiter();
    const policy = { limit: 1, windowSeconds: 1 };
    expect((await rl.consume("caller", policy)).allowed).toBe(true);
    const refused = await rl.consume("caller", policy);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBe(1);

    await sleep(1_150);
    const next = await rl.consume("caller", policy);
    expect(next.allowed).toBe(true);
    expect(next.remaining).toBe(0);
  });

  it("counts separate keys, and separate prefixes, independently", async () => {
    const { limiter: first } = limiter();
    const { limiter: second } = limiter();
    const policy = { limit: 1, windowSeconds: 60 };
    expect((await first.consume("a", policy)).allowed).toBe(true);
    expect((await first.consume("a", policy)).allowed).toBe(false);
    expect((await first.consume("b", policy)).allowed).toBe(true);
    expect((await second.consume("a", policy)).allowed).toBe(true);
  });

  it("stores one counter per key, with the window as its expiry", async () => {
    const { limiter: rl, prefix } = limiter();
    await rl.consume("caller", { limit: 5, windowSeconds: 30 });
    await rl.consume("caller", { limit: 5, windowSeconds: 30 });
    expect(await redis.get(`${prefix}:caller`)).toBe("2");
    const ttl = await redis.pttl(`${prefix}:caller`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(30_000);
  });

  it("gives a counter that lost its expiry a new one, so it cannot lock a caller out forever", async () => {
    const { limiter: rl, prefix } = limiter();
    await redis.set(`${prefix}:caller`, "7");
    const decision = await rl.consume("caller", { limit: 5, windowSeconds: 10 });
    expect(decision.allowed).toBe(false);
    expect(decision.retryAfterSeconds).toBeLessThanOrEqual(10);
    expect(await redis.pttl(`${prefix}:caller`)).toBeGreaterThan(0);
  });
});

describe("fails closed", () => {
  it("refuses quickly when Redis is unreachable", async () => {
    const errors: Error[] = [];
    const unreachable = createRedisClient({
      url: CLOSED_PORT_URL,
      commandTimeoutMs: 200,
      connectTimeoutMs: 200,
      onError: (error) => errors.push(error),
    });
    try {
      const rl = new FixedWindowRateLimiter({ redis: unreachable, keyPrefix: "test:closed" });
      const started = performance.now();
      const error = await rejectionOf(() => rl.consume("caller", { limit: 10, windowSeconds: 60 }));
      expect(error).toBeInstanceOf(RateLimiterUnavailableError);
      expect(error).toMatchObject({ code: "RATE_LIMITER_UNAVAILABLE" });

      const notReady = await rejectionOf(() => waitForRedisReady(unreachable, { timeoutMs: 500 }));
      expect(notReady).toBeInstanceOf(RateLimiterUnavailableError);

      const again = await rejectionOf(() => rl.consume("caller", { limit: 10, windowSeconds: 60 }));
      expect(again).toBeInstanceOf(RateLimiterUnavailableError);
      expect(performance.now() - started).toBeLessThan(5_000);
      expect(errors.length).toBeGreaterThan(0);
    } finally {
      unreachable.disconnect();
    }
  });

  it("refuses when a command times out on a live connection", async () => {
    const slow = createRedisClient({
      url: TEST_CONFIG.redisUrl,
      commandTimeoutMs: 300,
      connectTimeoutMs: 2_000,
    });
    try {
      await waitForRedisReady(slow, { timeoutMs: 5_000 });
      const { prefix } = limiter();
      const rl = new FixedWindowRateLimiter({ redis: slow, keyPrefix: prefix });
      // Redis serves one connection's commands in order: a 2 s BLPOP on this
      // connection holds back the limiter's script until the client times out.
      const blocker = slow.blpop(`${prefix}:blocker`, 2).catch((error: unknown) => error);
      const started = performance.now();
      const error = await rejectionOf(() => rl.consume("caller", { limit: 10, windowSeconds: 60 }));
      const elapsed = performance.now() - started;
      expect(error).toBeInstanceOf(RateLimiterUnavailableError);
      expect(elapsed).toBeLessThan(1_500);
      expect(await blocker).toBeInstanceOf(Error);
    } finally {
      slow.disconnect();
    }
  });

  it("refuses a Redis client that could wait without bound", () => {
    const unbounded = new Redis(TEST_CONFIG.redisUrl, { lazyConnect: true });
    const queued = new Redis(TEST_CONFIG.redisUrl, { lazyConnect: true, commandTimeout: 500 });
    try {
      expect(() => new FixedWindowRateLimiter({ redis: unbounded, keyPrefix: "test" })).toThrow(
        RateLimiterConfigError,
      );
      expect(() => new FixedWindowRateLimiter({ redis: queued, keyPrefix: "test" })).toThrow(
        RateLimiterConfigError,
      );
    } finally {
      unbounded.disconnect();
      queued.disconnect();
    }
  });
});

describe("configuration", () => {
  it("refuses invalid policies, keys and prefixes", async () => {
    const { limiter: rl } = limiter();
    for (const policy of [
      { limit: 0, windowSeconds: 60 },
      { limit: 1.5, windowSeconds: 60 },
      { limit: 10, windowSeconds: 0 },
      { limit: 10, windowSeconds: Number.NaN },
    ]) {
      expect(await rejectionOf(() => rl.consume("caller", policy))).toMatchObject({
        code: "RATE_LIMITER_CONFIG_INVALID",
      });
    }
    expect(await rejectionOf(() => rl.consume("", { limit: 1, windowSeconds: 1 }))).toBeInstanceOf(
      RateLimiterConfigError,
    );
    expect(() => new FixedWindowRateLimiter({ redis, keyPrefix: "has space" })).toThrow(
      RateLimiterConfigError,
    );
  });

  it("refuses unbounded timeouts and non-Redis URLs, without echoing the URL", () => {
    const base = { url: TEST_CONFIG.redisUrl, commandTimeoutMs: 100, connectTimeoutMs: 100 };
    expect(() => createRedisClient({ ...base, commandTimeoutMs: 0 })).toThrow(
      RateLimiterConfigError,
    );
    expect(() =>
      createRedisClient({ ...base, connectTimeoutMs: Number.POSITIVE_INFINITY }),
    ).toThrow(RateLimiterConfigError);
    for (const url of ["not a url", "http://user:hunter-password@127.0.0.1:6379"]) {
      let caught: unknown;
      try {
        createRedisClient({ ...base, url });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(RateLimiterConfigError);
      expect((caught as Error).message).not.toContain("hunter-password");
      expect((caught as Error).message).not.toContain(url);
    }
  });
});

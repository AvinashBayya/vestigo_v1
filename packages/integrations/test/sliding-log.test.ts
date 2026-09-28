/**
 * The shared sliding-log limiter against the compose Redis (logical database
 * 15). Its point is the property a fixed window lacks: never more than
 * `limit` requests in ANY interval, so no burst slips through at a boundary.
 */
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createRedisClient,
  RateLimiterConfigError,
  RateLimiterUnavailableError,
  SlidingLogRateLimiter,
  waitForRedisReady,
} from "../src/index.ts";
import { TEST_CONFIG } from "./config.ts";
import { rejectionOf } from "./support.ts";

let redis: Redis;

beforeAll(async () => {
  redis = createRedisClient({
    url: TEST_CONFIG.redisUrl,
    commandTimeoutMs: 2_000,
    connectTimeoutMs: 2_000,
  });
  await waitForRedisReady(redis, { timeoutMs: 5_000 });
});

afterAll(async () => {
  await redis.quit();
});

function limiter(): SlidingLogRateLimiter {
  return new SlidingLogRateLimiter({ redis, keyPrefix: `test:${randomUUID()}` });
}

describe("sliding log", () => {
  it("allows exactly `limit` requests in the interval, then says when the next is due", async () => {
    const rl = limiter();
    const policy = { limit: 3, intervalMs: 60_000 };
    const decisions = [];
    for (let i = 0; i < 5; i++) decisions.push(await rl.acquire("upstream", policy));
    expect(decisions.slice(0, 3)).toEqual([
      { allowed: true },
      { allowed: true },
      { allowed: true },
    ]);
    for (const refused of decisions.slice(3)) {
      expect(refused.allowed).toBe(false);
      if (!refused.allowed) {
        expect(refused.retryAfterMs).toBeGreaterThan(0);
        expect(refused.retryAfterMs).toBeLessThanOrEqual(60_000);
      }
    }
  });

  it("never allows two requests closer together than the interval, with a limit of one", async () => {
    const rl = limiter();
    const policy = { limit: 1, intervalMs: 300 };
    const allowedAt: number[] = [];
    const until = performance.now() + 1_400;
    while (performance.now() < until) {
      const decision = await rl.acquire("strict", policy);
      if (decision.allowed) allowedAt.push(performance.now());
      else await sleep(Math.min(decision.retryAfterMs, 40));
    }
    expect(allowedAt.length).toBeGreaterThanOrEqual(3);
    const gaps = allowedAt.slice(1).map((at, i) => at - (allowedAt[i] ?? at));
    // Redis's clock decides; a few milliseconds of round trip separate it from ours.
    for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(300 - 15);
  });

  it("frees a slot once the interval has passed, and keys are independent", async () => {
    const rl = limiter();
    const policy = { limit: 1, intervalMs: 200 };
    expect(await rl.acquire("a", policy)).toEqual({ allowed: true });
    expect((await rl.acquire("a", policy)).allowed).toBe(false);
    expect(await rl.acquire("b", policy)).toEqual({ allowed: true });
    await sleep(230);
    expect(await rl.acquire("a", policy)).toEqual({ allowed: true });
  });

  it("fails closed when Redis is unreachable", async () => {
    const dead = createRedisClient({
      url: "redis://127.0.0.1:6390",
      commandTimeoutMs: 300,
      connectTimeoutMs: 300,
      onError: () => undefined,
    });
    try {
      const rl = new SlidingLogRateLimiter({ redis: dead, keyPrefix: "test:dead" });
      expect(
        await rejectionOf(() => rl.acquire("x", { limit: 1, intervalMs: 1_000 })),
      ).toBeInstanceOf(RateLimiterUnavailableError);
    } finally {
      dead.disconnect();
    }
  });

  it("refuses a policy or key it cannot honour", async () => {
    const rl = limiter();
    for (const policy of [
      { limit: 0, intervalMs: 1_000 },
      { limit: 1.5, intervalMs: 1_000 },
      { limit: 1, intervalMs: 0 },
      { limit: 1, intervalMs: 25 * 60 * 60 * 1000 },
    ]) {
      expect(await rejectionOf(() => rl.acquire("x", policy))).toBeInstanceOf(
        RateLimiterConfigError,
      );
    }
    expect(await rejectionOf(() => rl.acquire("", { limit: 1, intervalMs: 1 }))).toBeInstanceOf(
      RateLimiterConfigError,
    );
    expect(() => new SlidingLogRateLimiter({ redis, keyPrefix: "bad prefix" })).toThrow(
      RateLimiterConfigError,
    );
  });
});

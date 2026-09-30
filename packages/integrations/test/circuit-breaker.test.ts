/**
 * RELEASE-BLOCKING. The per-upstream circuit breaker against the compose
 * Redis (logical database 15): a failing source opens its circuit, stays
 * refused for the cooling period, lets exactly one probe through, and closes
 * or re-opens on that probe's result. Shared by every worker, and fails
 * closed when Redis cannot answer.
 */
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CircuitBreakerConfigError,
  CircuitBreakerUnavailableError,
  createRedisClient,
  RedisCircuitBreaker,
  waitForRedisReady,
  type CircuitAdmission,
  type CircuitPolicy,
} from "../src/index.ts";
import { TEST_CONFIG } from "./config.ts";
import { rejectionOf } from "./support.ts";

let redis: Redis;
let other: Redis;

async function client(): Promise<Redis> {
  const created = createRedisClient({
    url: TEST_CONFIG.redisUrl,
    commandTimeoutMs: 2_000,
    connectTimeoutMs: 2_000,
  });
  await waitForRedisReady(created, { timeoutMs: 5_000 });
  return created;
}

beforeAll(async () => {
  redis = await client();
  other = await client();
});

afterAll(async () => {
  await redis.quit();
  await other.quit();
});

const POLICY: CircuitPolicy = {
  failureThreshold: 3,
  failureWindowMs: 60_000,
  coolingMs: 300,
  probeLeaseMs: 300,
};

/** The status a refused admission reports; null for one that was allowed. */
function refusedStatus(admission: CircuitAdmission | undefined): string | null {
  return admission === undefined || admission.allowed ? null : admission.status;
}

function breaker(policy: CircuitPolicy = POLICY, prefix = `test:${randomUUID()}`) {
  return new RedisCircuitBreaker({ redis, keyPrefix: prefix, policy });
}

describe("a failing source opens its circuit (RELEASE-BLOCKING)", () => {
  it("stays closed below the threshold, opens at it, and refuses calls while cooling", async () => {
    const cb = breaker();
    expect(await cb.admit("source-a")).toEqual({ allowed: true, probe: false });
    expect(await cb.recordFailure("source-a")).toBe("CLOSED");
    expect(await cb.recordFailure("source-a")).toBe("CLOSED");
    expect((await cb.state("source-a")).consecutiveFailures).toBe(2);
    expect(await cb.recordFailure("source-a")).toBe("OPEN");

    const refused = await cb.admit("source-a");
    expect(refused.allowed).toBe(false);
    if (!refused.allowed) {
      expect(refused.status).toBe("OPEN");
      expect(refused.retryAfterMs).toBeGreaterThan(0);
      expect(refused.retryAfterMs).toBeLessThanOrEqual(POLICY.coolingMs);
    }
    const state = await cb.state("source-a");
    expect(state.status).toBe("OPEN");
    expect(state.retryAfterMs).toBeGreaterThan(0);
  });

  it("keeps each source's circuit apart", async () => {
    const cb = breaker();
    for (let i = 0; i < 3; i++) await cb.recordFailure("broken");
    expect((await cb.admit("broken")).allowed).toBe(false);
    expect(await cb.admit("healthy")).toEqual({ allowed: true, probe: false });
  });

  it("is shared by every worker: one process's failures open it for another", async () => {
    const prefix = `test:${randomUUID()}`;
    const workerA = breaker(POLICY, prefix);
    const workerB = new RedisCircuitBreaker({ redis: other, keyPrefix: prefix, policy: POLICY });
    for (let i = 0; i < 3; i++) await workerA.recordFailure("shared");
    expect((await workerB.admit("shared")).allowed).toBe(false);
  });

  it("a success forgets earlier failures", async () => {
    const cb = breaker();
    await cb.recordFailure("flaky");
    await cb.recordFailure("flaky");
    await cb.recordSuccess("flaky");
    expect(await cb.recordFailure("flaky")).toBe("CLOSED");
    expect((await cb.state("flaky")).consecutiveFailures).toBe(1);
  });

  it("failures further apart than the window do not accumulate", async () => {
    const cb = breaker({ ...POLICY, failureWindowMs: 100 });
    await cb.recordFailure("slow-burn");
    await cb.recordFailure("slow-burn");
    await sleep(150);
    expect(await cb.recordFailure("slow-burn")).toBe("CLOSED");
    expect((await cb.state("slow-burn")).consecutiveFailures).toBe(1);
  });
});

describe("after cooling, one probe decides (RELEASE-BLOCKING)", () => {
  async function opened(cb: RedisCircuitBreaker, circuit: string): Promise<void> {
    for (let i = 0; i < 3; i++) await cb.recordFailure(circuit);
    await sleep(POLICY.coolingMs + 50);
  }

  it("lets exactly one probe through, and a successful probe closes the circuit", async () => {
    const cb = breaker();
    await opened(cb, "recovering");
    const admissions = await Promise.all(Array.from({ length: 5 }, () => cb.admit("recovering")));
    expect(admissions.filter((a) => a.allowed)).toEqual([{ allowed: true, probe: true }]);
    const refused = admissions.find((a) => !a.allowed);
    expect(refusedStatus(refused)).toBe("HALF_OPEN");
    await cb.recordSuccess("recovering");
    expect(await cb.admit("recovering")).toEqual({ allowed: true, probe: false });
    expect((await cb.state("recovering")).status).toBe("CLOSED");
  });

  it("a failed probe opens the circuit again for a full cooling period", async () => {
    const cb = breaker();
    await opened(cb, "still-down");
    expect(await cb.admit("still-down")).toEqual({ allowed: true, probe: true });
    expect(await cb.recordFailure("still-down")).toBe("OPEN");
    const refused = await cb.admit("still-down");
    expect(refusedStatus(refused)).toBe("OPEN");
  });

  it("a probe that never reports frees its slot when its lease runs out", async () => {
    const cb = breaker();
    await opened(cb, "lost-probe");
    expect(await cb.admit("lost-probe")).toEqual({ allowed: true, probe: true });
    expect((await cb.admit("lost-probe")).allowed).toBe(false);
    await sleep(POLICY.probeLeaseMs + 50);
    expect(await cb.admit("lost-probe")).toEqual({ allowed: true, probe: true });
  });
});

describe("fails closed", () => {
  it("refuses to decide, rather than admitting, when Redis cannot answer", async () => {
    const broken = createRedisClient({
      url: TEST_CONFIG.redisUrl,
      commandTimeoutMs: 500,
      connectTimeoutMs: 500,
    });
    await waitForRedisReady(broken, { timeoutMs: 5_000 });
    const cb = new RedisCircuitBreaker({
      redis: broken,
      keyPrefix: `test:${randomUUID()}`,
      policy: POLICY,
    });
    broken.disconnect();
    const error = await rejectionOf(() => cb.admit("any"));
    expect(error).toBeInstanceOf(CircuitBreakerUnavailableError);
  });

  it("refuses an unbounded Redis client and an invalid policy", async () => {
    const unbounded = new Redis(TEST_CONFIG.redisUrl, { lazyConnect: true });
    expect(
      () => new RedisCircuitBreaker({ redis: unbounded, keyPrefix: "test", policy: POLICY }),
    ).toThrow(CircuitBreakerConfigError);
    unbounded.disconnect();
    for (const policy of [
      { ...POLICY, failureThreshold: 0 },
      { ...POLICY, coolingMs: 0 },
      { ...POLICY, probeLeaseMs: Number.NaN },
    ]) {
      expect(() => breaker(policy)).toThrow(CircuitBreakerConfigError);
    }
    await expect(breaker().admit("has spaces")).rejects.toThrow(CircuitBreakerConfigError);
  });
});

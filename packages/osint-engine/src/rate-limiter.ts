import type { RateLimitAnswer, UpstreamRateLimiter } from "@repo/collectors";
import type { SlidingLogRateLimiter } from "@repo/integrations";

/**
 * The collectors' shared per-upstream limit, in Redis: one key per source, so
 * every collector using a source, in every worker process, draws on the same
 * allowance. A Redis failure is an error, never an allowance; the fetcher
 * then sends nothing.
 */
export function redisUpstreamRateLimiter(limiter: SlidingLogRateLimiter): UpstreamRateLimiter {
  return {
    async acquire(sourceId, policy): Promise<RateLimitAnswer> {
      const decision = await limiter.acquire(`upstream:${sourceId}`, {
        limit: policy.limit,
        intervalMs: policy.intervalMs,
      });
      return decision.allowed
        ? { allowed: true }
        : { allowed: false, retryAfterMs: decision.retryAfterMs };
    },
  };
}

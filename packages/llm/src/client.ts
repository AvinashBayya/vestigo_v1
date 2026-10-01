/**
 * Builds the model client from resolved configuration: the one place a
 * process turns LLM_* settings into a provider, a cache and a timeout.
 */
import type { LlmConfiguration } from "@repo/config";
import { RedisResponseCache, type RedisCacheClient } from "./cache.ts";
import type { LlmClient } from "./generate.ts";
import { OpenAiCompatibleProvider } from "./provider.ts";

export function createLlmClient(
  configuration: LlmConfiguration,
  options: {
    /** Null: no response cache. */
    readonly redis: RedisCacheClient | null;
    readonly keyPrefix: string;
    readonly cacheTtlSeconds: number;
    readonly onCacheError?: (error: unknown) => void;
    readonly fetch?: typeof fetch;
  },
): LlmClient | { readonly unavailable: string } {
  if (configuration.status === "NOT_CONFIGURED") return { unavailable: configuration.reason };
  const { endpoint } = configuration;
  return {
    endpoint,
    provider: new OpenAiCompatibleProvider(
      endpoint,
      options.fetch === undefined ? {} : { fetch: options.fetch },
    ),
    cache:
      options.redis === null
        ? null
        : new RedisResponseCache(options.redis, { prefix: options.keyPrefix }),
    cacheTtlSeconds: options.cacheTtlSeconds,
    ...(options.onCacheError === undefined ? {} : { onCacheError: options.onCacheError }),
  };
}

/**
 * The model response cache, in Redis (ARCHITECTURE-DECISIONS §7). Keyed by
 * prompt, model and version, and namespaced by tenant: a hit must never tell
 * one tenant that another sent the same material.
 *
 * Only a response that passed validation is stored, so a cached answer is one
 * that was already accepted once. A cache that cannot be reached is skipped,
 * never trusted: the call goes to the model and is metered as usual.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import type { ChatMessage } from "./provider.ts";

/**
 * Bumped when the cached entry's shape or the key's inputs change.
 * 2: an entry is JSON holding the answer and where it was produced
 * (CachedAnswer), so a cache hit reports who processed the material: the
 * endpoint host, the provider it named, and its raw region headers, as they
 * were when the answer was produced, not as configured now.
 */
export const CACHE_FORMAT = "llm-cache-2";

/** What a cache entry holds: an accepted answer, and the provenance of the call that produced it. */
export const CachedAnswer = z.strictObject({
  text: z.string(),
  provenance: z.strictObject({
    endpointHost: z.string().min(1),
    servedBy: z.string().nullable(),
    regionHeaders: z.array(z.strictObject({ name: z.string().min(1), value: z.string() })),
  }),
});
export type CachedAnswer = z.infer<typeof CachedAnswer>;

/** A cache entry's answer, or null when the entry is unreadable (treated as a miss). */
export function readCachedAnswer(entry: string): CachedAnswer | null {
  try {
    const parsed = CachedAnswer.safeParse(JSON.parse(entry));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export interface ResponseCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

/** What a response cache key is made of. Everything that changes the answer is in it. */
export interface CacheKeyInput {
  readonly tenantId: string;
  readonly modelId: string;
  readonly servedName: string;
  readonly profile: string;
  /** The task's prompt version: bumped whenever its instructions or schema change. */
  readonly promptVersion: string;
  readonly messages: readonly ChatMessage[];
  readonly maxTokens: number;
  readonly temperature: number;
}

export function cacheKey(input: CacheKeyInput): string {
  const digest = createHash("sha256")
    .update(
      JSON.stringify([
        CACHE_FORMAT,
        input.modelId,
        input.servedName,
        input.profile,
        input.promptVersion,
        input.maxTokens,
        input.temperature,
        input.messages.map((message) => [message.role, message.content]),
      ]),
    )
    .digest("hex");
  return `${input.tenantId}:${digest}`;
}

/** The subset of an ioredis client the cache uses. */
export interface RedisCacheClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", seconds: number): Promise<unknown>;
}

export class RedisResponseCache implements ResponseCache {
  readonly #redis: RedisCacheClient;
  readonly #prefix: string;

  constructor(redis: RedisCacheClient, options: { readonly prefix: string }) {
    this.#redis = redis;
    this.#prefix = `${options.prefix}:llm-cache:`;
  }

  async get(key: string): Promise<string | null> {
    return this.#redis.get(this.#prefix + key);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.#redis.set(this.#prefix + key, value, "EX", ttlSeconds);
  }
}

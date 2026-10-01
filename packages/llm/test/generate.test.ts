/**
 * One validated model call: retry once, then fail; meter every call that
 * consumed tokens; serve the tenant's cache without calling or charging; and
 * never send the model's rejected words back as instructions.
 */
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AccumulatingMeter,
  generateValidated,
  LlmOutputRejectedError,
  readCachedAnswer,
  RedisResponseCache,
  type ResponseCache,
  type UntrustedRecord,
} from "../src/index.ts";
import {
  answer,
  ENDPOINT,
  ENDPOINT_HOST,
  ScriptedProvider,
  statementsTask,
  via,
} from "./support.ts";

const REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:6379/15";

const RECORDS: UntrustedRecord[] = [
  { ref: "E1", source: "[source one]", content: { name: "a.example.com" } },
  { ref: "E2", source: "[source two]", content: { registrar: "[registrar name]" } },
];

class MapCache implements ResponseCache {
  readonly entries = new Map<string, string>();
  get(key: string) {
    return Promise.resolve(this.entries.get(key) ?? null);
  }
  set(key: string, value: string) {
    this.entries.set(key, value);
    return Promise.resolve();
  }
}

const client = (provider: ScriptedProvider, cache: ResponseCache | null = null) => ({
  endpoint: ENDPOINT,
  provider,
  cache,
  cacheTtlSeconds: 60,
});

describe("a validated model call", () => {
  it("routes synthesis to the large model and accepts a valid first answer", async () => {
    const provider = new ScriptedProvider([
      () => answer({ text: "The records name a.example.com.", refs: ["E1"] }),
    ]);
    const meter = new AccumulatingMeter();
    const result = await generateValidated(
      client(provider),
      "[tenant]",
      meter,
      statementsTask(RECORDS),
    );
    expect(result).toMatchObject({ attempts: 1, modelId: "Qwen/Qwen3-32B", cached: false });
    expect(provider.requests[0]?.model).toBe("Qwen/Qwen3-32B");
    expect(provider.requests[0]?.temperature).toBe(0);
    expect(meter.totals()).toEqual({ inputTokens: 100, outputTokens: 20 });
  });

  it("strips a leading reasoning block and code fences before parsing", async () => {
    const provider = new ScriptedProvider([
      () =>
        `<think>[reasoning]</think>\n\`\`\`json\n${answer({ text: "[finding]", refs: ["E2"] })}\n\`\`\``,
    ]);
    const result = await generateValidated(
      client(provider),
      "[tenant]",
      new AccumulatingMeter(),
      statementsTask(RECORDS),
    );
    expect(result.value.statements[0]?.text).toBe("[finding]");
  });

  it("retries once with the problems stated, then accepts", async () => {
    const provider = new ScriptedProvider([
      () => answer({ text: "[planted words from a source]", refs: [] }),
      () => answer({ text: "[finding]", refs: ["E1"] }),
    ]);
    const meter = new AccumulatingMeter();
    const result = await generateValidated(
      client(provider),
      "[tenant]",
      meter,
      statementsTask(RECORDS),
    );
    expect(result.attempts).toBe(2);
    expect(meter.calls).toHaveLength(2);
    const retry = provider.requests[1]?.messages.at(-1)?.content ?? "";
    expect(retry).toContain("YOUR PREVIOUS ANSWER WAS REJECTED");
    expect(retry).toContain("Statement 1, CITATION_MISSING");
    // REGRESSION (legacy reports.ts): the retry prompt quoted the rejected answer.
    expect(retry).not.toContain("[planted words from a source]");
    expect(provider.requests[1]?.messages.map((m) => m.role)).toEqual(["system", "user"]);
  });

  it("meters every call with the provider that served it, and returns the accepted answer's", async () => {
    const provider = new ScriptedProvider(
      [
        () => answer({ text: "[finding]", refs: [] }),
        () => answer({ text: "[finding]", refs: ["E1"] }),
      ],
      undefined,
      [
        via("[provider a]", [{ name: "x-example-region", value: "[region a]" }]),
        via("[provider b]", [{ name: "x-example-region", value: "[region b]" }]),
      ],
    );
    const meter = new AccumulatingMeter();
    const result = await generateValidated(
      client(provider),
      "[tenant]",
      meter,
      statementsTask(RECORDS),
    );
    // The rejected answer was still processed somewhere: residency needs both calls.
    expect(meter.calls.map((call) => call.provenance)).toEqual([
      via("[provider a]", [{ name: "x-example-region", value: "[region a]" }]),
      via("[provider b]", [{ name: "x-example-region", value: "[region b]" }]),
    ]);
    expect(result.provenance).toEqual(
      via("[provider b]", [{ name: "x-example-region", value: "[region b]" }]),
    );
  });

  it("reports the endpoint alone when it named no provider and no region", async () => {
    const provider = new ScriptedProvider([() => answer({ text: "[finding]", refs: ["E1"] })]);
    const meter = new AccumulatingMeter();
    const result = await generateValidated(
      client(provider),
      "[tenant]",
      meter,
      statementsTask(RECORDS),
    );
    expect(result.provenance).toEqual({
      endpointHost: ENDPOINT_HOST,
      servedBy: null,
      regionHeaders: [],
    });
    expect(meter.calls[0]?.provenance).toEqual(result.provenance);
  });

  it("fails after the second rejection, and still meters both calls", async () => {
    const uncited = () => answer({ text: "[finding]", refs: [] });
    const provider = new ScriptedProvider([uncited, uncited]);
    const meter = new AccumulatingMeter();
    const error = await generateValidated(
      client(provider),
      "[tenant]",
      meter,
      statementsTask(RECORDS),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LlmOutputRejectedError);
    expect((error as LlmOutputRejectedError).problems.map((p) => p.code)).toEqual([
      "CITATION_MISSING",
    ]);
    expect(meter.totals()).toEqual({ inputTokens: 200, outputTokens: 40 });
  });

  it("rejects a strength a model may not claim", async () => {
    const observed = () => answer({ text: "[finding]", refs: ["E1"], strength: "OBSERVED" });
    const provider = new ScriptedProvider([observed, observed]);
    const error = await generateValidated(
      client(provider),
      "[tenant]",
      new AccumulatingMeter(),
      statementsTask(RECORDS),
    ).catch((e: unknown) => e);
    expect((error as LlmOutputRejectedError).problems.map((p) => p.code)).toContain(
      "RESPONSE_SCHEMA",
    );
  });

  it("rejects extra fields: the answer's schema is strict", async () => {
    const extra = () =>
      JSON.stringify({
        statements: [{ text: "[f]", strength: "INFERRED", refs: ["E1"] }],
        note: "[x]",
      });
    const provider = new ScriptedProvider([extra, extra]);
    await expect(
      generateValidated(
        client(provider),
        "[tenant]",
        new AccumulatingMeter(),
        statementsTask(RECORDS),
      ),
    ).rejects.toBeInstanceOf(LlmOutputRejectedError);
  });
});

describe("the response cache", () => {
  it("serves an accepted answer without calling or charging the model again", async () => {
    const cache = new MapCache();
    const first = new ScriptedProvider([() => answer({ text: "[finding]", refs: ["E1"] })]);
    await generateValidated(
      client(first, cache),
      "[tenant-a]",
      new AccumulatingMeter(),
      statementsTask(RECORDS),
    );
    const second = new ScriptedProvider([]);
    const meter = new AccumulatingMeter();
    const result = await generateValidated(
      client(second, cache),
      "[tenant-a]",
      meter,
      statementsTask(RECORDS),
    );
    expect(result.cached).toBe(true);
    expect(second.requests).toHaveLength(0);
    expect(meter.calls).toHaveLength(0);
  });

  it("reports where a cached answer was produced originally, region headers included", async () => {
    const cache = new MapCache();
    const original = via("[provider a]", [{ name: "x-example-region", value: "[region a]" }]);
    const first = new ScriptedProvider(
      [() => answer({ text: "[finding]", refs: ["E1"] })],
      undefined,
      [original],
    );
    await generateValidated(
      client(first, cache),
      "[tenant-a]",
      new AccumulatingMeter(),
      statementsTask(RECORDS),
    );
    const result = await generateValidated(
      client(new ScriptedProvider([]), cache),
      "[tenant-a]",
      new AccumulatingMeter(),
      statementsTask(RECORDS),
    );
    expect(result).toMatchObject({ cached: true, provenance: original });
  });

  it("treats an unreadable cache entry as a miss and calls the model", async () => {
    const cache = new MapCache();
    const seed = new ScriptedProvider([() => answer({ text: "[finding]", refs: ["E1"] })]);
    await generateValidated(
      client(seed, cache),
      "[tenant]",
      new AccumulatingMeter(),
      statementsTask(RECORDS),
    );
    // Entries without provenance: the bare answer text (format 1), and an answer
    // naming only its provider. Neither says where the answer was produced.
    const [key] = [...cache.entries.keys()];
    if (key === undefined) throw new Error("the first call cached nothing");
    for (const stale of [
      answer({ text: "[finding]", refs: ["E1"] }),
      JSON.stringify({ text: answer({ text: "[finding]", refs: ["E1"] }), servedBy: null }),
    ]) {
      cache.entries.set(key, stale);
      const provider = new ScriptedProvider(
        [() => answer({ text: "[finding]", refs: ["E1"] })],
        undefined,
        [via("[provider b]")],
      );
      const result = await generateValidated(
        client(provider, cache),
        "[tenant]",
        new AccumulatingMeter(),
        statementsTask(RECORDS),
      );
      expect(provider.requests).toHaveLength(1);
      expect(result).toMatchObject({ cached: false, provenance: via("[provider b]") });
    }
  });

  it("never serves one tenant's answer to another", async () => {
    const cache = new MapCache();
    const first = new ScriptedProvider([() => answer({ text: "[finding]", refs: ["E1"] })]);
    await generateValidated(
      client(first, cache),
      "[tenant-a]",
      new AccumulatingMeter(),
      statementsTask(RECORDS),
    );
    const other = new ScriptedProvider([() => answer({ text: "[finding]", refs: ["E1"] })]);
    const result = await generateValidated(
      client(other, cache),
      "[tenant-b]",
      new AccumulatingMeter(),
      statementsTask(RECORDS),
    );
    expect(result.cached).toBe(false);
    expect(other.requests).toHaveLength(1);
  });

  it("stores only accepted answers", async () => {
    const cache = new MapCache();
    const provider = new ScriptedProvider([
      () => answer({ text: "[finding]", refs: [] }),
      () => answer({ text: "[finding]", refs: ["E1"] }),
    ]);
    await generateValidated(
      client(provider, cache),
      "[tenant]",
      new AccumulatingMeter(),
      statementsTask(RECORDS),
    );
    expect(cache.entries.size).toBe(1);
    const stored = readCachedAnswer([...cache.entries.values()][0] ?? "");
    expect(stored?.text).toContain('"E1"');
    expect(stored?.provenance).toEqual(via(null));
  });

  it("calls the model when the cache cannot be reached, and says so", async () => {
    const broken: ResponseCache = {
      get: () => Promise.reject(new Error("[cache down]")),
      set: () => Promise.reject(new Error("[cache down]")),
    };
    const errors: unknown[] = [];
    const provider = new ScriptedProvider([() => answer({ text: "[finding]", refs: ["E1"] })]);
    const result = await generateValidated(
      { ...client(provider, broken), onCacheError: (e) => errors.push(e) },
      "[tenant]",
      new AccumulatingMeter(),
      statementsTask(RECORDS),
    );
    expect(result.cached).toBe(false);
    expect(errors).toHaveLength(2);
  });
});

describe("the Redis response cache", () => {
  let redis: Redis;
  beforeAll(() => {
    redis = new Redis(REDIS_URL, { lazyConnect: false, maxRetriesPerRequest: 1 });
  });
  afterAll(async () => {
    await redis.quit();
  });

  it("stores under a prefixed key with an expiry, and reads it back", async () => {
    const cache = new RedisResponseCache(redis, { prefix: "llm-test" });
    const key = `[tenant]:${String(Date.now())}`;
    await cache.set(key, "[answer]", 30);
    expect(await cache.get(key)).toBe("[answer]");
    const ttl = await redis.ttl(`llm-test:llm-cache:${key}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(30);
    await redis.del(`llm-test:llm-cache:${key}`);
  });
});

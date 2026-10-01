import { describe, expect, it } from "vitest";
import { envSchema, loadEnvSubset } from "./env.ts";
import { ConfigError } from "./errors.ts";
import { forbiddenModelReason, LLM_MODEL_ALLOWLIST, resolveLlmConfiguration } from "./llm.ts";

const LLM_VARIABLES = [
  "LLM_PROFILE",
  "LLM_HOSTED_BASE_URL",
  "LLM_HOSTED_API_KEY",
  "LLM_HOSTED_STRUCTURED_OUTPUT",
  "LLM_VLLM_ENABLED",
  "LLM_VLLM_BASE_URL",
  "LLM_VLLM_API_KEY",
  "LLM_SMALL_MODEL",
  "LLM_LARGE_MODEL",
  "LLM_MODEL_NAMES",
  "LLM_REQUEST_TIMEOUT_MS",
] as const;

function resolve(source: Record<string, string>) {
  return resolveLlmConfiguration(loadEnvSubset(LLM_VARIABLES, source));
}

function issuesOf(source: Record<string, string>): string[] {
  try {
    resolve(source);
  } catch (error) {
    if (error instanceof ConfigError) {
      return error.issues.map((issue) => `${issue.variable}: ${issue.problem}`);
    }
    throw error;
  }
  return expect.unreachable("resolution should have failed");
}

const HOSTED = {
  LLM_HOSTED_BASE_URL: "https://llm-provider.invalid/v1",
  LLM_HOSTED_API_KEY: "[platform key]",
};

describe("the model allowlist", () => {
  it("holds only permissively licensed models outside the excluded families", () => {
    for (const model of LLM_MODEL_ALLOWLIST) {
      expect(forbiddenModelReason(model), model.id).toBeNull();
    }
  });

  it("offers a small and a large model", () => {
    const classes = new Set(LLM_MODEL_ALLOWLIST.map((model) => model.sizeClass));
    expect([...classes].sort()).toEqual(["LARGE", "SMALL"]);
  });

  it("records where each licence and lineage was read", () => {
    for (const model of LLM_MODEL_ALLOWLIST) {
      expect(model.checked.sourceUrl).toBe(`https://huggingface.co/api/models/${model.id}`);
      expect(model.checked.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("refuses a Llama-derived model by its id or by its base model", () => {
    expect(
      forbiddenModelReason({ id: "[org]/Llama-3-8B", baseModel: null, licence: "Apache-2.0" }),
    ).toMatch(/Llama/);
    expect(
      forbiddenModelReason({
        id: "[org]/distilled-model",
        baseModel: "[org]/Meta-Llama-3.1-8B",
        licence: "MIT",
      }),
    ).toMatch(/Llama/);
  });

  it("refuses a Gemini model and a non-permissive licence", () => {
    expect(
      forbiddenModelReason({ id: "[org]/gemini-pro", baseModel: null, licence: "Apache-2.0" }),
    ).toMatch(/Gemini/);
    expect(
      forbiddenModelReason({ id: "[org]/some-model", baseModel: null, licence: "[custom]" }),
    ).toMatch(/not a permitted/);
  });

  it("rejects a model outside the allowlist at startup", () => {
    expect(() => loadEnvSubset(["LLM_LARGE_MODEL"], { LLM_LARGE_MODEL: "[org]/other" })).toThrow(
      ConfigError,
    );
  });
});

describe("the LLM profiles", () => {
  it("defaults to the hosted profile, not configured until a provider is set", () => {
    const configuration = resolve({});
    expect(configuration).toEqual({
      status: "NOT_CONFIGURED",
      reason: "No hosted LLM provider is configured (LLM_HOSTED_BASE_URL is not set).",
    });
  });

  it("routes small and large tasks to the configured hosted models", () => {
    const configuration = resolve({ ...HOSTED, LLM_MODEL_NAMES: "Qwen/Qwen3-32B=qwen3-32b" });
    if (configuration.status !== "READY") return expect.unreachable("should be ready");
    expect(configuration.endpoint.profile).toBe("hosted");
    expect(configuration.endpoint.baseUrl).toBe("https://llm-provider.invalid/v1");
    expect(configuration.endpoint.small.model.id).toBe("Qwen/Qwen3-8B");
    expect(configuration.endpoint.small.servedName).toBe("Qwen/Qwen3-8B");
    expect(configuration.endpoint.large.servedName).toBe("qwen3-32b");
  });

  it("needs a key for a hosted provider", () => {
    expect(issuesOf({ LLM_HOSTED_BASE_URL: HOSTED.LLM_HOSTED_BASE_URL })).toEqual([
      "LLM_HOSTED_API_KEY: required when LLM_HOSTED_BASE_URL is set",
    ]);
  });

  it("refuses an Azure OpenAI endpoint", () => {
    expect(
      issuesOf({ ...HOSTED, LLM_HOSTED_BASE_URL: "https://resource.openai.azure.com/openai" }),
    ).toEqual(["LLM_HOSTED_BASE_URL: Azure OpenAI endpoints are excluded (CLAUDE.md §4)."]);
  });

  it("keeps the vLLM profile disabled unless it is switched on", () => {
    expect(envSchema.shape.LLM_VLLM_ENABLED.parse(undefined)).toBe("false");
    expect(issuesOf({ LLM_PROFILE: "vllm" })).toEqual([
      "LLM_PROFILE: the vllm profile is disabled; set LLM_VLLM_ENABLED=true to use it",
    ]);
  });

  it("builds the vLLM profile with schema-constrained decoding when enabled", () => {
    const configuration = resolve({ LLM_PROFILE: "vllm", LLM_VLLM_ENABLED: "true" });
    if (configuration.status !== "READY") return expect.unreachable("should be ready");
    expect(configuration.endpoint).toMatchObject({
      profile: "vllm",
      baseUrl: "http://127.0.0.1:8000/v1",
      apiKey: null,
      structuredOutput: "json_schema",
    });
  });

  it("refuses a served-name mapping for a model that is not allowlisted", () => {
    expect(issuesOf({ ...HOSTED, LLM_MODEL_NAMES: "[org]/other=other" })).toEqual([
      "LLM_MODEL_NAMES: [org]/other is not an allowlisted model",
    ]);
  });

  it("gives the provider key no example value", () => {
    for (const name of ["LLM_HOSTED_API_KEY", "LLM_VLLM_API_KEY"] as const) {
      expect(envSchema.shape[name].meta()?.examples).toBeUndefined();
    }
  });
});

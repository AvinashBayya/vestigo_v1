/**
 * A scripted stand-in for a model, for the M4-4 extraction tests. It is NOT a
 * model and is never presented as one; it answers each call with the next
 * scripted text and records every request, so a test can check exactly what
 * reached the "model". No network, no real provider.
 */
import { allowedModel, type LlmEndpoint } from "@repo/config";
import {
  LlmUnavailableError,
  type CompletionRequest,
  type CompletionResult,
  type LlmClient,
  type LlmProvider,
} from "@repo/llm";

function model(id: string) {
  const found = allowedModel(id);
  if (found === null) throw new Error(`test fixture names a model that is not allowlisted: ${id}`);
  return found;
}

export const ENDPOINT: LlmEndpoint = {
  profile: "hosted",
  baseUrl: "https://llm-provider.invalid/v1",
  apiKey: "[platform key]",
  structuredOutput: "none",
  timeoutMs: 5_000,
  small: { model: model("Qwen/Qwen3-8B"), servedName: "Qwen/Qwen3-8B" },
  large: { model: model("Qwen/Qwen3-32B"), servedName: "Qwen/Qwen3-32B" },
};

/** Answers each call with the next scripted text; records every request. */
export class ScriptedProvider implements LlmProvider {
  readonly profile = "hosted";
  readonly requests: CompletionRequest[] = [];
  #script: string[];
  constructor(answers: readonly string[]) {
    this.#script = [...answers];
  }
  complete(request: CompletionRequest): Promise<CompletionResult> {
    this.requests.push(request);
    const next = this.#script.shift();
    if (next === undefined) return Promise.reject(new Error("the script has no more answers"));
    return Promise.resolve({
      text: next,
      usage: { inputTokens: 100, outputTokens: 20 },
      provenance: { endpointHost: "llm-provider.invalid", servedBy: null, regionHeaders: [] },
    });
  }
}

/** Rejects every call with an LlmUnavailableError, for the provider-error path. */
export class UnavailableProvider implements LlmProvider {
  readonly profile = "hosted";
  complete(): Promise<CompletionResult> {
    return Promise.reject(new LlmUnavailableError("the model endpoint is down"));
  }
}

export const clientWith = (provider: LlmProvider): LlmClient => ({
  endpoint: ENDPOINT,
  provider,
  cache: null,
  cacheTtlSeconds: 60,
});

/** A model answer in the extraction schema (subjectType defaults to OTHER). */
export const extractionAnswer = (
  statements: {
    subjectType?: string;
    subject: string;
    attribute: string;
    value: string;
    quote: string;
  }[],
): string =>
  JSON.stringify({ statements: statements.map((s) => ({ subjectType: "OTHER", ...s })) });

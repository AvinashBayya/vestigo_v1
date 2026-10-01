import type { LlmEndpoint } from "@repo/config";
import { allowedModel } from "@repo/config";
import { z } from "zod";
import {
  checkOutput,
  trusted,
  validateCitations,
  type CallProvenance,
  type CompletionRequest,
  type CompletionResult,
  type LlmProvider,
  type RegionHeader,
  type UntrustedRecord,
  type ValidatedTask,
} from "../src/index.ts";

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

/** The host of ENDPOINT's base URL: where the scripted provider "sends" requests. */
export const ENDPOINT_HOST = "llm-provider.invalid";

/** A call's provenance via ENDPOINT: the upstream provider it names, and its raw region headers. */
export const via = (
  servedBy: string | null,
  regionHeaders: readonly RegionHeader[] = [],
): CallProvenance => ({ endpointHost: ENDPOINT_HOST, servedBy, regionHeaders });

/**
 * A scripted stand-in for a model: answers each request with the next
 * scripted function's text. It records every request, so tests can check
 * exactly what reached the "model". Not a model, and never presented as one.
 */
export class ScriptedProvider implements LlmProvider {
  readonly profile = "hosted";
  readonly requests: CompletionRequest[] = [];
  readonly #script: ((request: CompletionRequest) => string)[];
  readonly #usage: { inputTokens: number; outputTokens: number };
  readonly #provenance: CallProvenance[];

  /**
   * `provenance`: what each answer reports, in turn; once exhausted, an
   * answer names no provider and no region (`via(null)`).
   */
  constructor(
    script: readonly ((request: CompletionRequest) => string)[],
    usage = { inputTokens: 100, outputTokens: 20 },
    provenance: readonly CallProvenance[] = [],
  ) {
    this.#script = [...script];
    this.#usage = usage;
    this.#provenance = [...provenance];
  }

  complete(request: CompletionRequest): Promise<CompletionResult> {
    this.requests.push(request);
    const next = this.#script.shift();
    if (next === undefined) return Promise.reject(new Error("the script has no more answers"));
    return Promise.resolve({
      text: next(request),
      usage: this.#usage,
      provenance: this.#provenance.shift() ?? via(null),
    });
  }
}

export const StatementsSchema = z.strictObject({
  statements: z.array(
    z.strictObject({
      text: z.string().min(1),
      strength: z.enum(["CORRELATED", "INFERRED", "HYPOTHESIS"]),
      refs: z.array(z.string()),
    }),
  ),
});

export const answer = (...statements: { text: string; refs: string[]; strength?: string }[]) =>
  JSON.stringify({
    statements: statements.map((s) => ({ strength: "INFERRED", ...s })),
  });

/** A minimal cited-statements task, validated as reports are: citations, then guards. */
export function statementsTask(
  records: readonly UntrustedRecord[],
): ValidatedTask<typeof StatementsSchema> {
  const refs = new Map(records.map((record) => [record.ref, { source: record.source }]));
  return {
    task: "synthesis",
    promptVersion: "test-1",
    system: trusted`You summarise evidence records for an analyst.`,
    instructions: trusted`Write cited statements about the records below.`,
    records,
    schema: StatementsSchema,
    maxTokens: 400,
    validate: (value, framed) => [
      ...validateCitations(value.statements, { refs }),
      ...checkOutput(value.statements, { framed, records }),
    ],
  };
}

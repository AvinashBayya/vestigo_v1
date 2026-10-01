/**
 * Live evaluation: runs the golden set through the CONFIGURED model, with the
 * production pipeline (framing, validation, one retry), and scores what it
 * accepts. Exits 1 when the model misses the thresholds or any case is
 * rejected outright. Needs a provider (LLM_* variables); it is not part of
 * the CI test run, which has none.
 *
 *   pnpm --filter @repo/llm eval:live
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvSubset, resolveLlmConfiguration } from "@repo/config";
import { SYNTHESIS_STRENGTHS } from "@repo/core";
import { z } from "zod";
import {
  AccumulatingMeter,
  checkOutput,
  createLlmClient,
  generateValidated,
  LlmOutputRejectedError,
  meetsThresholds,
  scoreAnswer,
  summarise,
  trusted,
  validateCitations,
  type AnswerScore,
  type CallProvenance,
  type GoldenCase,
} from "../src/index.ts";

const env = loadEnvSubset([
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
]);
const llm = createLlmClient(resolveLlmConfiguration(env), {
  redis: null,
  keyPrefix: "eval",
  cacheTtlSeconds: 1,
});
if ("unavailable" in llm) {
  console.error(`No model to evaluate: ${llm.unavailable}`);
  process.exit(2);
}

const Answer = z.strictObject({
  statements: z
    .array(
      z.strictObject({
        text: z.string().min(1).max(600),
        strength: z.enum(SYNTHESIS_STRENGTHS),
        refs: z.array(z.string()).max(12),
      }),
    )
    .min(1)
    .max(8),
});

const golden = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "eval", "golden.json"), "utf8"),
) as { cases: GoldenCase[] };

const scores: AnswerScore[] = [];
let rejected = 0;
const meter = new AccumulatingMeter();
console.log(
  `profile ${llm.endpoint.profile}, structured output ${llm.endpoint.structuredOutput}, model ${llm.endpoint.large.model.id}`,
);

/** Where a call went, as recorded: the endpoint, the provider it named, its raw region headers. */
function describe(provenance: CallProvenance): string {
  const regions = provenance.regionHeaders.map(({ name, value }) => `${name}: ${value}`);
  return [
    `endpoint ${provenance.endpointHost}`,
    `provider ${provenance.servedBy ?? "[none named]"}`,
    `region headers ${regions.length === 0 ? "[none]" : regions.join("; ")}`,
  ].join(", ");
}
for (const golden_ of golden.cases) {
  const refs = new Map(golden_.records.map((r) => [r.ref, { source: r.source }]));
  const callsBefore = meter.calls.length;
  // This case's own calls: every attempt, a rejected answer's included.
  const caseTokens = () =>
    meter.calls.slice(callsBefore).reduce(
      (sum, call) => ({
        inputTokens: sum.inputTokens + call.usage.inputTokens,
        outputTokens: sum.outputTokens + call.usage.outputTokens,
      }),
      { inputTokens: 0, outputTokens: 0 },
    );
  try {
    const result = await generateValidated(llm, "eval", meter, {
      task: "synthesis",
      promptVersion: "eval-live-1",
      system: trusted`You write the synthesis section of an OSINT evidence report, only from the supplied records.`,
      instructions: trusted`Write between one and five cited statements about the records below. Every statement cites refs; strength is CORRELATED (two or more sources), INFERRED or HYPOTHESIS. Never claim certainty, never issue a verdict, never name an identifier the cited records do not hold. Answer with {"statements":[{"text":"...","strength":"INFERRED","refs":["E1"]}]} only.`,
      records: golden_.records,
      schema: Answer,
      maxTokens: 3000,
      validate: (value, framed) => [
        ...validateCitations(value.statements, { refs }),
        ...checkOutput(value.statements, { framed, records: golden_.records }),
      ],
    });
    const score = scoreAnswer(golden_, result.value.statements);
    scores.push(score);
    console.log(
      `${golden_.id}: ${JSON.stringify(score)} (attempts ${String(result.attempts)}, tokens ${JSON.stringify(caseTokens())}, ${describe(result.provenance)})`,
    );
  } catch (error) {
    if (!(error instanceof LlmOutputRejectedError)) throw error;
    rejected += 1;
    console.log(
      `${golden_.id}: REJECTED ${error.problems.map((p) => p.code).join(", ")} (tokens ${JSON.stringify(caseTokens())})`,
    );
  }
}
const summary = summarise(scores);
// Tokens per destination: the endpoint, and the upstream provider it named if any.
const byProvider: Record<string, { calls: number; inputTokens: number; outputTokens: number }> = {};
for (const call of meter.calls) {
  const key = describe(call.provenance);
  const entry = (byProvider[key] ??= { calls: 0, inputTokens: 0, outputTokens: 0 });
  entry.calls += 1;
  entry.inputTokens += call.usage.inputTokens;
  entry.outputTokens += call.usage.outputTokens;
}
console.log(
  JSON.stringify({
    model: llm.endpoint.large.model.id,
    structuredOutput: llm.endpoint.structuredOutput,
    ...summary,
    rejected,
    tokens: meter.totals(),
    byProvider,
  }),
);
process.exit(meetsThresholds(summary) && rejected === 0 ? 0 : 1);

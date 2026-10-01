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
for (const golden_ of golden.cases) {
  const refs = new Map(golden_.records.map((r) => [r.ref, { source: r.source }]));
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
    console.log(`${golden_.id}: ${JSON.stringify(score)} (attempts ${String(result.attempts)})`);
  } catch (error) {
    if (!(error instanceof LlmOutputRejectedError)) throw error;
    rejected += 1;
    console.log(`${golden_.id}: REJECTED ${error.problems.map((p) => p.code).join(", ")}`);
  }
}
const summary = summarise(scores);
console.log(
  JSON.stringify({
    model: llm.endpoint.large.model.id,
    ...summary,
    rejected,
    tokens: meter.totals(),
  }),
);
process.exit(meetsThresholds(summary) && rejected === 0 ? 0 : 1);

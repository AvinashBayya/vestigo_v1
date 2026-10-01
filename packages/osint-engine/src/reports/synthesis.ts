/**
 * The report's synthesis: the one section a model writes. The model reads the
 * report's own claims, as untrusted records, and writes a few statements that
 * connect them. Every statement cites the records it rests on, carries a
 * strength a model may claim (CORRELATED, INFERRED or HYPOTHESIS, never
 * OBSERVED, REPORTED or DERIVED), and passes the citation validator and the
 * output guards (@repo/llm). An answer that fails twice fails the report:
 * uncited or instruction-following text is never printed (CLAUDE.md §4).
 *
 * The previous codebase's product prompts (reports.ts, INVENTORY: ADAPT) are
 * not carried over: they concatenated the sources into the instructions and
 * let the model label its own statements "reported". Their discipline is:
 * cite everything, never assign numeric scores, record what cannot be said.
 */
import { AppError, SYNTHESIS_STRENGTHS, type ReportSynthesis } from "@repo/core";
import {
  checkOutput,
  generateValidated,
  trusted,
  validateCitations,
  type LlmClient,
  type TokenMeter,
} from "@repo/llm";
import { z } from "zod";
import type { AssembledReport } from "./assemble.ts";

/** Bumped whenever the instructions or the schema below change; part of the cache key. */
export const SYNTHESIS_PROMPT_VERSION = "report-synthesis-1";

export const SYNTHESIS_NOTICE =
  "Written by an open-weight language model from the claims in this report and nothing else. Every statement cites the sources it rests on and passed automated citation and injection checks; it is an analytic synthesis, not a verified finding, and needs analyst review.";

export const SynthesisAnswer = z.strictObject({
  statements: z
    .array(
      z.strictObject({
        text: z.string().min(1).max(600),
        strength: z.enum(SYNTHESIS_STRENGTHS),
        refs: z.array(z.string().regex(/^E\d{1,5}$/)).max(12),
      }),
    )
    .min(1)
    .max(8),
});

const SYSTEM = trusted`You write the synthesis section of an open-source intelligence evidence report for a professional analyst. You work only from the records supplied with the task, never from your own knowledge. You state what the records show and how they connect, precisely and without embellishment.`;

const INSTRUCTIONS = trusted`TASK
The records below are the claims this report already lists, grouped by the source they came from. Each record has a ref (E1, E2, ...). Write between one and eight statements that synthesise what the records show taken together: how the findings connect, what they suggest, and what they leave open. Do not restate single claims one by one; the report already lists every claim.

RULES, CHECKED MECHANICALLY AFTER YOU ANSWER
- Every statement cites at least one ref in "refs". Cite only refs that appear in the records.
- "strength" is CORRELATED when the statement links records from two or more different sources (cite them all), INFERRED when it is an inference from the cited records, HYPOTHESIS when it is a possibility the records permit but do not establish. Never use any other strength.
- Never describe anything as confirmed, proven, verified, certain or definitive.
- Never pronounce anything safe, trustworthy, legitimate, malicious or risky, and never assign a score.
- Never name a URL, e-mail address, domain, IP address or handle that the cited records do not contain.
- If the records support very little, say so in a statement that cites them.

ANSWER FORMAT
Return exactly one JSON object and nothing else:
{"statements": [{"text": "...", "strength": "INFERRED", "refs": ["E1"]}]}`;

/** Maximum tokens the synthesis may write, reasoning included. */
const MAX_TOKENS = 3000;

/**
 * Writes the synthesis, or says why there is none. Throws what @repo/llm
 * throws: LlmOutputRejectedError after a second invalid answer, and the
 * provider's errors (unavailable, refused, unusable) for the caller to act on.
 */
export async function synthesise(
  client: LlmClient,
  tenantId: string,
  meter: TokenMeter,
  assembled: Pick<AssembledReport, "records" | "refs">,
  generatedAt: Date,
): Promise<ReportSynthesis> {
  if (assembled.records.length === 0) {
    return {
      status: "SKIPPED",
      reason: "The run produced no claims, so there was nothing to synthesise.",
    };
  }
  const refs = new Map([...assembled.refs].map(([ref, { source }]) => [ref, { source }] as const));
  const result = await generateValidated(client, tenantId, meter, {
    task: "synthesis",
    promptVersion: SYNTHESIS_PROMPT_VERSION,
    system: SYSTEM,
    instructions: INSTRUCTIONS,
    records: assembled.records,
    schema: SynthesisAnswer,
    maxTokens: MAX_TOKENS,
    validate: (value, framed) => [
      ...validateCitations(value.statements, { refs }),
      ...checkOutput(value.statements, { framed, records: assembled.records }),
    ],
  });
  return {
    status: "GENERATED",
    model: {
      id: result.modelId,
      licence: result.licence,
      profile: result.profile,
      endpointHost: result.provenance.endpointHost,
      servedBy: result.provenance.servedBy,
      // Raw, as the endpoint sent them: copied, never interpreted.
      regionHeaders: result.provenance.regionHeaders.map(({ name, value }) => ({ name, value })),
    },
    statements: result.value.statements.map((statement) => ({
      text: statement.text,
      strength: statement.strength,
      citations: [
        ...new Set(
          statement.refs.map((ref) => {
            const known = assembled.refs.get(ref);
            // validateCitations refused any unknown ref before this point.
            if (known === undefined) throw new SynthesisReferenceError();
            return known.number;
          }),
        ),
      ].sort((a, b) => a - b),
    })),
    generatedAt: generatedAt.toISOString(),
    attempts: result.attempts,
    notice: SYNTHESIS_NOTICE,
  };
}

export class SynthesisReferenceError extends AppError {
  readonly code = "SYNTHESIS_REFERENCE_UNKNOWN";

  constructor() {
    super("A validated synthesis cited a reference the report does not have.");
    this.name = "SynthesisReferenceError";
  }
}

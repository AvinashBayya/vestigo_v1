/**
 * The citation validator (CLAUDE.md §4): every claim a model writes maps to
 * evidence it was given. Checked in code after the model answers, because a
 * prompt instruction is a request, not a guarantee.
 *
 * Ported from the previous codebase: reports.ts `validateCitations` and
 * cases/case-analysis.ts `validateGroundedAnswer` (INVENTORY: ADAPT). Kept:
 * unknown references are rejected; a corroboration claim needs at least two
 * distinct sources; certainty language is rejected unless negated
 * (`assertsCertainty`, with its negator window). Fixed, each with a
 * regression test (test/citations.test.ts):
 *   - Every statement cites, whatever its strength. The previous grounded
 *     validator let INFERRED and HYPOTHESIS findings cite nothing, and the
 *     previous report validator never checked the bottom line at all.
 *   - References are the platform's evidence references, checked against the
 *     set supplied, not document-local numbers.
 *   - Two references from one source are one source: corroboration and
 *     CORRELATED need two independent sources, not two items from one.
 *   - Problem messages are fixed text naming the statement by position. The
 *     previous validators quoted the model's own words back into the retry
 *     prompt, so text a source had planted in an answer reached the
 *     instruction channel.
 */
import type { OutputProblem } from "./errors.ts";

export interface CitedStatement {
  readonly text: string;
  readonly strength: string;
  readonly refs: readonly string[];
}

export interface CitationContext {
  /** Every citable reference, with the source it came from (its independence key). */
  readonly refs: ReadonlyMap<string, { readonly source: string }>;
}

/**
 * Words that assert certainty collected evidence cannot support. A closed
 * list, used through `assertsCertainty`, so negated forms ("not confirmed")
 * stay allowed: they are the honest phrasing.
 */
const CERTAINTY_WORDS =
  /\b(confirmed|confirms|proven|proves|certain|certainty|certainly|definitive|definitively|conclusive|conclusively|indisputable|indisputably|undeniably|verified|established as fact)\b/gi;

/** Negators that flip a certainty word, in the few words before it. */
const NEGATORS =
  /\b(not|never|no|nothing|cannot|can't|isn't|aren't|wasn't|weren't|without|lack|lacks|lacking|far from|neither|nor|yet to be|remains? to be)\s+(?:\w+\s+){0,2}$/i;

/** True when a statement asserts certainty rather than denying it. */
export function assertsCertainty(statement: string): boolean {
  CERTAINTY_WORDS.lastIndex = 0;
  for (let m = CERTAINTY_WORDS.exec(statement); m !== null; m = CERTAINTY_WORDS.exec(statement)) {
    if (!NEGATORS.test(statement.slice(0, m.index))) return true;
  }
  return false;
}

const CORROBORATION =
  /\b(corroborat\w*|multiple sources|several sources|two sources|three sources|both sources|independent(ly)? (sources|confirm\w*|report\w*))\b/i;

export function validateCitations(
  statements: readonly CitedStatement[],
  context: CitationContext,
): OutputProblem[] {
  const problems: OutputProblem[] = [];
  if (statements.length === 0) {
    problems.push({
      statement: null,
      code: "NO_STATEMENTS",
      message: "The answer contains no statements. Write at least one cited statement.",
    });
  }

  statements.forEach((statement, index) => {
    const at = (code: string, message: string) =>
      problems.push({ statement: index, code, message });

    if (statement.refs.length === 0) {
      at(
        "CITATION_MISSING",
        "cites no evidence. Every statement must cite at least one reference from the data block.",
      );
    }
    const known = statement.refs.filter((ref) => context.refs.has(ref));
    if (known.length !== statement.refs.length) {
      at(
        "CITATION_UNKNOWN",
        "cites a reference that is not in the data block. Cite only the refs the records carry.",
      );
    }
    const sources = new Set(known.map((ref) => context.refs.get(ref)?.source));
    if (statement.strength === "CORRELATED" && sources.size < 2) {
      at(
        "CORRELATION_SINGLE_SOURCE",
        "is CORRELATED but cites fewer than two independent sources. Cite two sources or mark it INFERRED.",
      );
    }
    if (CORROBORATION.test(statement.text) && sources.size < 2) {
      at(
        "CORROBORATION_SINGLE_SOURCE",
        "claims corroboration but cites fewer than two independent sources. Restate it as a single-source statement.",
      );
    }
    if (assertsCertainty(statement.text)) {
      at(
        "CERTAINTY_ASSERTED",
        "states something as confirmed, proven or certain. Say what the evidence shows, not that it is certain.",
      );
    }
  });
  return problems;
}

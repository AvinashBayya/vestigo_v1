/**
 * Per-tenant token metering (CLAUDE.md §4). Every model call that consumed
 * tokens is recorded, including one whose output was then rejected: the
 * tokens were spent either way. A cache hit calls no model and records
 * nothing. A call that failed before the provider reported usage (a timeout,
 * a refused request) has no measured quantity and records nothing; usage is
 * never estimated. Such a call may still have reached an upstream provider,
 * which then goes unrecorded: the endpoint named none.
 */
import type { CallProvenance, TokenUsage } from "./provider.ts";

export interface MeteredCall {
  readonly task: string;
  readonly modelId: string;
  readonly usage: TokenUsage;
  /** Where the call went: the endpoint host, the provider it named, its raw region headers. */
  readonly provenance: CallProvenance;
}

export interface TokenMeter {
  record(call: MeteredCall): void;
}

/**
 * Accumulates one unit of work's calls (one report generation attempt), for
 * the caller to write with that work's outcome in one transaction.
 */
export class AccumulatingMeter implements TokenMeter {
  readonly #calls: MeteredCall[] = [];

  record(call: MeteredCall): void {
    this.#calls.push(call);
  }

  get calls(): readonly MeteredCall[] {
    return this.#calls;
  }

  /** Tokens across every recorded call. Zero when no call was made: a measured nothing. */
  totals(): TokenUsage {
    let inputTokens = 0;
    let outputTokens = 0;
    for (const call of this.#calls) {
      inputTokens += call.usage.inputTokens;
      outputTokens += call.usage.outputTokens;
    }
    return { inputTokens, outputTokens };
  }
}

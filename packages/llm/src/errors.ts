import { AppError } from "@repo/core";

/** No provider is configured, so no model can be called. Never retried. */
export class LlmNotConfiguredError extends AppError {
  readonly code = "LLM_NOT_CONFIGURED";

  constructor(reason: string) {
    super(reason);
    this.name = "LlmNotConfiguredError";
  }
}

/**
 * The provider could not answer: a timeout, a network failure, a rate limit
 * or a 5xx. Retryable with backoff, like an unavailable collector upstream.
 */
export class LlmUnavailableError extends AppError {
  readonly code = "LLM_UNAVAILABLE";
  /** The provider's own Retry-After, in milliseconds, when it sent one. */
  readonly retryAfterMs: number | null;
  readonly status: number | null;

  constructor(message: string, options: { status?: number; retryAfterMs?: number | null } = {}) {
    super(message);
    this.name = "LlmUnavailableError";
    this.status = options.status ?? null;
    this.retryAfterMs = options.retryAfterMs ?? null;
  }
}

/**
 * The provider refused the request (a 4xx other than 429): a bad key, an
 * unknown model, a malformed request. Retrying would fail the same way.
 */
export class LlmRequestRejectedError extends AppError {
  readonly code = "LLM_REQUEST_REJECTED";
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "LlmRequestRejectedError";
    this.status = status;
  }
}

/**
 * The provider answered, but not with something usable: no content, output
 * cut off at the token limit, or a response missing its token usage (an
 * unmetered call is refused, CLAUDE.md §4).
 */
export class LlmResponseInvalidError extends AppError {
  readonly code = "LLM_RESPONSE_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "LlmResponseInvalidError";
  }
}

/** One reason a model's output was rejected. Messages are fixed text: they never quote the output. */
export interface OutputProblem {
  /** The statement concerned, 0-based, or null for the output as a whole. */
  readonly statement: number | null;
  readonly code: string;
  readonly message: string;
}

/**
 * The model's output failed validation on both attempts (the first, and one
 * retry with the problems stated). Nothing from it is used (CLAUDE.md §4).
 */
export class LlmOutputRejectedError extends AppError {
  readonly code = "LLM_OUTPUT_REJECTED";
  readonly problems: readonly OutputProblem[];

  constructor(problems: readonly OutputProblem[]) {
    super(
      `The model's output failed validation twice and was rejected: ${problems
        .map((p) =>
          p.statement === null ? p.code : `statement ${String(p.statement + 1)} ${p.code}`,
        )
        .join("; ")}.`,
    );
    this.name = "LlmOutputRejectedError";
    this.problems = problems;
  }
}

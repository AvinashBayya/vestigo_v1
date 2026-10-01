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
 * What an endpoint's error body said, after ./endpoint-error.ts has cleaned
 * it. Null where the body said nothing usable, or nothing safe to repeat.
 */
export interface EndpointErrorDetail {
  /** The endpoint's own error code or type (e.g. a quota or auth code). */
  readonly code: string | null;
  /** The endpoint's own words: bounded, redacted, never an echo of the request. */
  readonly message: string | null;
}

const NO_DETAIL: EndpointErrorDetail = { code: null, message: null };

/**
 * The provider could not answer: a timeout, a network failure, a rate limit
 * or a 5xx. Retryable with backoff, like an unavailable collector upstream.
 */
export class LlmUnavailableError extends AppError {
  readonly code = "LLM_UNAVAILABLE";
  /** The provider's own Retry-After, in milliseconds, when it sent one. */
  readonly retryAfterMs: number | null;
  readonly status: number | null;
  readonly endpoint: EndpointErrorDetail;

  constructor(
    message: string,
    options: {
      status?: number;
      retryAfterMs?: number | null;
      endpoint?: EndpointErrorDetail;
    } = {},
  ) {
    super(message);
    this.name = "LlmUnavailableError";
    this.status = options.status ?? null;
    this.retryAfterMs = options.retryAfterMs ?? null;
    this.endpoint = options.endpoint ?? NO_DETAIL;
  }
}

/**
 * The provider refused the request (a 4xx other than 429): a bad key, an
 * unknown model, a malformed request, no credit left (402). Retrying would
 * fail the same way.
 */
export class LlmRequestRejectedError extends AppError {
  readonly code = "LLM_REQUEST_REJECTED";
  readonly status: number;
  readonly endpoint: EndpointErrorDetail;

  constructor(message: string, status: number, endpoint: EndpointErrorDetail = NO_DETAIL) {
    super(message);
    this.name = "LlmRequestRejectedError";
    this.status = status;
    this.endpoint = endpoint;
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

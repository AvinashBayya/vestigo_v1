import { AppError } from "@repo/core";

/**
 * Typed collector errors (CLAUDE.md §8). Messages never include a target
 * value, a credential, or a URL path or query: any of those can carry personal
 * data or a secret. Hosts may appear; they name upstreams, not people.
 */

/** The catalogue or a collector declaration breaks a registry rule. Raised at startup. */
export class CollectorDefinitionError extends AppError {
  readonly code = "COLLECTOR_DEFINITION_INVALID";
  readonly subject: string;

  constructor(subject: string, problem: string) {
    super(`${subject}: ${problem}`);
    this.name = "CollectorDefinitionError";
    this.subject = subject;
  }
}

/** No collector with that id is registered. */
export class UnknownCollectorError extends AppError {
  readonly code = "COLLECTOR_UNKNOWN";

  constructor(collectorId: string) {
    super(`No collector "${collectorId}" is registered.`);
    this.name = "UnknownCollectorError";
  }
}

export type TargetProblem = "EMPTY" | "TOO_LONG" | "MALFORMED";

/** A target is not a valid value of its type. Invalid targets fail immediately (CLAUDE.md §5). */
export class InvalidTargetError extends AppError {
  readonly code = "TARGET_INVALID";
  readonly problem: TargetProblem;

  constructor(targetType: string, problem: TargetProblem) {
    super(`The ${targetType} target is invalid (${problem.toLowerCase().replaceAll("_", " ")}).`);
    this.name = "InvalidTargetError";
    this.problem = problem;
  }
}

export type DestinationRefusal =
  | "MALFORMED_URL"
  | "SCHEME_NOT_ALLOWED"
  | "CREDENTIALS_IN_URL"
  | "HOST_NOT_ALLOWED"
  | "PORT_NOT_ALLOWED"
  | "NO_ADDRESS"
  | "ADDRESS_NOT_PUBLIC"
  | "TOO_MANY_REDIRECTS";

/**
 * The fetcher refused a destination before any packet reached it: outside the
 * source's allowlist, or resolving to a private, loopback, link-local or
 * metadata address. Permanent: retrying cannot change the answer.
 */
export class DestinationRefusedError extends AppError {
  readonly code = "DESTINATION_REFUSED";
  readonly reason: DestinationRefusal;

  constructor(reason: DestinationRefusal, detail: string) {
    super(`Outbound request refused (${reason}): ${detail}.`);
    this.name = "DestinationRefusedError";
    this.reason = reason;
  }
}

/** A fetch was called with options the fetcher does not accept. A collector bug. */
export class FetchOptionsError extends AppError {
  readonly code = "FETCH_OPTIONS_INVALID";

  constructor(problem: string) {
    super(`Invalid fetch options: ${problem}.`);
    this.name = "FetchOptionsError";
  }
}

/** The fetch did not finish within its timeout, or the run's budget ran out. Retryable. */
export class UpstreamTimeoutError extends AppError {
  readonly code = "UPSTREAM_TIMEOUT";

  constructor(host: string, timeoutMs: number) {
    super(`The request to ${host} did not complete within ${String(timeoutMs)} ms.`);
    this.name = "UpstreamTimeoutError";
  }
}

/** The shared per-upstream limit has no slot within the fetch's timeout. Retryable. */
export class UpstreamRateLimitedError extends AppError {
  readonly code = "UPSTREAM_RATE_LIMITED";
  readonly retryAfterMs: number;

  constructor(sourceId: string, retryAfterMs: number) {
    super(`The shared rate limit for ${sourceId} has no free slot for ${String(retryAfterMs)} ms.`);
    this.name = "UpstreamRateLimitedError";
    this.retryAfterMs = retryAfterMs;
  }
}

/** The rate limiter itself could not answer. Fails closed: nothing is sent. Retryable. */
export class RateLimiterUnavailableError extends AppError {
  readonly code = "RATE_LIMITER_UNAVAILABLE";

  constructor(options?: ErrorOptions) {
    super("The shared rate limiter is unavailable, so no request was sent.", options);
    this.name = "RateLimiterUnavailableError";
  }
}

/** DNS failed, or the connection was refused or reset. Retryable. */
export class UpstreamUnreachableError extends AppError {
  readonly code = "UPSTREAM_UNREACHABLE";

  constructor(host: string, options?: ErrorOptions) {
    super(`Could not reach ${host}.`, options);
    this.name = "UpstreamUnreachableError";
  }
}

/** The response body exceeded the fetch's size limit. Permanent for that request. */
export class ResponseTooLargeError extends AppError {
  readonly code = "UPSTREAM_RESPONSE_TOO_LARGE";

  constructor(host: string, maxBytes: number) {
    super(`The response from ${host} exceeded ${String(maxBytes)} bytes.`);
    this.name = "ResponseTooLargeError";
  }
}

// ── Thrown by collector implementations ──────────────────────────────────

/** The upstream is temporarily unable to answer (5xx, maintenance, its own 429). Retryable. */
export class UpstreamUnavailableError extends AppError {
  readonly code = "UPSTREAM_UNAVAILABLE";
  readonly retryAfterMs: number | null;

  constructor(problem: string, retryAfterMs: number | null = null) {
    super(`The upstream is unavailable: ${problem}.`);
    this.name = "UpstreamUnavailableError";
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * The upstream refused the request (401, 403). Permanent until something
 * changes. The runtime reports it as UPSTREAM_REJECTED_CREDENTIALS only when
 * the run was handed a credential; otherwise as UPSTREAM_REFUSED.
 */
export class UpstreamRejectedError extends AppError {
  readonly code = "UPSTREAM_REJECTED_CREDENTIALS";
  /** What the collector saw, without the credentials framing. */
  readonly problem: string;

  constructor(problem: string) {
    super(`The upstream rejected the request's credentials: ${problem}.`);
    this.problem = problem;
    this.name = "UpstreamRejectedError";
  }
}

/** The upstream answered with something the collector cannot interpret. Permanent. */
export class UpstreamResponseError extends AppError {
  readonly code = "UPSTREAM_RESPONSE_INVALID";

  constructor(problem: string) {
    super(`The upstream's response could not be used: ${problem}.`);
    this.name = "UpstreamResponseError";
  }
}

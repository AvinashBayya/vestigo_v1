import { AppError } from "@repo/core";

/**
 * The limiter could not reach a decision: Redis failed, timed out, was not
 * connected, or replied with something unexpected. Callers FAIL CLOSED on
 * this error; it is never to be read as "allowed".
 */
export class RateLimiterUnavailableError extends AppError {
  readonly code = "RATE_LIMITER_UNAVAILABLE";

  constructor(reason: string, options?: { readonly cause: unknown }) {
    super(`Rate limiter unavailable: ${reason}.`, options);
    this.name = "RateLimiterUnavailableError";
  }
}

/** The limiter or its Redis client was configured unsafely or incorrectly. */
export class RateLimiterConfigError extends AppError {
  readonly code = "RATE_LIMITER_CONFIG_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "RateLimiterConfigError";
  }
}

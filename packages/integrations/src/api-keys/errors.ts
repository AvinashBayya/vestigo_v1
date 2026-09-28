import { AppError } from "@repo/core";

/**
 * Typed errors of the API key lifecycle (CLAUDE.md §8). None carries a key, a
 * secret or a hash. Scope errors are @repo/access's ApiKeyScopeError.
 */

export type ApiKeyInputField = "name" | "expiresAt" | "overlapUntil";

/** A create or rotate request failed validation. Never echoes the value. */
export class ApiKeyInputError extends AppError {
  readonly code = "API_KEY_INPUT_INVALID";
  readonly field: ApiKeyInputField;

  constructor(field: ApiKeyInputField, requirement: string) {
    super(`Invalid API key ${field}: ${requirement}.`);
    this.name = "ApiKeyInputError";
    this.field = field;
  }
}

/** No usable (unrevoked, unexpired) key with that id exists in this tenant. */
export class ApiKeyNotFoundError extends AppError {
  readonly code = "API_KEY_NOT_FOUND";

  constructor() {
    super("No usable API key with that id exists in this tenant.");
    this.name = "ApiKeyNotFoundError";
  }
}

/**
 * Authentication with an API key failed. One message for every cause
 * (unknown key, wrong secret, revoked, expired, wrong tenant), so a caller
 * cannot probe which it was.
 */
export class ApiKeyAuthenticationError extends AppError {
  readonly code = "API_KEY_INVALID";

  constructor() {
    super("The API key is invalid.");
    this.name = "ApiKeyAuthenticationError";
  }
}

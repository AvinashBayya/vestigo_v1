import { AppError } from "@repo/core";

/** Typed API key scope errors (CLAUDE.md §8). None carries a key, a secret or a hash. */

export type ApiKeyScopeProblem = "EMPTY" | "UNKNOWN_PERMISSION" | "EXCEEDS_GRANTOR";

/**
 * A key's scope is not grantable: empty, naming permissions that do not
 * exist, or naming permissions the grantor does not hold. `permissions`
 * lists the offending entries.
 */
export class ApiKeyScopeError extends AppError {
  readonly code = "API_KEY_SCOPE_INVALID";
  readonly problem: ApiKeyScopeProblem;
  readonly permissions: readonly string[];

  constructor(problem: ApiKeyScopeProblem, permissions: readonly string[]) {
    const listed = permissions.map((permission) => JSON.stringify(permission)).join(", ");
    super(
      problem === "EMPTY"
        ? "An API key must be granted at least one permission."
        : problem === "UNKNOWN_PERMISSION"
          ? `An API key cannot be granted unknown permissions: ${listed}.`
          : `An API key cannot be granted permissions its grantor does not hold: ${listed}.`,
    );
    this.name = "ApiKeyScopeError";
    this.problem = problem;
    this.permissions = permissions;
  }
}

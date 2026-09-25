/**
 * Base for every application error: each carries a stable, machine-readable
 * `code` (CLAUDE.md §8). Subclasses declare the code as a literal.
 */
export abstract class AppError extends Error {
  abstract readonly code: string;
}

/**
 * Thrown by code paths that exist but are not built yet. Always preferable to a
 * placeholder that returns fake data (CLAUDE.md §10).
 */
export class NotImplementedError extends AppError {
  readonly code = "NOT_IMPLEMENTED";
  /** What is not implemented, e.g. "worker.queue-consumption". */
  readonly feature: string;

  constructor(feature: string, detail: string) {
    super(`${feature} is not implemented: ${detail}`);
    this.name = "NotImplementedError";
    this.feature = feature;
  }
}

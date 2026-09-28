import { inspect } from "node:util";

const REDACTED = "[redacted secret]";

/**
 * A plaintext secret that does not print itself. `expose()` is the only way
 * to read it; `String()`, template literals, `JSON.stringify` and
 * `util.inspect` (so structured loggers too) all see a redaction.
 */
export class SecretValue {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  /** The plaintext. Hand it straight to the call that needs it; never log or store it. */
  expose(): string {
    return this.#value;
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [inspect.custom](): string {
    return REDACTED;
  }
}

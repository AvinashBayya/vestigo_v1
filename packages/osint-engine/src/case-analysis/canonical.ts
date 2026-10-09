/**
 * The canonical form of plain data, and its SHA-256, for the case analysis
 * input hash (owner ruling D-3: computed here, never in case-engine).
 *
 * Canonical means the same data always serialises to the same text:
 *   - object keys are sorted by code unit;
 *   - every list is sorted by its elements' canonical text, so no list's order
 *     matters (case-engine's output depends on no input order either);
 *   - a key whose value is undefined is absent, and stays distinct from a key
 *     whose value is null;
 *   - only JSON's plain data is accepted: a Date, a class instance, a function,
 *     a bigint, a symbol, an undefined list element or a non-finite number is
 *     refused, never silently serialised as something else.
 */
import { createHash } from "node:crypto";
import { AppError } from "@repo/core";

export class CanonicalFormError extends AppError {
  readonly code = "CANONICAL_FORM_INVALID";

  constructor(detail: string) {
    super(`The value has no canonical form: ${detail}.`);
    this.name = "CanonicalFormError";
  }
}

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new CanonicalFormError("a number that is not finite");
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        const elements: unknown[] = value;
        return `[${elements
          .map((element) => {
            if (element === undefined) throw new CanonicalFormError("an undefined list element");
            return canonicalJson(element);
          })
          .sort(byCodeUnit)
          .join(",")}]`;
      }
      const prototype: unknown = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new CanonicalFormError("an object that is not plain data (a Date or a class)");
      }
      const entries = Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([a], [b]) => byCodeUnit(a, b));
      return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
    }
    default:
      throw new CanonicalFormError(`a ${typeof value}`);
  }
}

/** `sha256:<64 hex>` of the text, as UTF-8. */
export function sha256Of(text: string): string {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

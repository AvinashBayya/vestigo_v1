/**
 * Instruction text. A `TrustedText` can only be written as a template literal
 * with no interpolation, so no value (a target, a collected string, a model's
 * earlier answer) can ever be spliced into instructions. The type system
 * enforces it: `trusted\`...${x}...\`` does not compile, and the function
 * refuses at runtime too.
 */
import { AppError } from "@repo/core";

declare const TRUSTED: unique symbol;
export type TrustedText = string & { readonly [TRUSTED]: true };

export class InstructionInterpolationError extends AppError {
  readonly code = "INSTRUCTION_INTERPOLATION";

  constructor() {
    super("Instructions cannot interpolate values; pass data as untrusted records instead.");
    this.name = "InstructionInterpolationError";
  }
}

export function trusted(strings: TemplateStringsArray, ...values: readonly never[]): TrustedText {
  if (values.length > 0 || strings.length !== 1) throw new InstructionInterpolationError();
  return strings.join("") as TrustedText;
}

/** Joins instruction texts; the result is still instructions only. */
export function joinTrusted(...parts: readonly TrustedText[]): TrustedText {
  return parts.join("\n\n") as TrustedText;
}

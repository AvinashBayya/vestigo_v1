/**
 * A claim's value as readable text. Moved from
 * packages/osint-engine/src/reports/assemble.ts (owner ruling D-1); the golden
 * files in packages/osint-engine/test/golden pin its output.
 *
 * Changed once since the move, as a behaviour change (R1-a rulings,
 * 2026-10-09): an undefined value is shown as JSON carries it, and a cut never
 * falls inside a character or an emoji.
 */
import type { ReportClaim } from "@repo/core";

const COMBINING_MARK = /^\p{M}$/u;
const ZERO_WIDTH_JOINER = 0x200d;

const between = (code: number, low: number, high: number): boolean => code >= low && code <= high;

/**
 * Whether a code point joins the one before it into one visible character: a
 * combining mark (accents, variation selectors, the keycap), the zero-width
 * joiner, an emoji skin tone, or a tag character.
 */
const joinsPrevious = (code: number, point: string): boolean =>
  COMBINING_MARK.test(point) ||
  code === ZERO_WIDTH_JOINER ||
  between(code, 0x1f3fb, 0x1f3ff) ||
  between(code, 0xe0020, 0xe007f);

/** A regional indicator letter: two in a row make one flag. */
const isRegionalIndicator = (code: number): boolean => between(code, 0x1f1e6, 0x1f1ff);

/**
 * The text cut to at most `max` UTF-16 code units, between whole characters:
 * never inside a surrogate pair, and never inside a sequence that shows as one
 * character (a letter and its accent, an emoji with its variation selector,
 * skin tone or keycap, a zero-width-joined emoji, a flag's two letters, a tag
 * sequence). A character too long to fit is left out whole.
 */
function cut(text: string, max: number): string {
  let kept = "";
  let character = "";
  let previous: number | null = null;
  let regionalRun = 0;
  for (const point of text) {
    const code = point.codePointAt(0);
    if (code === undefined) continue;
    const regional = isRegionalIndicator(code);
    const joins =
      previous !== null &&
      (joinsPrevious(code, point) ||
        previous === ZERO_WIDTH_JOINER ||
        (regional && regionalRun % 2 === 1));
    if (!joins) {
      if (kept.length + character.length > max) return kept;
      kept += character;
      character = "";
    }
    character += point;
    regionalRun = regional ? regionalRun + 1 : 0;
    previous = code;
  }
  return kept.length + character.length > max ? kept : kept + character;
}

/** A value as readable text: scalars as they are, flat objects as `key: value`, the rest as JSON. */
export function displayValue(value: unknown, maxChars: number): ReportClaim["display"] {
  // Undefined is not a JSON value: it is shown as JSON carries it, as null.
  const scalar = (v: unknown): string =>
    typeof v === "string"
      ? v
      : typeof v === "number" || typeof v === "boolean"
        ? String(v)
        : v === undefined
          ? "null"
          : JSON.stringify(v);
  let text: string;
  if (Array.isArray(value) && value.every((v) => typeof v !== "object" || v === null)) {
    text = value.map(scalar).join(", ");
  } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    // A null or undefined property is left out, as JSON leaves out an undefined one.
    text = Object.entries(value)
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([k, v]) => `${k}: ${scalar(v)}`)
      .join("; ");
  } else {
    text = scalar(value);
  }
  return text.length > maxChars
    ? { text: cut(text, maxChars), truncated: true }
    : { text, truncated: false };
}

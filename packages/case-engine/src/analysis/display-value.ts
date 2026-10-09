/**
 * A claim's value as readable text. Moved unchanged from
 * packages/osint-engine/src/reports/assemble.ts (owner ruling D-1); the golden
 * files in packages/osint-engine/test/golden prove the output identical.
 */
import type { ReportClaim } from "@repo/core";

/** A value as readable text: scalars as they are, flat objects as `key: value`, the rest as JSON. */
export function displayValue(value: unknown, maxChars: number): ReportClaim["display"] {
  const scalar = (v: unknown): string =>
    typeof v === "string"
      ? v
      : typeof v === "number" || typeof v === "boolean"
        ? String(v)
        : JSON.stringify(v);
  let text: string;
  if (Array.isArray(value) && value.every((v) => typeof v !== "object" || v === null)) {
    text = value.map(scalar).join(", ");
  } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    text = Object.entries(value)
      .filter(([, v]) => v !== null)
      .map(([k, v]) => `${k}: ${scalar(v)}`)
      .join("; ");
  } else {
    text = scalar(value);
  }
  return text.length > maxChars
    ? { text: text.slice(0, maxChars), truncated: true }
    : { text, truncated: false };
}

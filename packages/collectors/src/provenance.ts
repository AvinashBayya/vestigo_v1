/**
 * Where each value in a result came from: read from the source, or stated by
 * the collector.
 *
 * Every non-local collector's result has a top-level `derived` block (the
 * registry refuses a schema without one), and the rule is structural: a value
 * that is not in the source's response belongs under a `derived` key. That
 * covers values the collector computed (counts, flags, converted dates,
 * parsed-out parts) and values it stated itself (the query it sent, its
 * limits, fixed notes). The evidence row keeps its one claim strength; Phase 4
 * turns only the values outside `derived` into claims of that strength.
 *
 * The runtime checks the rule on every FOUND: each string, number and boolean
 * outside any `derived` key must appear, as a value, in one of the responses
 * the result cites. Null is absence and is never checked. The check matches
 * values, not paths, so it catches a computed value but cannot prove a read
 * value came from the right field; the collector's tests do that.
 *
 * A local analysis (LOCAL_ANALYSIS, claim strength DERIVED) is derived as a
 * whole and cites its own recorded output, so none of this applies to it.
 */
import { z } from "zod";

/** The key under which a result holds what the collector stated rather than read. */
export const DERIVED_KEY = "derived";

/** True when the schema is an object whose shape has a `derived` object. */
export function declaresDerivedBlock(schema: unknown): boolean {
  if (!(schema instanceof z.ZodObject)) return false;
  const shape = schema.shape as Record<string, unknown>;
  return shape[DERIVED_KEY] instanceof z.ZodObject;
}

/** The result with every `derived` key removed, at any depth: what the source reported. */
export function reportedPart(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reportedPart);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== DERIVED_KEY)
        .map(([key, inner]) => [key, reportedPart(inner)]),
    );
  }
  return value;
}

type Parsed = { readonly kind: "JSON"; readonly values: unknown[] } | { readonly kind: "TEXT" };

function parseJson(text: string): Parsed {
  try {
    return { kind: "JSON", values: [JSON.parse(text) as unknown] };
  } catch {
    // Not a failure: the payload is matched as text instead.
    return { kind: "TEXT" };
  }
}

/** A payload as JSON, or as newline-delimited JSON, or as text when it is neither. */
function parsePayload(text: string): Parsed {
  const whole = parseJson(text);
  if (whole.kind === "JSON") return whole;
  const lines = text.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length === 0) return whole;
  const values: unknown[] = [];
  for (const line of lines) {
    const parsed = parseJson(line);
    if (parsed.kind === "TEXT") return parsed;
    values.push(...parsed.values);
  }
  return { kind: "JSON", values };
}

/** Every string, number and boolean anywhere in the parsed values. */
function collectLeaves(value: unknown, into: Set<unknown>): void {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    into.add(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectLeaves(item, into);
  } else if (typeof value === "object" && value !== null) {
    for (const inner of Object.values(value)) collectLeaves(inner, into);
  }
}

/** Answers "does this value appear in the cited responses?" */
export function payloadIndex(payloads: readonly Uint8Array[]): (value: unknown) => boolean {
  const leaves = new Set<unknown>();
  const texts: string[] = [];
  for (const payload of payloads) {
    const text = new TextDecoder("utf-8").decode(payload);
    const parsed = parsePayload(text);
    if (parsed.kind === "JSON") {
      for (const value of parsed.values) collectLeaves(value, leaves);
    } else {
      texts.push(text);
    }
  }
  return (value) => leaves.has(value) || texts.some((text) => text.includes(String(value)));
}

/**
 * The path of the first string, number or boolean outside any `derived` key
 * that does not appear in the cited responses; null when every one does.
 * The path names fields, never values: a value can be personal data.
 */
export function unreadValuePath(
  result: unknown,
  appears: (value: unknown) => boolean,
  path = "result",
): string | null {
  if (typeof result === "string" || typeof result === "number" || typeof result === "boolean") {
    return appears(result) ? null : path;
  }
  if (Array.isArray(result)) {
    for (const [index, item] of result.entries()) {
      const found = unreadValuePath(item, appears, `${path}[${String(index)}]`);
      if (found !== null) return found;
    }
    return null;
  }
  if (typeof result === "object" && result !== null) {
    for (const [key, inner] of Object.entries(result)) {
      if (key === DERIVED_KEY) continue;
      const found = unreadValuePath(inner, appears, `${path}.${key}`);
      if (found !== null) return found;
    }
  }
  return null;
}

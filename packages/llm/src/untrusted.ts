/**
 * Everything collected from the internet is untrusted DATA (CLAUDE.md §4). It
 * reaches a model only through this module: serialised as JSON inside one
 * delimited block, never concatenated into instructions.
 *
 * The block cannot be escaped from inside. Every `<`, `>` and `&` in the data
 * is written as a JSON unicode escape, so no collected text can contain the
 * block's closing tag or any other markup; and the boundary is a hash of the
 * data itself, so a record cannot name the boundary of the block it sits in.
 *
 * This replaces the previous codebase's framing (llm.ts, reports.ts), which
 * placed collected text between triple quotes, or none at all, inside the
 * instructions: a source containing `"""` closed the quote and everything
 * after it read as instructions.
 */
import { createHash } from "node:crypto";

export interface UntrustedRecord {
  /** The reference the model cites this record by (e.g. "E3"). Assigned by the platform. */
  readonly ref: string;
  /** Who the record came from: the collector's registry label. */
  readonly source: string;
  /** The collected values. Every string in here is untrusted. */
  readonly content: unknown;
}

export interface FramedData {
  /** The block to append to the user message, after the instructions. */
  readonly text: string;
  /** The block's boundary: a hash of its data. */
  readonly boundary: string;
  /**
   * A marker placed in the system instructions and nowhere in the data. An
   * answer containing it has repeated the instructions: rejected.
   */
  readonly canary: string;
}

export const DATA_TAG = "untrusted_data";

/** JSON with every character that could start or end markup written as an escape. */
export function inertJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function frameUntrusted(records: readonly UntrustedRecord[]): FramedData {
  const json = inertJson(records.map(({ ref, source, content }) => ({ ref, source, content })));
  const digest = createHash("sha256").update(json).digest("hex");
  const boundary = digest.slice(0, 24);
  const canary = `CANARY-${digest.slice(24, 40)}`;
  return {
    text: `<${DATA_TAG} boundary="${boundary}">\n${json}\n</${DATA_TAG} boundary="${boundary}">`,
    boundary,
    canary,
  };
}

/** Every string inside a value, depth first. */
export function stringsIn(value: unknown): string[] {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === "string") out.push(node);
    else if (Array.isArray(node)) for (const item of node) walk(item);
    else if (typeof node === "object" && node !== null)
      for (const item of Object.values(node)) walk(item);
  };
  walk(value);
  return out;
}

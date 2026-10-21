/**
 * Fabrication guard, ported from the previous codebase's
 * scripts/fabrication-check.ts (INVENTORY.md verdict: KEEP).
 *
 * Changes from the original, each deliberate:
 *   - Scans every workspace (apps, packages, root tooling), not one src/ tree.
 *   - Each pattern also catches its nullish-coalescing form. The audit
 *     (REPORT.md §4.1) found string fallbacks written with the nullish operator
 *     that the original, logical-OR-only check never saw.
 *   - Scanning zero files is a failure, not a pass: a gate that checked nothing
 *     must not report clean.
 *
 * There is no allowlist and no inline escape hatch. The previous codebase's
 * gate sat at 136 matches because legitimate-looking exceptions accumulated;
 * this repository starts clean and stays clean.
 *
 * This file describes the patterns in words only, because it is scanned too.
 */
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";

export interface FabricationCheck {
  readonly name: string;
  readonly regex: RegExp;
  readonly note: string;
}

export const FABRICATION_CHECKS: readonly FabricationCheck[] = [
  {
    name: "timestamp-invention",
    regex: /(?:\|\||\?\?)\s*new Date\(\s*\)/,
    note: "stamps NOW onto an undated record — use null instead",
  },
  {
    name: "string-literal-as-measurement",
    // A fallback string starting with a capital letter reads as data. Honest
    // absence markers (an em dash, "not reported") are lowercase or punctuation.
    regex: /(?:\|\||\?\?)\s*["'`][A-Z]/,
    note: "string literal fallback renders as a measurement — use null or a lowercase absence marker",
  },
  {
    name: "numeric-zero-flattening",
    regex: /(?:\?\?|\|\|)\s*0\b/,
    note: "numeric zero flattens unreported into measured zero — use null for unmeasured values",
  },
];

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);

/**
 * Directories never scanned: third-party code, build output, caches, the
 * read-only legacy reference tree (gitignored, never shipped), and `.claude`
 * (local agent tooling — skills and transient workflow worktrees, which hold
 * copies of the source tree and are never production code). Generated code
 * that ships (the web API client) IS scanned.
 */
const EXCLUDED_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  "coverage",
  ".turbo",
  ".git",
  ".claude",
  "legacy",
]);

export interface FabricationMatch {
  readonly check: string;
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

export interface ScanResult {
  readonly filesScanned: number;
  readonly matches: readonly FabricationMatch[];
}

export function scanSource(file: string, content: string): FabricationMatch[] {
  const matches: FabricationMatch[] = [];
  content.split(/\r?\n/).forEach((text, index) => {
    for (const check of FABRICATION_CHECKS) {
      if (check.regex.test(text)) {
        matches.push({ check: check.name, file, line: index + 1, text: text.trim() });
      }
    }
  });
  return matches;
}

export function listSourceFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRECTORIES.has(entry.name)) walk(join(dir, entry.name));
      } else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) {
        files.push(join(dir, entry.name));
      }
    }
  };
  walk(root);
  return files.sort();
}

export function scanRepository(root: string): ScanResult {
  const files = listSourceFiles(root);
  const matches = files.flatMap((file) =>
    scanSource(relative(root, file).split(sep).join("/"), readFileSync(file, "utf8")),
  );
  return { filesScanned: files.length, matches };
}

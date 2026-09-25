/**
 * Export-integrity check, ported from the previous codebase's
 * scripts/check-exports.ts (INVENTORY.md verdict: KEEP). Its purpose is
 * unchanged: stop an edit from silently deleting a package's public symbol.
 *
 * The original matched `export const X` with a regex. Package entry points
 * here re-export (`export { X } from "./x.ts"`), which a regex cannot follow,
 * so this asks the TypeScript checker for each entry point's real export list,
 * types included.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

export interface ExportProblem {
  readonly entry: string;
  readonly symbol: string | null;
  readonly problem: "missing-file" | "missing-export";
}

export interface ExportCheckResult {
  readonly checked: number;
  readonly problems: readonly ExportProblem[];
}

const COMPILER_OPTIONS: ts.CompilerOptions = {
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  target: ts.ScriptTarget.ES2024,
  allowImportingTsExtensions: true,
  noEmit: true,
  skipLibCheck: true,
  types: [],
};

export function exportedNames(entryPath: string): Set<string> {
  const program = ts.createProgram([entryPath], COMPILER_OPTIONS);
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(entryPath);
  const moduleSymbol = source ? checker.getSymbolAtLocation(source) : undefined;
  if (!moduleSymbol) return new Set();
  return new Set(checker.getExportsOfModule(moduleSymbol).map((symbol) => symbol.getName()));
}

/** `required` maps an entry file (relative to `root`) to the names it must export. */
export function checkExports(
  root: string,
  required: Readonly<Record<string, readonly string[]>>,
): ExportCheckResult {
  const problems: ExportProblem[] = [];
  let checked = 0;
  for (const [entry, symbols] of Object.entries(required)) {
    const entryPath = join(root, entry);
    if (!existsSync(entryPath)) {
      problems.push({ entry, symbol: null, problem: "missing-file" });
      continue;
    }
    const names = exportedNames(entryPath);
    for (const symbol of symbols) {
      checked += 1;
      if (!names.has(symbol)) problems.push({ entry, symbol, problem: "missing-export" });
    }
  }
  return { checked, problems };
}

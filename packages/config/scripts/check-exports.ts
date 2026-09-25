/**
 * CI gate: every package entry point still exports the symbols listed below.
 * Wired into the turbo `test` task. When a package gains public API that other
 * code will depend on, add it here in the same change.
 */
import { checkExports } from "./exports.ts";
import { findRepoRoot } from "./repo-root.ts";

const REQUIRED_EXPORTS: Readonly<Record<string, readonly string[]>> = {
  "packages/config/src/index.ts": [
    "PRODUCT_NAME",
    "envSchema",
    "loadEnv",
    "Env",
    "EnvSource",
    "ConfigError",
    "ConfigIssue",
  ],
  "packages/core/src/index.ts": ["AppError", "NotImplementedError"],
};

const root = findRepoRoot(process.cwd());
const { checked, problems } = checkExports(root, REQUIRED_EXPORTS);

for (const problem of problems) {
  if (problem.problem === "missing-file") {
    console.error(`❌ Entry point not found: ${problem.entry}`);
  } else {
    console.error(`❌ MISSING EXPORT in ${problem.entry}: ${String(problem.symbol)}`);
  }
}

if (problems.length > 0) {
  console.error(`\ncheck-exports FAILED — ${String(problems.length)} problem(s).`);
  process.exit(1);
}
const files = Object.keys(REQUIRED_EXPORTS).length;
console.log(
  `check-exports passed — ${String(checked)} symbols across ${String(files)} entry points.`,
);

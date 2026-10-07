/**
 * R0: classify every exported function and class in legacy/ and write the
 * harvest list to docs/reclamation/legacy-classification.md. legacy/ is gitignored and
 * absent in CI, so this is run by hand, never by turbo:
 *
 *   node packages/config/scripts/legacy-classify.ts
 *
 * Reads source only; never imports or runs legacy code.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  BINS,
  classifyLegacyWithData,
  type Bin,
  type LegacyFile,
} from "./legacy-classification.ts";
import { findRepoRoot } from "./repo-root.ts";

const root = findRepoRoot(process.cwd());
const legacy = join(root, "legacy");
if (!existsSync(legacy)) {
  console.error(`legacy-classify: ${legacy} does not exist; nothing to classify.`);
  process.exit(1);
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : walk(path);
    return /\.(?:ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [path] : [];
  });
}

const toFile = (path: string): LegacyFile => ({
  path: relative(root, path).split(sep).join("/"),
  text: readFileSync(path, "utf8"),
});
const classified = [join(legacy, "src"), join(legacy, "scripts")].flatMap(walk).map(toFile);
const importersOnly = walk(join(legacy, "tests")).map(toFile);

const outcome = classifyLegacyWithData([...classified, ...importersOnly]);
const results = outcome.classified.filter((entry) => !entry.path.startsWith("legacy/tests/"));
const plainData = outcome.plainExports.filter((entry) => !entry.path.startsWith("legacy/tests/"));

/** How many of these are in a bin: counted, so a bin with none is a measured 0. */
const countIn = (entries: readonly { readonly bin: Bin }[], bin: Bin) =>
  entries.filter((entry) => entry.bin === bin).length;

/** Per top-level area of legacy/src, how many of each bin. */
const areaOf = (path: string) => {
  const parts = path.replace(/^legacy\//, "").split("/");
  return parts[0] === "src"
    ? parts
        .slice(0, parts[1] === "utils" ? 3 : 2)
        .join("/")
        .replace(/\.tsx?$/, "")
    : (parts[0] ?? path);
};
const areas = [...new Set(results.map((entry) => areaOf(entry.path)))]
  .sort((a, b) => a.localeCompare(b))
  .map((area) => ({ area, entries: results.filter((entry) => areaOf(entry.path) === area) }));

const cell = (text: string) => text.replaceAll("|", "\\|");
const today = new Date().toISOString().slice(0, 10);
const lines = [
  "# Legacy classification (R0)",
  "",
  "Reference data, not production code: it does not ship. Produced by",
  "`node packages/config/scripts/legacy-classify.ts` over the read-only `legacy/` tree, as R0 of the",
  "reclamation track (`docs/MASTER-BUILD-SEQUENCE.md`; method in `docs/vapt/VAPT-REFERENCES.md`",
  "part 1d). It is the harvest list R1 starts from. Nothing has been ported by this pass.",
  "",
  `Generated ${today} from ${String(classified.length)} TypeScript files in \`legacy/src\` and \`legacy/scripts\`;`,
  `${String(importersOnly.length)} files in \`legacy/tests\` were read as importers only. \`legacy/ai-service\` is Python and`,
  "outside this pass.",
  "",
  "## Bins",
  "",
  "Each exported function, class, and object holding functions (a collector definition, say) gets",
  "the first bin that applies, in this order:",
  "",
  "- **UI/DEAD**: renders JSX, uses a React hook or React, touches browser state (`localStorage`,",
  "  `sessionStorage`, `window`, `document`, `navigator`), or is imported by nothing in `legacy/`",
  "  (tests count as importers; route files and the app entry points are loaded by the framework).",
  "- **FABRICATION-FLAGGED**: this repository's fabrication gate fires inside it: the line patterns",
  "  (`scripts/fabrication.ts`) or the AST rule `no-fabricated-fallback`",
  "  (`eslint/fabrication-plugin.js`). Legacy's own disable comments are ignored: the gate here has",
  "  no escape hatch.",
  "- **IO-BOUND**: network, disk, database or queue, directly or by calling a function that is",
  "  (followed across files to a fixed point). The clock, randomness and the process environment",
  "  are binned here too: they break determinism the same way, and are ported the same way, by",
  "  injecting them.",
  "- **PURE**: none of the above. Deterministic. The harvest list.",
  "",
  "**Limits of a syntactic pass.** Calls through a parameter, an object's method or a dynamic",
  "import are not followed, so a function handed an I/O callback reads as PURE. A function that",
  "is exported but used only inside its own file reads as dead. Classes are binned as a whole.",
  'Treat PURE as "no I/O found", and confirm when porting: CLAUDE.md requires every port to pass',
  "the gate and bring its tests.",
  "",
  "## Summary",
  "",
  "| Bin | Exports |",
  "|---|---|",
  ...BINS.map((bin) => `| ${bin} | ${String(countIn(results, bin))} |`),
  `| **Total** | **${String(results.length)}** |`,
  "",
  `Not classified: ${String(plainData.length)} exported constants that hold only data (tables, defaults,`,
  "word lists, configuration). They have no behaviour to bin; R1 takes them with whatever uses them.",
  "",
  "### By area",
  "",
  `| Area | ${BINS.join(" | ")} |`,
  `|---|${BINS.map(() => "---").join("|")}|`,
  ...areas.map(
    ({ area, entries }) =>
      `| \`${area}\` | ${BINS.map((bin) => String(countIn(entries, bin))).join(" | ")} |`,
  ),
  "",
  "## Every export",
  "",
  "| Path | Export | Bin | Reason |",
  "|---|---|---|---|",
  ...results.map(
    (entry) =>
      `| \`${entry.path.replace(/^legacy\//, "")}:${String(entry.line)}\` | \`${cell(entry.name)}\`${entry.kind === "function" ? "" : ` (${entry.kind})`} | ${entry.bin} | ${cell(entry.reason)} |`,
  ),
  "",
];
writeFileSync(join(root, "docs/reclamation/legacy-classification.md"), lines.join("\n"));

console.log(`Classified ${String(results.length)} exports in ${String(classified.length)} files.`);
for (const bin of BINS) console.log(`  ${bin.padEnd(20)} ${String(countIn(results, bin))}`);
console.log("Wrote docs/reclamation/legacy-classification.md");

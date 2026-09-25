/**
 * CI gate: fails (exit 1) on any fabrication-pattern match anywhere in the
 * repository. Wired into the turbo `test` task, and ordered after code
 * generation so the generated API client is scanned too; any turbo run that
 * includes `test` fails on a match. Run on its own with:
 *
 *   pnpm turbo run fabrication-check --filter=@repo/config
 */
import { FABRICATION_CHECKS, scanRepository } from "./fabrication.ts";
import { findRepoRoot } from "./repo-root.ts";

const root = findRepoRoot(process.cwd());
const { filesScanned, matches } = scanRepository(root);

if (filesScanned === 0) {
  console.error(`fabrication-check FAILED — scanned 0 source files under ${root}.`);
  process.exit(1);
}

for (const check of FABRICATION_CHECKS) {
  const hits = matches.filter((match) => match.check === check.name);
  if (hits.length === 0) {
    console.log(`✅  [${check.name}] clean`);
    continue;
  }
  console.error(`\n❌  [${check.name}] ${String(hits.length)} match(es) — ${check.note}`);
  for (const hit of hits) console.error(`   ${hit.file}:${String(hit.line)}: ${hit.text}`);
}

console.log("");
if (matches.length > 0) {
  console.error(
    `fabrication-check FAILED — ${String(matches.length)} match(es) in ${String(filesScanned)} files.\n` +
      "Fix the listed lines. See CLAUDE.md §1 for the rationale.",
  );
  process.exit(1);
}
console.log(`fabrication-check passed — ${String(filesScanned)} files, all patterns clean.`);

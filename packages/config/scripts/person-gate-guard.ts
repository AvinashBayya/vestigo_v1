/**
 * Person-data gate guard (CLAUDE.md §9): "use the shared gate, never a local
 * copy", enforced rather than remembered.
 *
 * Whether a read may show person data is decided in one place in the apps,
 * apps/api/src/http/person-gate.ts. Whether data IS person data is answered in
 * one place, the probe in packages/db. Each decision is built from a few
 * recognisable pieces: an access decision from @repo/access, a collector
 * discipline compared with the person discipline, or the person module
 * compared by name. This scan fails on any of those pieces outside the files
 * that are their home.
 *
 * The homes (and only these):
 *   - apps/api/src/http/person-gate.ts: the shared read gate.
 *   - packages/access/src/: every access decision is made there (CLAUDE.md §6),
 *     with its tests.
 *   - packages/collectors/src/runtime.ts: collection-time admission, which
 *     decides whether a collector may be dispatched at all. A different gate
 *     from reading what was collected.
 *   - packages/db/src/repositories/exploration.ts: the person-data probe.
 *
 * A grep-style guard catches the plain forms of a copy, not every possible
 * disguise (a switch on a discipline reads like a switch on an entity kind).
 * The behaviour itself is pinned by the gate's lifecycle tests.
 *
 * This file describes the patterns in words where it can, because it is
 * scanned too.
 */
import { readFileSync } from "node:fs";
import { relative, sep } from "node:path";
import { listSourceFiles } from "./fabrication.ts";

export interface GateCopyCheck {
  readonly name: string;
  readonly regex: RegExp;
  readonly note: string;
}

const QUOTE = "[\"'`]";
const COMPARE = "(?:===|!==|==|!=|<>|=|\\s+in\\s*\\(\\s*)";

export const GATE_COPY_CHECKS: readonly GateCopyCheck[] = [
  {
    name: "person-access-decision",
    // A call of the discipline or module access decision.
    regex: new RegExp("\\bdecide(?:Discipline|Module)Access\\s*\\("),
    note: "decides module or discipline access outside the shared gate: call requirePersonAccess or personLockFor (apps/api/src/http/person-gate.ts)",
  },
  {
    name: "discipline-module-lookup",
    regex: new RegExp("\\bDISCIPLINE_MODULE\\s*\\["),
    note: "maps a discipline to its module outside @repo/access",
  },
  {
    name: "person-discipline-comparison",
    // A discipline compared with the person discipline, in code or in SQL,
    // either way round, or through a query builder's comparison.
    regex: new RegExp(
      [
        `discipline${QUOTE}?\\]?\\s*${COMPARE}\\s*${QUOTE}PERSON\\b`,
        `${QUOTE}PERSON${QUOTE}\\s*(?:===|!==|==|!=)\\s*[\\w$.?!\\[\\]"']*discipline`,
        `\\b(?:eq|ne|inArray|notInArray)\\(\\s*[\\w$.]*discipline\\s*,\\s*\\[?\\s*${QUOTE}PERSON\\b`,
      ].join("|"),
      "i",
    ),
    note: "decides whether data is person data outside the probe: use the PersonProbe (packages/db) through the shared gate",
  },
  {
    name: "person-module-comparison",
    regex: new RegExp(
      `${QUOTE}PERSON_INVESTIGATION${QUOTE}\\s*(?:===|!==|==|!=)|(?:===|!==|==|!=)\\s*${QUOTE}PERSON_INVESTIGATION${QUOTE}`,
    ),
    note: "compares the person module by name outside @repo/access",
  },
];

/** Where the pieces of the gate may appear: a file path, or a directory ending in "/". */
export const GATE_HOMES: readonly string[] = [
  "apps/api/src/http/person-gate.ts",
  "packages/access/src/",
  "packages/collectors/src/runtime.ts",
  "packages/db/src/repositories/exploration.ts",
];

const isHome = (file: string): boolean =>
  GATE_HOMES.some((home) => (home.endsWith("/") ? file.startsWith(home) : file === home));

export interface GateCopyMatch {
  readonly check: string;
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

/** The gate's pieces in one file; none for a file that is one of their homes. */
export function scanForGateCopies(file: string, content: string): GateCopyMatch[] {
  if (isHome(file)) return [];
  const matches: GateCopyMatch[] = [];
  content.split(/\r?\n/).forEach((text, index) => {
    for (const check of GATE_COPY_CHECKS) {
      if (check.regex.test(text)) {
        matches.push({ check: check.name, file, line: index + 1, text: text.trim() });
      }
    }
  });
  return matches;
}

export function scanRepositoryForGateCopies(root: string): {
  readonly filesScanned: number;
  readonly matches: readonly GateCopyMatch[];
} {
  const files = listSourceFiles(root);
  const matches = files.flatMap((file) =>
    scanForGateCopies(relative(root, file).split(sep).join("/"), readFileSync(file, "utf8")),
  );
  return { filesScanned: files.length, matches };
}

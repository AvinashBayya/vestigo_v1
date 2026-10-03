/**
 * RELEASE-BLOCKING (CLAUDE.md §9). "Use the shared person-data gate, never a
 * local copy", enforced: the repository holds no copy of the gate's pieces
 * outside their homes, and the scan is shown to catch the plain forms of one.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findRepoRoot } from "./repo-root.ts";
import {
  GATE_COPY_CHECKS,
  GATE_HOMES,
  scanForGateCopies,
  scanRepositoryForGateCopies,
} from "./person-gate-guard.ts";

// The samples are assembled at runtime, so this file does not itself contain
// the pieces it tests: the guard scans test files too.
const D = "disci" + "pline";
const P = '"' + "PERS" + 'ON"';
const SQL_P = "'" + "PERS" + "ON'";
const M = '"' + "PERSON_INV" + 'ESTIGATION"';
const EQ = "=" + "==";
const NE = "!" + "==";
const DECIDE = "decide" + "DisciplineAccess";
const DECIDE_MODULE = "decide" + "ModuleAccess";
const LOOKUP = "DISCIPLINE" + "_MODULE";

const root = findRepoRoot(process.cwd());
const tempDirs: string[] = [];

function makeRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "person-gate-guard-"));
  tempDirs.push(dir);
  writeFileSync(join(dir, "pnpm-workspace.yaml"), "packages: []\n");
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("the guard recognises a copy of the gate", () => {
  it.each([
    ["person-access-decision", `const decision = ${DECIDE}(tenant, ${P});`],
    ["person-access-decision", `if (!${DECIDE_MODULE}(tenant, module).allowed) return;`],
    ["discipline-module-lookup", `const module = ${LOOKUP}[entry.${D}];`],
    ["person-discipline-comparison", `if (registration.${D} ${EQ} ${P}) person = true;`],
    ["person-discipline-comparison", `if (${P} ${NE} row.${D}) return;`],
    ["person-discipline-comparison", `const held = rows.some((r) => r["${D}"] ${EQ} ${P});`],
    ["person-discipline-comparison", `  and (cr.collector_id is null or cr.${D} = ${SQL_P})`],
    ["person-discipline-comparison", `  where ${D} in (${SQL_P}, 'SOCMINT')`],
    ["person-discipline-comparison", `.where(eq(collectorsRegistry.${D}, ${P}))`],
    ["person-discipline-comparison", `.where(inArray(registry.${D}, [${P}]))`],
    ["person-module-comparison", `if (module ${EQ} ${M}) locked = true;`],
    ["person-module-comparison", `if (${M} ${NE} decision.module) return;`],
  ])("flags %s: %s", (check, line) => {
    expect(scanForGateCopies("apps/api/src/routes/copy.ts", line)).toEqual([
      { check, file: "apps/api/src/routes/copy.ts", line: 1, text: line.trim() },
    ]);
  });

  it.each([
    // A collector declares its discipline: that is not a decision about access.
    `  ${D}: ${P},`,
    `for (const [collectorId, ${D}] of [["fixture-person", ${P}]] as const) {`,
    // An entity kind called PERSON is not the person discipline.
    `if (entity.kind ${EQ} ${P}) continue;`,
    // The Locked response names the module; it does not compare it.
    `  module: z.literal(${M}),`,
    `    module: ${M},`,
    // Importing or listing the names decides nothing.
    `import { ${DECIDE} } from "@repo/access";`,
    `    "${DECIDE}",`,
  ])("does not flag what is not a decision: %s", (line) => {
    expect(scanForGateCopies("apps/api/src/routes/fine.ts", line)).toEqual([]);
  });

  it("allows the pieces in their homes, and only there", () => {
    const decision = `const decision = ${DECIDE}(tenant, ${P});`;
    const sqlCheck = `and (cr.collector_id is null or cr.${D} = ${SQL_P})`;
    for (const home of [
      "apps/api/src/http/person-gate.ts",
      "packages/access/src/entitlements.ts",
      "packages/access/src/permissions.test.ts",
      "packages/collectors/src/runtime.ts",
    ]) {
      expect(scanForGateCopies(home, decision), home).toEqual([]);
    }
    expect(scanForGateCopies("packages/db/src/repositories/exploration.ts", sqlCheck)).toEqual([]);
    // The same lines anywhere else are copies: a neighbouring file, another
    // app, a test, the frontend.
    for (const elsewhere of [
      "apps/api/src/http/access.ts",
      "apps/api/src/routes/reports.ts",
      "apps/api/test/person-gate.test.ts",
      "apps/worker/src/worker.ts",
      "apps/web/src/routes/run.tsx",
      "packages/osint-engine/src/reports/assemble.ts",
      "packages/db/src/repositories/evidence.ts",
    ]) {
      expect(scanForGateCopies(elsewhere, decision), elsewhere).toHaveLength(1);
      expect(scanForGateCopies(elsewhere, sqlCheck), elsewhere).toHaveLength(1);
    }
  });

  it("scans every workspace, as the fabrication check does, and skips build output", () => {
    const copy = `export const locked = (row) => row.${D} ${EQ} ${P};\n`;
    const dir = makeRepo({
      "apps/api/src/http/person-gate.ts": `export const gate = () => ${DECIDE}(t, ${P});\n`,
      "apps/web/src/screens/run.tsx": copy,
      "packages/osint-engine/src/copy.ts": copy,
      "node_modules/dep/index.js": copy,
      "packages/core/dist/index.js": copy,
      "legacy/src/old.ts": copy,
    });
    const result = scanRepositoryForGateCopies(dir);
    expect(result.filesScanned).toBe(3);
    expect(result.matches.map((match) => match.file).sort()).toEqual([
      "apps/web/src/screens/run.tsx",
      "packages/osint-engine/src/copy.ts",
    ]);
  });
});

describe("the repository holds no copy of the person-data gate (RELEASE-BLOCKING)", () => {
  it("finds the gate's pieces only in their homes", () => {
    const { filesScanned, matches } = scanRepositoryForGateCopies(root);
    // A scan of nothing would pass vacuously.
    expect(filesScanned).toBeGreaterThan(100);
    expect(
      matches.map((match) => `${match.file}:${String(match.line)} [${match.check}] ${match.text}`),
    ).toEqual([]);
  });

  it("every home exists, so a moved file cannot quietly widen the allowance", () => {
    for (const home of GATE_HOMES) expect(existsSync(join(root, home)), home).toBe(true);
  });

  it("the shared gate is where the guard says it is, and decides with @repo/access", () => {
    const gate = readFileSync(join(root, "apps/api/src/http/person-gate.ts"), "utf8");
    expect(gate).toContain("export async function requirePersonAccess(");
    expect(gate).toContain("export async function personLockFor(");
    expect(
      GATE_COPY_CHECKS.find((check) => check.name === "person-access-decision")?.regex.test(gate),
    ).toBe(true);
  });

  it("the person-data probe is where the guard says it is", () => {
    const probe = readFileSync(join(root, "packages/db/src/repositories/exploration.ts"), "utf8");
    expect(probe).toContain("async touchesPersonData(");
  });
});

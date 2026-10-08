/**
 * RELEASE-BLOCKING (CLAUDE.md §9). "Use the shared person-data gate, never a
 * local copy", enforced: the repository holds no copy of the gate's pieces
 * outside their homes, and the scan is shown to catch the plain forms of one.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findRepoRoot } from "./repo-root.ts";
import {
  bracketedCode,
  GATE_COPY_CHECKS,
  GATE_HOMES,
  ROUTE_FILES_UNSCANNED,
  ROUTE_GATING,
  routeBlocks,
  routeGatingProblems,
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

describe("every route meets the shared gate or says why not (RELEASE-BLOCKING)", () => {
  it("each route is classified, and each gated route's handler calls the shared gate", () => {
    // REGRESSION (D-10): the three entity-merge routes read and changed person data with no gate.
    const problems = Object.entries(ROUTE_GATING).flatMap(([file, classified]) =>
      routeGatingProblems(file, readFileSync(join(root, file), "utf8"), classified),
    );
    expect(problems).toEqual([]);
  });

  it("every route file is scanned or says why not, so a new route file cannot skip the scan", () => {
    const files = readdirSync(join(root, "apps/api/src/routes"))
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
      .map((name) => `apps/api/src/routes/${name}`)
      .sort();
    const known = [...Object.keys(ROUTE_GATING), ...Object.keys(ROUTE_FILES_UNSCANNED)].sort();
    expect(known).toEqual(files);
  });

  it("the merge routes are among the gated routes", () => {
    const entities = ROUTE_GATING["apps/api/src/routes/entities.ts"] ?? {};
    for (const route of [
      "GET /api/v1/entity-merges",
      "POST /api/v1/entity-merges",
      "POST /api/v1/entity-merges/:id/undo",
    ]) {
      expect(entities[route], route).toBe("shared-gate");
    }
  });

  it("catches an unclassified route, a missing route and a gated route without the gate", () => {
    const source = [
      'app.get("/api/v1/a", {}, async () => { await requirePersonAccess(c, {}, "x"); });',
      'app.post("/api/v1/b", {}, async () => ({ leaked: true }));',
      'app.delete("/api/v1/c", {}, async () => null);',
    ].join("\n");
    expect([...routeBlocks(source).keys()]).toEqual([
      "GET /api/v1/a",
      "POST /api/v1/b",
      "DELETE /api/v1/c",
    ]);
    expect(
      routeGatingProblems("f.ts", source, {
        "GET /api/v1/a": "shared-gate",
        "POST /api/v1/b": "shared-gate",
        "PUT /api/v1/d": { why: "[gone]" },
      }),
    ).toEqual([
      "f.ts: DELETE /api/v1/c is not classified",
      "f.ts: POST /api/v1/b does not call the shared gate",
      "f.ts: PUT /api/v1/d is classified but not registered",
    ]);
  });

  it("is not satisfied by the gate's name in a comment, in a helper, or by an unused result", () => {
    // REGRESSION (D-10 review): the check matched the gate's name anywhere up to the next route.
    const gated = { "GET /api/v1/a": "shared-gate" } as const;
    const comment =
      'app.get("/api/v1/a", {}, async () => {\n  // await requirePersonAccess(c, {}, "x");\n  return 1;\n});';
    const helperAfter = [
      'app.get("/api/v1/a", {}, async () => 1);',
      'async function later() { await requirePersonAccess(c, {}, "x"); }',
    ].join("\n");
    const unused = 'app.get("/api/v1/a", {}, async () => { void personLockFor(t, r, {}, "x"); });';
    for (const source of [comment, helperAfter, unused]) {
      expect(routeGatingProblems("f.ts", source, gated)).toEqual([
        "f.ts: GET /api/v1/a does not call the shared gate",
      ]);
    }
    const lock =
      'app.get("/api/v1/a", {}, async () => { const l = await personLockFor(t, r, {}, "x"); });';
    expect(routeGatingProblems("f.ts", lock, gated)).toEqual([]);
  });

  it("reads past brackets in strings, templates and regular expressions, and flags a path it cannot read", () => {
    const tricky = [
      'app.get("/api/v1/a", { schema: z.string().regex(/^[a-z(]{1,2}$/) }, async () => {',
      '  const s = ")"; const t = `}${"("}`;',
      '  await requirePersonAccess(c, {}, "x");',
      "});",
      'app.get("/api/v1/b", {}, async () => 1);',
    ].join("\n");
    expect(
      routeGatingProblems("f.ts", tricky, {
        "GET /api/v1/a": "shared-gate",
        "GET /api/v1/b": { why: "[none]" },
      }),
    ).toEqual([]);
    expect(routeGatingProblems("f.ts", "app.get(PATH, {}, async () => 1);", {})).toEqual([
      "f.ts: a route is registered without a literal path, so it cannot be classified",
    ]);
    expect(bracketedCode("a(b", 0, ")")).toBeNull();
  });
});

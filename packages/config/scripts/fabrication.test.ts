import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanRepository, scanSource } from "./fabrication.ts";

// The operators are assembled at runtime so this file does not itself contain
// the patterns it tests; the gate scans test files too.
const OR = "|" + "|";
const NULLISH = "?" + "?";

const cli = join(import.meta.dirname, "fabrication-check.ts");
const tempDirs: string[] = [];

function makeRepo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "fabrication-check-"));
  tempDirs.push(root);
  writeFileSync(join(root, "pnpm-workspace.yaml"), "packages: []\n");
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

function runCli(cwd: string) {
  return spawnSync(process.execPath, [cli], { cwd, encoding: "utf8" });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("scanSource", () => {
  it.each([
    ["timestamp-invention", `const at = row.date ${OR} new Date();`],
    ["timestamp-invention", `const at = row.date ${NULLISH} new Date();`],
    ["string-literal-as-measurement", `const make = row.make ${OR} "Motor Vehicle";`],
    ["string-literal-as-measurement", `const title = p.title ${NULLISH} "Seismic event";`],
    ["string-literal-as-measurement", `const src = s ${NULLISH} 'GDELT';`],
    ["numeric-zero-flattening", `const likes = post.likes ${OR} 0;`],
    ["numeric-zero-flattening", `const count = input.hypotheses ${NULLISH} 0;`],
  ])("flags %s: %s", (check, line) => {
    expect(scanSource("fixture.ts", line)).toEqual([
      { check, file: "fixture.ts", line: 1, text: line },
    ]);
  });

  it.each([
    `const at = row.date ${NULLISH} null;`,
    `const label = row.label ${NULLISH} "—";`,
    `const label = row.label ${OR} "not reported";`,
    `const total = values.reduce((sum, v) => sum + v, 0);`,
    `const big = row.size ${NULLISH} 0n;`,
  ])("does not flag honest code: %s", (line) => {
    expect(scanSource("fixture.ts", line)).toEqual([]);
  });

  it("reports the 1-based line number of each match", () => {
    const content = ["const ok = 1;", "", `const n = x ${OR} 0;`].join("\n");
    expect(scanSource("f.ts", content).map((m) => m.line)).toEqual([3]);
  });
});

describe("scanRepository", () => {
  it("scans apps and packages but skips node_modules, dist, legacy and .claude", () => {
    const bad = `export const n = x ${OR} 0;\n`;
    const root = makeRepo({
      "apps/api/src/ok.ts": "export const ok = 1;\n",
      "packages/core/src/bad.tsx": bad,
      "node_modules/dep/index.js": bad,
      "packages/core/dist/index.js": bad,
      "legacy/src/old.ts": bad,
      // Local agent tooling and transient workflow worktrees hold copies of the
      // source tree; they are never production code and are not scanned.
      ".claude/worktrees/wf/packages/core/src/copy.ts": bad,
    });
    const result = scanRepository(root);
    expect(result.filesScanned).toBe(2);
    expect(result.matches.map((m) => m.file)).toEqual(["packages/core/src/bad.tsx"]);
  });
});

describe("fabrication-check CLI", () => {
  it("exits 0 on a clean repository", () => {
    const root = makeRepo({ "packages/a/src/index.ts": "export const a = 1;\n" });
    const run = runCli(root);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("fabrication-check passed");
  });

  it("exits 1 and prints the location on any match", () => {
    const root = makeRepo({
      "packages/a/src/index.ts": `export const at = (d?: Date) => d ${OR} new Date();\n`,
    });
    const run = runCli(root);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("packages/a/src/index.ts:1");
    expect(run.stderr).toContain("fabrication-check FAILED");
  });

  it("exits 1 when there is nothing to scan, rather than reporting clean", () => {
    const root = makeRepo({ "README.md": "no source here\n" });
    const run = runCli(root);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("scanned 0 source files");
  });
});

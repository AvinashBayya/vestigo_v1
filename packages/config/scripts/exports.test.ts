import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkExports } from "./exports.ts";

let root = "";

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "check-exports-"));
  mkdirSync(join(root, "pkg", "src"), { recursive: true });
  writeFileSync(
    join(root, "pkg", "src", "impl.ts"),
    "export const direct = 1;\nexport interface Shape { a: number }\nexport class Thing {}\n",
  );
  writeFileSync(
    join(root, "pkg", "src", "index.ts"),
    'export { direct, type Shape } from "./impl.ts";\nexport * from "./more.ts";\n',
  );
  writeFileSync(join(root, "pkg", "src", "more.ts"), "export function viaStar(): void {}\n");
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("checkExports", () => {
  it("follows named and star re-exports, including types", () => {
    const result = checkExports(root, { "pkg/src/index.ts": ["direct", "Shape", "viaStar"] });
    expect(result).toEqual({ checked: 3, problems: [] });
  });

  it("reports a symbol the entry point no longer exports", () => {
    const result = checkExports(root, { "pkg/src/index.ts": ["direct", "Thing"] });
    expect(result.problems).toEqual([
      { entry: "pkg/src/index.ts", symbol: "Thing", problem: "missing-export" },
    ]);
  });

  it("reports a missing entry file instead of skipping it", () => {
    const result = checkExports(root, { "gone/src/index.ts": ["anything"] });
    expect(result.problems).toEqual([
      { entry: "gone/src/index.ts", symbol: null, problem: "missing-file" },
    ]);
  });
});

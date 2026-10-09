/**
 * RELEASE-BLOCKING. Case analysis is pure (CLAUDE.md §6): its source imports
 * only @repo/core and its own files, and never reads the clock, draws
 * randomness, reaches the process, the network or the file system, schedules
 * work, or formats by locale. The lint rules in eslint.config.js stop the same
 * things as they are written; this reads the source itself, so the boundary
 * has two independent layers.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const PACKAGE = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(PACKAGE, "src");

/** Globals whose use makes an output depend on when, where or how often it ran. */
const IMPURE_GLOBALS = new Set([
  "Bun",
  "Date",
  "process",
  "fetch",
  "setTimeout",
  "setInterval",
  "setImmediate",
  "clearTimeout",
  "clearInterval",
  "clearImmediate",
  "queueMicrotask",
  "performance",
  "crypto",
  "globalThis",
  "XMLHttpRequest",
  "WebSocket",
  "require",
  "Intl",
  "eval",
  "Function",
  "global",
  "navigator",
  "console",
  "Buffer",
  "WeakRef",
  "FinalizationRegistry",
  "AbortSignal",
  "Reflect",
]);
/** Methods whose result depends on the machine's locale. */
const LOCALE_METHODS = new Set([
  "localeCompare",
  "toLocaleString",
  "toLocaleLowerCase",
  "toLocaleUpperCase",
]);

interface Impurity {
  readonly file: string;
  readonly line: number;
  readonly what: string;
}

/** Whether an identifier names a global, rather than a property or a member's name. */
function isReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isQualifiedName(parent) && parent.right === node) return false;
  if (
    (ts.isPropertyAssignment(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isMethodSignature(parent) ||
      ts.isEnumMember(parent)) &&
    parent.name === node
  ) {
    return false;
  }
  return true;
}

/** Every impurity in one file. `file` is the path the file would have under the package. */
function impuritiesIn(file: string, content: string): Impurity[] {
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
  const found: Impurity[] = [];
  const report = (node: ts.Node, what: string): void => {
    found.push({
      file: relative(PACKAGE, file).split(sep).join("/"),
      line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      what,
    });
  };
  const checkSpecifier = (node: ts.Node, specifier: string): void => {
    if (specifier === "@repo/core") return;
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      const target = resolve(dirname(file), specifier);
      if (target === SRC || target.startsWith(SRC + sep)) return;
      report(node, `imports ${specifier}, outside this package's source`);
      return;
    }
    report(node, `imports ${specifier}`);
  };
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      checkSpecifier(node, node.moduleSpecifier.text);
    } else if (ts.isImportEqualsDeclaration(node)) {
      report(node, "uses import = require()");
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      report(node, "uses a dynamic import");
    } else if (ts.isMetaProperty(node)) {
      report(node, "uses import.meta");
    } else if (ts.isImportTypeNode(node)) {
      const argument = node.argument;
      if (ts.isLiteralTypeNode(argument) && ts.isStringLiteral(argument.literal)) {
        checkSpecifier(node, argument.literal.text);
      }
    } else if (ts.isIdentifier(node) && IMPURE_GLOBALS.has(node.text) && isReference(node)) {
      report(node, `uses ${node.text}`);
    } else if (
      ts.isIdentifier(node) &&
      node.text === "Math" &&
      isReference(node) &&
      !(ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node) &&
      !(ts.isElementAccessExpression(node.parent) && node.parent.expression === node)
    ) {
      // Math only as the object of a member access: passed on, its random is reachable.
      report(node, "passes Math on");
    } else if (ts.isPropertyAccessExpression(node)) {
      const name = node.name.text;
      if (LOCALE_METHODS.has(name)) report(node, `uses ${name}`);
      if (name === "random") {
        report(
          node,
          ts.isIdentifier(node.expression) && node.expression.text === "Math"
            ? "uses Math.random"
            : "uses random",
        );
      }
    } else if (ts.isElementAccessExpression(node)) {
      const key = node.argumentExpression;
      if (ts.isIdentifier(node.expression) && node.expression.text === "Math") {
        report(node, "uses a computed Math member");
      } else if (ts.isStringLiteral(key) && LOCALE_METHODS.has(key.text)) {
        report(node, `uses ${key.text}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

describe("case-engine purity (RELEASE-BLOCKING)", () => {
  it("its source imports only @repo/core and its own files, and touches nothing impure", () => {
    const files = sourceFiles(SRC);
    // A scan of nothing must not pass.
    expect(files.length).toBeGreaterThan(0);
    const impurities = files.flatMap((file) => impuritiesIn(file, readFileSync(file, "utf8")));
    expect(impurities).toEqual([]);
  });

  it("depends at runtime on @repo/core and nothing else", () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGE, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
    expect(manifest.dependencies).toEqual({ "@repo/core": "workspace:*" });
    expect(manifest.peerDependencies).toBeUndefined();
    expect(manifest.optionalDependencies).toBeUndefined();
  });

  it("the scan finds each impurity it looks for, and nothing in pure code", () => {
    const file = join(SRC, "analysis", "sample.ts");
    const impure = [
      `import { readFileSync } from "node:fs";`,
      `import type { Job } from "@repo/db";`,
      `export * from "../../test/fixtures.ts";`,
      `import x = require("node:net");`,
      `const now = Date.now();`,
      `const when: Date | null = null;`,
      `const r = Math.random();`,
      `const r2 = Math["random"]();`,
      `const k = "random" as const; const r3 = Math[k]();`,
      `const env = process.env;`,
      `void fetch("https://example.com");`,
      `setTimeout(() => undefined, 1);`,
      `const sorted = ["b", "a"].sort((a, b) => a.localeCompare(b));`,
      `const label = (1).toLocaleString();`,
      `const g = globalThis;`,
      `const m = await import("./other.ts");`,
      `type T = import("@repo/collectors").Collector;`,
      `const f = new Intl.Collator();`,
      `const home = global.process.env.HOME;`,
      `const where = import.meta.url;`,
      `console.log("[test]");`,
      `const lang = navigator.language;`,
      `const ref = new WeakRef({});`,
      `const signal = AbortSignal.timeout(1);`,
      `const raw = Buffer.allocUnsafe(1);`,
      `const got = Reflect.get(Math, "random");`,
      `const upper = "x"["toLocaleUpperCase"]();`,
      `const M = Math; const r4 = M.random();`,
      `const r5 = (0, Math).max(1);`,
    ].join("\n");
    expect(impuritiesIn(file, impure).map((found) => found.what)).toEqual([
      "imports node:fs",
      "imports @repo/db",
      "imports ../../test/fixtures.ts, outside this package's source",
      "uses import = require()",
      "uses Date",
      "uses Date",
      "uses Math.random",
      "uses a computed Math member",
      "uses a computed Math member",
      "uses process",
      "uses fetch",
      "uses setTimeout",
      "uses localeCompare",
      "uses toLocaleString",
      "uses globalThis",
      "uses a dynamic import",
      "imports @repo/collectors",
      "uses Intl",
      "uses global",
      "uses import.meta",
      "uses console",
      "uses navigator",
      "uses WeakRef",
      "uses AbortSignal",
      "uses Buffer",
      "uses Reflect",
      "passes Math on",
      "uses toLocaleUpperCase",
      "passes Math on",
      "uses random",
      "passes Math on",
    ]);

    const pure = [
      `import type { RunStatus } from "@repo/core";`,
      `import { runCoverage } from "./run-coverage.ts";`,
      `const record = { Date: 1, process: "named", random: 2 };`,
      `interface Row { readonly Date: string }`,
      `const text = "Date.now() and Math.random() in a string";`,
      `// Date.now() in a comment`,
      `const max = Math.max(record.Date, record.process.length);`,
      `const sorted = ["b", "a"].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));`,
    ].join("\n");
    expect(impuritiesIn(file, pure)).toEqual([]);
  });
});

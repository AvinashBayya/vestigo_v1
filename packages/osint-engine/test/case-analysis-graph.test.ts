/**
 * RELEASE-BLOCKING. The case analysis job is passive (standing rule 9): every
 * module it can load reads stored records and computes; none can reach a
 * network client. This walks the value imports of the job's source, into every
 * workspace package it imports, and fails on:
 *   - any module from outside the repo that is not on the job's allowlist
 *     (today zod and node:crypto): a new third-party or node module, whatever
 *     it is, fails until someone decides it may be reached, so a network client
 *     cannot arrive unnoticed, directly or through anything it imports;
 *   - a workspace package that holds a client (db, collectors, integrations,
 *     llm);
 *   - a network global (fetch, XMLHttpRequest, WebSocket, EventSource);
 *   - a module load it cannot follow: a dynamic import, require, import =,
 *     process.getBuiltinModule, process.binding, dlopen, eval or new Function.
 * The database reaches the job as an argument, and the registry as plain data;
 * the queue that delivers the job (jobs/queues.ts) is not the job. A self-test
 * proves the walk refuses a client, a module off the allowlist, and each load
 * it cannot follow.
 */
import { existsSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const REPO = fileURLToPath(new URL("../../..", import.meta.url));
const ENGINE_SRC = join(REPO, "packages", "osint-engine", "src");

/**
 * The modules from outside the repo the job may reach, by name: nothing else.
 * Adding one is a decision that it opens no connection, made here, in review.
 */
const ALLOWED_OUTSIDE_REPO = new Set(["zod", "node:crypto"]);
/** Workspace packages that hold a database, collector, queue or model client. */
const CLIENT_PACKAGES = new Set([
  "@repo/db",
  "@repo/collectors",
  "@repo/integrations",
  "@repo/llm",
]);
const NETWORK_GLOBALS = new Set(["fetch", "XMLHttpRequest", "WebSocket", "EventSource"]);
/** Names that load a module, or run code, without an import the walk can follow. */
const LOADERS = new Set([
  "require",
  "getBuiltinModule",
  "binding",
  "_linkedBinding",
  "dlopen",
  "eval",
  "Function",
]);

interface Reach {
  /** Each module reached, by repo-relative path or package name. */
  readonly modules: readonly string[];
  readonly findings: readonly string[];
}

const show = (file: string): string => relative(REPO, file).split(sep).join("/");

/** A workspace package's source entry, or null for a package outside the repo. */
function workspaceEntry(specifier: string): string | null {
  if (!specifier.startsWith("@repo/")) return null;
  const entry = join(REPO, "packages", specifier.slice("@repo/".length), "src", "index.ts");
  return existsSync(entry) ? entry : null;
}

/** The value imports of one file: an `import type` or `export type` loads nothing. */
function importsOf(
  file: string,
  findings: string[],
  content: string = readFileSync(file, "utf8"),
): string[] {
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.importClause?.phaseModifier !== ts.SyntaxKind.TypeKeyword
    ) {
      // `import { type A } from` still loads the module: followed, to be safe.
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isExportDeclaration(node) &&
      !node.isTypeOnly &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      findings.push(`${show(file)}: a dynamic import, which cannot be followed`);
    } else if (ts.isImportEqualsDeclaration(node)) {
      findings.push(`${show(file)}: import = require(), which cannot be followed`);
    } else if (ts.isIdentifier(node) && NETWORK_GLOBALS.has(node.text)) {
      findings.push(`${show(file)}: names ${node.text}`);
    } else if (ts.isIdentifier(node) && LOADERS.has(node.text)) {
      // A loader named anywhere, as a call, a property or a value passed on.
      findings.push(`${show(file)}: names ${node.text}, a load it cannot follow`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return specifiers;
}

/** Every module reachable through value imports from `start`. */
function reach(start: string): Reach {
  const modules = new Set<string>();
  const findings: string[] = [];
  const seen = new Set<string>();
  const pending = [start];
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (seen.has(file)) continue;
    seen.add(file);
    modules.add(show(file));
    for (const specifier of importsOf(file, findings)) {
      if (specifier.startsWith("./") || specifier.startsWith("../")) {
        pending.push(resolve(dirname(file), specifier));
        continue;
      }
      if (specifier.startsWith("@repo/")) {
        const name = specifier.split("/").slice(0, 2).join("/");
        if (CLIENT_PACKAGES.has(name)) {
          findings.push(`${show(file)}: imports ${specifier}, which holds a client`);
          modules.add(specifier);
          continue;
        }
        const entry = workspaceEntry(specifier);
        if (entry === null) {
          findings.push(`${show(file)}: imports ${specifier}, whose source was not found`);
          continue;
        }
        pending.push(entry);
        continue;
      }
      // Outside the repo: node's own modules by their node: name, so "crypto"
      // and "node:crypto" are one module.
      const bare = specifier.startsWith("node:") ? specifier.slice("node:".length) : specifier;
      const name = builtinModules.includes(bare) ? `node:${bare}` : specifier;
      modules.add(name);
      if (!ALLOWED_OUTSIDE_REPO.has(name)) {
        findings.push(`${show(file)}: imports ${specifier}, which is not on the job's allowlist`);
      }
    }
  }
  return { modules: [...modules].sort(), findings: findings.sort() };
}

describe("the case analysis job's module graph (RELEASE-BLOCKING)", () => {
  it("reaches no network client", () => {
    const graph = reach(join(ENGINE_SRC, "jobs", "case-analysis.ts"));
    expect(graph.findings).toEqual([]);
    // The walk went where the job goes: the gate, the engine and the input read.
    expect(graph.modules).toEqual(
      expect.arrayContaining([
        "packages/access/src/index.ts",
        "packages/case-engine/src/index.ts",
        "packages/core/src/index.ts",
        "packages/osint-engine/src/case-analysis/input.ts",
      ]),
    );
  });

  it("reaches outside the repo only what the allowlist names", () => {
    const graph = reach(join(ENGINE_SRC, "jobs", "case-analysis.ts"));
    const outside = graph.modules.filter((name) => !name.startsWith("packages/"));
    expect(outside.every((name) => ALLOWED_OUTSIDE_REPO.has(name))).toBe(true);
  });

  it("refuses every module load it cannot follow (self-test)", () => {
    const loads = [
      `const https = process.getBuiltinModule("node:https");`,
      `const net = process.binding("tcp_wrap");`,
      `const native = process.dlopen(module, "[addon]");`,
      `const run = eval("[code]");`,
      `const make = new Function("[code]");`,
      `const fs = require("node:fs");`,
    ];
    for (const line of loads) {
      const findings: string[] = [];
      importsOf(join(ENGINE_SRC, "[synthetic].ts"), findings, line);
      expect(findings, line).toEqual([expect.stringContaining("a load it cannot follow")]);
    }
  });

  it("refuses a client, and any module off the allowlist (self-test)", () => {
    const queues = reach(join(ENGINE_SRC, "jobs", "queues.ts"));
    expect(queues.findings).toEqual(
      expect.arrayContaining([expect.stringContaining("imports bullmq, which is not on")]),
    );
    const engine = reach(join(ENGINE_SRC, "index.ts"));
    expect(engine.findings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("imports @repo/llm, which holds a client"),
        expect.stringContaining("imports @repo/collectors, which holds a client"),
      ]),
    );
    // A node module that is no network client is refused too, until allowed:
    // the test file itself reaches node:fs and typescript.
    const self = reach(fileURLToPath(import.meta.url));
    expect(self.findings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("imports node:fs, which is not on"),
        expect.stringContaining("imports typescript, which is not on"),
      ]),
    );
  });
});

/**
 * RELEASE-BLOCKING. The case analysis job is passive (standing rule 9): every
 * module it can load reads stored records and computes; none can reach a
 * network client. This walks the value imports of the job's source, into the
 * workspace packages it imports, and fails on:
 *   - a module that opens connections: node's network modules, a database,
 *     queue or HTTP client, or a workspace package that holds one (db,
 *     collectors, integrations, llm);
 *   - a network global (fetch, XMLHttpRequest, WebSocket, EventSource);
 *   - an import it cannot follow (a dynamic import or require).
 * The database reaches the job as an argument, and the registry as plain data;
 * the queue that delivers the job (jobs/queues.ts) is not the job. A self-test
 * proves the walk finds a network client where there is one.
 */
import { existsSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const REPO = fileURLToPath(new URL("../../..", import.meta.url));
const ENGINE_SRC = join(REPO, "packages", "osint-engine", "src");

const NETWORK_MODULES = new Set([
  "http",
  "https",
  "http2",
  "net",
  "tls",
  "dns",
  "dgram",
  "undici",
  "ioredis",
  "redis",
  "bullmq",
  "pg",
  "pg-pool",
  "postgres",
  "drizzle-orm",
  "ws",
  "axios",
  "got",
  "node-fetch",
  "@repo/db",
  "@repo/collectors",
  "@repo/integrations",
  "@repo/llm",
]);
const NETWORK_GLOBALS = new Set(["fetch", "XMLHttpRequest", "WebSocket", "EventSource"]);

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
function importsOf(file: string, findings: string[]): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
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
    } else if (ts.isIdentifier(node) && node.text === "require") {
      findings.push(`${show(file)}: names require`);
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
      const bare = specifier.startsWith("node:") ? specifier.slice("node:".length) : specifier;
      if (NETWORK_MODULES.has(bare) || NETWORK_MODULES.has(bare.split("/")[0] ?? bare)) {
        findings.push(`${show(file)}: imports ${specifier}`);
        modules.add(specifier);
        continue;
      }
      if (specifier.startsWith("./") || specifier.startsWith("../")) {
        pending.push(resolve(dirname(file), specifier));
        continue;
      }
      const entry = workspaceEntry(specifier);
      if (entry !== null) {
        pending.push(entry);
        continue;
      }
      // A package outside the repo, or one of node's own: a leaf.
      if (specifier.startsWith("@repo/")) {
        findings.push(`${show(file)}: imports ${specifier}, whose source was not found`);
      }
      modules.add(builtinModules.includes(bare) ? `node:${bare}` : specifier);
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

  it("finds a network client where there is one (self-test)", () => {
    const queues = reach(join(ENGINE_SRC, "jobs", "queues.ts"));
    expect(queues.findings).toEqual(
      expect.arrayContaining([expect.stringContaining("imports bullmq")]),
    );
    const engine = reach(join(ENGINE_SRC, "index.ts"));
    expect(engine.findings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("imports @repo/llm"),
        expect.stringContaining("imports @repo/collectors"),
      ]),
    );
  });
});

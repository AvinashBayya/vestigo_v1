/**
 * RELEASE-BLOCKING. Dependency rules between workspace packages, read from
 * each package.json. Lint rules stop the imports; this stops the dependency
 * itself, so the boundary has two independent layers.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { findRepoRoot } from "./repo-root.ts";

const root = findRepoRoot(process.cwd());

function runtimeDependencies(packageDir: string): string[] {
  const manifest = JSON.parse(readFileSync(join(root, packageDir, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
  };
  return Object.keys(manifest.dependencies ?? {}).sort();
}

describe("package boundaries (RELEASE-BLOCKING)", () => {
  it("packages/core depends on nothing else in the repo (CLAUDE.md §6)", () => {
    expect(
      runtimeDependencies("packages/core").filter((name) => name.startsWith("@repo/")),
    ).toEqual([]);
  });

  it("packages/access depends only on packages/core (CLAUDE.md §6)", () => {
    expect(
      runtimeDependencies("packages/access").filter((name) => name.startsWith("@repo/")),
    ).toEqual(["@repo/core"]);
  });

  it("packages/case-engine never depends on packages/collectors or packages/osint-engine (CLAUDE.md §6)", () => {
    // Case analysis reads stored evidence only; a package that cannot import
    // the collector runtime cannot cause collection.
    const dependencies = runtimeDependencies("packages/case-engine");
    for (const forbidden of ["@repo/collectors", "@repo/osint-engine"]) {
      expect(dependencies).not.toContain(forbidden);
    }
  });

  it("packages/case-engine depends only on packages/core, and on no other package at all (CLAUDE.md §6)", () => {
    // Not only no other workspace package: no third-party package either.
    // Case analysis is pure; its job processor lives outside it (owner ruling,
    // 2026-10-09), so the database and models never reach it.
    expect(runtimeDependencies("packages/case-engine")).toEqual(["@repo/core"]);
  });

  it("packages/collectors has no database, Redis or integrations dependency: a collector is a pure function", () => {
    const dependencies = runtimeDependencies("packages/collectors");
    for (const forbidden of [
      "@repo/db",
      "@repo/integrations",
      "@repo/osint-engine",
      "pg",
      "drizzle-orm",
      "ioredis",
    ]) {
      expect(dependencies).not.toContain(forbidden);
    }
  });
});

/** Every runtime source file of a package: no tests, no build output. */
function runtimeSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory())
      return name === "node_modules" || name === "dist" ? [] : runtimeSources(path);
    return /\.tsx?$/.test(name) && !/\.(test|d)\.tsx?$/.test(name) ? [path] : [];
  });
}

/** The packages a file loads at runtime: value imports and re-exports, never `import type`. */
function runtimeImports(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const names: string[] = [];
  const visit = (node: ts.Node): void => {
    let specifier: string | null = null;
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.importClause?.phaseModifier !== ts.SyntaxKind.TypeKeyword
    ) {
      specifier = node.moduleSpecifier.text;
    } else if (
      ts.isExportDeclaration(node) &&
      !node.isTypeOnly &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifier = node.moduleSpecifier.text;
    }
    if (specifier !== null && !specifier.startsWith(".") && !specifier.startsWith("node:")) {
      const parts = specifier.split("/");
      names.push(specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

describe("a deployed app installs what it runs (RELEASE-BLOCKING)", () => {
  // A production install skips devDependencies: a package the app loads at
  // runtime but lists only there is missing when the app starts.
  for (const app of ["apps/api", "apps/worker"]) {
    it(`${app}: every package its source loads at runtime is a runtime dependency`, () => {
      const declared = new Set(runtimeDependencies(app));
      const missing = new Set<string>();
      for (const file of runtimeSources(join(root, app, "src"))) {
        for (const name of runtimeImports(file)) {
          if (!declared.has(name)) missing.add(name);
        }
      }
      expect([...missing].sort()).toEqual([]);
    });
  }
});

describe("no product path can replay an UNVERIFIED source (RELEASE-BLOCKING; access methods)", () => {
  // The fixture harness (@repo/collectors/testing) alone holds the grant that
  // lets a runtime replay recorded answers for an UNVERIFIED source, on its own
  // loopback fixture server. Nothing a deployment runs may load it, so no
  // runtime the API or a worker builds can run an UNVERIFIED source.
  const LOADS_THE_HARNESS =
    /(?:from\s*|import\s*\(\s*|require\s*\(\s*)["']@repo\/collectors\/testing["']/;

  it("no app or package source loads @repo/collectors/testing; only tests do", () => {
    const loading: string[] = [];
    for (const base of ["apps", "packages"]) {
      for (const name of readdirSync(join(root, base))) {
        const src = join(root, base, name, "src");
        if (!existsSync(src) || !statSync(src).isDirectory()) continue;
        for (const file of runtimeSources(src)) {
          if (LOADS_THE_HARNESS.test(readFileSync(file, "utf8"))) {
            loading.push(
              file
                .slice(root.length + 1)
                .split("\\")
                .join("/"),
            );
          }
        }
      }
    }
    expect(loading).toEqual([]);
  });

  it("recognises the forms a load takes, so the check above cannot pass by missing one", () => {
    for (const load of [
      'import { startHarness } from "@repo/collectors/testing";',
      "export * from '@repo/collectors/testing';",
      'const harness = await import("@repo/collectors/testing");',
    ]) {
      expect(LOADS_THE_HARNESS.test(load), load).toBe(true);
    }
    expect(LOADS_THE_HARNESS.test('import { PLATFORM_SOURCES } from "@repo/collectors";')).toBe(
      false,
    );
  });
});

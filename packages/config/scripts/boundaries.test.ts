/**
 * RELEASE-BLOCKING. Dependency rules between workspace packages, read from
 * each package.json. Lint rules stop the imports; this stops the dependency
 * itself, so the boundary has two independent layers.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

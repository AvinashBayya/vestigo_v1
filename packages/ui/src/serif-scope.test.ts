// @vitest-environment node
/**
 * The serif is the report document's alone (DESIGN-SYSTEM §4, owner decision
 * D4): ReportSurface is the only component that applies it. It must not leak
 * into any other component, any screen, or the body.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const SCOPES = ["packages/ui/src", "apps/web/src"];
/** The component that applies it, and the files that define or list the token. */
const ALLOWED = new Set([
  "packages/ui/src/report-surface.tsx",
  "packages/ui/src/tokens.css",
  "packages/ui/src/theme.css",
  "packages/ui/src/cn.ts",
]);
const SERIF = /\bfont-serif\b|\btext-serif-|--ds-font-serif|--ds-type-serif-/;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "client" ? [] : files(path);
    return /\.(tsx?|css)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe("the serif stays in the report document (D4)", () => {
  it("appears in no source file but ReportSurface and the token definitions", () => {
    const leaks: string[] = [];
    for (const scope of SCOPES) {
      for (const path of files(join(repoRoot, scope))) {
        const file = relative(repoRoot, path).split(sep).join("/");
        if (ALLOWED.has(file)) continue;
        readFileSync(path, "utf8")
          .split(/\r?\n/)
          .forEach((line, index) => {
            if (SERIF.test(line)) leaks.push(`${file}:${String(index + 1)}  ${line.trim()}`);
          });
      }
    }
    expect(leaks).toEqual([]);
  });

  it("the body is set in sans", () => {
    const theme = readFileSync(join(repoRoot, "packages/ui/src/theme.css"), "utf8");
    const body = /body\s*\{([^}]*)\}/.exec(theme)?.[1];
    expect(body).toContain("font-family: var(--ds-font-sans)");
  });

  it("ReportSurface sets the serif on its own text, never on its container", () => {
    const source = readFileSync(join(repoRoot, "packages/ui/src/report-surface.tsx"), "utf8");
    const article = /<article[\s\S]*?>/.exec(source)?.[0] ?? "";
    expect(article).not.toMatch(/serif/);
  });
});

// @vitest-environment node
/**
 * REGRESSION (U1-c live check, 2026-10-07): the current workspace tab drew no
 * underline. `tab-indicator` (a transparent bottom border) and
 * `tab-indicator-current` (the accent colour) have equal specificity, and the
 * compiled stylesheet put the transparent shorthand last, so the accent never
 * showed. jsdom does no cascade, so this reads the compiled CSS itself: the
 * current tab's rule must declare the whole border, so order cannot undo it.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "tailwindcss";
import { describe, expect, it } from "vitest";

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = resolve(webRoot, "../..");

async function loadStylesheet(id: string, base: string) {
  const path =
    id === "tailwindcss"
      ? join(webRoot, "node_modules/tailwindcss/index.css")
      : id === "@repo/ui/theme.css"
        ? join(repoRoot, "packages/ui/src/theme.css")
        : resolve(base, id);
  return Promise.resolve({ path, base: dirname(path), content: readFileSync(path, "utf8") });
}

describe("the current tab's underline survives the cascade", () => {
  it("declares the whole accent border, not only its colour", async () => {
    const compiler = await compile(readFileSync(join(webRoot, "src/index.css"), "utf8"), {
      base: join(webRoot, "src"),
      loadStylesheet,
    });
    const css = compiler.build(["tab-indicator", "tab-indicator-current"]);
    const rule = /\.tab-indicator-current\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toMatch(
      /border-bottom:\s*var\(--ds-tab-indicator-width\)\s+solid\s+var\(--ds-accent\)/,
    );
  });
});

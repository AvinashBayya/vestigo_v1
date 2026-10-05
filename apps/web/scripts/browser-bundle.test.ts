// @vitest-environment node
/**
 * The web app runs in a browser, which has no Node built-ins. The other web
 * tests run under Node, where `node:path` and friends exist, so they cannot
 * see an import that pulls one in. This builds the app the way the browser
 * gets it and fails on any module Vite had to stub out for the browser.
 *
 * REGRESSION (Phase 6b step 1): the screens imported PRODUCT_NAME from
 * @repo/config's main entry, which also carries Node-only helpers
 * (node:path, node:fs). Every test passed; the page was blank, with
 * "Module "node:path" has been externalized for browser compatibility".
 * The browser's entry point is @repo/config/product.
 */
import { isBuiltin } from "node:module";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "vite";
import { describe, expect, it } from "vitest";

const webRoot = fileURLToPath(new URL("..", import.meta.url));

describe("the web bundle", () => {
  it("pulls in no Node built-in", async () => {
    const imports: string[] = [];
    // Sees every import the bundle resolves, before Vite stubs a built-in out.
    const recordBuiltins: Plugin = {
      name: "record-node-builtins",
      enforce: "pre",
      resolveId(source, importer) {
        if (isBuiltin(source)) imports.push(`${source} imported by ${String(importer)}`);
        return null;
      },
    };
    await build({
      root: webRoot,
      configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
      logLevel: "silent",
      plugins: [recordBuiltins],
      build: { write: false },
    });

    expect(imports).toEqual([]);
  }, 120_000);
});

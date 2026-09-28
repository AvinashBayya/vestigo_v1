// @ts-check
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";
import fabrication from "./fabrication-plugin.js";

/**
 * Shared flat config. Every package's eslint.config.js calls this.
 *
 * @param {{ tsconfigRootDir: string, react?: boolean, ignores?: string[] }} options
 */
export function createConfig({ tsconfigRootDir, react = false, ignores = [] }) {
  return defineConfig(
    { ignores: ["dist/**", "coverage/**", ...ignores] },
    js.configs.recommended,
    tseslint.configs.strictTypeChecked,
    {
      languageOptions: {
        parserOptions: { projectService: true, tsconfigRootDir },
        globals: react ? globals.browser : globals.node,
      },
      rules: {
        // CLAUDE.md §8: no @ts-ignore without an explanatory comment.
        "@typescript-eslint/ban-ts-comment": [
          "error",
          {
            "ts-ignore": "allow-with-description",
            "ts-expect-error": "allow-with-description",
            minimumDescriptionLength: 10,
          },
        ],
        // CLAUDE.md §8: Node only. The previous codebase shipped production bugs
        // caused by a Bun-in-test, Node-in-production split.
        "no-restricted-globals": [
          "error",
          { name: "Bun", message: "Node only: Bun globals are not available at runtime." },
        ],
        "no-restricted-imports": [
          "error",
          {
            paths: [{ name: "bun", message: "Node only: do not import Bun modules." }],
            patterns: [{ group: ["bun:*"], message: "Node only: do not import Bun modules." }],
          },
        ],
      },
    },
    {
      // CLAUDE.md §1: never fabricate data. No `files` key, so this applies to
      // every linted file, TypeScript and JavaScript alike.
      plugins: { fabrication },
      rules: {
        "fabrication/no-fabricated-fallback": "error",
        "fabrication/require-fabrication-justification": "error",
      },
    },
    {
      files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
      extends: [tseslint.configs.disableTypeChecked],
    },
    react ? reactHooks.configs.flat.recommended : [],
    prettier,
  );
}

import { createConfig } from "@repo/config/eslint";

// Case analysis is pure (CLAUDE.md §6): the same input always gives the same
// output, so an analysis can be stored, cited and reproduced. The source may
// import only @repo/core and its own files, and may not read the clock, draw
// randomness, reach the process, the network or the file system, schedule
// work, or format by locale. test/purity.test.ts checks the same rules by
// reading the source, so the boundary has two independent layers.
const PURE = "Case analysis is pure (CLAUDE.md §6): pass the value in instead.";
const IMPURE_GLOBALS = [
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
];
const LOCALE_METHODS = [
  "localeCompare",
  "toLocaleString",
  "toLocaleLowerCase",
  "toLocaleUpperCase",
];

export default [
  ...createConfig({ tsconfigRootDir: import.meta.dirname }),
  {
    files: ["src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^(?!@repo/core$)(?!\\.\\.?/)",
              message: `${PURE} It imports only @repo/core and its own files.`,
            },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        ...IMPURE_GLOBALS.map((name) => ({ name, message: `${PURE} (${name})` })),
      ],
      "no-restricted-properties": [
        "error",
        { object: "Math", property: "random", message: `${PURE} (Math.random)` },
        ...LOCALE_METHODS.map((property) => ({
          property,
          message: `${PURE} Locale formatting differs between machines; compare and format by code unit.`,
        })),
      ],
      "no-restricted-syntax": [
        "error",
        { selector: "ImportExpression", message: `${PURE} (a dynamic import)` },
      ],
    },
  },
];

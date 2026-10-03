import { createConfig } from "@repo/config/eslint";

export default [
  ...createConfig({
    tsconfigRootDir: import.meta.dirname,
    react: true,
    // Generated from the API's OpenAPI document; never hand-edited.
    ignores: ["src/client/**"],
  }),
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      // TanStack Router's redirect() is thrown by design; nothing else non-Error may be.
      "@typescript-eslint/only-throw-error": [
        "error",
        { allow: [{ from: "package", package: "@tanstack/router-core", name: "Redirect" }] },
      ],
    },
  },
];

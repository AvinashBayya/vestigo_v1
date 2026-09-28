import { createConfig } from "@repo/config/eslint";

export default [
  ...createConfig({ tsconfigRootDir: import.meta.dirname }),
  {
    // The engine gets configuration by injection. No collector credential may
    // come from the environment: the tenant vault is the only source.
    files: ["src/**/*.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "env",
          message:
            "The engine never reads the environment; collector credentials come only from the tenant vault.",
        },
      ],
    },
  },
];

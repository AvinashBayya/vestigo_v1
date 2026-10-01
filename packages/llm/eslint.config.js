import { createConfig } from "@repo/config/eslint";

export default [
  ...createConfig({ tsconfigRootDir: import.meta.dirname }),
  {
    // The provider, its endpoint and its key come by injection from the
    // process that loaded configuration, never from the environment here.
    files: ["src/**/*.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "env",
          message: "packages/llm never reads the environment; configuration is injected.",
        },
      ],
    },
  },
];

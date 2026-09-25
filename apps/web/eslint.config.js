import { createConfig } from "@repo/config/eslint";

export default createConfig({
  tsconfigRootDir: import.meta.dirname,
  react: true,
  // Generated from the API's OpenAPI document; never hand-edited.
  ignores: ["src/client/**"],
});

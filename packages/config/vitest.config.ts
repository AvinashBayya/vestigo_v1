import { TEST_MAX_WORKERS } from "./vitest/index.js";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    maxWorkers: TEST_MAX_WORKERS,
  },
});

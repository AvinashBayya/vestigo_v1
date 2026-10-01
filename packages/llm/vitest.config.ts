import { TEST_MAX_WORKERS } from "@repo/config/vitest";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    maxWorkers: TEST_MAX_WORKERS,
    testTimeout: 30_000,
  },
});

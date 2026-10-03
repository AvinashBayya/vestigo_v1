import { TEST_MAX_WORKERS } from "@repo/config/vitest";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    maxWorkers: TEST_MAX_WORKERS,
  },
});

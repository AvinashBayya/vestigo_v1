import { fileURLToPath } from "node:url";
import { envSchema, PRODUCT_NAME } from "@repo/config";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { loadEnv, type Plugin } from "vite";
import { TEST_MAX_WORKERS } from "@repo/config/vitest";
import { defineConfig } from "vitest/config";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

/** Page title comes from PRODUCT_NAME, the only place the name is written. */
const productName: Plugin = {
  name: "product-name",
  transformIndexHtml: {
    order: "pre",
    handler: (html) => html.replaceAll("%PRODUCT_NAME%", PRODUCT_NAME),
  },
};

export default defineConfig(({ mode }) => {
  // The dev proxy targets the API's own configured port (root .env), falling
  // back to the schema default, so the two cannot disagree.
  const rootEnv = loadEnv(mode, repoRoot, "API_");
  const apiPort = envSchema.shape.API_PORT.parse(rootEnv.API_PORT || undefined);
  const apiOrigin = `http://127.0.0.1:${String(apiPort)}`;

  return {
    plugins: [react(), tailwindcss(), productName],
    server: {
      proxy: { "/health": apiOrigin, "/api": apiOrigin },
    },
    test: {
      environment: "jsdom",
      maxWorkers: TEST_MAX_WORKERS,
      setupFiles: ["./src/test-setup.ts"],
      // Headroom for on-demand route-chunk compile under multi-pool CPU
      // contention (see src/test-setup.ts); only ever reached on a slow or
      // failing path, never on a passing render.
      testTimeout: 30_000,
    },
  };
});

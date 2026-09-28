import { defineConfig } from "drizzle-kit";

// Generation only: drizzle-kit writes SQL from the schema and never connects.
// Migrations are applied by scripts/migrate.ts as the schema owner role.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
});

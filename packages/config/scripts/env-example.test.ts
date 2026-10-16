import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { envSchema } from "../src/env.ts";
import { renderEnvExample } from "./env-example.ts";
import { findRepoRoot } from "./repo-root.ts";

describe(".env.example", () => {
  const rendered = renderEnvExample(envSchema);

  it("is exactly what the schema generates (run generate:env after changing env.ts)", () => {
    const committed = readFileSync(join(findRepoRoot(import.meta.dirname), ".env.example"), "utf8");
    expect(committed.replace(/\r\n/g, "\n")).toBe(rendered);
  });

  it("lists every schema variable", () => {
    for (const name of Object.keys(envSchema.shape)) {
      expect(rendered).toMatch(new RegExp(`^#? ?${name}=`, "m"));
    }
  });

  it("marks required variables and leaves secrets blank", () => {
    expect(rendered).toContain("# Required.\nDATABASE_URL=postgres://");
    expect(rendered).toContain("# Required.\nAUTH_SECRET=\n");
    expect(rendered).toContain("# Optional.\nREPORT_HANDLING_MARKING=\n");
    expect(rendered).toContain("# API_PORT=3000");
  });

  it("never enables the operator access method: its default is shown commented out", () => {
    expect(rendered).toContain("# COLLECTORS_ACCESS_METHODS=open,official,licensed\n");
    expect(rendered).not.toMatch(/^COLLECTORS_ACCESS_METHODS=/m);
    expect(rendered).not.toMatch(/COLLECTORS_ACCESS_METHODS=.*operator/);
  });

  it("fills an optional variable's example, so a fresh .env can run migrations", () => {
    expect(rendered).toContain(
      "# Optional.\nDATABASE_MIGRATION_URL=postgres://app_owner:app_owner@127.0.0.1:5432/app\n",
    );
  });
});

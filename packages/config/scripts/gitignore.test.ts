/**
 * No environment file can be committed except the generated `.env.example`,
 * which holds no secrets. Asks git itself rather than re-implementing
 * .gitignore matching; `--no-index` makes it answer from the patterns alone,
 * so a tracked file cannot pass by being tracked.
 */
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { findRepoRoot } from "./repo-root.ts";

const root = findRepoRoot(import.meta.dirname);

/** git check-ignore's exit status: 0 ignored, 1 not ignored, anything else git could not say. */
const checkIgnore = (path: string) =>
  spawnSync("git", ["check-ignore", "--no-index", "--quiet", path], { cwd: root, encoding: "utf8" })
    .status;

describe(".gitignore", () => {
  it.each([
    ".env",
    ".env.local",
    ".env.production",
    ".env.development.local",
    "apps/api/.env",
    "apps/worker/.env.test",
  ])("ignores %s", (path) => {
    expect(checkIgnore(path)).toBe(0);
  });

  it("keeps the generated .env.example committable", () => {
    expect(checkIgnore(".env.example")).toBe(1);
  });
});

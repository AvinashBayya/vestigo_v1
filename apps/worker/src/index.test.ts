import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const entry = join(import.meta.dirname, "index.ts");

function runWorker(extraEnv: Record<string, string>) {
  const env: Record<string, string> = { ...extraEnv };
  for (const name of ["PATH", "SystemRoot", "SYSTEMROOT"]) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return spawnSync(process.execPath, [entry], { env, encoding: "utf8", timeout: 20_000 });
}

describe("worker entry point", () => {
  it("fails fast on invalid config before doing anything else", () => {
    const run = runWorker({});
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("CONFIG_INVALID");
    expect(run.stderr).toContain("DATABASE_URL");
  });

  it("exits non-zero with NOT_IMPLEMENTED rather than idling as if healthy", () => {
    const run = runWorker({
      DATABASE_URL: "postgres://app:app@127.0.0.1:5432/app",
      REDIS_URL: "redis://127.0.0.1:6379",
    });
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("NOT_IMPLEMENTED");
    expect(run.stderr).toContain("worker.queue-consumption");
  });
});

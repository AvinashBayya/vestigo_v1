import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const server = join(import.meta.dirname, "server.ts");

describe("server startup", () => {
  it("fails fast on invalid config, naming each offending variable", () => {
    // Only what the OS needs to start a process; no DATABASE_URL or REDIS_URL.
    const env: Record<string, string> = { API_PORT: "not-a-port" };
    for (const name of ["PATH", "SystemRoot", "SYSTEMROOT"]) {
      const value = process.env[name];
      if (value !== undefined) env[name] = value;
    }

    const run = spawnSync(process.execPath, [server], { env, encoding: "utf8", timeout: 20_000 });

    expect(run.status).toBe(1);
    expect(run.stderr).toContain("[CONFIG_INVALID]");
    expect(run.stderr).toContain("DATABASE_URL: required but not set");
    expect(run.stderr).toContain("REDIS_URL: required but not set");
    expect(run.stderr).toContain("API_PORT:");
    expect(run.stderr).not.toContain("not-a-port");
  });
});

import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.ts";
import { ConfigError } from "./errors.ts";

const VALID = {
  DATABASE_URL: "postgres://app:app@127.0.0.1:5432/app",
  REDIS_URL: "redis://127.0.0.1:6379",
};

function configErrorFrom(source: Record<string, string | undefined>): ConfigError {
  try {
    loadEnv(source);
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  return expect.unreachable("loadEnv should have thrown ConfigError");
}

describe("loadEnv", () => {
  it("returns typed config with defaults applied", () => {
    const env = loadEnv(VALID);
    expect(env.DATABASE_URL).toBe(VALID.DATABASE_URL);
    expect(env.API_PORT).toBe(3000);
    expect(env.NODE_ENV).toBe("development");
  });

  it("coerces a numeric port from its string form", () => {
    expect(loadEnv({ ...VALID, API_PORT: "8080" }).API_PORT).toBe(8080);
  });

  it("names every missing required variable", () => {
    const error = configErrorFrom({});
    expect(error.code).toBe("CONFIG_INVALID");
    expect(error.issues.map((issue) => issue.variable).sort()).toEqual([
      "DATABASE_URL",
      "REDIS_URL",
    ]);
    expect(error.message).toContain("DATABASE_URL: required but not set");
    expect(error.message).toContain("REDIS_URL: required but not set");
  });

  it("treats an empty string as unset rather than as a value", () => {
    const error = configErrorFrom({ ...VALID, DATABASE_URL: "" });
    expect(error.issues).toEqual([{ variable: "DATABASE_URL", problem: "required but not set" }]);
  });

  it("names a malformed variable without echoing its value", () => {
    const secret = "hunter2-do-not-print";
    const error = configErrorFrom({ ...VALID, REDIS_URL: `http://${secret}@example.invalid` });
    expect(error.issues.map((issue) => issue.variable)).toEqual(["REDIS_URL"]);
    expect(error.message).not.toContain(secret);
  });

  it("rejects an out-of-range port", () => {
    const error = configErrorFrom({ ...VALID, API_PORT: "70000" });
    expect(error.issues.map((issue) => issue.variable)).toEqual(["API_PORT"]);
  });

  it("leaves an unset collector credential undefined, never a placeholder string", () => {
    const env = loadEnv({ ...VALID, SHODAN_API_KEY: "" });
    expect(env.SHODAN_API_KEY).toBeUndefined();
  });
});

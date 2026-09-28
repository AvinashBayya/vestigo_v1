import { describe, expect, it } from "vitest";
import { allowsUnverifiedSources, envSchema, loadEnv, loadEnvSubset } from "./env.ts";
import { ConfigError } from "./errors.ts";

const VALID = {
  DATABASE_URL: "postgres://app_runtime:app_runtime@127.0.0.1:5432/app",
  DATABASE_AUTH_URL: "postgres://app_auth:app_auth@127.0.0.1:5432/app",
  REDIS_URL: "redis://127.0.0.1:6379",
  AUTH_SECRET: "x".repeat(32),
  AUTH_BASE_URL: "http://127.0.0.1:3000",
  WEB_ORIGIN: "http://localhost:5173",
  VAULT_MASTER_KEY: "[test master key]",
  VAULT_MASTER_KEY_ID: "test-1",
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
      "AUTH_BASE_URL",
      "AUTH_SECRET",
      "DATABASE_AUTH_URL",
      "DATABASE_URL",
      "REDIS_URL",
      "VAULT_MASTER_KEY",
      "VAULT_MASTER_KEY_ID",
      "WEB_ORIGIN",
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

describe("loadEnvSubset", () => {
  it("validates only the named variables", () => {
    // REDIS_URL is required by the full schema but not requested here.
    const env = loadEnvSubset(["DATABASE_MIGRATION_URL"], {
      DATABASE_MIGRATION_URL: "postgres://app_owner:app_owner@127.0.0.1:5432/app",
    });
    expect(env).toEqual({
      DATABASE_MIGRATION_URL: "postgres://app_owner:app_owner@127.0.0.1:5432/app",
    });
  });

  it("names a requested required variable that is missing", () => {
    expect(() => loadEnvSubset(["DATABASE_URL"], {})).toThrow("DATABASE_URL: required but not set");
  });

  it("rejects a malformed requested variable without echoing it", () => {
    const secret = "owner-password-do-not-print";
    try {
      loadEnvSubset(["DATABASE_MIGRATION_URL"], {
        DATABASE_MIGRATION_URL: `mysql://owner:${secret}@127.0.0.1/app`,
      });
      expect.unreachable("loadEnvSubset should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect(String(error)).toContain("DATABASE_MIGRATION_URL");
      expect(String(error)).not.toContain(secret);
    }
  });
});

describe("secrets in configuration", () => {
  it("rejects a short auth secret without echoing it", () => {
    const secret = "short-secret-do-not-print";
    const error = configErrorFrom({ ...VALID, AUTH_SECRET: secret });
    expect(error.issues.map((issue) => issue.variable)).toEqual(["AUTH_SECRET"]);
    expect(error.message).not.toContain(secret);
  });

  it("never gives a secret an example value in the generated .env.example", () => {
    for (const name of ["AUTH_SECRET", "VAULT_MASTER_KEY"] as const) {
      expect(envSchema.shape[name].meta()?.examples).toBeUndefined();
    }
  });
});

describe("allowsUnverifiedSources", () => {
  it.each([
    ["development", undefined, true],
    ["test", undefined, true],
    ["production", undefined, false],
    ["production", "true", true],
    ["development", "false", false],
    ["production", "false", false],
  ] as const)("NODE_ENV=%s, COLLECTORS_ALLOW_UNVERIFIED=%s: %s", (nodeEnv, flag, expected) => {
    expect(allowsUnverifiedSources({ NODE_ENV: nodeEnv, COLLECTORS_ALLOW_UNVERIFIED: flag })).toBe(
      expected,
    );
  });

  it("reads the flag from the environment, and refuses anything but true or false", () => {
    const env = loadEnvSubset(["NODE_ENV", "COLLECTORS_ALLOW_UNVERIFIED"], {
      NODE_ENV: "production",
    });
    expect(allowsUnverifiedSources(env)).toBe(false);
    expect(() =>
      loadEnvSubset(["COLLECTORS_ALLOW_UNVERIFIED"], { COLLECTORS_ALLOW_UNVERIFIED: "yes" }),
    ).toThrow(ConfigError);
  });
});

import { describe, expect, it } from "vitest";
import { enabledAccessMethods, envSchema, loadEnv, loadEnvSubset } from "./env.ts";
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

  it("leaves an empty optional variable undefined, never a placeholder string", () => {
    const env = loadEnv({ ...VALID, REPORT_HANDLING_MARKING: "" });
    expect(env.REPORT_HANDLING_MARKING).toBeUndefined();
  });

  it("drops collector credentials set in the environment: they come only from the tenant vault", () => {
    const retired = {
      BRAVE_SEARCH_API_KEY: "[env brave key]",
      SHODAN_API_KEY: "[env shodan key]",
      HIBP_API_KEY: "[env hibp key]",
      GITHUB_TOKEN: "[env github token]",
    };
    const env = loadEnv({ ...VALID, ...retired });
    for (const name of Object.keys(retired)) expect(env).not.toHaveProperty(name);
    expect(JSON.stringify(env)).not.toContain("[env ");
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

describe("access methods: operator is off unless configuration names it (RELEASE-BLOCKING, acceptance a)", () => {
  it.each(["development", "test", "production"] as const)(
    "NODE_ENV=%s, unset: open, official and licensed, never operator",
    (nodeEnv) => {
      const env = loadEnv({ ...VALID, NODE_ENV: nodeEnv });
      expect(enabledAccessMethods(env)).toEqual(["open", "official", "licensed"]);
      expect(enabledAccessMethods(env)).not.toContain("operator");
    },
  );

  it("reads a blank value as unset, so a copied .env.example never turns operator on", () => {
    const env = loadEnv({ ...VALID, COLLECTORS_ACCESS_METHODS: "" });
    expect(enabledAccessMethods(env)).toEqual(["open", "official", "licensed"]);
  });

  it("turns operator on only where the list names it, in the order given", () => {
    const env = loadEnvSubset(["COLLECTORS_ACCESS_METHODS"], {
      COLLECTORS_ACCESS_METHODS: "open, operator",
    });
    expect(enabledAccessMethods(env)).toEqual(["open", "operator"]);
  });

  it.each(["open,", "open,,official", "open,open", "operators", "scrape", " , "])(
    "refuses %j, naming the variable",
    (value) => {
      const error = configErrorFrom({ ...VALID, COLLECTORS_ACCESS_METHODS: value });
      expect(error.issues.map((issue) => issue.variable)).toEqual(["COLLECTORS_ACCESS_METHODS"]);
    },
  );

  it("has no setting that lets an UNVERIFIED source run: the retired flag is dropped if set", () => {
    expect(Object.keys(envSchema.shape)).not.toContain("COLLECTORS_ALLOW_UNVERIFIED");
    const env = loadEnv({ ...VALID, NODE_ENV: "development", COLLECTORS_ALLOW_UNVERIFIED: "true" });
    expect(Object.keys(env)).not.toContain("COLLECTORS_ALLOW_UNVERIFIED");
  });
});

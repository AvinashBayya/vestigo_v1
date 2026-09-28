/**
 * RELEASE-BLOCKING. No collector credential can be resolved from environment
 * configuration: collectors read credentials only from each tenant's vault,
 * so there is no platform-level fallback for any of them. This file checks
 * the configuration schema against the platform catalogue; the engine suite
 * checks the behaviour end to end.
 */
import { envSchema, loadEnv } from "@repo/config";
import { describe, expect, it } from "vitest";
import { PLATFORM_SOURCES } from "../src/index.ts";

const VARIABLES = Object.keys(envSchema.shape);

/**
 * Platform-owned secrets: the only secret-shaped variables configuration may
 * hold. A new one (the LLM provider's key, say) is added here with its reason.
 * A collector's credential never is: it belongs in the tenant vault.
 */
const PLATFORM_SECRETS: Readonly<Record<string, string>> = {
  AUTH_SECRET: "signs session cookies and encrypts TOTP secrets",
  VAULT_MASTER_KEY: "wraps every tenant vault's data keys",
};

const SECRET_SHAPED = /(?:API_KEY|TOKEN|SECRET|PASSWORD|PRIVATE_KEY|_KEY)$/;

/** Retired in Phase 3A review: collector credentials that once had a platform fallback. */
const RETIRED = ["BRAVE_SEARCH_API_KEY", "SHODAN_API_KEY", "HIBP_API_KEY", "GITHUB_TOKEN"];

/** The provider a source id names, as it would appear in a variable: "brave-search" → "BRAVE". */
function providerToken(sourceId: string): string {
  const [first] = sourceId.split(/[-.]/);
  return (first ?? sourceId).toUpperCase();
}

describe("no collector credential can be resolved from environment configuration (RELEASE-BLOCKING)", () => {
  it("has no variable naming any collector source", () => {
    const tokens = new Set(PLATFORM_SOURCES.map((source) => providerToken(source.id)));
    expect(tokens.size).toBeGreaterThan(30);
    const naming = VARIABLES.filter((name) =>
      name.split("_").some((segment) => tokens.has(segment)),
    );
    expect(naming).toEqual([]);
  });

  it("holds no secret-shaped variable that is not a listed platform-owned secret", () => {
    const secrets = VARIABLES.filter((name) => SECRET_SHAPED.test(name)).sort();
    expect(secrets).toEqual(Object.keys(PLATFORM_SECRETS).sort());
  });

  it("no longer has the retired collector credentials, and drops them if they are set", () => {
    for (const name of RETIRED) expect(VARIABLES).not.toContain(name);
    const env = loadEnv({
      DATABASE_URL: "postgres://app_runtime:app_runtime@127.0.0.1:5432/app",
      DATABASE_AUTH_URL: "postgres://app_auth:app_auth@127.0.0.1:5432/app",
      REDIS_URL: "redis://127.0.0.1:6379",
      AUTH_SECRET: "x".repeat(32),
      AUTH_BASE_URL: "http://127.0.0.1:3000",
      WEB_ORIGIN: "http://localhost:5173",
      VAULT_MASTER_KEY: "[test master key]",
      VAULT_MASTER_KEY_ID: "test-1",
      ...Object.fromEntries(RETIRED.map((name) => [name, `[${name} from the environment]`])),
    });
    expect(Object.keys(env).filter((name) => RETIRED.includes(name))).toEqual([]);
    expect(JSON.stringify(env)).not.toContain("from the environment");
  });

  it("recognises the credential spellings the retired variables and the old codebase used", () => {
    const tokens = new Set(PLATFORM_SOURCES.map((source) => providerToken(source.id)));
    for (const name of [
      ...RETIRED,
      "REDDIT_CLIENT_SECRET",
      "UCDP_API_TOKEN",
      "YOUTUBE_API_KEY",
      "KPLER_API_KEY",
      "BLUESKY_APP_PASSWORD",
    ]) {
      expect(
        name.split("_").some((segment) => tokens.has(segment)),
        name,
      ).toBe(true);
    }
    // A platform-owned key names no source, so it is not mistaken for one.
    expect("LLM_API_KEY".split("_").some((segment) => tokens.has(segment))).toBe(false);
  });
});

/**
 * RELEASE-BLOCKING. Whatever LOG_LEVEL the application is configured with,
 * the identity provider publishes nothing below "warn". Better Auth's
 * info-level messages include raw personal data (a sign-up for an existing
 * account logs the email address) and bypass the structured logger
 * (CLAUDE.md §8). Raising its level fails here, whether directly or by
 * letting it follow a verbose LOG_LEVEL. See identityProviderLogger in
 * src/auth/better-auth.ts.
 */
import { randomBytes } from "node:crypto";
import { envSchema, type Env } from "@repo/config";
import { createAuthStore, createDatabase } from "@repo/db";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createAuth } from "../src/auth/better-auth.ts";
import { TEST_API } from "./config.ts";
import {
  BASE_URL,
  Browser,
  createTestApi,
  DEFAULT_LOG_LEVEL,
  newAccount,
  provisionTestTenant,
  WEB_ORIGIN,
} from "./support.ts";

type LogLevel = Env["LOG_LEVEL"];

/** Every LOG_LEVEL the configuration accepts, read from the schema itself. */
const LOG_LEVELS = envSchema.shape.LOG_LEVEL.unwrap().options;

/** The only Better Auth levels that may ever be published. */
const PUBLISHABLE = new Set(["warn", "error"]);

/** What Better Auth publishes for each LOG_LEVEL: it follows the application down, not up. */
const EXPECTED: Readonly<Record<LogLevel, readonly string[]>> = {
  trace: ["warn", "error"],
  debug: ["warn", "error"],
  info: ["warn", "error"],
  warn: ["warn", "error"],
  error: ["error"],
  fatal: ["error"],
  silent: [],
};

const quiet = () => undefined;
const db = createDatabase({ connectionString: TEST_API.runtimeUrl, onConnectionError: quiet });
const authStore = createAuthStore({ connectionString: TEST_API.authUrl, onConnectionError: quiet });

afterAll(async () => {
  await Promise.all([db.close(), authStore.close()]);
});

const CONSOLE_METHODS = ["log", "info", "warn", "error", "debug", "trace"] as const;

/** Everything written to the console while `run` runs. */
async function consoleOutput(run: () => unknown): Promise<unknown[][]> {
  const spies = CONSOLE_METHODS.map((method) =>
    vi.spyOn(console, method).mockImplementation(() => undefined),
  );
  try {
    await run();
    return spies.flatMap((spy) => spy.mock.calls);
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
}

/** The levels at which the identity provider, built as the server builds it, writes anything. */
async function publishedLevels(logLevel: LogLevel): Promise<string[]> {
  const auth = createAuth({
    authStore,
    db,
    secret: randomBytes(32).toString("base64url"),
    baseUrl: BASE_URL,
    trustedOrigins: [WEB_ORIGIN],
    rateLimit: { enabled: false },
    logLevel,
  });
  const { logger } = await auth.$context;
  const published: string[] = [];
  // Every level the provider's logger has, read from the logger itself, so a
  // level added in an upgrade is probed too.
  for (const [level, write] of Object.entries(logger)) {
    if (typeof write !== "function") continue;
    const output = await consoleOutput(() => {
      write("[probe]");
    });
    if (output.length > 0) published.push(level);
  }
  return published;
}

describe("the identity provider never logs below warn (RELEASE-BLOCKING)", () => {
  it.each(LOG_LEVELS)("LOG_LEVEL=%s: nothing below warn is published", async (level) => {
    const published = await publishedLevels(level);
    expect(published.filter((published) => !PUBLISHABLE.has(published))).toEqual([]);
  });

  // Also shows the console capture sees what the provider does write, so the
  // test above cannot pass by capturing nothing.
  it.each(LOG_LEVELS)("LOG_LEVEL=%s: it follows the application's level down", async (level) => {
    expect(await publishedLevels(level)).toEqual(EXPECTED[level]);
  });

  it("a sign-up for an existing account, at the default LOG_LEVEL, writes the address nowhere", async () => {
    const api = await createTestApi({ logLevel: DEFAULT_LOG_LEVEL });
    try {
      const { owner } = await provisionTestTenant(api, "logging");
      const output = await consoleOutput(async () => {
        const reply = await new Browser(api).request("POST", "/api/auth/sign-up/email", {
          ...newAccount("duplicate"),
          email: owner.email,
        });
        expect(reply.status).toBe(200);
      });
      expect(JSON.stringify(output)).not.toContain(owner.email);
    } finally {
      await api.close();
    }
  });
});

import { z } from "zod";
import { ConfigError, type ConfigIssue } from "./errors.ts";

/**
 * A collector credential. Optional: when it is unset the collector that needs it
 * must report "needs key", never an empty successful result (CLAUDE.md §1).
 */
const collectorCredential = (description: string) =>
  z.string().min(1).optional().meta({ description });

/**
 * The environment every server-side process validates at startup.
 *
 * `.env.example` is generated from this schema
 * (`pnpm --filter @repo/config generate:env`) and a test fails if the two
 * drift. Add variables here, never by editing `.env.example`.
 */
export const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development")
    .meta({ description: "Runtime mode." }),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info")
    .meta({ description: "Minimum level for structured logs." }),

  API_HOST: z
    .string()
    .min(1)
    .default("127.0.0.1")
    .meta({ description: "Interface the API server binds to." }),
  API_PORT: z.coerce
    .number()
    .int()
    .min(1)
    .max(65535)
    .default(3000)
    .meta({ description: "TCP port the API server listens on." }),

  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }).meta({
    description: "PostgreSQL connection string. The example matches docker-compose.yml.",
    examples: ["postgres://app:app@127.0.0.1:5432/app"],
  }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }).meta({
    description: "Redis connection string. The example matches docker-compose.yml.",
    examples: ["redis://127.0.0.1:6379"],
  }),

  // Collector credentials: placeholders until the collector registry lands in
  // Phase 3. Each registry entry will carry the source's licence verdict.
  BRAVE_SEARCH_API_KEY: collectorCredential(
    "Brave Search API key. Chosen dork-engine backend (ARCHITECTURE-DECISIONS §11).",
  ),
  SHODAN_API_KEY: collectorCredential(
    "Shodan paid API key. InternetDB is non-commercial only (ARCHITECTURE-DECISIONS §11).",
  ),
  HIBP_API_KEY: collectorCredential(
    "Have I Been Pwned API key. Commercial terms not yet verified (ARCHITECTURE-DECISIONS §11).",
  ),
  GITHUB_TOKEN: collectorCredential("GitHub API token."),
});

export type Env = z.infer<typeof envSchema>;

export type EnvSource = Readonly<Record<string, string | undefined>>;

/**
 * Validates the environment and returns typed config. Throws `ConfigError`
 * naming every offending variable; callers let it end the process.
 *
 * An empty string counts as unset, because `NAME=` in a .env file means "not
 * provided", not "provided and blank".
 */
export function loadEnv(source: EnvSource = process.env): Env {
  const input: Record<string, string | undefined> = {};
  for (const name of Object.keys(envSchema.shape)) {
    const value = source[name];
    input[name] = value === "" ? undefined : value;
  }

  const result = envSchema.safeParse(input);
  if (result.success) return result.data;

  const issues: ConfigIssue[] = result.error.issues.map((issue) => {
    const variable = String(issue.path[0]);
    // Zod's messages describe the expected shape and never echo the input, so
    // they are safe to print even when the value is a secret.
    const problem = input[variable] === undefined ? "required but not set" : issue.message;
    return { variable, problem };
  });
  throw new ConfigError(issues);
}

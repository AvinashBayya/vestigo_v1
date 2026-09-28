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
    description:
      "PostgreSQL connection as the application role (app_runtime): no superuser, no BYPASSRLS. The example matches docker-compose.yml.",
    examples: ["postgres://app_runtime:app_runtime@127.0.0.1:5432/app"],
  }),
  DATABASE_MIGRATION_URL: z
    .url({ protocol: /^postgres(ql)?$/ })
    .optional()
    .meta({
      description:
        "PostgreSQL connection as the schema owner (app_owner). Used only by pnpm db:migrate; the API and worker never use it.",
      examples: ["postgres://app_owner:app_owner@127.0.0.1:5432/app"],
    }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }).meta({
    description: "Redis connection string. The example matches docker-compose.yml.",
    examples: ["redis://127.0.0.1:6379"],
  }),

  CONTENT_STORE_DIR: z
    .string()
    .min(1)
    .optional()
    .meta({
      description:
        "Directory for the local content-addressed payload store (development). Relative paths resolve from the working directory.",
      examples: ["./data/content-store"],
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
  return parseVariables(envSchema, source);
}

/**
 * Validates only the named variables, for tools that need a few of them (a
 * migration script has no use for REDIS_URL). Same rules and errors as loadEnv.
 */
export function loadEnvSubset<K extends keyof Env>(
  names: readonly K[],
  source: EnvSource = process.env,
): Pick<Env, K> {
  const shape = Object.fromEntries(names.map((name) => [name, envSchema.shape[name]]));
  // The subset schema is built from envSchema's own fields, so its output is
  // exactly Pick<Env, K>; TypeScript cannot follow that through fromEntries.
  return parseVariables(z.object(shape), source) as unknown as Pick<Env, K>;
}

function parseVariables<T extends z.ZodObject>(schema: T, source: EnvSource): z.infer<T> {
  const input: Record<string, string | undefined> = {};
  for (const name of Object.keys(schema.shape)) {
    const value = source[name];
    input[name] = value === "" ? undefined : value;
  }

  const result = schema.safeParse(input);
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

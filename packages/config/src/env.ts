import { z } from "zod";
import { ConfigError, type ConfigIssue } from "./errors.ts";
import { ALLOWED_MODEL_IDS, LLM_PROFILES, STRUCTURED_OUTPUT_MODES } from "./llm.ts";

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
  // The identity provider (Better Auth) follows this level down but never
  // below "warn", because its info-level messages include email addresses
  // (CLAUDE.md §8). That clamp is identityProviderLogger in
  // apps/api/src/auth/better-auth.ts, and apps/api/test/identity-logging.test.ts
  // fails if any value accepted here would get past it.
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

  DATABASE_AUTH_URL: z.url({ protocol: /^postgres(ql)?$/ }).meta({
    description:
      "PostgreSQL connection as the identity role (app_auth): the auth schema only, no tenant data. The example matches docker-compose.yml.",
    examples: ["postgres://app_auth:app_auth@127.0.0.1:5432/app"],
  }),

  AUTH_SECRET: z.string().min(32).meta({
    description:
      "Secret that signs session cookies and encrypts TOTP secrets. At least 32 characters; generate with: node -e \"console.log(require('node:crypto').randomBytes(32).toString('base64url'))\". Never commit it.",
  }),
  AUTH_BASE_URL: z.url({ protocol: /^https?$/ }).meta({
    description: "Public base URL of the API, where the /api/auth endpoints are served.",
    examples: ["http://127.0.0.1:3000"],
  }),
  WEB_ORIGIN: z.url({ protocol: /^https?$/ }).meta({
    description:
      "Origin of the web app. Cookie-authenticated requests from any other origin are refused.",
    examples: ["http://localhost:5173"],
  }),

  VAULT_MASTER_KEY: z.string().min(1).meta({
    description:
      "Credential vault master key: base64 of 32 random bytes. Supply it from the process environment or a secret manager, never from a file; it is never logged.",
  }),
  VAULT_MASTER_KEY_ID: z
    .string()
    .regex(/^[A-Za-z0-9._-]{1,64}$/)
    .meta({
      description: "Identifier of the current vault master key, recorded with every credential.",
      examples: ["local-dev-1"],
    }),

  API_KEY_RATE_LIMIT_PER_MINUTE: z.coerce
    .number()
    .int()
    .min(1)
    .default(60)
    .meta({ description: "Requests per minute allowed to each API key, counted in Redis." }),

  CONTENT_STORE_DIR: z
    .string()
    .min(1)
    .optional()
    .meta({
      description:
        "Directory for the local content-addressed store of evidence payloads and report PDFs, shared by the API and the worker. A relative path resolves from the repository root, so every process uses the same one; deployments set an absolute path.",
      examples: ["./data/content-store"],
    }),

  COLLECTORS_ALLOW_UNVERIFIED: z.enum(["true", "false"]).optional().meta({
    description:
      "Whether collectors whose source licence is UNVERIFIED may run. BLOCKED sources never run. Unset: allowed in development and test, refused in production.",
  }),

  // ── Jobs and workers (Phase 4) ──
  QUEUE_PREFIX: z
    .string()
    .regex(/^[A-Za-z0-9._-]{1,64}$/)
    .default("jobs")
    .meta({
      description:
        "Prefix of every job queue's Redis keys, so deployments sharing one Redis stay apart.",
    }),
  WORKER_QUEUES: z
    .string()
    .min(1)
    .default("*")
    .meta({
      description:
        "Queues this worker pool consumes, comma-separated: investigations, fusion, collect.<source>, collect.* for every source, or * for all.",
      examples: ["investigations,fusion", "collect.*", "collect.crtsh,collect.rdap"],
    }),
  COLLECT_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(2).meta({
    description:
      "The bulkhead: the most collector jobs of one source that run at once, across every worker.",
  }),
  JOB_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5).meta({
    description:
      "Attempts a job gets, the first included. Only rate limits, timeouts and unavailable upstreams are retried; the last such attempt dead-letters the job.",
  }),
  JOB_RETRY_BASE_MS: z.coerce
    .number()
    .int()
    .min(1)
    .default(2_000)
    .meta({ description: "Wait before a job's second attempt; it doubles per attempt after." }),
  JOB_RETRY_MAX_MS: z.coerce.number().int().min(1).default(300_000).meta({
    description: "Longest the backoff alone waits. An upstream's own Retry-After may be longer.",
  }),
  CIRCUIT_FAILURE_THRESHOLD: z.coerce
    .number()
    .int()
    .min(1)
    .max(1000)
    .default(5)
    .meta({ description: "Consecutive failures of one source that open its circuit." }),
  CIRCUIT_FAILURE_WINDOW_MS: z.coerce
    .number()
    .int()
    .min(1)
    .default(300_000)
    .meta({ description: "A failure older than this no longer counts towards opening a circuit." }),
  CIRCUIT_COOLING_MS: z.coerce.number().int().min(1).default(60_000).meta({
    description: "How long an open circuit refuses calls before one probe is let through.",
  }),
  CIRCUIT_PROBE_LEASE_MS: z.coerce.number().int().min(1).default(600_000).meta({
    description:
      "How long a half-open circuit's probe holds its slot; longer than any collector's run budget.",
  }),
  RUN_EVENTS_POLL_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(10_000)
    .default(1_000)
    .meta({ description: "How often the run progress stream reads a run's state." }),

  // ── Language models and reports (Phase 5) ──
  LLM_PROFILE: z.enum(LLM_PROFILES).default("hosted").meta({
    description:
      "Which LLM serving profile to use: hosted (an OpenAI-compatible hosted open-weight API) or vllm (self-hosted; disabled unless LLM_VLLM_ENABLED=true).",
  }),
  LLM_HOSTED_BASE_URL: z
    .url({ protocol: /^https$/ })
    .optional()
    .meta({
      description:
        "Base URL of the hosted open-weight API, up to but not including /chat/completions. Unset: no provider is configured, and report synthesis is unavailable (reports still generate without it). Azure OpenAI endpoints are refused.",
    }),
  LLM_HOSTED_API_KEY: z.string().min(1).optional().meta({
    description:
      "The platform's API key for the hosted provider. Platform-owned, never a tenant's; never logged or committed.",
  }),
  LLM_HOSTED_STRUCTURED_OUTPUT: z.enum(STRUCTURED_OUTPUT_MODES).default("none").meta({
    description:
      "How the hosted provider is asked for JSON: json_schema, json_object, or none (prompted only). Every response is schema-validated regardless.",
  }),
  LLM_VLLM_ENABLED: z.enum(["true", "false"]).default("false").meta({
    description:
      "Switches the self-hosted vLLM profile on. Off by default so no GPU idles; LLM_PROFILE=vllm is refused while it is off.",
  }),
  LLM_VLLM_BASE_URL: z
    .url({ protocol: /^https?$/ })
    .default("http://127.0.0.1:8000/v1")
    .meta({
      description:
        "Base URL of the vLLM OpenAI-compatible server (docker compose profile llm-selfhosted).",
    }),
  LLM_VLLM_API_KEY: z.string().min(1).optional().meta({
    description: "The key the vLLM server was started with (--api-key), if any.",
  }),
  LLM_SMALL_MODEL: z.enum(ALLOWED_MODEL_IDS).default("Qwen/Qwen3-8B").meta({
    description:
      "Allowlisted model for extraction and classification (packages/config/src/llm.ts).",
  }),
  LLM_LARGE_MODEL: z.enum(ALLOWED_MODEL_IDS).default("Qwen/Qwen3-32B").meta({
    description: "Allowlisted model for report synthesis (packages/config/src/llm.ts).",
  }),
  LLM_MODEL_NAMES: z
    .string()
    .min(1)
    .optional()
    .meta({
      description:
        "Names the endpoint serves allowlisted models under, when they differ from the model id: id=name pairs, comma-separated.",
      examples: ["Qwen/Qwen3-32B=qwen3-32b"],
    }),
  LLM_REQUEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(600_000)
    .default(120_000)
    .meta({ description: "Longest one model call may take before it is abandoned." }),
  LLM_CACHE_TTL_SECONDS: z.coerce.number().int().min(1).default(604_800).meta({
    description:
      "How long a model response stays in the Redis cache (keyed by tenant, prompt, model and version).",
  }),
  REPORT_CONCURRENCY: z.coerce
    .number()
    .int()
    .min(1)
    .max(20)
    .default(2)
    .meta({ description: "Reports generated at once, across every worker." }),
  REPORT_RENDER_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(1).meta({
    description:
      "Report PDFs rendered at once, across every worker. Rendering is CPU-bound: one per worker core at most.",
  }),
  CASE_ANALYSIS_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(2).meta({
    description:
      "Case analyses computed at once, across every worker. The analysis is CPU-bound and has its own bulkhead, apart from collection and reports.",
  }),
  CASE_ANALYSIS_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(60_000).meta({
    description:
      "Longest one attempt at a case analysis may wait before it fails as CASE_ANALYSIS_TIMEOUT. The computation itself is synchronous and bounded by the case's size, not by this.",
  }),
  REPORT_HANDLING_MARKING: z.string().trim().min(1).max(80).optional().meta({
    description:
      "The handling marking printed on every report page when a tenant has not set its own. Unset: pages say no marking is set. The platform default is undecided.",
  }),

  // No collector credential is ever configured here. Collectors read their
  // credentials only from each tenant's vault, so there is no platform-level
  // fallback for any of them; a test fails if a variable here names a collector
  // source. Platform-owned secrets (the session secret, the vault master key,
  // later the LLM provider's key) do belong here.
});

export type Env = z.infer<typeof envSchema>;

export type EnvSource = Readonly<Record<string, string | undefined>>;

/**
 * Whether collectors whose source licence is UNVERIFIED may run here. An
 * explicit COLLECTORS_ALLOW_UNVERIFIED decides; unset, they run in development
 * and test and are refused in production. BLOCKED sources never run, whatever
 * this says.
 */
export function allowsUnverifiedSources(
  env: Pick<Env, "NODE_ENV" | "COLLECTORS_ALLOW_UNVERIFIED">,
): boolean {
  if (env.COLLECTORS_ALLOW_UNVERIFIED !== undefined) {
    return env.COLLECTORS_ALLOW_UNVERIFIED === "true";
  }
  return env.NODE_ENV !== "production";
}

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

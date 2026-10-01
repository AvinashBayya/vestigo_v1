import { ConfigError, type ConfigIssue } from "./errors.ts";

/**
 * Language-model configuration (CLAUDE.md §4, ARCHITECTURE-DECISIONS §7):
 * which models may be used at all, and the two serving profiles.
 *
 * The allowlist is reviewed code, never an environment variable, so adding a
 * model is a reviewed change. Deployments choose among allowlisted models with
 * LLM_SMALL_MODEL and LLM_LARGE_MODEL, and the endpoint with the LLM_* variables.
 */

/** Licences a model's weights may carry: permissive, commercial use allowed. */
export const PERMITTED_MODEL_LICENCES = ["Apache-2.0", "MIT"] as const;
export type ModelLicence = (typeof PERMITTED_MODEL_LICENCES)[number];

export interface AllowedModel {
  /** The weights' canonical name: their Hugging Face repository id. */
  readonly id: string;
  readonly publisher: string;
  readonly licence: ModelLicence;
  /** The base model the card declares (`base_model`), or null when it declares none. */
  readonly baseModel: string | null;
  /** SMALL serves extraction and classification; LARGE serves synthesis. */
  readonly sizeClass: "SMALL" | "LARGE";
  /** Where the licence and lineage were read, and when. */
  readonly checked: { readonly checkedOn: string; readonly sourceUrl: string };
}

const CHECKED_ON = "2026-09-30";
const card = (id: string) => ({
  checkedOn: CHECKED_ON,
  sourceUrl: `https://huggingface.co/api/models/${id}`,
});

/**
 * Every model the product may call. Licence and base model are as each model's
 * Hugging Face card declared them on the date recorded (cardData.license and
 * the base_model tags). A test refuses any entry that is Llama-derived, a
 * Gemini model, or not permissively licensed.
 */
export const LLM_MODEL_ALLOWLIST: readonly AllowedModel[] = [
  {
    id: "Qwen/Qwen3-8B",
    publisher: "Qwen",
    licence: "Apache-2.0",
    baseModel: "Qwen/Qwen3-8B-Base",
    sizeClass: "SMALL",
    checked: card("Qwen/Qwen3-8B"),
  },
  {
    id: "openai/gpt-oss-20b",
    publisher: "OpenAI",
    licence: "Apache-2.0",
    baseModel: null,
    sizeClass: "SMALL",
    checked: card("openai/gpt-oss-20b"),
  },
  {
    id: "Qwen/Qwen3-32B",
    publisher: "Qwen",
    licence: "Apache-2.0",
    baseModel: null,
    sizeClass: "LARGE",
    checked: card("Qwen/Qwen3-32B"),
  },
  {
    id: "openai/gpt-oss-120b",
    publisher: "OpenAI",
    licence: "Apache-2.0",
    baseModel: null,
    sizeClass: "LARGE",
    checked: card("openai/gpt-oss-120b"),
  },
  {
    id: "mistralai/Mistral-Small-3.1-24B-Instruct-2503",
    publisher: "Mistral AI",
    licence: "Apache-2.0",
    baseModel: "mistralai/Mistral-Small-3.1-24B-Base-2503",
    sizeClass: "LARGE",
    checked: card("mistralai/Mistral-Small-3.1-24B-Instruct-2503"),
  },
];

export const ALLOWED_MODEL_IDS = LLM_MODEL_ALLOWLIST.map((model) => model.id) as [
  string,
  ...string[],
];

/** Model families CLAUDE.md §4 excludes, matched against a model's id and its base model. */
export const FORBIDDEN_MODEL_FAMILIES: readonly {
  readonly pattern: RegExp;
  readonly rule: string;
}[] = [
  { pattern: /llama/i, rule: "Llama-derived models are excluded (CLAUDE.md §4)." },
  { pattern: /gemini/i, rule: "Gemini models are excluded (CLAUDE.md §4)." },
];

/** Endpoint hosts CLAUDE.md §4 excludes: Azure OpenAI. */
export const FORBIDDEN_ENDPOINT_HOSTS: readonly {
  readonly pattern: RegExp;
  readonly rule: string;
}[] = [
  {
    pattern: /(^|\.)(openai\.azure\.com|azure-api\.net|cognitiveservices\.azure\.com)$/i,
    rule: "Azure OpenAI endpoints are excluded (CLAUDE.md §4).",
  },
];

/** Why a model may not be used, or null when it may. */
export function forbiddenModelReason(model: {
  readonly id: string;
  readonly baseModel: string | null;
  readonly licence: string;
}): string | null {
  for (const family of FORBIDDEN_MODEL_FAMILIES) {
    if (family.pattern.test(model.id)) return family.rule;
    if (model.baseModel !== null && family.pattern.test(model.baseModel)) return family.rule;
  }
  if (!(PERMITTED_MODEL_LICENCES as readonly string[]).includes(model.licence)) {
    return `The licence ${model.licence} is not a permitted open-weight licence.`;
  }
  return null;
}

export function allowedModel(id: string): AllowedModel | null {
  return LLM_MODEL_ALLOWLIST.find((model) => model.id === id) ?? null;
}

// ── Profiles ──────────────────────────────────────────────────────────────

export const LLM_PROFILES = ["hosted", "vllm"] as const;
export type LlmProfileName = (typeof LLM_PROFILES)[number];

/** How a provider is asked for structured output. The response is validated either way. */
export const STRUCTURED_OUTPUT_MODES = ["json_schema", "json_object", "none"] as const;
export type StructuredOutputMode = (typeof STRUCTURED_OUTPUT_MODES)[number];

export interface LlmModelRoute {
  readonly model: AllowedModel;
  /** The name the endpoint serves the model under: the id, unless LLM_MODEL_NAMES renames it. */
  readonly servedName: string;
}

export interface LlmEndpoint {
  readonly profile: LlmProfileName;
  /** The OpenAI-compatible base URL, ending before /chat/completions. */
  readonly baseUrl: string;
  readonly apiKey: string | null;
  readonly structuredOutput: StructuredOutputMode;
  readonly timeoutMs: number;
  readonly small: LlmModelRoute;
  readonly large: LlmModelRoute;
}

export type LlmConfiguration =
  | { readonly status: "READY"; readonly endpoint: LlmEndpoint }
  /** No provider is configured: synthesis is unavailable, and says so. */
  | { readonly status: "NOT_CONFIGURED"; readonly reason: string };

/** The LLM_* variables, as the env schema parsed them. */
export interface LlmVariables {
  readonly LLM_PROFILE: LlmProfileName;
  readonly LLM_HOSTED_BASE_URL?: string | undefined;
  readonly LLM_HOSTED_API_KEY?: string | undefined;
  readonly LLM_HOSTED_STRUCTURED_OUTPUT: StructuredOutputMode;
  readonly LLM_VLLM_ENABLED: "true" | "false";
  readonly LLM_VLLM_BASE_URL: string;
  readonly LLM_VLLM_API_KEY?: string | undefined;
  readonly LLM_SMALL_MODEL: string;
  readonly LLM_LARGE_MODEL: string;
  readonly LLM_MODEL_NAMES?: string | undefined;
  readonly LLM_REQUEST_TIMEOUT_MS: number;
}

/** Parses `id=served-name,id=served-name`. Every id must be allowlisted. */
function parseModelNames(raw: string | undefined, issues: ConfigIssue[]): Map<string, string> {
  const names = new Map<string, string>();
  if (raw === undefined) return names;
  for (const pair of raw.split(",")) {
    const separator = pair.indexOf("=");
    const id = pair.slice(0, separator).trim();
    const served = pair.slice(separator + 1).trim();
    if (separator < 1 || served.length === 0) {
      issues.push({ variable: "LLM_MODEL_NAMES", problem: "expected id=served-name pairs" });
      continue;
    }
    if (allowedModel(id) === null) {
      issues.push({ variable: "LLM_MODEL_NAMES", problem: `${id} is not an allowlisted model` });
      continue;
    }
    names.set(id, served);
  }
  return names;
}

function route(
  variable: "LLM_SMALL_MODEL" | "LLM_LARGE_MODEL",
  id: string,
  names: ReadonlyMap<string, string>,
  issues: ConfigIssue[],
): LlmModelRoute | null {
  const model = allowedModel(id);
  if (model === null) {
    issues.push({ variable, problem: `${id} is not an allowlisted model` });
    return null;
  }
  const forbidden = forbiddenModelReason(model);
  if (forbidden !== null) {
    issues.push({ variable, problem: forbidden });
    return null;
  }
  return { model, servedName: names.get(id) ?? model.id };
}

function forbiddenEndpoint(url: string): string | null {
  const host = new URL(url).hostname;
  return FORBIDDEN_ENDPOINT_HOSTS.find((entry) => entry.pattern.test(host))?.rule ?? null;
}

/**
 * The LLM endpoint this deployment uses, or why there is none.
 *
 * The hosted profile is the default. With no hosted base URL set it is
 * NOT_CONFIGURED: report synthesis is then unavailable and says so, while the
 * rest of a report still generates. The vLLM profile is built but DISABLED:
 * selecting it without LLM_VLLM_ENABLED=true is a configuration error, so it
 * is never switched on by accident.
 */
export function resolveLlmConfiguration(env: LlmVariables): LlmConfiguration {
  const issues: ConfigIssue[] = [];
  const names = parseModelNames(env.LLM_MODEL_NAMES, issues);
  const small = route("LLM_SMALL_MODEL", env.LLM_SMALL_MODEL, names, issues);
  const large = route("LLM_LARGE_MODEL", env.LLM_LARGE_MODEL, names, issues);

  let endpoint: Omit<LlmEndpoint, "small" | "large"> | null = null;
  let notConfigured: string | null = null;
  if (env.LLM_PROFILE === "vllm") {
    if (env.LLM_VLLM_ENABLED !== "true") {
      issues.push({
        variable: "LLM_PROFILE",
        problem: "the vllm profile is disabled; set LLM_VLLM_ENABLED=true to use it",
      });
    } else {
      endpoint = {
        profile: "vllm",
        baseUrl: env.LLM_VLLM_BASE_URL.replace(/\/+$/, ""),
        apiKey: env.LLM_VLLM_API_KEY ?? null,
        // vLLM constrains decoding to a JSON schema (guided decoding).
        structuredOutput: "json_schema",
        timeoutMs: env.LLM_REQUEST_TIMEOUT_MS,
      };
    }
  } else if (env.LLM_HOSTED_BASE_URL === undefined) {
    notConfigured = "No hosted LLM provider is configured (LLM_HOSTED_BASE_URL is not set).";
  } else if (env.LLM_HOSTED_API_KEY === undefined) {
    issues.push({
      variable: "LLM_HOSTED_API_KEY",
      problem: "required when LLM_HOSTED_BASE_URL is set",
    });
  } else {
    const rule = forbiddenEndpoint(env.LLM_HOSTED_BASE_URL);
    if (rule !== null) {
      issues.push({ variable: "LLM_HOSTED_BASE_URL", problem: rule });
    } else {
      endpoint = {
        profile: "hosted",
        baseUrl: env.LLM_HOSTED_BASE_URL.replace(/\/+$/, ""),
        apiKey: env.LLM_HOSTED_API_KEY,
        structuredOutput: env.LLM_HOSTED_STRUCTURED_OUTPUT,
        timeoutMs: env.LLM_REQUEST_TIMEOUT_MS,
      };
    }
  }

  if (issues.length > 0) throw new ConfigError(issues);
  if (notConfigured !== null) return { status: "NOT_CONFIGURED", reason: notConfigured };
  if (endpoint === null || small === null || large === null) {
    // Every path that leaves one of these null pushed an issue above.
    throw new ConfigError([{ variable: "LLM_PROFILE", problem: "could not be resolved" }]);
  }
  return { status: "READY", endpoint: { ...endpoint, small, large } };
}

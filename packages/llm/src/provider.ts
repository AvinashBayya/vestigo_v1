/**
 * The provider interface, and its one implementation: the OpenAI-compatible
 * chat completions wire format, which both profiles speak (a hosted
 * open-weight API, and self-hosted vLLM). Switching profiles is configuration
 * (@repo/config resolveLlmConfiguration), never code.
 *
 * Ported from the previous codebase's llm.ts (INVENTORY: ADAPT). Kept: the
 * refusal to return truncated or empty output, the reasoning-model budget
 * diagnosis, retrying only transient failures. Changed: the endpoint and key
 * are injected rather than read from the environment; the per-process cache
 * and call log are gone (the cache is Redis, ./cache.ts; usage is metered per
 * tenant, ./metering.ts); a response without token usage is refused, because
 * an unmetered call cannot be charged honestly; an error carries only what
 * ./endpoint-error.ts keeps of the provider's error body (never an echo of
 * the prompt, never the key), so a refusal names its cause.
 */
import type { LlmEndpoint, StructuredOutputMode } from "@repo/config";
import { z } from "zod";
import { endpointErrorDetail, readBounded, saidSuffix } from "./endpoint-error.ts";
import { LlmRequestRejectedError, LlmResponseInvalidError, LlmUnavailableError } from "./errors.ts";

export interface ChatMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

export interface CompletionRequest {
  /** The name the endpoint serves the model under. */
  readonly model: string;
  readonly messages: readonly ChatMessage[];
  readonly maxTokens: number;
  readonly temperature: number;
  /** The JSON schema the answer must match, for providers that constrain decoding to one. */
  readonly responseSchema: { readonly name: string; readonly schema: object } | null;
}

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/** A response header, exactly as received (HTTP lower-cases its name). Never interpreted. */
export interface RegionHeader {
  readonly name: string;
  readonly value: string;
}

/**
 * Where one call went and what the endpoint said about who processed it
 * (residency, docs/PLAN.md Phase 5). Every field is either configuration or
 * the endpoint's own words; nothing is inferred from them.
 */
export interface CallProvenance {
  /** The configured endpoint's host (e.g. "api.groq.com"): where the request was sent. */
  readonly endpointHost: string;
  /**
   * The upstream inference provider the endpoint named (see servedByOf). Null
   * when it named none, as a direct provider or a self-hosted server does.
   */
  readonly servedBy: string | null;
  /** Every region header the response carried, raw (see regionHeadersOf). Empty when none. */
  readonly regionHeaders: readonly RegionHeader[];
}

export interface CompletionResult {
  readonly text: string;
  readonly usage: TokenUsage;
  readonly provenance: CallProvenance;
}

export interface LlmProvider {
  readonly profile: string;
  complete(request: CompletionRequest, signal?: AbortSignal): Promise<CompletionResult>;
}

const ChatResponse = z.looseObject({
  choices: z
    .array(
      z.looseObject({
        message: z.looseObject({
          content: z.string().nullish(),
          reasoning_content: z.string().nullish(),
          reasoning: z.string().nullish(),
        }),
        finish_reason: z.string().nullish(),
      }),
    )
    .min(1),
  usage: z
    .looseObject({
      prompt_tokens: z.number().int().min(0),
      completion_tokens: z.number().int().min(0),
    })
    .nullish(),
});

/**
 * The response header a routing endpoint names its upstream provider in.
 * Hugging Face Inference Providers sends it (observed 2026-10-01: e.g.
 * `x-inference-provider: cerebras`). Residency depends on it: a router may
 * send each request to a different third party (docs/PLAN.md, Phase 5).
 */
export const SERVED_BY_HEADER = "x-inference-provider";

const PROVIDER_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

/** The provider a response names, or null when it names none or names it unreadably. */
export function servedByOf(headers: Headers): string | null {
  const value = headers.get(SERVED_BY_HEADER)?.trim() ?? null;
  return value !== null && PROVIDER_NAME.test(value) ? value.toLowerCase() : null;
}

/** At most this many region headers are kept from one response. */
const MAX_REGION_HEADERS = 8;
const MAX_REGION_VALUE = 200;
/** Visible ASCII and spaces only: a value that is not is skipped, never altered. */
const PRINTABLE = /^[\x20-\x7e]+$/;

/**
 * Every response header whose name contains "region", as received: e.g.
 * Groq's `x-groq-region` (observed 2026-10-01). The value is evidence of what
 * the endpoint said, never a residency guarantee, and is stored and printed
 * exactly as sent: no code maps a region value to a place. A value that is
 * not printable ASCII, or longer than MAX_REGION_VALUE, is skipped rather than
 * altered.
 */
export function regionHeadersOf(headers: Headers): RegionHeader[] {
  const found: RegionHeader[] = [];
  for (const [name, value] of headers) {
    if (!name.includes("region")) continue;
    if (value.length > MAX_REGION_VALUE || !PRINTABLE.test(value)) continue;
    found.push({ name, value });
    if (found.length === MAX_REGION_HEADERS) break;
  }
  return found;
}

/** The host a configured base URL sends requests to (no scheme, path or credentials). */
export function endpointHostOf(baseUrl: string): string {
  return new URL(baseUrl).host;
}

/** Retry-After as milliseconds: delta-seconds or an HTTP date. Null when absent or unreadable. */
function retryAfterMs(header: string | null, now: number): number | null {
  if (header === null) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

function responseFormat(mode: StructuredOutputMode, request: CompletionRequest): object | null {
  if (mode === "none") return null;
  if (mode === "json_object" || request.responseSchema === null) return { type: "json_object" };
  return {
    type: "json_schema",
    json_schema: {
      name: request.responseSchema.name,
      schema: request.responseSchema.schema,
      strict: true,
    },
  };
}

export class OpenAiCompatibleProvider implements LlmProvider {
  readonly profile: string;
  readonly #baseUrl: string;
  readonly #endpointHost: string;
  readonly #apiKey: string | null;
  readonly #timeoutMs: number;
  readonly #structuredOutput: StructuredOutputMode;
  readonly #fetch: typeof fetch;

  constructor(
    endpoint: Pick<
      LlmEndpoint,
      "profile" | "baseUrl" | "apiKey" | "timeoutMs" | "structuredOutput"
    >,
    options: { readonly fetch?: typeof fetch } = {},
  ) {
    this.profile = endpoint.profile;
    this.#baseUrl = endpoint.baseUrl;
    this.#endpointHost = endpointHostOf(endpoint.baseUrl);
    this.#apiKey = endpoint.apiKey;
    this.#timeoutMs = endpoint.timeoutMs;
    this.#structuredOutput = endpoint.structuredOutput;
    this.#fetch = options.fetch ?? fetch;
  }

  async complete(request: CompletionRequest, signal?: AbortSignal): Promise<CompletionResult> {
    const format = responseFormat(this.#structuredOutput, request);
    const body = {
      model: request.model,
      messages: request.messages,
      max_tokens: request.maxTokens,
      temperature: request.temperature,
      ...(format === null ? {} : { response_format: format }),
    };
    // Every call is bounded: the configured timeout, and the caller's own signal.
    const timeout = AbortSignal.timeout(this.#timeoutMs);
    const combined = signal === undefined ? timeout : AbortSignal.any([timeout, signal]);

    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.#apiKey === null ? {} : { authorization: `Bearer ${this.#apiKey}` }),
        },
        body: JSON.stringify(body),
        signal: combined,
      });
    } catch (error) {
      const timedOut = timeout.aborted;
      throw new LlmUnavailableError(
        timedOut
          ? `The ${this.profile} model endpoint did not answer within ${String(this.#timeoutMs)} ms.`
          : `The ${this.profile} model endpoint could not be reached (${error instanceof Error ? error.name : "unknown error"}).`,
      );
    }

    if (!response.ok) {
      // The body is read narrowly (./endpoint-error.ts): a provider's error can
      // echo the prompt or the key, so only a cleaned, non-echoing message is kept.
      const status = response.status;
      const endpoint = endpointErrorDetail(
        await readBounded(response),
        request.messages.map((message) => message.content).join("\n"),
        this.#apiKey,
      );
      if (status === 429 || status >= 500) {
        throw new LlmUnavailableError(
          `The ${this.profile} model endpoint answered HTTP ${String(status)}.${saidSuffix(endpoint)}`,
          {
            status,
            retryAfterMs: retryAfterMs(response.headers.get("retry-after"), Date.now()),
            endpoint,
          },
        );
      }
      throw new LlmRequestRejectedError(
        `The ${this.profile} model endpoint refused the request with HTTP ${String(status)}.${saidSuffix(endpoint)}`,
        status,
        endpoint,
      );
    }

    let parsed: z.infer<typeof ChatResponse>;
    try {
      parsed = ChatResponse.parse(await response.json());
    } catch {
      throw new LlmResponseInvalidError(
        `The ${this.profile} model endpoint answered with something other than a chat completion.`,
      );
    }
    const [choice] = parsed.choices;
    if (choice === undefined) {
      throw new LlmResponseInvalidError("The model endpoint returned no choices.");
    }
    if (parsed.usage === null || parsed.usage === undefined) {
      // An unmetered call cannot be charged to the tenant honestly (CLAUDE.md §4).
      throw new LlmResponseInvalidError(
        "The model endpoint returned no token usage, so the call cannot be metered.",
      );
    }
    const usage: TokenUsage = {
      inputTokens: parsed.usage.prompt_tokens,
      outputTokens: parsed.usage.completion_tokens,
    };
    const provenance: CallProvenance = {
      endpointHost: this.#endpointHost,
      servedBy: servedByOf(response.headers),
      regionHeaders: regionHeadersOf(response.headers),
    };
    const text = choice.message.content;
    if (typeof text !== "string" || text.trim().length === 0) {
      // Reasoning models bill their thinking against max_tokens; a budget
      // sized for the answer alone ends in "length" with no content.
      throw new MeteredResponseError(
        choice.finish_reason === "length"
          ? "The model spent its token budget reasoning and produced no answer."
          : `The model returned no content (finish reason: ${choice.finish_reason ?? "none given"}).`,
        usage,
        provenance,
      );
    }
    if (choice.finish_reason === "length") {
      // A truncated answer is not a usable answer: a JSON object missing its
      // closing brace, or a statement cut mid-sentence, must fail loudly.
      throw new MeteredResponseError(
        "The model's answer was cut off at the token limit.",
        usage,
        provenance,
      );
    }
    return { text, usage, provenance };
  }
}

/**
 * An unusable response that still consumed tokens. It carries the usage and
 * where the call went, so the caller can meter it before treating the call
 * as failed.
 */
export class MeteredResponseError extends LlmResponseInvalidError {
  readonly usage: TokenUsage;
  readonly provenance: CallProvenance;

  constructor(message: string, usage: TokenUsage, provenance: CallProvenance) {
    super(message);
    this.name = "MeteredResponseError";
    this.usage = usage;
    this.provenance = provenance;
  }
}

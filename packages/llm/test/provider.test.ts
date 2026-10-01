/**
 * The provider speaks the OpenAI-compatible wire format both profiles serve.
 * No test here reaches a network: `fetch` is a scripted double. The vLLM
 * answer below is SYNTHETIC, written to vLLM's documented OpenAI-compatible
 * chat completion shape (choices[].message.content, finish_reason, usage);
 * no vLLM server was run to record it (the profile is disabled).
 */
import { describe, expect, it } from "vitest";
import {
  endpointHostOf,
  ERROR_BODY_LIMIT,
  LlmRequestRejectedError,
  LlmResponseInvalidError,
  LlmUnavailableError,
  MESSAGE_LIMIT,
  MeteredResponseError,
  OpenAiCompatibleProvider,
  readBounded,
  regionHeadersOf,
  servedByOf,
  type CompletionRequest,
} from "../src/index.ts";

interface Sent {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: Record<string, unknown>;
}

function scripted(respond: () => Response | Promise<Response>): {
  fetch: typeof fetch;
  sent: Sent[];
} {
  const sent: Sent[] = [];
  const fake = (async (input: string | URL | Request, init?: RequestInit) => {
    sent.push({
      url: input instanceof Request ? input.url : input.toString(),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<
        string,
        unknown
      >,
    });
    return respond();
  }) as typeof fetch;
  return { fetch: fake, sent };
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });

const ANSWER = {
  id: "[completion id]",
  object: "chat.completion",
  model: "Qwen/Qwen3-32B",
  choices: [
    {
      index: 0,
      message: { role: "assistant", content: '{"statements":[]}' },
      finish_reason: "stop",
    },
  ],
  usage: { prompt_tokens: 812, completion_tokens: 37, total_tokens: 849 },
};

const REQUEST: CompletionRequest = {
  model: "Qwen/Qwen3-32B",
  messages: [
    { role: "system", content: "[instructions]" },
    { role: "user", content: "[task and data]" },
  ],
  maxTokens: 400,
  temperature: 0,
  responseSchema: { name: "answer", schema: { type: "object" } },
};

const HOSTED = {
  profile: "hosted" as const,
  baseUrl: "https://llm-provider.invalid/v1",
  apiKey: "[platform key]",
  timeoutMs: 5_000,
  structuredOutput: "none" as const,
};

const VLLM = {
  profile: "vllm" as const,
  baseUrl: "http://127.0.0.1:8000/v1",
  apiKey: null,
  timeoutMs: 5_000,
  structuredOutput: "json_schema" as const,
};

describe("the OpenAI-compatible provider", () => {
  it("posts the chat completion request and returns text with measured usage", async () => {
    const { fetch, sent } = scripted(() => json(ANSWER));
    const provider = new OpenAiCompatibleProvider(HOSTED, { fetch });
    const result = await provider.complete(REQUEST);
    expect(result).toEqual({
      text: '{"statements":[]}',
      usage: { inputTokens: 812, outputTokens: 37 },
      // Sent to the configured host; the answer names no upstream provider and no region.
      provenance: { endpointHost: "llm-provider.invalid", servedBy: null, regionHeaders: [] },
    });
    expect(sent[0]?.url).toBe("https://llm-provider.invalid/v1/chat/completions");
    expect(sent[0]?.headers.authorization).toBe("Bearer [platform key]");
    expect(sent[0]?.body).toEqual({
      model: "Qwen/Qwen3-32B",
      messages: REQUEST.messages,
      max_tokens: 400,
      temperature: 0,
    });
  });

  it("records the upstream provider a routing endpoint names in x-inference-provider", async () => {
    const { fetch } = scripted(() =>
      json(ANSWER, { headers: { "x-inference-provider": "Example-Provider" } }),
    );
    const result = await new OpenAiCompatibleProvider(HOSTED, { fetch }).complete(REQUEST);
    expect(result.provenance.servedBy).toBe("example-provider");
  });

  it("records a direct endpoint's host and its region header raw, interpreting nothing", async () => {
    // The headers Groq answered with on 2026-10-01: a region header, no provider header.
    const { fetch } = scripted(() => json(ANSWER, { headers: { "x-groq-region": "bom" } }));
    const result = await new OpenAiCompatibleProvider(
      { ...HOSTED, baseUrl: "https://api.groq.com/openai/v1" },
      { fetch },
    ).complete(REQUEST);
    expect(result.provenance).toEqual({
      endpointHost: "api.groq.com",
      servedBy: null,
      regionHeaders: [{ name: "x-groq-region", value: "bom" }],
    });
  });

  it("keeps every region header exactly as sent, skipping rather than altering an unprintable one", () => {
    const headers = new Headers({
      "X-Example-Region": "[Region Value] 1",
      "x-other-region": "[other]",
      "x-unprintable-region": "[value]é",
      "x-oversized-region": "r".repeat(201),
      "x-request-id": "[not a region header]",
    });
    expect(regionHeadersOf(headers)).toEqual([
      { name: "x-example-region", value: "[Region Value] 1" },
      { name: "x-other-region", value: "[other]" },
    ]);
    expect(regionHeadersOf(new Headers())).toEqual([]);
  });

  it("takes the endpoint host from configuration, never with credentials or path", () => {
    expect(endpointHostOf("https://api.groq.com/openai/v1")).toBe("api.groq.com");
    expect(endpointHostOf("http://127.0.0.1:8000/v1")).toBe("127.0.0.1:8000");
    expect(endpointHostOf("https://user:secret@llm-provider.invalid/v1")).toBe(
      "llm-provider.invalid",
    );
  });

  it("records no provider when the header is absent or unreadable", () => {
    expect(servedByOf(new Headers())).toBeNull();
    expect(servedByOf(new Headers({ "x-inference-provider": "" }))).toBeNull();
    expect(servedByOf(new Headers({ "x-inference-provider": "two words" }))).toBeNull();
    expect(servedByOf(new Headers({ "x-inference-provider": "a".repeat(65) }))).toBeNull();
    expect(servedByOf(new Headers({ "x-inference-provider": " example-provider " }))).toBe(
      "example-provider",
    );
  });

  it("asks vLLM to constrain decoding to the answer's JSON schema, and sends no key when none is set", async () => {
    const { fetch, sent } = scripted(() => json(ANSWER));
    await new OpenAiCompatibleProvider(VLLM, { fetch }).complete(REQUEST);
    expect(sent[0]?.url).toBe("http://127.0.0.1:8000/v1/chat/completions");
    expect(sent[0]?.headers.authorization).toBeUndefined();
    expect(sent[0]?.body.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "answer", schema: { type: "object" }, strict: true },
    });
  });

  it("asks for a JSON object when the hosted provider supports only that", async () => {
    const { fetch, sent } = scripted(() => json(ANSWER));
    await new OpenAiCompatibleProvider(
      { ...HOSTED, structuredOutput: "json_object" },
      { fetch },
    ).complete(REQUEST);
    expect(sent[0]?.body.response_format).toEqual({ type: "json_object" });
  });

  it("treats a rate limit as unavailable, carrying the provider's Retry-After", async () => {
    const { fetch } = scripted(
      () => new Response("[busy]", { status: 429, headers: { "retry-after": "7" } }),
    );
    const error = await new OpenAiCompatibleProvider(HOSTED, { fetch })
      .complete(REQUEST)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LlmUnavailableError);
    expect(error).toMatchObject({ status: 429, retryAfterMs: 7000 });
  });

  it("treats a 5xx as unavailable and a 4xx as a refusal that is not retried", async () => {
    const down = scripted(() => new Response("[down]", { status: 503 }));
    await expect(
      new OpenAiCompatibleProvider(HOSTED, { fetch: down.fetch }).complete(REQUEST),
    ).rejects.toBeInstanceOf(LlmUnavailableError);
    const refused = scripted(() => new Response("[bad key]", { status: 401 }));
    await expect(
      new OpenAiCompatibleProvider(HOSTED, { fetch: refused.fetch }).complete(REQUEST),
    ).rejects.toBeInstanceOf(LlmRequestRejectedError);
  });

  describe("an endpoint's error body", () => {
    const refusal = async (
      response: () => Response,
      request: CompletionRequest = REQUEST,
    ): Promise<LlmRequestRejectedError | LlmUnavailableError> => {
      const { fetch } = scripted(response);
      return (await new OpenAiCompatibleProvider(HOSTED, { fetch })
        .complete(request)
        .catch((e: unknown) => e)) as LlmRequestRejectedError | LlmUnavailableError;
    };
    // The request carries collected text, as a synthesis prompt does.
    const WITH_DATA: CompletionRequest = {
      ...REQUEST,
      messages: [
        { role: "system", content: "[instructions]" },
        {
          role: "user",
          content: "[task] <untrusted_data> [private collected text about the target person]",
        },
      ],
    };

    it("names the cause of an out-of-credit refusal, and is still not retried", async () => {
      // The Hugging Face router's 402 body, as observed on 2026-10-01.
      const error = await refusal(() =>
        json(
          {
            error:
              "You have depleted your monthly included credits. Purchase pre-paid credits to continue using Inference Providers. Alternatively, subscribe to PRO to get 20x more included usage.",
          },
          { status: 402 },
        ),
      );
      expect(error).toBeInstanceOf(LlmRequestRejectedError);
      expect(error).toMatchObject({ code: "LLM_REQUEST_REJECTED", status: 402 });
      expect(error.message).toBe(
        'The hosted model endpoint refused the request with HTTP 402. The endpoint said: "You have depleted your monthly included credits. Purchase pre-paid credits to continue using Inference Providers. Alternatively, subscribe to PRO to get 20x more included usage.".',
      );
      expect(error.endpoint.message).toMatch(/^You have depleted/);
    });

    it("carries an OpenAI-shaped error's message and code, keeping a rate limit retryable", async () => {
      const error = await refusal(() =>
        json(
          { error: { message: "[limit reached]", type: "tokens", code: "example_code" } },
          { status: 429, headers: { "retry-after": "3" } },
        ),
      );
      expect(error).toBeInstanceOf(LlmUnavailableError);
      expect(error).toMatchObject({
        retryAfterMs: 3000,
        endpoint: { code: "example_code", message: "[limit reached]" },
      });
      expect(error.message).toContain('The endpoint said: "[limit reached]" (code example_code).');
    });

    it("REGRESSION: never repeats a message that echoes the prompt, keeping only the code", async () => {
      const error = await refusal(
        () =>
          json(
            {
              error: {
                message: "cannot process: private collected text about the target person",
                code: "invalid_request",
              },
            },
            { status: 400 },
          ),
        WITH_DATA,
      );
      expect(error.message).not.toContain("private collected text");
      expect(error.message).toBe(
        "The hosted model endpoint refused the request with HTTP 400. The endpoint's error code: invalid_request.",
      );
      expect(error.endpoint).toEqual({ code: "invalid_request", message: null });
    });

    it("drops a short message that repeats a phrase of the prompt whole", async () => {
      const error = await refusal(
        () => json({ error: "[private collected text]" }, { status: 400 }),
        WITH_DATA,
      );
      expect(error.message).not.toContain("private collected text");
      expect(error.endpoint.message).toBeNull();
    });

    it("redacts the key and anything shaped like a key or token", async () => {
      const error = await refusal(() =>
        json(
          {
            error: {
              message: "Invalid API key [platform key]; also rejected gsk_0123456789abcdef",
            },
          },
          { status: 401 },
        ),
      );
      expect(error.message).not.toContain("[platform key]");
      expect(error.message).not.toContain("gsk_0123456789abcdef");
      expect(error.endpoint.message).toBe("Invalid API key [redacted]; also rejected [redacted]");
    });

    it("ignores a body that is not a JSON error: plain text and HTML say nothing", async () => {
      for (const body of ["[prompt echo: private collected text]", "<html>[proxy page]</html>"]) {
        const error = await refusal(() => new Response(body, { status: 400 }));
        expect(error.message).toBe("The hosted model endpoint refused the request with HTTP 400.");
        expect(error.endpoint).toEqual({ code: null, message: null });
      }
    });

    it("reads a bounded amount of the body and cuts a long message, stripping control characters", async () => {
      expect(await readBounded(new Response("x".repeat(ERROR_BODY_LIMIT * 4)))).toHaveLength(
        ERROR_BODY_LIMIT,
      );
      const huge = await refusal(() =>
        json({ error: "x ".repeat(ERROR_BODY_LIMIT) }, { status: 400 }),
      );
      // Cut short, the JSON no longer parses: nothing is said rather than a fragment.
      expect(huge.endpoint.message).toBeNull();
      const long = await refusal(() =>
        json({ error: `line one\u0000\nline two ${"word ".repeat(200)}` }, { status: 400 }),
      );
      expect(long.endpoint.message?.startsWith("line one line two word")).toBe(true);
      expect(long.endpoint.message?.endsWith(" [cut]")).toBe(true);
      expect(long.endpoint.message?.length).toBe(MESSAGE_LIMIT + " [cut]".length);
    });
  });

  it("gives up at its timeout: no call waits indefinitely", async () => {
    const { fetch } = scripted(
      () =>
        new Promise<Response>(() => {
          /* never answers */
        }),
    );
    const hanging = (async (input: string | URL | Request, init?: RequestInit) => {
      const pending = fetch(input, init);
      return Promise.race([
        pending,
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(init.signal?.reason as Error);
          });
        }),
      ]);
    }) as typeof fetch;
    const started = Date.now();
    const error = await new OpenAiCompatibleProvider(
      { ...HOSTED, timeoutMs: 200 },
      { fetch: hanging },
    )
      .complete(REQUEST)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LlmUnavailableError);
    expect((error as Error).message).toMatch(/did not answer within 200 ms/);
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it("refuses an answer with no token usage: an unmetered call cannot be charged", async () => {
    const { fetch } = scripted(() => json({ ...ANSWER, usage: undefined }));
    await expect(
      new OpenAiCompatibleProvider(HOSTED, { fetch }).complete(REQUEST),
    ).rejects.toBeInstanceOf(LlmResponseInvalidError);
  });

  it("refuses a truncated answer, but reports the tokens it consumed", async () => {
    const { fetch } = scripted(() =>
      json(
        {
          ...ANSWER,
          choices: [{ index: 0, message: { content: '{"statements":[' }, finish_reason: "length" }],
        },
        { headers: { "x-inference-provider": "example-provider" } },
      ),
    );
    const error = await new OpenAiCompatibleProvider(HOSTED, { fetch })
      .complete(REQUEST)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MeteredResponseError);
    expect((error as MeteredResponseError).usage).toEqual({ inputTokens: 812, outputTokens: 37 });
    // The tokens were spent somewhere: the error names where.
    expect((error as MeteredResponseError).provenance.servedBy).toBe("example-provider");
  });

  it("diagnoses a reasoning model that spent its budget thinking", async () => {
    const { fetch } = scripted(() =>
      json({
        ...ANSWER,
        choices: [
          {
            index: 0,
            message: { content: null, reasoning_content: "[reasoning]" },
            finish_reason: "length",
          },
        ],
      }),
    );
    await expect(new OpenAiCompatibleProvider(HOSTED, { fetch }).complete(REQUEST)).rejects.toThrow(
      /spent its token budget reasoning/,
    );
  });

  it("refuses something that is not a chat completion", async () => {
    const { fetch } = scripted(() => json({ unexpected: true }));
    await expect(
      new OpenAiCompatibleProvider(HOSTED, { fetch }).complete(REQUEST),
    ).rejects.toBeInstanceOf(LlmResponseInvalidError);
  });
});

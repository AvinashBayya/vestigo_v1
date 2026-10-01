/**
 * The provider speaks the OpenAI-compatible wire format both profiles serve.
 * No test here reaches a network: `fetch` is a scripted double. The vLLM
 * answer below is SYNTHETIC, written to vLLM's documented OpenAI-compatible
 * chat completion shape (choices[].message.content, finish_reason, usage);
 * no vLLM server was run to record it (the profile is disabled).
 */
import { describe, expect, it } from "vitest";
import {
  LlmRequestRejectedError,
  LlmResponseInvalidError,
  LlmUnavailableError,
  MeteredResponseError,
  OpenAiCompatibleProvider,
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

  it("never carries the provider's error body, which can echo the prompt", async () => {
    const { fetch } = scripted(
      () => new Response("[prompt echo: private collected text]", { status: 400 }),
    );
    const error = await new OpenAiCompatibleProvider(HOSTED, { fetch })
      .complete(REQUEST)
      .catch((e: unknown) => e);
    expect((error as Error).message).not.toContain("private collected text");
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
      json({
        ...ANSWER,
        choices: [{ index: 0, message: { content: '{"statements":[' }, finish_reason: "length" }],
      }),
    );
    const error = await new OpenAiCompatibleProvider(HOSTED, { fetch })
      .complete(REQUEST)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MeteredResponseError);
    expect((error as MeteredResponseError).usage).toEqual({ inputTokens: 812, outputTokens: 37 });
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

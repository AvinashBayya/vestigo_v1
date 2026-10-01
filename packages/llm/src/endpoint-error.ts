/**
 * What a model endpoint said when it refused or could not answer a request,
 * so a failure names its cause ("monthly included credits depleted") rather
 * than a bare status. The endpoint's words reach the error message, and from
 * there the report's stored error, which the tenant reads.
 *
 * The body is untrusted and handled narrowly, because a provider's error can
 * echo the prompt (collected content) or part of the API key:
 *   - at most ERROR_BODY_LIMIT bytes are read; the rest is discarded unread;
 *   - only a JSON body in a known error shape is used. Plain text and HTML
 *     (proxy pages, stack traces) are dropped;
 *   - the message is dropped if it repeats any run of ECHO_WORDS words from
 *     the request: an echoed prompt never reaches the error;
 *   - the key, and anything shaped like a key or token, is redacted;
 *   - control characters are removed and the message is cut at
 *     MESSAGE_LIMIT characters, marked as cut.
 * What survives is attributed to the endpoint in the message, never presented
 * as the platform's own diagnosis.
 */
import { z } from "zod";
import type { EndpointErrorDetail } from "./errors.ts";

export const ERROR_BODY_LIMIT = 8 * 1024;
export const MESSAGE_LIMIT = 300;
const ECHO_WORDS = 5;

/** OpenAI-compatible: {"error": {"message", "type", "code"}} (Groq, vLLM, most hosts). */
const ObjectError = z.looseObject({
  error: z.looseObject({
    message: z.string().nullish(),
    type: z.string().nullish(),
    code: z.union([z.string(), z.number()]).nullish(),
  }),
});
/** {"error": "..."}: the Hugging Face router (observed 2026-10-01 on HTTP 402). */
const StringError = z.looseObject({ error: z.string() });
const MessageError = z.looseObject({ message: z.string() });
const DetailError = z.looseObject({ detail: z.string() });

const CODE = /^[a-z0-9][a-z0-9_.:-]{0,63}$/i;

/** Token-shaped strings: provider key prefixes, and any long unbroken run of key characters. */
const SECRET_SHAPES: readonly RegExp[] = [
  /\b(?:sk|gsk|hf|pk|rk|xai|key)[-_][A-Za-z0-9*._-]{6,}/gi,
  /\b[A-Za-z0-9_-]{32,}\b/g,
];

const words = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

function runs(tokens: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + ECHO_WORDS <= tokens.length; i += 1) {
    out.add(tokens.slice(i, i + ECHO_WORDS).join(" "));
  }
  return out;
}

/** Reads at most `limit` bytes of a body as text, discarding the rest. Null when it cannot be read. */
export async function readBounded(
  response: Response,
  limit = ERROR_BODY_LIMIT,
): Promise<string | null> {
  const reader: ReadableStreamDefaultReader<Uint8Array> | undefined = response.body?.getReader();
  if (reader === undefined) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < limit) {
      const next = await reader.read();
      if (next.done) break;
      chunks.push(next.value);
      size += next.value.byteLength;
    }
  } catch {
    return null;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(Math.min(size, limit));
  let offset = 0;
  for (const chunk of chunks) {
    const part = chunk.subarray(0, bytes.byteLength - offset);
    bytes.set(part, offset);
    offset += part.byteLength;
    if (offset >= bytes.byteLength) break;
  }
  return new TextDecoder().decode(bytes);
}

function redact(text: string, apiKey: string | null): string {
  let out = apiKey !== null && apiKey.length >= 8 ? text.split(apiKey).join("[redacted]") : text;
  for (const shape of SECRET_SHAPES) out = out.replace(shape, "[redacted]");
  return out;
}

/**
 * The endpoint's error code and message from a body, under the rules above.
 * `requestText` is everything the request sent (its messages), for the echo check.
 */
export function endpointErrorDetail(
  body: string | null,
  requestText: string,
  apiKey: string | null,
): EndpointErrorDetail {
  const none: EndpointErrorDetail = { code: null, message: null };
  if (body === null) return none;
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return none;
  }
  let rawMessage: string | null;
  let rawCode: string | number | null = null;
  const object = ObjectError.safeParse(json);
  if (object.success) {
    rawMessage = object.data.error.message ?? null;
    rawCode = object.data.error.code ?? object.data.error.type ?? null;
  } else {
    const string = StringError.safeParse(json);
    const message = MessageError.safeParse(json);
    const detail = DetailError.safeParse(json);
    if (string.success) rawMessage = string.data.error;
    else if (message.success) rawMessage = message.data.message;
    else if (detail.success) rawMessage = detail.data.detail;
    else return none;
  }

  const code = rawCode === null ? null : String(rawCode);
  return {
    code: code !== null && CODE.test(code) ? code : null,
    message: rawMessage === null ? null : cleanMessage(rawMessage, requestText, apiKey),
  };
}

function cleanMessage(raw: string, requestText: string, apiKey: string | null): string | null {
  // Control characters (C0, DEL, C1) become spaces; whitespace collapses.
  // eslint-disable-next-line no-control-regex -- removing control characters is the point
  const text = redact(raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, " "), apiKey)
    .replace(/\s+/g, " ")
    .trim();
  if (text.length === 0) return null;
  const saidWords = words(text);
  const sentWords = words(requestText);
  if (saidWords.length >= ECHO_WORDS) {
    const sent = runs(sentWords);
    for (const run of runs(saidWords)) if (sent.has(run)) return null;
  } else if (
    saidWords.length >= 2 &&
    ` ${sentWords.join(" ")} `.includes(` ${saidWords.join(" ")} `)
  ) {
    // Too short for a run, but repeated whole: still an echo.
    return null;
  }
  return text.length > MESSAGE_LIMIT ? `${text.slice(0, MESSAGE_LIMIT)} [cut]` : text;
}

/** What the endpoint said, to append to an error message; "" when it said nothing usable. */
export function saidSuffix(detail: EndpointErrorDetail): string {
  if (detail.message !== null && detail.code !== null) {
    return ` The endpoint said: "${detail.message}" (code ${detail.code}).`;
  }
  if (detail.message !== null) return ` The endpoint said: "${detail.message}".`;
  if (detail.code !== null) return ` The endpoint's error code: ${detail.code}.`;
  return "";
}

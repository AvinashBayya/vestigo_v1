import { UpstreamResponseError } from "../errors.ts";

/**
 * A response exactly as an upstream sent it, recorded by the fetcher. Only
 * the fetcher creates these, so a collector can cite as evidence only what
 * an upstream really returned to this run, and cannot alter it: `body` is a
 * fresh copy each time, and the stored payload is the fetcher's own.
 */
export interface CapturedResponse {
  /** The final URL after redirects, with any credential value redacted. */
  readonly url: string;
  readonly status: number;
  /** Lower-cased names; `set-cookie` is dropped. */
  readonly headers: Readonly<Record<string, string>>;
  /** A copy of the body. */
  readonly body: Uint8Array;
  /** When the last byte arrived, measured by the fetcher. */
  readonly receivedAt: Date;
  /** The body as UTF-8 text. */
  text(): string;
  /** The body parsed as JSON; throws UpstreamResponseError if it is not JSON. */
  json(): unknown;
}

interface CaptureRecord {
  readonly run: symbol;
  readonly payload: Uint8Array;
}

const CAPTURED = new WeakMap<object, CaptureRecord>();

export function captureResponse(
  run: symbol,
  fields: {
    readonly url: string;
    readonly status: number;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: Uint8Array;
    readonly receivedAt: Date;
  },
): CapturedResponse {
  const payload = Uint8Array.from(fields.body);
  const headers = Object.freeze({ ...fields.headers });
  const response: CapturedResponse = Object.freeze({
    url: fields.url,
    status: fields.status,
    headers,
    get body() {
      return Uint8Array.from(payload);
    },
    receivedAt: new Date(fields.receivedAt.getTime()),
    text: () => new TextDecoder("utf-8").decode(payload),
    json: (): unknown => {
      try {
        return JSON.parse(new TextDecoder("utf-8").decode(payload)) as unknown;
      } catch {
        throw new UpstreamResponseError("the body is not valid JSON");
      }
    },
  });
  CAPTURED.set(response, { run, payload });
  return response;
}

/** The run that captured this response, or null if the fetcher did not create it. */
export function capturingRun(response: unknown): symbol | null {
  if (typeof response !== "object" || response === null) return null;
  return CAPTURED.get(response)?.run ?? null;
}

/** The exact bytes the upstream sent, for storing as evidence. Null if not a captured response. */
export function capturedPayload(response: unknown): Uint8Array | null {
  if (typeof response !== "object" || response === null) return null;
  const record = CAPTURED.get(response);
  return record === undefined ? null : Uint8Array.from(record.payload);
}

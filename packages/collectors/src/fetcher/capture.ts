import { UpstreamResponseError } from "../errors.ts";

/**
 * A response exactly as an upstream sent it, recorded by the fetcher. Only
 * the fetcher creates these, so a collector can cite as evidence only what
 * an upstream really returned to this run, and cannot alter it: `body` is a
 * fresh copy each time, and the stored payload is the fetcher's own.
 */
export interface CapturedResponse {
  readonly kind: "NETWORK";
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

/**
 * A local analysis, recorded by the runtime: which collector at which
 * version analysed which target, and what it produced. It is the evidence a
 * LOCAL_ANALYSIS collector cites, since there is no upstream response. Only
 * the runtime creates these.
 */
export interface LocalRecord {
  readonly kind: "LOCAL";
  /** A copy of the recorded JSON. */
  readonly body: Uint8Array;
  /** When the analysis was recorded, measured by the runtime. */
  readonly recordedAt: Date;
  text(): string;
  json(): unknown;
}

export type Captured = CapturedResponse | LocalRecord;

interface CaptureRecord {
  readonly run: symbol;
  readonly payload: Uint8Array;
}

const CAPTURED = new WeakMap<object, CaptureRecord>();

function readers(payload: Uint8Array) {
  return {
    text: () => new TextDecoder("utf-8").decode(payload),
    json: (): unknown => {
      try {
        return JSON.parse(new TextDecoder("utf-8").decode(payload)) as unknown;
      } catch {
        throw new UpstreamResponseError("the body is not valid JSON");
      }
    },
  };
}

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
  const response: CapturedResponse = Object.freeze({
    kind: "NETWORK",
    url: fields.url,
    status: fields.status,
    headers: Object.freeze({ ...fields.headers }),
    get body() {
      return Uint8Array.from(payload);
    },
    receivedAt: new Date(fields.receivedAt.getTime()),
    ...readers(payload),
  });
  CAPTURED.set(response, { run, payload });
  return response;
}

/** Records a local analysis for the run `run`. The runtime is the only caller. */
export function captureLocal(run: symbol, record: unknown, recordedAt: Date): LocalRecord {
  const payload = new TextEncoder().encode(JSON.stringify(record));
  const local: LocalRecord = Object.freeze({
    kind: "LOCAL",
    get body() {
      return Uint8Array.from(payload);
    },
    recordedAt: new Date(recordedAt.getTime()),
    ...readers(payload),
  });
  CAPTURED.set(local, { run, payload });
  return local;
}

/** The run that captured this, or null if neither the fetcher nor the runtime created it. */
export function capturingRun(captured: unknown): symbol | null {
  if (typeof captured !== "object" || captured === null) return null;
  return CAPTURED.get(captured)?.run ?? null;
}

/** The exact bytes captured, for storing as evidence. Null if not a capture. */
export function capturedPayload(captured: unknown): Uint8Array | null {
  if (typeof captured !== "object" || captured === null) return null;
  const record = CAPTURED.get(captured);
  return record === undefined ? null : Uint8Array.from(record.payload);
}

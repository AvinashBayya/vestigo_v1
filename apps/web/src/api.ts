import { AppError } from "@repo/core";
import type { components } from "./client/schema.gen.ts";

export type Locked = components["schemas"]["Locked"];
export type SessionState = components["schemas"]["SessionState"];

/** Every call to the API has a timeout (CLAUDE.md §5). */
export const API_TIMEOUT_MS = 15_000;

/** The caller's signal (if any), ending after API_TIMEOUT_MS either way. */
export function timed(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(API_TIMEOUT_MS);
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
}

/** The API refused: its status, machine-readable code and stated reason. */
export class ApiProblem extends AppError {
  readonly code: string;
  readonly status: number;
  readonly detail: string;
  /** From Retry-After; null when the API gave none. */
  readonly retryAfterSeconds: number | null;
  /** The Locked block, when the refusal is the person-data gate. */
  readonly locked: Locked | null;

  constructor(input: {
    readonly status: number;
    readonly code: string;
    readonly detail: string;
    readonly retryAfterSeconds: number | null;
    readonly locked: Locked | null;
  }) {
    super(input.detail);
    this.name = "ApiProblem";
    this.status = input.status;
    this.code = input.code;
    this.detail = input.detail;
    this.retryAfterSeconds = input.retryAfterSeconds;
    this.locked = input.locked;
  }
}

/** The API could not be reached, or did not answer in time. */
export class ApiUnreachable extends AppError {
  readonly code: "API_UNREACHABLE" | "API_TIMEOUT";

  constructor(timedOut: boolean) {
    super(
      timedOut
        ? `The server did not answer within ${String(API_TIMEOUT_MS / 1000)} seconds.`
        : "Could not reach the server.",
    );
    this.name = "ApiUnreachable";
    this.code = timedOut ? "API_TIMEOUT" : "API_UNREACHABLE";
  }
}

function problemFrom(error: unknown, response: Response): ApiProblem {
  const body = typeof error === "object" && error !== null ? error : {};
  const text = (key: string): string | null =>
    key in body && typeof (body as Record<string, unknown>)[key] === "string"
      ? ((body as Record<string, unknown>)[key] as string)
      : null;
  const retryAfter = Number(response.headers.get("retry-after") ?? Number.NaN);
  const locked =
    "locked" in body && typeof body.locked === "object" && body.locked !== null
      ? (body.locked as Locked)
      : null;
  // A refusal with no code or reason keeps its status under labels that say
  // exactly that, never a guessed code; what the response does carry replaces them.
  let code = `HTTP_${String(response.status)}`;
  let detail = `The server answered ${String(response.status)} without a reason.`;
  const statedCode = text("code");
  const statedDetail = text("detail") ?? text("message");
  if (statedCode !== null) code = statedCode;
  if (statedDetail !== null) detail = statedDetail;
  return new ApiProblem({
    status: response.status,
    code,
    detail,
    retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : null,
    locked,
  });
}

/**
 * The data of a generated-client call, or a typed failure: ApiProblem when
 * the API refused, ApiUnreachable when it could not be reached in time.
 */
export async function unwrap<T>(
  call: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  let result: { data?: T; error?: unknown; response: Response };
  try {
    result = await call;
  } catch (error) {
    throw new ApiUnreachable(error instanceof DOMException && error.name === "TimeoutError");
  }
  if (result.response.ok && result.data !== undefined) return result.data;
  throw problemFrom(result.error, result.response);
}

import type { FastifyRequest } from "fastify";
import type { Auth } from "../auth/better-auth.ts";
import { HttpError } from "./errors.ts";
import { toFetchHeaders } from "./principal.ts";

/**
 * Calls one identity-provider endpoint on behalf of a request, as the request
 * itself would: its cookies, origin and user agent travel with it, the client
 * address is the socket's (never a header the client sent), and the request id
 * goes along for the provider's audit hook.
 */
export async function callIdentityProvider(
  auth: Auth,
  request: FastifyRequest,
  call: {
    readonly method: "GET" | "POST";
    readonly path: string;
    readonly body?: unknown;
    readonly headers?: Readonly<Record<string, string>>;
    /** The cookie header to send instead of the request's, after an earlier call set cookies. */
    readonly cookie?: string;
  },
): Promise<Response> {
  const headers = toFetchHeaders(request.headers);
  headers.delete("x-client-ip");
  headers.set("x-client-ip", request.ip);
  headers.set("x-request-id", request.id);
  // This call carries its own body, not the request's.
  headers.delete("content-length");
  headers.delete("content-type");
  if (call.body !== undefined) headers.set("content-type", "application/json");
  if (call.cookie !== undefined) {
    if (call.cookie === "") headers.delete("cookie");
    else headers.set("cookie", call.cookie);
  }
  for (const [name, value] of Object.entries(call.headers ?? {})) headers.set(name, value);
  const url = new URL(call.path, `${request.protocol}://${request.host}`);
  return auth.handler(
    new Request(url, {
      method: call.method,
      headers,
      ...(call.body === undefined ? {} : { body: JSON.stringify(call.body) }),
    }),
  );
}

/**
 * The cookies a browser would hold after `setCookies`: each `name=value` from a
 * Set-Cookie line replaces the same name in `cookie`, and an expired or empty
 * one removes it. For a route that makes several provider calls in a row.
 */
export function cookiesAfter(cookie: string | undefined, setCookies: readonly string[]): string {
  const jar = new Map<string, string>();
  for (const part of (cookie ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator > 0) jar.set(part.slice(0, separator).trim(), part.slice(separator + 1).trim());
  }
  for (const line of setCookies) {
    const [pair = "", ...attributes] = line.split(";");
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    const expired = attributes.some((attribute) => /^\s*max-age=0\s*$/i.test(attribute));
    if (expired || value === "") jar.delete(name);
    else jar.set(name, value);
  }
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

/**
 * The provider's refusal as a problem the API answers with: its status, its
 * machine-readable code and its message. A refusal with no readable body keeps
 * its status under a code that says so, never a guessed one.
 */
export async function providerRefusal(response: Response): Promise<HttpError> {
  const text = await response.text();
  // The provider's rate limiter answers 429 with no code: it is the API's RATE_LIMITED.
  let code = response.status === 429 ? "RATE_LIMITED" : "IDENTITY_PROVIDER_REFUSED";
  let message =
    response.status === 429
      ? "Too many attempts. Wait, then try again."
      : "The identity provider refused the request.";
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null) {
      if ("code" in parsed && typeof parsed.code === "string" && parsed.code.length > 0) {
        code = parsed.code;
      }
      if ("message" in parsed && typeof parsed.message === "string" && parsed.message.length > 0) {
        message = parsed.message;
      }
    }
  } catch {
    // Not JSON: the generic code and message above stand.
  }
  const retryAfter = Number(response.headers.get("x-retry-after") ?? Number.NaN);
  const status = response.status >= 400 && response.status < 600 ? response.status : 502;
  return new HttpError(status, code, message, Number.isFinite(retryAfter) ? retryAfter : null);
}

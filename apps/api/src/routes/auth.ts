import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { Auth } from "../auth/better-auth.ts";
import { toFetchHeaders } from "../http/principal.ts";

/**
 * Mounts the identity provider at /api/auth/*: sign-in, TOTP enrolment and
 * verification, sessions, organisations, invitations. It authenticates these
 * requests itself, and its before-hook enforces MFA and the endpoint allowlist.
 */
export function authRoutes(auth: () => Auth): FastifyPluginAsyncZod {
  return (app) => {
    app.route({
      method: ["GET", "POST"],
      url: "/api/auth/*",
      config: {
        access: { public: "The identity provider authenticates these requests itself." },
      },
      schema: { hide: true },
      handler: async (request, reply) => {
        const headers = toFetchHeaders(request.headers);
        // Set from the socket, never from the client, for the provider's rate limits.
        headers.delete("x-client-ip");
        headers.set("x-client-ip", request.ip);
        // Lets the provider's audit hook record which request it belonged to.
        headers.set("x-request-id", request.id);
        const url = new URL(request.url, `${request.protocol}://${request.host}`);
        const hasBody = request.method !== "GET" && request.body !== undefined;
        const response = await auth().handler(
          new Request(url, {
            method: request.method,
            headers,
            ...(hasBody ? { body: JSON.stringify(request.body) } : {}),
          }),
        );

        void reply.code(response.status);
        const cookies = response.headers.getSetCookie();
        if (cookies.length > 0) void reply.header("set-cookie", cookies);
        response.headers.forEach((value, name) => {
          if (name !== "set-cookie") void reply.header(name, value);
        });
        return reply.send(response.body === null ? null : await response.text());
      },
    });
    return Promise.resolve();
  };
}

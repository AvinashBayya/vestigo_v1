import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { Auth } from "../auth/better-auth.ts";
import { callIdentityProvider } from "../http/identity-provider.ts";

/**
 * The identity provider's own HTTP endpoints that stay reachable, and why.
 *
 * Sign-in, MFA, the session and tenant choice go through /api/v1/session/*,
 * which calls the provider in-process and never returns a session token. The
 * provider's own answers to several of those calls do carry one in the
 * response body (sign-in, the MFA verifications, get-session, list-sessions,
 * change-password), where any script on the page could read it. So nothing
 * else of the provider is reachable over HTTP; a route that is not listed
 * here does not exist. test/identity-surface.test.ts proves that no session
 * token can be had through what is listed, and that nothing else answers.
 */
export const OPEN_IDENTITY_ENDPOINTS = [
  {
    path: "/api/auth/sign-up/email",
    why: "How an invited person creates an account. There is no documented route for it: no sign-up ships before email sending, and CLAUDE.md §1 pins this endpoint's decoy behaviour by its path. The provider never signs the new account in (autoSignIn is off), so the body's token is always null and no session cookie is set.",
  },
  {
    path: "/api/auth/organization/accept-invitation",
    why: "How an invited person joins a tenant, from the invitation link. There is no documented route for it yet. The body is the invitation and the membership, never a token.",
  },
] as const;

export function authRoutes(auth: () => Auth): FastifyPluginAsyncZod {
  return (app) => {
    for (const endpoint of OPEN_IDENTITY_ENDPOINTS) {
      app.post(
        endpoint.path,
        {
          config: { access: { public: endpoint.why } },
          // The provider's own shapes; the web app never calls these.
          schema: { hide: true },
        },
        async (request, reply) => {
          const response = await callIdentityProvider(auth(), request, {
            method: "POST",
            path: request.url,
            ...(request.body === undefined ? {} : { body: request.body }),
          });
          void reply.code(response.status);
          const cookies = response.headers.getSetCookie();
          if (cookies.length > 0) void reply.header("set-cookie", cookies);
          response.headers.forEach((value, name) => {
            if (name !== "set-cookie") void reply.header(name, value);
          });
          return reply.send(response.body === null ? null : await response.text());
        },
      );
    }
    return Promise.resolve();
  };
}

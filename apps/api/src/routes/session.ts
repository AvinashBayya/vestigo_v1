import type { FastifyReply, FastifyRequest } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { ENROLMENT_TOKEN_HEADER } from "../auth/better-auth.ts";
import { forbidden, HttpError, ProblemSchema } from "../http/errors.ts";
import { callIdentityProvider, cookiesAfter, providerRefusal } from "../http/identity-provider.ts";
import type { Services } from "../services.ts";

/**
 * The web app's sign-in and session, as documented routes over the identity
 * provider (Phase 6b). Each calls the provider server-side, so its rules all
 * apply (passwords, MFA, enrolment tokens, rate limits, the endpoint
 * allowlist), the provider still sets and clears the cookies, and the answer is
 * shaped for the product: what the person must do next, never the provider's
 * response. No response body carries a session token.
 */

const PUBLIC =
  "Signing in, and the steps before a session exists, cannot require one; the identity provider authenticates each call itself.";

const SESSION_ERRORS = {
  400: ProblemSchema,
  401: ProblemSchema,
  403: ProblemSchema,
  429: ProblemSchema,
  500: ProblemSchema,
  502: ProblemSchema,
  503: ProblemSchema,
} as const;

const SessionUser = z.object({ id: z.string(), email: z.string(), name: z.string() });
const SessionTenant = z.object({ id: z.string(), name: z.string() });

/** Where the person stands, and so which screen comes next. */
const SessionState = z
  .discriminatedUnion("state", [
    z.object({ state: z.literal("SIGNED_OUT") }),
    /** Signed in with a password, but MFA is not set up yet: only enrolment is open. */
    z.object({ state: z.literal("MFA_ENROLMENT_REQUIRED"), user: SessionUser }),
    z.object({
      state: z.literal("SIGNED_IN"),
      user: SessionUser,
      /** The tenant this session acts in; null until one is chosen. */
      activeTenantId: z.string().nullable(),
      tenants: z.array(SessionTenant),
    }),
  ])
  .meta({ id: "SessionState" });
type SessionStateType = z.infer<typeof SessionState>;

// What the provider answers, checked at this boundary before anything is read from it.
const ProviderSignIn = z.union([
  z.object({ twoFactorRedirect: z.literal(true) }),
  z.object({ user: z.object({ id: z.string() }) }),
]);
const ProviderSession = z
  .object({
    session: z.object({ activeOrganizationId: z.string().nullable().optional() }),
    user: z.object({
      id: z.string(),
      email: z.string(),
      name: z.string(),
      twoFactorEnabled: z.boolean().nullable().optional(),
    }),
  })
  .nullable();
const ProviderOrganizations = z.array(z.object({ id: z.string(), name: z.string() }));
const ProviderEnable = z.object({ totpURI: z.string(), backupCodes: z.array(z.string()) });

export const sessionRoutes =
  (services: () => Services): FastifyPluginAsyncZod =>
  (app) => {
    /** Cookie-setting calls come only from the web app's own origin. */
    const requireTrustedOrigin = (request: FastifyRequest) => {
      const origin = request.headers.origin;
      if (origin === undefined || !services().trustedOrigins.has(origin)) {
        throw forbidden("ORIGIN_NOT_ALLOWED", "Sign-in requests must come from a trusted origin.");
      }
    };

    /** One provider call; its cookies go to the browser, and a refusal becomes the API's. */
    const call = async (
      request: FastifyRequest,
      reply: FastifyReply,
      jar: { cookie: string | undefined },
      options: {
        readonly method: "GET" | "POST";
        readonly path: string;
        readonly body?: unknown;
        readonly headers?: Readonly<Record<string, string>>;
      },
    ): Promise<unknown> => {
      const response = await callIdentityProvider(services().auth, request, {
        ...options,
        ...(jar.cookie === undefined ? {} : { cookie: jar.cookie }),
      });
      const setCookies = response.headers.getSetCookie();
      if (setCookies.length > 0) {
        for (const line of setCookies) void reply.header("set-cookie", line);
        jar.cookie = cookiesAfter(jar.cookie ?? request.headers.cookie, setCookies);
      }
      if (!response.ok) throw await providerRefusal(response);
      const text = await response.text();
      return text === "" ? null : (JSON.parse(text) as unknown);
    };

    /** The session as it now stands, after any cookies earlier calls set. */
    const stateOf = async (
      request: FastifyRequest,
      reply: FastifyReply,
      jar: { cookie: string | undefined },
    ): Promise<SessionStateType> => {
      const session = ProviderSession.parse(
        await call(request, reply, jar, { method: "GET", path: "/api/auth/get-session" }),
      );
      if (session === null) return { state: "SIGNED_OUT" };
      const user = { id: session.user.id, email: session.user.email, name: session.user.name };
      if (session.user.twoFactorEnabled !== true) return { state: "MFA_ENROLMENT_REQUIRED", user };
      const tenants = ProviderOrganizations.parse(
        await call(request, reply, jar, { method: "GET", path: "/api/auth/organization/list" }),
      );
      return {
        state: "SIGNED_IN",
        user,
        activeTenantId: session.session.activeOrganizationId ?? null,
        tenants: tenants.map((tenant) => ({ id: tenant.id, name: tenant.name })),
      };
    };

    app.get(
      "/api/v1/session",
      {
        config: { access: { public: PUBLIC } },
        schema: {
          operationId: "getSession",
          summary: "Where the person stands: signed out, needing MFA enrolment, or signed in",
          tags: ["session"],
          response: { 200: SessionState, ...SESSION_ERRORS },
        },
      },
      async (request, reply) => stateOf(request, reply, { cookie: undefined }),
    );

    app.post(
      "/api/v1/session/sign-in",
      {
        config: { access: { public: PUBLIC } },
        schema: {
          operationId: "signIn",
          summary: "Sign in with email and password",
          description:
            "The first step only. MFA_CHALLENGE: an authenticator code (or a backup code) is needed next. MFA_ENROLMENT: MFA is not set up yet, and must be enrolled with the token from the invitation or provisioning link before anything else is allowed.",
          tags: ["session"],
          body: z.object({ email: z.email().max(320), password: z.string().min(1).max(512) }),
          response: {
            200: z.object({ next: z.enum(["MFA_CHALLENGE", "MFA_ENROLMENT"]) }),
            ...SESSION_ERRORS,
          },
        },
      },
      async (request, reply) => {
        requireTrustedOrigin(request);
        const answer = ProviderSignIn.parse(
          await call(
            request,
            reply,
            { cookie: undefined },
            {
              method: "POST",
              path: "/api/auth/sign-in/email",
              body: { email: request.body.email, password: request.body.password },
            },
          ),
        );
        // An enrolled account is always challenged; one that is not must enrol.
        return { next: "twoFactorRedirect" in answer ? "MFA_CHALLENGE" : "MFA_ENROLMENT" } as const;
      },
    );

    app.post(
      "/api/v1/session/mfa/verify",
      {
        config: { access: { public: PUBLIC } },
        schema: {
          operationId: "verifyMfa",
          summary: "Answer the MFA challenge with an authenticator code or a backup code",
          description: "A backup code works once.",
          tags: ["session"],
          body: z.object({
            method: z.enum(["TOTP", "BACKUP_CODE"]),
            code: z.string().trim().min(1).max(64),
          }),
          response: { 200: SessionState, ...SESSION_ERRORS },
        },
      },
      async (request, reply) => {
        requireTrustedOrigin(request);
        const jar = { cookie: undefined as string | undefined };
        await call(request, reply, jar, {
          method: "POST",
          path:
            request.body.method === "TOTP"
              ? "/api/auth/two-factor/verify-totp"
              : "/api/auth/two-factor/verify-backup-code",
          body: { code: request.body.code },
        });
        return stateOf(request, reply, jar);
      },
    );

    app.post(
      "/api/v1/session/mfa/enrolment",
      {
        config: { access: { public: PUBLIC } },
        schema: {
          operationId: "startMfaEnrolment",
          summary: "Start MFA enrolment: the authenticator secret and the backup codes",
          description:
            "Needs a signed-in session that has not enrolled yet, the account's password again, and the one-time enrolment token from the invitation or provisioning link. The backup codes are shown here once.",
          tags: ["session"],
          body: z.object({
            password: z.string().min(1).max(512),
            enrolmentToken: z.string().trim().min(1).max(256),
          }),
          response: {
            200: z.object({
              /** The otpauth:// URI an authenticator app reads (as a QR code). */
              totpUri: z.string(),
              /** The same secret, to type into the app by hand. */
              secret: z.string(),
              backupCodes: z.array(z.string()),
            }),
            ...SESSION_ERRORS,
          },
        },
      },
      async (request, reply) => {
        requireTrustedOrigin(request);
        const enabled = ProviderEnable.parse(
          await call(
            request,
            reply,
            { cookie: undefined },
            {
              method: "POST",
              path: "/api/auth/two-factor/enable",
              body: { password: request.body.password },
              headers: { [ENROLMENT_TOKEN_HEADER]: request.body.enrolmentToken },
            },
          ),
        );
        const secret = new URL(enabled.totpURI).searchParams.get("secret");
        if (secret === null || secret === "") {
          throw new HttpError(
            502,
            "MFA_SECRET_MISSING",
            "The identity provider returned no authenticator secret.",
          );
        }
        return { totpUri: enabled.totpURI, secret, backupCodes: enabled.backupCodes };
      },
    );

    app.post(
      "/api/v1/session/mfa/enrolment/confirm",
      {
        config: { access: { public: PUBLIC } },
        schema: {
          operationId: "confirmMfaEnrolment",
          summary: "Finish MFA enrolment with the first code from the authenticator app",
          tags: ["session"],
          body: z.object({
            code: z.string().trim().min(1).max(64),
            enrolmentToken: z.string().trim().min(1).max(256),
          }),
          response: { 200: SessionState, ...SESSION_ERRORS },
        },
      },
      async (request, reply) => {
        requireTrustedOrigin(request);
        const jar = { cookie: undefined as string | undefined };
        await call(request, reply, jar, {
          method: "POST",
          path: "/api/auth/two-factor/verify-totp",
          body: { code: request.body.code },
          headers: { [ENROLMENT_TOKEN_HEADER]: request.body.enrolmentToken },
        });
        return stateOf(request, reply, jar);
      },
    );

    app.post(
      "/api/v1/session/tenant",
      {
        config: { access: { public: PUBLIC } },
        schema: {
          operationId: "chooseTenant",
          summary: "Choose the tenant this session acts in",
          description:
            "Only a tenant the person is a member of; the identity provider refuses any other.",
          tags: ["session"],
          body: z.object({ tenantId: z.uuid() }),
          response: { 200: SessionState, ...SESSION_ERRORS },
        },
      },
      async (request, reply) => {
        requireTrustedOrigin(request);
        const jar = { cookie: undefined as string | undefined };
        await call(request, reply, jar, {
          method: "POST",
          path: "/api/auth/organization/set-active",
          body: { organizationId: request.body.tenantId },
        });
        return stateOf(request, reply, jar);
      },
    );

    app.post(
      "/api/v1/session/sign-out",
      {
        config: { access: { public: PUBLIC } },
        schema: {
          operationId: "signOut",
          summary: "Sign out: the session ends everywhere it is used",
          tags: ["session"],
          response: { 200: SessionState, ...SESSION_ERRORS },
        },
      },
      async (request, reply) => {
        requireTrustedOrigin(request);
        await call(
          request,
          reply,
          { cookie: undefined },
          {
            method: "POST",
            path: "/api/auth/sign-out",
            body: {},
          },
        );
        return { state: "SIGNED_OUT" } as const;
      },
    );
    return Promise.resolve();
  };

import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { timed, unwrap, type SessionState } from "./api.ts";
import { api } from "./client/index.ts";

export const sessionQuery = queryOptions({
  queryKey: ["session"],
  queryFn: ({ signal }): Promise<SessionState> =>
    unwrap(api.GET("/api/v1/session", { signal: timed(signal) })),
});

/** The one-time MFA enrolment token, carried from the link to the enrolment screen. */
const ENROLMENT_TOKEN_KEY = "mfa-enrolment-token";

/** Per tab only, and only until enrolment succeeds. Storage may be unavailable: then null. */
export const enrolmentToken = {
  read(): string | null {
    try {
      return sessionStorage.getItem(ENROLMENT_TOKEN_KEY);
    } catch {
      return null;
    }
  },
  write(token: string): void {
    try {
      sessionStorage.setItem(ENROLMENT_TOKEN_KEY, token);
    } catch {
      // Without storage the person pastes the token on the enrolment screen.
    }
  },
  clear(): void {
    try {
      sessionStorage.removeItem(ENROLMENT_TOKEN_KEY);
    } catch {
      // Nothing was stored.
    }
  },
};

/** Where a session in this state belongs. */
export function homeOf(session: SessionState): "/sign-in" | "/enrol" | "/tenant" | "/" {
  if (session.state === "SIGNED_OUT") return "/sign-in";
  if (session.state === "MFA_ENROLMENT_REQUIRED") return "/enrol";
  return session.activeTenantId === null ? "/tenant" : "/";
}

/**
 * Signed in without a tenant chosen: with exactly one, it is chosen at once;
 * with several, the person chooses. Returns the state to continue from.
 */
export async function settleTenant(
  queryClient: QueryClient,
  session: SessionState,
): Promise<SessionState> {
  let settled = session;
  if (session.state === "SIGNED_IN" && session.activeTenantId === null) {
    const [only, ...others] = session.tenants;
    if (only !== undefined && others.length === 0) {
      settled = await unwrap(
        api.POST("/api/v1/session/tenant", { body: { tenantId: only.id }, signal: timed() }),
      );
    }
  }
  queryClient.setQueryData(sessionQuery.queryKey, settled);
  return settled;
}

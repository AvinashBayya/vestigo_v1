import { Button, Skeleton } from "@repo/ui";
import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  type RouterHistory,
} from "@tanstack/react-router";
import { z } from "zod";
import { AuthFrame } from "./components/AuthFrame.tsx";
import { ProblemNotice } from "./components/ProblemNotice.tsx";
import { EnrolScreen } from "./screens/Enrol.tsx";
import { HomeScreen } from "./screens/Home.tsx";
import { SignInScreen } from "./screens/SignIn.tsx";
import { TenantScreen } from "./screens/Tenant.tsx";
import { VerifyScreen } from "./screens/Verify.tsx";
import { enrolmentToken, homeOf, sessionQuery } from "./session.ts";

interface RouterContext {
  readonly queryClient: QueryClient;
}

/** While the session is being read: the shape of the sign-in panel, not a spinner (§8). */
function Pending() {
  return (
    <AuthFrame title="Loading">
      <div className="flex flex-col gap-4" aria-busy="true">
        <Skeleton className="h-target" />
        <Skeleton className="h-target" />
        <Skeleton className="h-target" />
      </div>
    </AuthFrame>
  );
}

const root = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  pendingComponent: Pending,
  errorComponent: ({ error, reset }) => (
    <AuthFrame title="Cannot continue">
      <ProblemNotice error={error} />
      <Button
        onClick={() => {
          reset();
        }}
      >
        Try again
      </Button>
    </AuthFrame>
  ),
});

/**
 * The session, read fresh on every navigation, then a redirect unless this
 * route is where the session belongs.
 */
const guard =
  (...allowed: readonly ReturnType<typeof homeOf>[]) =>
  async ({ context }: { context: RouterContext }) => {
    const session = await context.queryClient.query(sessionQuery);
    const home = homeOf(session);
    if (!allowed.includes(home)) throw redirect({ to: home });
  };

const signIn = createRoute({
  getParentRoute: () => root,
  path: "/sign-in",
  validateSearch: z.object({ reason: z.enum(["enrol", "signed-out"]).optional() }),
  beforeLoad: guard("/sign-in", "/enrol"),
  component: SignInScreen,
});

const verify = createRoute({
  getParentRoute: () => root,
  path: "/sign-in/verify",
  // No session exists until the challenge is answered.
  beforeLoad: guard("/sign-in"),
  component: VerifyScreen,
});

const enrol = createRoute({
  getParentRoute: () => root,
  path: "/enrol",
  beforeLoad: async ({ context, location }) => {
    // The link carries the token in its fragment (#token=…), which never reaches
    // a server or a log. Keep it for this tab, and take it out of the address bar.
    const token = new URLSearchParams(location.hash.replace(/^#/, "")).get("token");
    if (token !== null && token !== "") {
      enrolmentToken.write(token);
      globalThis.history.replaceState(null, "", location.pathname);
    }
    const session = await context.queryClient.query(sessionQuery);
    const home = homeOf(session);
    if (home === "/sign-in") throw redirect({ to: "/sign-in", search: { reason: "enrol" } });
    if (home !== "/enrol") throw redirect({ to: home });
  },
  component: EnrolScreen,
});

const tenant = createRoute({
  getParentRoute: () => root,
  path: "/tenant",
  beforeLoad: guard("/tenant", "/"),
  component: TenantScreen,
});

const home = createRoute({
  getParentRoute: () => root,
  path: "/",
  beforeLoad: guard("/"),
  component: HomeScreen,
});

const routeTree = root.addChildren([signIn, verify, enrol, tenant, home]);

export function createAppRouter(queryClient: QueryClient, history?: RouterHistory) {
  return createRouter({
    routeTree,
    context: { queryClient },
    ...(history === undefined ? {} : { history }),
    defaultPendingMs: 0,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}

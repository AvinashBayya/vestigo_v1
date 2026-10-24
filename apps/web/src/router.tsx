import { Button, Skeleton } from "@repo/ui";
import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
  redirect,
  type RouterHistory,
} from "@tanstack/react-router";
import { z } from "zod";
import { AuthFrame } from "./components/AuthFrame.tsx";
import { ProblemNotice } from "./components/ProblemNotice.tsx";
import { enrolmentToken, homeOf, sessionQuery } from "./session.ts";

/*
 * Every screen is downloaded when its route is first matched, not in the first
 * load: lazyRouteComponent, as the gallery below. The guards, params and search
 * validation stay here, so who may see a route is decided before its download
 * starts, and a redirect downloads nothing. While a screen downloads, the router
 * shows what it shows while the session is read (on a navigation, the screen
 * being left). A download that fails reaches the errorComponent below, after
 * one reload when the file is missing (a deploy replaced it).
 */

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
  component: lazyRouteComponent(() => import("./screens/SignIn.tsx"), "SignInScreen"),
});

const verify = createRoute({
  getParentRoute: () => root,
  path: "/sign-in/verify",
  // No session exists until the challenge is answered.
  beforeLoad: guard("/sign-in"),
  component: lazyRouteComponent(() => import("./screens/Verify.tsx"), "VerifyScreen"),
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
  component: lazyRouteComponent(() => import("./screens/Enrol.tsx"), "EnrolScreen"),
});

const tenant = createRoute({
  getParentRoute: () => root,
  path: "/tenant",
  beforeLoad: guard("/tenant", "/"),
  component: lazyRouteComponent(() => import("./screens/Tenant.tsx"), "TenantScreen"),
});

const home = createRoute({
  getParentRoute: () => root,
  path: "/",
  beforeLoad: guard("/"),
  component: lazyRouteComponent(() => import("./screens/Home.tsx"), "HomeScreen"),
});

/** A run's live progress. The id is checked by the API, which answers a malformed one plainly. */
const run = createRoute({
  getParentRoute: () => root,
  path: "/runs/$runId",
  beforeLoad: guard("/"),
  component: lazyRouteComponent(() => import("./screens/Run.tsx"), "RunRoute"),
});

/** A run's results: the workspace tabs over what the run collected. */
const runResults = createRoute({
  getParentRoute: () => root,
  path: "/runs/$runId/$tab",
  beforeLoad: guard("/"),
  component: lazyRouteComponent(() => import("./workspace/Workspace.tsx"), "RunResultsRoute"),
});

const cases = createRoute({
  getParentRoute: () => root,
  path: "/cases",
  beforeLoad: guard("/"),
  component: lazyRouteComponent(() => import("./screens/Cases.tsx"), "CasesScreen"),
});

/** The organisation's members (provisional until the admin screens land). */
const members = createRoute({
  getParentRoute: () => root,
  path: "/members",
  beforeLoad: guard("/"),
  component: lazyRouteComponent(() => import("./screens/Members.tsx"), "MembersScreen"),
});

/** The organisation's settings (provisional until the admin screens land). */
const settings = createRoute({
  getParentRoute: () => root,
  path: "/settings",
  beforeLoad: guard("/"),
  component: lazyRouteComponent(() => import("./screens/Settings.tsx"), "SettingsScreen"),
});

/** A case: the same tabs over what is pinned to it, and only that. */
const caseWorkspace = createRoute({
  getParentRoute: () => root,
  path: "/cases/$caseId/$tab",
  beforeLoad: guard("/"),
  component: lazyRouteComponent(() => import("./workspace/Workspace.tsx"), "CaseRoute"),
});

/**
 * The component gallery (U1-b review surface): development builds only.
 * `import.meta.env.DEV` is a literal false in a production build, so this
 * branch, and the lazy import with it, is removed from the bundle.
 */
const devRoutes = import.meta.env.DEV
  ? [
      createRoute({
        getParentRoute: () => root,
        path: "/dev/gallery",
        component: lazyRouteComponent(() => import("./gallery/Gallery.tsx"), "Gallery"),
      }),
    ]
  : [];

const routeTree = root.addChildren([
  ...devRoutes,
  signIn,
  verify,
  enrol,
  tenant,
  home,
  run,
  runResults,
  cases,
  caseWorkspace,
  members,
  settings,
]);

export function createAppRouter(queryClient: QueryClient, history?: RouterHistory) {
  return createRouter({
    routeTree,
    context: { queryClient },
    ...(history === undefined ? {} : { history }),
    defaultPendingMs: 0,
  });
}

/**
 * Starts the first page's download while its guard reads the session, not
 * after it: the router runs every guard before it asks for a chunk, so a first
 * load would otherwise wait for the session, then for the code. A guard that
 * redirects wastes one small download and shows nothing from it. A failed
 * download is not handled here: the page rendering it shows the error.
 */
export function preloadFirstPage(router: ReturnType<typeof createAppRouter>): void {
  const [routes] = router.getMatchedRoutes(router.state.location.pathname);
  for (const route of routes) router.loadRouteChunk(route)?.catch(() => undefined);
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}

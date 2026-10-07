import { Button, Notice, Skeleton } from "@repo/ui";
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
import { AppShell } from "./components/AppShell.tsx";
import { AuthFrame } from "./components/AuthFrame.tsx";
import { ProblemNotice } from "./components/ProblemNotice.tsx";
import { CasesScreen } from "./screens/Cases.tsx";
import { EnrolScreen } from "./screens/Enrol.tsx";
import { HomeScreen } from "./screens/Home.tsx";
import { RunScreen } from "./screens/Run.tsx";
import { SignInScreen } from "./screens/SignIn.tsx";
import { TenantScreen } from "./screens/Tenant.tsx";
import { VerifyScreen } from "./screens/Verify.tsx";
import { enrolmentToken, homeOf, sessionQuery } from "./session.ts";
import { RUN_TABS, Workspace, type WorkspaceTab } from "./workspace/Workspace.tsx";

const isTab = (value: string): value is WorkspaceTab =>
  (RUN_TABS as readonly string[]).includes(value);

/** A tab the workspace does not have: said plainly, with the way back. */
function NoSuchTab({ tab }: { readonly tab: string }) {
  return (
    <AppShell>
      <Notice>
        There is no <span className="font-mono">{tab}</span> tab. The workspace has{" "}
        {RUN_TABS.join(", ")}.
      </Notice>
    </AppShell>
  );
}

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

/** A run's live progress. The id is checked by the API, which answers a malformed one plainly. */
const run = createRoute({
  getParentRoute: () => root,
  path: "/runs/$runId",
  beforeLoad: guard("/"),
  component: function RunRoute() {
    const { runId } = run.useParams();
    return <RunScreen key={runId} runId={runId} />;
  },
});

/** A run's results: the workspace tabs over what the run collected. */
const runResults = createRoute({
  getParentRoute: () => root,
  path: "/runs/$runId/$tab",
  beforeLoad: guard("/"),
  component: function RunResultsRoute() {
    const { runId, tab } = runResults.useParams();
    if (!isTab(tab)) return <NoSuchTab tab={tab} />;
    return <Workspace key={runId} scope={{ kind: "run", id: runId }} tab={tab} />;
  },
});

const cases = createRoute({
  getParentRoute: () => root,
  path: "/cases",
  beforeLoad: guard("/"),
  component: CasesScreen,
});

/** A case: the same tabs over what is pinned to it, and only that. */
const caseWorkspace = createRoute({
  getParentRoute: () => root,
  path: "/cases/$caseId/$tab",
  beforeLoad: guard("/"),
  component: function CaseRoute() {
    const { caseId, tab } = caseWorkspace.useParams();
    if (!isTab(tab)) return <NoSuchTab tab={tab} />;
    return <Workspace key={caseId} scope={{ kind: "case", id: caseId }} tab={tab} />;
  },
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
]);

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

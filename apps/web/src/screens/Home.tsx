import { PRODUCT_NAME } from "@repo/config/product";
import { Button, Panel } from "@repo/ui";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { timed, unwrap } from "../api.ts";
import { api } from "../client/index.ts";
import { ProblemNotice } from "../components/ProblemNotice.tsx";
import { HealthStatus } from "../HealthStatus.tsx";
import { sessionQuery } from "../session.ts";

/** The signed-in shell. Search, the next step of the build, will live here. */
export function HomeScreen() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: session } = useSuspenseQuery(sessionQuery);

  const signOut = useMutation({
    mutationFn: () => unwrap(api.POST("/api/v1/session/sign-out", { signal: timed() })),
    onSuccess: async (next) => {
      queryClient.setQueryData(sessionQuery.queryKey, next);
      await navigate({ to: "/sign-in", search: { reason: "signed-out" } });
    },
  });

  if (session.state !== "SIGNED_IN") return null;
  const tenant = session.tenants.find((candidate) => candidate.id === session.activeTenantId);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-wrap items-center gap-4 border-b border-border-default bg-surface-raised px-6 py-3">
        <p className="text-body-strong text-ink-primary">{PRODUCT_NAME}</p>
        <p className="text-small text-ink-secondary">
          {/* The tenant's name; its id when the list no longer has it, never a blank. */}
          {tenant === undefined ? (
            <span className="font-mono text-mono-caption">{session.activeTenantId}</span>
          ) : (
            tenant.name
          )}
        </p>
        <div className="ml-auto flex items-center gap-2">
          <p className="text-small text-ink-muted">{session.user.email}</p>
          {session.tenants.length > 1 ? (
            <Button variant="quiet" asChild>
              <Link to="/tenant">Switch organisation</Link>
            </Button>
          ) : null}
          <Button
            variant="secondary"
            disabled={signOut.isPending}
            onClick={() => {
              signOut.mutate();
            }}
          >
            {signOut.isPending ? "Signing out…" : "Sign out"}
          </Button>
        </div>
      </header>
      <main className="flex flex-1 flex-col gap-6 p-10">
        {signOut.isError ? <ProblemNotice error={signOut.error} /> : null}
        <Panel className="flex flex-col gap-2">
          <p className="text-eyebrow uppercase text-ink-muted">Search</p>
          <p className="text-body text-ink-secondary">
            Nothing to show yet: search is the next step of this build.
          </p>
        </Panel>
      </main>
      <footer className="border-t border-border-subtle px-6 py-3 text-caption text-ink-muted">
        <HealthStatus />
      </footer>
    </div>
  );
}

import { Button, cn, Popover, PopoverContent, PopoverTrigger } from "@repo/ui";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { FolderOpen, Search } from "lucide-react";
import { useState, type ReactNode } from "react";
import { timed, unwrap, type SessionState } from "../api.ts";
import { api } from "../client/index.ts";
import { HealthStatus } from "../HealthStatus.tsx";
import { meQuery, VETTING_TEXT } from "../me.ts";
import { sessionQuery } from "../session.ts";
import { applyTheme, initialTheme, type Theme } from "../theme.ts";
import { ProblemNotice } from "./ProblemNotice.tsx";
import { ProductMark } from "./ProductMark.tsx";

type SignedIn = Extract<SessionState, { state: "SIGNED_IN" }>;

/**
 * The signed-in frame (docs/design/mockups/Main.dc.html): side navigation,
 * a top bar with the organisation and its vetting status, and the account
 * menu. Navigation lists only what is built; the rest of the designed menu
 * appears as each part is built (docs/design/README.md).
 */
export function AppShell({ children }: { readonly children: ReactNode }) {
  const { data: session } = useSuspenseQuery(sessionQuery);
  if (session.state !== "SIGNED_IN") return null;
  const tenant = session.tenants.find((candidate) => candidate.id === session.activeTenantId);

  return (
    <div className="flex min-h-screen bg-surface-page">
      <SideNav />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-4 border-b border-border-default bg-surface-raised px-6 py-2">
          <Link to="/" className="md:hidden" aria-label="Search">
            <ProductMark />
          </Link>
          <p className="text-small text-ink-secondary">
            {/* The organisation's name; its id when the list no longer has it, never a blank. */}
            {tenant === undefined ? (
              <span className="font-mono text-mono-caption">{session.activeTenantId}</span>
            ) : (
              tenant.name
            )}
          </p>
          <div className="ml-auto flex items-center gap-3">
            {session.activeTenantId === null ? null : (
              <VettingChip tenantId={session.activeTenantId} />
            )}
            <AccountMenu session={session} organisation={tenant?.name ?? null} />
          </div>
        </header>
        <main className="flex flex-1 flex-col gap-6 p-10">{children}</main>
      </div>
    </div>
  );
}

function SideNav() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  // A run, and its results, are part of the search flow that started it.
  const searchActive = pathname === "/" || pathname.startsWith("/runs/");
  const casesActive = pathname === "/cases" || pathname.startsWith("/cases/");
  const item = (active: boolean) =>
    cn(
      "flex min-h-target items-center gap-3 rounded-md px-3 text-body",
      active
        ? "bg-accent-soft text-body-strong text-accent-ink"
        : "text-ink-secondary hover:bg-surface-hover",
    );
  return (
    <nav
      aria-label="Main"
      className="hidden w-nav shrink-0 flex-col gap-6 border-r border-border-default bg-surface-raised px-3 py-5 md:flex"
    >
      <Link to="/" className="px-2">
        <ProductMark />
      </Link>
      <ul className="flex flex-col gap-1">
        <li>
          <Link
            to="/"
            aria-current={searchActive ? "page" : undefined}
            className={item(searchActive)}
          >
            <Search className="size-4 shrink-0" strokeWidth={1.9} aria-hidden="true" />
            Search
          </Link>
        </li>
        <li>
          <Link
            to="/cases"
            aria-current={casesActive ? "page" : undefined}
            className={item(casesActive)}
          >
            <FolderOpen className="size-4 shrink-0" strokeWidth={1.9} aria-hidden="true" />
            Cases
          </Link>
        </li>
      </ul>
    </nav>
  );
}

/** The organisation's vetting status, as the API states it; nothing while it is unknown. */
function VettingChip({ tenantId }: { readonly tenantId: string }) {
  const me = useQuery(meQuery(tenantId));
  if (me.data === undefined) return null;
  return (
    <span className="inline-flex items-center rounded-pill bg-accent-soft px-3 py-1 text-caption text-accent-ink">
      {VETTING_TEXT[me.data.tenant.vettingStatus]}
    </span>
  );
}

/** Up to two initials from the person's name, else the first letter of their email. */
function initialsOf(user: SignedIn["user"]): string {
  const fromName = user.name
    .split(/\s+/)
    .map((word) => /\p{L}/u.exec(word)?.[0] ?? "")
    .filter((letter) => letter !== "")
    .slice(0, 2)
    .join("");
  return (fromName === "" ? user.email.slice(0, 1) : fromName).toUpperCase();
}

function AccountMenu({
  session,
  organisation,
}: {
  readonly session: SignedIn;
  readonly organisation: string | null;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [theme, setTheme] = useState<Theme>(initialTheme);

  const signOut = useMutation({
    mutationFn: () => unwrap(api.POST("/api/v1/session/sign-out", { signal: timed() })),
    onSuccess: async (next) => {
      queryClient.setQueryData(sessionQuery.queryKey, next);
      await navigate({ to: "/sign-in", search: { reason: "signed-out" } });
    },
  });

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    setTheme(next);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Account"
          className="inline-flex size-target items-center justify-center rounded-md border border-border-default bg-surface-page text-body-strong text-ink-secondary hover:bg-surface-hover"
        >
          {initialsOf(session.user)}
        </button>
      </PopoverTrigger>
      <PopoverContent>
        <div className="flex flex-col gap-1">
          <p className="text-body-strong text-ink-primary">{session.user.name}</p>
          <p className="text-small text-ink-secondary">{session.user.email}</p>
          {organisation === null ? null : (
            <p className="text-small text-ink-secondary">{organisation}</p>
          )}
        </div>
        {session.tenants.length > 1 ? (
          <Button variant="secondary" asChild>
            <Link to="/tenant">Switch organisation</Link>
          </Button>
        ) : null}
        <Button variant="secondary" onClick={toggleTheme}>
          {theme === "dark" ? "Use light theme" : "Use dark theme"}
        </Button>
        <Button
          variant="secondary"
          disabled={signOut.isPending}
          onClick={() => {
            signOut.mutate();
          }}
        >
          {signOut.isPending ? "Signing out…" : "Sign out"}
        </Button>
        {signOut.isError ? <ProblemNotice error={signOut.error} /> : null}
        <div className="border-t border-border-subtle pt-3 text-caption text-ink-muted">
          <HealthStatus />
        </div>
      </PopoverContent>
    </Popover>
  );
}

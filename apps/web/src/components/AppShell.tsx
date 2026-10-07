import { AppHeader, CreditsMeter, NavItem, SideNav, Unmeasured, VettingPill } from "@repo/ui";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { PanelTop, Search, Settings, Users } from "lucide-react";
import type { ReactNode } from "react";
import { meQuery } from "../me.ts";
import { messageFor } from "../messages.ts";
import { sessionQuery } from "../session.ts";
import { AccountButton } from "./Account.tsx";
import { CommandPaletteHost } from "./CommandPaletteHost.tsx";
import { ProductMark } from "./ProductMark.tsx";

/** No credit metering exists, so the meter says so (§12): an em dash and this, never a figure. */
export const NO_CREDIT_METERING = "credit metering is not built.";
const NOT_METERED = { value: null, reason: NO_CREDIT_METERING } as const;

/**
 * The signed-in frame for the app's own pages (docs/design/mockups/Main.dc.html):
 * the side navigation (built destinations only) with the credits meter at its
 * foot, outside the navigation landmark; the app header with the command
 * palette, the organisation, its vetting status and the account menu. The
 * organisation's name is not drawn in the mockup: it stays, so the analyst
 * always sees which tenant they are working in (§12). `<main>` carries no
 * padding; each screen sets its own gutters.
 */
export function AppShell({ children }: { readonly children: ReactNode }) {
  const { data: session } = useSuspenseQuery(sessionQuery);
  if (session.state !== "SIGNED_IN") return null;
  const tenant = session.tenants.find((candidate) => candidate.id === session.activeTenantId);

  return (
    <div className="flex min-h-screen bg-surface-page">
      <MainNav />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader
          start={
            <>
              <Link
                to="/"
                activeOptions={{ exact: true }}
                className="inline-flex min-h-target items-center md:hidden"
                aria-label="Search"
              >
                <ProductMark />
              </Link>
              <CommandPaletteHost />
            </>
          }
          end={
            <>
              <p className="min-w-0 truncate text-meta text-ink-secondary">
                {/* The organisation's name; its id when the list no longer has it, never a blank. */}
                {tenant === undefined ? (
                  <span className="font-mono text-mono-meta">{session.activeTenantId}</span>
                ) : (
                  tenant.name
                )}
              </p>
              {session.activeTenantId === null ? null : (
                <Vetting tenantId={session.activeTenantId} />
              )}
              <AccountButton />
            </>
          }
        />
        <main className="flex flex-1 flex-col">{children}</main>
      </div>
    </div>
  );
}

function MainNav() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const under = (base: string) => pathname === base || pathname.startsWith(`${base}/`);
  // A run, and its results, are part of the search flow that started it.
  const searchActive = pathname === "/" || pathname.startsWith("/runs/");
  return (
    <SideNav
      className="sticky top-0 hidden h-screen md:flex"
      mark={
        <Link
          to="/"
          activeOptions={{ exact: true }}
          className="inline-flex min-h-target items-center"
        >
          <ProductMark />
        </Link>
      }
      foot={<CreditsMeter used={NOT_METERED} limit={NOT_METERED} />}
    >
      {/* Exact: the router would otherwise mark "/" current on every page. */}
      <NavItem
        asChild
        current={searchActive}
        icon={<Search className="size-icon" strokeWidth={1.9} />}
      >
        <Link to="/" activeOptions={{ exact: true }}>
          Search
        </Link>
      </NavItem>
      <NavItem
        asChild
        current={under("/cases")}
        icon={<PanelTop className="size-icon" strokeWidth={1.9} />}
      >
        <Link to="/cases">Cases</Link>
      </NavItem>
      <NavItem
        asChild
        current={under("/members")}
        icon={<Users className="size-icon" strokeWidth={1.9} />}
      >
        <Link to="/members">Members</Link>
      </NavItem>
      <NavItem
        asChild
        current={under("/settings")}
        icon={<Settings className="size-icon" strokeWidth={1.9} />}
      >
        <Link to="/settings">Settings</Link>
      </NavItem>
    </SideNav>
  );
}

/**
 * The organisation's vetting status, as the API states it. Nothing while it
 * is read (a value, not a surface); an em dash with the reason if the read
 * fails, never an alert and never "Verified tenant" unless the API says APPROVED.
 */
function Vetting({ tenantId }: { readonly tenantId: string }) {
  const me = useQuery(meQuery(tenantId));
  if (me.isError) {
    const message = messageFor(me.error);
    return (
      <Unmeasured
        reason={`The vetting status could not be read${message.code === null ? "" : ` (${message.code})`}.`}
      />
    );
  }
  if (me.data === undefined) return null;
  return <VettingPill status={me.data.tenant.vettingStatus} />;
}

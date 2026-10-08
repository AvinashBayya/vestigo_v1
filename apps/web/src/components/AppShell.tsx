import {
  AppHeader,
  CreditsMeter,
  NavItem,
  SideNav,
  TabBar,
  TabLink,
  Unmeasured,
  VettingPill,
} from "@repo/ui";
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
 * always sees which tenant they are working in (§12). Below `md` the side
 * navigation is not drawn and its destinations are a plain row of links under
 * the header. `<main>` carries no padding; each screen sets its own gutters.
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
        <PhoneNav />
        <main className="flex flex-1 flex-col">{children}</main>
      </div>
    </div>
  );
}

/** The built destinations, in order. The side navigation and the phone row list exactly these. */
const DESTINATIONS = [
  { to: "/", label: "Search", Icon: Search },
  { to: "/cases", label: "Cases", Icon: PanelTop },
  { to: "/members", label: "Members", Icon: Users },
  { to: "/settings", label: "Settings", Icon: Settings },
] as const;

function useIsCurrent(): (to: (typeof DESTINATIONS)[number]["to"]) => boolean {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return (to) =>
    to === "/"
      ? // A run, and its results, are part of the search flow that started it.
        pathname === "/" || pathname.startsWith("/runs/")
      : pathname === to || pathname.startsWith(`${to}/`);
}

function MainNav() {
  const isCurrent = useIsCurrent();
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
      {DESTINATIONS.map(({ to, label, Icon }) => (
        <NavItem
          key={to}
          asChild
          current={isCurrent(to)}
          icon={<Icon className="size-icon" strokeWidth={1.9} />}
        >
          {/* Exact for "/": the router would otherwise mark it current on every page. */}
          <Link to={to} activeOptions={{ exact: to === "/" }}>
            {label}
          </Link>
        </NavItem>
      ))}
    </SideNav>
  );
}

/**
 * Below `md`, where the side navigation is not drawn, the same destinations as
 * a plain row of links under the header. It scrolls inside itself, as the
 * workspace tabs do; there is no navigation sheet (raised, §12).
 */
function PhoneNav() {
  const isCurrent = useIsCurrent();
  return (
    <TabBar label="Main" className="md:hidden">
      {DESTINATIONS.map(({ to, label }) => (
        <TabLink key={to} asChild current={isCurrent(to)}>
          <Link to={to} activeOptions={{ exact: to === "/" }}>
            {label}
          </Link>
        </TabLink>
      ))}
    </TabBar>
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

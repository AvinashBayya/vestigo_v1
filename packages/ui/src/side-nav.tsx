import { Slot } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn.ts";

/**
 * The side navigation (§9 Navigation, Main): `layout-nav-width`, padding
 * `space-5` `space-3.5`, gap `space-6.5`, the product mark over the items.
 * Only built destinations are passed in: there are no disabled items. The
 * foot (the credits meter) sits OUTSIDE the <nav> landmark, so the landmark
 * holds the mark and the destinations and nothing else.
 */
export function SideNav({
  mark,
  label = "Main",
  children,
  foot,
  className,
}: {
  /** The ProductMark. */
  readonly mark: ReactNode;
  /** The landmark's name. */
  readonly label?: string | undefined;
  /** NavItems. */
  readonly children: ReactNode;
  readonly foot?: ReactNode;
  readonly className?: string | undefined;
}) {
  return (
    <aside
      className={cn(
        "flex w-nav shrink-0 flex-col gap-6.5 border-r border-border-default bg-surface-raised px-3.5 py-5",
        className,
      )}
    >
      <nav aria-label={label} className="flex flex-col gap-6.5">
        <div className="px-1.5">{mark}</div>
        <ul className="flex flex-col gap-0.5">{children}</ul>
      </nav>
      {foot !== undefined && foot !== null && <div className="mt-auto">{foot}</div>}
    </aside>
  );
}

const ITEM = {
  /** The side navigation. */
  nav: { on: "text-body-strong", off: "text-body" },
  /** A section rail (Report): the same row at `ui`. */
  rail: { on: "text-ui-strong", off: "text-ui" },
} as const;

/**
 * One destination (§9 Navigation): `target-min` tall, padding `space-2.5`, gap
 * `space-2.75`, `radius-md`, an `icon` glyph. The current one is
 * `aria-current="page"` on `accent-soft`, and its weight changes too, so the
 * tint is never the only sign (§7). With `asChild` the router's link takes
 * the look and the icon: `<NavItem asChild current icon={…}><Link to="/cases">Cases</Link></NavItem>`.
 */
export function NavItem({
  current,
  icon,
  size = "nav",
  asChild = false,
  className,
  children,
  ...props
}: ComponentProps<"a"> & {
  readonly current: boolean;
  /** A line icon (lucide, from the app), drawn decorative. */
  readonly icon?: ReactNode;
  readonly size?: keyof typeof ITEM | undefined;
  readonly asChild?: boolean | undefined;
}) {
  const classes = cn(
    "flex min-h-target cursor-pointer items-center gap-2.75 rounded-md px-2.5",
    current
      ? cn("bg-accent-soft text-accent-ink", ITEM[size].on)
      : cn("text-ink-secondary hover:bg-surface-hover", ITEM[size].off),
    className,
  );
  const glyph =
    icon === undefined ? null : (
      <span aria-hidden="true" className="inline-flex size-icon shrink-0 items-center">
        {icon}
      </span>
    );
  return (
    <li>
      {asChild ? (
        <Slot.Root aria-current={current ? "page" : undefined} className={classes} {...props}>
          {glyph}
          <Slot.Slottable>{children}</Slot.Slottable>
        </Slot.Root>
      ) : (
        <a aria-current={current ? "page" : undefined} className={classes} {...props}>
          {glyph}
          {children}
        </a>
      )}
    </li>
  );
}

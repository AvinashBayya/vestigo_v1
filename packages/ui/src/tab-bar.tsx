import { Slot } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn.ts";

/**
 * The workspace tab bar (§9 Case header and tabs): `layout-tabbar-height`,
 * `surface-raised`, a `border-default` rule beneath, padding 0 `space-4`, gap
 * `space-0.5`. A navigation landmark of links (§7: the tabs are links, never
 * role="tab"). The order is the caller's. It scrolls inside itself at phone
 * width, so the page never scrolls sideways.
 *
 * The bar is content-box: its `layout-tabbar-height` is the room inside the
 * rule, so a target-sized tab fits whole and its underline sits on the rule. As a
 * border-box the rule took its width from that room, the tab overflowed, and the
 * bar's own scrolling clipped the underline away.
 */
export function TabBar({
  label,
  children,
  className,
}: {
  /** The landmark's name: "Workspace". */
  readonly label: string;
  /** TabLinks. */
  readonly children: ReactNode;
  readonly className?: string | undefined;
}) {
  return (
    <nav
      aria-label={label}
      className={cn(
        "box-content flex h-tabbar shrink-0 items-stretch gap-0.5 overflow-x-auto border-b border-border-default bg-surface-raised px-4",
        className,
      )}
    >
      {children}
    </nav>
  );
}

/**
 * One tab: padding 0 `space-3.25`, `ui` `ink-muted`. The current tab is
 * `aria-current="page"`, `ui-strong` `accent-ink` and underlined at
 * `tab-indicator-width` in `accent`: weight and underline as well as colour,
 * never colour alone. With `asChild` the router's link takes the look.
 */
export function TabLink({
  current,
  asChild = false,
  className,
  ...props
}: ComponentProps<"a"> & {
  readonly current: boolean;
  readonly asChild?: boolean | undefined;
}) {
  const classes = cn(
    "tab-indicator inline-flex h-full min-h-target min-w-target shrink-0 cursor-pointer items-center justify-center px-3.25 whitespace-nowrap",
    current
      ? "tab-indicator-current text-ui-strong text-accent-ink"
      : "text-ui text-ink-muted hover:text-ink-secondary",
    className,
  );
  const ariaCurrent = current ? "page" : undefined;
  if (asChild) return <Slot.Root aria-current={ariaCurrent} className={classes} {...props} />;
  return <a aria-current={ariaCurrent} className={classes} {...props} />;
}

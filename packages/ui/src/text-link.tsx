import { Slot } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn.ts";

const SIZE = {
  /** Header back links ("Cases", "Search"). */
  ui: "text-ui-strong",
  /** Card header links ("All cases", "Manage"). */
  meta: "text-meta-strong",
} as const;

export type TextLinkProps = ComponentProps<"a"> & {
  /** Render the single child (a router link) with this look instead of an <a>. */
  readonly asChild?: boolean | undefined;
  readonly size?: keyof typeof SIZE | undefined;
};

/**
 * A standalone link (§7, D2): never inside a sentence, in the `link` tokens,
 * underlined on hover, with a `target-min` hit area. With `asChild` the
 * router's link takes this look: `<TextLink asChild><Link to="/cases">Cases</Link></TextLink>`.
 */
export function TextLink({
  asChild = false,
  size = "ui",
  className,
  children,
  ...props
}: TextLinkProps) {
  const classes = cn(
    "hit-area inline-flex cursor-pointer items-center gap-1.5 text-link hover:text-link-hover hover:underline",
    SIZE[size],
    className,
  );
  if (asChild) {
    return (
      <Slot.Root className={classes} {...props}>
        {children}
      </Slot.Root>
    );
  }
  return (
    <a className={classes} {...props}>
      {children}
    </a>
  );
}

function ChevronLeft() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-icon-sm shrink-0"
    >
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

/**
 * The way back from a context header (§9 case and run headers): a TextLink at
 * `ui-strong`, led by a chevron unless the mockup draws none. The chevron is
 * decorative, so the link's name is its words alone.
 */
export function BackLink({
  chevron = true,
  asChild = false,
  className,
  children,
  ...props
}: Omit<TextLinkProps, "size"> & {
  readonly chevron?: boolean | undefined;
  readonly children: ReactNode;
}) {
  const classes = cn(
    "hit-area inline-flex cursor-pointer items-center gap-1.5 text-ui-strong text-link hover:text-link-hover hover:underline",
    className,
  );
  if (asChild) {
    return (
      <Slot.Root className={classes} {...props}>
        {chevron && <ChevronLeft />}
        <Slot.Slottable>{children}</Slot.Slottable>
      </Slot.Root>
    );
  }
  return (
    <a className={classes} {...props}>
      {chevron && <ChevronLeft />}
      {children}
    </a>
  );
}

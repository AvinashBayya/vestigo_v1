import { cva } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "./cn.ts";

type Variant = "primary" | "secondary" | "quiet";
type Size = "lg" | "md" | "sm";

const button = cva(
  [
    "inline-flex items-center justify-center gap-2 rounded-md whitespace-nowrap cursor-pointer",
    "disabled:cursor-not-allowed disabled:border-border-default disabled:bg-surface-sunken disabled:text-ink-muted",
  ],
  {
    variants: {
      variant: {
        /** The one main action on a screen. */
        primary: "bg-accent text-on-accent",
        secondary: "border border-border-strong bg-surface-raised hover:bg-surface-hover",
        /** A quiet action that reads as a link. */
        quiet: "px-2 underline hover:bg-surface-hover",
      },
    },
    defaultVariants: { variant: "primary" },
  },
);

/**
 * The look a caller gets without a size: unchanged from U1-b, so screens not
 * yet rebuilt do not shift. New screens pass a size.
 */
const UNSIZED: Readonly<Record<Variant, string>> = {
  primary: "min-h-target px-4 text-body-strong",
  secondary: "min-h-target px-4 text-body-strong text-ink-primary",
  quiet: "min-h-target text-body-strong text-accent",
};

/**
 * §9 Buttons. lg is the target height itself (auth and dashboard, padding
 * `space-5`, `body-strong`); md (`control-md`) and sm (`control-sm`) are drawn
 * smaller in `small-strong` and keep a `target-min` hit area (§7).
 */
const SIZE: Readonly<Record<Size, string>> = {
  lg: "min-h-target px-5 text-body-strong",
  md: "hit-area h-control-md text-small-strong",
  sm: "hit-area h-control-sm text-small-strong",
};

/** Padding at md and sm: `space-3.25` secondary, `space-3.75` primary (§9). */
const COMPACT_PADDING: Readonly<Record<Variant, string>> = {
  primary: "px-3.75",
  secondary: "px-3.25",
  quiet: "px-2",
};

/** §9 inks on the sized buttons: secondary in `ink-secondary`, primary hover `accent-hover`, quiet in the link tokens. */
const SIZED_INK: Readonly<Record<Variant, string>> = {
  primary: "hover:bg-accent-hover",
  secondary: "text-ink-secondary",
  quiet: "text-link hover:text-link-hover",
};

function buttonClasses(variant: Variant, size: Size | undefined): string {
  if (size === undefined) return cn(button({ variant }), UNSIZED[variant]);
  return cn(
    button({ variant }),
    SIZE[size],
    size === "lg" ? null : COMPACT_PADDING[variant],
    SIZED_INK[variant],
  );
}

export type ButtonProps = ComponentProps<"button"> & {
  readonly variant?: Variant | null | undefined;
  /**
   * §9 height: lg (`target-min`), md (`control-md`) or sm (`control-sm`), the
   * smaller two with a `target-min` hit area. Without a size the button keeps
   * its earlier look.
   */
  readonly size?: Size | undefined;
  /** Render the single child (a link, say) with the button's look instead of a <button>. */
  readonly asChild?: boolean | undefined;
};

/** A real <button> (or, with asChild, its child), with a hit area of at least the target size. */
export function Button({ className, variant, size, asChild = false, type, ...props }: ButtonProps) {
  const classes = cn(buttonClasses(variant ?? "primary", size), className);
  if (asChild) return <Slot.Root className={classes} {...props} />;
  return <button type={type ?? "button"} className={classes} {...props} />;
}

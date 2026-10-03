import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "./cn.ts";

const button = cva(
  [
    "inline-flex min-h-target items-center justify-center gap-2 rounded-md px-4",
    "text-body-strong whitespace-nowrap cursor-pointer",
    "disabled:cursor-not-allowed disabled:border-border-default disabled:bg-surface-sunken disabled:text-ink-muted",
  ],
  {
    variants: {
      variant: {
        /** The one main action on a screen. */
        primary: "bg-accent text-on-accent",
        secondary:
          "border border-border-strong bg-surface-raised text-ink-primary hover:bg-surface-hover",
        /** A quiet action that reads as a link. */
        quiet: "px-2 text-accent underline hover:bg-surface-hover",
      },
    },
    defaultVariants: { variant: "primary" },
  },
);

export type ButtonProps = ComponentProps<"button"> &
  VariantProps<typeof button> & {
    /** Render the single child (a link, say) with the button's look instead of a <button>. */
    asChild?: boolean;
  };

/** A real <button> (or, with asChild, its child), at least the target size tall. */
export function Button({ className, variant, asChild = false, type, ...props }: ButtonProps) {
  const classes = cn(button({ variant }), className);
  if (asChild) return <Slot.Root className={classes} {...props} />;
  return <button type={type ?? "button"} className={classes} {...props} />;
}

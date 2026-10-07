import type { ComponentProps } from "react";
import { cn } from "./cn.ts";

/**
 * Pin-to-case (§9: on every result surface). Drawn small, with a `target-min` hit area
 * (§7); its name says what it pins. A known state is `aria-pressed`. Where no
 * read says whether the item is pinned (`pinned` null), there is no
 * `aria-pressed` at all: claiming "not pinned" would be a guess. It spreads
 * its props and ref, so it can be a popover's trigger (`asChild`).
 */
export function PinButton({
  pinned,
  onToggle,
  label,
  className,
  onClick,
  ...props
}: Omit<ComponentProps<"button">, "children"> & {
  /** Pinned, not pinned, or null when no read says. */
  readonly pinned: boolean | null;
  /** For a toggle; a popover trigger takes its click from the popover. */
  readonly onToggle?: (() => void) | undefined;
  /** What it pins, as its accessible name: "Pin row 3 to case". */
  readonly label: string;
  readonly className?: string | undefined;
}) {
  return (
    <button
      type="button"
      {...props}
      aria-pressed={pinned ?? undefined}
      aria-label={label}
      onClick={(event) => {
        onClick?.(event);
        onToggle?.();
      }}
      className={cn(
        "hit-area inline-flex size-control-sm shrink-0 cursor-pointer items-center justify-center rounded-sm border text-ui",
        pinned === true
          ? "border-accent bg-accent-soft text-accent-ink"
          : "border-border-strong bg-surface-raised text-ink-secondary hover:bg-surface-hover",
        className,
      )}
    >
      <span aria-hidden="true">{pinned === true ? "✓" : "+"}</span>
    </button>
  );
}

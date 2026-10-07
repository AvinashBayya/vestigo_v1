import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn.ts";

/** Drawn at `control-sm`, with the hit area extended to `target-min` (§7). Neutral chrome: no meaning colour. */
const CHIP =
  "hit-area inline-flex h-control-sm shrink-0 cursor-pointer items-center gap-1 rounded-md border px-2.75 whitespace-nowrap";
const ON = "border-accent bg-accent-soft text-meta-strong text-accent-ink";
const OFF =
  "border-border-strong bg-surface-raised text-meta-strong text-ink-secondary hover:bg-surface-hover";

/**
 * An applied filter (Evidence): "Facet: value ×". The whole chip removes it,
 * and its name says so: "Remove filter Facet: value" (§7).
 */
export function FilterChip({
  facet,
  value,
  onRemove,
  className,
}: {
  readonly facet: string;
  readonly value: string;
  readonly onRemove: () => void;
  readonly className?: string | undefined;
}) {
  return (
    <button
      type="button"
      aria-label={`Remove filter ${facet}: ${value}`}
      onClick={onRemove}
      className={cn(CHIP, ON, className)}
    >
      {facet}: {value}
      <span aria-hidden="true">×</span>
    </button>
  );
}

/** A filter that is on or off (a facet value offered for filtering): `aria-pressed` carries which. */
export function FilterToggle({
  pressed,
  onPressedChange,
  children,
  className,
}: {
  readonly pressed: boolean;
  readonly onPressedChange: (pressed: boolean) => void;
  readonly children: string;
  readonly className?: string | undefined;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={() => {
        onPressedChange(!pressed);
      }}
      className={cn(CHIP, pressed ? ON : OFF, className)}
    >
      {children}
    </button>
  );
}

/** "+ Filter": opens whatever picks a new filter. Dashed, so it reads as an action, not a filter. */
export function AddFilterChip({ className, ...props }: ComponentProps<"button">) {
  // Props and ref pass through, so the chip can be a popover's trigger (aria-expanded, focus return).
  return (
    <button
      type="button"
      aria-label="Add filter"
      {...props}
      className={cn(
        CHIP,
        "border-dashed border-border-strong bg-surface-raised text-meta text-ink-secondary hover:bg-surface-hover",
        className,
      )}
    >
      <span aria-hidden="true">+</span> Filter
    </button>
  );
}

/**
 * Chips in a row. When they wrap, the row gap is `space-3`, so the `target-min` hit
 * areas of chips drawn at `control-sm` do not overlap (§9).
 */
export function FilterChipRow({
  children,
  label,
  className,
}: {
  readonly children: ReactNode;
  /** What the chips filter, for assistive technology: "Evidence filters". */
  readonly label: string;
  readonly className?: string | undefined;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("flex flex-wrap items-center gap-x-2 gap-y-3", className)}
    >
      {children}
    </div>
  );
}

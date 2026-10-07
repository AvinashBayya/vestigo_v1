import { cn } from "./cn.ts";

/**
 * Pin-to-case (§9: on every result surface). Drawn small, with a `target-min` hit area
 * (§7); its state is `aria-pressed`, and its name says what it pins.
 */
export function PinButton({
  pinned,
  onToggle,
  label,
  className,
}: {
  readonly pinned: boolean;
  readonly onToggle: () => void;
  /** What it pins, as its accessible name: "Pin row 3 to case". */
  readonly label: string;
  readonly className?: string | undefined;
}) {
  return (
    <button
      type="button"
      aria-pressed={pinned}
      aria-label={label}
      onClick={onToggle}
      className={cn(
        "hit-area inline-flex size-control-sm shrink-0 cursor-pointer items-center justify-center rounded-sm border text-ui",
        pinned
          ? "border-accent bg-accent-soft text-accent-ink"
          : "border-border-strong bg-surface-raised text-ink-secondary hover:bg-surface-hover",
        className,
      )}
    >
      <span aria-hidden="true">{pinned ? "✓" : "+"}</span>
    </button>
  );
}

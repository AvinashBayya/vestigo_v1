import { cn } from "./cn.ts";

export type Density = "comfortable" | "compact";

const OPTIONS: readonly (readonly [Density, string])[] = [
  ["comfortable", "Comfortable"],
  ["compact", "Compact"],
];

/**
 * The density toggle (§9 Data table, Entities): a segmented pair drawn at
 * `control-sm`, a `border-strong` edge, `radius-md` outer corners. Off is `small`
 * `ink-muted` on `surface-raised`; on is `small-strong` `accent-ink` on
 * `accent-soft`, and `aria-pressed` says which. Each segment keeps a
 * `target-min` hit area, so the group is not clipped (no overflow hiding),
 * and reserves its strong width so the weight change moves nothing.
 */
export function DensityToggle({
  value,
  onChange,
  label = "Row density",
  className,
}: {
  readonly value: Density;
  readonly onChange: (value: Density) => void;
  readonly label?: string | undefined;
  readonly className?: string | undefined;
}) {
  return (
    <div role="group" aria-label={label} className={cn("inline-flex", className)}>
      {OPTIONS.map(([option, word]) => {
        const on = value === option;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={on}
            data-label={word}
            onClick={() => {
              onChange(option);
            }}
            className={cn(
              "hit-area reserve-strong-width h-control-sm cursor-pointer border border-border-strong px-3 whitespace-nowrap",
              "first:rounded-l-md last:rounded-r-md last:border-l-0",
              on
                ? "bg-accent-soft text-small-strong text-accent-ink"
                : "bg-surface-raised text-small text-ink-muted hover:bg-surface-hover",
            )}
          >
            {word}
          </button>
        );
      })}
    </div>
  );
}

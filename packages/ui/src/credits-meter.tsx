import { cn } from "./cn.ts";
import { Unmeasured } from "./unmeasured.tsx";

/** A count that was measured, or an honest absence with its reason. Never 0 for "not measured" (§1). */
export type MeasuredCount =
  { readonly value: number } | { readonly value: null; readonly reason: string };

/**
 * The credits meter (§9, Main), at the foot of the navigation: an `overline`
 * title, the figure in `metric` with "of [limit]" in `meta`, and a `bar-md`
 * meter. No credit metering exists yet, so today it is drawn unmeasured: an
 * em dash with its reason, no "of" line, no bar and no meter role (§12; a
 * bar at any width would be a fabricated value). A bar is drawn only when
 * both values are measured and the limit is above zero.
 */
export function CreditsMeter({
  used,
  limit,
  title = "Credits this month",
  className,
}: {
  readonly used: MeasuredCount;
  readonly limit: MeasuredCount;
  readonly title?: string | undefined;
  readonly className?: string | undefined;
}) {
  // Narrowed here so the meter is only ever given measured numbers.
  const meter =
    used.value !== null && limit.value !== null && limit.value > 0
      ? { used: used.value, limit: limit.value }
      : null;
  return (
    <section
      aria-label={title}
      className={cn("flex flex-col rounded-box border border-border-default p-3", className)}
    >
      <p className="text-overline text-ink-muted uppercase">{title}</p>
      <div className="mt-1.75 flex flex-wrap items-baseline gap-1.5">
        {used.value === null ? (
          // At the figure's size, in sans, so the dash reads as the figure it stands for.
          <Unmeasured reason={used.reason} className="justify-start text-metric" />
        ) : (
          <span className="font-mono text-metric text-ink-primary">{String(used.value)}</span>
        )}
        {used.value !== null &&
          (limit.value === null ? (
            <span className="inline-flex items-baseline gap-1.5 text-meta text-ink-muted">
              of <Unmeasured reason={limit.reason} />
            </span>
          ) : (
            <span className="text-meta text-ink-muted">of {String(limit.value)}</span>
          ))}
      </div>
      {used.value === null && (
        // Said in words as well; the dash already carries it for assistive technology.
        <p aria-hidden="true" className="text-caption text-ink-muted">
          Not measured — {used.reason}
        </p>
      )}
      {meter !== null && (
        <meter
          min={0}
          max={meter.limit}
          value={meter.used}
          aria-label={title}
          className={cn(
            "mt-2.25 block h-bar-md w-full appearance-none overflow-hidden rounded-bar bg-surface-muted",
            // The bar's parts are pseudo-elements; each takes the same tokens.
            "[&::-webkit-meter-bar]:bg-surface-muted [&::-webkit-meter-optimum-value]:bg-accent [&::-moz-meter-bar]:bg-accent",
          )}
        />
      )}
    </section>
  );
}

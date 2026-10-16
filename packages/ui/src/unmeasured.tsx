import { Tooltip } from "radix-ui";
import { cn } from "./cn.ts";

/**
 * A value that was never measured: an em dash, never 0, "N/A" or a blank
 * (§1). The reason is in a tooltip on hover or keyboard focus, and in the
 * accessible name, so a screen reader hears why without opening anything.
 * `summary` opens that name: "Not measured." unless the dash stands for
 * something known to be absent, such as no access method that can run here.
 *
 * The box is the dash's own width and the line's height, so the dash sits on
 * its column's text edge and a row keeps its pitch; the target size is an
 * overlay (`hit-area`), not a size. `className` aligns it in its cell.
 */
export function Unmeasured({
  reason,
  summary = "Not measured.",
  className,
}: {
  /** Why there is no value, in plain words. */
  readonly reason: string;
  /** What the dash stands for, said first in its accessible name. */
  readonly summary?: string;
  readonly className?: string | undefined;
}) {
  return (
    <Tooltip.Provider delayDuration={200}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button
            type="button"
            aria-label={`${summary} ${reason.charAt(0).toUpperCase()}${reason.slice(1)}`}
            className={cn(
              "hit-area inline-flex cursor-help items-center rounded-sm align-baseline",
              "font-sans text-ui text-ink-muted hover:bg-surface-hover",
              className,
            )}
          >
            <span aria-hidden="true">—</span>
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            className={cn(
              "max-w-form rounded-md border border-border-default bg-surface-raised p-3",
              "text-small text-ink-primary shadow-overlay",
            )}
          >
            {reason}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

import { Tooltip } from "radix-ui";
import { cn } from "./cn.ts";

/**
 * A value that was never measured: an em dash, never 0, "N/A" or a blank
 * (§1). The reason is in a tooltip on hover or keyboard focus, and in the
 * accessible name, so a screen reader hears why without opening anything.
 */
export function Unmeasured({
  reason,
  className,
}: {
  /** Why there is no value, in plain words. */
  readonly reason: string;
  readonly className?: string;
}) {
  return (
    <Tooltip.Provider delayDuration={200}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button
            type="button"
            aria-label={`Not measured. ${reason}`}
            className={cn(
              "inline-flex min-h-target min-w-target cursor-help items-center justify-center rounded-sm",
              "font-mono text-mono-body text-ink-muted hover:bg-surface-hover",
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

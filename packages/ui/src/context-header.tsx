import type { ReactNode } from "react";
import { cn } from "./cn.ts";

const KIND = {
  /** §9 Case header (Workspace and the tab mockups): `layout-case-header-height`. */
  case: {
    header: "min-h-case-header px-5",
    start: "gap-3",
    divider: "h-4.5",
    title: "text-body-strong text-ink-primary",
    actions: "gap-2.25",
  },
  /** §9 Run view header (RunLive): `layout-header-height`, the target in `mono-target`. */
  run: {
    header: "min-h-header px-5.5",
    start: "gap-3.25",
    divider: "h-5",
    title: "font-mono text-mono-target break-all text-ink-primary",
    actions: "gap-2.5",
  },
} as const;

/**
 * The header over a case or a run (§9): the way back, a divider, the title,
 * its meta (tags, alternates), and on the right the actions that exist and,
 * last, the account button (full-bleed screens have no app header, so the
 * theme, organisation and sign-out stay reachable here). Its height is a
 * minimum, so it wraps at phone width rather than scrolling sideways.
 */
export function ContextHeader({
  kind,
  back,
  title,
  meta,
  actions,
  account,
  className,
}: {
  readonly kind: keyof typeof KIND;
  /** A BackLink. */
  readonly back: ReactNode;
  /** The case name or the run's target; a Skeleton while it is read. */
  readonly title: ReactNode;
  /** Tags and an alternates caption, beside the title. */
  readonly meta?: ReactNode;
  /** Buttons (size sm for a case) or the run's status chip. Only actions that exist. */
  readonly actions?: ReactNode;
  /** The AccountMenu, at the far right. */
  readonly account?: ReactNode;
  readonly className?: string | undefined;
}) {
  const style = KIND[kind];
  return (
    <header
      className={cn(
        "flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border-default bg-surface-raised py-1.25",
        style.header,
        className,
      )}
    >
      <div className={cn("flex min-w-0 flex-wrap items-center", style.start)}>
        {back}
        <span aria-hidden="true" className={cn("border-l border-border-default", style.divider)} />
        <h1 className={cn("min-w-0", style.title)}>{title}</h1>
        {meta !== undefined && meta !== null && (
          <div className={cn("flex flex-wrap items-center", style.start)}>{meta}</div>
        )}
      </div>
      {(actions !== undefined || account !== undefined) && (
        <div className={cn("flex flex-wrap items-center", style.actions)}>
          {actions}
          {account}
        </div>
      )}
    </header>
  );
}

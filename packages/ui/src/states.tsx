import type { ReactNode } from "react";
import { cn } from "./cn.ts";

/**
 * The empty card (§8 Empty): what would appear here and how to get it, with
 * the one action that fills it. Never a blank area.
 */
export function EmptyState({
  title,
  children,
  action,
  className,
}: {
  readonly title: string;
  /** What would appear here, and how to get it, in a sentence. */
  readonly children: ReactNode;
  readonly action?: ReactNode;
  readonly className?: string | undefined;
}) {
  return (
    <section
      className={cn(
        "flex flex-col items-start gap-2 rounded-lg border border-border-default bg-surface-raised p-4.5",
        className,
      )}
    >
      <h3 className="text-ui-strong text-ink-primary">{title}</h3>
      <p className="text-prose-small text-ink-secondary">{children}</p>
      {action}
    </section>
  );
}

/**
 * §8 Not built: a tab or panel whose analysis does not exist yet. Titled with
 * what it will show, saying plainly that it is not built and what it needs.
 * No sample data and no greyed fake content, ever.
 */
export function NotBuilt({
  title,
  needs,
  className,
}: {
  /** What this surface will show once it exists. */
  readonly title: string;
  /** What it needs before it can be built: the missing endpoint or analysis. */
  readonly needs: string;
  readonly className?: string | undefined;
}) {
  return (
    <EmptyState title={title} className={className}>
      Not built yet. {needs}
    </EmptyState>
  );
}

/**
 * §8 Loading: blocks in the layout's shape, and a status line saying what is
 * being read. Never a centred spinner.
 */
export function LoadingState({
  what,
  children,
  className,
}: {
  /** What is being read, as a sentence: "Reading the evidence." */
  readonly what: string;
  /** Skeleton blocks in the shape of what will appear. */
  readonly children: ReactNode;
  readonly className?: string | undefined;
}) {
  return (
    <div className={cn("flex flex-col gap-3", className)} aria-busy="true">
      <p role="status" className="text-caption text-ink-muted">
        {what}
      </p>
      {children}
    </div>
  );
}

/**
 * §8 Failed: the reason, the code, and what the person can do, on the failure
 * tint. A failure is a status, so it may carry the failure colours. The code
 * is written "Code: X" where the API gave one; an unexpected failure has
 * none, and no code is ever made up for it.
 */
export function FailedAlert({
  title,
  reason,
  code,
  children,
  action,
  className,
}: {
  readonly title: ReactNode;
  /** Why it failed, in plain words. Absent when the title already says it. */
  readonly reason?: ReactNode;
  /** The machine-readable code, as the API sent it; null or absent when there is none. */
  readonly code?: string | null | undefined;
  /** More of what the person can do, between the reason and the code. */
  readonly children?: ReactNode;
  readonly action?: ReactNode;
  readonly className?: string | undefined;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex gap-2.75 rounded-inner border border-status-failed-border bg-status-failed-tint px-3.75 py-3",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="mt-1.25 size-dot-sm shrink-0 rounded-pill bg-status-failed-mark"
      />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-ui-strong text-status-failed-ink">{title}</p>
        {reason !== undefined && reason !== null && (
          <p className="text-prose-small text-ink-secondary">{reason}</p>
        )}
        {children}
        {code !== undefined && code !== null && (
          <p className="font-mono text-mono-caption text-ink-muted">Code: {code}</p>
        )}
        {action !== undefined && action !== null && <div className="mt-1.25 flex">{action}</div>}
      </div>
    </div>
  );
}

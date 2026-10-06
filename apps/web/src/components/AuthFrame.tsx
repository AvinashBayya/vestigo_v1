import { cn } from "@repo/ui";
import type { ReactNode } from "react";
import { ProductMark } from "./ProductMark.tsx";

/**
 * The frame every sign-in step sits in (docs/design/mockups/SignIn.dc.html,
 * MfaEnrol.dc.html): the product mark, the step's heading, its content, and a
 * footnote under a rule.
 */
export function AuthFrame({
  eyebrow,
  title,
  intro,
  footnote,
  width = "form",
  children,
}: {
  /** A short label above the heading, e.g. the step number. */
  readonly eyebrow?: string;
  readonly title: string;
  readonly intro?: ReactNode;
  readonly footnote?: ReactNode;
  /** `form` for one column of fields; `page` for the wider enrolment steps. */
  readonly width?: "form" | "page";
  readonly children: ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-page px-4 py-10">
      <div
        className={cn("flex w-full flex-col gap-6", width === "page" ? "max-w-page" : "max-w-form")}
      >
        <ProductMark />
        <div className="flex flex-col gap-2">
          {eyebrow === undefined ? null : (
            <p className="text-eyebrow uppercase text-ink-muted">{eyebrow}</p>
          )}
          <h1 className="text-display text-ink-primary">{title}</h1>
          {intro === undefined ? null : <div className="text-body text-ink-secondary">{intro}</div>}
        </div>
        {children}
        {footnote === undefined ? null : (
          <div className="flex items-start gap-3 border-t border-border-subtle pt-5 text-small text-ink-secondary">
            {footnote}
          </div>
        )}
      </div>
    </main>
  );
}

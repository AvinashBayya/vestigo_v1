import type { ReactNode } from "react";
import { cn } from "./cn.ts";
import { StrengthBadge } from "./strength-badge.tsx";

/*
 * THE ONLY FILE THAT APPLIES THE SERIF (§4, owner decision D4). The serif is
 * set on the report's own title and prose elements, never on a container, so
 * nothing placed inside (a badge, a citation marker, a callout) inherits it.
 * packages/ui/src/serif-scope.test.ts fails if `font-serif` or a `serif-`
 * type style appears in any other source file.
 */

/**
 * The report document card (§9, Report): the run's report as stored, on a
 * card whose text column is `layout-document-width`, padded `space-8.5`.
 */
export function ReportSurface({
  title,
  children,
  className,
}: {
  readonly title: string;
  readonly children: ReactNode;
  readonly className?: string | undefined;
}) {
  return (
    <article
      aria-label={title}
      className={cn("rounded-lg border border-border-default bg-surface-raised p-8.5", className)}
    >
      <div className="flex max-w-document flex-col gap-4">
        <h2 className="font-serif text-serif-title text-ink-primary">{title}</h2>
        {children}
      </div>
    </article>
  );
}

/**
 * A section heading inside the report document (§9: `serif-title` is the
 * report document section title), in `ink-primary`. An h3 under the card's
 * own h2 title by default; `id` lets the section be labelled by it.
 */
export function ReportSectionHeading({
  children,
  id,
  level = 3,
}: {
  readonly children: ReactNode;
  readonly id?: string | undefined;
  readonly level?: 3 | 4 | undefined;
}) {
  const Heading = level === 3 ? "h3" : "h4";
  return (
    <Heading id={id} className="font-serif text-serif-title text-ink-primary">
      {children}
    </Heading>
  );
}

/** A paragraph of report prose: `serif-body` in `ink-body`. */
export function ReportProse({ children }: { readonly children: ReactNode }) {
  return <p className="font-serif text-serif-body text-ink-body">{children}</p>;
}

/**
 * A sentence that carries an inference (§2, §9): a `space-0.75`
 * `claim-inferred-mark` rule beside it on `claim-inferred-tint`, and, in
 * words, INFERRED and what it was inferred from (required: §2).
 */
export function InferredPassage({
  children,
  from,
}: {
  readonly children: ReactNode;
  /** What the inference rests on, in words. */
  readonly from: string;
}) {
  return (
    <div className="flex bg-claim-inferred-tint">
      <span aria-hidden="true" className="w-0.75 shrink-0 bg-claim-inferred-mark" />
      <p className="px-3.5 py-2.5 font-serif text-serif-body text-ink-body">
        {children} <StrengthBadge strength="INFERRED" size="sm" />{" "}
        <span className="font-sans text-caption text-claim-inferred-ink">from {from}</span>
      </p>
    </div>
  );
}

/**
 * A citation marker in the prose: the superscript number, as text. Markers
 * sit side by side ("[2][3]") in the serif-body leading, so a target-min hit area on each
 * would overlap its neighbours (§7); the controls that open the evidence are
 * the Citations row after the paragraph (D8, as D2 does for links).
 */
export function CitationMarker({ n }: { readonly n: number }) {
  return <sup className="font-sans text-badge text-link">[{n}]</sup>;
}

/**
 * The paragraph's citations as standalone controls, each a `target-min` button that
 * opens the cited evidence; placed after the paragraph, never inside it (D8).
 *
 * With `labels`, each button is named for its source ("Source 2: [label]").
 * A number `labels` does not hold cites no known source: with `missing`, it
 * is that wording, as text in the failed ink, never a control that opens
 * nothing; without `missing`, it stays a control with the generic name.
 */
export function Citations({
  numbers,
  onOpen,
  labels,
  missing,
}: {
  readonly numbers: readonly number[];
  readonly onOpen: (n: number) => void;
  /** Each cited number's source, in words, for the button's accessible name. */
  readonly labels?: ReadonlyMap<number, string> | undefined;
  /** The wording for a number no source matches. */
  readonly missing?: ((n: number) => string) | undefined;
}) {
  return (
    <div
      role="group"
      aria-label="Citations"
      className="flex flex-wrap items-center gap-x-0 font-sans"
    >
      <span className="mr-1 text-caption text-ink-muted">Sources</span>
      {numbers.map((n) => {
        const label = labels?.get(n);
        if (labels !== undefined && label === undefined && missing !== undefined) {
          return (
            <span key={n} className="mx-1 text-caption text-status-failed-ink">
              {missing(n)}
            </span>
          );
        }
        return (
          <button
            key={n}
            type="button"
            aria-label={
              label === undefined
                ? `Citation ${String(n)}: open the cited evidence`
                : `Source ${String(n)}: ${label}`
            }
            onClick={() => {
              onOpen(n);
            }}
            className="inline-flex size-target cursor-pointer items-center justify-center rounded-sm font-mono text-mono-caption text-link underline hover:bg-surface-hover hover:text-link-hover"
          >
            [{n}]
          </button>
        );
      })}
    </div>
  );
}

/**
 * A coverage limitation carried into the report (§9): what was not collected
 * and why, on the failure tint, in sans. A failure is a status.
 */
export function CoverageLimitation({
  title,
  children,
  level = 3,
}: {
  readonly title: string;
  readonly children: ReactNode;
  /** h3 by default; h4 when the callout sits under a report section heading. */
  readonly level?: 3 | 4 | undefined;
}) {
  const Heading = level === 3 ? "h3" : "h4";
  return (
    <aside className="flex flex-col gap-1.25 rounded-inner border border-status-failed-border bg-status-failed-tint px-3.5 py-3 font-sans">
      <Heading className="text-small-strong text-status-failed-ink">{title}</Heading>
      <div className="text-prose-small text-ink-secondary">{children}</div>
    </aside>
  );
}

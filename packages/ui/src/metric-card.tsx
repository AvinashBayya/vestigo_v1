import { cn } from "./cn.ts";

/**
 * A measured value, or an honest absence. There is no third shape: a value
 * that was not measured is never 0, never "N/A", never a placeholder bar
 * (CLAUDE.md §1). `cause` says whether a failure is why (failure ink) or the
 * platform simply does not record it (muted).
 */
export type MetricValue =
  | { readonly kind: "value"; readonly value: string }
  | {
      readonly kind: "unavailable";
      /** Why there is no value, in plain words: "crt.sh failed". */
      readonly reason: string;
      readonly cause: "failed" | "not-recorded";
    };

export interface MetricRow {
  readonly label: string;
  readonly value: MetricValue;
}

/**
 * One label and value. An unavailable value is the em dash, set in sans so it
 * never reads as a hyphen (§4), with "Not measured — <reason>" in words on the
 * line beneath, as RunLive draws it. Assistive technology hears the reason in
 * the value itself; the visible line is not read twice.
 */
function Row({
  row,
  labelClass,
  className,
}: {
  readonly row: MetricRow;
  readonly labelClass: string;
  readonly className?: string | undefined;
}) {
  const { value } = row;
  // One div per dt/dd pair (valid HTML). The dd's children join the row's
  // flex line, so the caption can wrap beneath the label as RunLive draws it.
  return (
    <div className={cn("flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1", className)}>
      <dt className={cn("text-ui", labelClass)}>{row.label}</dt>
      <dd className="contents">
        {value.kind === "value" ? (
          <span className="ml-auto font-mono text-mono-value text-ink-primary">{value.value}</span>
        ) : (
          <>
            <span aria-hidden="true" className="ml-auto font-sans text-body text-ink-muted">
              —
            </span>
            <span className="sr-only">Not measured — {value.reason}</span>
            <span
              aria-hidden="true"
              className={cn(
                "basis-full text-caption",
                value.cause === "failed" ? "text-status-failed-ink" : "text-ink-muted",
              )}
            >
              Not measured — {value.reason}
            </span>
          </>
        )}
      </dd>
    </div>
  );
}

function Header({ title }: { readonly title: string }) {
  return <h3 className="text-section-label text-ink-muted uppercase">{title}</h3>;
}

/**
 * The metric and cost card (§9, RunLive): label and value rows, baseline
 * aligned, and a footnote. An unavailable value is a first-class state: an
 * em dash and, beneath it, "Not measured — <reason>". `notBuilt` replaces the
 * rows when the measurement does not exist yet.
 */
export function MetricCard({
  title,
  rows,
  footnote,
  notBuilt,
  className,
}: {
  readonly title: string;
  readonly rows: readonly MetricRow[];
  readonly footnote?: string | undefined;
  /** What the card needs before it can show anything; rows are ignored while it is set. */
  readonly notBuilt?: string | undefined;
  readonly className?: string | undefined;
}) {
  return (
    <section
      aria-label={title}
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-border-default bg-surface-raised px-5 py-4.5",
        className,
      )}
    >
      <Header title={title} />
      {notBuilt !== undefined ? (
        <p className="text-prose-small text-ink-secondary">Not built yet. {notBuilt}</p>
      ) : (
        <dl className="flex flex-col gap-3">
          {rows.map((row) => (
            <Row key={row.label} row={row} labelClass="text-ink-muted" />
          ))}
        </dl>
      )}
      {footnote !== undefined && notBuilt === undefined && (
        <p className="text-caption-prose text-ink-muted">{footnote}</p>
      )}
    </section>
  );
}

/**
 * "Arriving now" (§9, RunLive): what the run has produced so far, label and
 * value, ruled between rows. An unmeasured row says why beneath its dash.
 */
export function ArrivingNow({
  rows,
  title = "Arriving now",
  className,
}: {
  readonly rows: readonly MetricRow[];
  readonly title?: string | undefined;
  readonly className?: string | undefined;
}) {
  return (
    <section
      aria-label={title}
      className={cn(
        "flex flex-col gap-3.25 rounded-lg border border-border-default bg-surface-raised px-5 py-4.5",
        className,
      )}
    >
      <Header title={title} />
      <dl className="flex flex-col">
        {rows.map((row) => (
          <Row
            key={row.label}
            row={row}
            labelClass="text-ink-primary"
            className="border-b border-border-subtle py-3.25 first:pt-0 last:border-b-0 last:pb-0"
          />
        ))}
      </dl>
    </section>
  );
}

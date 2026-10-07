import {
  CLAIM_STRENGTH_LABELS,
  cn,
  EmptyState,
  LoadingState,
  Skeleton,
  StrengthBadge,
  StrengthKey,
  Unmeasured,
} from "@repo/ui";
import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { ProblemNotice } from "../components/ProblemNotice.tsx";
import { Instant, MaybeInstant, MISSING_TIME, plural } from "../components/Values.tsx";
import { PinButton, usePinState } from "./Pin.tsx";
import { ProvenanceLayout, ProvenanceLink } from "./Provenance.tsx";
import {
  timelineQuery,
  type Scope,
  type Strength,
  type Timeline,
  type TimelineEvent,
  type TimeOrder,
} from "./queries.ts";
import { CutListNotice } from "./states.tsx";

const ORDER_TEXT: Readonly<Record<TimeOrder, string>> = {
  observedAt: "Observed time",
  collectedAt: "Collected time",
};

/** What "undated" means for each order: the event lacks that time, and is not dated by the other. */
const UNDATED_TEXT: Readonly<Record<TimeOrder, string>> = {
  observedAt:
    "No observed time: the source did not say when these happened. They are not placed by when they were collected.",
  collectedAt: "No collection time was recorded for these.",
};

const WITHOUT_TEXT: Readonly<Record<TimeOrder, string>> = {
  observedAt: "Without an observed time",
  collectedAt: "Without a collection time",
};

const NO_RANGE: Readonly<Record<TimeOrder, string>> = {
  observedAt: "No event shown has an observed time.",
  collectedAt: "No event shown has a collection time.",
};

/** Each strength's ring on the spine, in its mark colour; the key under the range says it in words. */
const RING: Readonly<Record<Strength, string>> = {
  OBSERVED: "border-claim-observed-mark",
  REPORTED: "border-claim-reported-mark",
  DERIVED: "border-claim-derived-mark",
  CORRELATED: "border-claim-correlated-mark",
  INFERRED: "border-claim-inferred-mark",
  HYPOTHESIS: "border-claim-hypothesis-mark",
};

/** Each strength's tick on the range strip, in its mark colour (the key says it in words). */
const TICK: Readonly<Record<Strength, string>> = {
  OBSERVED: "text-claim-observed-mark",
  REPORTED: "text-claim-reported-mark",
  DERIVED: "text-claim-derived-mark",
  CORRELATED: "text-claim-correlated-mark",
  INFERRED: "text-claim-inferred-mark",
  HYPOTHESIS: "text-claim-hypothesis-mark",
};

/** The strip's coordinate width: ticks are placed in it, inset so an end tick is drawn whole. */
const STRIP_WIDTH = 1000;
const STRIP_INSET = 6;

/**
 * The range strip (Timeline.dc.html): one tick per event shown that has the
 * chosen time, placed by that time between the earliest and the latest, in
 * its strength's mark colour. Only measured times are placed: an undated
 * event has no tick, and every tick is the same height (no count is drawn,
 * because none is measured per span). The list below says it all in words.
 */
function RangeStrip({
  events,
  order,
  range,
}: {
  readonly events: readonly TimelineEvent[];
  readonly order: TimeOrder;
  readonly range: { readonly from: string; readonly to: string };
}) {
  const from = Date.parse(range.from);
  const span = Date.parse(range.to) - from;
  const ticks = events.flatMap((event) => {
    const time = event[order];
    if (time === null) return [];
    // One instant (every event at the same time) sits in the middle.
    const at = span === 0 ? 0.5 : (Date.parse(time) - from) / span;
    return [
      {
        id: event.evidenceId,
        strength: event.strength,
        x: STRIP_INSET + at * (STRIP_WIDTH - 2 * STRIP_INSET),
      },
    ];
  });
  return (
    <div className="h-target min-w-0 grow basis-full rounded-md border border-border-subtle bg-surface-sunken px-1 py-2">
      <svg
        role="img"
        aria-label={`${plural(ticks.length, "event")} placed by ${order === "observedAt" ? "observed" : "collected"} time across the range, coloured by strength. Each is listed below.`}
        viewBox={`0 0 ${String(STRIP_WIDTH)} 10`}
        preserveAspectRatio="none"
        className="block size-full"
      >
        {ticks.map((tick) => (
          <line
            key={tick.id}
            data-strength={tick.strength}
            x1={tick.x}
            x2={tick.x}
            y1={0}
            y2={10}
            stroke="currentColor"
            strokeWidth={3}
            vectorEffect="non-scaling-stroke"
            className={TICK[tick.strength]}
          />
        ))}
      </svg>
    </div>
  );
}

/**
 * The Timeline tab (docs/design/mockups/Timeline.dc.html): the scope's
 * evidence in time, ordered by the time the reader chooses. An event without
 * that time is listed apart, as undated, and never placed at its other time.
 * Times are the reader's local time with its zone written out.
 */
export function TimelineTab({ scope }: { readonly scope: Scope }) {
  const [order, setOrder] = useState<TimeOrder>("observedAt");
  const timeline = useQuery(timelineQuery(scope, order));
  const orderControl = (
    <div role="group" aria-label="Order by" className="inline-flex">
      {(["observedAt", "collectedAt"] as const).map((value) => {
        const on = order === value;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={on}
            onClick={() => {
              setOrder(value);
            }}
            className={cn(
              "hit-area h-control-sm cursor-pointer border border-border-strong px-3 whitespace-nowrap",
              "first:rounded-l-md last:rounded-r-md last:border-l-0",
              on
                ? "bg-accent-soft text-small-strong text-accent-ink"
                : "bg-surface-raised text-small text-ink-muted hover:bg-surface-hover",
            )}
          >
            {ORDER_TEXT[value]}
          </button>
        );
      })}
    </div>
  );

  return (
    <ProvenanceLayout>
      <div className="flex flex-col gap-4.5 px-10 py-5.5">
        {timeline.isPending ? (
          <>
            <RangeCard order={order} control={orderControl} data={null} />
            <section className="rounded-lg border border-border-default bg-surface-raised px-6 py-5">
              <LoadingState what="Reading the timeline.">
                <Skeleton className="h-row-comfortable" />
                <Skeleton className="h-row-comfortable" />
                <Skeleton className="h-row-comfortable" />
              </LoadingState>
            </section>
          </>
        ) : timeline.isError ? (
          <ProblemNotice error={timeline.error} onRetry={() => void timeline.refetch()} />
        ) : timeline.data.total === 0 ? (
          <EmptyState title="No events yet">
            {scope.kind === "run"
              ? "This run recorded no evidence, so there is nothing to place in time. The run view lists what each source did and why."
              : "Nothing pinned to this case brings evidence with it yet, so there is nothing to place in time."}
          </EmptyState>
        ) : (
          <Events data={timeline.data} order={order} scope={scope} control={orderControl} />
        )}
      </div>
    </ProvenanceLayout>
  );
}

/** The earliest and latest of the given times, compared as instants (never taken from list order). */
function rangeOf(times: readonly string[]): { readonly from: string; readonly to: string } | null {
  let from: string | null = null;
  let to: string | null = null;
  for (const time of times) {
    const at = Date.parse(time);
    if (from === null || at < Date.parse(from)) from = time;
    if (to === null || at > Date.parse(to)) to = time;
  }
  return from === null || to === null ? null : { from, to };
}

function RangeCard({
  order,
  control,
  data,
}: {
  readonly order: TimeOrder;
  readonly control: ReactNode;
  readonly data: Timeline | null;
}) {
  const times = (data?.items ?? []).flatMap((event) => {
    const time = event[order];
    return time === null ? [] : [time];
  });
  const range = rangeOf(times);
  const missing =
    data === null
      ? null
      : order === "observedAt"
        ? data.withoutObservedAt
        : data.withoutCollectedAt;
  return (
    <section
      aria-label="Range"
      className="flex flex-wrap items-center gap-5.5 rounded-lg border border-border-default bg-surface-raised px-5 py-4"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-eyebrow text-ink-muted uppercase">
          {data?.hasMore === true ? `Range of the ${String(data.items.length)} shown` : "Range"}
        </p>
        <div className="font-mono text-mono-body text-ink-primary">
          {data === null ? (
            <Skeleton className="h-row-compact w-drawer max-w-full" />
          ) : range === null ? (
            <Unmeasured reason={NO_RANGE[order]} />
          ) : (
            <>
              <Instant iso={range.from} /> — <Instant iso={range.to} />
            </>
          )}
        </div>
      </div>
      <div className="flex grow items-center">{control}</div>
      {data === null || missing === null ? null : (
        <dl className="flex flex-wrap items-end gap-5.5 text-right">
          <div className="flex flex-col gap-1">
            <dt className="text-eyebrow text-ink-muted uppercase">Events</dt>
            <dd className="font-mono text-mono-body text-ink-primary">{String(data.total)}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-eyebrow text-ink-muted uppercase">{WITHOUT_TEXT[order]}</dt>
            <dd className="font-mono text-mono-body text-ink-primary">{String(missing)}</dd>
          </div>
        </dl>
      )}
      {data === null || range === null ? null : (
        <>
          <RangeStrip events={data.items} order={order} range={range} />
          <p className="basis-full text-caption text-ink-muted">
            Not built yet: choosing a span on the strip to narrow the events, and the count in that
            selection.
          </p>
        </>
      )}
    </section>
  );
}

function Events({
  data,
  order,
  scope,
  control,
}: {
  readonly data: Timeline;
  readonly order: TimeOrder;
  readonly scope: Scope;
  readonly control: ReactNode;
}) {
  const pinState = usePinState(scope);
  const dated = data.items.filter((event) => event[order] !== null);
  const undated = data.items.filter((event) => event[order] === null);
  const strengths = CLAIM_STRENGTH_LABELS.filter((strength) =>
    data.items.some((event) => event.strength === strength),
  );

  return (
    <>
      {data.hasMore ? (
        <CutListNotice shown={data.items.length} total={data.total} noun="events" />
      ) : null}
      <RangeCard order={order} control={control} data={data} />
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
        <p className="text-eyebrow text-ink-muted uppercase">Marker colours</p>
        <StrengthKey strengths={strengths} />
      </div>
      <section
        aria-label="Events"
        className="rounded-lg border border-border-default bg-surface-raised px-6 py-5"
      >
        {dated.length === 0 ? <p className="text-small text-ink-muted">{NO_RANGE[order]}</p> : null}
        <ol aria-label="Timeline" className="flex flex-col">
          {dated.map((event) => (
            <EventRow
              key={event.evidenceId}
              event={event}
              order={order}
              pinned={pinState({ type: "evidence", id: event.evidenceId })}
            />
          ))}
        </ol>
        {undated.length === 0 ? null : (
          <section className="mt-6 flex flex-col gap-2 border-t border-border-default pt-4">
            <h2 className="text-eyebrow text-ink-muted uppercase">
              Undated ({String(undated.length)})
            </h2>
            <p className="text-small text-ink-secondary">{UNDATED_TEXT[order]}</p>
            <ol aria-label="Undated events" className="flex flex-col">
              {undated.map((event) => (
                <EventRow
                  key={event.evidenceId}
                  event={event}
                  order={order}
                  pinned={pinState({ type: "evidence", id: event.evidenceId })}
                />
              ))}
            </ol>
          </section>
        )}
      </section>
    </>
  );
}

/** The date column: the date over the time, in the reader's local time with its zone. */
function When({ iso }: { readonly iso: string }) {
  const at = new Date(iso);
  return (
    <time dateTime={iso} className="flex flex-col">
      <span className="font-mono text-mono-body text-ink-primary">{at.toLocaleDateString()}</span>
      <span className="font-mono text-mono-caption text-ink-muted">
        {at.toLocaleTimeString(undefined, { timeZoneName: "short" })}
      </span>
    </time>
  );
}

function EventRow({
  event,
  order,
  pinned,
}: {
  readonly event: TimelineEvent;
  readonly order: TimeOrder;
  readonly pinned: true | null;
}) {
  const other: TimeOrder = order === "observedAt" ? "collectedAt" : "observedAt";
  const source = event.sourceLabel ?? event.collectorId;
  const when = event[order];
  return (
    <li className="flex gap-4.5">
      <div className="w-timeline-date shrink-0 text-right">
        {when === null ? (
          <span className="font-mono text-mono-caption text-ink-muted">undated</span>
        ) : (
          <When iso={when} />
        )}
      </div>
      <div aria-hidden="true" className="relative w-0.5 shrink-0 bg-border-subtle">
        <span
          className={cn(
            "absolute top-1 -left-1.25 size-3 rounded-pill border-2 bg-surface-raised",
            RING[event.strength],
          )}
        />
      </div>
      <div className="flex min-w-0 grow flex-col gap-1.25 pb-5.5">
        <div className="flex flex-wrap items-center gap-2.25">
          <ProvenanceLink
            target={{ kind: "evidence", id: event.evidenceId }}
            label={`Provenance of evidence from ${source}`}
            className="text-ui-strong text-ink-primary"
          >
            {event.sourceLabel ?? <span className="font-mono">{event.collectorId}</span>}
          </ProvenanceLink>
          <StrengthBadge strength={event.strength} size="sm" />
        </div>
        <p className="flex flex-wrap items-center gap-1 text-caption text-ink-muted">
          {plural(event.claimCount, "claim")} · {other === "collectedAt" ? "collected" : "observed"}{" "}
          <MaybeInstant iso={event[other]} missing={MISSING_TIME[other]} />
        </p>
      </div>
      <div className="shrink-0">
        <PinButton
          target={{ type: "evidence", id: event.evidenceId }}
          what={`evidence from ${source}`}
          pinned={pinned}
        />
      </div>
    </li>
  );
}

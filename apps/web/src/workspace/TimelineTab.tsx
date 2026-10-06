import { Button, ClaimStrength, cn, Panel } from "@repo/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Heading, Instant, MaybeInstant, MISSING_TIME, plural } from "../components/Values.tsx";
import { PinButton } from "./Pin.tsx";
import { ProvenanceLink } from "./Provenance.tsx";
import {
  timelineQuery,
  type Scope,
  type Timeline,
  type TimelineEvent,
  type TimeOrder,
} from "./queries.ts";
import { CutListNotice, Loaded, TableSkeleton } from "./states.tsx";

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

/** The Timeline tab (docs/design/mockups/Timeline.dc.html): the scope's evidence in time. */
export function TimelineTab({ scope }: { readonly scope: Scope }) {
  const [order, setOrder] = useState<TimeOrder>("observedAt");
  const timeline = useQuery(timelineQuery(scope, order));
  return (
    <div className="flex flex-col gap-4">
      <div role="group" aria-label="Order by" className="flex flex-wrap items-center gap-2">
        <span className="text-small text-ink-secondary">Order by</span>
        {(["observedAt", "collectedAt"] as const).map((value) => (
          <Button
            key={value}
            variant="secondary"
            aria-pressed={order === value}
            className={cn(order === value ? "bg-accent-soft text-accent-ink" : null)}
            onClick={() => {
              setOrder(value);
            }}
          >
            {ORDER_TEXT[value]}
          </Button>
        ))}
      </div>
      <Loaded query={timeline} loading={<TableSkeleton label="Reading the timeline" />}>
        {(data) => <Events data={data} order={order} scope={scope} />}
      </Loaded>
    </div>
  );
}

function Events({
  data,
  order,
  scope,
}: {
  readonly data: Timeline;
  readonly order: TimeOrder;
  readonly scope: Scope;
}) {
  if (data.total === 0) {
    return (
      <Panel className="text-body text-ink-secondary">
        {scope.kind === "run"
          ? "This run recorded no evidence, so there is nothing to place in time."
          : "Nothing pinned to this case brings evidence with it yet."}
      </Panel>
    );
  }
  const dated = data.items.filter((event) => event[order] !== null);
  const undated = data.items.filter((event) => event[order] === null);
  const missing = order === "observedAt" ? data.withoutObservedAt : data.withoutCollectedAt;

  return (
    <div className="flex flex-col gap-4">
      {data.hasMore ? (
        <CutListNotice shown={data.items.length} total={data.total} noun="events" />
      ) : null}
      <Panel className="flex flex-wrap gap-6">
        <div className="flex flex-col gap-1">
          <Heading>Events</Heading>
          <p className="font-mono text-metric text-ink-primary">{String(data.total)}</p>
        </div>
        <div className="flex flex-col gap-1">
          <Heading>Without {order === "observedAt" ? "an observed" : "a collection"} time</Heading>
          <p className="font-mono text-metric text-ink-primary">{String(missing)}</p>
        </div>
        {dated.length === 0 ? null : (
          <div className="flex flex-col gap-1">
            <Heading>Range shown</Heading>
            <p className="text-small text-ink-primary">
              <Instant iso={dated.at(-1)?.[order] ?? ""} /> to{" "}
              <Instant iso={dated[0]?.[order] ?? ""} />
            </p>
          </div>
        )}
      </Panel>
      <Panel>
        <ol aria-label="Timeline" className="flex flex-col">
          {dated.map((event) => (
            <EventRow key={event.evidenceId} event={event} order={order} />
          ))}
        </ol>
        {undated.length === 0 ? null : (
          <section className="mt-6 flex flex-col gap-2 border-t border-border-default pt-4">
            <Heading>Undated ({String(undated.length)})</Heading>
            <p className="text-small text-ink-secondary">{UNDATED_TEXT[order]}</p>
            <ol aria-label="Undated events" className="flex flex-col">
              {undated.map((event) => (
                <EventRow key={event.evidenceId} event={event} order={order} />
              ))}
            </ol>
          </section>
        )}
      </Panel>
    </div>
  );
}

function EventRow({ event, order }: { readonly event: TimelineEvent; readonly order: TimeOrder }) {
  const other: TimeOrder = order === "observedAt" ? "collectedAt" : "observedAt";
  const source = event.sourceLabel ?? event.collectorId;
  const when = event[order];
  return (
    <li className="flex items-start gap-4 border-b border-border-subtle py-3">
      <div className="w-1/5 shrink-0 text-right">
        {when === null ? (
          <span className="text-caption text-ink-muted">undated</span>
        ) : (
          <Instant iso={when} />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <ProvenanceLink
            target={{ kind: "evidence", id: event.evidenceId }}
            label={`Provenance of evidence from ${source}`}
            className="text-body-strong"
          >
            {event.sourceLabel ?? <span className="font-mono">{event.collectorId}</span>}
          </ProvenanceLink>
          <ClaimStrength strength={event.strength} />
        </div>
        <p className="flex flex-wrap items-center gap-1 text-caption text-ink-muted">
          {plural(event.claimCount, "claim")} · {other === "collectedAt" ? "collected" : "observed"}{" "}
          <MaybeInstant iso={event[other]} missing={MISSING_TIME[other]} />
        </p>
      </div>
      <PinButton
        target={{ type: "evidence", id: event.evidenceId }}
        what={`evidence from ${source}`}
      />
    </li>
  );
}

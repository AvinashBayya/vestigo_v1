import {
  ClaimStrength,
  CLAIM_STRENGTH_LABELS,
  EntityClassName,
  Notice,
  Panel,
  StatusChip,
  Unmeasured,
} from "@repo/ui";
import type { CollectorStatus } from "@repo/ui";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Heading, plural } from "../components/Values.tsx";
import { jobStatus, RUN_STATUS_TEXT } from "../run/progress.ts";
import { PinButton } from "./Pin.tsx";
import {
  casePinsQuery,
  entitiesQuery,
  LIST_LIMIT,
  runQuery,
  timelineQuery,
  type EntityList,
  type PinList,
  type RunRead,
  type Scope,
  type Timeline,
} from "./queries.ts";
import { Loaded, TableSkeleton } from "./states.tsx";

const ENTITIES_UNCOUNTED = `More than ${String(LIST_LIMIT)} entities: the entity list returns at most ${String(LIST_LIMIT)} and gives no total.`;
const STRENGTHS_UNCOUNTED = `Not counted: the evidence list is cut at ${String(LIST_LIMIT)} here, so a count over it would be short.`;

/** The run's status as a §3 chip. */
const RUN_CHIP: Readonly<Record<RunRead["status"], CollectorStatus>> = {
  QUEUED: "QUEUED",
  RUNNING: "RUNNING",
  SUCCEEDED: "RAN",
  PARTIAL: "PARTIAL",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
};

/** Statuses a job can end in that leave a gap, and why each is a gap. */
const GAP: Partial<Readonly<Record<CollectorStatus, string>>> = {
  FAILED: "Failed",
  NEEDS_KEY: "Needs a key",
  SKIPPED: "Refused by policy",
  CANCELLED: "Cancelled",
};

/**
 * The Overview tab, composed from existing reads (owner's decision Q5): the
 * evidence totals from the timeline, the entities from the entity list, and,
 * for a run, its sources from the run read. Nothing is summarised by a model
 * here, and nothing that was not counted is given a number.
 */
export function OverviewTab({ scope }: { readonly scope: Scope }) {
  const timeline = useQuery(timelineQuery(scope, "observedAt"));
  const entities = useQuery(entitiesQuery(scope));
  return (
    <div className="grid gap-6 lg:grid-cols-12">
      <div className="flex flex-col gap-6 lg:col-span-8">
        {scope.kind === "run" ? <RunSummary id={scope.id} /> : <CaseSummary id={scope.id} />}
        <Loaded
          query={timeline}
          loading={<TableSkeleton label="Reading the evidence totals" rows={2} />}
        >
          {(data) => (
            <Loaded
              query={entities}
              loading={<TableSkeleton label="Reading the entities" rows={2} />}
            >
              {(list) => <Totals timeline={data} entities={list} />}
            </Loaded>
          )}
        </Loaded>
      </div>
      <div className="flex flex-col gap-6 lg:col-span-4">
        <Loaded
          query={entities}
          loading={<TableSkeleton label="Reading the key entities" rows={3} />}
        >
          {(list) => <KeyEntities list={list} />}
        </Loaded>
      </div>
    </div>
  );
}

function Metric({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Heading>{label}</Heading>
      <div className="font-mono text-metric text-ink-primary">{children}</div>
    </div>
  );
}

function Totals({
  timeline,
  entities,
}: {
  readonly timeline: Timeline;
  readonly entities: EntityList;
}) {
  const byStrength = CLAIM_STRENGTH_LABELS.map((strength) => ({
    strength,
    count: timeline.items.filter((item) => item.strength === strength).length,
  })).filter((entry) => entry.count > 0);
  return (
    <Panel className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-8">
        <Metric label="Evidence records">{String(timeline.total)}</Metric>
        <Metric label="Entities">
          {entities.hasMore ? (
            <Unmeasured reason={ENTITIES_UNCOUNTED} />
          ) : (
            String(entities.items.length)
          )}
        </Metric>
        <Metric label="No observed time">{String(timeline.withoutObservedAt)}</Metric>
      </div>
      <div className="flex flex-col gap-2">
        <Heading>Evidence by strength</Heading>
        {timeline.hasMore ? (
          <p className="flex items-center gap-2 text-small text-ink-secondary">
            <Unmeasured reason={STRENGTHS_UNCOUNTED} /> Not counted past {String(LIST_LIMIT)}{" "}
            records.
          </p>
        ) : byStrength.length === 0 ? (
          <p className="text-small text-ink-muted">No evidence, so no strengths to count.</p>
        ) : (
          <ul className="flex flex-wrap gap-3">
            {byStrength.map(({ strength, count }) => (
              <li key={strength} className="flex items-center gap-1 text-small text-ink-primary">
                <span className="font-mono text-mono-caption">{String(count)}</span>
                <ClaimStrength strength={strength} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

function KeyEntities({ list }: { readonly list: EntityList }) {
  const top = list.items
    .filter((entity) => entity.mergedIntoEntityId === null)
    .toSorted((a, b) => b.claimCount - a.claimCount)
    .slice(0, 5);
  return (
    <Panel className="flex flex-col gap-3">
      <Heading>Key entities</Heading>
      <p className="text-caption text-ink-muted">
        Most claims among the{" "}
        {list.hasMore ? `first ${String(LIST_LIMIT)}` : String(list.items.length)} listed.
      </p>
      {top.length === 0 ? (
        <p className="text-small text-ink-muted">No entities yet.</p>
      ) : (
        <ul className="flex flex-col">
          {top.map((entity) => (
            <li
              key={entity.id}
              className="flex items-center gap-3 border-b border-border-subtle py-2"
            >
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-body-strong break-all">{entity.displayName}</span>
                <span className="flex flex-wrap items-center gap-2 text-caption text-ink-muted">
                  <EntityClassName entityClass={entity.kind} />
                  {plural(entity.claimCount, "claim")}
                </span>
              </div>
              {entity.strengths[0] === undefined ? null : (
                <ClaimStrength strength={entity.strengths[0]} />
              )}
              <PinButton target={{ type: "entity", id: entity.id }} what={entity.displayName} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function RunSummary({ id }: { readonly id: string }) {
  const run = useQuery(runQuery(id));
  return (
    <Loaded query={run} loading={<TableSkeleton label="Reading the run" rows={2} />}>
      {(data) => <RunCoverage run={data} />}
    </Loaded>
  );
}

function RunCoverage({ run }: { readonly run: RunRead }) {
  const statuses = run.jobs.map((job) => ({ job, status: jobStatus(job) }));
  // Each status present, with how many jobs have it.
  const counts = [...new Set(statuses.map(({ status }) => status))].map(
    (status) => [status, statuses.filter((entry) => entry.status === status).length] as const,
  );
  const gaps = statuses.filter(({ status }) => GAP[status] !== undefined);
  const excluded = run.plan !== null && "jobs" in run.plan ? run.plan.excluded : [];

  return (
    <Panel className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Heading>Coverage</Heading>
        <StatusChip status={RUN_CHIP[run.status]} className="ml-auto" />
      </div>
      <p className="text-body text-ink-primary">{RUN_STATUS_TEXT[run.status]}</p>
      {run.status === "PARTIAL" ? (
        <Notice>
          These results are partial: some sources failed, and what they would have found is not
          here. Each is listed below with its reason.
        </Notice>
      ) : null}
      <ul className="flex flex-wrap gap-2">
        {counts.map(([status, count]) => (
          <li key={status}>
            <StatusChip
              status={status}
            >{`${String(count)} ${status === "NEEDS_KEY" ? "need a key" : status.toLowerCase().replace("_", " ")}`}</StatusChip>
          </li>
        ))}
      </ul>
      {gaps.length === 0 && excluded.length === 0 ? null : (
        <section className="flex flex-col gap-2">
          <Heading>Gaps</Heading>
          <ul className="flex flex-col gap-2">
            {gaps.map(({ job, status }) => (
              <li key={job.id} className="flex flex-col gap-1 border-b border-border-subtle pb-2">
                <span className="flex flex-wrap items-center gap-2">
                  <StatusChip status={status} />
                  <span className="text-body-strong">{job.sourceLabel}</span>
                </span>
                <span className="text-small text-ink-secondary">
                  {job.error?.message ?? job.outcomeDetail ?? GAP[status]}
                  {job.error === null ? null : (
                    <span className="font-mono text-mono-caption"> ({job.error.code})</span>
                  )}
                </span>
              </li>
            ))}
            {excluded.map((entry) => (
              <li
                key={entry.collectorId}
                className="flex flex-col gap-1 border-b border-border-subtle pb-2"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-caption text-ink-muted">Not run</span>
                  <span className="font-mono text-mono-caption">{entry.collectorId}</span>
                </span>
                <span className="text-small text-ink-secondary">
                  {entry.message}{" "}
                  <span className="font-mono text-mono-caption">({entry.reason})</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Panel>
  );
}

function CaseSummary({ id }: { readonly id: string }) {
  const pins = useQuery(casePinsQuery(id));
  return (
    <Loaded query={pins} loading={<TableSkeleton label="Reading the pins" rows={2} />}>
      {(data) => <PinCounts pins={data} />}
    </Loaded>
  );
}

const PIN_WORDS: Readonly<Record<PinList["items"][number]["target"]["type"], [string, string]>> = {
  evidence: ["evidence record", "evidence records"],
  entity: ["entity", "entities"],
  claim: ["claim", "claims"],
  relationship: ["relationship", "relationships"],
};

function PinCounts({ pins }: { readonly pins: PinList }) {
  const types = Object.keys(PIN_WORDS) as (keyof typeof PIN_WORDS)[];
  return (
    <Panel className="flex flex-col gap-3">
      <Heading>Pinned to this case</Heading>
      {pins.items.length === 0 ? (
        <p className="text-body text-ink-secondary">
          Nothing is pinned yet. Pin evidence, entities, claims or relationships from a run's
          results; they appear here and in every tab of this case.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-6">
          {types.map((type) => {
            const count = pins.items.filter((pin) => pin.target.type === type).length;
            const [one, many] = PIN_WORDS[type];
            return (
              <li key={type} className="flex flex-col gap-1">
                <span className="font-mono text-metric text-ink-primary">
                  {pins.hasMore ? (
                    <Unmeasured
                      reason={`More than ${String(LIST_LIMIT)} pins: counted over the first ${String(LIST_LIMIT)} only, so a count here would be short.`}
                    />
                  ) : (
                    String(count)
                  )}
                </span>
                <span className="text-small text-ink-secondary">
                  {count === 1 && !pins.hasMore ? one : many}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

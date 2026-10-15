import {
  Card,
  CLAIM_STRENGTH_LABELS,
  CollectorList,
  EntityClassName,
  LoadingState,
  Notice,
  NotBuilt,
  RunStatusChip,
  Skeleton,
  StatusChip,
  StatusDot,
  StrengthBadge,
  Unmeasured,
  type CollectorRowItem,
  type CollectorStatus,
  type EntityClass,
} from "@repo/ui";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { collectorsQuery, DISCIPLINE_TEXT, type CollectorList as Registry } from "../collectors.ts";
import { plural } from "../components/Values.tsx";
import { jobStatus, RUN_STATUS_TEXT } from "../run/progress.ts";
import { NOT_APPLICABLE_REASON, type TargetType } from "../search/plan.ts";
import { PinButton } from "./Pin.tsx";
import {
  caseQuery,
  casePinsQuery,
  entitiesQuery,
  LIST_LIMIT,
  PIN_TYPES,
  PIN_WORDS,
  PINS_UNCOUNTED,
  runQuery,
  timelineQuery,
  type EntityList,
  type PinList,
  type RunRead,
  type Scope,
  type Timeline,
} from "./queries.ts";
import { Loaded, NOT_BUILT_BODY } from "./states.tsx";

const ENTITIES_UNCOUNTED = `More than ${String(LIST_LIMIT)} entities: the entity list returns at most ${String(LIST_LIMIT)} and gives no total.`;
const STRENGTHS_UNCOUNTED = `Not counted: the evidence list is cut at ${String(LIST_LIMIT)} here, so a count over it would be short.`;

/** Statuses a job can end in that leave a gap, and the word for each. */
const GAP: Partial<Readonly<Record<CollectorStatus, string>>> = {
  FAILED: "Failed",
  NEEDS_KEY: "Needs a key",
  SKIPPED: "Refused by policy",
  CANCELLED: "Cancelled",
};

/** Entity classes whose names are literal identifiers, set in mono (§4). */
const MONO_CLASSES: ReadonlySet<EntityClass> = new Set<EntityClass>([
  "DOMAIN",
  "IP_ADDRESS",
  "EMAIL_ADDRESS",
  "URL",
  "PHONE_NUMBER",
  "USERNAME",
]);

/**
 * The Overview tab (docs/design/mockups/Overview.dc.html), composed from
 * existing reads (owner's decision Q5): the evidence totals from the
 * timeline, the entities from the entity list, and, for a run, its sources
 * from the run read. Nothing is summarised by a model here, and nothing that
 * was not counted is given a number. What has no endpoint (the written
 * summary, contradictions) says so.
 */
export function OverviewTab({ scope }: { readonly scope: Scope }) {
  return (
    <div className="grid auto-rows-min grid-cols-1 gap-5 px-10 py-6 lg:grid-cols-12">
      <Summary scope={scope} />
      {scope.kind === "run" ? <Coverage id={scope.id} /> : <CasePins id={scope.id} />}
      <KeyEntities scope={scope} />
      <Card title="Contradictions" className="lg:col-span-4">
        <NotBuilt
          title="Where one source denies what another states"
          needs="It needs contradiction detection across sources, which the API does not have."
          className={NOT_BUILT_BODY}
        />
      </Card>
      {scope.kind === "run" ? <Gaps id={scope.id} /> : null}
    </div>
  );
}

function Metric({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-meta text-ink-muted">{label}</span>
      <span className="font-mono text-metric text-ink-primary">{children}</span>
    </div>
  );
}

function Summary({ scope }: { readonly scope: Scope }) {
  const timeline = useQuery(timelineQuery(scope, "observedAt"));
  const entities = useQuery(entitiesQuery(scope));
  return (
    <Card title={scope.kind === "run" ? "Run summary" : "Case summary"} className="lg:col-span-8">
      <div className="flex flex-col gap-4">
        {scope.kind === "case" ? <CaseDescription id={scope.id} /> : null}
        <NotBuilt
          title="Written summary"
          needs={`It needs a summary written by the model from the evidence, every sentence citing what it rests on, and the API has no summary endpoint for ${scope.kind === "run" ? "the Overview. The run's report, on the Report tab, has its own" : "a case"}.`}
          className={NOT_BUILT_BODY}
        />
        <Loaded query={timeline} loading={<SummarySkeleton what="Reading the evidence totals" />}>
          {(data) => (
            <Loaded query={entities} loading={<SummarySkeleton what="Reading the entities" />}>
              {(list) => <Totals timeline={data} entities={list} />}
            </Loaded>
          )}
        </Loaded>
      </div>
    </Card>
  );
}

function SummarySkeleton({ what }: { readonly what: string }) {
  return (
    <LoadingState what={what}>
      <Skeleton className="h-target" />
      <Skeleton className="h-target" />
    </LoadingState>
  );
}

/** A case's own description, when it has one. */
function CaseDescription({ id }: { readonly id: string }) {
  const caseRow = useQuery(caseQuery(id));
  const description = caseRow.data?.description ?? null;
  if (description === null) return null;
  return <p className="text-prose-small text-ink-secondary">{description}</p>;
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
    <div className="flex flex-col gap-4">
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
        <h3 className="text-meta text-ink-muted">Evidence records by strength</h3>
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
              <li key={strength} className="flex items-center gap-1.5">
                <span className="font-mono text-mono-meta text-ink-primary">{String(count)}</span>
                <StrengthBadge strength={strength} size="sm" />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function KeyEntities({ scope }: { readonly scope: Scope }) {
  const entities = useQuery(entitiesQuery(scope));
  return (
    <Card title="Key entities" className="lg:col-span-4">
      <Loaded query={entities} loading={<SummarySkeleton what="Reading the key entities" />}>
        {(list) => <KeyEntityList list={list} scope={scope} />}
      </Loaded>
    </Card>
  );
}

function KeyEntityList({ list, scope }: { readonly list: EntityList; readonly scope: Scope }) {
  const top = list.items
    .filter((entity) => entity.mergedIntoEntityId === null)
    .toSorted((a, b) => b.claimCount - a.claimCount)
    .slice(0, 5);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-caption text-ink-muted">
        Most claims among the{" "}
        {list.hasMore ? `first ${String(LIST_LIMIT)}` : String(list.items.length)} listed.
      </p>
      {top.length === 0 ? (
        <p className="text-prose-small text-ink-secondary">
          {scope.kind === "run"
            ? "No entities yet: nothing this run collected was about an identifiable thing."
            : "No entities yet: nothing pinned to this case names one."}
        </p>
      ) : (
        <ul className="flex flex-col">
          {top.map((entity) => (
            <li
              key={entity.id}
              className="flex min-h-target items-center gap-3 border-b border-border-subtle py-2 last:border-b-0"
            >
              <div className="flex min-w-0 grow flex-col gap-0.5">
                <span
                  className={
                    MONO_CLASSES.has(entity.kind)
                      ? "font-mono text-mono-meta break-all text-ink-primary"
                      : "text-ui-strong break-words text-ink-primary"
                  }
                >
                  {entity.displayName}
                </span>
                <span className="flex flex-wrap items-center gap-2 text-caption text-ink-muted">
                  <EntityClassName entityClass={entity.kind} />
                  {plural(entity.claimCount, "claim")}
                </span>
              </div>
              {entity.strengths.length === 0 ? (
                <span className="text-caption text-ink-muted">no claims, so no strength</span>
              ) : (
                // Every strength, never only the strongest: weak evidence must not look strong (§2).
                <ul className="flex flex-wrap justify-end gap-1" aria-label="Claim strengths">
                  {entity.strengths.map((strength) => (
                    <li key={strength}>
                      <StrengthBadge strength={strength} size="sm" />
                    </li>
                  ))}
                </ul>
              )}
              <PinButton target={{ type: "entity", id: entity.id }} what={entity.displayName} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The registry's collectors by id, or null while the registry is not read. */
function useRegistry(): ReadonlyMap<string, Registry["items"][number]> | null {
  const collectors = useQuery(collectorsQuery);
  if (collectors.data === undefined) return null;
  return new Map(collectors.data.items.map((item) => [item.id, item]));
}

function Coverage({ id }: { readonly id: string }) {
  const run = useQuery(runQuery(id));
  return (
    <Card
      title="Coverage"
      className="lg:col-span-4"
      end={run.data === undefined ? undefined : <RunStatusChip status={run.data.status} />}
    >
      <Loaded query={run} loading={<SummarySkeleton what="Reading the run" />}>
        {(data) => <RunCoverage run={data} />}
      </Loaded>
    </Card>
  );
}

/** The collectors the planner left out of a run, with why; none when the plan was refused. */
function excludedOf(run: RunRead) {
  return run.plan !== null && "jobs" in run.plan ? run.plan.excluded : [];
}

function RunCoverage({ run }: { readonly run: RunRead }) {
  const registry = useRegistry();
  const statuses = run.jobs.map((job) => ({ job, status: jobStatus(job) }));
  // Each status present, with how many jobs have it.
  const counts = [...new Set(statuses.map(({ status }) => status))].map(
    (status) => [status, statuses.filter((entry) => entry.status === status).length] as const,
  );
  const ran = statuses.filter(({ status }) => status === "RAN").length;
  const notRun = excludedOf(run).length;
  const items: CollectorRowItem[] = statuses.map(({ job, status }) => {
    const discipline = registry?.get(job.collectorId)?.discipline;
    const found = plural(job.evidenceIds.length, "evidence record");
    return {
      id: job.id,
      label: job.sourceLabel,
      status,
      meta: discipline === undefined ? found : `${DISCIPLINE_TEXT[discipline]} · ${found}`,
      failure: job.error === null ? undefined : job.error,
    };
  });
  return (
    <div className="flex flex-col gap-3">
      {run.status === "PARTIAL" ? (
        // One notice: the measured count in bold, then why. RUN_STATUS_TEXT says the same, so it is not repeated.
        <Notice>
          <strong className="text-body-strong">
            {`Partial: ${String(ran)} of ${String(statuses.length)} ran.`}
          </strong>{" "}
          Some sources failed, and what they would have found is not here. Each is listed below with
          its reason.
        </Notice>
      ) : (
        <p className="text-prose-small text-ink-primary">{RUN_STATUS_TEXT[run.status]}</p>
      )}
      {counts.length === 0 && notRun === 0 ? null : (
        <ul className="flex flex-wrap gap-2" aria-label="Sources by status">
          {counts.map(([status, count]) => (
            <li key={status}>
              <StatusChip
                status={status}
              >{`${String(count)} ${status === "NEEDS_KEY" ? "need a key" : status.toLowerCase().replace("_", " ")}`}</StatusChip>
            </li>
          ))}
          {notRun === 0 ? null : (
            <li>
              <StatusChip status="SKIPPED">{`${String(notRun)} not run`}</StatusChip>
            </li>
          )}
        </ul>
      )}
      {items.length === 0 ? (
        <p className="text-prose-small text-ink-secondary">No source was planned for this run.</p>
      ) : (
        <CollectorList items={items} />
      )}
    </div>
  );
}

function Gaps({ id }: { readonly id: string }) {
  const run = useQuery(runQuery(id));
  return (
    <Card title="Gaps to close" className="lg:col-span-4">
      <Loaded query={run} loading={<SummarySkeleton what="Reading the run" />}>
        {(data) => <GapList run={data} />}
      </Loaded>
    </Card>
  );
}

/** A kind of target with its article, for "Not applicable to a domain target". */
const TARGET_PHRASE: Readonly<Record<TargetType, string>> = {
  DOMAIN: "a domain",
  IP_ADDRESS: "an IP address",
  EMAIL_ADDRESS: "an email address",
  PHONE_NUMBER: "a phone number",
  USERNAME: "a username",
  ORGANIZATION: "an organisation",
  URL: "a URL",
  FILE: "a file",
  TOPIC: "a topic",
};

/** The kind of target a run was for: the analyst's choice, else what detection found. */
function runTargetType(run: RunRead): TargetType | null {
  if (run.plan === null || !("jobs" in run.plan)) return null;
  return run.plan.requestedType ?? run.plan.detected?.primaryType ?? null;
}

interface NotApplicable {
  readonly key: string;
  readonly label: ReactNode;
  readonly message: string;
  readonly targetType: TargetType | null;
}

/** Rows grouped by target type, in first-seen order. */
function groupByType(
  rows: readonly NotApplicable[],
): (readonly [TargetType | null, readonly NotApplicable[]])[] {
  const groups = new Map<TargetType | null, NotApplicable[]>();
  for (const row of rows) {
    const group = groups.get(row.targetType);
    if (group === undefined) groups.set(row.targetType, [row]);
    else group.push(row);
  }
  return [...groups];
}

function GapList({ run }: { readonly run: RunRead }) {
  const registry = useRegistry();
  const statuses = run.jobs.map((job) => ({ job, status: jobStatus(job) }));
  const runType = runTargetType(run);
  // A source that does not take this kind of target is not a gap anyone can close. It is
  // listed apart, after the real gaps, on one collapsed line saying how many and which:
  // never hidden without saying so.
  const notApplicableJob = (job: RunRead["jobs"][number]) =>
    job.error?.code === NOT_APPLICABLE_REASON;
  const gaps = statuses.filter(
    ({ job, status }) => GAP[status] !== undefined && !notApplicableJob(job),
  );
  const allExcluded = excludedOf(run);
  const excluded = allExcluded.filter((entry) => entry.reason !== NOT_APPLICABLE_REASON);
  const registryLabel = (collectorId: string): ReactNode =>
    registry?.get(collectorId)?.label ?? (
      <Unmeasured
        reason={
          registry === null
            ? "The collector registry could not be read, so this source has no label here."
            : "This collector is not in the platform registry, so it has no label."
        }
      />
    );
  const notApplicable: NotApplicable[] = [
    ...statuses
      .filter(({ job }) => notApplicableJob(job))
      .map(({ job }) => ({
        key: job.id,
        label: job.sourceLabel,
        message: job.error?.message ?? NOT_APPLICABLE_REASON,
        targetType: runType,
      })),
    ...allExcluded
      .filter((entry) => entry.reason === NOT_APPLICABLE_REASON)
      .map((entry) => ({
        key: entry.collectorId,
        label: registryLabel(entry.collectorId),
        message: entry.message,
        targetType: entry.targetType ?? runType,
      })),
  ];
  const pending = statuses.some(({ status }) => status === "RUNNING" || status === "QUEUED");

  return (
    <div className="flex flex-col gap-3">
      {gaps.length === 0 && excluded.length === 0 ? (
        <p className="text-prose-small text-ink-secondary">
          {pending
            ? "Sources still running are not gaps yet."
            : notApplicable.length === 0
              ? "Every planned source ran."
              : "Every source that takes this target ran."}
        </p>
      ) : (
        <ul aria-label="Gaps" className="flex flex-col gap-3">
          {gaps.map(({ job, status }) => (
            <li key={job.id} className="flex items-start gap-2.5">
              <StatusDot status={status} className="mt-1.5" />
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-ui-strong text-ink-primary">
                  {job.sourceLabel} · {GAP[status]}
                </span>
                <span className="text-small text-ink-secondary">
                  {job.error?.message ?? job.outcomeDetail ?? GAP[status]}
                </span>
                {job.error === null ? null : (
                  <span className="font-mono text-mono-caption text-ink-muted">
                    {job.error.code}
                  </span>
                )}
              </div>
            </li>
          ))}
          {excluded.map((entry) => (
            <li key={entry.collectorId} className="flex items-start gap-2.5">
              <StatusDot status="SKIPPED" className="mt-1.5" />
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-1 text-ui-strong text-ink-primary">
                  {registryLabel(entry.collectorId)} · Not run
                </span>
                <span className="text-small text-ink-secondary">{entry.message}</span>
                <span className="font-mono text-mono-caption text-ink-muted">{entry.reason}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {groupByType(notApplicable).map(([type, rows]) => (
        <details key={type ?? "unknown"} className="border-t border-border-subtle">
          <summary className="flex min-h-target cursor-pointer items-center text-ui text-ink-secondary">
            {`Not applicable to ${type === null ? "this" : TARGET_PHRASE[type]} target (${String(rows.length)})`}
          </summary>
          <ul className="flex flex-col gap-1 pb-1">
            {rows.map((row) => (
              <li key={row.key} className="text-caption text-ink-muted">
                <span className="text-ink-primary">{row.label}</span>: {row.message}
              </li>
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}

function CasePins({ id }: { readonly id: string }) {
  const pins = useQuery(casePinsQuery(id));
  return (
    <Card title="Pinned to this case" className="lg:col-span-4">
      <div className="flex flex-col gap-3">
        <p className="text-prose-small text-ink-secondary">
          A case holds what has been pinned to it, and what those pins stand on. It is not linked to
          the runs they came from.
        </p>
        <Loaded query={pins} loading={<SummarySkeleton what="Reading the pins" />}>
          {(data) => <PinCounts pins={data} />}
        </Loaded>
      </div>
    </Card>
  );
}

function PinCounts({ pins }: { readonly pins: PinList }) {
  if (pins.items.length === 0) {
    return (
      <p className="text-prose-small text-ink-secondary">
        Nothing is pinned yet. Pin evidence, entities, claims or relationships from a run's results;
        they appear here and in every tab of this case.
      </p>
    );
  }
  return (
    <ul className="flex flex-col">
      {PIN_TYPES.map((type) => {
        const count = pins.items.filter((pin) => pin.target.type === type).length;
        const [one, many] = PIN_WORDS[type];
        return (
          <li
            key={type}
            className="flex min-h-target items-center justify-between gap-3 border-b border-border-subtle last:border-b-0"
          >
            <span className="text-ui text-ink-secondary">
              {count === 1 && !pins.hasMore ? one : many}
            </span>
            <span className="font-mono text-mono-meta text-ink-primary">
              {pins.hasMore ? <Unmeasured reason={PINS_UNCOUNTED} /> : String(count)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

import {
  ArrivingNow,
  BackLink,
  Button,
  Card,
  CollectorList,
  ContextHeader,
  DashedNote,
  EmptyState,
  FailedAlert,
  LoadingState,
  MetricCard,
  LockDetail,
  RunStatusChip,
  Skeleton,
  StatusChip,
  Tag,
  TextLink,
  Unmeasured,
  type CollectorRowItem,
  type RunLock,
} from "@repo/ui";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { ApiProblem } from "../api.ts";
import { collectorsQuery, DISCIPLINE_TEXT, type Collector } from "../collectors.ts";
import { AccountButton } from "../components/Account.tsx";
import { CommandPaletteHost } from "../components/CommandPaletteHost.tsx";
import { ACCESS_NEXT_STEP, isAccessReason, LockedNotice } from "../components/LockedNotice.tsx";
import { Instant } from "../components/Values.tsx";
import { meQuery, type VettingStatus } from "../me.ts";
import { messageFor } from "../messages.ts";
import {
  arrivingRows,
  countChips,
  excludedRowItem,
  formatDuration,
  jobRowItem,
  jobRowStatus,
  notApplicableMessage,
  RUN_STATUS_TEXT,
  StreamDropped,
  type JobData,
  type LockedEventData,
  type RunData,
} from "../run/progress.ts";
import { useRunStream, type Connection } from "../run/useRunStream.ts";
import {
  exclusionStatus,
  NOT_APPLICABLE_REASON,
  TYPE_LABEL,
  type TargetType,
} from "../search/plan.ts";
import { sessionQuery } from "../session.ts";

/** Neither cost is recorded on a run yet; each says so rather than showing a number. */
const NO_ESTIMATE_RECORDED =
  "no collector declares a credit cost yet, and the run stores no estimate";
const NO_COST_RECORDED = "per-run cost metering is not built yet";
const NO_MODEL_RECORDED =
  "the run does not record a model; the model is named on each report when one is generated";

/** An organisation's vetting status in words, as /me states it. */
const VETTING_TEXT: Readonly<Record<VettingStatus, string>> = {
  NOT_SUBMITTED: "not submitted",
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  SUSPENDED: "suspended",
};

/** A refusal at connect that says the run does not exist (or is not this organisation's). */
const isNotFound = (error: unknown): boolean =>
  error instanceof ApiProblem && (error.status === 404 || error.code === "NOT_FOUND");

/**
 * A run's live progress (docs/design/mockups/RunLive.dc.html), full-bleed: the
 * run header, then every collector with its status and, in words, what it
 * found or why not; what has arrived; the cost; and the run's settings. Only
 * what the API states is shown.
 */
export function RunScreen({ runId }: { readonly runId: string }) {
  const { progress, connection, lastUpdate, reconnect } = useRunStream(runId);
  const { jobs, ended, locked } = progress;
  const dropped = connection.kind === "dropped" ? connection.error : undefined;
  // The run no longer exists (the stream said so), or never did (a 404 at connect).
  const gone = (ended !== null && ended.status === null) || isNotFound(dropped);
  // A lock on the stream, or a person-data refusal at connect.
  const refused = locked !== null || (dropped instanceof ApiProblem && dropped.locked !== null);
  // A refused (re)connection: a 401 or 403, with or without a Locked block. The
  // access that read what is held is no longer there, whatever the reason.
  const accessGone =
    refused ||
    (dropped instanceof ApiProblem && (dropped.status === 401 || dropped.status === 403));
  // A run that no longer exists, a lock, or a refused reconnect (CLAUDE.md §2,
  // §9: the access that read it is gone) leaves nothing received on screen:
  // never "as of" the check. REGRESSION (U1-c re-check): a refused reconnect
  // after a stream timeout left the earlier run on screen under the Locked notice.
  const run = gone || accessGone ? null : progress.run;
  // Nothing has said what the run is yet, and nothing has stopped it saying so.
  // A stream that closed before saying it never will: that is not loading.
  const waiting =
    run === null &&
    !gone &&
    locked === null &&
    connection.kind !== "dropped" &&
    connection.kind !== "closed";
  const closedEarly = run === null && !gone && locked === null && connection.kind === "closed";
  const collectors = useQuery(collectorsQuery);
  const byId = new Map((collectors.data?.items ?? []).map((item) => [item.id, item]));

  return (
    <div className="flex min-h-screen flex-col bg-surface-page">
      {/* Full-bleed, so no app frame mounts the palette: Ctrl/⌘K works here too. */}
      <CommandPaletteHost button={false} />
      <RunHeader runId={runId} run={run} loading={waiting} results={!gone && !accessGone} />
      <main className="flex flex-1 flex-col gap-6 px-4 py-6 sm:px-9">
        <PageNotice
          connection={connection}
          locked={locked}
          gone={gone}
          holding={run !== null}
          lastUpdate={lastUpdate}
          onReconnect={reconnect}
        />
        {run === null ? (
          waiting ? (
            <RunSkeleton connection={connection} />
          ) : closedEarly ? (
            <EmptyState
              title="The run's details did not arrive"
              action={
                <Button variant="secondary" size="md" onClick={reconnect}>
                  Reconnect
                </Button>
              }
            >
              {WAITING_TEXT.closed} Nothing about this run is shown, so nothing here is stale.
            </EmptyState>
          ) : null
        ) : (
          <RunBody
            run={run}
            jobs={jobs}
            byId={byId}
            collectors={collectors}
            live={connection.kind === "live"}
            lastUpdate={lastUpdate}
          />
        )}
      </main>
    </div>
  );
}

/** The current time, ticking each second while `ticking`, for an elapsed time still growing. */
function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    // Ticking resumes (a reconnect): the time held from before is stale, so refresh at once.
    const resume = setTimeout(() => {
      setNow(Date.now());
    }, 0);
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearTimeout(resume);
      clearInterval(timer);
    };
  }, [ticking]);
  return now;
}

const planOf = (run: RunData | null) =>
  run !== null && run.plan !== null && "input" in run.plan ? run.plan : null;

/**
 * §9 Run view header (RunLive): back to Search, the target in mono, what it
 * was taken as and its alternates, then the run's status, the way to its
 * results, and the account menu (full-bleed, so no app header holds it).
 * "Open case" and "Pause" are not shown: runs are not linked to cases, and
 * pausing is not built.
 */
function RunHeader({
  runId,
  run,
  loading,
  results,
}: {
  readonly runId: string;
  readonly run: RunData | null;
  readonly loading: boolean;
  /** Whether "View results" can lead anywhere: not for a run that is gone, nor behind a lock. */
  readonly results: boolean;
}) {
  const plan = planOf(run);
  let title: ReactNode;
  if (plan !== null) {
    title = plan.input;
  } else if (loading) {
    title = (
      <>
        <span className="sr-only">Run</span>
        <Skeleton className="h-5 w-16" />
      </>
    );
  } else {
    // The run has not stated a target (not planned yet, or planning failed): none is shown.
    title = <span className="font-sans text-ui text-ink-muted">Run</span>;
  }
  const type =
    plan === null
      ? null
      : plan.requestedType !== null
        ? `Chosen: ${TYPE_LABEL[plan.requestedType].toLowerCase()}`
        : plan.detected === null
          ? null
          : `Detected: ${TYPE_LABEL[plan.detected.primaryType].toLowerCase()}`;
  const alternates =
    plan === null || plan.detected === null || plan.detected.alternateTypes.length === 0
      ? null
      : plan.detected.alternateTypes.map((entry) => TYPE_LABEL[entry].toLowerCase()).join(", ");

  return (
    <ContextHeader
      kind="run"
      back={
        <BackLink asChild chevron={false}>
          <Link to="/">Search</Link>
        </BackLink>
      }
      title={title}
      meta={
        type === null && alternates === null ? undefined : (
          <>
            {type === null ? null : <Tag>{type}</Tag>}
            {alternates === null ? null : (
              <span className="text-caption text-ink-muted">alternates: {alternates}</span>
            )}
          </>
        )
      }
      actions={
        <>
          {run === null ? null : <RunStatusChip status={run.status} />}
          {results ? (
            <TextLink asChild>
              <Link to="/runs/$runId/$tab" params={{ runId, tab: "overview" }}>
                View results
              </Link>
            </TextLink>
          ) : null}
        </>
      }
      account={<AccountButton />}
    />
  );
}

/** What the skeleton waits for, by where the connection stands (a dropped one shows no skeleton). */
const WAITING_TEXT: Readonly<Record<Connection["kind"], string>> = {
  connecting: "Connecting to the run.",
  live: "Connected. Waiting for the run's details.",
  closed: "The stream closed before it sent the run's details.",
  dropped: "The stream stopped before it sent the run's details.",
};

function RunSkeleton({ connection }: { readonly connection: Connection }) {
  return (
    <LoadingState what={WAITING_TEXT[connection.kind]}>
      <div className="grid grid-cols-1 gap-5.5 lg:grid-cols-12">
        <div className="flex flex-col gap-4 lg:col-span-8">
          <Card label="Run summary" padding="run" className="gap-2">
            <Skeleton className="h-5 w-1/4" />
            <Skeleton className="h-4 w-1/2" />
          </Card>
          <Card label="Collectors" padding="run" className="gap-2">
            {[0, 1, 2, 3].map((row) => (
              <Skeleton key={row} className="h-row-comfortable" />
            ))}
          </Card>
        </div>
        <div className="flex flex-col gap-4 lg:col-span-4">
          {["Arriving now", "Cost", "Run settings"].map((name) => (
            <Card key={name} label={name} padding="run" className="gap-2">
              <Skeleton className="h-5 w-1/3" />
              <Skeleton className="h-5" />
            </Card>
          ))}
        </div>
      </div>
    </LoadingState>
  );
}

/**
 * The page's notice slot: a run that no longer exists, a lock that came
 * before any run, a refused connection, or a dropped stream (§8 Failed and
 * Stale: what is shown stays, as of the last update, never marked finished).
 */
function PageNotice({
  connection,
  locked,
  gone,
  holding,
  lastUpdate,
  onReconnect,
}: {
  readonly connection: Connection;
  /** The lock the stream closed with: it takes the place of everything the stream sent. */
  readonly locked: LockedEventData | null;
  /** The run no longer exists, or the API found none at connect: no reconnect can change that. */
  readonly gone: boolean;
  /** Whether a run received earlier is on screen. */
  readonly holding: boolean;
  readonly lastUpdate: Date | null;
  readonly onReconnect: () => void;
}) {
  if (gone) {
    return (
      <EmptyState
        title="Run not found"
        action={
          <TextLink asChild>
            <Link to="/">Start a search</Link>
          </TextLink>
        }
      >
        {connection.kind === "dropped"
          ? "There is no run with this ID in your organisation, so there is nothing to show."
          : "This run no longer exists, so there is nothing more to show."}
      </EmptyState>
    );
  }
  if (locked !== null) return <RunLockCard locked={locked} />;
  if (connection.kind === "connecting" && holding && lastUpdate !== null) {
    // What is on screen came before this connection: it never reads as current.
    return (
      <p role="status" className="text-meta text-ink-secondary">
        Reconnecting… shown as of <Instant iso={lastUpdate.toISOString()} />
      </p>
    );
  }
  if (connection.kind !== "dropped") return null;
  const { error } = connection;
  // A refusal by the person-data gate at connect is the Locked state, not a failure.
  if (error instanceof ApiProblem && error.locked !== null) {
    return <LockedNotice locked={error.locked} />;
  }
  const failure =
    error instanceof StreamDropped
      ? { title: "Live updates stopped.", reason: error.message, code: error.code }
      : (() => {
          const message = messageFor(error);
          return { title: "Could not follow this run.", reason: message.text, code: message.code };
        })();
  return (
    <FailedAlert
      title={failure.title}
      reason={failure.reason}
      code={failure.code}
      action={
        <Button variant="secondary" size="md" onClick={onReconnect}>
          Reconnect
        </Button>
      }
    >
      <p className="text-meta text-ink-secondary">
        The run goes on without this page.{" "}
        {lastUpdate === null ? (
          "Nothing had been received yet."
        ) : (
          <>
            What is shown below is as of <Instant iso={lastUpdate.toISOString()} />.
          </>
        )}
      </p>
    </FailedAlert>
  );
}

/**
 * The Locked state for a stream closed by a lock (§3 Locked, §8 Locked:
 * neutral, never a failure, no reconnect). Everything the stream had sent is
 * withheld, whatever the reason: the access that read it is gone. The lock
 * says why (LockDetail: the reason in words, the API's Locked block where the
 * event carries one, and the code, once), and the next step.
 */
function RunLockCard({ locked }: { readonly locked: LockedEventData }) {
  const lock: RunLock = {
    reason: locked.reason,
    code: locked.code,
    detail: locked.detail,
    locked: locked.locked,
    recheckIntervalMs: locked.recheckIntervalMs,
    checkedAt: <Instant iso={locked.checkedAt} />,
  };
  const step = isAccessReason(locked.reason) ? ACCESS_NEXT_STEP[locked.reason] : null;
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-lg border border-border-default bg-surface-raised px-5 py-4.5"
    >
      <StatusChip status="LOCKED" />
      <div className="flex min-w-0 flex-col gap-2">
        <p className="text-ui text-ink-primary">
          Live updates for this run are withheld. Nothing it had sent is shown.
        </p>
        <LockDetail lock={lock} />
        {step === null ? null : step.link === null ? (
          <p className="text-ui-strong text-ink-primary">{step.text}</p>
        ) : (
          <p>
            <TextLink asChild>
              <Link to={step.link}>{step.text}</Link>
            </TextLink>
          </p>
        )}
      </div>
    </div>
  );
}

const excludedOf = (run: RunData) =>
  run.plan !== null && "excluded" in run.plan ? run.plan.excluded : [];

/** The types the plan read the target as, valid ones only (as the planner matches them), once each. */
const targetTypesOf = (run: RunData): TargetType[] =>
  run.plan !== null && "targets" in run.plan
    ? [
        ...new Set(
          run.plan.targets.filter((target) => "value" in target).map((target) => target.type),
        ),
      ]
    : [];

function RunBody({
  run,
  jobs,
  byId,
  collectors,
  live,
  lastUpdate,
}: {
  readonly run: RunData;
  readonly jobs: readonly JobData[];
  readonly byId: ReadonlyMap<string, Collector>;
  readonly collectors: { readonly isPending: boolean; readonly isError: boolean };
  readonly live: boolean;
  readonly lastUpdate: Date | null;
}) {
  const jobRows: CollectorRowItem[] = jobs.map((job) => {
    const collector = byId.get(job.collectorId);
    return jobRowItem(job, collector === undefined ? null : DISCIPLINE_TEXT[collector.discipline]);
  });
  const excluded = excludedOf(run);
  const targetTypes = targetTypesOf(run);
  const excludedRows = excluded.map((row, index) => {
    const collector = byId.get(row.collectorId);
    // A source that does not take this kind of target says so in type words, never type codes.
    const stated =
      row.reason === NOT_APPLICABLE_REASON
        ? { ...row, message: notApplicableMessage(targetTypes, collector?.targetTypes ?? null) }
        : row;
    return excludedRowItem(
      stated,
      index,
      row.reason === NOT_APPLICABLE_REASON ? "SKIPPED" : exclusionStatus(row.reason),
      collector === undefined
        ? undefined
        : { label: collector.label, discipline: DISCIPLINE_TEXT[collector.discipline] },
    );
  });

  return (
    <div className="grid grid-cols-1 gap-5.5 lg:grid-cols-12">
      <div className="flex flex-col gap-4 lg:col-span-8">
        <SummaryCard
          run={run}
          jobs={jobs}
          rowStatuses={jobRows.map((row) => row.status)}
          excludedCount={excluded.length}
          live={live}
          lastUpdate={lastUpdate}
        />
        <Card title="Collectors" padding="none">
          <div className="flex flex-col gap-2 border-t border-border-subtle px-2 py-1">
            {jobRows.length === 0 && excludedRows.length === 0 ? (
              <EmptyState title="No collectors planned" className="my-2 border-none">
                No source was planned for this run.
              </EmptyState>
            ) : (
              <CollectorList items={[...jobRows, ...excludedRows]} className="py-1" />
            )}
          </div>
        </Card>
      </div>
      <div className="flex flex-col gap-4 lg:col-span-4">
        <ArrivingNow rows={arrivingRows(jobs)} titleLevel={2} />
        <MetricCard
          title="Cost"
          titleLevel={2}
          rows={[
            {
              label: "Estimated before run",
              value: { kind: "unavailable", reason: NO_ESTIMATE_RECORDED, cause: "not-recorded" },
            },
            {
              label: "Spent so far",
              value: { kind: "unavailable", reason: NO_COST_RECORDED, cause: "not-recorded" },
            },
          ]}
        />
        <SettingsCard jobs={jobs} byId={byId} collectors={collectors} />
        <DashedNote>
          Nothing is inferred to fill a gap. A collector that failed is shown as failed, and the
          counts it would have produced stay unmeasured.
        </DashedNote>
      </div>
    </div>
  );
}

function SummaryCard({
  run,
  jobs,
  rowStatuses,
  excludedCount,
  live,
  lastUpdate,
}: {
  readonly run: RunData;
  readonly jobs: readonly JobData[];
  readonly rowStatuses: readonly CollectorRowItem["status"][];
  readonly excludedCount: number;
  readonly live: boolean;
  readonly lastUpdate: Date | null;
}) {
  const growing = run.finishedAt === null && run.startedAt !== null;
  // Ticks only while the stream is live: a stream that stopped says nothing about now.
  const now = useNow(growing && live);
  const settled = jobs.filter((job) => !["QUEUED", "RUNNING"].includes(jobRowStatus(job))).length;
  // Elapsed only where it was measured: from the run's recorded start to its
  // recorded finish; else to now while live; else to the last update received.
  const until =
    run.finishedAt !== null
      ? Date.parse(run.finishedAt)
      : live
        ? now
        : (lastUpdate?.getTime() ?? null);
  const elapsed =
    run.startedAt === null || until === null ? null : until - Date.parse(run.startedAt);
  const frozen = growing && !live;
  const chips = countChips(rowStatuses, excludedCount);

  return (
    <Card label="Run summary" padding="run" className="gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1.25">
          <p className="text-subtitle text-ink-primary">{RUN_STATUS_TEXT[run.status]}</p>
          <p className="text-meta text-ink-muted">
            {settled} of {jobs.length} collectors settled ·{" "}
            {run.startedAt === null
              ? "not started yet"
              : elapsed === null
                ? "elapsed not measured"
                : `elapsed ${formatDuration(elapsed)}${frozen ? " as of the last update" : ""}`}
          </p>
        </div>
        {chips.length === 0 ? null : (
          <div className="flex flex-wrap gap-2">
            {chips.map((chip) => (
              <StatusChip key={chip.text} status={chip.status}>
                {chip.text}
              </StatusChip>
            ))}
          </div>
        )}
      </div>
      {run.finishedAt !== null && !run.settled ? (
        <p className="text-meta text-ink-secondary">
          Every source has finished; their results are still being merged.
        </p>
      ) : null}
      {run.plan !== null && "error" in run.plan ? (
        <FailedAlert
          title="The run could not be planned"
          reason={run.plan.error.message}
          code={run.plan.error.code}
        />
      ) : null}
      {live ? (
        <p className="text-meta text-ink-secondary">
          Live: this page updates as each source finishes.
        </p>
      ) : null}
    </Card>
  );
}

/** How the run collects, what the organisation's plan allows, and the model: each as the API states it. */
function SettingsCard({
  jobs,
  byId,
  collectors,
}: {
  readonly jobs: readonly JobData[];
  readonly byId: ReadonlyMap<string, Collector>;
  readonly collectors: { readonly isPending: boolean; readonly isError: boolean };
}) {
  const { data: session } = useSuspenseQuery(sessionQuery);
  const tenantId = session.state === "SIGNED_IN" ? session.activeTenantId : null;
  const me = useQuery({ ...meQuery(tenantId ?? "none"), enabled: tenantId !== null });

  const modes = jobs.map((job) => byId.get(job.collectorId)?.collectionMode);
  let collection: ReactNode;
  if (collectors.isPending) {
    collection = <Skeleton className="h-5 w-16" />;
  } else if (collectors.isError || modes.some((mode) => mode === undefined)) {
    collection = (
      <Unmeasured reason="The collector list could not be read, or does not list every source in this run." />
    );
  } else if (modes.length === 0) {
    collection = <Tag mono={false}>No source ran</Tag>;
  } else {
    // Every mode but ACTIVE reads a third party's record and never contacts the target.
    collection = (
      <Tag mono={false}>
        {modes.includes("ACTIVE") ? "Includes active collection" : "Passive only"}
      </Tag>
    );
  }

  let person: ReactNode;
  if (me.data === undefined) {
    person = me.isError ? (
      <Unmeasured reason="Your organisation's plan could not be read." />
    ) : (
      <Skeleton className="h-5 w-16" />
    );
  } else {
    // The facts /me states, never a verdict: whether person modules are open
    // is an access decision, made in packages/access (CLAUDE.md §6, §9).
    const { planModules, vettingStatus } = me.data.tenant;
    person = (
      <span className="ml-auto text-right text-meta text-ink-secondary">
        Plan: {planModules.length === 0 ? "no modules" : planModules.join(", ")} · Vetting:{" "}
        {VETTING_TEXT[vettingStatus]}
      </span>
    );
  }

  return (
    <Card title="Run settings" padding="run" className="gap-3">
      <dl className="flex flex-col gap-3">
        <SettingRow label="Collection mode" value={collection} />
        <SettingRow label="Person modules" value={person} />
        {/* As the Cost rows: the em dash, and why in words beneath it. */}
        <SettingRow
          label="Model"
          value={
            <>
              <span aria-hidden="true" className="ml-auto font-sans text-body text-ink-muted">
                —
              </span>
              <span className="sr-only">Not measured — {NO_MODEL_RECORDED}</span>
              <span aria-hidden="true" className="basis-full text-caption text-ink-muted">
                Not measured — {NO_MODEL_RECORDED}
              </span>
            </>
          }
        />
      </dl>
    </Card>
  );
}

/** One setting: label and value on a shared baseline, the value at the end of the line. */
function SettingRow({ label, value }: { readonly label: string; readonly value: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <dt className="text-ui text-ink-primary">{label}</dt>
      <dd className="contents">{value}</dd>
    </div>
  );
}

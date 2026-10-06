import { Button, cn, Notice, Panel, Skeleton, StatusChip, Unmeasured } from "@repo/ui";
import type { CollectorStatus } from "@repo/ui";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { ApiProblem } from "../api.ts";
import { collectorsQuery, DISCIPLINE_TEXT, type Collector } from "../collectors.ts";
import { AppShell } from "../components/AppShell.tsx";
import { AccessLockedNotice, isAccessReason, LockedNotice } from "../components/LockedNotice.tsx";
import { ProblemNotice } from "../components/ProblemNotice.tsx";
import { meQuery } from "../me.ts";
import {
  durationBetween,
  formatDuration,
  jobStatus,
  RUN_STATUS_TEXT,
  StreamDropped,
  type JobData,
  type LockedEventData,
  type RunData,
  type RunStatus,
} from "../run/progress.ts";
import { useRunStream, type Connection } from "../run/useRunStream.ts";
import { exclusionStatus, NOT_APPLICABLE_REASON, TYPE_LABEL } from "../search/plan.ts";
import { sessionQuery } from "../session.ts";
import { WorkspaceTabs } from "../workspace/Workspace.tsx";

/** Neither cost is recorded on a run yet; each says so rather than showing a number. */
const NO_ESTIMATE_RECORDED =
  "This run does not record a cost estimate. Estimates are made before a run starts, and none is stored with it.";
const NO_COST_RECORDED =
  "This run does not record what it cost: per-run cost metering is not built yet.";

/** A run's status as a §3 chip; a run that finished with every source succeeding ran. */
const RUN_CHIP: Readonly<Record<RunStatus, CollectorStatus>> = {
  QUEUED: "QUEUED",
  RUNNING: "RUNNING",
  SUCCEEDED: "RAN",
  PARTIAL: "PARTIAL",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
};

/** The status dot beside a source: the chip's colour, never its only sign. */
const DOT: Readonly<Record<CollectorStatus, string>> = {
  RAN: "bg-claim-observed-mark",
  PARTIAL: "bg-claim-observed-mark",
  READY: "bg-claim-observed-mark",
  RUNNING: "bg-accent",
  FAILED: "bg-status-failed-mark",
  NEEDS_KEY: "bg-claim-inferred-mark",
  SKIPPED: "bg-ink-muted",
  HELD: "bg-ink-muted",
  QUEUED: "bg-ink-muted",
  CANCELLED: "bg-ink-muted",
};

/** How each status is counted in the summary: the word stays the status's own. */
const COUNT_WORD: Readonly<Record<CollectorStatus, string>> = {
  RAN: "ran",
  RUNNING: "running",
  QUEUED: "queued",
  FAILED: "failed",
  NEEDS_KEY: "need a key",
  SKIPPED: "skipped",
  CANCELLED: "cancelled",
  PARTIAL: "partial",
  HELD: "held",
  READY: "ready",
};

/** The statuses a job can have, in the order the summary counts them. */
const JOB_CHIP_ORDER: readonly CollectorStatus[] = [
  "RAN",
  "RUNNING",
  "QUEUED",
  "FAILED",
  "NEEDS_KEY",
  "SKIPPED",
  "CANCELLED",
];

const plural = (count: number, word: string) => `${String(count)} ${word}${count === 1 ? "" : "s"}`;

/**
 * A run's live progress (docs/design/mockups/RunLive.dc.html): every source
 * with its status and, in words, what it found or why not; what has arrived;
 * the cost; and the run's settings. Only what the API states is shown.
 */
export function RunScreen({ runId }: { readonly runId: string }) {
  const { progress, connection, lastUpdate, reconnect } = useRunStream(runId);
  const { run, jobs, ended, locked } = progress;
  const collectors = useQuery(collectorsQuery);
  const byId = new Map((collectors.data?.items ?? []).map((item) => [item.id, item]));

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <RunHeader run={run} />
        <WorkspaceTabs scope={{ kind: "run", id: runId }} tab="progress" />
        <ConnectionNotice
          connection={connection}
          locked={locked}
          runGone={ended !== null && ended.status === null}
          lastUpdate={lastUpdate}
          onReconnect={reconnect}
        />
        {run === null ? (
          connection.kind === "connecting" ? (
            <RunSkeleton />
          ) : null
        ) : (
          <div className="grid gap-6 lg:grid-cols-12">
            <div className="flex flex-col gap-6 lg:col-span-8">
              <SummaryPanel run={run} jobs={jobs} live={connection.kind === "live"} />
              <SourcesPanel run={run} jobs={jobs} byId={byId} />
            </div>
            <div className="flex flex-col gap-6 lg:col-span-4">
              <ArrivingPanel jobs={jobs} />
              <Panel className="flex flex-col gap-3">
                <Heading>Cost</Heading>
                <CostLine label="Estimated before the run" reason={NO_ESTIMATE_RECORDED} />
                <CostLine label="Spent so far" reason={NO_COST_RECORDED} />
              </Panel>
              <SettingsPanel jobs={jobs} byId={byId} collectorsFailed={collectors.isError} />
              <p className="rounded-lg border border-dashed border-border-strong p-4 text-small text-ink-secondary">
                Nothing is inferred to fill a gap. A source that failed is shown as failed, and what
                it would have found stays unmeasured.
              </p>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function Heading({ children }: { readonly children: ReactNode }) {
  return <h2 className="text-eyebrow uppercase text-ink-muted">{children}</h2>;
}

/** An instant in the reader's local time, in mono, with the exact value for machines. */
function Instant({ iso }: { readonly iso: string }) {
  return (
    <time dateTime={iso} className="font-mono text-mono-caption">
      {new Date(iso).toLocaleString()}
    </time>
  );
}

/** The current time, ticking each second while `ticking`, for an elapsed time still growing. */
function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [ticking]);
  return now;
}

function RunSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Connecting to the run">
      {[0, 1].map((panel) => (
        <Panel key={panel} className="flex flex-col gap-3">
          <Skeleton className="h-5 w-1/4" />
          <Skeleton className="h-target" />
          <Skeleton className="h-target" />
        </Panel>
      ))}
    </div>
  );
}

/** Back to search, the target, what it was taken as, and the run's status. */
function RunHeader({ run }: { readonly run: RunData | null }) {
  const plan = run !== null && run.plan !== null && "input" in run.plan ? run.plan : null;
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-border-default pb-4">
      <Button variant="quiet" asChild>
        <Link to="/">Search</Link>
      </Button>
      {plan === null ? null : (
        <>
          <p className="font-mono text-mono-body text-ink-primary">{plan.input}</p>
          {plan.requestedType !== null ? (
            <span className="inline-flex rounded-pill bg-accent-soft px-3 py-1 text-caption text-accent-ink">
              Chosen: {TYPE_LABEL[plan.requestedType].toLowerCase()}
            </span>
          ) : plan.detected === null ? null : (
            <span className="inline-flex rounded-pill bg-accent-soft px-3 py-1 text-caption text-accent-ink">
              Detected: {TYPE_LABEL[plan.detected.primaryType].toLowerCase()}
            </span>
          )}
          {plan.detected === null || plan.detected.alternateTypes.length === 0 ? null : (
            <p className="text-small text-ink-muted">
              alternates:{" "}
              {plan.detected.alternateTypes
                .map((type) => TYPE_LABEL[type].toLowerCase())
                .join(", ")}
            </p>
          )}
        </>
      )}
      {run === null ? null : <StatusChip className="ml-auto" status={RUN_CHIP[run.status]} />}
    </div>
  );
}

function ConnectionNotice({
  connection,
  locked,
  runGone,
  lastUpdate,
  onReconnect,
}: {
  readonly connection: Connection;
  readonly locked: LockedEventData | null;
  readonly runGone: boolean;
  readonly lastUpdate: Date | null;
  readonly onReconnect: () => void;
}) {
  if (locked !== null) {
    // A policy decision, not a dropped connection: no reconnect is offered.
    if (locked.locked !== null) return <LockedNotice locked={locked.locked} />;
    if (isAccessReason(locked.reason)) {
      return (
        <AccessLockedNotice
          reason={locked.reason}
          code={locked.code}
          detail={locked.detail}
          asOf={locked.checkedAt}
        />
      );
    }
    // A person-data reason always carries its Locked block; if one ever arrives
    // without it, show the API's own words rather than writing a next step.
    return (
      <Notice className="flex flex-col gap-1">
        <p className="text-eyebrow uppercase">Locked</p>
        <p>{locked.detail}</p>
        <p className="font-mono text-mono-caption">
          Reason: {locked.reason} · Code: {locked.code}
        </p>
      </Notice>
    );
  }
  if (runGone) {
    return (
      <Notice tone="failure">This run no longer exists, so there is nothing more to show.</Notice>
    );
  }
  if (connection.kind !== "dropped") return null;
  const { error } = connection;
  if (error instanceof ApiProblem && error.locked !== null) return <ProblemNotice error={error} />;
  return (
    <div className="flex flex-col gap-2">
      {error instanceof StreamDropped ? (
        <Notice tone="failure" className="flex flex-col gap-1">
          <p>Live updates stopped. {error.message}</p>
          <p className="font-mono text-mono-caption">Code: {error.code}</p>
        </Notice>
      ) : (
        <ProblemNotice error={error} />
      )}
      <p className="text-small text-ink-secondary">
        The run goes on without this page.{" "}
        {lastUpdate === null ? (
          "Nothing had been received yet."
        ) : (
          <>
            What is shown below is as of{" "}
            <time dateTime={lastUpdate.toISOString()} className="font-mono text-mono-caption">
              {lastUpdate.toLocaleTimeString()}
            </time>
            .
          </>
        )}
      </p>
      <p>
        <Button variant="secondary" onClick={onReconnect}>
          Reconnect
        </Button>
      </p>
    </div>
  );
}

const excludedOf = (run: RunData) =>
  run.plan !== null && "excluded" in run.plan ? run.plan.excluded : [];

function SummaryPanel({
  run,
  jobs,
  live,
}: {
  readonly run: RunData;
  readonly jobs: readonly JobData[];
  readonly live: boolean;
}) {
  const now = useNow(run.finishedAt === null && run.startedAt !== null);
  const settled = jobs.filter((job) => !["QUEUED", "RUNNING"].includes(job.status)).length;
  const elapsed =
    run.startedAt === null
      ? null
      : (run.finishedAt === null ? now : Date.parse(run.finishedAt)) - Date.parse(run.startedAt);
  // Each status a job can have, in a fixed order; a status no job has is not shown.
  const counts = JOB_CHIP_ORDER.map(
    (status) => [status, jobs.filter((job) => jobStatus(job) === status).length] as const,
  ).filter(([, count]) => count > 0);
  const notRun = excludedOf(run).length;

  return (
    <Panel className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-body-strong text-ink-primary">{RUN_STATUS_TEXT[run.status]}</p>
          <p className="text-small text-ink-secondary">
            {settled} of {jobs.length} sources settled ·{" "}
            {elapsed === null ? "not started yet" : `elapsed ${formatDuration(elapsed)}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {counts.map(([status, count]) => (
            <StatusChip key={status} status={status}>
              {`${String(count)} ${COUNT_WORD[status]}`}
            </StatusChip>
          ))}
          {notRun === 0 ? null : (
            <StatusChip status="SKIPPED">{`${String(notRun)} not run`}</StatusChip>
          )}
        </div>
      </div>
      {run.finishedAt !== null && !run.settled ? (
        <p className="text-body text-ink-secondary">
          Every source has finished; their results are still being merged.
        </p>
      ) : null}
      {run.plan !== null && "error" in run.plan ? (
        <p className="text-body text-status-failed-ink">
          The run could not be planned: {run.plan.error.message}
        </p>
      ) : null}
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-small text-ink-secondary">
        <span>
          Queued <Instant iso={run.createdAt} />
        </span>
        <span>
          {run.startedAt === null ? (
            "Not started yet"
          ) : (
            <>
              Started <Instant iso={run.startedAt} />
            </>
          )}
        </span>
        <span>
          {run.finishedAt === null ? (
            "Not finished yet"
          ) : (
            <>
              Finished <Instant iso={run.finishedAt} />
            </>
          )}
        </span>
      </p>
      <p className="font-mono text-mono-caption text-ink-muted">Run {run.id}</p>
      {live ? (
        <p className="text-small text-ink-secondary">
          Live: this page updates as each source finishes.
        </p>
      ) : null}
    </Panel>
  );
}

/** Joins a caption's parts with the designs' middle dot. */
function joined(parts: readonly ReactNode[]): ReactNode {
  return parts.map((part, index) => (
    <span key={index}>
      {index === 0 ? null : " · "}
      {part}
    </span>
  ));
}

/** What a job's status means for this job, in words: what it found, or why it did not. */
function jobCaption(job: JobData, collector: Collector | undefined): ReactNode {
  const parts: ReactNode[] = [];
  if (collector !== undefined) parts.push(DISCIPLINE_TEXT[collector.discipline]);
  const attempts = plural(job.attempts, "attempt");
  const reason = job.error === null ? null : `${job.error.code}: ${job.error.message}`;
  const took = durationBetween(job.startedAt, job.finishedAt);
  switch (jobStatus(job)) {
    case "RAN":
      if (job.outcome === "NOT_FOUND") {
        parts.push(
          job.outcomeDetail === null ? "found nothing" : `found nothing: ${job.outcomeDetail}`,
        );
      } else {
        parts.push(plural(job.evidenceIds.length, "evidence record"));
        if (job.fusedAt === null) parts.push("merging into the results");
      }
      if (took !== null) parts.push(formatDuration(took));
      if (job.attempts > 1) parts.push(`recovered on attempt ${String(job.attempts)}`);
      break;
    case "NEEDS_KEY":
      parts.push(reason === null ? "needs a key that is not set for your organisation" : reason);
      break;
    case "SKIPPED":
      parts.push(reason === null ? "refused before it ran" : reason);
      break;
    case "FAILED":
      parts.push(reason === null ? "failed, and no reason was recorded" : reason);
      if (job.deadLetteredAt === null) {
        parts.push(`stopped after ${attempts}`);
      } else {
        parts.push(`gave up after ${attempts}`);
        parts.push(
          <>
            dead-lettered <Instant iso={job.deadLetteredAt} />, kept for review
          </>,
        );
      }
      break;
    case "QUEUED":
      if (job.nextAttemptAt === null) {
        parts.push("waiting for a worker");
      } else {
        if (reason !== null) parts.push(reason);
        parts.push(
          <>
            next attempt <Instant iso={job.nextAttemptAt} /> (after {attempts})
          </>,
        );
      }
      break;
    case "RUNNING":
      parts.push(job.attempts > 1 ? `collecting: attempt ${String(job.attempts)}` : "collecting");
      break;
    case "CANCELLED":
      parts.push("cancelled before it finished");
      break;
    case "PARTIAL":
    case "HELD":
    case "READY":
      // Not a job status: jobStatus never returns these.
      break;
  }
  return joined(parts);
}

function SourceRow({
  status,
  label,
  caption,
}: {
  readonly status: CollectorStatus;
  readonly label: ReactNode;
  readonly caption: ReactNode;
}) {
  return (
    <li
      className={cn(
        "flex items-start gap-3 rounded-md px-3 py-3",
        status === "FAILED" && "border border-status-failed-mark bg-status-failed-fill",
        status === "RUNNING" && "bg-surface-hover",
      )}
    >
      <span aria-hidden="true" className={cn("mt-2 size-2 shrink-0 rounded-pill", DOT[status])} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-body-strong text-ink-primary">{label}</p>
        <p
          className={cn(
            "text-small",
            status === "FAILED" ? "text-status-failed-ink" : "text-ink-secondary",
          )}
        >
          {caption}
        </p>
      </div>
      <StatusChip status={status} />
    </li>
  );
}

/** Every source: those that ran, then those the plan left out, each with why. */
function SourcesPanel({
  run,
  jobs,
  byId,
}: {
  readonly run: RunData;
  readonly jobs: readonly JobData[];
  readonly byId: ReadonlyMap<string, Collector>;
}) {
  const excluded = excludedOf(run);
  return (
    <Panel className="flex flex-col gap-3">
      <Heading>Sources</Heading>
      {jobs.length === 0 && excluded.length === 0 ? (
        <p className="text-body text-ink-secondary">No source was planned for this run.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {jobs.map((job) => (
            <SourceRow
              key={job.id}
              status={jobStatus(job)}
              label={job.sourceLabel}
              caption={jobCaption(job, byId.get(job.collectorId))}
            />
          ))}
          {excluded.map((row) => {
            const collector = byId.get(row.collectorId);
            return (
              <SourceRow
                key={row.collectorId}
                status={
                  row.reason === NOT_APPLICABLE_REASON ? "SKIPPED" : exclusionStatus(row.reason)
                }
                // The plan records ids; the label comes from the collector list when it has one.
                label={
                  collector === undefined ? (
                    <span className="font-mono text-mono-body">{row.collectorId}</span>
                  ) : (
                    collector.label
                  )
                }
                caption={joined([
                  ...(collector === undefined ? [] : [DISCIPLINE_TEXT[collector.discipline]]),
                  row.message,
                ])}
              />
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

/** What has arrived, counted from the run itself; what a source that did not complete would have found stays unmeasured. */
function ArrivingPanel({ jobs }: { readonly jobs: readonly JobData[] }) {
  const evidence = jobs.reduce((sum, job) => sum + job.evidenceIds.length, 0);
  const found = jobs.filter((job) => job.status === "SUCCEEDED" && job.outcome === "FOUND").length;
  const nothing = jobs.filter(
    (job) => job.status === "SUCCEEDED" && job.outcome === "NOT_FOUND",
  ).length;
  const missing = jobs.filter((job) =>
    ["FAILED", "NEEDS_KEY", "SKIPPED", "CANCELLED"].includes(jobStatus(job)),
  );
  return (
    <Panel className="flex flex-col gap-3">
      <Heading>Arriving now</Heading>
      <ul className="flex flex-col divide-y divide-border-subtle">
        <CountRow label="Evidence records" value={evidence} />
        <CountRow label="Sources that found something" value={found} />
        <CountRow label="Sources that found nothing" value={nothing} />
        {missing.map((job) => (
          <li key={job.id} className="flex flex-col gap-1 py-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-body text-ink-primary">From {job.sourceLabel}</span>
              <Unmeasured
                reason={`${job.sourceLabel} did not complete, so what it would have found is not measured.`}
              />
            </div>
            <p className="text-small text-status-failed-ink">
              Not measured: {job.sourceLabel} did not complete.
            </p>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function CountRow({ label, value }: { readonly label: string; readonly value: number }) {
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <span className="text-body text-ink-primary">{label}</span>
      <span className="font-mono text-mono-body text-ink-primary">{value}</span>
    </li>
  );
}

function CostLine({ label, reason }: { readonly label: string; readonly reason: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3">
        <p className="text-body text-ink-primary">{label}</p>
        <Unmeasured reason={reason} />
      </div>
      <p className="text-small text-ink-secondary">{reason}</p>
    </div>
  );
}

/** How the run collects, and what the organisation's plan allows; each from what the API states. */
function SettingsPanel({
  jobs,
  byId,
  collectorsFailed,
}: {
  readonly jobs: readonly JobData[];
  readonly byId: ReadonlyMap<string, Collector>;
  readonly collectorsFailed: boolean;
}) {
  const { data: session } = useSuspenseQuery(sessionQuery);
  const tenantId = session.state === "SIGNED_IN" ? session.activeTenantId : null;
  const me = useQuery({ ...meQuery(tenantId ?? "none"), enabled: tenantId !== null });

  const modes = jobs.map((job) => byId.get(job.collectorId)?.collectionMode);
  let collection: ReactNode;
  if (collectorsFailed || modes.some((mode) => mode === undefined)) {
    collection = (
      <Unmeasured reason="The collector list could not be read, or does not list every source in this run." />
    );
  } else if (modes.length === 0) {
    collection = "No source ran";
  } else {
    // Every mode but ACTIVE reads a third party's record and never contacts the target.
    collection = modes.includes("ACTIVE") ? "Includes active collection" : "Passive only";
  }

  let person: ReactNode;
  if (me.data === undefined) {
    person = me.isError ? (
      <Unmeasured reason="Your organisation's plan could not be read." />
    ) : (
      <Skeleton className="h-5 w-1/4" />
    );
  } else if (!me.data.tenant.planModules.includes("PERSON_INVESTIGATION")) {
    person = "Not in this plan";
  } else {
    person = me.data.tenant.vettingStatus === "APPROVED" ? "Available" : "Vetting required";
  }

  return (
    <Panel className="flex flex-col gap-3">
      <Heading>Run settings</Heading>
      <SettingRow label="Collection mode" value={collection} />
      <SettingRow label="Person modules" value={person} />
      <SettingRow label="Model" value="Named on the report, when one is generated" />
    </Panel>
  );
}

function SettingRow({ label, value }: { readonly label: string; readonly value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-body text-ink-primary">{label}</span>
      <span className="text-right text-small text-ink-secondary">{value}</span>
    </div>
  );
}

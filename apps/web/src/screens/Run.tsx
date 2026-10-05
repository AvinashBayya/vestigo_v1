import { Button, Notice, Panel, Skeleton, StatusChip, Unmeasured } from "@repo/ui";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ApiProblem } from "../api.ts";
import { AppShell } from "../components/AppShell.tsx";
import { LockedNotice } from "../components/LockedNotice.tsx";
import { ProblemNotice } from "../components/ProblemNotice.tsx";
import {
  jobStatus,
  RUN_STATUS_TEXT,
  StreamDropped,
  type JobData,
  type LockedEventData,
  type RunData,
} from "../run/progress.ts";
import { useRunStream, type Connection } from "../run/useRunStream.ts";
import { exclusionStatus, NOT_APPLICABLE_REASON } from "../search/plan.ts";

/** Neither cost is recorded on a run yet; each says so rather than showing a number. */
const NO_ESTIMATE_RECORDED =
  "This run does not record a cost estimate. Estimates are made before a run starts, and none is stored with it.";
const NO_COST_RECORDED =
  "This run does not record what it cost: per-run cost metering is not built yet.";

/** A run's live progress: every source with its status and reason, as each finishes. */
export function RunScreen({ runId }: { readonly runId: string }) {
  const { progress, connection, lastUpdate, reconnect } = useRunStream(runId);
  const { run, jobs, ended, locked } = progress;

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <p>
          <Button variant="quiet" asChild>
            <Link to="/">New search</Link>
          </Button>
        </p>
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
          <>
            <RunPanel run={run} live={connection.kind === "live"} />
            <JobsPanel jobs={jobs} />
            <NotRunPanel run={run} />
            <Panel className="flex flex-col gap-3">
              <Heading>Cost</Heading>
              <CostLine label="Estimated before the run" reason={NO_ESTIMATE_RECORDED} />
              <CostLine label="Actual" reason={NO_COST_RECORDED} />
            </Panel>
          </>
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
    return locked.locked === null ? (
      <Notice tone="failure" className="flex flex-col gap-1">
        <p>Updates stopped: access to this run is no longer allowed.</p>
        <p>{locked.detail}</p>
        <p className="font-mono text-mono-caption">Code: {locked.code}</p>
      </Notice>
    ) : (
      <LockedNotice locked={locked.locked} />
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

function RunPanel({ run, live }: { readonly run: RunData; readonly live: boolean }) {
  const input = run.plan !== null && "input" in run.plan ? run.plan.input : null;
  return (
    <Panel className="flex flex-col gap-3">
      <Heading>Run</Heading>
      {input === null ? null : <p className="font-mono text-mono-body text-ink-primary">{input}</p>}
      <p className="text-body-strong text-ink-primary">{RUN_STATUS_TEXT[run.status]}</p>
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
      <dl className="flex flex-col gap-1 text-small text-ink-secondary">
        <div className="flex flex-wrap gap-2">
          <dt>Queued:</dt>
          <dd>
            <Instant iso={run.createdAt} />
          </dd>
        </div>
        <div className="flex flex-wrap gap-2">
          <dt>Started:</dt>
          <dd>{run.startedAt === null ? "Not started yet." : <Instant iso={run.startedAt} />}</dd>
        </div>
        <div className="flex flex-wrap gap-2">
          <dt>Finished:</dt>
          <dd>
            {run.finishedAt === null ? "Not finished yet." : <Instant iso={run.finishedAt} />}
          </dd>
        </div>
      </dl>
      <p className="font-mono text-mono-caption text-ink-muted">Run {run.id}</p>
      {live ? (
        <p className="text-small text-ink-secondary">
          Live: this page updates as each source finishes.
        </p>
      ) : null}
    </Panel>
  );
}

/** What a job's status means for this job, in words: what it found, or why it did not. */
function jobDetail(job: JobData): ReactNode {
  const code =
    job.error === null ? null : (
      <span className="font-mono text-mono-caption"> Code: {job.error.code}.</span>
    );
  const attempts = `${String(job.attempts)} attempt${job.attempts === 1 ? "" : "s"}`;
  switch (jobStatus(job)) {
    case "RAN": {
      if (job.outcome === "NOT_FOUND") {
        return job.outcomeDetail === null
          ? "Found nothing."
          : `Found nothing: ${job.outcomeDetail}`;
      }
      const count = job.evidenceIds.length;
      const found = `Found ${String(count)} evidence record${count === 1 ? "" : "s"}.`;
      return job.fusedAt === null ? `${found} Merging them into the results.` : found;
    }
    case "NEEDS_KEY":
      return (
        <>
          {job.error === null
            ? "This source needs a key that is not set for your organisation."
            : job.error.message}
          {code}
        </>
      );
    case "SKIPPED":
      return (
        <>
          {job.error === null ? "The source refused to run it." : job.error.message}
          {code}
        </>
      );
    case "FAILED":
      return (
        <>
          {job.error === null ? "It failed, and no reason was recorded." : job.error.message}
          {code}{" "}
          {job.deadLetteredAt === null ? (
            `Stopped after ${attempts}.`
          ) : (
            <>
              Gave up after {attempts} at <Instant iso={job.deadLetteredAt} />; kept in the
              dead-letter queue for review.
            </>
          )}
        </>
      );
    case "QUEUED":
      return job.nextAttemptAt === null ? (
        "Waiting for a worker."
      ) : (
        <>
          {job.error === null ? "The last attempt did not succeed." : job.error.message}
          {code} Next attempt at <Instant iso={job.nextAttemptAt} /> (after {attempts}).
        </>
      );
    case "RUNNING":
      return job.attempts > 1 ? `Collecting: attempt ${String(job.attempts)}.` : "Collecting.";
    case "CANCELLED":
      return "Cancelled before it finished.";
    case "PARTIAL":
    case "HELD":
      // Not a job status: jobStatus never returns these.
      return null;
  }
}

function JobsPanel({ jobs }: { readonly jobs: readonly JobData[] }) {
  const finished = jobs.filter((job) => !["QUEUED", "RUNNING"].includes(job.status)).length;
  return (
    <Panel className="flex flex-col gap-3">
      <Heading>
        Sources: {finished} of {jobs.length} finished
      </Heading>
      {jobs.length === 0 ? (
        <p className="text-body text-ink-secondary">No source was planned for this run.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border-subtle">
          {jobs.map((job) => (
            <li key={job.id} className="flex flex-wrap items-start gap-3 py-3">
              <StatusChip status={jobStatus(job)} />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="text-body-strong text-ink-primary">{job.sourceLabel}</p>
                <p className="text-small text-ink-secondary">{jobDetail(job)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** Sources the plan left out, with why. The plan records ids only, so ids are shown. */
function NotRunPanel({ run }: { readonly run: RunData }) {
  if (run.plan === null || !("excluded" in run.plan)) return null;
  const blocked = run.plan.excluded.filter((row) => row.reason !== NOT_APPLICABLE_REASON);
  if (blocked.length === 0) return null;
  return (
    <Panel className="flex flex-col gap-3">
      <Heading>Not run ({blocked.length})</Heading>
      <ul className="flex flex-col divide-y divide-border-subtle">
        {blocked.map((row) => (
          <li key={row.collectorId} className="flex flex-wrap items-start gap-3 py-3">
            <StatusChip status={exclusionStatus(row.reason)} />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="font-mono text-mono-body text-ink-primary">{row.collectorId}</p>
              <p className="text-small text-ink-secondary">{row.message}</p>
              <p className="font-mono text-mono-caption text-ink-muted">{row.reason}</p>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function CostLine({ label, reason }: { readonly label: string; readonly reason: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className="text-body-strong text-ink-primary">{label}</p>
      <Unmeasured reason={reason} />
      <p className="text-small text-ink-secondary">{reason}</p>
    </div>
  );
}

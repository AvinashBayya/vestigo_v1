import { useId, type ReactNode } from "react";
import { cn } from "./cn.ts";
import {
  RunStatusChip,
  StatusChip,
  StatusDot,
  type CollectorStatus,
  type RunStatus,
} from "./status-chip.tsx";
import { Unmeasured } from "./unmeasured.tsx";

/**
 * Why access to an open run was withdrawn: the run stream's `locked` event
 * (`reason`), as the API names them. CLAUDE.md §2: a stream never outlives
 * the access that opened it.
 */
export const LOCK_REASONS = [
  "CREDENTIAL_REVOKED",
  "MEMBERSHIP_REVOKED",
  "PERMISSION_LOST",
  "MODULE_NOT_IN_PLAN",
  "VETTING_NOT_APPROVED",
] as const;
export type LockReason = (typeof LOCK_REASONS)[number];

/** Each reason as a heading. The API's own `detail` says the rest, verbatim. */
export const LOCK_REASON_TITLE: Readonly<Record<LockReason, string>> = {
  CREDENTIAL_REVOKED: "Session or key no longer valid",
  MEMBERSHIP_REVOKED: "No longer a member",
  PERMISSION_LOST: "Role no longer allows this",
  MODULE_NOT_IN_PLAN: "Person data not in the plan",
  VETTING_NOT_APPROVED: "Vetting not approved",
};

/**
 * The Locked block the API sends when person data is the reason (its
 * `Locked` schema): what the module does, what was withheld, the next step.
 */
export interface LockedModule {
  readonly moduleSummary: string;
  readonly withheld: string;
  readonly nextStep: string;
}

/** A lock, as the stream's `locked` event carries it. */
export interface RunLock {
  readonly reason: LockReason;
  /** The code a fresh request would get. */
  readonly code: string;
  /** The API's sentence for what was refused, shown as sent. */
  readonly detail: string;
  /** Set when person data is the reason (plan or vetting); null otherwise. */
  readonly locked: LockedModule | null;
  /** How often access was re-checked while the stream was open, in milliseconds. */
  readonly recheckIntervalMs: number;
  /** When the refusing check ran, as the caller formats it. */
  readonly checkedAt: string;
}

/** A re-check interval in words: "every 5 s", "every 1 min", "every 250 ms". */
export function recheckInterval(ms: number): string {
  if (ms >= 60_000 && ms % 60_000 === 0) return `every ${String(ms / 60_000)} min`;
  if (ms >= 1_000 && ms % 1_000 === 0) return `every ${String(ms / 1_000)} s`;
  return `every ${String(ms)} ms`;
}

/**
 * The lock (§8 Locked: neutral, never scolding): its reason in words, the
 * API's detail as sent, what was withheld and the next step where the API
 * gives them, the code, and when the refusing check ran. The stream closed
 * with the lock, so nothing is re-checked any more: the interval is said in
 * the past tense, as how often access was checked while it was open.
 */
export function LockDetail({
  lock,
  id,
  className,
}: {
  readonly lock: RunLock;
  readonly id?: string | undefined;
  readonly className?: string | undefined;
}) {
  return (
    <div id={id} className={cn("flex flex-col gap-0.75", className)}>
      <p className="text-small-strong text-ink-primary">{LOCK_REASON_TITLE[lock.reason]}</p>
      <p className="text-caption text-ink-secondary">{lock.detail}</p>
      {lock.locked !== null && (
        <>
          <p className="text-caption text-ink-secondary">{lock.locked.moduleSummary}</p>
          <p className="text-caption text-ink-secondary">Withheld: {lock.locked.withheld}</p>
          <p className="text-small-strong text-ink-primary">{lock.locked.nextStep}</p>
        </>
      )}
      <p className="text-caption text-ink-muted">
        Refused at <span className="font-mono text-mono-caption">{lock.checkedAt}</span>; access was
        checked {recheckInterval(lock.recheckIntervalMs)} while the stream was open.
      </p>
      <p className="font-mono text-mono-caption text-ink-muted">{lock.code}</p>
    </div>
  );
}

export interface RunRailItem {
  readonly id: string;
  readonly target: string;
  /** "Full · [TIME] · 18/21 ok", from measured values only. */
  readonly meta: string;
  /** The run's own status (§3 run status), so a PARTIAL run is labelled partial. */
  readonly status: RunStatus;
  /** Set for a FAILED run: the code the API recorded. */
  readonly failureCode?: string | undefined;
  /** Set when access to the run was withdrawn while its stream was open. */
  readonly lock?: RunLock | undefined;
}

export interface DisciplineFilter {
  readonly id: string;
  readonly label: string;
  /** The measured count as the caller formats it ("0" when it was measured and zero), or null with why. */
  readonly count: { readonly value: string } | { readonly value: null; readonly reason: string };
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}

function RailHeading({ children }: { readonly children: string }) {
  return <h2 className="px-1.5 text-eyebrow text-ink-muted uppercase">{children}</h2>;
}

/**
 * The workspace runs rail (§9, Workspace): run rows as real buttons at least
 * `target-min` tall, the selected one on `accent-soft` and `aria-current`;
 * each run's own status chip (§3 run status); discipline filters as
 * `target-min` checkbox rows with counts only where measured; "Pinned to
 * case" at the foot. A locked run's lock is set out beneath its button and
 * tied to it by `aria-describedby` (a button holds only phrasing content).
 */
export function RunsRail({
  runs,
  selectedId,
  onSelect,
  disciplines,
  pinned,
  className,
}: {
  readonly runs: readonly RunRailItem[];
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
  readonly disciplines?: readonly DisciplineFilter[] | undefined;
  /** The foot: what is pinned to the case, from measured counts. */
  readonly pinned?: ReactNode;
  readonly className?: string | undefined;
}) {
  const base = useId();
  return (
    <nav
      aria-label="Runs"
      className={cn(
        "flex h-full w-runs-rail shrink-0 flex-col gap-4.5 border-r border-border-default bg-surface-raised px-3 py-4",
        className,
      )}
    >
      <div className="flex flex-col gap-2">
        <RailHeading>Runs</RailHeading>
        {runs.length === 0 ? (
          <p className="px-1.5 text-caption text-ink-muted">No runs in this case yet.</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {runs.map((run, index) => {
              const selected = run.id === selectedId;
              const lockId = `${base}-lock-${String(index)}`;
              return (
                <li key={run.id} className="flex flex-col gap-1.25">
                  <button
                    type="button"
                    aria-current={selected ? "true" : undefined}
                    aria-describedby={run.lock === undefined ? undefined : lockId}
                    onClick={() => {
                      onSelect(run.id);
                    }}
                    className={cn(
                      "flex min-h-target w-full cursor-pointer flex-col items-start gap-1 rounded-md px-2.5 py-2.25 text-left",
                      selected ? "bg-accent-soft" : "hover:bg-surface-hover",
                    )}
                  >
                    <span
                      className={cn(
                        "font-mono text-mono-meta break-all",
                        selected ? "font-medium text-accent-ink" : "text-ink-secondary",
                      )}
                    >
                      {run.target}
                    </span>
                    <span className="text-caption text-ink-muted">{run.meta}</span>
                    <span className="flex flex-wrap items-center gap-2">
                      <RunStatusChip status={run.status} />
                      {run.lock !== undefined && <StatusChip status="LOCKED" />}
                    </span>
                    {run.status === "FAILED" && run.failureCode !== undefined && (
                      <span className="font-mono text-mono-caption text-status-failed-ink">
                        {run.failureCode}
                      </span>
                    )}
                  </button>
                  {run.lock !== undefined && (
                    <LockDetail
                      id={lockId}
                      lock={run.lock}
                      className="rounded-inner border border-border-subtle px-2.5 py-2.25"
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {disciplines !== undefined && (
        <fieldset className="flex flex-col">
          <legend className="mb-2">
            <RailHeading>Disciplines</RailHeading>
          </legend>
          {disciplines.map((discipline) => (
            <div key={discipline.id} className="flex min-h-target items-center gap-2.75 px-1.5">
              <label className="flex grow cursor-pointer items-center gap-2.75 self-stretch text-small text-ink-secondary">
                <input
                  type="checkbox"
                  checked={discipline.checked}
                  onChange={(event) => {
                    discipline.onChange(event.target.checked);
                  }}
                  className="cursor-pointer accent-accent"
                />
                {discipline.label}
              </label>
              {discipline.count.value === null ? (
                <Unmeasured reason={discipline.count.reason} className="justify-end" />
              ) : (
                <span className="font-mono text-mono-caption text-ink-muted">
                  {discipline.count.value}
                </span>
              )}
            </div>
          ))}
        </fieldset>
      )}
      {pinned !== undefined && (
        <div className="mt-auto flex flex-col gap-1.75 border-t border-border-subtle px-1.5 pt-3.25">
          <h2 className="text-eyebrow text-ink-muted uppercase">Pinned to case</h2>
          <div className="flex flex-col gap-1.75 text-small text-ink-secondary">{pinned}</div>
        </div>
      )}
    </nav>
  );
}

/** One collector's job in a run (RunLive), as the run's progress reports it. */
export interface CollectorRowItem {
  readonly id: string;
  /** The collector registry entry's label. */
  readonly label: string;
  readonly status: CollectorStatus;
  /** "TECHINT · 9 claims · 0.9s", from measured values only. */
  readonly meta?: string | undefined;
  /** Set for FAILED: the code and the API's words, attempts and retry or dead-letter state. */
  readonly failure?: { readonly code: string; readonly message: string } | undefined;
  /**
   * Progress from 0 to 1 where the source reports it; null where it does not,
   * and then no bar is drawn (a bar at a guessed width is a fabricated value).
   */
  readonly progress?: number | null | undefined;
}

/**
 * A collector row (§9 run view, RunLive): a dot, the name, the meta line and
 * the chip. A failed row is tinted and states its code in failure ink, so it
 * never looks like a collector that found nothing.
 */
export function CollectorRow({ item }: { readonly item: CollectorRowItem }) {
  const failed = item.status === "FAILED";
  const running = item.status === "RUNNING";
  return (
    <li
      className={cn(
        "flex min-h-row-comfortable items-center gap-3 rounded-md border px-3 py-2.25",
        failed
          ? "border-status-failed-border bg-status-failed-tint"
          : running
            ? "border-transparent bg-surface-hover"
            : "border-transparent",
      )}
    >
      <StatusDot status={item.status} />
      <div className="flex min-w-0 grow flex-col gap-0.75">
        <span className="text-ui-strong text-ink-primary">{item.label}</span>
        {failed && item.failure !== undefined ? (
          <span className="text-caption text-status-failed-ink">
            <span className="font-mono text-mono-caption">{item.failure.code}</span> ·{" "}
            {item.failure.message}
          </span>
        ) : (
          item.meta !== undefined && (
            <span className="text-caption text-ink-muted">{item.meta}</span>
          )
        )}
        {running && typeof item.progress === "number" && (
          <progress
            value={item.progress}
            max={1}
            aria-label={`${item.label} progress`}
            className={cn(
              "block h-bar-sm w-mini-progress appearance-none overflow-hidden rounded-bar bg-border-default",
              // The bar's parts are pseudo-elements; each takes the same tokens.
              "[&::-webkit-progress-bar]:bg-border-default [&::-webkit-progress-value]:bg-accent [&::-moz-progress-bar]:bg-accent",
            )}
          />
        )}
      </div>
      <StatusChip status={item.status} />
    </li>
  );
}

/**
 * The run's collectors (RunLive). When the run's stream is locked, the lock
 * leads the list: it is the run's state, not one collector's.
 */
export function CollectorList({
  items,
  lock,
  className,
}: {
  readonly items: readonly CollectorRowItem[];
  readonly lock?: RunLock | undefined;
  readonly className?: string | undefined;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {lock !== undefined && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-inner border border-border-default px-3 py-2.25"
        >
          <StatusChip status="LOCKED" />
          <LockDetail lock={lock} />
        </div>
      )}
      <ul className="flex flex-col gap-1">
        {items.map((item) => (
          <CollectorRow key={item.id} item={item} />
        ))}
      </ul>
    </div>
  );
}

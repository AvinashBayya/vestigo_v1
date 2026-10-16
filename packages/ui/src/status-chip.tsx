import { cn } from "./cn.ts";

/**
 * The collector status vocabulary (docs/DESIGN-SYSTEM.md §3), the same
 * everywhere. FOUND_NOTHING (ran, and the source had nothing for the target:
 * a measured zero, not a failure) and LOCKED (access to the run was withdrawn
 * while it was open) were added in U1-b; §12 D7 records their colour.
 * UNCONFIRMED (ran, and the source answered with nothing, but its empty
 * answers are unreliable: never a found nothing, never zero) was added in
 * Track M Day 2; §12 D9 records its colour.
 */
export const COLLECTOR_STATUSES = [
  "READY",
  "NEEDS_KEY",
  "UNAVAILABLE",
  "RAN",
  "PARTIAL",
  "FOUND_NOTHING",
  "UNCONFIRMED",
  "RUNNING",
  "QUEUED",
  "FAILED",
  "SKIPPED",
  "HELD",
  "CANCELLED",
  "LOCKED",
] as const;
export type CollectorStatus = (typeof COLLECTOR_STATUSES)[number];

export const COLLECTOR_STATUS_LABEL: Readonly<Record<CollectorStatus, string>> = {
  READY: "Ready",
  NEEDS_KEY: "Needs key",
  UNAVAILABLE: "Unavailable",
  RAN: "Ran",
  PARTIAL: "Partial",
  FOUND_NOTHING: "Found nothing",
  UNCONFIRMED: "Unconfirmed",
  RUNNING: "Running",
  QUEUED: "Queued",
  FAILED: "Failed",
  SKIPPED: "Skipped",
  HELD: "Held",
  CANCELLED: "Cancelled",
  LOCKED: "Locked",
};

type Tone = "observed" | "running" | "failed" | "needs-key" | "inferred" | "none";

/** §3's ink on fill for each tone. Colour is the second channel; the word is the first. */
const CHIP: Readonly<Record<Tone, string>> = {
  observed: "bg-claim-observed-fill text-claim-observed-ink",
  running: "bg-accent-soft text-accent-ink",
  failed: "bg-status-failed-fill text-status-failed-ink",
  "needs-key": "bg-claim-inferred-fill text-status-needs-key-ink",
  inferred: "bg-claim-inferred-fill text-claim-inferred-ink",
  none: "bg-claim-hypothesis-fill text-claim-hypothesis-ink",
};

/** §3's dot (the mark) for each tone. */
const DOT: Readonly<Record<Tone, string>> = {
  observed: "bg-claim-observed-mark",
  running: "bg-accent",
  failed: "bg-status-failed-mark",
  "needs-key": "bg-claim-inferred-mark",
  inferred: "bg-claim-inferred-mark",
  none: "bg-claim-hypothesis-mark",
};

/**
 * Eight statuses share the hypothesis grey and differ by word alone: none of
 * them produced a result (§3). FOUND_NOTHING and LOCKED join them (D7), and
 * UNCONFIRMED (D9).
 */
const TONE: Readonly<Record<CollectorStatus, Tone>> = {
  READY: "observed",
  NEEDS_KEY: "needs-key",
  UNAVAILABLE: "none",
  RAN: "observed",
  PARTIAL: "observed",
  FOUND_NOTHING: "none",
  UNCONFIRMED: "none",
  RUNNING: "running",
  QUEUED: "none",
  FAILED: "failed",
  SKIPPED: "none",
  HELD: "none",
  CANCELLED: "none",
  LOCKED: "none",
};

const PILL = "inline-flex items-center rounded-pill px-2.25 py-0.75 text-chip whitespace-nowrap";

/**
 * A collector's status as a pill (§9 status chip: the only use of a pill
 * besides the vetting pill, count chips and dots), always with its word.
 */
export function StatusChip({
  status,
  className,
  children,
}: {
  readonly status: CollectorStatus;
  readonly className?: string | undefined;
  /** Words to show instead of the bare status, e.g. "6 ran"; they must still name the status. */
  readonly children?: string;
}) {
  return (
    <span className={cn(PILL, CHIP[TONE[status]], className)}>
      {children ?? COLLECTOR_STATUS_LABEL[status]}
    </span>
  );
}

/** The dot a status chip pairs with in a row (§9). Decorative: the chip carries the word. */
export function StatusDot({
  status,
  className,
}: {
  readonly status: CollectorStatus;
  readonly className?: string | undefined;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn("size-dot shrink-0 rounded-pill", DOT[TONE[status]], className)}
    />
  );
}

/** A run's own status (§3, run status): a separate vocabulary from a collector's. */
export const RUN_STATUSES = [
  "QUEUED",
  "RUNNING",
  "SUCCEEDED",
  "PARTIAL",
  "FAILED",
  "CANCELLED",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/**
 * A run's PARTIAL is amber and written in capitals, as the run mockup draws
 * it, so it is never confused with a collector's green "Partial" (§3).
 */
const RUN_LABEL: Readonly<Record<RunStatus, string>> = {
  QUEUED: "Queued",
  RUNNING: "Running",
  SUCCEEDED: "Ran",
  PARTIAL: "PARTIAL",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

const RUN_TONE: Readonly<Record<RunStatus, Tone>> = {
  QUEUED: "none",
  RUNNING: "running",
  SUCCEEDED: "observed",
  PARTIAL: "inferred",
  FAILED: "failed",
  CANCELLED: "none",
};

/** The run's status chip, in the run header (RunLive). */
export function RunStatusChip({
  status,
  className,
}: {
  readonly status: RunStatus;
  readonly className?: string | undefined;
}) {
  return <span className={cn(PILL, CHIP[RUN_TONE[status]], className)}>{RUN_LABEL[status]}</span>;
}

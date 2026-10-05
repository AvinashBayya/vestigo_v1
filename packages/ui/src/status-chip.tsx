import { cn } from "./cn.ts";

/** The collector status vocabulary (docs/DESIGN-SYSTEM.md §3), the same everywhere. */
export const COLLECTOR_STATUSES = [
  "RAN",
  "RUNNING",
  "PARTIAL",
  "FAILED",
  "NEEDS_KEY",
  "SKIPPED",
  "HELD",
  "QUEUED",
  "CANCELLED",
] as const;
export type CollectorStatus = (typeof COLLECTOR_STATUSES)[number];

const LABEL: Readonly<Record<CollectorStatus, string>> = {
  RAN: "Ran",
  RUNNING: "Running",
  PARTIAL: "Partial",
  FAILED: "Failed",
  NEEDS_KEY: "Needs key",
  SKIPPED: "Skipped",
  HELD: "Held",
  QUEUED: "Queued",
  CANCELLED: "Cancelled",
};

/** §3's tokens for each status. Colour is the second channel; the word is the first. */
const TONE: Readonly<Record<CollectorStatus, string>> = {
  RAN: "bg-claim-observed-fill text-claim-observed-ink",
  RUNNING: "bg-accent-soft text-accent-ink",
  PARTIAL: "bg-claim-observed-fill text-claim-observed-ink",
  FAILED: "border border-status-failed-mark bg-status-failed-fill text-status-failed-ink",
  NEEDS_KEY: "bg-claim-inferred-fill text-claim-inferred-ink",
  SKIPPED: "bg-claim-hypothesis-fill text-claim-hypothesis-ink",
  HELD: "bg-claim-hypothesis-fill text-claim-hypothesis-ink",
  QUEUED: "bg-claim-hypothesis-fill text-claim-hypothesis-ink",
  CANCELLED: "bg-claim-hypothesis-fill text-claim-hypothesis-ink",
};

/** A collector's status as a pill (the only use of a pill, §5), always with its text label. */
export function StatusChip({
  status,
  className,
}: {
  readonly status: CollectorStatus;
  readonly className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-pill px-2 py-1 text-caption whitespace-nowrap",
        TONE[status],
        className,
      )}
    >
      {LABEL[status]}
    </span>
  );
}

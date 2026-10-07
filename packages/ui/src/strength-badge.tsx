import { cn } from "./cn.ts";

/** The six claim strengths, strongest first (docs/DESIGN-SYSTEM.md §2). */
export const CLAIM_STRENGTH_LABELS = [
  "OBSERVED",
  "REPORTED",
  "DERIVED",
  "CORRELATED",
  "INFERRED",
  "HYPOTHESIS",
] as const;
export type ClaimStrengthLabel = (typeof CLAIM_STRENGTH_LABELS)[number];

/** §2's ink on fill for each strength. */
const TONE: Readonly<Record<ClaimStrengthLabel, string>> = {
  OBSERVED: "bg-claim-observed-fill text-claim-observed-ink",
  REPORTED: "bg-claim-reported-fill text-claim-reported-ink",
  DERIVED: "bg-claim-derived-fill text-claim-derived-ink",
  CORRELATED: "bg-claim-correlated-fill text-claim-correlated-ink",
  INFERRED: "bg-claim-inferred-fill text-claim-inferred-ink",
  HYPOTHESIS: "bg-claim-hypothesis-fill text-claim-hypothesis-ink",
};

/** §2's mark for each strength: the dot in a legend, the edge, the timeline bar. */
export const STRENGTH_MARK: Readonly<Record<ClaimStrengthLabel, string>> = {
  OBSERVED: "bg-claim-observed-mark",
  REPORTED: "bg-claim-reported-mark",
  DERIVED: "bg-claim-derived-mark",
  CORRELATED: "bg-claim-correlated-mark",
  INFERRED: "bg-claim-inferred-mark",
  HYPOTHESIS: "bg-claim-hypothesis-mark",
};

const SIZE = {
  /** Inspector subjects, the graph's selected entity (§9 claim badge md). */
  md: "px-2 py-0.75 text-chip",
  /** Tables, cards, timeline, map and report (§9 claim badge sm). */
  sm: "px-1.5 py-0.5 text-badge",
} as const;

/**
 * A claim's strength, always as its word in literal capitals (§2: never the
 * colour alone). `radius-xs`, never a pill: pills are statuses (§5). Set in
 * sans wherever it sits, so a badge inside the report's serif prose stays sans.
 */
export function StrengthBadge({
  strength,
  size = "md",
  className,
}: {
  readonly strength: ClaimStrengthLabel;
  readonly size?: keyof typeof SIZE | undefined;
  readonly className?: string | undefined;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-xs font-sans uppercase whitespace-nowrap",
        SIZE[size],
        TONE[strength],
        className,
      )}
    >
      {strength}
    </span>
  );
}

/** A strength's mark as a dot. Decorative: it always stands beside the word. */
export function StrengthDot({
  strength,
  className,
}: {
  readonly strength: ClaimStrengthLabel;
  readonly className?: string | undefined;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn("size-dot shrink-0 rounded-pill", STRENGTH_MARK[strength], className)}
    />
  );
}

/**
 * A legend of strengths: each mark beside its word, for any surface that
 * colours by strength (the timeline's bars, §12).
 */
export function StrengthKey({
  strengths = CLAIM_STRENGTH_LABELS,
  className,
}: {
  readonly strengths?: readonly ClaimStrengthLabel[];
  readonly className?: string | undefined;
}) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-3.5 gap-y-2", className)}>
      {strengths.map((strength) => (
        <li
          key={strength}
          className="inline-flex items-center gap-1.75 text-caption text-ink-secondary"
        >
          <StrengthDot strength={strength} />
          {strength}
        </li>
      ))}
    </ul>
  );
}

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

/** §2's fill and ink for each strength. Colour is the second channel; the word is the first. */
const TONE: Readonly<Record<ClaimStrengthLabel, string>> = {
  OBSERVED: "bg-claim-observed-fill text-claim-observed-ink",
  REPORTED: "bg-claim-reported-fill text-claim-reported-ink",
  DERIVED: "bg-claim-derived-fill text-claim-derived-ink",
  CORRELATED: "bg-claim-correlated-fill text-claim-correlated-ink",
  INFERRED: "bg-claim-inferred-fill text-claim-inferred-ink",
  HYPOTHESIS: "bg-claim-hypothesis-fill text-claim-hypothesis-ink",
};

/**
 * A claim's strength as its word, always (§2: never the colour alone). A badge
 * with the small radius, not a pill: pills are for collector status only (§5).
 */
export function ClaimStrength({
  strength,
  className,
}: {
  readonly strength: ClaimStrengthLabel;
  readonly className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm px-1 text-eyebrow uppercase whitespace-nowrap",
        TONE[strength],
        className,
      )}
    >
      {strength}
    </span>
  );
}

import { StrengthBadge, type ClaimStrengthLabel } from "./strength-badge.tsx";

export { CLAIM_STRENGTH_LABELS, type ClaimStrengthLabel } from "./strength-badge.tsx";

/**
 * The small claim badge, under the name the screens built before U1-b use.
 * U1-c moves them to StrengthBadge; until then this is that badge at `sm`.
 */
export function ClaimStrength({
  strength,
  className,
}: {
  readonly strength: ClaimStrengthLabel;
  readonly className?: string | undefined;
}) {
  return <StrengthBadge strength={strength} size="sm" className={className} />;
}

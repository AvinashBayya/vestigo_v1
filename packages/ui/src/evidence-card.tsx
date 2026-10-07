import type { ReactNode } from "react";
import { cn } from "./cn.ts";
import { shortHash } from "./key-value.tsx";
import { PinButton } from "./pin-button.tsx";
import { StatusChip } from "./status-chip.tsx";
import { StrengthBadge, type ClaimStrengthLabel } from "./strength-badge.tsx";

interface CardBase {
  readonly id: string;
  /** The collector registry entry's label, never a string the collector supplied. */
  readonly sourceLabel: string;
  readonly collectedAt: string;
}

/**
 * Something a source said or the platform saw. An INFERRED card must say
 * what it was inferred from (§2), so `inferredFrom` is required for it.
 */
export type FoundEvidence = CardBase & {
  readonly kind: "found";
  readonly text: string;
  readonly observedAt: string | null;
  readonly contentHash: string | null;
  readonly pin?: { readonly pinned: boolean; readonly onToggle: () => void } | undefined;
} & (
    | { readonly strength: Exclude<ClaimStrengthLabel, "INFERRED"> }
    | { readonly strength: "INFERRED"; readonly inferredFrom: string }
  );

/** A collector that ran and found nothing for the target: a measured nothing, not a failure. */
export type NothingFound = CardBase & {
  readonly kind: "nothing-found";
  /** The collector's own words for what it found nothing of, as recorded; null when it said nothing. */
  readonly detail: string | null;
};

export type EvidenceCardProps = FoundEvidence | NothingFound;

function Dot() {
  return <span aria-hidden="true"> · </span>;
}

/** "observed —" with its reason in words, never the collection time (§1). */
function Observed({ at }: { readonly at: string | null }) {
  if (at === null) {
    return (
      <>
        observed <span className="font-sans">—</span> (the source gave no date)
      </>
    );
  }
  return <>observed {at}</>;
}

function Hash({ hash }: { readonly hash: string | null }) {
  if (hash === null) {
    return (
      <>
        hash <span className="font-sans">—</span> (none recorded)
      </>
    );
  }
  return (
    <>
      hash{" "}
      <span className="font-mono text-mono-caption" title={hash}>
        {shortHash(hash)}
      </span>
    </>
  );
}

function Frame({
  inferred,
  children,
  className,
}: {
  readonly inferred: boolean;
  readonly children: ReactNode;
  readonly className?: string | undefined;
}) {
  return (
    <article
      className={cn(
        "flex flex-col gap-1.75 rounded-inner border p-3",
        inferred
          ? "border-claim-inferred-border bg-claim-inferred-tint"
          : "border-border-subtle bg-surface-raised",
        className,
      )}
    >
      {children}
    </article>
  );
}

/**
 * An evidence card (§9, Workspace): the strength badge and a pin, the claim in
 * `prose-small` `ink-body`, and a source line naming the registry source and
 * both timestamps apart. A collector that found nothing gets its own card, so
 * a nothing is never mistaken for a failure or for missing evidence.
 */
export function EvidenceCard(
  props: EvidenceCardProps & { readonly className?: string | undefined },
) {
  if (props.kind === "nothing-found") {
    return (
      <Frame inferred={false} className={props.className}>
        <StatusChip status="FOUND_NOTHING" className="self-start" />
        <p className="text-prose-small text-ink-body">
          {props.sourceLabel} ran and found nothing for this target.
          {props.detail !== null && <> {props.detail}</>}
        </p>
        <p className="text-caption text-ink-muted">
          {props.sourceLabel}
          <Dot />
          collected {props.collectedAt}
        </p>
      </Frame>
    );
  }
  const inferred = props.strength === "INFERRED";
  return (
    <Frame inferred={inferred} className={props.className}>
      <div className="flex items-center justify-between gap-2">
        <StrengthBadge strength={props.strength} size="sm" />
        {props.pin !== undefined && (
          <PinButton
            pinned={props.pin.pinned}
            onToggle={props.pin.onToggle}
            label="Pin this evidence to case"
          />
        )}
      </div>
      <p className="text-prose-small text-ink-body">{props.text}</p>
      <p className="text-caption text-ink-muted">
        {props.sourceLabel}
        <Dot />
        <Observed at={props.observedAt} />
        <Dot />
        collected {props.collectedAt}
        <Dot />
        <Hash hash={props.contentHash} />
      </p>
      {props.strength === "INFERRED" && (
        <p className="text-caption text-claim-inferred-ink">INFERRED from {props.inferredFrom}</p>
      )}
    </Frame>
  );
}

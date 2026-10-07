import { ClaimStrength, cn, Unmeasured, type ClaimStrengthLabel } from "@repo/ui";
import type { ReactNode } from "react";

/** A section's label: the design's uppercase eyebrow. */
export function Heading({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return <h2 className={cn("text-eyebrow uppercase text-ink-muted", className)}>{children}</h2>;
}

/**
 * An instant in the reader's local time with its zone written out, in mono,
 * with the exact value for machines. The same form on every screen.
 */
export function Instant({ iso, className }: { readonly iso: string; readonly className?: string }) {
  return (
    <time dateTime={iso} className={cn("font-mono text-mono-caption", className)}>
      {new Date(iso).toLocaleString(undefined, { timeZoneName: "short" })}
    </time>
  );
}

/** Why each timestamp can be missing, as the API defines them (§1: never filled from the other). */
export const MISSING_TIME = {
  observedAt:
    "The source did not say when this happened. The collection time is not used in its place.",
  collectedAt: "The time this was fetched was not recorded.",
} as const;

/** An instant, or an em dash saying why there is none. */
export function MaybeInstant({
  iso,
  missing,
}: {
  readonly iso: string | null;
  /** Why it is null, in plain words. */
  readonly missing: string;
}) {
  return iso === null ? <Unmeasured reason={missing} /> : <Instant iso={iso} />;
}

/**
 * What a claim states, as literal data. A stated null is a value the source
 * gave, so it is written out, never shown as a missing measurement.
 */
export function ClaimValue({ value }: { readonly value: unknown }) {
  if (value === null) {
    return (
      <span className="font-mono text-mono-caption text-ink-primary">
        null <span className="font-sans text-caption text-ink-muted">(stated as empty)</span>
      </span>
    );
  }
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return <span className="font-mono text-mono-caption break-all text-ink-primary">{text}</span>;
}

export const plural = (count: number, word: string, many = `${word}s`) =>
  `${String(count)} ${count === 1 ? word : many}`;

/**
 * The distinct strengths of an entity's claims, as words. An entity with no
 * claims has no strength: said so (a measured empty set), never a blank cell.
 */
export function StrengthList({ strengths }: { readonly strengths: readonly ClaimStrengthLabel[] }) {
  if (strengths.length === 0) {
    return <span className="text-caption text-ink-muted">no claims, so no strength</span>;
  }
  return (
    <span className="flex flex-wrap gap-1">
      {strengths.map((strength) => (
        <ClaimStrength key={strength} strength={strength} />
      ))}
    </span>
  );
}

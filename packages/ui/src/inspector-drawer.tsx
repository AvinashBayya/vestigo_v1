import type { ReactNode } from "react";
import { Button } from "./button.tsx";
import { cn } from "./cn.ts";
import { ENTITY_CLASS_LABEL, EntityClassName, type EntityClass } from "./entity-class.tsx";
import { EvidenceCard, type EvidenceCardProps } from "./evidence-card.tsx";
import { KeyValueList, type KeyValueRow } from "./key-value.tsx";
import { StrengthBadge, type ClaimStrengthLabel } from "./strength-badge.tsx";

/** Why an `observedAt` is null: the source never said, and the collection time never stands in (§1). */
export const NO_OBSERVED_AT =
  "The source did not say when this was observed. The collection time is not used in its place.";

/**
 * Where an item came from, as the API records it. `sourceLabel` is the
 * collector registry entry's label, never a string the collector supplied
 * (CLAUDE.md, Source labelling). Nulls stay null and render as an em dash
 * with their reason: never coerced to another value.
 */
export interface Provenance {
  readonly sourceLabel: string;
  readonly collectorVersion: string | null;
  readonly runId: string | null;
  readonly observedAt: string | null;
  readonly collectedAt: string;
  readonly contentHash: string | null;
  readonly sourceUrl: string | null;
  /** The raw payload's download address: served as an attachment, never opened in the app (CLAUDE.md §9). */
  readonly payloadHref: string | null;
}

export type InspectorSubject =
  | {
      readonly kind: "evidence";
      readonly title: string;
      readonly strength: ClaimStrengthLabel | null;
      readonly provenance: Provenance;
      readonly usedIn?: readonly { readonly label: string; readonly href: string }[] | undefined;
    }
  | {
      readonly kind: "claim";
      readonly text: string;
      readonly strength: ClaimStrengthLabel;
      readonly provenance: Provenance;
    }
  | {
      readonly kind: "entity";
      readonly entityClass: EntityClass;
      readonly name: string;
      readonly strengths: readonly ClaimStrengthLabel[];
      readonly attributes: readonly KeyValueRow[];
      readonly evidence: readonly EvidenceCardProps[];
      /** "9 items · 4 sources", from measured counts only. */
      readonly evidenceSummary?: string | undefined;
    }
  | {
      readonly kind: "relationship";
      readonly relation: string;
      readonly from: { readonly entityClass: EntityClass; readonly name: string };
      readonly to: { readonly entityClass: EntityClass; readonly name: string };
      readonly strengths: readonly ClaimStrengthLabel[];
      readonly evidence: readonly EvidenceCardProps[];
    };

const EYEBROW: Readonly<Record<InspectorSubject["kind"], string>> = {
  evidence: "Provenance",
  claim: "Claim",
  entity: "Entity",
  relationship: "Relationship",
};

export interface InspectorAction {
  readonly label: string;
  readonly onClick: () => void;
}

/** A divided section of the drawer, padded `space-4` `space-4.5` (§9). */
export function InspectorSection({
  title,
  aside,
  children,
}: {
  readonly title?: string | undefined;
  readonly aside?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 border-b border-border-subtle px-4.5 py-4 last:border-b-0">
      {title !== undefined && (
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-eyebrow text-ink-muted uppercase">{title}</h3>
          {aside !== undefined && <span className="text-caption text-ink-muted">{aside}</span>}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * The provenance rows: collector and its version, run, observed and collected
 * apart, the content hash whole (the grid shows it shortened; the drawer is
 * where it can be read and compared), source URL, and the raw payload.
 */
export function ProvenanceList({ provenance }: { readonly provenance: Provenance }) {
  const rows: KeyValueRow[] = [
    { key: "Collector", value: provenance.sourceLabel },
    provenance.collectorVersion === null
      ? {
          key: "Version",
          value: null,
          reason: "The registry entry records no version for this collector.",
        }
      : { key: "Version", value: provenance.collectorVersion },
    provenance.runId === null
      ? { key: "Run", value: null, reason: "This item is not tied to a run." }
      : { key: "Run", value: provenance.runId },
    provenance.observedAt === null
      ? { key: "Observed", value: null, reason: NO_OBSERVED_AT }
      : { key: "Observed", value: provenance.observedAt },
    { key: "Collected", value: provenance.collectedAt },
    provenance.contentHash === null
      ? { key: "Content hash", value: null, reason: "No content hash was recorded for this item." }
      : { key: "Content hash", value: provenance.contentHash },
    provenance.sourceUrl === null
      ? { key: "Source URL", value: null, reason: "The source gave no address for this item." }
      : { key: "Source URL", value: provenance.sourceUrl },
    provenance.payloadHref === null
      ? { key: "Raw payload", value: null, reason: "No raw payload was stored for this item." }
      : {
          key: "Raw payload",
          mono: false,
          value: (
            <a
              href={provenance.payloadHref}
              download
              className="inline-flex min-h-target items-center text-meta-strong text-link underline hover:text-link-hover"
            >
              Download raw payload
            </a>
          ),
        },
  ];
  return <KeyValueList rows={rows} />;
}

function Strengths({ strengths }: { readonly strengths: readonly ClaimStrengthLabel[] }) {
  if (strengths.length === 0) {
    return <p className="text-caption text-ink-muted">No claims, so no strength.</p>;
  }
  return (
    <ul className="flex flex-wrap gap-1.75" aria-label="Claim strengths">
      {strengths.map((strength) => (
        <li key={strength}>
          <StrengthBadge strength={strength} />
        </li>
      ))}
    </ul>
  );
}

function EvidenceList({ evidence }: { readonly evidence: readonly EvidenceCardProps[] }) {
  if (evidence.length === 0) {
    return <p className="text-prose-small text-ink-secondary">No evidence is recorded for this.</p>;
  }
  return (
    <ul className="flex flex-col gap-3">
      {evidence.map((card) => (
        <li key={card.id}>
          <EvidenceCard {...card} />
        </li>
      ))}
    </ul>
  );
}

type Pin = { readonly pinned: boolean; readonly onToggle: () => void } | undefined;

/** Pin-to-case for the subject, beside its name (§9: "the subject (heading, badges, Pin)"). */
function PinToggle({ pin }: { readonly pin: Pin }) {
  if (pin === undefined) return null;
  return (
    <button
      type="button"
      aria-pressed={pin.pinned}
      onClick={pin.onToggle}
      className={cn(
        "hit-area inline-flex h-control-sm shrink-0 cursor-pointer items-center rounded-md border px-3.25 text-small-strong",
        pin.pinned
          ? "border-accent bg-accent-soft text-accent-ink"
          : "border-border-strong bg-surface-raised text-ink-secondary hover:bg-surface-hover",
      )}
    >
      {pin.pinned ? "Pinned" : "Pin to case"}
    </button>
  );
}

/** The subject's top row: what it is on the left, the pin on the right. */
function Top({ pin, children }: { readonly pin: Pin; readonly children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1.25">{children}</div>
      <PinToggle pin={pin} />
    </div>
  );
}

function Subject({ subject, pin }: { readonly subject: InspectorSubject; readonly pin: Pin }) {
  switch (subject.kind) {
    case "evidence":
      return (
        <>
          <InspectorSection>
            <Top pin={pin}>
              <p className="text-ui text-ink-body">{subject.title}</p>
            </Top>
            {subject.strength === null ? (
              <p className="text-caption text-ink-muted">
                No claim strength: this item holds no claim.
              </p>
            ) : (
              <StrengthBadge strength={subject.strength} className="self-start" />
            )}
            <ProvenanceList provenance={subject.provenance} />
          </InspectorSection>
          {subject.usedIn !== undefined && (
            <InspectorSection title="Used in">
              {subject.usedIn.length === 0 ? (
                <p className="text-caption text-ink-muted">Not used in a report or entity yet.</p>
              ) : (
                <ul className="flex flex-col">
                  {subject.usedIn.map((use) => (
                    <li key={use.href}>
                      <a
                        href={use.href}
                        className="inline-flex min-h-target items-center text-small text-link underline hover:text-link-hover"
                      >
                        {use.label}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </InspectorSection>
          )}
        </>
      );
    case "claim":
      return (
        <InspectorSection>
          <Top pin={pin}>
            <StrengthBadge strength={subject.strength} className="self-start" />
          </Top>
          <p className="text-prose text-ink-body">{subject.text}</p>
          <ProvenanceList provenance={subject.provenance} />
        </InspectorSection>
      );
    case "entity":
      return (
        <>
          <InspectorSection>
            <Top pin={pin}>
              <p className="text-eyebrow text-ink-muted uppercase">
                {ENTITY_CLASS_LABEL[subject.entityClass]}
              </p>
              <h2 className="text-heading break-words text-ink-primary">{subject.name}</h2>
            </Top>
            <Strengths strengths={subject.strengths} />
          </InspectorSection>
          <InspectorSection title="Attributes">
            {subject.attributes.length === 0 ? (
              <p className="text-caption text-ink-muted">
                No attributes are recorded for this entity.
              </p>
            ) : (
              <KeyValueList rows={subject.attributes} />
            )}
          </InspectorSection>
          <InspectorSection title="Evidence" aside={subject.evidenceSummary}>
            <EvidenceList evidence={subject.evidence} />
          </InspectorSection>
        </>
      );
    case "relationship":
      return (
        <>
          <InspectorSection>
            <Top pin={pin}>
              <p className="text-ui-strong text-ink-secondary">{subject.relation}</p>
            </Top>
            <div className="flex flex-col gap-1.25">
              <EntityClassName
                entityClass={subject.from.entityClass}
                className="text-caption text-ink-muted"
              />
              <p className="font-mono text-mono-small break-all text-ink-primary">
                {subject.from.name}
              </p>
            </div>
            <div className="flex flex-col gap-1.25">
              <EntityClassName
                entityClass={subject.to.entityClass}
                className="text-caption text-ink-muted"
              />
              <p className="font-mono text-mono-small break-all text-ink-primary">
                {subject.to.name}
              </p>
            </div>
            <Strengths strengths={subject.strengths} />
          </InspectorSection>
          <InspectorSection title="Evidence">
            <EvidenceList evidence={subject.evidence} />
          </InspectorSection>
        </>
      );
  }
}

/**
 * The inspector and provenance drawer (§9, Workspace and Evidence): ONE
 * docked component, `layout-drawer-width`, full height, a left rule
 * and no shadow. The subject decides the body; the footer pair holds only
 * actions that exist.
 */
export function InspectorDrawer({
  subject,
  onClose,
  pin,
  actions,
  className,
}: {
  readonly subject: InspectorSubject;
  readonly onClose: () => void;
  /** Pin-to-case for the subject (§9: on every result surface). */
  readonly pin?: { readonly pinned: boolean; readonly onToggle: () => void } | undefined;
  readonly actions?:
    | {
        readonly secondary?: InspectorAction | undefined;
        readonly primary?: InspectorAction | undefined;
      }
    | undefined;
  readonly className?: string | undefined;
}) {
  const eyebrow = EYEBROW[subject.kind];
  return (
    <aside
      aria-label={eyebrow}
      className={cn(
        "flex h-full w-drawer max-w-full shrink-0 flex-col border-l border-border-default bg-surface-raised",
        className,
      )}
    >
      <div className="flex items-center gap-3 border-b border-border-subtle px-4.5 py-2.5">
        <h2 className="text-eyebrow text-ink-muted uppercase">{eyebrow}</h2>
        <button
          type="button"
          aria-label={`Close ${eyebrow.toLowerCase()}`}
          onClick={onClose}
          className={cn(
            "hit-area ml-auto inline-flex size-control-sm shrink-0 cursor-pointer items-center justify-center rounded-sm border border-border-strong text-ink-secondary hover:bg-surface-hover",
          )}
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <div className="flex min-h-0 grow flex-col overflow-y-auto">
        <Subject subject={subject} pin={pin} />
      </div>
      {actions !== undefined &&
        (actions.secondary !== undefined || actions.primary !== undefined) && (
          <div className="flex gap-2 border-t border-border-subtle px-4.5 py-4">
            {actions.secondary !== undefined && (
              <Button
                variant="secondary"
                onClick={actions.secondary.onClick}
                className="hit-area min-h-control-md grow basis-0 text-small-strong"
              >
                {actions.secondary.label}
              </Button>
            )}
            {actions.primary !== undefined && (
              <Button
                onClick={actions.primary.onClick}
                className="hit-area min-h-control-md grow basis-0 text-small-strong"
              >
                {actions.primary.label}
              </Button>
            )}
          </div>
        )}
    </aside>
  );
}

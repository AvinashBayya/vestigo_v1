import {
  cn,
  EntityClassName,
  InspectorSection,
  LoadingState,
  Notice,
  Skeleton,
  StrengthBadge,
} from "@repo/ui";
import { useQuery } from "@tanstack/react-query";
import { ClaimValue, Instant, plural } from "../components/Values.tsx";
import { PinButton } from "./Pin.tsx";
import { ProvenanceLink } from "./Provenance.tsx";
import { entityQuery, type EntityClaim, type EntityDetail } from "./queries.ts";
import { Loaded } from "./states.tsx";

/**
 * One entity in the docked inspector (Workspace.dc.html's right column, §9
 * Inspector): what is claimed about it and what it is related to. Every value
 * opens its provenance; DERIVED values are set apart from what a source
 * stated (§1). It takes the InspectorDrawer's shell (drawer width, a left
 * rule, an eyebrow and a close button) because the library's entity subject
 * has no place for stated and derived groups, relationships, or a loading
 * body yet.
 */
export function EntityPanel({
  id,
  onClose,
}: {
  readonly id: string;
  readonly onClose: () => void;
}) {
  const entity = useQuery(entityQuery(id));
  return (
    <aside
      aria-label="Entity"
      className="flex h-full w-full flex-col border-t border-border-default bg-surface-raised lg:border-t-0 lg:border-l"
    >
      <div className="flex items-center gap-3 border-b border-border-subtle px-4.5 py-2.5">
        <h2 className="text-eyebrow text-ink-muted uppercase">Entity</h2>
        <button
          type="button"
          aria-label="Close entity"
          onClick={onClose}
          className="hit-area ml-auto inline-flex size-control-sm shrink-0 cursor-pointer items-center justify-center rounded-sm border border-border-strong text-ink-secondary hover:bg-surface-hover"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <div className="flex min-h-0 grow flex-col overflow-y-auto">
        <Loaded
          query={entity}
          loading={
            <div className="px-4.5 py-4">
              <LoadingState what="Reading the entity">
                <Skeleton className="h-target" />
                <Skeleton className="h-target" />
              </LoadingState>
            </div>
          }
        >
          {(detail) => <EntityBody detail={detail} />}
        </Loaded>
      </div>
    </aside>
  );
}

function EntityBody({ detail }: { readonly detail: EntityDetail }) {
  const { entity, claims, relationships, claimsTruncated } = detail;
  const stated = claims.filter((claim) => claim.strength !== "DERIVED");
  const derived = claims.filter((claim) => claim.strength === "DERIVED");

  return (
    <>
      <InspectorSection>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1.25">
            <EntityClassName
              entityClass={entity.kind}
              className="text-eyebrow text-ink-muted uppercase"
            />
            <p className="text-heading break-words text-ink-primary">{entity.displayName}</p>
            {entity.identifier === null || entity.identifier === entity.displayName ? null : (
              <p className="font-mono text-mono-caption break-all text-ink-secondary">
                {entity.identifier}
              </p>
            )}
          </div>
          <PinButton target={{ type: "entity", id: entity.id }} what={entity.displayName} />
        </div>
        {entity.strengths.length === 0 ? (
          <p className="text-caption text-ink-muted">No claims, so no strength.</p>
        ) : (
          // Every strength, never only the strongest (§2).
          <ul className="flex flex-wrap gap-1.75" aria-label="Claim strengths">
            {entity.strengths.map((strength) => (
              <li key={strength}>
                <StrengthBadge strength={strength} />
              </li>
            ))}
          </ul>
        )}
        {entity.mergedIntoEntityId === null ? null : (
          <Notice>
            Merged into another entity (
            <span className="font-mono text-mono-caption">{entity.mergedIntoEntityId}</span>). It is
            shown as it was recorded.
          </Notice>
        )}
        <p className="text-small text-ink-secondary">
          {plural(entity.claimCount, "claim")} from{" "}
          {plural(entity.evidenceCount, "evidence record")};{" "}
          {plural(entity.relationshipCount, "relationship")}. Recorded{" "}
          <Instant iso={entity.createdAt} />.
        </p>
        {claimsTruncated ? (
          <Notice>
            Partial: showing {String(claims.length)} of {plural(entity.claimCount, "claim")}.
          </Notice>
        ) : null}
      </InspectorSection>
      <ClaimSection
        heading="Stated by a source"
        claims={stated}
        empty="No source stated anything about it."
      />
      <ClaimSection
        heading="Computed by the platform"
        note="DERIVED: worked out from recorded values, not stated by any source."
        claims={derived}
        empty="Nothing about it was computed."
        derived
      />
      <InspectorSection title={`Relationships (${String(relationships.length)})`}>
        {relationships.length === 0 ? (
          <p className="text-caption text-ink-muted">No relationship is recorded for it.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {relationships.map((relationship) => {
              const words =
                relationship.direction === "OUTGOING"
                  ? `${relationship.kind} → ${relationship.otherEntity.displayName}`
                  : `${relationship.otherEntity.displayName} → ${relationship.kind}`;
              return (
                <li
                  key={relationship.id}
                  className="flex items-start gap-3 rounded-inner border border-border-subtle p-3"
                >
                  <div className="flex min-w-0 grow flex-col gap-1">
                    <ProvenanceLink
                      target={{ kind: "relationship", id: relationship.id }}
                      label={`Provenance of the relationship: ${words}`}
                      className="font-mono text-mono-caption break-all"
                    >
                      {words}
                    </ProvenanceLink>
                    <EntityClassName
                      entityClass={relationship.otherEntity.kind}
                      className="text-caption text-ink-muted"
                    />
                    <div className="flex flex-wrap items-center gap-1">
                      {relationship.strengths.map((strength) => (
                        <StrengthBadge key={strength} strength={strength} size="sm" />
                      ))}
                      <span className="text-caption text-ink-muted">
                        {plural(relationship.claimCount, "claim")}
                      </span>
                    </div>
                  </div>
                  <PinButton target={{ type: "relationship", id: relationship.id }} what={words} />
                </li>
              );
            })}
          </ul>
        )}
      </InspectorSection>
    </>
  );
}

function ClaimSection({
  heading,
  note,
  claims,
  empty,
  derived = false,
}: {
  readonly heading: string;
  readonly note?: string;
  readonly claims: readonly EntityClaim[];
  readonly empty: string;
  readonly derived?: boolean;
}) {
  return (
    <InspectorSection title={`${heading} (${String(claims.length)})`}>
      {note === undefined ? null : <p className="text-caption text-ink-muted">{note}</p>}
      {claims.length === 0 ? (
        <p className="text-caption text-ink-muted">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {claims.map((claim) => (
            <li
              key={claim.id}
              className={cn(
                "flex items-start gap-3 rounded-inner border p-3",
                derived ? "border-dashed border-claim-derived-mark" : "border-border-subtle",
              )}
            >
              <div className="flex min-w-0 grow flex-col gap-1">
                <p className="text-meta text-ink-muted">{claim.attribute}</p>
                <ProvenanceLink
                  target={{ kind: "evidence", id: claim.evidenceId, claimId: claim.id }}
                  label={`Provenance of ${claim.attribute}`}
                >
                  <ClaimValue value={claim.value} />
                </ProvenanceLink>
                <StrengthBadge strength={claim.strength} size="sm" className="self-start" />
              </div>
              <PinButton target={{ type: "claim", id: claim.id }} what={claim.attribute} />
            </li>
          ))}
        </ul>
      )}
    </InspectorSection>
  );
}

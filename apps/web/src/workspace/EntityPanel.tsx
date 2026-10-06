import { Button, ClaimStrength, cn, EntityClassName, Notice, Panel, Skeleton } from "@repo/ui";
import { useQuery } from "@tanstack/react-query";
import { ClaimValue, Heading, Instant, plural } from "../components/Values.tsx";
import { PinButton } from "./Pin.tsx";
import { ProvenanceLink } from "./Provenance.tsx";
import { entityQuery, type EntityClaim, type EntityDetail } from "./queries.ts";
import { Loaded } from "./states.tsx";

/**
 * One entity in the inspector: what is claimed about it and what it is
 * related to. Every value opens its provenance; DERIVED values are set apart
 * from what a source stated (§1).
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
    <Panel aria-label="Entity" className="flex flex-col gap-4">
      <div className="flex items-center">
        <Heading>Entity</Heading>
        <Button variant="quiet" className="ml-auto" onClick={onClose}>
          Close
        </Button>
      </div>
      <Loaded
        query={entity}
        loading={
          <div aria-busy="true" aria-label="Reading the entity" className="flex flex-col gap-3">
            <Skeleton className="h-target" />
            <Skeleton className="h-target" />
          </div>
        }
      >
        {(detail) => <EntityBody detail={detail} />}
      </Loaded>
    </Panel>
  );
}

function EntityBody({ detail }: { readonly detail: EntityDetail }) {
  const { entity, claims, relationships, claimsTruncated } = detail;
  const stated = claims.filter((claim) => claim.strength !== "DERIVED");
  const derived = claims.filter((claim) => claim.strength === "DERIVED");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <EntityClassName entityClass={entity.kind} className="text-caption text-ink-muted" />
          <p className="text-title break-all text-ink-primary">{entity.displayName}</p>
          {entity.identifier === null || entity.identifier === entity.displayName ? null : (
            <p className="font-mono text-mono-caption break-all text-ink-secondary">
              {entity.identifier}
            </p>
          )}
          <div className="flex flex-wrap gap-1">
            {entity.strengths.map((strength) => (
              <ClaimStrength key={strength} strength={strength} />
            ))}
          </div>
        </div>
        <PinButton target={{ type: "entity", id: entity.id }} what={entity.displayName} />
      </div>
      {entity.mergedIntoEntityId === null ? null : (
        <Notice>
          Merged into another entity (
          <span className="font-mono text-mono-caption">{entity.mergedIntoEntityId}</span>). It is
          shown as it was recorded.
        </Notice>
      )}
      <p className="text-small text-ink-secondary">
        {plural(entity.claimCount, "claim")} from {plural(entity.evidenceCount, "evidence record")};{" "}
        {plural(entity.relationshipCount, "relationship")}. Recorded{" "}
        <Instant iso={entity.createdAt} />.
      </p>
      {claimsTruncated ? (
        <Notice>
          Partial: showing {String(claims.length)} of {plural(entity.claimCount, "claim")}.
        </Notice>
      ) : null}
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
      <section className="flex flex-col gap-2">
        <Heading>Relationships ({String(relationships.length)})</Heading>
        {relationships.length === 0 ? (
          <p className="text-small text-ink-muted">No relationship is recorded for it.</p>
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
                  className="flex items-start gap-3 rounded-md border border-border-default p-3"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
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
                        <ClaimStrength key={strength} strength={strength} />
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
      </section>
    </div>
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
    <section className="flex flex-col gap-2">
      <Heading>
        {heading} ({String(claims.length)})
      </Heading>
      {note === undefined ? null : <p className="text-caption text-ink-muted">{note}</p>}
      {claims.length === 0 ? (
        <p className="text-small text-ink-muted">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {claims.map((claim) => (
            <li
              key={claim.id}
              className={cn(
                "flex items-start gap-3 rounded-md border p-3",
                derived ? "border-dashed border-claim-derived-mark" : "border-border-default",
              )}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="text-small text-ink-secondary">{claim.attribute}</p>
                <ProvenanceLink
                  target={{ kind: "evidence", id: claim.evidenceId, claimId: claim.id }}
                  label={`Provenance of ${claim.attribute}`}
                >
                  <ClaimValue value={claim.value} />
                </ProvenanceLink>
                <ClaimStrength strength={claim.strength} className="self-start" />
              </div>
              <PinButton target={{ type: "claim", id: claim.id }} what={claim.attribute} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

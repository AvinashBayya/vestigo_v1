import { Card, LoadingState, Notice, NotBuilt, Skeleton, StrengthBadge } from "@repo/ui";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ProvenanceLink } from "./Provenance.tsx";
import {
  caseAnalysisQuery,
  entitiesQuery,
  type EntityList,
  type Scope,
  type Strength,
} from "./queries.ts";
import { Loaded, NOT_BUILT_BODY } from "./states.tsx";

const CARD_SPAN = "lg:col-span-4";

/**
 * The panel's read surface, narrow by design: the case-analysis read is a deep,
 * union-heavy generated type, and a deep structural comparison of it at a prop
 * boundary trips TS2719. The query still returns the generated contract; this
 * view is only the fields the panel renders, which the full read is assignable
 * to — not a second copy of the API contract.
 */
interface Position {
  readonly value: unknown;
  readonly evidenceIds: readonly string[];
  readonly strengths: readonly Strength[];
}
interface Conflict {
  readonly entityId: string;
  readonly attribute: string;
  readonly positions: readonly Position[];
}
interface Review {
  readonly items: readonly Conflict[];
  readonly caveat: string;
}
interface AnalysisRead {
  readonly state: "NONE_YET" | "PENDING" | "COMPLETE" | "FAILED" | "STALE";
  readonly analysis: {
    readonly error: { readonly code: string } | null;
    readonly document: {
      readonly engineVersion: number;
      readonly contradictions?: Review;
    } | null;
  } | null;
}

/** A short, human-readable prefix of a uuid, for when no display name is known. */
const shortId = (id: string): string => id.slice(0, 8);

/** A stored claim value for display: a string as written, anything else as JSON. */
const displayValue = (value: unknown): string =>
  typeof value === "string" ? value : JSON.stringify(value);

/**
 * The Contradictions panel (Overview): the conflicting claim positions the case
 * analysis found, each with its evidence and strength, and the analysis's own
 * neutral caveat. It renders only what the API persisted — it invents no
 * severity, confidence, cause or resolution, and never merges conflicting
 * claims. Contradiction review is a case analysis, so a run scope points to a
 * case instead. Access and the person gate are the API's; a refusal renders as
 * the shared Locked/Failed state through `Loaded`.
 */
export function Contradictions({ scope }: { readonly scope: Scope }) {
  if (scope.kind === "run") {
    return (
      <Card title="Contradictions" className={CARD_SPAN}>
        <NotBuilt
          title="Where one source denies what another states"
          needs="Contradiction review compares the sources pinned to a case. Open or build a case to compare across runs."
          className={NOT_BUILT_BODY}
        />
      </Card>
    );
  }
  return <CaseContradictions scope={scope} />;
}

function CaseContradictions({ scope }: { readonly scope: Scope }) {
  const analysis = useQuery(caseAnalysisQuery(scope.id));
  // Names are a nicety: contradictions render whether or not the entity list is in.
  const entities = useQuery(entitiesQuery(scope));
  return (
    <Card title="Contradictions" className={CARD_SPAN}>
      <Loaded
        query={analysis}
        loading={
          <LoadingState what="Reading the case analysis">
            <Skeleton className="h-target" />
            <Skeleton className="h-target" />
          </LoadingState>
        }
      >
        {(read) => <AnalysisState read={read} names={entities.data} />}
      </Loaded>
    </Card>
  );
}

/** A plain informational line (NONE_YET / PENDING / empty). */
function Info({ children }: { readonly children: ReactNode }) {
  return <p className="text-small text-ink-secondary">{children}</p>;
}

function AnalysisState({
  read,
  names,
}: {
  readonly read: AnalysisRead;
  readonly names: EntityList | undefined;
}) {
  if (read.state === "NONE_YET") {
    return (
      <Info>
        No analysis of this case has run yet, so no contradictions have been checked. Request a case
        analysis to compare its sources.
      </Info>
    );
  }
  if (read.state === "PENDING") {
    return <Info>The case analysis is running; its contradictions are not ready yet.</Info>;
  }
  if (read.state === "FAILED") {
    return (
      <Notice className="text-small">
        The latest case analysis failed ({read.analysis?.error?.code ?? "unknown"}), so no
        contradictions were produced. Requesting it again makes a new attempt.
      </Notice>
    );
  }
  // COMPLETE or STALE.
  const stale = read.state === "STALE";
  const document = read.analysis?.document ?? null;
  if (document === null) {
    return (
      <Notice className="text-small">
        The case&rsquo;s analysis is {stale ? "stale and holds no document" : "not complete"}.
        Request a new one for the case as it is now.
      </Notice>
    );
  }
  if (document.contradictions === undefined) {
    return (
      <Notice className="text-small">
        This analysis (engine v{String(document.engineVersion)}) predates contradiction review.
        Request a new one to check this case for conflicting claims.
      </Notice>
    );
  }
  return <ContradictionList review={document.contradictions} names={names} stale={stale} />;
}

function ContradictionList({
  review,
  names,
  stale,
}: {
  readonly review: Review;
  readonly names: EntityList | undefined;
  readonly stale: boolean;
}) {
  const nameOf = (entityId: string): string =>
    names?.items.find((entity) => entity.id === entityId)?.displayName ?? shortId(entityId);
  return (
    <div className="flex flex-col gap-4">
      {stale ? (
        <Notice className="text-small">
          Stale: the case&rsquo;s records changed since this analysis ran, so it describes the case
          as it was then. Request a new analysis for the case as it is now.
        </Notice>
      ) : null}
      {review.items.length === 0 ? (
        <Info>
          No contradictions: no attribute of any entity has conflicting claims across this
          case&rsquo;s sources.
        </Info>
      ) : (
        <>
          <ul className="flex flex-col gap-4">
            {review.items.map((item) => (
              <ContradictionRow
                key={`${item.entityId}\u0000${item.attribute}`}
                item={item}
                entityName={nameOf(item.entityId)}
              />
            ))}
          </ul>
          <p className="text-small text-ink-muted">{review.caveat}</p>
        </>
      )}
    </div>
  );
}

function ContradictionRow({
  item,
  entityName,
}: {
  readonly item: Conflict;
  readonly entityName: string;
}) {
  return (
    <li className="flex flex-col gap-2 border-l-2 border-border-subtle pl-3">
      <div className="text-small text-ink-secondary">
        <span className="font-mono text-mono-meta text-ink-primary">{item.attribute}</span> of{" "}
        <span className="text-ink-primary">{entityName}</span>
      </div>
      <ul className="flex flex-col gap-2">
        {item.positions.map((position, index) => (
          <PositionRow key={index} position={position} />
        ))}
      </ul>
    </li>
  );
}

function PositionRow({ position }: { readonly position: Position }) {
  return (
    <li className="flex flex-col gap-1">
      <span className="break-words font-mono text-mono-meta text-ink-primary">
        {displayValue(position.value)}
      </span>
      <span className="flex flex-wrap items-center gap-1.5">
        {position.strengths.map((strength) => (
          <StrengthBadge key={strength} strength={strength} size="sm" />
        ))}
        {position.evidenceIds.map((id) => (
          <ProvenanceLink
            key={id}
            target={{ kind: "evidence", id }}
            label={`Provenance of evidence ${id}`}
          >
            <span className="font-mono text-mono-meta">evidence {shortId(id)}</span>
          </ProvenanceLink>
        ))}
      </span>
    </li>
  );
}

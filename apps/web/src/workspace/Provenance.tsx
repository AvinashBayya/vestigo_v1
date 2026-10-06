import {
  Button,
  ClaimStrength,
  cn,
  Drawer,
  EntityClassName,
  Notice,
  Skeleton,
  Unmeasured,
} from "@repo/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { timed, unwrap } from "../api.ts";
import { api } from "../client/index.ts";
import { ProblemNotice } from "../components/ProblemNotice.tsx";
import {
  ClaimValue,
  Heading,
  Instant,
  MaybeInstant,
  MISSING_TIME,
  plural,
} from "../components/Values.tsx";
import { PinButton } from "./Pin.tsx";
import { evidenceQuery, relationshipQuery, type EvidenceDetail } from "./queries.ts";

/** What the drawer can show: one evidence record (a claim highlighted), or one relationship. */
export type ProvenanceTarget =
  | { readonly kind: "evidence"; readonly id: string; readonly claimId?: string }
  | { readonly kind: "relationship"; readonly id: string };

const ProvenanceContext = createContext<((target: ProvenanceTarget) => void) | null>(null);

/** Opens the provenance drawer at a record; usable from any value on any surface. */
export function useProvenance(): (target: ProvenanceTarget) => void {
  const open = useContext(ProvenanceContext);
  if (open === null) throw new TypeError("useProvenance needs a ProvenanceProvider");
  return open;
}

/**
 * The provenance drawer (§9): one component, reused everywhere. Moving from a
 * relationship to the evidence behind it keeps a trail, so Back returns.
 */
export function ProvenanceProvider({ children }: { readonly children: ReactNode }) {
  const [trail, setTrail] = useState<readonly ProvenanceTarget[]>([]);
  const open = useCallback((target: ProvenanceTarget) => {
    setTrail([target]);
  }, []);
  const push = useCallback((target: ProvenanceTarget) => {
    setTrail((current) => [...current, target]);
  }, []);
  const current = trail.at(-1);
  const value = useMemo(() => open, [open]);

  return (
    <ProvenanceContext.Provider value={value}>
      {children}
      <Drawer
        open={current !== undefined}
        onOpenChange={(next) => {
          if (!next) setTrail([]);
        }}
        title="Provenance"
        description="Where this came from: the collector, both timestamps, the content hash, the source and the raw payload."
      >
        {trail.length > 1 ? (
          <Button
            variant="quiet"
            className="self-start"
            onClick={() => {
              setTrail((now) => now.slice(0, -1));
            }}
          >
            Back
          </Button>
        ) : null}
        {current === undefined ? null : current.kind === "evidence" ? (
          <EvidenceProvenance key={`e:${current.id}`} id={current.id} claimId={current.claimId} />
        ) : (
          <RelationshipProvenance key={`r:${current.id}`} id={current.id} onEvidence={push} />
        )}
      </Drawer>
    </ProvenanceContext.Provider>
  );
}

/** A button that opens provenance: the value itself is the control (§9, "opens from any value"). */
export function ProvenanceLink({
  target,
  children,
  label,
  className,
}: {
  readonly target: ProvenanceTarget;
  readonly children: ReactNode;
  /** The accessible name, when the visible text alone does not say what opens. */
  readonly label?: string;
  readonly className?: string;
}) {
  const open = useProvenance();
  return (
    <button
      type="button"
      aria-label={label}
      className={cn(
        "min-h-target cursor-pointer rounded-sm text-left underline decoration-border-strong underline-offset-4 hover:bg-surface-hover",
        className,
      )}
      onClick={() => {
        open(target);
      }}
    >
      {children}
    </button>
  );
}

function Row({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border-subtle py-2">
      <dt className="text-small text-ink-secondary">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}

/** A source URL is untrusted text: linked only when it is plain http(s), never as a script. */
function SourceUrl({ url }: { readonly url: string | null }) {
  if (url === null) return <Unmeasured reason="No source URL was recorded for this evidence." />;
  const linkable = /^https?:\/\//i.test(url);
  return linkable ? (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="font-mono text-mono-caption break-all text-accent underline"
    >
      {url}
    </a>
  ) : (
    <span className="font-mono text-mono-caption break-all">{url}</span>
  );
}

function DrawerSkeleton() {
  return (
    <div aria-busy="true" aria-label="Reading provenance" className="flex flex-col gap-3">
      <Skeleton className="h-target" />
      <Skeleton className="h-target" />
      <Skeleton className="h-target" />
    </div>
  );
}

/** The raw payload, fetched through the client and saved as a file: never opened in the app. */
function PayloadDownload({ evidence }: { readonly evidence: EvidenceDetail }) {
  const download = useMutation({
    mutationFn: async () => {
      const blob = await unwrap(
        api.GET("/api/v1/evidence/{id}/payload", {
          params: { path: { id: evidence.id } },
          parseAs: "blob",
          signal: timed(),
        }),
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `evidence-${evidence.id}.bin`;
      anchor.click();
      URL.revokeObjectURL(url);
    },
  });
  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="secondary"
        disabled={download.isPending}
        onClick={() => {
          download.mutate();
        }}
      >
        Download raw payload
      </Button>
      <p className="text-caption text-ink-muted">
        Exactly as collected, checked against its content hash before it is sent. It is saved as a
        file and never opened here.
      </p>
      {download.isError ? <ProblemNotice error={download.error} /> : null}
    </div>
  );
}

function EvidenceProvenance({
  id,
  claimId,
}: {
  readonly id: string;
  readonly claimId?: string | undefined;
}) {
  const evidence = useQuery(evidenceQuery(id));
  if (evidence.isPending) return <DrawerSkeleton />;
  if (evidence.isError) {
    return (
      <ProblemNotice error={evidence.error}>
        <Button variant="quiet" className="self-start" onClick={() => void evidence.refetch()}>
          Try again
        </Button>
      </ProblemNotice>
    );
  }
  const record = evidence.data;
  const source = record.sourceLabel ?? record.collectorId;
  const shown = record.stated.length + record.derived.length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-title text-ink-primary">{source}</p>
          <ClaimStrength strength={record.strength} className="self-start" />
        </div>
        <PinButton target={{ type: "evidence", id: record.id }} what={`evidence from ${source}`} />
      </div>
      <dl className="flex flex-col">
        <Row label="Collector">
          <span className="font-mono text-mono-caption">
            {record.collectorId} v{record.collectorVersion}
          </span>
        </Row>
        <Row label="Source">
          {record.sourceLabel === null ? (
            <Unmeasured reason="This collector is not in the platform registry, so it has no label. Its id is shown as the collector." />
          ) : (
            <span className="text-small">{record.sourceLabel}</span>
          )}
        </Row>
        <Row label="Run">
          {record.runId === null ? (
            <Unmeasured reason="No run is recorded for this evidence." />
          ) : (
            <span className="font-mono text-mono-caption break-all">{record.runId}</span>
          )}
        </Row>
        <Row label="Observed">
          <MaybeInstant iso={record.observedAt} missing={MISSING_TIME.observedAt} />
        </Row>
        <Row label="Collected">
          <MaybeInstant iso={record.collectedAt} missing={MISSING_TIME.collectedAt} />
        </Row>
        <Row label="Recorded">
          <Instant iso={record.recordedAt} />
        </Row>
        <Row label="Content hash">
          <span className="font-mono text-mono-caption break-all">{record.contentHash}</span>
        </Row>
        <Row label="Source URL">
          <SourceUrl url={record.sourceUrl} />
        </Row>
      </dl>
      {record.attribution === null ? null : (
        <p className="text-small text-ink-secondary">
          Attribution:{" "}
          <a
            href={record.attribution.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent underline"
          >
            {record.attribution.text}
          </a>
        </p>
      )}
      <PayloadDownload evidence={record} />

      {record.claimsTruncated ? (
        <Notice>
          Partial: showing {String(shown)} of {plural(record.claimCount, "claim")} citing this
          evidence.
        </Notice>
      ) : null}
      <ClaimList
        heading={`Stated by the source (${String(record.stated.length)})`}
        empty="The source stated nothing that was recorded as a claim."
        claims={record.stated}
        highlight={claimId}
      />
      <ClaimList
        heading={`Computed by the platform (${String(record.derived.length)})`}
        note="DERIVED: worked out from recorded values, not stated by the source."
        empty="Nothing was computed from this evidence."
        claims={record.derived}
        highlight={claimId}
        derived
      />
    </div>
  );
}

function ClaimList({
  heading,
  note,
  empty,
  claims,
  highlight,
  derived = false,
}: {
  readonly heading: string;
  readonly note?: string;
  readonly empty: string;
  readonly claims: EvidenceDetail["stated"];
  readonly highlight: string | undefined;
  readonly derived?: boolean;
}) {
  return (
    <section className="flex flex-col gap-2">
      <Heading>{heading}</Heading>
      {note === undefined ? null : <p className="text-caption text-ink-muted">{note}</p>}
      {claims.length === 0 ? (
        <p className="text-small text-ink-muted">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {claims.map((claim) => (
            <li
              key={claim.id}
              aria-current={claim.id === highlight ? "true" : undefined}
              className={cn(
                "flex items-start gap-3 rounded-md border p-3",
                derived ? "border-dashed border-claim-derived-mark" : "border-border-default",
                claim.id === highlight ? "bg-accent-soft" : null,
              )}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="text-small text-ink-secondary">{claim.attribute}</p>
                <ClaimValue value={claim.value} />
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

function RelationshipProvenance({
  id,
  onEvidence,
}: {
  readonly id: string;
  readonly onEvidence: (target: ProvenanceTarget) => void;
}) {
  const relationship = useQuery(relationshipQuery(id));
  if (relationship.isPending) return <DrawerSkeleton />;
  if (relationship.isError) {
    return (
      <ProblemNotice error={relationship.error}>
        <Button variant="quiet" className="self-start" onClick={() => void relationship.refetch()}>
          Try again
        </Button>
      </ProblemNotice>
    );
  }
  const { relationship: edge, claims, claimsTruncated } = relationship.data;
  const what = `${edge.source.displayName} ${edge.kind} ${edge.target.displayName}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="text-small text-ink-secondary">Relationship</p>
          <p className="flex flex-wrap items-center gap-2 text-body text-ink-primary">
            <span className="font-mono text-mono-body">{edge.source.displayName}</span>
            <EntityClassName
              entityClass={edge.source.kind}
              className="text-caption text-ink-muted"
            />
          </p>
          <p className="font-mono text-mono-caption text-ink-secondary">{edge.kind}</p>
          <p className="flex flex-wrap items-center gap-2 text-body text-ink-primary">
            <span className="font-mono text-mono-body">{edge.target.displayName}</span>
            <EntityClassName
              entityClass={edge.target.kind}
              className="text-caption text-ink-muted"
            />
          </p>
        </div>
        <PinButton target={{ type: "relationship", id: edge.id }} what={what} />
      </div>
      <dl className="flex flex-col">
        <Row label="Claims behind it">
          <span className="font-mono text-mono-caption">{String(edge.claimCount)}</span>
        </Row>
        <Row label="Recorded">
          <Instant iso={edge.createdAt} />
        </Row>
      </dl>
      {claimsTruncated ? (
        <Notice>
          Partial: showing {String(claims.length)} of {plural(edge.claimCount, "claim")} behind this
          relationship.
        </Notice>
      ) : null}
      <section className="flex flex-col gap-2">
        <Heading>What asserts it</Heading>
        {claims.length === 0 ? (
          <p className="text-small text-ink-muted">
            No claim asserts this relationship, so no evidence stands behind it.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {claims.map((claim) => (
              <li
                key={claim.id}
                className={cn(
                  "flex items-start gap-3 rounded-md border p-3",
                  claim.strength === "DERIVED"
                    ? "border-dashed border-claim-derived-mark"
                    : "border-border-default",
                )}
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <p className="text-small text-ink-secondary">{claim.attribute}</p>
                  <ClaimValue value={claim.value} />
                  <div className="flex flex-wrap items-center gap-2">
                    <ClaimStrength strength={claim.strength} />
                    {claim.strength === "DERIVED" ? (
                      <span className="text-caption text-ink-muted">computed by the platform</span>
                    ) : null}
                  </div>
                  <Button
                    variant="quiet"
                    className="self-start"
                    onClick={() => {
                      onEvidence({ kind: "evidence", id: claim.evidenceId, claimId: claim.id });
                    }}
                  >
                    Evidence behind this claim
                  </Button>
                </div>
                <PinButton target={{ type: "claim", id: claim.id }} what={claim.attribute} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

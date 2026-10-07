import {
  Button,
  cn,
  EntityClassName,
  InspectorSection,
  KeyValueList,
  LoadingState,
  Notice,
  Skeleton,
  StrengthBadge,
  type KeyValueRow,
} from "@repo/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { timed, unwrap } from "../api.ts";
import { api } from "../client/index.ts";
import { ProblemNotice } from "../components/ProblemNotice.tsx";
import { ClaimValue, Instant, MISSING_TIME, plural } from "../components/Values.tsx";
import { PinButton } from "./Pin.tsx";
import { evidenceQuery, relationshipQuery, type EvidenceDetail } from "./queries.ts";

/** What the dock can show: one evidence record (a claim highlighted), or one relationship. */
export type ProvenanceTarget =
  | { readonly kind: "evidence"; readonly id: string; readonly claimId?: string }
  | { readonly kind: "relationship"; readonly id: string };

interface ProvenanceState {
  readonly trail: readonly ProvenanceTarget[];
  /** Opens the dock at a target, replacing the trail. */
  readonly open: (target: ProvenanceTarget) => void;
  /** Walks on from the current target, so Back returns to it. */
  readonly push: (target: ProvenanceTarget) => void;
  readonly back: () => void;
  readonly close: () => void;
  /** Closes without moving focus: another surface is taking the dock's place. */
  readonly reset: () => void;
  /** A ProvenanceLayout says it draws the dock; until one does, the provider draws it. */
  readonly host: () => () => void;
}

const ProvenanceContext = createContext<ProvenanceState | null>(null);
/** Inside the dock, a value walks on (push) rather than starting over. */
const InDockContext = createContext(false);
/** Inside a ProvenanceLayout already: an inner one adds nothing. */
const InLayoutContext = createContext(false);

function useProvenanceState(): ProvenanceState {
  const state = useContext(ProvenanceContext);
  if (state === null) throw new TypeError("useProvenance needs a ProvenanceProvider");
  return state;
}

/** Opens the provenance dock at a record; usable from any value on any surface. */
export function useProvenance(): (target: ProvenanceTarget) => void {
  const state = useProvenanceState();
  const inDock = useContext(InDockContext);
  return inDock ? state.push : state.open;
}

/** What the dock shows now, if anything: a surface marks its open row or node from it. */
export function useProvenanceCurrent(): ProvenanceTarget | undefined {
  return useProvenanceState().trail.at(-1);
}

/** Closes the dock without returning focus: for a surface that shows something else in its place. */
export function useProvenanceReset(): () => void {
  return useProvenanceState().reset;
}

/**
 * The provenance dock's state (§9): one component, reused everywhere. Moving
 * from a relationship to the evidence behind it keeps a trail, so Back
 * returns. Where no ProvenanceLayout is mounted, the dock floats at the right
 * edge instead of being docked beside the content.
 */
export function ProvenanceProvider({ children }: { readonly children: ReactNode }) {
  const [trail, setTrail] = useState<readonly ProvenanceTarget[]>([]);
  const [hosts, setHosts] = useState(0);
  // The control that opened the dock: focus returns there on close (§7).
  const opener = useRef<HTMLElement | null>(null);

  const open = useCallback((target: ProvenanceTarget) => {
    const active = document.activeElement;
    opener.current = active instanceof HTMLElement ? active : null;
    setTrail([target]);
  }, []);
  const push = useCallback((target: ProvenanceTarget) => {
    setTrail((current) => [...current, target]);
  }, []);
  const back = useCallback(() => {
    setTrail((current) => current.slice(0, -1));
  }, []);
  const close = useCallback(() => {
    setTrail([]);
    const returnTo = opener.current;
    opener.current = null;
    if (returnTo?.isConnected === true) returnTo.focus();
  }, []);
  const reset = useCallback(() => {
    opener.current = null;
    setTrail([]);
  }, []);
  const host = useCallback(() => {
    setHosts((count) => count + 1);
    return () => {
      setHosts((count) => count - 1);
    };
  }, []);

  const value = useMemo(
    () => ({ trail, open, push, back, close, reset, host }),
    [trail, open, push, back, close, reset, host],
  );

  return (
    <ProvenanceContext.Provider value={value}>
      {children}
      {hosts === 0 ? <ProvenanceDock place="floating" /> : null}
    </ProvenanceContext.Provider>
  );
}

/**
 * A surface with the dock beside it (Evidence, Workspace): the content takes
 * the row, and the dock, when open, sits on its right at `layout-drawer-width`.
 * Below `lg` the dock floats over the right edge instead.
 */
export function ProvenanceLayout({ children }: { readonly children: ReactNode }) {
  const inLayout = useContext(InLayoutContext);
  const { host } = useProvenanceState();
  useLayoutEffect(() => (inLayout ? undefined : host()), [inLayout, host]);
  if (inLayout) return <>{children}</>;
  return (
    <InLayoutContext.Provider value>
      <div className="flex min-h-0 grow gap-4.5">
        <div className="flex min-w-0 grow flex-col">{children}</div>
        <ProvenanceDock place="beside" />
      </div>
    </InLayoutContext.Provider>
  );
}

/**
 * The dock drawn in a column the caller places (the workspace's inspector
 * column, Graph tab): the render prop receives the dock when something is
 * open, or null, so the caller can show its own inspector instead.
 */
export function ProvenanceInspector({
  children,
}: {
  readonly children: (dock: ReactNode) => ReactNode;
}) {
  const inLayout = useContext(InLayoutContext);
  const { host, trail } = useProvenanceState();
  useLayoutEffect(() => (inLayout ? undefined : host()), [inLayout, host]);
  if (inLayout) return <>{children(null)}</>;
  return (
    <InLayoutContext.Provider value>
      {children(trail.length === 0 ? null : <ProvenanceDock place="column" />)}
    </InLayoutContext.Provider>
  );
}

const EYEBROW: Readonly<Record<ProvenanceTarget["kind"], string>> = {
  evidence: "Provenance",
  relationship: "Relationship",
};

/**
 * Where the dock is drawn: floating at the right edge (no layout hosts it),
 * beside the content (ProvenanceLayout; floating below lg), or filling a
 * column the caller placed (ProvenanceInspector; stacked below lg).
 */
const PLACE = {
  floating: "fixed inset-y-0 right-0 z-10 w-full max-w-drawer border-l shadow-overlay",
  beside: cn(
    "fixed inset-y-0 right-0 z-10 w-full max-w-drawer border-l shadow-overlay",
    "lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:w-drawer lg:max-w-full lg:shrink-0 lg:shadow-none",
  ),
  column: "h-full w-full border-t lg:border-t-0 lg:border-l",
} as const;

/**
 * The docked drawer (§9 Inspector and provenance drawer): `w-drawer`, full
 * height, a left rule, no shadow while docked. It is a non-modal dialog: the
 * page beside it stays usable. Focus moves to its heading when it opens or
 * walks on, Escape closes it, and focus returns to what opened it. The root
 * stays mounted while the trail changes.
 */
function ProvenanceDock({ place }: { readonly place: keyof typeof PLACE }) {
  const { trail, back, close } = useProvenanceState();
  const current = trail.at(-1);
  const heading = useRef<HTMLHeadingElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const headingId = useId();

  useEffect(() => {
    if (current !== undefined) heading.current?.focus();
  }, [current]);

  if (current === undefined) return null;
  const eyebrow = EYEBROW[current.kind];

  const onKeyDown = (event: KeyboardEvent) => {
    // Only from inside the dock itself: a popover opened from it handles its own Escape.
    if (event.key !== "Escape") return;
    if (!(event.target instanceof Node) || root.current?.contains(event.target) !== true) return;
    event.stopPropagation();
    close();
  };

  return (
    <div
      ref={root}
      role="dialog"
      aria-modal="false"
      aria-labelledby={headingId}
      onKeyDown={onKeyDown}
      className={cn("flex flex-col border-border-default bg-surface-raised", PLACE[place])}
    >
      <div className="flex items-center gap-3 border-b border-border-subtle px-4.5 py-2.5">
        <h2
          id={headingId}
          ref={heading}
          tabIndex={-1}
          className="text-eyebrow text-ink-muted uppercase"
        >
          {eyebrow}
        </h2>
        <div className="ml-auto flex items-center gap-2">
          {trail.length > 1 ? (
            <Button variant="quiet" size="sm" onClick={back}>
              Back
            </Button>
          ) : null}
          <button
            type="button"
            aria-label={`Close ${eyebrow.toLowerCase()}`}
            onClick={close}
            className="hit-area inline-flex size-control-sm shrink-0 cursor-pointer items-center justify-center rounded-sm border border-border-strong text-ink-secondary hover:bg-surface-hover"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
      </div>
      <InDockContext.Provider value>
        <div className="flex min-h-0 grow flex-col overflow-y-auto">
          {current.kind === "evidence" ? (
            <EvidenceProvenance
              key={`e:${current.id}:${current.claimId ?? ""}`}
              id={current.id}
              claimId={current.claimId}
            />
          ) : (
            <RelationshipProvenance key={`r:${current.id}`} id={current.id} />
          )}
        </div>
      </InDockContext.Provider>
    </div>
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

/** A source URL is untrusted text: linked only when it is plain http(s), never as a script. */
function sourceUrlRow(url: string | null): KeyValueRow {
  if (url === null) {
    return {
      key: "Source URL",
      value: null,
      reason: "No source URL was recorded for this evidence.",
    };
  }
  return {
    key: "Source URL",
    value: /^https?:\/\//i.test(url) ? (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        // The target is an overlay, so the row keeps its pitch; a long URL breaks anywhere,
        // right-aligned in the value column like every other identifier.
        className="hit-area break-all text-link underline hover:text-link-hover"
      >
        {url}
      </a>
    ) : (
      url
    ),
  };
}

function DockLoading() {
  return (
    <InspectorSection>
      <LoadingState what="Reading provenance.">
        <Skeleton className="h-row-compact" />
        <Skeleton className="h-row-compact" />
        <Skeleton className="h-row-compact" />
      </LoadingState>
    </InspectorSection>
  );
}

/** The raw payload, fetched through the client and saved as a file: never opened in the app. */
function usePayloadDownload(id: string) {
  return useMutation({
    mutationFn: async () => {
      const blob = await unwrap(
        api.GET("/api/v1/evidence/{id}/payload", {
          params: { path: { id } },
          parseAs: "blob",
          signal: timed(),
        }),
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `evidence-${id}.bin`;
      anchor.click();
      URL.revokeObjectURL(url);
    },
  });
}

function EvidenceProvenance({
  id,
  claimId,
}: {
  readonly id: string;
  readonly claimId?: string | undefined;
}) {
  const evidence = useQuery(evidenceQuery(id));
  const download = usePayloadDownload(id);
  if (evidence.isPending) return <DockLoading />;
  if (evidence.isError) {
    return (
      <InspectorSection>
        <ProblemNotice error={evidence.error} onRetry={() => void evidence.refetch()} />
      </InspectorSection>
    );
  }
  const record = evidence.data;
  const source = record.sourceLabel ?? record.collectorId;
  const shown = record.stated.length + record.derived.length;

  const rows: KeyValueRow[] = [
    record.sourceLabel === null
      ? {
          key: "Source",
          value: null,
          reason: "This collector is not in the platform registry, so it has no label.",
        }
      : { key: "Source", value: record.sourceLabel, mono: false },
    // One text node: the collector's id and the version that produced this record.
    { key: "Collector", value: `${record.collectorId} v${record.collectorVersion}` },
    record.runId === null
      ? { key: "Run", value: null, reason: "No run is recorded for this evidence." }
      : { key: "Run", value: record.runId },
    record.observedAt === null
      ? { key: "Observed", value: null, reason: MISSING_TIME.observedAt }
      : { key: "Observed", value: <Instant iso={record.observedAt} /> },
    record.collectedAt === null
      ? { key: "Collected", value: null, reason: MISSING_TIME.collectedAt }
      : { key: "Collected", value: <Instant iso={record.collectedAt} /> },
    { key: "Recorded", value: <Instant iso={record.recordedAt} /> },
    { key: "Content hash", value: record.contentHash },
    sourceUrlRow(record.sourceUrl),
    {
      key: "Raw payload",
      mono: false,
      value: (
        <Button
          variant="quiet"
          size="sm"
          className="px-0"
          disabled={download.isPending}
          onClick={() => {
            download.mutate();
          }}
        >
          Download raw payload
        </Button>
      ),
    },
  ];

  return (
    <>
      <InspectorSection>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1.25">
            <p className="text-heading break-words text-ink-primary">{source}</p>
            <StrengthBadge strength={record.strength} className="self-start" />
          </div>
          <PinButton
            target={{ type: "evidence", id: record.id }}
            what={`evidence from ${source}`}
          />
        </div>
        <KeyValueList rows={rows} />
        <p className="text-caption text-ink-muted">
          Exactly as collected, checked against its content hash before it is sent. It is saved as a
          file and never opened here.
        </p>
        {download.isError ? (
          <ProblemNotice error={download.error} title="The raw payload could not be downloaded." />
        ) : null}
      </InspectorSection>
      {record.attribution === null ? null : (
        <InspectorSection title="Attribution">
          <a
            href={record.attribution.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-target items-center self-start text-small text-link underline hover:text-link-hover"
          >
            {record.attribution.text}
          </a>
        </InspectorSection>
      )}
      {record.claimsTruncated ? (
        <InspectorSection>
          <Notice>
            Partial: showing {String(shown)} of {plural(record.claimCount, "claim")} citing this
            evidence.
          </Notice>
        </InspectorSection>
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
    </>
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
    <InspectorSection title={heading}>
      {note === undefined ? null : <p className="text-caption text-ink-muted">{note}</p>}
      {claims.length === 0 ? (
        <p className="text-small text-ink-muted">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {claims.map((claim) => {
            const opened = claim.id === highlight;
            return (
              <li
                key={claim.id}
                aria-current={opened ? "true" : undefined}
                className={cn(
                  "flex items-start gap-3 rounded-md border p-3",
                  derived ? "border-dashed border-claim-derived-mark" : "border-border-default",
                  opened && "border-accent",
                )}
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  {opened ? (
                    <p className="text-meta-strong text-accent-ink">Opened from this claim</p>
                  ) : null}
                  <p className="text-small text-ink-secondary">{claim.attribute}</p>
                  <ClaimValue value={claim.value} />
                  <StrengthBadge strength={claim.strength} size="sm" className="self-start" />
                </div>
                <PinButton target={{ type: "claim", id: claim.id }} what={claim.attribute} />
              </li>
            );
          })}
        </ul>
      )}
    </InspectorSection>
  );
}

function RelationshipProvenance({ id }: { readonly id: string }) {
  const relationship = useQuery(relationshipQuery(id));
  const walk = useProvenance();
  if (relationship.isPending) return <DockLoading />;
  if (relationship.isError) {
    return (
      <InspectorSection>
        <ProblemNotice error={relationship.error} onRetry={() => void relationship.refetch()} />
      </InspectorSection>
    );
  }
  const { relationship: edge, claims, claimsTruncated } = relationship.data;
  const what = `${edge.source.displayName} ${edge.kind} ${edge.target.displayName}`;

  return (
    <>
      <InspectorSection>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-2">
            <p className="flex flex-col gap-1">
              <EntityClassName
                entityClass={edge.source.kind}
                className="text-caption text-ink-muted"
              />
              <span className="font-mono text-mono-small break-all text-ink-primary">
                {edge.source.displayName}
              </span>
            </p>
            <p className="font-mono text-mono-meta text-ink-secondary">{edge.kind}</p>
            <p className="flex flex-col gap-1">
              <EntityClassName
                entityClass={edge.target.kind}
                className="text-caption text-ink-muted"
              />
              <span className="font-mono text-mono-small break-all text-ink-primary">
                {edge.target.displayName}
              </span>
            </p>
          </div>
          <PinButton target={{ type: "relationship", id: edge.id }} what={what} />
        </div>
        {edge.strengths.length === 0 ? (
          <p className="text-caption text-ink-muted">No claims, so no strength.</p>
        ) : (
          <ul aria-label="Claim strengths" className="flex flex-wrap gap-1.75">
            {edge.strengths.map((strength) => (
              <li key={strength}>
                <StrengthBadge strength={strength} />
              </li>
            ))}
          </ul>
        )}
        <KeyValueList
          rows={[
            { key: "Claims behind it", value: String(edge.claimCount) },
            { key: "Recorded", value: <Instant iso={edge.createdAt} /> },
          ]}
        />
      </InspectorSection>
      {claimsTruncated ? (
        <InspectorSection>
          <Notice>
            Partial: showing {String(claims.length)} of {plural(edge.claimCount, "claim")} behind
            this relationship.
          </Notice>
        </InspectorSection>
      ) : null}
      <InspectorSection title="What asserts it">
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
                    <StrengthBadge strength={claim.strength} size="sm" />
                    {claim.strength === "DERIVED" ? (
                      <span className="text-caption text-ink-muted">computed by the platform</span>
                    ) : null}
                  </div>
                  <Button
                    variant="quiet"
                    size="sm"
                    className="self-start px-0"
                    onClick={() => {
                      walk({ kind: "evidence", id: claim.evidenceId, claimId: claim.id });
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
      </InspectorSection>
    </>
  );
}

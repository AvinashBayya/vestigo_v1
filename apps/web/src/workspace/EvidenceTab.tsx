import {
  AddFilterChip,
  Button,
  CLAIM_STRENGTH_LABELS,
  DataTable,
  FilterChip,
  FilterChipRow,
  StrengthBadge,
  TableSearch,
  Unmeasured,
  type DataTableEmpty,
} from "@repo/ui";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, type KeyboardEvent } from "react";
import { MaybeInstant, MISSING_TIME, plural } from "../components/Values.tsx";
import { Grid, gridColumns, type GridColumnStyle } from "./Grid.tsx";
import { PinButton, usePinState } from "./Pin.tsx";
import { ProvenanceLayout, ProvenanceLink, useProvenanceCurrent } from "./Provenance.tsx";
import {
  timelineQuery,
  type Scope,
  type Strength,
  type Timeline,
  type TimelineEvent,
} from "./queries.ts";
import { CutListNotice, Loaded } from "./states.tsx";

const NOT_REGISTERED =
  "This collector is not in the platform registry, so it has no label. Its id is shown instead.";

/** The registry's label, or, for a collector the registry does not list, its id. */
const sourceOf = (row: TimelineEvent) => row.sourceLabel ?? row.collectorId;

const column = gridColumns<TimelineEvent>();

/**
 * The Source cell. The row whose provenance is open is tinted by the grid
 * (`surface-hover`, aria-current) and its source set in the strong weight:
 * weight as well as tint, never the tint alone.
 */
function SourceCell({ row }: { readonly row: TimelineEvent }) {
  const current = useProvenanceCurrent();
  const open = current?.kind === "evidence" && current.id === row.evidenceId;
  return (
    <span className="flex items-center gap-1">
      <ProvenanceLink
        target={{ kind: "evidence", id: row.evidenceId }}
        label={`Provenance of evidence from ${sourceOf(row)}`}
        className={open ? "text-ui-strong" : ""}
      >
        {row.sourceLabel ?? <span className="font-mono text-mono-meta">{row.collectorId}</span>}
      </ProvenanceLink>
      {row.sourceLabel === null ? <Unmeasured reason={NOT_REGISTERED} /> : null}
    </span>
  );
}

/**
 * Columns: what a reader compares (§9: a grid, not cards). Null times sort
 * last. "Source", not the drawn "Collector": the value is the registry's
 * label (CLAUDE.md, Source labelling); the collector id is in the drawer.
 * No claim-text or hash column: the list read carries neither.
 */
const COLUMNS = column.columns([
  column.accessor(sourceOf, {
    id: "source",
    header: "Source",
    sortFn: "text",
    cell: (info) => <SourceCell row={info.row.original} />,
  }),
  column.accessor("strength", {
    header: "Strength",
    sortFn: (a, b) =>
      CLAIM_STRENGTH_LABELS.indexOf(a.original.strength) -
      CLAIM_STRENGTH_LABELS.indexOf(b.original.strength),
    cell: (info) => <StrengthBadge strength={info.getValue()} size="sm" />,
  }),
  column.accessor((row) => row.observedAt ?? undefined, {
    id: "observedAt",
    header: "Observed",
    sortFn: "basic",
    sortUndefined: "last",
    cell: (info) => (
      <MaybeInstant iso={info.row.original.observedAt} missing={MISSING_TIME.observedAt} />
    ),
  }),
  column.accessor((row) => row.collectedAt ?? undefined, {
    id: "collectedAt",
    header: "Collected",
    sortFn: "basic",
    sortUndefined: "last",
    cell: (info) => (
      <MaybeInstant iso={info.row.original.collectedAt} missing={MISSING_TIME.collectedAt} />
    ),
  }),
  column.accessor("claimCount", {
    header: "Claims",
    sortFn: "basic",
    cell: (info) => String(info.getValue()),
  }),
  column.accessor((row) => row.sourceUrl ?? undefined, {
    id: "sourceUrl",
    header: "Source URL",
    enableSorting: false,
    cell: (info) => {
      const url = info.row.original.sourceUrl;
      // Untrusted text: never linked in the grid. The drawer links plain http(s) only.
      return url === null ? (
        <Unmeasured reason="No source URL was recorded for this evidence." />
      ) : (
        <span className="break-all">{url}</span>
      );
    },
  }),
]);

const STYLE: GridColumnStyle = {
  source: { kind: "primary" },
  observedAt: { kind: "mono" },
  collectedAt: { kind: "mono-muted" },
  claimCount: { kind: "mono", align: "end" },
  sourceUrl: { kind: "mono-muted" },
};

const LIST_COLUMNS = [
  { id: "source", header: "Source" },
  { id: "strength", header: "Strength" },
  { id: "observedAt", header: "Observed" },
  { id: "collectedAt", header: "Collected" },
  { id: "claimCount", header: "Claims" },
  { id: "sourceUrl", header: "Source URL" },
] as const;

const emptyFor = (scope: Scope): DataTableEmpty => ({
  kind: "empty",
  title: "No evidence yet",
  body:
    scope.kind === "run"
      ? "This run recorded no evidence. The run view lists what each source did and why."
      : "Nothing pinned to this case brings evidence with it yet. Pin evidence, a claim, an entity or a relationship from a run's results.",
});

/**
 * The Evidence tab (docs/design/mockups/Evidence.dc.html): every evidence
 * record of the run or case, from the timeline read, which is the API's only
 * evidence list. At most 500 come back; a larger set says so and how many.
 * The provenance dock sits beside the grid.
 */
export function EvidenceTab({ scope }: { readonly scope: Scope }) {
  const timeline = useQuery(timelineQuery(scope, "collectedAt"));
  return (
    <ProvenanceLayout>
      <div className="flex flex-col gap-4 px-6 py-4.5">
        <Loaded
          query={timeline}
          loading={
            <DataTable
              caption="Evidence"
              columns={LIST_COLUMNS}
              rows={[]}
              empty={emptyFor(scope)}
              loading="Reading the evidence."
            />
          }
        >
          {(data) => <EvidenceGrid data={data} scope={scope} />}
        </Loaded>
      </div>
    </ProvenanceLayout>
  );
}

function EvidenceGrid({ data, scope }: { readonly data: Timeline; readonly scope: Scope }) {
  const [text, setText] = useState("");
  const [strength, setStrength] = useState<Strength | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const pinState = usePinState(scope);
  const current = useProvenanceCurrent();

  const sources = useMemo(
    () => [...new Set(data.items.map(sourceOf))].sort((a, b) => a.localeCompare(b)),
    [data.items],
  );
  const rows = useMemo(() => {
    const needle = text.trim().toLowerCase();
    return data.items.filter(
      (row) =>
        (strength === null || row.strength === strength) &&
        (source === null || sourceOf(row) === source) &&
        (needle === "" ||
          [row.sourceLabel, row.collectorId, row.sourceUrl, row.evidenceId].some(
            (value) => value?.toLowerCase().includes(needle) === true,
          )),
    );
  }, [data.items, text, strength, source]);

  if (data.total === 0) {
    return (
      <DataTable caption="Evidence" columns={LIST_COLUMNS} rows={[]} empty={emptyFor(scope)} />
    );
  }

  const clear = () => {
    setText("");
    setStrength(null);
    setSource(null);
  };
  const filtered = rows.length !== data.items.length;
  const closeOnEscape = (event: KeyboardEvent) => {
    if (event.key === "Escape") setAdding(false);
  };

  const toolbar = (
    <>
      <TableSearch
        label="Search evidence"
        placeholder="Search source, URL or id"
        value={text}
        onChange={setText}
      />
      <FilterChipRow label="Evidence filters">
        {strength === null ? null : (
          <FilterChip
            facet="Strength"
            value={strength}
            onRemove={() => {
              setStrength(null);
            }}
          />
        )}
        {source === null ? null : (
          <FilterChip
            facet="Source"
            value={source}
            onRemove={() => {
              setSource(null);
            }}
          />
        )}
        <AddFilterChip
          onClick={() => {
            setAdding((now) => !now);
          }}
        />
        {adding ? (
          // The facets open in place, beside "+ Filter": each a labelled native select.
          <div
            role="group"
            aria-label="Add a filter"
            onKeyDown={closeOnEscape}
            className="flex flex-wrap items-center gap-x-2 gap-y-3"
          >
            <label className="inline-flex min-h-target items-center gap-1.75 text-small-strong text-ink-secondary">
              Strength
              <select
                value={strength ?? ""}
                onChange={(event) => {
                  const value = event.target.value;
                  setStrength(value === "" ? null : (value as Strength));
                }}
                className="h-control-sm rounded-md border border-border-input bg-surface-sunken px-2.75 text-meta text-ink-primary"
              >
                <option value="">Any</option>
                {CLAIM_STRENGTH_LABELS.map((label) => (
                  <option key={label} value={label}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="inline-flex min-h-target items-center gap-1.75 text-small-strong text-ink-secondary">
              Source
              <select
                value={source ?? ""}
                onChange={(event) => {
                  const value = event.target.value;
                  setSource(value === "" ? null : value);
                }}
                className="h-control-sm rounded-md border border-border-input bg-surface-sunken px-2.75 text-meta text-ink-primary"
              >
                <option value="">Any</option>
                {sources.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}
      </FilterChipRow>
    </>
  );

  return (
    <div className="flex flex-col gap-4">
      {data.hasMore ? (
        <CutListNotice shown={data.items.length} total={data.total} noun="evidence records" />
      ) : null}
      <Grid
        label="Evidence"
        columns={COLUMNS}
        data={rows}
        rowKey={(row) => row.evidenceId}
        initialSort={[{ id: "collectedAt", desc: true }]}
        density="compact"
        columnStyle={STYLE}
        activeRowId={current?.kind === "evidence" ? current.id : undefined}
        toolbar={toolbar}
        empty={{
          kind: "empty",
          title: "No record matches",
          body: "No evidence shown matches these filters.",
          action: (
            <Button variant="secondary" size="sm" onClick={clear}>
              Clear filters
            </Button>
          ),
        }}
        pin={{
          header: "Pin to a case",
          render: (row) => (
            <PinButton
              target={{ type: "evidence", id: row.evidenceId }}
              what={`evidence from ${sourceOf(row)}`}
              pinned={pinState({ type: "evidence", id: row.evidenceId })}
            />
          ),
        }}
        footer={{
          start: `${
            filtered
              ? `${plural(rows.length, "record")} match, of ${String(data.items.length)} shown`
              : `${plural(data.items.length, "record")} shown`
          }${data.hasMore ? `, of ${String(data.total)}` : ""}`,
          end: `${plural(data.withoutObservedAt, "record")} with no observed time; ${plural(
            data.withoutCollectedAt,
            "record",
          )} with no collection time. Evidence is append-only.`,
        }}
      />
    </div>
  );
}

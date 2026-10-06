import { ClaimStrength, CLAIM_STRENGTH_LABELS, Unmeasured } from "@repo/ui";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { MaybeInstant, MISSING_TIME, plural } from "../components/Values.tsx";
import { Grid, gridColumns } from "./Grid.tsx";
import { PinButton } from "./Pin.tsx";
import { ProvenanceLink } from "./Provenance.tsx";
import {
  timelineQuery,
  type Scope,
  type Strength,
  type Timeline,
  type TimelineEvent,
} from "./queries.ts";
import { CutListNotice, Loaded, TableSkeleton } from "./states.tsx";

const NOT_REGISTERED =
  "This collector is not in the platform registry, so it has no label. Its id is shown instead.";

const sourceOf = (row: TimelineEvent) => row.sourceLabel ?? row.collectorId;

const column = gridColumns<TimelineEvent>();

/** Columns: what a reader compares (§9: a grid, not cards). Null times sort last. */
const COLUMNS = column.columns([
  column.accessor(sourceOf, {
    id: "source",
    header: "Source",
    sortFn: "text",
    cell: (info) => {
      const row = info.row.original;
      return (
        <span className="flex flex-col">
          <ProvenanceLink
            target={{ kind: "evidence", id: row.evidenceId }}
            label={`Provenance of evidence from ${sourceOf(row)}`}
          >
            {row.sourceLabel ?? <span className="font-mono">{row.collectorId}</span>}
          </ProvenanceLink>
          {row.sourceLabel === null ? <Unmeasured reason={NOT_REGISTERED} /> : null}
        </span>
      );
    },
  }),
  column.accessor("strength", {
    header: "Strength",
    sortFn: (a, b) =>
      CLAIM_STRENGTH_LABELS.indexOf(a.original.strength) -
      CLAIM_STRENGTH_LABELS.indexOf(b.original.strength),
    cell: (info) => <ClaimStrength strength={info.getValue()} />,
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
    cell: (info) => <span className="font-mono text-mono-caption">{String(info.getValue())}</span>,
  }),
  column.accessor((row) => row.sourceUrl ?? undefined, {
    id: "sourceUrl",
    header: "Source URL",
    enableSorting: false,
    cell: (info) => {
      const url = info.row.original.sourceUrl;
      return url === null ? (
        <Unmeasured reason="No source URL was recorded for this evidence." />
      ) : (
        <span className="font-mono text-mono-caption break-all text-ink-secondary">{url}</span>
      );
    },
  }),
  column.display({
    id: "pin",
    header: "Pin",
    cell: (info) => (
      <PinButton
        target={{ type: "evidence", id: info.row.original.evidenceId }}
        what={`evidence from ${sourceOf(info.row.original)}`}
      />
    ),
  }),
]);

/**
 * The Evidence tab (docs/design/mockups/Evidence.dc.html): every evidence
 * record of the run or case, from the timeline read, which is the API's only
 * evidence list. At most 500 come back; a larger set says so and how many.
 */
export function EvidenceTab({ scope }: { readonly scope: Scope }) {
  const timeline = useQuery(timelineQuery(scope, "collectedAt"));
  return (
    <Loaded query={timeline} loading={<TableSkeleton label="Reading evidence" />}>
      {(data) => <EvidenceGrid data={data} scope={scope} />}
    </Loaded>
  );
}

function EvidenceGrid({ data, scope }: { readonly data: Timeline; readonly scope: Scope }) {
  const [text, setText] = useState("");
  const [strength, setStrength] = useState<Strength | "">("");
  const [source, setSource] = useState("");
  const sources = useMemo(
    () => [...new Set(data.items.map(sourceOf))].sort((a, b) => a.localeCompare(b)),
    [data.items],
  );
  const rows = useMemo(() => {
    const needle = text.trim().toLowerCase();
    return data.items.filter(
      (row) =>
        (strength === "" || row.strength === strength) &&
        (source === "" || sourceOf(row) === source) &&
        (needle === "" ||
          [row.sourceLabel, row.collectorId, row.sourceUrl, row.evidenceId].some(
            (value) => value?.toLowerCase().includes(needle) === true,
          )),
    );
  }, [data.items, text, strength, source]);

  if (data.total === 0) {
    return (
      <div className="rounded-lg border border-border-default bg-surface-raised p-5 text-body text-ink-secondary">
        {scope.kind === "run"
          ? "This run recorded no evidence. The run view lists what each source did and why."
          : "Nothing pinned to this case brings evidence with it yet. Pin evidence, a claim, an entity or a relationship from a run's results."}
      </div>
    );
  }

  const filtered = rows.length !== data.items.length;
  return (
    <div className="flex flex-col gap-4">
      {data.hasMore ? (
        <CutListNotice shown={data.items.length} total={data.total} noun="evidence records" />
      ) : null}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-small text-ink-secondary">
          Search source, URL or id
          <input
            type="search"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
            }}
            className="min-h-target rounded-md border border-border-strong bg-surface-sunken px-3 text-body text-ink-primary"
          />
        </label>
        <label className="flex flex-col gap-1 text-small text-ink-secondary">
          Strength
          <select
            value={strength}
            onChange={(event) => {
              setStrength(event.target.value as Strength | "");
            }}
            className="min-h-target rounded-md border border-border-strong bg-surface-sunken px-3 text-body text-ink-primary"
          >
            <option value="">All strengths</option>
            {CLAIM_STRENGTH_LABELS.map((label) => (
              <option key={label} value={label}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-small text-ink-secondary">
          Source
          <select
            value={source}
            onChange={(event) => {
              setSource(event.target.value);
            }}
            className="min-h-target rounded-md border border-border-strong bg-surface-sunken px-3 text-body text-ink-primary"
          >
            <option value="">All sources</option>
            {sources.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Grid
        label="Evidence"
        columns={COLUMNS}
        data={rows}
        rowKey={(row) => row.evidenceId}
        initialSort={[{ id: "collectedAt", desc: true }]}
        footer={
          <>
            <span>
              {filtered
                ? `${plural(rows.length, "record")} match, of ${String(data.items.length)} shown`
                : `${plural(data.items.length, "record")} shown`}
              {data.hasMore ? `, of ${String(data.total)}` : ""}
            </span>
            <span className="ml-auto">
              {plural(data.withoutObservedAt, "record")} with no observed time;{" "}
              {plural(data.withoutCollectedAt, "record")} with no collection time. Evidence is
              append-only.
            </span>
          </>
        }
      />
    </div>
  );
}

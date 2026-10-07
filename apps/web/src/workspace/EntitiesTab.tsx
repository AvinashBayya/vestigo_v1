import {
  Button,
  Card,
  CLAIM_STRENGTH_LABELS,
  DataTable,
  ENTITY_CLASS_LABEL,
  ENTITY_CLASSES,
  EntityClassName,
  LoadingState,
  NotBuilt,
  Skeleton,
  TableSearch,
  type ClaimStrengthLabel,
  type DataTableColumn,
  type DataTableRow,
  type Density,
  type EntityClass,
  type SortDirection,
} from "@repo/ui";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { Instant, plural, StrengthList } from "../components/Values.tsx";
import { EntityPanel } from "./EntityPanel.tsx";
import { ProvenanceInspector } from "./Provenance.tsx";
import { PinButton } from "./Pin.tsx";
import { entitiesQuery, type EntityList, type EntityRow, type Scope } from "./queries.ts";
import { CutListNotice, Loaded, NOT_BUILT_BODY } from "./states.tsx";
import { WorkspaceInspector } from "./Workspace.tsx";

/** Entity classes whose names are literal identifiers, set in mono (§4). */
const MONO_CLASSES: ReadonlySet<EntityClass> = new Set<EntityClass>([
  "DOMAIN",
  "IP_ADDRESS",
  "EMAIL_ADDRESS",
  "URL",
  "PHONE_NUMBER",
  "USERNAME",
]);

const COLUMNS: readonly DataTableColumn[] = [
  { id: "displayName", header: "Entity", sortable: true, kind: "primary" },
  { id: "kind", header: "Type", sortable: true },
  { id: "strengths", header: "Strength" },
  { id: "evidenceCount", header: "Evidence", sortable: true, align: "end", kind: "mono" },
  { id: "claimCount", header: "Claims", sortable: true, align: "end", kind: "mono" },
  {
    id: "relationshipCount",
    header: "Relationships",
    sortable: true,
    align: "end",
    kind: "mono",
  },
  { id: "createdAt", header: "Recorded", sortable: true, kind: "mono-muted" },
];

type SortColumn =
  "displayName" | "kind" | "evidenceCount" | "claimCount" | "relationshipCount" | "createdAt";

const compare: Readonly<Record<SortColumn, (a: EntityRow, b: EntityRow) => number>> = {
  displayName: (a, b) => a.displayName.localeCompare(b.displayName),
  kind: (a, b) => ENTITY_CLASS_LABEL[a.kind].localeCompare(ENTITY_CLASS_LABEL[b.kind]),
  evidenceCount: (a, b) => a.evidenceCount - b.evidenceCount,
  claimCount: (a, b) => a.claimCount - b.claimCount,
  relationshipCount: (a, b) => a.relationshipCount - b.relationshipCount,
  createdAt: (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
};

const isSortColumn = (id: string): id is SortColumn => id in compare;

const SELECT =
  "h-control-sm cursor-pointer rounded-md border border-border-input bg-surface-raised px-2.5 text-small text-ink-secondary";

/**
 * The Entities tab (docs/design/mockups/Entities.dc.html): every entity in
 * scope with its class in words, every strength and measured counts, and the
 * docked inspector for the one opened. The density is the header's toggle.
 */
export function EntitiesTab({
  scope,
  density,
}: {
  readonly scope: Scope;
  readonly density: Density;
}) {
  const entities = useQuery(entitiesQuery(scope));
  return (
    <div className="flex flex-col gap-5 px-7 py-5">
      <Loaded
        query={entities}
        loading={
          <LoadingState what="Reading entities">
            <Skeleton className="h-target" />
            <Skeleton className="h-target" />
            <Skeleton className="h-target" />
          </LoadingState>
        }
      >
        {(data) => <EntityTable data={data} scope={scope} density={density} />}
      </Loaded>
    </div>
  );
}

function EntityTable({
  data,
  scope,
  density,
}: {
  readonly data: EntityList;
  readonly scope: Scope;
  readonly density: Density;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const [text, setText] = useState("");
  const [kind, setKind] = useState<EntityClass | "">("");
  const [strength, setStrength] = useState<ClaimStrengthLabel | "">("");
  const [sort, setSort] = useState<{ column: SortColumn; direction: SortDirection }>({
    column: "claimCount",
    direction: "descending",
  });

  const present = useMemo(
    () =>
      ENTITY_CLASSES.filter((entityClass) => data.items.some((row) => row.kind === entityClass)),
    [data.items],
  );
  const shown = useMemo(() => {
    const needle = text.trim().toLowerCase();
    const filtered = data.items.filter(
      (row) =>
        (kind === "" || row.kind === kind) &&
        (strength === "" || row.strengths.includes(strength)) &&
        (needle === "" ||
          row.displayName.toLowerCase().includes(needle) ||
          row.identifier?.toLowerCase().includes(needle) === true),
    );
    const order = compare[sort.column];
    const sign = sort.direction === "ascending" ? 1 : -1;
    return filtered.toSorted((a, b) => sign * order(a, b));
  }, [data.items, text, kind, strength, sort]);
  const byId = useMemo(() => new Map(data.items.map((row) => [row.id, row])), [data.items]);

  const open = (row: EntityRow, button: HTMLButtonElement) => {
    trigger.current = button;
    setSelected(row.id);
  };
  const close = () => {
    setSelected(null);
    trigger.current?.focus();
  };

  const rows: DataTableRow[] = shown.map((row) => ({
    id: row.id,
    cells: {
      displayName: (
        <span className="flex flex-col">
          <button
            type="button"
            className={
              MONO_CLASSES.has(row.kind)
                ? "min-h-target cursor-pointer text-left font-mono text-mono-meta break-all text-ink-primary hover:underline"
                : "min-h-target cursor-pointer text-left break-words text-ink-primary hover:underline"
            }
            onClick={(event) => {
              open(row, event.currentTarget);
            }}
          >
            {row.displayName}
          </button>
          {row.mergedIntoEntityId === null ? null : (
            <span className="text-caption text-ink-muted">merged into another entity</span>
          )}
        </span>
      ),
      kind: <EntityClassName entityClass={row.kind} />,
      strengths: <StrengthList strengths={row.strengths} />,
      evidenceCount: String(row.evidenceCount),
      claimCount: String(row.claimCount),
      relationshipCount: String(row.relationshipCount),
      createdAt: <Instant iso={row.createdAt} />,
    },
  }));

  const filtering = text !== "" || kind !== "" || strength !== "";
  const clear = () => {
    setText("");
    setKind("");
    setStrength("");
  };

  return (
    <>
      {data.hasMore ? (
        <CutListNotice shown={data.items.length} total={null} noun="entities" />
      ) : null}
      <div className="flex flex-col gap-5 xl:flex-row xl:items-start">
        <DataTable
          caption="Entities"
          className="min-w-0 grow"
          columns={COLUMNS}
          rows={rows}
          density={density}
          activeRowId={selected ?? undefined}
          sort={sort}
          onSortChange={(column) => {
            if (!isSortColumn(column)) return;
            setSort((current) =>
              current.column === column
                ? {
                    column,
                    direction: current.direction === "ascending" ? "descending" : "ascending",
                  }
                : { column, direction: "descending" },
            );
          }}
          pins={{
            header: "Pin",
            render: (tableRow) => {
              const row = byId.get(tableRow.id);
              return row === undefined ? null : (
                <PinButton target={{ type: "entity", id: row.id }} what={row.displayName} />
              );
            },
          }}
          empty={
            data.items.length === 0
              ? scope.kind === "run"
                ? {
                    kind: "empty",
                    title: "No entities",
                    body: "This run recorded no entities: nothing it collected was about an identifiable thing.",
                  }
                : {
                    kind: "empty",
                    title: "No entities",
                    body: "Nothing pinned to this case names an entity yet.",
                  }
              : {
                  kind: "empty",
                  title: "No entity matches these filters",
                  body: `None of the ${String(data.items.length)} entities shown matches the filter text, type and strength chosen.`,
                  action: (
                    <Button variant="secondary" size="sm" onClick={clear}>
                      Clear filters
                    </Button>
                  ),
                }
          }
          toolbar={
            data.items.length === 0 ? undefined : (
              <>
                <TableSearch
                  label="Filter entities"
                  placeholder="Filter entities"
                  value={text}
                  onChange={setText}
                />
                <label className="inline-flex min-h-target items-center">
                  <span className="sr-only">Type</span>
                  <select
                    value={kind}
                    onChange={(event) => {
                      setKind(event.target.value as EntityClass | "");
                    }}
                    className={SELECT}
                  >
                    <option value="">Type: all</option>
                    {present.map((entityClass) => (
                      <option key={entityClass} value={entityClass}>
                        Type: {ENTITY_CLASS_LABEL[entityClass]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="inline-flex min-h-target items-center">
                  <span className="sr-only">Strength</span>
                  <select
                    value={strength}
                    onChange={(event) => {
                      setStrength(event.target.value as ClaimStrengthLabel | "");
                    }}
                    className={SELECT}
                  >
                    <option value="">Strength: all</option>
                    {CLAIM_STRENGTH_LABELS.map((label) => (
                      <option key={label} value={label}>
                        Strength: {label}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )
          }
          footer={
            data.items.length === 0
              ? undefined
              : {
                  start: (
                    <>
                      {filtering
                        ? `${String(shown.length)} match, of ${plural(data.items.length, "entity", "entities")} shown`
                        : `${plural(data.items.length, "entity", "entities")} shown`}
                      . Counts cover everything recorded about each entity, not only this{" "}
                      {scope.kind === "run" ? "run" : "case"}. Sources are not counted: the entity
                      list gives evidence and claim counts, not how many distinct sources they came
                      from.
                    </>
                  ),
                }
          }
        />
        {selected === null ? (
          <Card title="Merge candidates" className="w-full shrink-0 self-start xl:w-side-rail">
            <NotBuilt
              title="Entities that may be the same thing"
              needs="It needs the merge review screen. The API lists entities that share a name and records merges with their reason, but reviewing and merging them here is not built yet."
              className={NOT_BUILT_BODY}
            />
          </Card>
        ) : null}
      </div>
      {/* Provenance opened from the entity takes the same column, as on the Graph tab. */}
      <ProvenanceInspector>
        {(dock) => {
          const body =
            dock ??
            (selected === null ? null : (
              <EntityPanel key={selected} id={selected} onClose={close} />
            ));
          return body === null ? null : <WorkspaceInspector>{body}</WorkspaceInspector>;
        }}
      </ProvenanceInspector>
    </>
  );
}

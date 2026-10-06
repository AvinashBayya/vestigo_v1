import {
  ClaimStrength,
  ENTITY_CLASS_LABEL,
  ENTITY_CLASSES,
  EntityClassName,
  type EntityClass,
} from "@repo/ui";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Instant, plural } from "../components/Values.tsx";
import { EntityPanel } from "./EntityPanel.tsx";
import { Grid, gridColumns } from "./Grid.tsx";
import { PinButton } from "./Pin.tsx";
import { entitiesQuery, type EntityList, type EntityRow, type Scope } from "./queries.ts";
import { CutListNotice, Loaded, TableSkeleton } from "./states.tsx";

const column = gridColumns<EntityRow>();

const count = (value: number) => (
  <span className="font-mono text-mono-caption">{String(value)}</span>
);

function columnsFor(select: (id: string) => void) {
  return column.columns([
    column.accessor("displayName", {
      header: "Entity",
      sortFn: "alphanumeric",
      cell: (info) => {
        const row = info.row.original;
        return (
          <span className="flex flex-col">
            <button
              type="button"
              className="min-h-target cursor-pointer text-left text-body-strong break-all underline decoration-border-strong underline-offset-4 hover:bg-surface-hover"
              onClick={() => {
                select(row.id);
              }}
            >
              {row.displayName}
            </button>
            {row.mergedIntoEntityId === null ? null : (
              <span className="text-caption text-ink-muted">merged into another entity</span>
            )}
          </span>
        );
      },
    }),
    column.accessor((row) => ENTITY_CLASS_LABEL[row.kind], {
      id: "kind",
      header: "Class",
      sortFn: "text",
      cell: (info) => <EntityClassName entityClass={info.row.original.kind} />,
    }),
    column.display({
      id: "strengths",
      header: "Strength",
      cell: (info) => (
        <span className="flex flex-wrap gap-1">
          {info.row.original.strengths.map((strength) => (
            <ClaimStrength key={strength} strength={strength} />
          ))}
        </span>
      ),
    }),
    column.accessor("claimCount", {
      header: "Claims",
      sortFn: "basic",
      cell: (info) => count(info.getValue()),
    }),
    column.accessor("evidenceCount", {
      header: "Evidence",
      sortFn: "basic",
      cell: (info) => count(info.getValue()),
    }),
    column.accessor("relationshipCount", {
      header: "Relationships",
      sortFn: "basic",
      cell: (info) => count(info.getValue()),
    }),
    column.accessor("createdAt", {
      header: "Recorded",
      sortFn: "basic",
      cell: (info) => <Instant iso={info.getValue()} />,
    }),
    column.display({
      id: "pin",
      header: "Pin",
      cell: (info) => (
        <PinButton
          target={{ type: "entity", id: info.row.original.id }}
          what={info.row.original.displayName}
        />
      ),
    }),
  ]);
}

/** The Entities tab (docs/design/mockups/Entities.dc.html): every entity in scope, with measured counts. */
export function EntitiesTab({ scope }: { readonly scope: Scope }) {
  const entities = useQuery(entitiesQuery(scope));
  return (
    <Loaded query={entities} loading={<TableSkeleton label="Reading entities" />}>
      {(data) => <EntityGrid data={data} scope={scope} />}
    </Loaded>
  );
}

function EntityGrid({ data, scope }: { readonly data: EntityList; readonly scope: Scope }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [kind, setKind] = useState<EntityClass | "">("");
  const columns = useMemo(() => columnsFor(setSelected), []);
  const present = useMemo(
    () =>
      ENTITY_CLASSES.filter((entityClass) => data.items.some((row) => row.kind === entityClass)),
    [data.items],
  );
  const rows = useMemo(() => {
    const needle = text.trim().toLowerCase();
    return data.items.filter(
      (row) =>
        (kind === "" || row.kind === kind) &&
        (needle === "" ||
          row.displayName.toLowerCase().includes(needle) ||
          row.identifier?.toLowerCase().includes(needle) === true),
    );
  }, [data.items, text, kind]);

  if (data.items.length === 0) {
    return (
      <div className="rounded-lg border border-border-default bg-surface-raised p-5 text-body text-ink-secondary">
        {scope.kind === "run"
          ? "This run recorded no entities: nothing it collected was about an identifiable thing."
          : "Nothing pinned to this case names an entity yet."}
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-12">
      <div
        className={
          selected === null
            ? "flex flex-col gap-4 lg:col-span-12"
            : "flex flex-col gap-4 lg:col-span-7"
        }
      >
        {data.hasMore ? (
          <CutListNotice shown={data.items.length} total={null} noun="entities" />
        ) : null}
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-small text-ink-secondary">
            Filter entities
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
            Class
            <select
              value={kind}
              onChange={(event) => {
                setKind(event.target.value as EntityClass | "");
              }}
              className="min-h-target rounded-md border border-border-strong bg-surface-sunken px-3 text-body text-ink-primary"
            >
              <option value="">All classes</option>
              {present.map((entityClass) => (
                <option key={entityClass} value={entityClass}>
                  {ENTITY_CLASS_LABEL[entityClass]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <Grid
          label="Entities"
          columns={columns}
          data={rows}
          rowKey={(row) => row.id}
          initialSort={[{ id: "claimCount", desc: true }]}
          footer={
            <span>
              {rows.length === data.items.length
                ? `${plural(rows.length, "entity", "entities")} shown`
                : `${plural(rows.length, "entity", "entities")} match, of ${String(data.items.length)} shown`}
              . Counts cover everything recorded about each entity, not only this{" "}
              {scope.kind === "run" ? "run" : "case"}.
            </span>
          }
        />
      </div>
      {selected === null ? null : (
        <div className="lg:col-span-5">
          <EntityPanel
            key={selected}
            id={selected}
            onClose={() => {
              setSelected(null);
            }}
          />
        </div>
      )}
    </div>
  );
}

import type { ReactNode } from "react";
import { cn } from "./cn.ts";
import { ToolbarInput } from "./field.tsx";
import { PinButton } from "./pin-button.tsx";
import { Skeleton } from "./panel.tsx";
import { EmptyState, NotBuilt } from "./states.tsx";

export type SortDirection = "ascending" | "descending";

export interface DataTableColumn {
  readonly id: string;
  readonly header: string;
  /** Sortable headers are buttons with `aria-sort` (§9). */
  readonly sortable?: boolean | undefined;
  readonly align?: "start" | "end" | undefined;
  /** How the cell's text is set: plain text, or mono for anything copied or compared (§4). */
  readonly kind?: "text" | "primary" | "mono" | "mono-muted" | undefined;
}

export interface DataTableRow {
  readonly id: string;
  readonly cells: Readonly<Record<string, ReactNode>>;
}

/** What shows when there are no rows: a designed state, never a blank table (§8). */
export type DataTableEmpty =
  | {
      readonly kind: "empty";
      readonly title: string;
      readonly body: string;
      readonly action?: ReactNode;
    }
  | { readonly kind: "not-built"; readonly title: string; readonly needs: string };

const CELL_TEXT: Readonly<Record<NonNullable<DataTableColumn["kind"]>, string>> = {
  text: "text-ink-secondary",
  primary: "text-ink-primary",
  mono: "font-mono text-mono-meta text-ink-secondary",
  "mono-muted": "font-mono text-mono-meta text-ink-muted",
};

const DENSITY = {
  /** The default in the Evidence grid. Never below `target-min`: rows hold targets (§5). */
  compact: { row: "h-row-compact", cell: "px-2.5 text-meta", strong: "text-meta-strong" },
  comfortable: { row: "h-row-comfortable", cell: "px-3 text-small", strong: "text-small-strong" },
} as const;

/**
 * The per-row pin (§9: on every result surface). Either the library toggle,
 * when the pinned state is known, or the caller's own trigger (a case-picker
 * popover, say) rendered per row. `header` is the column's name for assistive
 * technology.
 */
export type DataTablePins =
  | {
      readonly pinned: ReadonlySet<string>;
      readonly onToggle: (id: string) => void;
      readonly header?: string | undefined;
    }
  | {
      readonly render: (row: DataTableRow, index: number) => ReactNode;
      readonly header?: string | undefined;
    };

function Chevron({ direction }: { readonly direction: SortDirection | null }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn(
        "size-icon-sm shrink-0",
        direction === null ? "text-ink-muted" : "text-ink-secondary",
        direction === "ascending" && "rotate-180",
      )}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/**
 * The Evidence grid (§9 data table), presentational: the caller owns the
 * rows, the sort, the selection and the pins, and this draws them. Header
 * `th` (the 11-pixel minimum) in `ink-muted`, rows at least `target-min` because they hold the
 * checkbox and pin targets, the selected row tinted AND `aria-selected` (§7).
 * With no rows it shows its empty or Not built state, never a bare header.
 */
export function DataTable({
  caption,
  columns,
  rows,
  empty,
  loading,
  density = "compact",
  sort,
  onSortChange,
  selection,
  pins,
  activeRowId,
  toolbar,
  footer,
  className,
}: {
  /** What the table is, for assistive technology. */
  readonly caption: string;
  readonly columns: readonly DataTableColumn[];
  readonly rows: readonly DataTableRow[];
  readonly empty: DataTableEmpty;
  /** While rows are read: what is being read. Skeleton rows in the table's shape stand in. */
  readonly loading?: string | undefined;
  readonly density?: keyof typeof DENSITY | undefined;
  readonly sort?: { readonly column: string; readonly direction: SortDirection } | undefined;
  readonly onSortChange?: ((column: string) => void) | undefined;
  readonly selection?:
    | {
        readonly selected: ReadonlySet<string>;
        readonly onToggle: (id: string) => void;
        readonly onToggleAll: () => void;
      }
    | undefined;
  readonly pins?: DataTablePins | undefined;
  /**
   * The row open elsewhere (its provenance in the drawer): `aria-current` and
   * a weight change as well as the tint, never the tint alone (§7).
   */
  readonly activeRowId?: string | undefined;
  readonly toolbar?: ReactNode;
  readonly footer?: { readonly start: ReactNode; readonly end?: ReactNode } | undefined;
  readonly className?: string | undefined;
}) {
  const sizes = DENSITY[density];
  const allSelected =
    selection !== undefined &&
    rows.length > 0 &&
    rows.every((row) => selection.selected.has(row.id));

  let body: ReactNode;
  if (loading !== undefined) {
    body = (
      <div className="flex flex-col gap-2 p-3.5" aria-busy="true">
        <p role="status" className="text-caption text-ink-muted">
          {loading}
        </p>
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className={sizes.row} />
        ))}
      </div>
    );
  } else if (rows.length === 0) {
    body = (
      <div className="p-3.5">
        {empty.kind === "not-built" ? (
          <NotBuilt
            title={empty.title}
            needs={empty.needs}
            className="rounded-inner border-border-subtle"
          />
        ) : (
          <EmptyState
            title={empty.title}
            action={empty.action}
            className="rounded-inner border-border-subtle"
          >
            {empty.body}
          </EmptyState>
        )}
      </div>
    );
  } else {
    body = (
      // Positioned, so a header's visually hidden label (absolutely placed) stays inside
      // the table's own scrolling instead of widening the page at phone width.
      <div className="relative overflow-x-auto">
        <table className="w-full border-collapse">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="h-row-compact bg-surface-sunken">
              {selection !== undefined && (
                <th scope="col" className="w-target border-b border-border-subtle px-2.5 py-2">
                  <label className="hit-area inline-flex">
                    <input
                      type="checkbox"
                      aria-label="Select all rows"
                      checked={allSelected}
                      onChange={selection.onToggleAll}
                      className="cursor-pointer accent-accent"
                    />
                  </label>
                </th>
              )}
              {columns.map((column) => {
                const active = sort?.column === column.id ? sort.direction : null;
                // aria-sort only where a control can change the sort.
                const sortable = column.sortable === true && onSortChange !== undefined;
                return (
                  <th
                    key={column.id}
                    scope="col"
                    aria-sort={sortable ? (active ?? "none") : undefined}
                    className={cn(
                      "border-b border-border-subtle px-2.5 py-2 text-th whitespace-nowrap text-ink-muted uppercase",
                      column.align === "end" ? "text-right" : "text-left",
                    )}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        onClick={() => {
                          onSortChange(column.id);
                        }}
                        className="hit-area inline-flex cursor-pointer items-center gap-1 uppercase"
                      >
                        {column.header}
                        <Chevron direction={active} />
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
              {pins !== undefined && (
                <th scope="col" className="w-target border-b border-border-subtle px-2.5 py-2">
                  <span className="sr-only">{pins.header === undefined ? "Pin" : pins.header}</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const selected = selection?.selected.has(row.id) === true;
              const active = activeRowId === row.id;
              return (
                <tr
                  key={row.id}
                  aria-selected={selection === undefined ? undefined : selected}
                  aria-current={active ? "true" : undefined}
                  className={cn(
                    sizes.row,
                    "border-b border-border-subtle last:border-b-0",
                    (selected || active) && "bg-surface-hover",
                  )}
                >
                  {selection !== undefined && (
                    <td className="px-2.5">
                      <label className="hit-area inline-flex">
                        <input
                          type="checkbox"
                          aria-label={`Select row ${String(index + 1)}`}
                          checked={selected}
                          onChange={() => {
                            selection.onToggle(row.id);
                          }}
                          className="cursor-pointer accent-accent"
                        />
                      </label>
                    </td>
                  )}
                  {columns.map((column) => (
                    <td
                      key={column.id}
                      className={cn(
                        sizes.cell,
                        CELL_TEXT[column.kind ?? "text"],
                        active && !(column.kind ?? "text").startsWith("mono") && sizes.strong,
                        column.align === "end" && "text-right",
                      )}
                    >
                      {row.cells[column.id]}
                    </td>
                  ))}
                  {pins !== undefined && (
                    <td className="px-2.5">
                      {"render" in pins ? (
                        pins.render(row, index)
                      ) : (
                        <PinButton
                          pinned={pins.pinned.has(row.id)}
                          onToggle={() => {
                            pins.onToggle(row.id);
                          }}
                          label={`Pin row ${String(index + 1)} to case`}
                        />
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <section
      aria-label={caption}
      className={cn(
        "flex flex-col rounded-lg border border-border-default bg-surface-raised",
        className,
      )}
    >
      {toolbar !== undefined && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-3 border-b border-border-subtle px-3.5 py-2.5">
          {toolbar}
        </div>
      )}
      {body}
      {footer !== undefined && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle px-3.5 py-2.5 text-caption text-ink-muted">
          <span>{footer.start}</span>
          {footer.end !== undefined && <span>{footer.end}</span>}
        </div>
      )}
    </section>
  );
}

/**
 * The grid's search input (§9: `control-sm`, `surface-sunken`, a visually
 * hidden label): a ToolbarInput, inside a label `target-min` tall.
 */
export function TableSearch({
  label,
  placeholder,
  value,
  onChange,
}: {
  readonly label: string;
  readonly placeholder: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  return <ToolbarInput label={label} placeholder={placeholder} value={value} onChange={onChange} />;
}

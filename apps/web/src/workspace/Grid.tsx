import { cn } from "@repo/ui";
import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_text,
  tableFeatures,
  useTable,
  type RowData,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useState, type ReactNode } from "react";

/** Sorting only: filters are applied to the rows before they reach the grid. */
export const gridFeatures = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, basic: sortFn_basic, text: sortFn_text },
});

export const gridColumns = <TData extends RowData>() =>
  createColumnHelper<typeof gridFeatures, TData>();

type Columns<TData extends RowData> = Parameters<
  typeof useTable<typeof gridFeatures, TData>
>[0]["columns"];

/**
 * The evidence-style grid (§9: a sortable, filterable grid, compact by
 * default). Every header that sorts is a real button, and its order is
 * announced (`aria-sort`). Null values sort last whichever way.
 */
export function Grid<TData extends RowData>({
  label,
  columns,
  data,
  rowKey,
  initialSort,
  footer,
}: {
  /** The table's accessible name. */
  readonly label: string;
  readonly columns: Columns<TData>;
  readonly data: TData[];
  readonly rowKey: (row: TData) => string;
  readonly initialSort?: SortingState;
  readonly footer?: ReactNode;
}) {
  const [sorting, setSorting] = useState<SortingState>(initialSort ?? []);
  const table = useTable({
    features: gridFeatures,
    columns,
    data,
    getRowId: rowKey,
    state: { sorting },
    onSortingChange: setSorting,
  });

  return (
    <div className="overflow-x-auto rounded-lg border border-border-default bg-surface-raised">
      <table aria-label={label} className="w-full border-collapse text-small">
        <thead className="bg-surface-sunken">
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => {
                const sorted = header.column.getIsSorted();
                const canSort = header.column.getCanSort();
                const content = header.isPlaceholder ? null : <table.FlexRender header={header} />;
                return (
                  <th
                    key={header.id}
                    scope="col"
                    aria-sort={
                      sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined
                    }
                    className="border-b border-border-default px-3 py-2 text-left text-eyebrow uppercase text-ink-muted"
                  >
                    {canSort ? (
                      <button
                        type="button"
                        className="inline-flex min-h-target cursor-pointer items-center gap-1 uppercase"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {content}
                        {sorted === "asc" ? (
                          <ArrowUp className="size-4" strokeWidth={1.9} aria-hidden="true" />
                        ) : sorted === "desc" ? (
                          <ArrowDown className="size-4" strokeWidth={1.9} aria-hidden="true" />
                        ) : null}
                      </button>
                    ) : (
                      content
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="border-b border-border-subtle hover:bg-surface-hover">
              {row.getAllCells().map((cell) => (
                <td key={cell.id} className={cn("px-3 py-1 align-middle text-ink-primary")}>
                  <table.FlexRender cell={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {footer === undefined ? null : (
        <div className="flex flex-wrap items-center gap-3 px-3 py-3 text-small text-ink-secondary">
          {footer}
        </div>
      )}
    </div>
  );
}

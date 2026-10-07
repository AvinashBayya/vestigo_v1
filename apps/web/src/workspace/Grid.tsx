import { DataTable, type DataTableColumn, type DataTableEmpty, type DataTableRow } from "@repo/ui";
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
import { isValidElement, useState, type ReactNode } from "react";

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

/** How a column's cells are set (DataTable's `kind` and `align`), by column id. */
export type GridColumnStyle = Readonly<Record<string, Pick<DataTableColumn, "kind" | "align">>>;

type GridFooter = { readonly start: ReactNode; readonly end?: ReactNode } | ReactNode;

const isParts = (
  footer: GridFooter,
): footer is { readonly start: ReactNode; readonly end?: ReactNode } =>
  typeof footer === "object" && footer !== null && !isValidElement(footer) && "start" in footer;

const NO_ROWS: DataTableEmpty = {
  kind: "empty",
  title: "No row matches",
  body: "Nothing shown here matches what is set above.",
};

/**
 * The TanStack-to-DataTable adapter (§9 data table, compact by default): the
 * columns, cells and sorting come from TanStack; the drawing is the library's
 * DataTable. Every header that sorts is a real button, and its order is
 * announced (`aria-sort`). Null values sort last whichever way
 * (`sortUndefined: "last"` on the column).
 */
export function Grid<TData extends RowData>({
  label,
  columns,
  data,
  rowKey,
  initialSort,
  footer,
  empty = NO_ROWS,
  toolbar,
  density,
  activeRowId,
  columnStyle,
  pin,
  className,
}: {
  /** The table's accessible name. */
  readonly label: string;
  readonly columns: Columns<TData>;
  readonly data: TData[];
  readonly rowKey: (row: TData) => string;
  readonly initialSort?: SortingState;
  /** `{ start, end }`, or one node shown at the start. */
  readonly footer?: GridFooter;
  /** What shows when no row is left: a designed state, never a blank table (§8). */
  readonly empty?: DataTableEmpty | undefined;
  readonly toolbar?: ReactNode;
  readonly density?: "compact" | "comfortable" | undefined;
  /** The row open elsewhere (its provenance in the dock). */
  readonly activeRowId?: string | undefined;
  readonly columnStyle?: GridColumnStyle | undefined;
  /** The per-row pin column: its header for assistive technology, and the control per row. */
  readonly pin?:
    { readonly header: string; readonly render: (row: TData) => ReactNode } | undefined;
  readonly className?: string | undefined;
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

  const leaves = table.getAllLeafColumns();
  const tableColumns: DataTableColumn[] = leaves.map((column) => {
    const header = column.columnDef.header;
    return {
      id: column.id,
      header: typeof header === "string" ? header : column.id,
      sortable: column.getCanSort(),
      kind: columnStyle?.[column.id]?.kind,
      align: columnStyle?.[column.id]?.align,
    };
  });

  const modelRows = table.getRowModel().rows;
  const originals = new Map(modelRows.map((row) => [row.id, row.original]));
  const rows: DataTableRow[] = modelRows.map((row) => ({
    id: row.id,
    cells: Object.fromEntries(
      row
        .getAllCells()
        .map((cell) => [cell.column.id, <table.FlexRender key={cell.id} cell={cell} />]),
    ),
  }));

  const first = sorting[0];
  const sort =
    first === undefined
      ? undefined
      : {
          column: first.id,
          direction: first.desc ? ("descending" as const) : ("ascending" as const),
        };

  return (
    <DataTable
      caption={label}
      columns={tableColumns}
      rows={rows}
      empty={empty}
      density={density}
      sort={sort}
      onSortChange={(id) => {
        table.getColumn(id)?.toggleSorting();
      }}
      activeRowId={activeRowId}
      toolbar={toolbar}
      footer={footer === undefined ? undefined : isParts(footer) ? footer : { start: footer }}
      pins={
        pin === undefined
          ? undefined
          : {
              header: pin.header,
              render: (row) => {
                const original = originals.get(row.id);
                return original === undefined ? null : pin.render(original);
              },
            }
      }
      className={className}
    />
  );
}

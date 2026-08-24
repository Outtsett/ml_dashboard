/**
 * DenseTable — TanStack Table v8 wrapper tuned for senior-quant density.
 *
 * Design intent:
 *   - Mono-numeric body cells with tabular-nums (read MetricCell for cells).
 *   - Sticky header with uppercase micro-caps.
 *   - Sortable columns out of the box (click header).
 *   - Zebra rows + persistent row hover highlight.
 *   - Optional row click → drawer/detail (callback).
 *   - Optional row selection state (single-select highlight).
 *   - Optional toolbar slot (filter chips, search) above the table.
 *   - Optional empty state.
 *   - Virtualization-ready: callers can wrap the body via the `bodyContainerRef`
 *     and use react-window externally. For ≤500 rows, default rendering is fine.
 *
 * Strict contract: the column meta carries `align` + `tone` + `width` so cell
 * styling stays generic, and callers don't have to wire alignment into each
 * `cell()` callback themselves.
 */

import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  type ColumnDef,
  type Row,
  type SortingState,
  type Table as TanstackTable,
} from "@tanstack/react-table";
import { useState, type ReactNode, type CSSProperties } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/shared/utils/utils";

/** Tighten the per-column meta we expect. Extends ColumnMeta via TanStack's
 *  module augmentation pattern below. */
export interface DenseTableColumnMeta {
  /** Cell alignment. Numeric columns right-align by default. */
  align?: "left" | "right" | "center";
  /** Optional CSS width — px or %; falls back to auto. */
  width?: string | number;
  /** Tone hint used by themed cells (e.g. MetricCell). Purely informational. */
  tone?: "neutral" | "pos" | "neg" | "warn";
  /** Mono override — true by default for numeric, false for text cells. */
  mono?: boolean;
}

// Module augmentation so column.columnDef.meta is strongly typed.
declare module "@tanstack/react-table" {
  // The signature must match TanStack's source: <TData, TValue>. We don't
  // narrow either parameter — they're forwarded by the upstream generic. The
  // body is intentionally a re-declaration, not extension, to satisfy the
  // no-empty-object-type lint rule.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData, TValue> {
    align?: DenseTableColumnMeta["align"];
    width?: DenseTableColumnMeta["width"];
    tone?: DenseTableColumnMeta["tone"];
    mono?: DenseTableColumnMeta["mono"];
  }
}

interface DenseTableProps<TData> {
  /** Column definitions — uses the standard TanStack `ColumnDef`. */
  columns: ColumnDef<TData, unknown>[];
  /** Row data. */
  data: TData[];
  /** Optional row click callback. */
  onRowClick?: (row: TData, ev: React.MouseEvent) => void;
  /** Get a stable row id from a row object (used for selection + key). */
  getRowId?: (row: TData, index: number) => string;
  /** Currently-selected row id — used to highlight a single active row. */
  selectedRowId?: string | null;
  /** Initial sorting (e.g. `[{ id: "costAdjSharpe", desc: true }]`). */
  defaultSorting?: SortingState;
  /** Optional toolbar slot (search / filter chips). Rendered above the table. */
  toolbar?: ReactNode;
  /** Optional empty-state node — shown when `data.length === 0`. */
  emptyState?: ReactNode;
  /** Disable zebra striping. */
  noZebra?: boolean;
  /** Tighten row padding further. */
  dense?: boolean;
  /** Global text filter (case-insensitive search across visible cells). */
  globalFilter?: string;
  /** Forwarded className for the outer container. */
  className?: string;
  /** Forwarded testid. */
  testId?: string;
  /** Optional render-prop for callers that need access to the table API
   *  (e.g. exposing the underlying TanStack table for pagination). */
  children?: (table: TanstackTable<TData>) => ReactNode;
}

export function DenseTable<TData>({
  columns,
  data,
  onRowClick,
  getRowId,
  selectedRowId,
  defaultSorting = [],
  toolbar,
  emptyState,
  noZebra = false,
  dense = false,
  globalFilter,
  className,
  testId,
  children,
}: DenseTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>(defaultSorting);

  const tableInstance = useReactTable<TData>({
    data,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    getRowId,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const rows = tableInstance.getRowModel().rows;

  const hasRows = rows.length > 0;

  return (
    <div
      data-testid={testId ?? "dense-table"}
      className={cn("flex h-full min-h-0 flex-col overflow-hidden", className)}
    >
      {toolbar && (
        <div className="shrink-0 border-b border-border/50 px-2 py-1.5">
          {toolbar}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-[12px]">
          <thead className="sticky top-0 z-10 bg-card/95 backdrop-blur-sm">
            {tableInstance.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="border-b border-border">
                {headerGroup.headers.map((header) => {
                  const meta = header.column.columnDef.meta as
                    | DenseTableColumnMeta
                    | undefined;
                  const align = meta?.align ?? "left";
                  const canSort = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  const style: CSSProperties = {};
                  if (meta?.width != null) {
                    style.width =
                      typeof meta.width === "number" ? `${meta.width}px` : meta.width;
                  }
                  return (
                    <th
                      key={header.id}
                      style={style}
                      className={cn(
                        "select-none whitespace-nowrap font-semibold uppercase tracking-[0.06em] text-muted-foreground",
                        "text-[10px] leading-tight",
                        dense ? "px-2 py-1" : "px-2.5 py-1.5",
                        align === "right" && "text-right",
                        align === "center" && "text-center",
                        canSort && "cursor-pointer hover:text-foreground",
                      )}
                      onClick={
                        canSort
                          ? header.column.getToggleSortingHandler()
                          : undefined
                      }
                    >
                      <span
                        className={cn(
                          "inline-flex items-center gap-1",
                          align === "right" && "justify-end",
                          align === "center" && "justify-center",
                        )}
                      >
                        {header.isPlaceholder
                          ? null
                          : flexRender(
                              header.column.columnDef.header,
                              header.getContext(),
                            )}
                        {canSort && (
                          <SortIndicator sorted={sorted} />
                        )}
                      </span>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>

          <tbody>
            {hasRows ? (
              rows.map((row, rowIdx) => (
                <Row
                  key={row.id}
                  row={row}
                  rowIdx={rowIdx}
                  noZebra={noZebra}
                  dense={dense}
                  isSelected={selectedRowId != null && row.id === selectedRowId}
                  onRowClick={onRowClick}
                />
              ))
            ) : (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-12 text-center text-xs text-muted-foreground"
                >
                  {emptyState ?? "No rows."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {children?.(tableInstance)}
    </div>
  );
}

function Row<TData>({
  row,
  rowIdx,
  noZebra,
  dense,
  isSelected,
  onRowClick,
}: {
  row: Row<TData>;
  rowIdx: number;
  noZebra: boolean;
  dense: boolean;
  isSelected: boolean;
  onRowClick?: (row: TData, ev: React.MouseEvent) => void;
}) {
  const interactive = !!onRowClick;
  return (
    <tr
      data-row-id={row.id}
      data-selected={isSelected || undefined}
      onClick={
        onRowClick ? (ev) => onRowClick(row.original, ev) : undefined
      }
      className={cn(
        "border-b border-border/40",
        !noZebra && rowIdx % 2 === 1 && "bg-white/[0.015]",
        interactive && "cursor-pointer hover:bg-white/[0.04]",
        isSelected && "bg-primary/10 hover:bg-primary/15",
      )}
    >
      {row.getVisibleCells().map((cell) => {
        const meta = cell.column.columnDef.meta as
          | DenseTableColumnMeta
          | undefined;
        const align = meta?.align ?? "left";
        const mono = meta?.mono ?? align === "right";
        return (
          <td
            key={cell.id}
            className={cn(
              "whitespace-nowrap text-foreground/90",
              dense ? "px-2 py-1" : "px-2.5 py-1.5",
              align === "right" && "text-right",
              align === "center" && "text-center",
              mono && "font-mono tnum tabular-nums",
            )}
          >
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </td>
        );
      })}
    </tr>
  );
}

function SortIndicator({ sorted }: { sorted: false | "asc" | "desc" }) {
  if (sorted === "asc") return <ArrowUp className="h-3 w-3" aria-hidden />;
  if (sorted === "desc") return <ArrowDown className="h-3 w-3" aria-hidden />;
  return <ArrowUpDown className="h-3 w-3 opacity-30" aria-hidden />;
}

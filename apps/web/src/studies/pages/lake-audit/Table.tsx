/**
 * A small sortable, paged table for the audit's lists. Header click sorts
 * (click again to reverse); "Show more" pages 25 rows at a time, as the
 * notebook's tables did. `cell` returns the node shown, `value` the sort key.
 */

import { useState, type ReactNode } from "react";

export interface Column<Row> {
  key: string;
  label: string;
  /** Right-aligned numeric column. */
  numeric?: boolean;
  value: (row: Row) => string | number | null;
  cell?: (row: Row) => ReactNode;
  title?: string;
}

const PAGE = 25;

export function SortableTable<Row>({
  rows, columns, rowKey, initialSort, initialDescending = true, expandable, empty = "No rows.",
}: {
  rows: readonly Row[];
  columns: ReadonlyArray<Column<Row>>;
  rowKey: (row: Row) => string;
  initialSort?: string;
  initialDescending?: boolean;
  /** When set, a row toggles open to show this beneath it. */
  expandable?: (row: Row) => ReactNode;
  empty?: string;
}) {
  const [sortKey, setSortKey] = useState<string | null>(initialSort ?? null);
  const [descending, setDescending] = useState(initialDescending);
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);

  const sorter = columns.find((column) => column.key === sortKey);
  const sorted = sorter
    ? [...rows].sort((a, b) => {
        const left = sorter.value(a);
        const right = sorter.value(b);
        if (left === right) return 0;
        if (left === null) return 1;
        if (right === null) return -1;
        const order = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right));
        return descending ? -order : order;
      })
    : rows;

  if (rows.length === 0) return <p className="py-3 text-xs text-neutral-500">{empty}</p>;

  const visible = sorted.slice(0, shown);
  return (
    <div className="min-w-0">
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-neutral-500">
              {columns.map((column) => (
                <th key={column.key} className={`py-1 pr-3 font-normal ${column.numeric ? "text-right" : "text-left"}`} title={column.title}>
                  <button
                    type="button"
                    className="hover:text-neutral-200"
                    onClick={() => {
                      if (sortKey === column.key) setDescending(!descending);
                      else {
                        setSortKey(column.key);
                        setDescending(column.numeric ?? false);
                      }
                    }}
                  >
                    {column.label}
                    {sortKey === column.key ? (descending ? " ▼" : " ▲") : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const id = rowKey(row);
              const isOpen = open === id;
              return (
                <RowGroup key={id} open={isOpen} colSpan={columns.length} detail={expandable?.(row)} onToggle={expandable ? () => setOpen(isOpen ? null : id) : undefined}>
                  {columns.map((column) => (
                    <td key={column.key} className={`py-1 pr-3 align-top ${column.numeric ? "text-right font-mono tnum" : "text-left"} text-neutral-200`}>
                      {column.cell ? column.cell(row) : (column.value(row) ?? "—")}
                    </td>
                  ))}
                </RowGroup>
              );
            })}
          </tbody>
        </table>
      </div>
      {sorted.length > shown && (
        <button
          type="button"
          onClick={() => setShown(shown + PAGE)}
          className="mt-1 rounded border border-neutral-700 px-2 py-0.5 text-[11px] text-neutral-300 hover:border-neutral-500"
        >
          Show {Math.min(PAGE, sorted.length - shown)} more ({sorted.length - shown} hidden)
        </button>
      )}
    </div>
  );
}

function RowGroup({ children, open, colSpan, detail, onToggle }: { children: ReactNode; open: boolean; colSpan: number; detail: ReactNode; onToggle?: () => void }) {
  return (
    <>
      <tr
        className={`border-t border-neutral-900 ${onToggle ? "cursor-pointer hover:bg-neutral-900/60" : ""}`}
        onClick={onToggle}
        aria-expanded={onToggle ? open : undefined}
      >
        {children}
      </tr>
      {open && detail && (
        <tr className="bg-neutral-900/40">
          <td colSpan={colSpan} className="px-2 py-2">{detail}</td>
        </tr>
      )}
    </>
  );
}

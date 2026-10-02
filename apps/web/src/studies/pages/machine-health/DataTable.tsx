/**
 * A small sortable, paged table. Clicking a header sorts by that column
 * (again to reverse); a column may render a cell itself (a copy button).
 */

import { useState, type ReactNode } from "react";
import { fmt } from "@/studies/kit";

export interface TableColumn<T> {
  key: string;
  header: string;
  /** The value that is sorted on and printed when there is no `render`. */
  value: (row: T) => string | number | null;
  render?: (row: T) => ReactNode;
  align?: "left" | "right";
  decimals?: number;
  className?: string;
}

function compare(a: string | number | null, b: string | number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

export function DataTable<T>({ rows, columns, pageSize = 10, label }: { rows: readonly T[]; columns: ReadonlyArray<TableColumn<T>>; pageSize?: number; label?: string }) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [descending, setDescending] = useState(false);
  const [page, setPage] = useState(0);

  const sortColumn = columns.find((column) => column.key === sortKey);
  const sorted = sortColumn
    ? [...rows].sort((a, b) => (descending ? -1 : 1) * compare(sortColumn.value(a), sortColumn.value(b)))
    : rows;
  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const visible = sorted.slice(safePage * pageSize, (safePage + 1) * pageSize);

  const choose = (key: string) => {
    if (sortKey === key) setDescending(!descending);
    else {
      setSortKey(key);
      setDescending(false);
    }
    setPage(0);
  };

  return (
    <div className="min-w-0 space-y-1">
      {label && <div className="text-[11px] font-medium text-neutral-300">{label}</div>}
      <div className="overflow-x-auto rounded-md border border-neutral-800">
        <table className="w-full text-[11px]">
          <thead className="bg-neutral-900/70 text-neutral-400">
            <tr>
              {columns.map((column) => (
                <th key={column.key} className={`px-2 py-1 font-normal ${column.align === "right" ? "text-right" : "text-left"}`}>
                  <button type="button" onClick={() => choose(column.key)} className="hover:text-neutral-100" aria-label={`Sort by ${column.header}`}>
                    {column.header}
                    {sortKey === column.key ? (descending ? " ▼" : " ▲") : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, index) => (
              <tr key={index} className="border-t border-neutral-900 align-top">
                {columns.map((column) => {
                  const value = column.value(row);
                  return (
                    <td key={column.key} className={`px-2 py-1 ${column.align === "right" ? "text-right font-mono tnum" : ""} text-neutral-200 ${column.className ?? ""}`}>
                      {column.render ? column.render(row) : typeof value === "number" ? fmt(value, column.decimals ?? 0) : (value ?? "")}
                    </td>
                  );
                })}
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-2 py-3 text-center text-neutral-500">No rows.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {pageCount > 1 && (
        <div className="flex items-center justify-between text-[11px] text-neutral-400">
          <span>{sorted.length} rows, page {safePage + 1} of {pageCount}</span>
          <span className="flex gap-1">
            <button type="button" disabled={safePage === 0} onClick={() => setPage(safePage - 1)} className="rounded border border-neutral-700 px-2 py-0.5 disabled:opacity-40">Previous</button>
            <button type="button" disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)} className="rounded border border-neutral-700 px-2 py-0.5 disabled:opacity-40">Next</button>
          </span>
        </div>
      )}
    </div>
  );
}

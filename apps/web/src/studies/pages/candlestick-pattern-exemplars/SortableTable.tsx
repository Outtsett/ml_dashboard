/**
 * A plain table whose headers sort it (click again to reverse), scrolling
 * inside a fixed height so a 61-row table does not push the page down.
 */

import { useState, type ReactNode } from "react";

export interface TableColumn<Row> {
  key: string;
  label: string;
  /** What the cell shows; defaults to the raw value. */
  render?: (row: Row) => ReactNode;
  /** What the column sorts by; defaults to the row's value at `key`. */
  sortValue?: (row: Row) => number | string | null;
  align?: "left" | "right";
  title?: string;
}

function rawValue<Row>(row: Row, key: string): number | string | null {
  const value = (row as Record<string, unknown>)[key];
  return typeof value === "number" || typeof value === "string" ? value : null;
}

export function SortableTable<Row>({
  rows, columns, rowKey, maxHeight = 360, initialSort,
}: {
  rows: readonly Row[];
  columns: ReadonlyArray<TableColumn<Row>>;
  rowKey: (row: Row) => string;
  maxHeight?: number;
  initialSort?: { key: string; descending: boolean };
}) {
  const [sort, setSort] = useState<{ key: string; descending: boolean } | null>(initialSort ?? null);
  const column = sort ? columns.find((candidate) => candidate.key === sort.key) : undefined;
  const ordered = [...rows];
  if (sort && column) {
    const valueOf = column.sortValue ?? ((row: Row) => rawValue(row, column.key));
    ordered.sort((a, b) => {
      const x = valueOf(a);
      const y = valueOf(b);
      if (x === null && y === null) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      const order = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return sort.descending ? -order : order;
    });
  }
  return (
    <div className="overflow-auto rounded-md border border-neutral-800" style={{ maxHeight }}>
      <table className="w-full text-[11px]">
        <thead className="sticky top-0 bg-neutral-900">
          <tr>
            {columns.map((candidate) => {
              const active = sort?.key === candidate.key;
              return (
                <th key={candidate.key} title={candidate.title} className={`whitespace-nowrap px-2 py-1 font-normal text-neutral-400 ${candidate.align === "right" ? "text-right" : "text-left"}`}>
                  <button
                    type="button"
                    className="hover:text-neutral-100"
                    onClick={() => setSort(active ? { key: candidate.key, descending: !sort.descending } : { key: candidate.key, descending: false })}
                  >
                    {candidate.label}
                    {active ? (sort.descending ? " ▼" : " ▲") : ""}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {ordered.map((row) => (
            <tr key={rowKey(row)} className="border-t border-neutral-900 hover:bg-neutral-900/60">
              {columns.map((candidate) => (
                <td key={candidate.key} className={`whitespace-nowrap px-2 py-0.5 font-mono tnum text-neutral-200 ${candidate.align === "right" ? "text-right" : "text-left"}`}>
                  {candidate.render ? candidate.render(row) : String(rawValue(row, candidate.key) ?? "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A compact sortable table for the study's frames: click a header to sort by
 * it (again to reverse). Column headers are full words; cells format
 * themselves so a table shows the same precision the notebook did.
 */

import { useState, type ReactNode } from "react";

export interface Column<Row> {
  key: string;
  label: string;
  /** Rendered cell; defaults to the raw value. */
  cell?: (row: Row) => ReactNode;
  /** Value used for sorting; defaults to row[key]. */
  sortValue?: (row: Row) => number | string | null;
  align?: "left" | "right";
  title?: string;
}

function rawValue<Row>(row: Row, key: string): unknown {
  return (row as Record<string, unknown>)[key];
}

export function DataTable<Row>({
  rows, columns, rowKey, maxHeight = 320, onRowClick, selectedKey, initialSort,
}: {
  rows: readonly Row[];
  columns: ReadonlyArray<Column<Row>>;
  rowKey: (row: Row, index: number) => string;
  maxHeight?: number;
  onRowClick?: (row: Row, index: number) => void;
  selectedKey?: string | null;
  initialSort?: { key: string; descending: boolean };
}) {
  const [sort, setSort] = useState<{ key: string; descending: boolean } | null>(initialSort ?? null);

  const sorted = [...rows];
  if (sort) {
    const column = columns.find((candidate) => candidate.key === sort.key);
    const valueOf = (row: Row) => (column?.sortValue ? column.sortValue(row) : (rawValue(row, sort.key) as number | string | null));
    sorted.sort((a, b) => {
      const x = valueOf(a);
      const y = valueOf(b);
      if (x === y) return 0;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      const order = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return sort.descending ? -order : order;
    });
  }

  return (
    <div className="min-w-0 overflow-auto rounded border border-neutral-800" style={{ maxHeight }}>
      <table className="w-full text-[11px] font-mono tnum">
        <thead className="sticky top-0 bg-neutral-900">
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                title={column.title ?? "Sort by this column"}
                onClick={() => setSort((previous) => ({ key: column.key, descending: previous?.key === column.key ? !previous.descending : false }))}
                className={`cursor-pointer select-none whitespace-nowrap px-2 py-1 font-normal text-neutral-400 hover:text-neutral-100 ${column.align === "left" ? "text-left" : "text-right"}`}
              >
                {column.label}
                {sort?.key === column.key ? (sort.descending ? " ▼" : " ▲") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, index) => {
            const key = rowKey(row, index);
            return (
              <tr
                key={key}
                onClick={onRowClick ? () => onRowClick(row, index) : undefined}
                className={`border-t border-neutral-900 ${onRowClick ? "cursor-pointer hover:bg-neutral-800/60" : ""} ${selectedKey === key ? "bg-[#CC79A7]/15" : ""}`}
              >
                {columns.map((column) => (
                  <td key={column.key} className={`whitespace-nowrap px-2 py-0.5 text-neutral-200 ${column.align === "left" ? "text-left" : "text-right"}`}>
                    {column.cell ? column.cell(row) : String(rawValue(row, column.key) ?? "—")}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

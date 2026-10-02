/**
 * A plain sortable, paged table for this page's frames (the manifest, the
 * eight numbers, the stepper's terms, the audit record). Click a header to
 * sort; numbers right-align in tabular figures; booleans read as words with
 * a glyph, never as a colour alone.
 */

import { useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { fmt, fmtInt } from "@/studies/kit";

export interface TableColumn<Row> {
  key: string;
  label: string;
  value: (row: Row) => unknown;
  render?: (row: Row) => ReactNode;
  title?: string;
}

export function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "✓ yes" : "✕ no";
  if (typeof value === "number") return Number.isInteger(value) ? fmtInt(value) : fmt(value, Math.abs(value) >= 100 ? 2 : 4);
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return String(a).localeCompare(String(b));
}

/** Columns for a frame whose rows are plain records: one column per key, in the first row's order. */
export function recordColumns(rows: ReadonlyArray<Record<string, unknown>>): Array<TableColumn<Record<string, unknown>>> {
  const keys: string[] = [];
  for (const row of rows) for (const key of Object.keys(row)) if (!keys.includes(key)) keys.push(key);
  return keys.map((key) => ({ key, label: key, value: (row) => row[key] }));
}

export function DataTable<Row>({
  rows, columns, pageSize = 20, rowKey, onRowClick, selectedKey, rowTone,
}: {
  rows: readonly Row[];
  columns: ReadonlyArray<TableColumn<Row>>;
  pageSize?: number;
  rowKey: (row: Row, index: number) => string;
  onRowClick?: (row: Row) => void;
  selectedKey?: string | null;
  /** A muted row (e.g. a superseded manifest line). */
  rowTone?: (row: Row) => "muted" | undefined;
}) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [descending, setDescending] = useState(false);
  const [page, setPage] = useState(0);

  const column = columns.find((candidate) => candidate.key === sortKey);
  const sorted = column
    ? [...rows].sort((a, b) => (descending ? -1 : 1) * compare(column.value(a), column.value(b)))
    : [...rows];
  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const current = Math.min(page, pageCount - 1);
  const visible = sorted.slice(current * pageSize, current * pageSize + pageSize);

  const toggle = (key: string) => {
    if (sortKey === key) setDescending(!descending);
    else {
      setSortKey(key);
      setDescending(false);
    }
  };

  return (
    <div className="min-w-0 space-y-1">
      <div className="max-w-full overflow-x-auto rounded-md border border-neutral-800">
        <table className="w-full text-[11px]">
          <thead className="bg-neutral-900/80">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  title={col.title}
                  onClick={() => toggle(col.key)}
                  className="cursor-pointer select-none whitespace-nowrap px-2 py-1 text-left font-normal text-neutral-400 hover:text-neutral-200"
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    {sortKey === col.key && (descending ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, index) => {
              const key = rowKey(row, current * pageSize + index);
              const selected = selectedKey !== undefined && selectedKey === key;
              const muted = rowTone?.(row) === "muted";
              return (
                <tr
                  key={key}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={`border-t border-neutral-900 ${onRowClick ? "cursor-pointer hover:bg-neutral-800/60" : ""} ${selected ? "bg-[#56B4E9]/15" : ""} ${muted ? "text-neutral-500" : "text-neutral-200"}`}
                >
                  {columns.map((col) => {
                    const value = col.value(row);
                    return (
                      <td key={col.key} className={`whitespace-nowrap px-2 py-0.5 ${typeof value === "number" ? "text-right font-mono tnum" : ""}`}>
                        {col.render ? col.render(row) : formatCell(value)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {pageCount > 1 && (
        <div className="flex items-center gap-2 text-[11px] text-neutral-400">
          <button type="button" disabled={current === 0} onClick={() => setPage(current - 1)} className="rounded border border-neutral-700 px-2 disabled:opacity-40">
            ◀ previous
          </button>
          <span>
            page {current + 1} of {pageCount} · {fmtInt(rows.length)} rows
          </span>
          <button type="button" disabled={current >= pageCount - 1} onClick={() => setPage(current + 1)} className="rounded border border-neutral-700 px-2 disabled:opacity-40">
            next ▶
          </button>
        </div>
      )}
    </div>
  );
}

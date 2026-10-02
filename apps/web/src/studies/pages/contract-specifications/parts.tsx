/** Small pieces shared by the tabs: palette, chips, a sortable table. */

import { useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { OKABE } from "@/studies/kit";

/**
 * Okabe-Ito per exchange group. The notebook's black becomes light grey on
 * the dark page; every chart also names the exchange in its label.
 */
export const EXCHANGE_GROUP_COLORS: Record<string, string> = {
  "CME Group": OKABE.blue,
  Eurex: OKABE.orange,
  "Cboe Global Markets": OKABE.purple,
  "ICE Futures Europe": OKABE.sky,
  "Japan Exchange Group": OKABE.vermillion,
  "Singapore Exchange": OKABE.green,
  ASX: OKABE.yellow,
  "Hong Kong Exchanges and Clearing": "#e5e5e5",
};

export function exchangeColor(group: string): string {
  return EXCHANGE_GROUP_COLORS[group] ?? OKABE.grey;
}

/** A toggle chip: shows the choice and whether it is on. The mark (filled square / empty square) repeats the colour. */
export function Chip({ label, on, color, onToggle }: { label: string; on: boolean; color?: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      className={`flex items-center gap-1.5 rounded border px-2 py-1 text-[11px] ${on ? "border-neutral-500 bg-neutral-800 text-neutral-100" : "border-neutral-800 text-neutral-500 line-through hover:border-neutral-600"}`}
    >
      <span aria-hidden="true" style={{ color: on ? color ?? OKABE.sky : undefined }}>{on ? "■" : "□"}</span>
      {label}
    </button>
  );
}

export interface Column<Row> {
  key: string;
  label: string;
  /** Text for the cell and for sorting when `sortValue` is not given. */
  value: (row: Row) => string | number | boolean | null;
  render?: (row: Row) => ReactNode;
  numeric?: boolean;
  title?: string;
}

function compare(a: string | number | boolean | null, b: string | number | boolean | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

/** Click a header to sort; the arrow shows the direction. Optional text filter over every cell. */
export function SortableTable<Row>({
  rows, columns, rowKey, filterable = false, maxHeight = 420,
}: { rows: readonly Row[]; columns: ReadonlyArray<Column<Row>>; rowKey: (row: Row) => string; filterable?: boolean; maxHeight?: number }) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [descending, setDescending] = useState(false);
  const [filter, setFilter] = useState("");

  const needle = filter.trim().toLowerCase();
  let shown = needle === "" ? [...rows] : rows.filter((row) => columns.some((column) => String(column.value(row) ?? "").toLowerCase().includes(needle)));
  const sortColumn = columns.find((column) => column.key === sortKey);
  if (sortColumn) {
    shown = [...shown].sort((a, b) => (descending ? -1 : 1) * compare(sortColumn.value(a), sortColumn.value(b)));
  }

  return (
    <div className="min-w-0 space-y-1">
      {filterable && (
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="type to filter every column"
          className="h-7 w-56 rounded border border-neutral-700 bg-neutral-950 px-2 text-xs text-neutral-200"
        />
      )}
      <div className="overflow-auto rounded border border-neutral-800" style={{ maxHeight }}>
        <table className="w-full min-w-max border-collapse text-[11px]">
          <thead className="sticky top-0 bg-neutral-900">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  title={column.title ?? column.key}
                  className={`cursor-pointer select-none whitespace-nowrap border-b border-neutral-800 px-2 py-1 font-medium text-neutral-300 hover:text-neutral-50 ${column.numeric ? "text-right" : "text-left"}`}
                  onClick={() => {
                    if (sortKey === column.key) setDescending(!descending);
                    else { setSortKey(column.key); setDescending(false); }
                  }}
                >
                  {column.label}
                  {sortKey === column.key && (descending ? <ArrowDown className="ml-1 inline h-3 w-3" /> : <ArrowUp className="ml-1 inline h-3 w-3" />)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={rowKey(row)} className="border-b border-neutral-900 hover:bg-neutral-900/60">
                {columns.map((column) => (
                  <td key={column.key} className={`whitespace-nowrap px-2 py-1 text-neutral-200 ${column.numeric ? "text-right font-mono tnum" : "text-left"}`}>
                    {column.render ? column.render(row) : String(column.value(row) ?? "—")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-neutral-500">{shown.length} of {rows.length} rows</p>
    </div>
  );
}

/**
 * Two tables for the page: a sortable table whose header cells carry the
 * column's full meaning on hover, and a matrix painted on the cividis ramp
 * with the exact value printed in every cell.
 */

import { useState, type ReactNode } from "react";
import { cividis } from "./style";

export interface Column<Row> {
  key: string;
  label: string;
  /** What the column holds, in words; shown on hover. */
  hint?: string;
  value: (row: Row) => number | string | null;
  render?: (row: Row) => ReactNode;
  align?: "left" | "right";
}

export function DataTable<Row>({ rows, columns, rowKey, highlight }: { rows: readonly Row[]; columns: ReadonlyArray<Column<Row>>; rowKey: (row: Row) => string; highlight?: (row: Row) => boolean }) {
  const [sort, setSort] = useState<{ key: string; descending: boolean } | null>(null);
  const column = sort ? columns.find((candidate) => candidate.key === sort.key) : undefined;
  const shown = [...rows];
  if (sort && column) {
    shown.sort((a, b) => {
      const left = column.value(a);
      const right = column.value(b);
      if (left === right) return 0;
      if (left === null) return 1;
      if (right === null) return -1;
      const order = left < right ? -1 : 1;
      return sort.descending ? -order : order;
    });
  }
  return (
    <div className="min-w-0 overflow-x-auto">
      <table className="w-full text-[11px] font-mono tnum">
        <thead>
          <tr className="text-neutral-500">
            {columns.map((entry) => (
              <th
                key={entry.key}
                title={entry.hint ?? entry.label}
                className={`cursor-pointer select-none whitespace-nowrap px-1.5 py-1 font-normal hover:text-neutral-200 ${entry.align === "left" ? "text-left" : "text-right"}`}
                onClick={() => setSort((previous) => ({ key: entry.key, descending: previous?.key === entry.key ? !previous.descending : false }))}
              >
                {entry.label}
                {sort?.key === entry.key ? (sort.descending ? " ▼" : " ▲") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => (
            <tr key={rowKey(row)} className={`border-t border-neutral-900 ${highlight?.(row) ? "bg-[#56B4E9]/10" : ""}`}>
              {columns.map((entry) => (
                <td key={entry.key} className={`whitespace-nowrap px-1.5 py-0.5 ${entry.align === "left" ? "text-left text-neutral-300" : "text-right text-neutral-200"}`}>
                  {entry.render ? entry.render(row) : entry.value(row) ?? "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A matrix painted on cividis. `logScale` colours by the logarithm, for values
 * that span orders of magnitude (dollars from a one-minute to a one-hour bar).
 */
export function HeatTable({
  rowLabels, columnLabels, values, format, corner, logScale = false, onPick, picked,
}: {
  rowLabels: readonly string[];
  columnLabels: readonly ReactNode[];
  values: ReadonlyArray<ReadonlyArray<number | null>>;
  format: (value: number) => string;
  corner: string;
  logScale?: boolean;
  onPick?: (row: number, column: number) => void;
  picked?: { row: number; column: number } | null;
}) {
  const scaled = (value: number) => (logScale ? Math.log(value) : value);
  const finite = values.flat().filter((value): value is number => value !== null && Number.isFinite(value) && (!logScale || value > 0));
  const low = finite.length > 0 ? Math.min(...finite.map(scaled)) : 0;
  const high = finite.length > 0 ? Math.max(...finite.map(scaled)) : 1;
  return (
    <div className="min-w-0 overflow-x-auto">
      <table className="w-full border-separate border-spacing-0.5 text-[11px] font-mono tnum">
        <thead>
          <tr className="text-neutral-500">
            <th className="px-1.5 py-1 text-left font-normal">{corner}</th>
            {columnLabels.map((label, index) => (
              <th key={index} className="px-1.5 py-1 text-right font-normal">{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rowLabels.map((label, rowIndex) => (
            <tr key={label}>
              <td className="px-1.5 py-0.5 text-neutral-400">{label}</td>
              {(values[rowIndex] ?? []).map((value, columnIndex) => {
                const ok = value !== null && Number.isFinite(value) && (!logScale || value > 0);
                const tone = ok ? cividis(high > low ? (scaled(value as number) - low) / (high - low) : 0.5) : null;
                const isPicked = picked?.row === rowIndex && picked?.column === columnIndex;
                return (
                  <td
                    key={columnIndex}
                    onClick={() => onPick?.(rowIndex, columnIndex)}
                    className={`rounded px-1.5 py-0.5 text-right ${onPick ? "cursor-pointer" : ""} ${isPicked ? "outline outline-2 outline-neutral-100" : ""}`}
                    style={tone ? { background: tone.background, color: tone.text } : undefined}
                  >
                    {ok ? format(value as number) : "—"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

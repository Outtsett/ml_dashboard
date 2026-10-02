/**
 * A small table whose header sorts it. Used for the stored result tables of
 * this study, where the reader wants the exact numbers beside the chart.
 */

import { useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";

export interface TableColumn<Row> {
  key: string;
  label: string;
  /** how the cell reads; the sort uses `value` */
  render: (row: Row) => ReactNode;
  value: (row: Row) => number | string | null;
  align?: "left" | "right";
  hint?: string;
}

export function SortableTable<Row>({ rows, columns, rowKey, highlight }: {
  rows: readonly Row[];
  columns: ReadonlyArray<TableColumn<Row>>;
  rowKey: (row: Row) => string;
  /** a row to mark, e.g. the best one */
  highlight?: (row: Row) => boolean;
}) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [descending, setDescending] = useState(true);

  const column = columns.find((candidate) => candidate.key === sortKey);
  const sorted = column
    ? [...rows].sort((a, b) => {
        const left = column.value(a);
        const right = column.value(b);
        if (left === right) return 0;
        if (left === null) return 1;
        if (right === null) return -1;
        const order = left < right ? -1 : 1;
        return descending ? -order : order;
      })
    : rows;

  return (
    <div className="min-w-0 overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-neutral-500">
            {columns.map((candidate) => (
              <th key={candidate.key} className={`py-1 font-normal ${candidate.align === "right" ? "text-right" : "text-left"}`} title={candidate.hint}>
                <button
                  type="button"
                  onClick={() => {
                    if (sortKey === candidate.key) setDescending(!descending);
                    else {
                      setSortKey(candidate.key);
                      setDescending(true);
                    }
                  }}
                  className="inline-flex items-center gap-0.5 hover:text-neutral-200"
                >
                  {candidate.label}
                  {sortKey === candidate.key && (descending ? <ArrowDown className="h-3 w-3" aria-label="sorted descending" /> : <ArrowUp className="h-3 w-3" aria-label="sorted ascending" />)}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={rowKey(row)} className={`border-t border-neutral-900 ${highlight?.(row) ? "bg-[#E69F00]/10" : ""}`}>
              {columns.map((candidate) => (
                <td key={candidate.key} className={`py-0.5 pr-2 font-mono tnum text-neutral-200 ${candidate.align === "right" ? "text-right" : "text-left"}`}>
                  {candidate.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

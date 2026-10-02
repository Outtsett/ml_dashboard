/** Every column of the drawn bars, ten rows a page (the notebook's row inspector). */

import { useState } from "react";
import { fmt, fmtInt } from "@/studies/kit";
import type { WindowRow } from "@shared/studies/market-series-explorer";
import { clock } from "./layout";

const PAGE_SIZE = 10;

function cell(value: unknown, column: string): string {
  if (value === null || value === undefined) return "unknown";
  if (column === "timestamp") return clock(value as number);
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") return Math.abs(value) >= 1000 ? fmt(value, 2) : Number(value.toPrecision(6)).toString();
  return String(value);
}

export function RowTable({ rows, columns }: { rows: readonly WindowRow[]; columns: readonly string[] }) {
  const [page, setPage] = useState(0);
  const pages = Math.max(Math.ceil(rows.length / PAGE_SIZE), 1);
  const current = Math.min(page, pages - 1);
  const shown = rows.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
  const ordered = ["timestamp", "contract_symbol", "is_contract_roll_day", "open", "high", "low", "close", "volume", ...columns.filter((name) => !["open", "high", "low", "close", "volume"].includes(name))];

  return (
    <div className="space-y-1">
      <div className="overflow-x-auto rounded-md border border-neutral-800">
        <table className="min-w-full border-collapse text-[11px]">
          <thead className="bg-neutral-900/70 text-neutral-400">
            <tr>
              {ordered.map((column) => (
                <th key={column} className="whitespace-nowrap px-2 py-1 text-left font-medium">{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.timestamp} className="border-t border-neutral-800">
                {ordered.map((column) => (
                  <td key={column} className="whitespace-nowrap px-2 py-0.5 font-mono tnum text-neutral-200">{cell(row[column], column)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-neutral-400">
        <button type="button" disabled={current === 0} onClick={() => setPage(current - 1)} className="rounded border border-neutral-700 px-2 py-0.5 disabled:opacity-40">Previous</button>
        <span>
          Rows {fmtInt(current * PAGE_SIZE + 1)} to {fmtInt(Math.min((current + 1) * PAGE_SIZE, rows.length))} of {fmtInt(rows.length)}
        </span>
        <button type="button" disabled={current >= pages - 1} onClick={() => setPage(current + 1)} className="rounded border border-neutral-700 px-2 py-0.5 disabled:opacity-40">Next</button>
      </div>
    </div>
  );
}

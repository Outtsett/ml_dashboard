/** Every batch as committed: a paged table (20 rows a page), newest page last. */

import { useState } from "react";
import { fmt, fmtInt } from "@/studies/kit";
import type { BatchRow } from "@shared/studies/timescaledb-load-monitor";
import { instantLabel, monthLabel } from "./format";

const PAGE_SIZE = 20;

const HEADERS = [
  "batch_number", "recorded_at (UTC)", "month_start", "asset_class", "timeframe", "lake_row_count",
  "elapsed_seconds", "rows_per_second", "hypertable_bytes", "hypertable_row_count", "bytes_per_row",
] as const;

export function BatchTable({ rows }: { rows: readonly BatchRow[] }) {
  const [requested, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(requested, pageCount - 1);
  const visible = rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-[11px] font-mono tnum">
          <thead>
            <tr className="text-neutral-500">
              {HEADERS.map((header, index) => (
                <th key={header} className={`py-0.5 font-normal ${index < 5 ? "text-left" : "text-right"}`}>{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.batch_number} className="border-t border-neutral-900 text-neutral-200">
                <td className="py-0.5 text-left">{row.batch_number}</td>
                <td className="py-0.5 text-left">{instantLabel(row.recorded_at_epoch_milliseconds)}</td>
                <td className="py-0.5 text-left">{monthLabel(row.month_start_epoch_milliseconds)}</td>
                <td className="py-0.5 text-left">{row.asset_class}</td>
                <td className="py-0.5 text-left">{row.timeframe}</td>
                <td className="py-0.5 text-right">{fmtInt(row.lake_row_count)}</td>
                <td className="py-0.5 text-right">{fmt(row.elapsed_seconds, 2)}</td>
                <td className="py-0.5 text-right">{fmtInt(row.rows_per_second)}</td>
                <td className="py-0.5 text-right">{fmtInt(row.hypertable_bytes)}</td>
                <td className="py-0.5 text-right">{fmtInt(row.hypertable_row_count)}</td>
                <td className="py-0.5 text-right">{fmt(row.bytes_per_row, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-neutral-400">
        <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)} className="rounded border border-neutral-700 px-2 py-0.5 disabled:opacity-40">◀ previous</button>
        <span className="font-mono tnum">page {page + 1} of {pageCount} · {fmtInt(rows.length)} batches</span>
        <button type="button" disabled={page >= pageCount - 1} onClick={() => setPage(page + 1)} className="rounded border border-neutral-700 px-2 py-0.5 disabled:opacity-40">next ▶</button>
      </div>
    </div>
  );
}

/**
 * The whole one-minute frame (2.4 million rows), paged on the server: only the
 * visible page is ever read into the browser. First, previous, next, last, a
 * page-size choice and a jump to a UTC date.
 */

import { useState } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { ControlBar, SegmentControl, StudyState, fmt, fmtInt, useStudyQuery } from "@/studies/kit";
import type { PageBody } from "@shared/studies/eurusd-reactivity";

const SIZES = [8, 25, 50, 100] as const;

export function MinutePager({ pair }: { pair: string }) {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(8);
  const [startAt, setStartAt] = useState<number | null>(null);
  const [dateText, setDateText] = useState("");
  const query = useStudyQuery<PageBody>("eurusd-reactivity", { part: "page", pair, page, pageSize, startAt });
  const body = query.data?.data;
  const current = body?.page ?? page;
  const last = Math.max(0, (body?.pageCount ?? 1) - 1);

  const go = (next: number) => {
    setStartAt(null);
    setPage(Math.min(Math.max(0, next), last));
  };
  const jump = () => {
    const parsed = Date.parse(`${dateText}T00:00:00Z`);
    if (Number.isFinite(parsed)) setStartAt(parsed);
  };
  const buttonClass = "rounded border border-neutral-700 p-1 text-neutral-300 hover:border-neutral-500 disabled:opacity-40";

  return (
    <div className="space-y-2">
      <ControlBar>
        <SegmentControl label="Rows per page" value={pageSize} options={SIZES.map((size) => ({ value: size, label: String(size) }))} onChange={(size) => { setPageSize(size); setStartAt(null); setPage(0); }} />
        <div className="flex items-center gap-1 self-end pb-0.5">
          <button type="button" className={buttonClass} onClick={() => go(0)} disabled={current === 0} aria-label="First page"><ChevronsLeft className="h-3.5 w-3.5" /></button>
          <button type="button" className={buttonClass} onClick={() => go(current - 1)} disabled={current === 0} aria-label="Previous page"><ChevronLeft className="h-3.5 w-3.5" /></button>
          <span className="px-2 font-mono text-[11px] text-neutral-300">page {fmtInt(current + 1)} of {fmtInt(last + 1)}</span>
          <button type="button" className={buttonClass} onClick={() => go(current + 1)} disabled={current >= last} aria-label="Next page"><ChevronRight className="h-3.5 w-3.5" /></button>
          <button type="button" className={buttonClass} onClick={() => go(last)} disabled={current >= last} aria-label="Last page"><ChevronsRight className="h-3.5 w-3.5" /></button>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-neutral-500">Jump to UTC date</span>
          <span className="flex gap-1">
            <input
              type="date"
              value={dateText}
              onChange={(event) => setDateText(event.target.value)}
              className="h-7 rounded border border-neutral-700 bg-neutral-950 px-2 text-xs text-neutral-200"
            />
            <button type="button" onClick={jump} disabled={dateText === ""} className="h-7 rounded border border-neutral-700 px-2 text-[11px] text-neutral-300 hover:border-neutral-500 disabled:opacity-40">Go</button>
          </span>
        </label>
      </ControlBar>
      <StudyState isLoading={query.isLoading} error={query.error}>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] font-mono tnum">
            <thead>
              <tr className="text-neutral-500">
                {["timestamp (UTC)", "open price (absolute)", "high price (absolute)", "low price (absolute)", "close price (absolute)", "volume (ticks)"].map((heading, index) => (
                  <th key={heading} className={`py-0.5 font-normal ${index === 0 ? "text-left" : "text-right"}`}>{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(body?.rows ?? []).map((row) => (
                <tr key={row.timestamp} className="border-t border-neutral-900 text-neutral-200">
                  <td className="py-0.5 text-left">{new Date(row.timestamp).toISOString().slice(0, 16).replace("T", " ")}</td>
                  <td className="py-0.5 text-right">{fmt(row.open, 5)}</td>
                  <td className="py-0.5 text-right">{fmt(row.high, 5)}</td>
                  <td className="py-0.5 text-right">{fmt(row.low, 5)}</td>
                  <td className="py-0.5 text-right">{fmt(row.close, 5)}</td>
                  <td className="py-0.5 text-right">{fmtInt(row.volume)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-neutral-500">{fmtInt(body?.totalRows)} rows in all; this page is {body?.rows.length ?? 0} of them. Only the visible page is ever sent to the browser.</p>
      </StudyState>
    </div>
  );
}

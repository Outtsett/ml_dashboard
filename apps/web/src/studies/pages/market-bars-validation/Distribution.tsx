/**
 * The eight numbers of each column, as a table and as one panel per column: a
 * box from the 25th to the 75th percentile, a bar at the median, a diamond at
 * the mean, whiskers to the minimum and maximum, each panel on its own axis.
 * Mean and standard deviation describe a Gaussian and almost nothing here is
 * one; the skewness and kurtosis show the fat tail and the extremes show the
 * single print behind it.
 */

import { useState } from "react";
import { ControlBar, OKABE, SegmentControl, fmtInt } from "@/studies/kit";
import { DISTRIBUTION_STATISTICS, type DistributionRow, type DistributionStatistic } from "@shared/studies/market-bars-validation";
import { compact } from "./format";

const LABELS: Record<DistributionStatistic, string> = {
  count: "count", mean: "mean", median: "median", standard_deviation: "standard deviation", skewness: "skewness",
  kurtosis: "excess kurtosis", percentile_25: "25th percentile", percentile_75: "75th percentile", minimum: "minimum", maximum: "maximum",
};

type Scale = "log" | "linear";
type Order = "name" | "skewness" | "kurtosis" | "count";

/** Signed log10(1 + |x|): linear near zero, logarithmic in the tails, so a volume with a 3.7 million maximum and a median of 5 is readable. */
function signedLog(value: number): number {
  return Math.sign(value) * Math.log10(1 + Math.abs(value));
}

function Panel({ row, scale }: { row: DistributionRow; scale: Scale }) {
  const s = row.statistics;
  const empty = (s.count ?? 0) === 0 || s.minimum === null || s.maximum === null;
  const transform = (value: number) => (scale === "log" ? signedLog(value) : value);
  const width = 200;
  const left = 6;
  const right = width - 6;
  let body = null;
  if (!empty) {
    const lo = transform(s.minimum as number);
    const hi = transform(s.maximum as number);
    const span = hi - lo || 1;
    const x = (value: number | null) => (value === null ? null : left + ((transform(value) - lo) / span) * (right - left));
    const x25 = x(s.percentile_25), x75 = x(s.percentile_75), xMedian = x(s.median), xMean = x(s.mean);
    body = (
      <>
        <line x1={left} x2={right} y1={22} y2={22} stroke="#a3a3a3" strokeWidth={1} />
        <line x1={left} x2={left} y1={16} y2={28} stroke="#a3a3a3" />
        <line x1={right} x2={right} y1={16} y2={28} stroke="#a3a3a3" />
        {x25 !== null && x75 !== null && (
          <rect x={x25} y={12} width={Math.max(1.5, x75 - x25)} height={20} fill={OKABE.sky} fillOpacity={0.35} stroke={OKABE.sky} />
        )}
        {xMedian !== null && <line x1={xMedian} x2={xMedian} y1={10} y2={34} stroke={OKABE.orange} strokeWidth={2.5} />}
        {xMean !== null && <path d={`M${xMean} 15 l4 7 l-4 7 l-4 -7 z`} fill={OKABE.purple} stroke="#111" strokeWidth={0.5} />}
      </>
    );
  }
  return (
    <div className="min-w-0 rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
      <div className="mb-1 truncate text-[11px] font-medium text-neutral-200" title={row.column}>{row.column}</div>
      {empty ? (
        <p className="flex h-11 items-center text-[11px] text-neutral-500">No values: every row is NULL, so there is nothing to summarise.</p>
      ) : (
        <svg viewBox={`0 0 ${width} 44`} className="h-11 w-full" role="img" aria-label={`${row.column}: minimum ${compact(s.minimum)}, median ${compact(s.median)}, maximum ${compact(s.maximum)}`}>
          {body}
        </svg>
      )}
      {!empty && (
        <div className="flex justify-between font-mono text-[9px] text-neutral-500">
          <span>{compact(s.minimum)}</span>
          <span>{compact(s.maximum)}</span>
        </div>
      )}
      <dl className="mt-1 grid grid-cols-1 gap-x-2 text-[10px] font-mono tnum">
        {DISTRIBUTION_STATISTICS.map((name) => (
          <div key={name} className="flex justify-between gap-1" title={LABELS[name]}>
            <span className="truncate text-neutral-500">{LABELS[name]}</span>
            <span className="text-neutral-200">{name === "count" ? fmtInt(s[name]) : compact(s[name], 3)}</span>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function Distribution({ rows }: { rows: readonly DistributionRow[] }) {
  const [scale, setScale] = useState<Scale>("log");
  const [order, setOrder] = useState<Order>("name");
  const [filter, setFilter] = useState("");

  const shown = rows.filter((row) => row.column.toLowerCase().includes(filter.toLowerCase()));
  const key = (row: DistributionRow): number => {
    if (order === "skewness") return Math.abs(row.statistics.skewness ?? -Infinity);
    if (order === "kurtosis") return Math.abs(row.statistics.kurtosis ?? -Infinity);
    return row.statistics.count ?? -Infinity;
  };
  if (order === "name") shown.sort((a, b) => a.column.localeCompare(b.column));
  else shown.sort((a, b) => key(b) - key(a) || a.column.localeCompare(b.column));

  return (
    <div className="min-w-0 space-y-3">
      <ControlBar>
        <SegmentControl label="Axis" value={scale} options={[{ value: "log", label: "signed log" }, { value: "linear", label: "linear" }]} onChange={setScale} hint="Each panel has its own axis from its minimum to its maximum" />
        <SegmentControl
          label="Sort"
          value={order}
          options={[{ value: "name", label: "name" }, { value: "skewness", label: "skew" }, { value: "kurtosis", label: "kurtosis" }, { value: "count", label: "rows" }]}
          onChange={setOrder}
        />
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-neutral-500">Filter</span>
          <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="column name" className="h-7 w-40 rounded border border-neutral-700 bg-neutral-950 px-2 text-xs text-neutral-200" />
        </label>
      </ControlBar>
      <p className="flex flex-wrap gap-x-4 text-[11px] text-neutral-400">
        <span><span style={{ color: OKABE.sky }}>▭</span> 25th to 75th percentile</span>
        <span><span style={{ color: OKABE.orange }}>┃</span> median</span>
        <span><span style={{ color: OKABE.purple }}>◆</span> mean</span>
        <span>whiskers: minimum to maximum</span>
      </p>
      {shown.length === 0 ? (
        <p className="text-xs text-neutral-500">No column matches the filter.</p>
      ) : (
        <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(210px,1fr))]">
          {shown.map((row) => <Panel key={row.column} row={row} scale={scale} />)}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] font-mono tnum">
          <thead>
            <tr className="text-neutral-500">
              <th className="py-0.5 pr-3 text-left font-normal">column</th>
              {DISTRIBUTION_STATISTICS.map((name) => <th key={name} className="px-2 py-0.5 text-right font-normal">{LABELS[name]}</th>)}
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.column} className="border-t border-neutral-900">
                <td className="py-0.5 pr-3 text-neutral-300">{row.column}</td>
                {DISTRIBUTION_STATISTICS.map((name) => (
                  <td key={name} className="px-2 py-0.5 text-right text-neutral-200" title={row.statistics[name] === null ? "no value" : String(row.statistics[name])}>
                    {name === "count" ? fmtInt(row.statistics[name]) : compact(row.statistics[name], 4)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

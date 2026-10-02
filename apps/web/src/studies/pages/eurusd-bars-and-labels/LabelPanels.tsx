/**
 * The notebook's label half: the class-balance table (integer label columns
 * with at most 8 distinct values), the distribution table for the chosen
 * continuous columns, and a histogram panel for every one of them. The class
 * boundary behind `dir_h<h>` (measured on shuffled series, never 1.96) and its
 * formula sit beside them.
 */

import { useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Empty, FormulaCard, OKABE, TOOLTIP, fmt, fmtInt, fmtPercent, type FormulaSymbol } from "@/studies/kit";
import type { ClassBalanceRow, HorizonGridRow, LabelColumn, LabelDistribution } from "@shared/studies/eurusd-bars-and-labels";

const PAGE_SIZE = 20;

const CLASS_GLYPH: Record<number, { glyph: string; color: string; word: string }> = {
  1: { glyph: "▲", color: OKABE.orange, word: "+1" },
  0: { glyph: "■", color: OKABE.grey, word: "0" },
  [-1]: { glyph: "▼", color: OKABE.blue, word: "−1" },
};

export function ClassBalanceTable({ rows, highlightColumn }: { rows: readonly ClassBalanceRow[]; highlightColumn: string | null }) {
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(0);
  const shown = rows.filter((row) => `${row.labelColumn} ${row.displayName}`.toLowerCase().includes(filter.toLowerCase()));
  const pages = Math.max(Math.ceil(shown.length / PAGE_SIZE), 1);
  const current = Math.min(page, pages - 1);
  const visible = shown.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-[11px] text-neutral-400">
          Filter
          <input
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value);
              setPage(0);
            }}
            placeholder="column name"
            className="h-7 w-44 rounded border border-neutral-700 bg-neutral-950 px-2 text-xs text-neutral-200"
          />
        </label>
        <span className="text-[11px] text-neutral-500">{fmtInt(shown.length)} class rows</span>
        <div className="ml-auto flex items-center gap-2 text-[11px] text-neutral-400">
          <button type="button" disabled={current === 0} onClick={() => setPage(current - 1)} className="rounded border border-neutral-700 px-2 py-0.5 disabled:opacity-40">Previous</button>
          <span className="font-mono">{current + 1} / {pages}</span>
          <button type="button" disabled={current >= pages - 1} onClick={() => setPage(current + 1)} className="rounded border border-neutral-700 px-2 py-0.5 disabled:opacity-40">Next</button>
        </div>
      </div>
      <div className="overflow-x-auto rounded-md border border-neutral-800">
        <table className="w-full min-w-[560px] text-[11px]">
          <thead className="bg-neutral-900/70 text-left text-neutral-400">
            <tr>
              <th className="px-2 py-1 font-medium">label column</th>
              <th className="px-2 py-1 font-medium">class</th>
              <th className="px-2 py-1 text-right font-medium">bars</th>
              <th className="w-[38%] px-2 py-1 font-medium">share of labelled bars</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const mark = CLASS_GLYPH[row.classValue] ?? { glyph: "●", color: OKABE.sky, word: String(row.classValue) };
              return (
                <tr key={`${row.labelColumn}|${row.classValue}`} className={`border-t border-neutral-800 ${row.labelColumn === highlightColumn ? "bg-neutral-800/40" : ""}`}>
                  <td className="px-2 py-1">
                    <div className="text-neutral-200">{row.displayName}</div>
                    <div className="font-mono text-[10px] text-neutral-500">{row.labelColumn}</div>
                  </td>
                  <td className="whitespace-nowrap px-2 py-1 font-mono text-neutral-200">
                    <span style={{ color: mark.color }}>{mark.glyph}</span> {mark.word}
                  </td>
                  <td className="px-2 py-1 text-right font-mono tnum text-neutral-200">{fmtInt(row.classCount)}</td>
                  <td className="px-2 py-1">
                    <div className="flex items-center gap-2">
                      <div className="h-2.5 flex-1 rounded-sm bg-neutral-800">
                        <div className="h-2.5 rounded-sm" style={{ width: `${Math.max(row.classShare * 100, 0.4)}%`, background: mark.color }} />
                      </div>
                      <span className="w-14 text-right font-mono tnum text-neutral-200">{fmtPercent(row.classShare, 2)}</span>
                    </div>
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={4}><Empty>No class rows match.</Empty></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const DISTRIBUTION_COLUMNS: Array<[string, (row: LabelDistribution) => string]> = [
  ["count", (row) => fmtInt(row.count)],
  ["mean", (row) => fmt(row.mean, 4)],
  ["median", (row) => fmt(row.median, 4)],
  ["standard deviation", (row) => fmt(row.standardDeviation, 4)],
  ["skewness", (row) => fmt(row.skewness, 4)],
  ["excess kurtosis", (row) => fmt(row.excessKurtosis, 4)],
  ["25th percentile", (row) => fmt(row.percentile25, 4)],
  ["75th percentile", (row) => fmt(row.percentile75, 4)],
  ["minimum", (row) => fmt(row.minimum, 4)],
  ["maximum", (row) => fmt(row.maximum, 4)],
  ["dropped", (row) => fmtInt(row.droppedCount)],
  ["1st percentile", (row) => fmt(row.percentile1, 4)],
  ["5th percentile", (row) => fmt(row.percentile5, 4)],
  ["95th percentile", (row) => fmt(row.percentile95, 4)],
  ["99th percentile", (row) => fmt(row.percentile99, 4)],
];

export function DistributionTable({ rows }: { rows: readonly LabelDistribution[] }) {
  if (rows.length === 0) return <Empty>Pick at least one continuous label column.</Empty>;
  return (
    <div className="overflow-x-auto rounded-md border border-neutral-800">
      <table className="w-full min-w-[900px] text-[11px]">
        <thead className="bg-neutral-900/70 text-left text-neutral-400">
          <tr>
            <th className="px-2 py-1 font-medium">label column</th>
            {DISTRIBUTION_COLUMNS.map(([name]) => (
              <th key={name} className="px-2 py-1 text-right font-medium">{name}</th>
            ))}
          </tr>
        </thead>
        <tbody className="font-mono tnum">
          {rows.map((row) => (
            <tr key={row.labelColumn} className="border-t border-neutral-800">
              <td className="px-2 py-1 font-sans">
                <div className="text-neutral-200">{row.displayName}</div>
                <div className="font-mono text-[10px] text-neutral-500">{row.labelColumn}</div>
              </td>
              {DISTRIBUTION_COLUMNS.map(([name, read]) => (
                <td key={name} className="px-2 py-1 text-right text-neutral-200">{read(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const SUMMARY: Array<[string, (row: LabelDistribution) => number | null]> = [
  ["mean", (row) => row.mean],
  ["median", (row) => row.median],
  ["sd", (row) => row.standardDeviation],
  ["skew", (row) => row.skewness],
  ["kurt", (row) => row.excessKurtosis],
  ["p25", (row) => row.percentile25],
  ["p75", (row) => row.percentile75],
  ["min", (row) => row.minimum],
  ["max", (row) => row.maximum],
];

/** One histogram with its eight numbers: every continuous column gets its own graphic. */
export function DistributionPanel({ row, meaning, logScale }: { row: LabelDistribution; meaning: string | undefined; logScale: boolean }) {
  const data = row.bins.map((bin) => ({ middle: (bin.lower + bin.upper) / 2, lower: bin.lower, upper: bin.upper, count: bin.count, shown: logScale ? Math.log10(bin.count + 1) : bin.count }));
  return (
    <div className="min-w-0 rounded-md border border-neutral-800 bg-neutral-900/40 p-2" title={meaning}>
      <div className="truncate text-[11px] font-medium text-neutral-200">{row.displayName}</div>
      <div className="truncate font-mono text-[10px] text-neutral-500">{row.labelColumn}</div>
      <ResponsiveContainer width="100%" height={90}>
        <BarChart data={data} margin={{ top: 2, right: 2, left: 2, bottom: 0 }} barCategoryGap={0}>
          <XAxis dataKey="middle" hide />
          <YAxis hide />
          <Tooltip
            {...TOOLTIP}
            formatter={(_value, _name, item) => [fmtInt((item.payload as { count: number }).count), "bars"]}
            labelFormatter={(_label, payload) => {
              const bin = payload?.[0]?.payload as { lower: number; upper: number } | undefined;
              return bin ? `${fmt(bin.lower, 4)} to ${fmt(bin.upper, 4)}` : "";
            }}
          />
          <Bar dataKey="shown" fill={OKABE.sky} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
      <dl className="mt-1 grid grid-cols-3 gap-x-2 text-[10px] font-mono tnum">
        <dt className="col-span-3 text-neutral-500">
          n {fmtInt(row.count)} · outside the bins: {fmtInt(row.countBelowHistogramRange)} below, {fmtInt(row.countAboveHistogramRange)} above
        </dt>
        {SUMMARY.map(([label, read]) => (
          <div key={label} className="flex justify-between gap-1">
            <span className="text-neutral-500">{label}</span>
            <span className="text-neutral-200">{fmt(read(row), 3)}</span>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function HorizonGridTable({ rows, selectedHorizon }: { rows: readonly HorizonGridRow[]; selectedHorizon: number | null }) {
  if (rows.length === 0) return <Empty>No horizon grid at this timeframe.</Empty>;
  return (
    <div className="overflow-x-auto rounded-md border border-neutral-800">
      <table className="w-full min-w-[720px] text-[11px]">
        <thead className="bg-neutral-900/70 text-left text-neutral-400">
          <tr>
            <th className="px-2 py-1 font-medium">horizon</th>
            <th className="px-2 py-1 text-right font-medium">boundary |t|</th>
            <th className="px-2 py-1 text-right font-medium">labelled bars</th>
            <th className="px-2 py-1 text-right font-medium">▲ up</th>
            <th className="px-2 py-1 text-right font-medium">■ ranging</th>
            <th className="px-2 py-1 text-right font-medium">▼ down</th>
            <th className="px-2 py-1 text-right font-medium">trending</th>
            <th className="px-2 py-1 text-right font-medium">trending on a shuffled series</th>
            <th className="px-2 py-1 font-medium">landed</th>
          </tr>
        </thead>
        <tbody className="font-mono tnum">
          {rows.map((row) => (
            <tr key={row.horizonBars} className={`border-t border-neutral-800 ${row.horizonBars === selectedHorizon ? "bg-neutral-800/40" : ""}`}>
              <td className="px-2 py-1 font-sans text-neutral-200">{row.horizonBars} bars <span className="text-neutral-500">({fmt(row.horizonTradingDays, 2)} trading days)</span></td>
              <td className="px-2 py-1 text-right text-neutral-200">{fmt(row.upperBoundaryTStatistic, 2)}</td>
              <td className="px-2 py-1 text-right text-neutral-200">{fmtPercent(row.labelledBarShare, 1)}</td>
              <td className="px-2 py-1 text-right text-neutral-200">{fmtPercent(row.upShare, 2)}</td>
              <td className="px-2 py-1 text-right text-neutral-200">{fmtPercent(row.rangingShare, 2)}</td>
              <td className="px-2 py-1 text-right text-neutral-200">{fmtPercent(row.downShare, 2)}</td>
              <td className="px-2 py-1 text-right text-neutral-200">{fmtPercent(row.trendingShare, 2)}</td>
              <td className="px-2 py-1 text-right text-neutral-200">{fmtPercent(row.shuffledTrendingShare, 2)}</td>
              <td className="px-2 py-1 font-sans text-neutral-300">{row.kept ? "yes" : "no: under 20% of bars labelled"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function LabelFormula({ grid, horizon }: { grid: HorizonGridRow | undefined; horizon: number | null }) {
  const symbols: FormulaSymbol[] = [
    { tex: "C_{t+k}", name: "close k bars after bar t", value: "k = 1 … h" },
    { tex: "h", name: "horizon: how many bars ahead the label looks", value: horizon === null ? "—" : `${horizon} bars` },
    { tex: "\\hat\\beta", name: "least-squares slope of log close on k, a log return per bar", value: "per bar, per horizon" },
    { tex: "\\mathrm{SE}(\\hat\\beta)", name: "that slope's standard error", value: "per bar, per horizon" },
    { tex: "t^{\\mathrm{fwd}}_t", name: "forward slope t-statistic (how sure the move is)", value: "per bar, per horizon" },
    { tex: "\\tau", name: "class boundary: the 90th percentile of |t| on shuffled development returns", value: grid?.upperBoundaryTStatistic === null || grid === undefined ? "—" : fmt(grid.upperBoundaryTStatistic, 3) },
    { tex: "\\mathrm{dir}_t", name: "forward direction: +1 up, 0 ranging, −1 down; unlabelled where the window crosses a gap", value: "−1, 0, +1" },
  ];
  return (
    <FormulaCard
      tex="\ln C_{t+k} = \alpha + \beta k + \varepsilon_k \;(k=1..h), \quad t^{\mathrm{fwd}}_t=\frac{\hat\beta}{\mathrm{SE}(\hat\beta)}, \quad \mathrm{dir}_t=\begin{cases}+1 & t^{\mathrm{fwd}}_t \ge \tau\\ -1 & t^{\mathrm{fwd}}_t \le -\tau\\ 0 & \text{otherwise}\end{cases}"
      symbols={symbols}
      caption="The window starts at t + 1, so the labelled bar is not inside its own label. A slope's t-statistic on a random walk is not t-distributed, so the boundary is measured on shuffled returns rather than taken as 1.96."
    />
  );
}

export function catalogMeaning(catalog: readonly LabelColumn[], column: string): string | undefined {
  return catalog.find((entry) => entry.labelColumn === column)?.meaning;
}

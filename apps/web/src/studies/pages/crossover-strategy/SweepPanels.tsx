/**
 * The landed record: the sweep over every EMA / SMA pair (the search the
 * notebook's pair was picked from), the reality check the analytics package
 * runs on the pick (walk-forward chunks, block bootstrap, Deflated Sharpe
 * Ratio), the two baselines, and the notebook's own quoted figures set beside
 * what was computed. These come from derived_study_crossover_strategy_*, built
 * once by packages/ml-engine/src/studies/crossover_strategy/build.py; they do not move with the
 * strategy controls, which only recompute the live panels.
 */

import { Bar, BarChart, CartesianGrid, Cell, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, GRID, OKABE, TOOLTIP, fmt, fmtInt, fmtPercent } from "@/studies/kit";
import type { FoldRow, LandedRecord, RealityCheckRow, SummaryBlock, SweepRow } from "@shared/studies/crossover-strategy";

export type SweepMetric = "out_of_sample_sharpe" | "in_sample_sharpe" | "full_sample_sharpe" | "total_return_fraction" | "maximum_drawdown_fraction" | "trade_count";

export const SWEEP_METRICS: ReadonlyArray<{ value: SweepMetric; label: string }> = [
  { value: "out_of_sample_sharpe", label: "out-of-sample Sharpe" },
  { value: "in_sample_sharpe", label: "in-sample Sharpe" },
  { value: "full_sample_sharpe", label: "full-period Sharpe" },
  { value: "total_return_fraction", label: "total return" },
  { value: "maximum_drawdown_fraction", label: "maximum drawdown" },
  { value: "trade_count", label: "trade count" },
];

function formatMetric(metric: SweepMetric, value: number): string {
  if (metric === "total_return_fraction" || metric === "maximum_drawdown_fraction") return `${(value * 100).toFixed(0)}%`;
  if (metric === "trade_count") return fmtInt(value);
  return fmt(value, 2);
}

function cellColor(metric: SweepMetric, value: number, scale: number): string {
  const t = scale > 0 ? Math.min(1, Math.abs(value) / scale) : 0;
  if (metric === "trade_count") return `rgba(86,180,233,${0.12 + 0.55 * t})`;
  if (metric === "maximum_drawdown_fraction") return `rgba(0,114,178,${0.12 + 0.6 * t})`;
  return value >= 0 ? `rgba(230,159,0,${0.12 + 0.6 * t})` : `rgba(0,114,178,${0.12 + 0.6 * t})`;
}

export interface LiveSelection {
  fastKind: string;
  slowKind: string;
  fastPeriod: number;
  slowPeriod: number;
}

/** Rows are fast periods, columns are slow periods, one ordering (fast kind over slow kind) at a time. */
export function SweepHeatmap({
  rows, metric, label, live,
}: { rows: SweepRow[]; metric: SweepMetric; label: string; live: LiveSelection | null }) {
  const inOrdering = rows.filter((row) => row.configuration_label === label);
  const fasts = [...new Set(inOrdering.map((row) => row.fast_period))].sort((a, b) => a - b);
  const slows = [...new Set(inOrdering.map((row) => row.slow_period))].sort((a, b) => a - b);
  const byCell = new Map(inOrdering.map((row) => [`${row.fast_period}|${row.slow_period}`, row]));
  const scale = Math.max(...inOrdering.map((row) => Math.abs(row[metric])), 1e-9);
  const liveLabel = live ? `${live.fastKind.toUpperCase()}/${live.slowKind.toUpperCase()}` : null;
  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-0.5 text-[10px] font-mono tnum">
        <thead>
          <tr>
            <th className="px-1 text-right font-normal text-neutral-500">fast ↓ / slow →</th>
            {slows.map((slow) => (
              <th key={slow} className="w-12 px-1 text-center font-normal text-neutral-400">{slow}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {fasts.map((fast) => (
            <tr key={fast}>
              <th className="px-1 text-right font-normal text-neutral-400">{fast}</th>
              {slows.map((slow) => {
                const row = byCell.get(`${fast}|${slow}`);
                if (!row) return <td key={slow} className="h-8 w-12 rounded-sm bg-neutral-900/40" />;
                const isLive = live !== null && liveLabel === label && live.fastPeriod === fast && live.slowPeriod === slow;
                return (
                  <td
                    key={slow}
                    className={`relative h-8 w-12 rounded-sm text-center text-neutral-50 ${row.is_notebook_pair ? "outline outline-2 outline-white" : ""} ${isLive ? "ring-2 ring-[#F0E442]" : ""}`}
                    style={{ backgroundColor: cellColor(metric, row[metric], scale) }}
                    title={
                      `${row.configuration_label} ${fast} x ${slow}\n` +
                      `in-sample Sharpe ${fmt(row.in_sample_sharpe, 3)} (rank ${row.in_sample_rank} of ${rows.length})\n` +
                      `out-of-sample Sharpe ${fmt(row.out_of_sample_sharpe, 3)}\nfull-period Sharpe ${fmt(row.full_sample_sharpe, 3)}\n` +
                      `total return ${fmtPercent(row.total_return_fraction, 1)}, maximum drawdown ${fmtPercent(row.maximum_drawdown_fraction, 1)}\n${fmtInt(row.trade_count)} trades`
                    }
                  >
                    {formatMetric(metric, row[metric])}
                    {row.is_in_sample_winner && <span className="absolute right-0.5 top-0 text-[9px] text-white">★</span>}
                    {row.is_notebook_pair && <span className="absolute left-0.5 top-0 text-[9px] text-white">●</span>}
                    {isLive && <span className="absolute bottom-0 right-0.5 text-[9px] text-[#F0E442]">◆</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[11px] text-neutral-400">
        Orange = positive, blue = negative (the number is in every cell). <span className="text-white">●</span> the notebook's pair, <span className="text-white">★</span> the best in-sample
        pair of the whole search, <span className="text-[#F0E442]">◆</span> the pair selected in the controls above (this ordering only). Hover a cell for all six numbers.
      </p>
    </div>
  );
}

// ---------------------------------------------------------- reality check

function IntervalRow({ row, low, high, axisMin, axisMax }: { row: RealityCheckRow; low: number; high: number; axisMin: number; axisMax: number }) {
  const position = (value: number) => `${((value - axisMin) / (axisMax - axisMin)) * 100}%`;
  return (
    <div className="grid grid-cols-[14rem_1fr_8rem] items-center gap-2 text-[11px]">
      <span className="truncate text-neutral-300">{row.candidate === "notebook_pair" ? "notebook's pair" : "best in-sample pair"} · {row.configuration_label} {row.fast_period}x{row.slow_period}</span>
      <div className="relative h-5 rounded bg-neutral-900">
        <div className="absolute top-0 h-5 border-l border-dashed border-neutral-400" style={{ left: position(0) }} title="Sharpe 0" />
        <div className="absolute top-2 h-1 rounded" style={{ left: position(low), width: `${((high - low) / (axisMax - axisMin)) * 100}%`, backgroundColor: OKABE.sky }} />
        <div className="absolute top-0.5 h-4 w-0.5" style={{ left: position(low), backgroundColor: OKABE.sky }} />
        <div className="absolute top-0.5 h-4 w-0.5" style={{ left: position(high), backgroundColor: OKABE.sky }} />
        <div className="absolute top-0.5 h-4 w-1 rounded-sm" style={{ left: position(row.bootstrap_median), backgroundColor: OKABE.orange }} title="bootstrap median" />
        <div className="absolute top-1 h-3 w-3 -translate-x-1/2 rotate-45 border border-black" style={{ left: position(row.full_sample_sharpe), backgroundColor: OKABE.yellow }} title="observed full-period Sharpe" />
      </div>
      <span className="font-mono tnum text-neutral-200">[{fmt(low, 2)}, {fmt(high, 2)}]</span>
    </div>
  );
}

export function RealityPanel({ rows }: { rows: RealityCheckRow[] }) {
  if (rows.length === 0) return null;
  const axisMin = Math.min(0, ...rows.map((row) => row.bootstrap_interval_low)) - 0.3;
  const axisMax = Math.max(...rows.map((row) => row.bootstrap_interval_high)) + 0.3;
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <p className="text-[11px] text-neutral-400">
          95% block-bootstrap interval of the after-cost Sharpe ({fmtInt(rows[0]?.bootstrap_replicate_count)} resamples, block of {fmtInt(rows[0]?.bootstrap_block_bars)} bar). ◆ observed, ▮ bootstrap median, dashed line = Sharpe 0.
        </p>
        {rows.map((row) => (
          <IntervalRow key={row.candidate} row={row} low={row.bootstrap_interval_low} high={row.bootstrap_interval_high} axisMin={axisMin} axisMax={axisMax} />
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[460px] text-[11px] font-mono tnum">
          <thead>
            <tr className="text-left text-neutral-500">
              <th className="py-0.5 font-normal">check</th>
              {rows.map((row) => (
                <th key={row.candidate} className="text-right font-normal">{row.candidate === "notebook_pair" ? "notebook's pair" : "best in-sample pair"}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              ["pair", (row: RealityCheckRow) => `${row.configuration_label} ${row.fast_period} x ${row.slow_period}`],
              ["full-period Sharpe after cost", (row: RealityCheckRow) => fmt(row.full_sample_sharpe, 3)],
              ["total return", (row: RealityCheckRow) => fmtPercent(row.total_return_fraction, 1)],
              ["walk-forward median Sharpe (6 chunks)", (row: RealityCheckRow) => fmt(row.walk_forward_median_sharpe, 3)],
              ["losing chunks of 6", (row: RealityCheckRow) => fmtInt(row.walk_forward_losing_fold_count)],
              ["bootstrap 95% interval includes 0", (row: RealityCheckRow) => (row.bootstrap_interval_includes_zero ? "yes" : "no")],
              ["return skewness / kurtosis (Pearson)", (row: RealityCheckRow) => `${fmt(row.return_skewness, 2)} / ${fmt(row.return_kurtosis_pearson, 1)}`],
              ["trials the search is deflated by", (row: RealityCheckRow) => fmtInt(row.trial_count)],
              ["Deflated Sharpe Ratio (needs > 0.95)", (row: RealityCheckRow) => fmt(row.deflated_sharpe_ratio, 3)],
              ["survives the reality check", (row: RealityCheckRow) => (row.survives_reality_check ? "yes" : "no")],
            ].map(([label, read]) => (
              <tr key={label as string} className="border-t border-neutral-900">
                <td className="py-0.5 text-neutral-400">{label as string}</td>
                {rows.map((row) => (
                  <td key={row.candidate} className="text-right text-neutral-200">{(read as (row: RealityCheckRow) => string)(row)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function FoldsChart({ folds, height = 240 }: { folds: FoldRow[]; height?: number }) {
  const byFold = new Map<number, { fold: string; notebook: number | null; winner: number | null }>();
  for (const row of folds) {
    const entry = byFold.get(row.fold) ?? { fold: `chunk ${row.fold + 1}`, notebook: null, winner: null };
    if (row.candidate === "notebook_pair") entry.notebook = row.sharpe;
    else entry.winner = row.sharpe;
    byFold.set(row.fold, entry);
  }
  const data = [...byFold.entries()].sort((a, b) => a[0] - b[0]).map(([, entry]) => entry);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 16, left: 4, bottom: 4 }}>
        <CartesianGrid {...GRID} vertical={false} />
        <XAxis dataKey="fold" tick={AXIS} />
        <YAxis tick={AXIS} width={40} tickFormatter={(value: number) => fmt(value, 0)} label={{ value: "after-cost Sharpe", angle: -90, position: "insideLeft", fill: "#a3a3a3", fontSize: 10, offset: 10 }} />
        <Tooltip {...TOOLTIP} formatter={(value, name) => [`${Number(value) >= 0 ? "▲ " : "▼ "}${fmt(Number(value), 3)}`, String(name)]} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <ReferenceLine y={0} stroke="#a3a3a3" />
        <Bar dataKey="notebook" name="notebook's pair" fill={OKABE.orange} isAnimationActive={false}>
          {data.map((entry) => (
            <Cell key={entry.fold} fill={(entry.notebook ?? 0) >= 0 ? OKABE.orange : OKABE.blue} />
          ))}
        </Bar>
        <Bar dataKey="winner" name="best in-sample pair" fill={OKABE.purple} fillOpacity={0.6} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// -------------------------------------------------------------- baselines

export function ReferenceTable({ landed, live }: { landed: LandedRecord; live: SummaryBlock | null }) {
  const notebook = landed.sweep.find((row) => row.is_notebook_pair);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-[11px] font-mono tnum">
        <thead>
          <tr className="text-left text-neutral-500">
            <th className="py-0.5 font-normal">rule (same bars, same cost)</th>
            <th className="text-right font-normal">in-sample Sharpe</th>
            <th className="text-right font-normal">out-of-sample Sharpe</th>
            <th className="text-right font-normal">full Sharpe</th>
            <th className="text-right font-normal">total return</th>
            <th className="text-right font-normal">max drawdown</th>
            <th className="text-right font-normal">trades</th>
          </tr>
        </thead>
        <tbody>
          {notebook && (
            <tr className="border-t border-neutral-900">
              <td className="py-0.5 text-neutral-200">{notebook.configuration_label} {notebook.fast_period} x {notebook.slow_period} (landed)</td>
              <td className="text-right">{fmt(notebook.in_sample_sharpe, 3)}</td>
              <td className="text-right">{fmt(notebook.out_of_sample_sharpe, 3)}</td>
              <td className="text-right">{fmt(notebook.full_sample_sharpe, 3)}</td>
              <td className="text-right">{fmtPercent(notebook.total_return_fraction, 1)}</td>
              <td className="text-right">{fmtPercent(notebook.maximum_drawdown_fraction, 1)}</td>
              <td className="text-right">{fmtInt(notebook.trade_count)}</td>
            </tr>
          )}
          {live && (
            <tr className="border-t border-neutral-900">
              <td className="py-0.5 text-neutral-200">the strategy in the controls (live)</td>
              <td className="text-right">{fmt(live.strategy.sharpeInSample, 3)}</td>
              <td className="text-right">{fmt(live.strategy.sharpeOutOfSample, 3)}</td>
              <td className="text-right">{fmt(live.strategy.sharpeFull, 3)}</td>
              <td className="text-right">{fmtPercent(live.strategy.totalReturn, 1)}</td>
              <td className="text-right">{fmtPercent(live.strategy.maximumDrawdown, 1)}</td>
              <td className="text-right">{fmtInt(live.positionChangeCount)}</td>
            </tr>
          )}
          {landed.referenceRules.map((rule) => (
            <tr key={rule.rule} className="border-t border-neutral-900" title={rule.description}>
              <td className="py-0.5 text-neutral-200">{rule.rule === "macd_signal_line_crossing" ? "MACD(12,26,9) signal-line crossing (landed)" : "buy and hold (landed)"}</td>
              <td className="text-right">{fmt(rule.in_sample_sharpe, 3)}</td>
              <td className="text-right">{fmt(rule.out_of_sample_sharpe, 3)}</td>
              <td className="text-right">{fmt(rule.full_sample_sharpe, 3)}</td>
              <td className="text-right">{fmtPercent(rule.total_return_fraction, 1)}</td>
              <td className="text-right">{fmtPercent(rule.maximum_drawdown_fraction, 1)}</td>
              <td className="text-right">{fmtInt(rule.trade_count)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ----------------------------------------------------------------- claims

interface Claim {
  said: string;
  quoted: string;
  computed: string;
  live: string;
  verdict: string;
  reproduced: boolean | null;
}

export function notebookClaims(landed: LandedRecord, live: SummaryBlock | null): Claim[] {
  const notebook = landed.sweep.find((row) => row.is_notebook_pair);
  const macd = landed.referenceRules.find((rule) => rule.rule === "macd_signal_line_crossing");
  const pair = landed.realityCheck.find((row) => row.candidate === "notebook_pair");
  const claims: Claim[] = [];
  if (notebook) {
    claims.push({
      said: "cost-adjusted out-of-sample Sharpe ~1.8",
      quoted: "1.8",
      computed: fmt(notebook.out_of_sample_sharpe, 3),
      live: live ? fmt(live.strategy.sharpeOutOfSample, 3) : "—",
      verdict: Math.abs(notebook.out_of_sample_sharpe - 1.8) < 0.06 ? "reproduced" : "not reproduced",
      reproduced: Math.abs(notebook.out_of_sample_sharpe - 1.8) < 0.06,
    });
    claims.push({
      said: "max drawdown -17.5%",
      quoted: "-17.5%",
      computed: fmtPercent(notebook.maximum_drawdown_fraction, 2),
      live: live ? fmtPercent(live.strategy.maximumDrawdown, 2) : "—",
      verdict: Math.abs(notebook.maximum_drawdown_fraction + 0.175) < 0.0006 ? "reproduced" : "not reproduced",
      reproduced: Math.abs(notebook.maximum_drawdown_fraction + 0.175) < 0.0006,
    });
  }
  if (macd) {
    claims.push({
      said: "MACD cross alone scored out-of-sample Sharpe 0.203",
      quoted: fmt(macd.notebook_claimed_out_of_sample_sharpe, 3),
      computed: fmt(macd.out_of_sample_sharpe, 3),
      live: "—",
      verdict: "not reproduced: the same engine, cost and window give this for the always-in MACD(12,26,9) signal-line rule",
      reproduced: false,
    });
  }
  if (pair && notebook) {
    claims.push({
      said: "\"validated\" strategy",
      quoted: "validated",
      computed: `in-sample rank ${notebook.in_sample_rank} of ${landed.sweep.length}; Deflated Sharpe Ratio ${fmt(pair.deflated_sharpe_ratio, 3)} (needs > 0.95)`,
      live: "—",
      verdict: pair.survives_reality_check ? "survives the analytics package's reality check" : "does not survive the analytics package's reality check (selection from the same window)",
      reproduced: pair.survives_reality_check,
    });
  }
  if (live) {
    claims.push({
      said: "costs already deducted, no lookahead",
      quoted: "costs deducted",
      computed: `${fmtPercent(live.totalCostFraction, 1)} of capital paid in cost over ${fmtInt(live.positionChangeCount)} position changes`,
      live: `net ${fmt(live.strategy.finalEquity, 4)} vs before cost ${fmt(live.grossFinalEquity, 4)}`,
      verdict: "cost is charged on every change of position; the position used for a bar's return is the one decided at the previous close",
      reproduced: true,
    });
  }
  return claims;
}

export function ClaimsTable({ landed, live }: { landed: LandedRecord; live: SummaryBlock | null }) {
  const claims = notebookClaims(landed, live);
  if (claims.length === 0) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-[11px]">
        <thead>
          <tr className="text-left text-neutral-500">
            <th className="py-0.5 font-normal">what the notebook's text said</th>
            <th className="font-normal">it quoted</th>
            <th className="font-normal">computed (notebook's settings)</th>
            <th className="font-normal">live (controls)</th>
            <th className="font-normal">verdict</th>
          </tr>
        </thead>
        <tbody>
          {claims.map((claim) => (
            <tr key={claim.said} className="border-t border-neutral-900 align-top">
              <td className="py-1 pr-2 text-neutral-200">{claim.said}</td>
              <td className="pr-2 font-mono text-neutral-300">{claim.quoted}</td>
              <td className="pr-2 font-mono text-neutral-200">{claim.computed}</td>
              <td className="pr-2 font-mono text-neutral-300">{claim.live}</td>
              <td className="text-neutral-300">
                <span style={{ color: claim.reproduced ? OKABE.orange : OKABE.blue }}>{claim.reproduced ? "✓ " : "✗ "}</span>
                {claim.verdict}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

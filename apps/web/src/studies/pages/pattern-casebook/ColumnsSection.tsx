/**
 * Section 5: every column of the selected pattern side's trades (the trades
 * behind sections 1-3 for the chosen timeframe, pattern side and year), one
 * panel each with its eight numbers. The table can hold 50,000 trades, so the
 * server profiles it and the page draws the profiles.
 */

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AXIS, ControlBar, OKABE, Section, SliderControl, StudyNotes, StudyState, SwitchControl, TOOLTIP, fmt, fmtInt, useStudyQuery,
} from "@/studies/kit";
import type { ColumnProfile, ColumnsBody } from "@shared/studies/pattern-casebook";
import { splitPatternSide, type Controls, type SetControl } from "./controls";

const SUMMARY: Array<[keyof ColumnProfile["summary"], string]> = [
  ["count", "count"], ["mean", "mean"], ["median", "median"], ["standardDeviation", "standard deviation"], ["skewness", "skewness"],
  ["kurtosis", "excess kurtosis"], ["percentile25", "25th percentile"], ["percentile75", "75th percentile"], ["minimum", "minimum"], ["maximum", "maximum"],
];

function shown(count: number, log: boolean): number {
  return log ? Math.log10(count + 1) : count;
}

function Panel({ profile, log }: { profile: ColumnProfile; log: boolean }) {
  const data = profile.bins.map((bin) => ({ ...bin, middle: (bin.lower + bin.upper) / 2, shown: shown(bin.count, log) }));
  return (
    <div className="min-w-0 rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
      <div className="mb-1 truncate text-[11px] font-medium text-neutral-200" title={profile.column}>{profile.column}</div>
      <ResponsiveContainer width="100%" height={100}>
        <BarChart data={data} margin={{ top: 2, right: 2, left: 2, bottom: 0 }} barCategoryGap={0}>
          <XAxis dataKey="middle" hide />
          <YAxis hide />
          <Tooltip
            {...TOOLTIP}
            formatter={(_value, _name, item) => [fmtInt((item.payload as { count: number }).count), "trades"]}
            labelFormatter={(_label, payload) => {
              const bin = payload?.[0]?.payload as { lower: number; upper: number } | undefined;
              return bin ? `${fmt(bin.lower, 2)} to ${fmt(bin.upper, 2)}` : "";
            }}
          />
          <Bar dataKey="shown" fill={OKABE.sky} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
      <div className="flex justify-between font-mono text-[9px] text-neutral-500">
        <span>{fmt(profile.bins[0]?.lower, 2)}</span>
        <span>{fmt(profile.bins[profile.bins.length - 1]?.upper, 2)}</span>
      </div>
    </div>
  );
}

export function ColumnsSection({ controls, set, patternSide, cost }: { controls: Controls; set: SetControl; patternSide: string; cost: number | undefined }) {
  const { pattern, side } = splitPatternSide(patternSide);
  const query = useStudyQuery<ColumnsBody | null>("pattern-casebook", {
    part: "columns", timeframe: controls.timeframe, year: controls.year, pattern, side, bins: controls.bins, cost,
  });
  const body = query.data?.data ?? null;
  const days = (body?.tradesPerTradingDay ?? []).map((bin) => ({ ...bin, label: `${fmt(bin.lower, 1)}–${fmt(bin.upper, 1)}`, shown: shown(bin.tradingDays, controls.logCounts) }));
  const months = (body?.months ?? []).map((entry) => ({ ...entry, shown: shown(entry.trades, controls.logCounts) }));

  return (
    <Section
      title="5 · Every column of the selected pattern's trades"
      question={`pattern_firing_trades for ${controls.timeframe} ${pattern} (${side}) in ${controls.year}: one panel per column; net_dollars_candle_k is priced at this page's round trip (${body ? fmt(body.costTicks, 4) : "…"} ticks).`}
    >
      <ControlBar>
        <SliderControl label="Bins" value={controls.bins} min={10} max={80} step={5} onChange={(value) => set("bins", value)} />
        <SwitchControl label="Log count axis" checked={controls.logCounts} onChange={(value) => set("logCounts", value)} />
      </ControlBar>
      <StudyState isLoading={query.isLoading} error={query.error}>
        <StudyNotes notes={query.data?.notes ?? []} />
        {body && (
          <div className="mt-2 space-y-3">
            <p className="text-[11px] text-neutral-400">
              <strong className="text-neutral-200">{fmtInt(body.rowCount)} trades. Constant here:</strong>{" "}
              {body.constants.map((entry) => `${entry.column} = ${entry.value}`).join(", ") || "none"}
            </p>
            <div className="grid min-w-0 gap-3 xl:grid-cols-2">
              <div className="min-w-0">
                <p className="text-[11px] text-neutral-400">bar_timestamp, trades by month</p>
                <ResponsiveContainer width="100%" height={140}>
                  <BarChart data={months} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <XAxis dataKey="month" {...AXIS} />
                    <YAxis {...AXIS} width={40} />
                    <Tooltip {...TOOLTIP} formatter={(_value, _name, item) => [fmtInt((item.payload as { trades: number }).trades), "trades"]} />
                    <Bar dataKey="shown" fill={OKABE.sky} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="min-w-0">
                <p className="text-[11px] text-neutral-400">trading_day, trades on one trading day (count of days)</p>
                <ResponsiveContainer width="100%" height={140}>
                  <BarChart data={days} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barCategoryGap={1}>
                    <XAxis dataKey="label" {...AXIS} />
                    <YAxis {...AXIS} width={40} />
                    <Tooltip {...TOOLTIP} formatter={(_value, _name, item) => [fmtInt((item.payload as { tradingDays: number }).tradingDays), "trading days"]} />
                    <Bar dataKey="shown" fill={OKABE.sky} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {body.categorical.map((entry) => (
                <div key={entry.column} className="min-w-0">
                  <p className="text-[11px] text-neutral-400">{entry.column}</p>
                  <ResponsiveContainer width="100%" height={Math.max(80, 18 * Math.min(entry.counts.length, 20))}>
                    <BarChart data={entry.counts.slice(0, 20).map((count) => ({ ...count, shown: shown(count.trades, controls.logCounts) }))} layout="vertical" margin={{ top: 2, right: 8, left: 0, bottom: 0 }}>
                      <XAxis type="number" {...AXIS} />
                      <YAxis type="category" dataKey="value" width={90} interval={0} {...AXIS} />
                      <Tooltip {...TOOLTIP} formatter={(_value, _name, item) => [fmtInt((item.payload as { trades: number }).trades), "trades"]} />
                      <Bar dataKey="shown" fill={OKABE.sky} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ))}
            </div>
            <div className="grid min-w-0 gap-2 grid-cols-[repeat(auto-fill,minmax(190px,1fr))]">
              {body.numeric.map((profile) => (
                <Panel key={profile.column} profile={profile} log={controls.logCounts} />
              ))}
            </div>
            <div className="max-h-[420px] overflow-auto rounded border border-neutral-800">
              <table className="w-full min-w-[900px] text-right font-mono text-[11px] tnum">
                <thead className="sticky top-0 bg-neutral-900 text-neutral-400">
                  <tr>
                    <th className="px-2 py-1 text-left font-normal">column</th>
                    {SUMMARY.map(([, label]) => (
                      <th key={label} className="px-2 py-1 font-normal">{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {body.numeric.map((profile) => (
                    <tr key={profile.column} className="border-t border-neutral-900 text-neutral-200">
                      <td className="px-2 py-0.5 text-left">{profile.column}</td>
                      {SUMMARY.map(([key]) => (
                        <td key={key} className="px-2 py-0.5">{key === "count" ? fmtInt(profile.summary.count) : fmt(profile.summary[key] as number | null, 3)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </StudyState>
    </Section>
  );
}

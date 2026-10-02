/**
 * Every column of the one-minute frame as its own graphic with its eight
 * numbers. The frame is 2.4 million rows, so the histograms and statistics
 * are computed in the lake and only the bins travel; the timestamp column is
 * drawn as bars per UTC month from the daily frame.
 */

import { useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ControlBar, OKABE, SliderControl, SwitchControl, TOOLTIP, fmt, fmtInt } from "@/studies/kit";
import type { ColumnProfile, DailyRow } from "@shared/studies/eurusd-reactivity";

const SUMMARY: Array<[keyof ColumnProfile["summary"], string]> = [
  ["mean", "mean"], ["median", "median"], ["standard_deviation", "sd"], ["skewness", "skew"], ["excess_kurtosis", "kurt"],
  ["percentile_25", "p25"], ["percentile_75", "p75"], ["minimum", "min"], ["maximum", "max"],
];

function Panel({ profile, logScale }: { profile: ColumnProfile; logScale: boolean }) {
  const data = profile.histogram.map((bin) => ({
    middle: (bin.lower + bin.upper) / 2, lower: bin.lower, upper: bin.upper, count: bin.count, shown: logScale ? Math.log10(bin.count + 1) : bin.count,
  }));
  const decimals = profile.unit === "price" ? 5 : 3;
  return (
    <div className="min-w-0 rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
      <div className="mb-1 truncate text-[11px] font-medium text-neutral-200" title={`${profile.label} (${profile.unit})`}>
        {profile.label} <span className="font-normal text-neutral-500">· {profile.unit}</span>
      </div>
      <ResponsiveContainer width="100%" height={96}>
        <BarChart data={data} margin={{ top: 2, right: 2, left: 2, bottom: 0 }} barCategoryGap={0}>
          <XAxis dataKey="middle" hide />
          <YAxis hide />
          <Tooltip
            {...TOOLTIP}
            formatter={(_value, _name, item) => [fmtInt((item.payload as { count: number }).count), "minutes"]}
            labelFormatter={(_label, payload) => {
              const bin = payload?.[0]?.payload as { lower: number; upper: number } | undefined;
              return bin ? `${fmt(bin.lower, decimals)} to ${fmt(bin.upper, decimals)}` : "";
            }}
          />
          <Bar dataKey="shown" fill={profile.unit === "basis points" ? OKABE.orange : OKABE.sky} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
      <p className="text-[10px] text-neutral-500">
        drawn {fmt(profile.rangeLow, decimals)} to {fmt(profile.rangeHigh, decimals)} (0.5th to 99.5th percentile); outside: {fmtInt(profile.belowRange)} below, {fmtInt(profile.aboveRange)} above
      </p>
      <dl className="mt-1 grid grid-cols-3 gap-x-2 text-[10px] font-mono tnum">
        <dt className="col-span-3 text-neutral-500">n {fmtInt(profile.summary.count)}</dt>
        {SUMMARY.map(([key, label]) => (
          <div key={key} className="flex justify-between gap-1">
            <span className="text-neutral-500">{label}</span>
            <span className="text-neutral-200">{fmt(profile.summary[key] as number | null, key === "skewness" || key === "excess_kurtosis" ? 2 : decimals)}</span>
          </div>
        ))}
      </dl>
    </div>
  );
}

function monthsOf(rows: readonly DailyRow[]): Array<{ month: string; minutes: number }> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const month = new Date(row.date).toISOString().slice(0, 7);
    totals.set(month, (totals.get(month) ?? 0) + row.minute_count);
  }
  return [...totals.entries()].map(([month, minutes]) => ({ month, minutes }));
}

function TimestampPanel({ rows, first, last }: { rows: readonly DailyRow[]; first: number | null; last: number | null }) {
  const months = monthsOf(rows);
  return (
    <div className="min-w-0 rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
      <div className="mb-1 truncate text-[11px] font-medium text-neutral-200">timestamp <span className="font-normal text-neutral-500">· one-minute bars per UTC month</span></div>
      <ResponsiveContainer width="100%" height={96}>
        <BarChart data={months} margin={{ top: 2, right: 2, left: 2, bottom: 0 }} barCategoryGap={0}>
          <XAxis dataKey="month" hide />
          <YAxis hide />
          <Tooltip {...TOOLTIP} formatter={(value) => [fmtInt(Number(value)), "minutes"]} />
          <Bar dataKey="minutes" fill={OKABE.sky} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
      <dl className="mt-1 grid grid-cols-2 gap-x-2 text-[10px] font-mono tnum">
        <div className="flex justify-between gap-1"><span className="text-neutral-500">first</span><span className="text-neutral-200">{first === null ? "—" : new Date(first).toISOString().slice(0, 16).replace("T", " ")}</span></div>
        <div className="flex justify-between gap-1"><span className="text-neutral-500">last</span><span className="text-neutral-200">{last === null ? "—" : new Date(last).toISOString().slice(0, 16).replace("T", " ")}</span></div>
        <div className="flex justify-between gap-1"><span className="text-neutral-500">months</span><span className="text-neutral-200">{months.length}</span></div>
        <div className="flex justify-between gap-1"><span className="text-neutral-500">mean per month</span><span className="text-neutral-200">{fmtInt(months.reduce((total, month) => total + month.minutes, 0) / Math.max(1, months.length))}</span></div>
      </dl>
    </div>
  );
}

export function MinuteColumns({
  profiles, bins, onBins, rows, first, last, pending,
}: {
  profiles: readonly ColumnProfile[];
  bins: number;
  onBins: (bins: number) => void;
  rows: readonly DailyRow[];
  first: number | null;
  last: number | null;
  pending: boolean;
}) {
  const [logScale, setLogScale] = useState(false);
  const [order, setOrder] = useState<"frame" | "spread">("frame");
  const shown = [...profiles];
  if (order === "spread") shown.sort((a, b) => (b.summary.standard_deviation ?? 0) / Math.max(Math.abs(b.summary.mean ?? 1), 1e-9) - (a.summary.standard_deviation ?? 0) / Math.max(Math.abs(a.summary.mean ?? 1), 1e-9));
  return (
    <div className="space-y-2">
      <ControlBar>
        <span className="self-center text-xs font-semibold text-neutral-200">Every column of the one-minute frame</span>
        <SliderControl label="Bins" value={bins} min={10} max={100} onChange={onBins} hint="Re-bins in the lake: the statistics and histograms are computed there" />
        <SwitchControl label="Log counts" checked={logScale} onChange={setLogScale} />
        <SwitchControl label="Sort by relative spread" checked={order === "spread"} onChange={(checked) => setOrder(checked ? "spread" : "frame")} />
        {pending && <span className="self-center text-[11px] text-neutral-500">re-binning…</span>}
      </ControlBar>
      <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(210px,1fr))]">
        <TimestampPanel rows={rows} first={first} last={last} />
        {shown.map((profile) => (
          <Panel key={profile.column} profile={profile} logScale={logScale} />
        ))}
      </div>
    </div>
  );
}

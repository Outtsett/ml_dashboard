/**
 * Section 8: one histogram per market-vector column and per shape number of
 * the last two candles, over every window of the chosen timeframe, with the
 * eight numbers beside them. Bins and statistics are computed in the lake
 * (the notebook's 0.1-99.9 percentile clip, population skewness and excess
 * kurtosis); the counts can be logged to see the tails.
 */

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  ControlBar, Empty, Finding, OKABE, Section, SliderControl, StudyNotes, StudyState, SwitchControl, TOOLTIP, fmt, fmtInt, useStudyQuery,
} from "@/studies/kit";
import type { ColumnProfile, ColumnsBody } from "@shared/studies/candle-vectors";
import { DataTable } from "./charts";
import type { TabProps } from "./controls";

function Panel({ profile, logCounts }: { profile: ColumnProfile; logCounts: boolean }) {
  const data = profile.bins.map((bin) => ({ ...bin, middle: (bin.lower + bin.upper) / 2, shown: logCounts ? Math.log10(bin.count + 1) : bin.count }));
  return (
    <div className="min-w-0 rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
      <div className="mb-1 truncate text-[11px] font-medium text-neutral-200" title={profile.column_name}>{profile.column_name}</div>
      <ResponsiveContainer width="100%" height={100}>
        <BarChart data={data} margin={{ top: 2, right: 2, left: 2, bottom: 0 }} barCategoryGap={0}>
          <XAxis dataKey="middle" hide />
          <YAxis hide />
          <Tooltip {...TOOLTIP}
            formatter={(_value, _name, item) => [fmtInt((item.payload as { count: number }).count), "windows"]}
            labelFormatter={(_label, payload) => {
              const bin = payload?.[0]?.payload as { lower: number; upper: number } | undefined;
              return bin ? `${fmt(bin.lower, 4)} to ${fmt(bin.upper, 4)}` : "";
            }} />
          <Bar dataKey="shown" fill={OKABE.sky} stroke="#333" strokeWidth={0.2} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
      <div className="flex justify-between text-[10px] font-mono text-neutral-500">
        <span>{fmt(profile.bins[0]?.lower, 2)}</span>
        <span>{logCounts ? "log₁₀(count + 1)" : "count"}</span>
        <span>{fmt(profile.bins[profile.bins.length - 1]?.upper, 2)}</span>
      </div>
    </div>
  );
}

export function ColumnsTab({ controls, set }: TabProps) {
  const query = useStudyQuery<ColumnsBody>("candle-vectors", { section: "columns", timeframe: controls.timeframe, bins: controls.bins });
  const body = query.data?.data;
  const profiles = body?.profiles ?? [];
  return (
    <StudyState isLoading={query.isLoading} error={query.error}>
      <StudyNotes notes={query.data?.notes ?? []} />
      <Section title="8 · Every column, seen" question={`${controls.timeframe}: ${fmtInt(body?.totalRows ?? 0)} windows${body?.sampledRows ? `, ${fmtInt(body.sampledRows)} sampled` : ""}. Each histogram spans its column's 0.1th to 99.9th percentile; values beyond sit in the edge bins.`}>
        <ControlBar>
          <SwitchControl label="Log-scale the counts" checked={controls.logCounts} onChange={(v) => set("logCounts", v)} />
          <SliderControl label="Bins" value={controls.bins} min={10} max={80} step={5} onChange={(v) => set("bins", v)} />
        </ControlBar>
        {!body?.landed ? <Empty>The candle windows for this timeframe are not in the lake.</Empty> : (
          <>
            <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(200px,1fr))]">
              {profiles.map((profile) => <Panel key={profile.column_name} profile={profile} logCounts={controls.logCounts} />)}
            </div>
            <Finding>
              The shape numbers of the last candle close at exactly zero by construction (every price is measured from that close), so its close
              panel is a spike. The eleven market columns carry the state the section 4 market vector compares; the time-of-day pair is a circle,
              which is why its histograms pile at the ends.
            </Finding>
            <DataTable pageSize={20} rows={profiles.map(({ bins: _bins, ...stats }) => stats)}
              columns={["column_name", "count", "mean", "median", "standard_deviation", "skewness", "excess_kurtosis", "percentile_25", "percentile_75", "minimum", "maximum"].map((key) => ({ key }))} />
          </>
        )}
      </Section>
    </StudyState>
  );
}

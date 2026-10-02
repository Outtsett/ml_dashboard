/**
 * Every column of every frame the notebook builds, each as its own histogram with its eight
 * numbers. The bar frame has 78,615 rows, so the server profiles it exactly (all rows, the
 * notebook's moment conventions) and sends a fine histogram per column; the bins slider
 * re-bins it here, the log switch rescales the counts, the filter and sort reorder the panels.
 */

import { useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ControlBar, OKABE, Section, SegmentControl, SliderControl, StudyNotes, StudyState, SwitchControl, TOOLTIP, fmt, fmtInt } from "@/studies/kit";
import type { ColumnProfile, ColumnsBody } from "@shared/studies/mnq-eda-30m";
import { sci } from "./format";
import { useSection, type SeriesChoice } from "./use";

/** Re-bin fine equal-width counts into `target` bins by proportional allocation. */
export function rebin(counts: readonly number[], target: number): number[] {
  const fine = counts.length;
  const out = new Array<number>(target).fill(0);
  for (let index = 0; index < fine; index += 1) {
    const from = (index / fine) * target;
    const to = ((index + 1) / fine) * target;
    let slot = Math.floor(from);
    let cursor = from;
    while (cursor < to - 1e-12 && slot < target) {
      const edge = Math.min(to, slot + 1);
      out[slot] = (out[slot] as number) + (counts[index] as number) * ((edge - cursor) / (to - from));
      cursor = edge;
      slot += 1;
    }
  }
  return out;
}

const SUMMARY_KEYS: Array<[keyof ColumnProfile["moments"], string]> = [
  ["mean", "mean"], ["median", "median"], ["standardDeviation", "sd"], ["skewness", "skew"],
  ["kurtosis", "kurt"], ["percentile25", "p25"], ["percentile75", "p75"], ["minimum", "min"], ["maximum", "max"],
];

function Panel({ profile, bins, logScale }: { profile: ColumnProfile; bins: number; logScale: boolean }) {
  const counts = rebin(profile.histogram.counts, bins);
  const width = (profile.histogram.upper - profile.histogram.lower) / bins;
  const data = counts.map((count, index) => ({
    middle: profile.histogram.lower + (index + 0.5) * width,
    shown: logScale ? Math.log10(count + 1) : count,
    count,
    lower: profile.histogram.lower + index * width,
    upper: profile.histogram.lower + (index + 1) * width,
  }));
  return (
    <div className="min-w-0 rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
      <div className="truncate text-[11px] font-medium text-neutral-200" title={profile.name}>{profile.name}</div>
      <div className="truncate text-[9px] text-neutral-500" title={profile.unit}>{profile.unit}</div>
      <ResponsiveContainer width="100%" height={90}>
        <BarChart data={data} margin={{ top: 2, right: 2, left: 2, bottom: 0 }} barCategoryGap={0}>
          <XAxis dataKey="middle" hide />
          <YAxis hide />
          <Tooltip
            {...TOOLTIP}
            formatter={(_value, _name, item) => [fmtInt((item.payload as { count: number }).count), "rows"]}
            labelFormatter={(_label, payload) => {
              const bin = payload?.[0]?.payload as { lower: number; upper: number } | undefined;
              return bin ? `${sci(bin.lower, 4)} to ${sci(bin.upper, 4)}` : "";
            }}
          />
          <Bar dataKey="shown" fill={OKABE.sky} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
      <dl className="mt-1 grid grid-cols-3 gap-x-2 text-[10px] font-mono tnum">
        <dt className="col-span-3 text-neutral-500">n {fmtInt(profile.moments.count)}</dt>
        {SUMMARY_KEYS.map(([key, label]) => (
          <div key={key} className="flex justify-between gap-1">
            <span className="text-neutral-500">{label}</span>
            <span className="text-neutral-200">{sci(profile.moments[key] as number | null, 3)}</span>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function ColumnProfiles({ choice }: { choice: SeriesChoice }) {
  const { query, notes, body, unavailable } = useSection<ColumnsBody>("columns", choice);
  const [bins, setBins] = useState(40);
  const [logScale, setLogScale] = useState(false);
  const [filter, setFilter] = useState("");
  const [order, setOrder] = useState<"frame" | "name" | "spread">("frame");
  const [group, setGroup] = useState("all");

  const columns = body?.columns ?? [];
  const groups = ["all", ...new Set(columns.map((column) => column.group))];
  const shown = columns
    .filter((column) => group === "all" || column.group === group)
    .filter((column) => column.name.toLowerCase().includes(filter.toLowerCase()));
  if (order === "name") shown.sort((a, b) => a.name.localeCompare(b.name));
  if (order === "spread") {
    const relative = (column: ColumnProfile) => Math.abs((column.moments.standardDeviation ?? 0) / (Math.abs(column.moments.mean ?? 0) + 1e-12));
    shown.sort((a, b) => relative(b) - relative(a));
  }

  return (
    <Section title="11 · Every column" question="Each column of each frame the notebook builds, drawn and summarised: nothing is described without being seen.">
      <div className="space-y-2">
        <ControlBar>
          <SliderControl label="Bins" value={bins} min={5} max={120} onChange={setBins} />
          <SwitchControl label="Log counts" checked={logScale} onChange={setLogScale} />
          <SegmentControl label="Order" value={order} options={[{ value: "frame", label: "frame" }, { value: "name", label: "name" }, { value: "spread", label: "spread" }]} onChange={setOrder} hint="Spread is the standard deviation over the absolute mean" />
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-neutral-500">Frame</span>
            <select value={group} onChange={(event) => setGroup(event.target.value)} className="h-7 rounded border border-neutral-700 bg-neutral-950 px-2 text-xs text-neutral-200">
              {groups.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-neutral-500">Filter</span>
            <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="column name" className="h-7 w-40 rounded border border-neutral-700 bg-neutral-950 px-2 text-xs text-neutral-200" />
          </label>
        </ControlBar>
        <StudyState isLoading={query.isLoading} error={query.error}>
          <StudyNotes notes={notes} />
          {unavailable || !body ? (
            <p className="text-xs text-neutral-500">The bars are not in the lake for this selection.</p>
          ) : shown.length === 0 ? (
            <p className="text-xs text-neutral-500">No column matches.</p>
          ) : (
            <>
              <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(200px,1fr))]">
                {shown.map((column) => (
                  <Panel key={column.name} profile={column} bins={bins} logScale={logScale} />
                ))}
              </div>
              <p className="text-[10px] text-neutral-500">
                Exact over every row ({fmt(columns[0]?.moments.count ?? 0, 0)} in the bar frame), in the notebook&apos;s conventions (population standard deviation, moment skewness and excess kurtosis). The histogram spans the 0.5th to the 99.5th percentile and its two edge bins absorb the tails; the eight numbers do not.
              </p>
            </>
          )}
        </StudyState>
      </div>
    </Section>
  );
}

/**
 * Unclean shutdowns: the hours between consecutive hard resets. The eight
 * numbers, a histogram over the whole range (the outliers stay in), and the
 * gap formula stepped one index at a time.
 */

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AXIS, ControlBar, Finding, FormulaCard, GRID, OKABE, Section, SliderControl, Stat, SummaryTable, SwitchControl, TOOLTIP,
  eightNumberSummary, fmt, fmtInt, fmtTime,
} from "@/studies/kit";
import { fullRangeBins, gapHours, logHours, type ShutdownSection as ShutdownBody } from "@shared/studies/machine-health";

export function ShutdownSection({
  shutdowns, gapBins, gapLog, onBins, onLog,
}: {
  shutdowns: ShutdownBody;
  gapBins: number;
  gapLog: boolean;
  onBins: (value: number) => void;
  onLog: (value: boolean) => void;
}) {
  const [step, setStep] = useState(1);
  const sorted = [...shutdowns.localTimes].sort((a, b) => a - b);
  const gaps = gapHours(sorted);
  const summary = eightNumberSummary(gaps);
  const plotted = gapLog ? gaps.map(logHours) : gaps;
  const bins = fullRangeBins(plotted, gapBins).map((bin) => ({ ...bin, middle: (bin.lower + bin.upper) / 2 }));
  const axisName = gapLog ? "log10 of hours between unclean shutdowns" : "hours between unclean shutdowns";

  const k = Math.min(Math.max(1, step), Math.max(1, gaps.length));
  const current = gaps[k - 1];
  const later = sorted[k];
  const earlier = sorted[k - 1];

  return (
    <Section
      title={`Unclean shutdowns: ${fmtInt(shutdowns.uncleanShutdownCount)} since ${shutdowns.firstEventDay ?? "the first event"}`}
      question="How long does the machine run between resets that left no crash screen?"
    >
      <div className="space-y-3">
        <Finding>
          hard_reset_without_bugcheck is Kernel-Power 41 with bugcheck code 0: the machine reset with no crash screen and no dump. That signature points at
          hardware (memory timing, power), not software. The distribution below is the time between consecutive unclean shutdowns.
        </Finding>
        <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
          <Stat label="Unclean shutdowns" value={fmtInt(shutdowns.uncleanShutdownCount)} tone={OKABE.vermillion} hint="hard_reset_without_bugcheck plus unclean_shutdown_after_bugcheck" />
          <Stat label="Gaps between them" value={fmtInt(gaps.length)} />
          <Stat label="Median gap" value={`${fmt(summary.median, 1)} hours`} />
          <Stat label="Longest gap" value={`${fmt(summary.maximum, 1)} hours`} />
        </div>
        <div className="overflow-x-auto">
          <SummaryTable columns={[{ name: "hours between unclean shutdowns", summary, decimals: 1 }]} />
        </div>
        <ControlBar>
          <SliderControl label="Histogram bins" value={gapBins} min={5} max={60} onChange={onBins} />
          <SwitchControl label="Logarithmic hours axis" checked={gapLog} onChange={onLog} />
        </ControlBar>
        {bins.length === 0 ? (
          <p className="py-6 text-center text-xs text-neutral-500">Fewer than two unclean shutdowns, so there is no gap to plot.</p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={bins} margin={{ top: 8, right: 16, left: 4, bottom: 18 }} barCategoryGap={1}>
              <CartesianGrid {...GRID} vertical={false} />
              <XAxis
                dataKey="middle"
                type="number"
                domain={["dataMin", "dataMax"]}
                tickFormatter={(value: number) => fmt(value, gapLog ? 2 : 1)}
                label={{ value: axisName, position: "insideBottom", offset: -10, fill: "#a3a3a3", fontSize: 10 }}
                {...AXIS}
              />
              <YAxis allowDecimals={false} width={40} {...AXIS} label={{ value: "shutdown count", angle: -90, position: "insideLeft", fill: "#a3a3a3", fontSize: 10 }} />
              <Tooltip
                {...TOOLTIP}
                formatter={(value: number) => [fmtInt(value), "shutdowns"]}
                labelFormatter={(_, payload) => {
                  const bin = payload?.[0]?.payload as { lower: number; upper: number } | undefined;
                  return bin ? `${fmt(bin.lower, 2)} to ${fmt(bin.upper, 2)}` : "";
                }}
              />
              <Bar dataKey="count" fill={OKABE.blue} stroke="#e5e5e5" strokeWidth={0.5} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        )}

        {gaps.length > 0 && (
          <div className="space-y-2">
            <ControlBar>
              <SliderControl label="Gap index k" value={k} min={1} max={gaps.length} onChange={setStep} hint="Step through the gaps one at a time" />
            </ControlBar>
            <FormulaCard
              tex={String.raw`\Delta_k = \frac{t_{(k)} - t_{(k-1)}}{3600\ \mathrm{s}}` + (gapLog ? String.raw`,\quad x_k = \log_{10}\max(\Delta_k,\, 0.01)` : "")}
              caption="The hours between consecutive unclean shutdowns, from the sorted local times."
              symbols={[
                { tex: String.raw`\Delta_k`, name: "hours between the k-th and the previous unclean shutdown", value: `${fmt(current, 2)} hours` },
                { tex: String.raw`t_{(k)}`, name: "local time of the (k+1)-th unclean shutdown, sorted oldest first", value: fmtTime(later) },
                { tex: String.raw`t_{(k-1)}`, name: "local time of the k-th unclean shutdown, sorted oldest first", value: fmtTime(earlier) },
                { tex: String.raw`k`, name: "gap index, from 1 to the number of gaps", value: `${k} of ${gaps.length}` },
                { tex: "3600", name: "seconds in one hour", value: "3,600 s" },
                ...(gapLog
                  ? [{ tex: String.raw`x_k`, name: "the value plotted on the logarithmic axis (hours floored at 0.01 first)", value: fmt(current === undefined ? null : logHours(current), 3) }]
                  : []),
              ]}
            />
          </div>
        )}
      </div>
    </Section>
  );
}

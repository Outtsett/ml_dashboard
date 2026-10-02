/**
 * Section 9: direction-label balance. generate_direction_labels for the notebook's five
 * configurations and for any horizon and flat threshold: up, down, flat, the share that is up
 * and the accuracy of always naming the commoner class (the baseline a classifier has to beat,
 * 50 % only by coincidence). The notebook's thresholds in points (5, 10, 20.5) came from the
 * daily model; the |change| quantiles show where they sit at this bar size.
 */

import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, ControlBar, Finding, FormulaCard, GRID, OKABE, Section, SliderControl, Stat, StudyNotes, StudyState, TOOLTIP, fmt, fmtInt, fmtPercent, useStudyControls } from "@/studies/kit";
import type { LabelsBody } from "@shared/studies/mnq-eda-30m";
import { useSection, type SeriesChoice } from "./use";

export function LabelsSection({ choice }: { choice: SeriesChoice }) {
  const [controls, set, reset] = useStudyControls({ horizon: 1, flatThresholdPoints: 20.5 });
  const { query, notes, body, unavailable } = useSection<LabelsBody>("labels", choice, controls);

  const chosen = body?.configs.find((row) => row.horizon === body.horizon && row.flatThresholdPoints === body.flatThresholdPoints);
  const counts = chosen
    ? [
        { name: "▲ up (1)", value: chosen.up, fill: OKABE.orange },
        { name: "▼ down (0)", value: chosen.down, fill: OKABE.blue },
        { name: "– flat (dropped)", value: chosen.flat, fill: "#737373" },
      ]
    : [];
  const histogram = body
    ? body.deltaHistogram.up.map((up, index) => {
        const width = (body.deltaHistogram.upper - body.deltaHistogram.lower) / body.deltaHistogram.up.length;
        return { middle: body.deltaHistogram.lower + (index + 0.5) * width, up, down: body.deltaHistogram.down[index] as number, lower: body.deltaHistogram.lower + index * width, upper: body.deltaHistogram.lower + (index + 1) * width };
      })
    : [];
  const absolute = body?.absoluteDelta;

  return (
    <Section title="9 · Direction-label balance" question="How balanced are the up and down labels, and what accuracy does always naming the commoner class already give?">
      <div className="space-y-3">
        <ControlBar onReset={reset}>
          <SliderControl label="Horizon" value={controls.horizon} min={1} max={48} onChange={(v) => set("horizon", v)} format={(v) => `${v} bar${v === 1 ? "" : "s"}`} hint="Label = is close[i+H] above close[i]" />
          <SliderControl label="Flat zone" value={controls.flatThresholdPoints} min={0} max={100} step={0.25} onChange={(v) => set("flatThresholdPoints", v)} format={(v) => `${v.toFixed(2)} points`} hint="Changes smaller than this are dropped; the notebook used 0, 5, 10 and 20.5 (the daily model's winner)" />
        </ControlBar>
        <StudyState isLoading={query.isLoading} error={query.error}>
          <StudyNotes notes={notes} />
          {unavailable || !body || !chosen ? (
            <p className="text-xs text-neutral-500">The bars are not in the lake for this selection.</p>
          ) : (
            <>
              <div className="grid gap-2 grid-cols-2 xl:grid-cols-4">
                <Stat label="Usable rows" value={fmtInt(chosen.usable)} hint={`up + down; ${fmtInt(chosen.unavailable)} bars at the end have no label`} />
                <Stat label="Up share" value={fmtPercent(chosen.upShare, 2)} tone={OKABE.orange} />
                <Stat label="Always name the commoner class" value={fmtPercent(chosen.majorityBaseline, 2)} hint="the accuracy a classifier has to beat" tone={OKABE.blue} />
                <Stat label="Dropped as flat" value={fmtInt(chosen.flat)} hint={`${fmtPercent(absolute?.flatShareAtThreshold ?? null, 1)} of all changes at this horizon`} />
              </div>
              <Finding>
                At horizon {body.horizon} with a {fmt(body.flatThresholdPoints, 2)}-point flat zone, {fmtPercent(chosen.upShare, 2)} of the usable bars are up: a classifier has to beat {fmtPercent(chosen.majorityBaseline, 2)}, not 50 %. Half of all {body.horizon}-bar changes are smaller than {fmt(absolute?.median, 2)} points and three quarters smaller than {fmt(absolute?.percentile75, 2)}, so a {fmt(body.flatThresholdPoints, 2)}-point zone drops {fmtPercent(absolute?.flatShareAtThreshold ?? null, 0)} of the bars: the notebook&apos;s 20.5 points was the daily model&apos;s winner and is a wide zone at this bar size.
              </Finding>
              <div className="overflow-x-auto rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
                <table className="w-full text-[11px] font-mono tnum">
                  <thead>
                    <tr className="text-left text-neutral-500">
                      <th className="font-normal">horizon</th>
                      <th className="text-right font-normal">flat zone (points)</th>
                      <th className="text-right font-normal">up (1)</th>
                      <th className="text-right font-normal">down (0)</th>
                      <th className="text-right font-normal">flat</th>
                      <th className="text-right font-normal">usable</th>
                      <th className="text-right font-normal">up share</th>
                      <th className="text-right font-normal">majority baseline</th>
                      <th className="pl-3 font-normal">source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {body.configs.map((row) => {
                      const selected = row.horizon === body.horizon && row.flatThresholdPoints === body.flatThresholdPoints;
                      return (
                        <tr key={`${row.horizon}-${row.flatThresholdPoints}`} className={`border-t border-neutral-900 ${selected ? "bg-neutral-800/60" : ""}`}>
                          <td className="py-0.5 text-neutral-300">{selected ? "◆ " : ""}H = {row.horizon}</td>
                          <td className="text-right">{fmt(row.flatThresholdPoints, 2)}</td>
                          <td className="text-right text-neutral-100">{fmtInt(row.up)}</td>
                          <td className="text-right text-neutral-100">{fmtInt(row.down)}</td>
                          <td className="text-right">{fmtInt(row.flat)}</td>
                          <td className="text-right">{fmtInt(row.usable)}</td>
                          <td className="text-right">{fmtPercent(row.upShare, 2)}</td>
                          <td className="text-right">{fmtPercent(row.majorityBaseline, 2)}</td>
                          <td className="pl-3 font-sans text-neutral-500">{row.notebook ? "notebook" : "your choice"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="grid gap-3 xl:grid-cols-2">
                <div className="min-w-0 space-y-1">
                  <h4 className="text-xs font-semibold text-neutral-200">Label balance at the chosen horizon and flat zone</h4>
                  <ResponsiveContainer width="100%" height={230}>
                    <BarChart data={counts} margin={{ top: 18, right: 8, left: 0, bottom: 4 }}>
                      <CartesianGrid {...GRID} vertical={false} />
                      <XAxis dataKey="name" {...AXIS} />
                      <YAxis {...AXIS} width={52} tickFormatter={(v: number) => fmtInt(v)} />
                      <Tooltip {...TOOLTIP} formatter={(value: number) => [fmtInt(value), "bars"]} />
                      <Bar dataKey="value" isAnimationActive={false}>
                        {counts.map((entry) => (
                          <Cell key={entry.name} fill={entry.fill} />
                        ))}
                        <LabelList dataKey="value" position="top" fill="#e5e5e5" fontSize={10} formatter={(v: number) => fmtInt(v)} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="min-w-0 space-y-1">
                  <h4 className="text-xs font-semibold text-neutral-200">Close change in points, by label</h4>
                  <ResponsiveContainer width="100%" height={230}>
                    <BarChart data={histogram} margin={{ top: 18, right: 8, left: 0, bottom: 4 }} barCategoryGap={0}>
                      <defs>
                        <pattern id="mnq-down-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                          <rect width="5" height="5" fill={OKABE.blue} />
                          <line x1="0" y1="0" x2="0" y2="5" stroke="#000" strokeWidth="1.4" />
                        </pattern>
                      </defs>
                      <CartesianGrid {...GRID} vertical={false} />
                      <XAxis dataKey="middle" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(v: number) => fmt(v, 0)} {...AXIS} />
                      <YAxis {...AXIS} width={52} tickFormatter={(v: number) => fmtInt(v)} />
                      <Tooltip {...TOOLTIP} labelFormatter={(_l, payload) => { const row = payload?.[0]?.payload as { lower: number; upper: number } | undefined; return row ? `${fmt(row.lower, 1)} to ${fmt(row.upper, 1)} points` : ""; }} formatter={(value: number, name: string) => [fmtInt(value), name]} />
                      <Bar dataKey="down" name="▼ down (0), hatched" fill="url(#mnq-down-hatch)" isAnimationActive={false} />
                      <Bar dataKey="up" name="▲ up (1), solid" fill={OKABE.orange} fillOpacity={0.8} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                  <p className="text-[11px] text-neutral-400">40 bins between the 0.5th and 99.5th percentile of the kept changes ({fmtInt(body.deltaHistogram.outsideCount)} more lie beyond and are left out). Orange solid: up labels (change above zero). Blue hatched: down labels (zero or below).</p>
                </div>
              </div>
              <FormulaCard
                tex={String.raw`y_i=\begin{cases}1 & C_{i+H}-C_i>0\\ 0 & C_{i+H}-C_i\le 0\end{cases}\qquad \text{dropped if } \left|C_{i+H}-C_i\right|<\theta`}
                caption="The label of bar i; the last H bars have none. With θ = 0 a change of exactly zero counts as down."
                symbols={[
                  { tex: "C_i", name: "close of bar i, index points", value: "from the bars" },
                  { tex: "H", name: "horizon in bars", value: fmtInt(body.horizon) },
                  { tex: String.raw`\theta`, name: "flat zone half-width, points", value: fmt(body.flatThresholdPoints, 2) },
                  { tex: String.raw`\Pr(y=1)`, name: "up share of the kept bars", value: fmtPercent(chosen.upShare, 2) },
                  { tex: String.raw`\max(p,1-p)`, name: "accuracy of always naming the commoner class", value: fmtPercent(chosen.majorityBaseline, 2) },
                ]}
              />
            </>
          )}
        </StudyState>
      </div>
    </Section>
  );
}

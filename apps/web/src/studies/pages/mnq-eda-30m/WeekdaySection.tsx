/**
 * Section 7: day-of-week. Mean and standard deviation of the bar return by the weekday of the
 * bar, and the Kruskal-Wallis test. The lake stamps futures in Pacific wall clock, so a
 * "Friday" ends at 14:00 (9,402 bars against 15,000 to 16,000 for a Monday to Thursday) and
 * the Sunday-evening open has its own bars; the notebook's test silently dropped Sunday. The
 * trading-session basis assigns each bar to the session it belongs to instead.
 */

import { Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, ControlBar, Finding, FormulaCard, GRID, OKABE, Section, SegmentControl, Stat, StudyNotes, StudyState, TOOLTIP, fmt, fmtInt, useStudyControls } from "@/studies/kit";
import type { KruskalResult, WeekdayBody } from "@shared/studies/mnq-eda-30m";
import { pText, sci, signed } from "./format";
import { useSection, type SeriesChoice } from "./use";

function verdict(result: KruskalResult): string {
  if (result.pValue === null) return "no test";
  return result.pValue < 0.05 ? "a weekday effect at 5 %" : "no weekday effect at 5 %";
}

export function WeekdaySection({ choice }: { choice: SeriesChoice }) {
  const [controls, set, reset] = useStudyControls({ dayBasis: "calendar" });
  const { query, notes, body, unavailable } = useSection<WeekdayBody>("weekday", choice, controls);

  const rows = (body?.rows ?? []).map((row) => ({ ...row, meanBasisPoints: (row.meanPercent ?? 0) * 100, glyph: (row.mean ?? 0) >= 0 ? "▲" : "▼" }));
  const weekdays = body?.kruskalWeekdays;

  return (
    <Section title="7 · Day-of-week seasonality" question="Does a Monday bar behave differently from a Friday bar?">
      <div className="space-y-3">
        <ControlBar onReset={reset}>
          <SegmentControl label="Group bars by" value={controls.dayBasis} options={[{ value: "calendar", label: "calendar day (notebook)" }, { value: "session", label: "trading session" }]} onChange={(v) => set("dayBasis", v)} hint="Calendar: the weekday of the bar's own stamp. Session: a futures session opens at 15:00 the evening before, so Sunday evening belongs to Monday" />
        </ControlBar>
        <StudyState isLoading={query.isLoading} error={query.error}>
          <StudyNotes notes={notes} />
          {unavailable || !body || !weekdays ? (
            <p className="text-xs text-neutral-500">The bars are not in the lake for this selection.</p>
          ) : (
            <>
              <div className="grid gap-2 grid-cols-2 xl:grid-cols-4">
                <Stat label="Kruskal-Wallis H (Mon-Fri)" value={fmt(weekdays.h, 3)} hint={`${weekdays.degreesOfFreedom} degrees of freedom, ${fmtInt(weekdays.observationCount)} returns`} />
                <Stat label="p-value (Mon-Fri)" value={pText(weekdays.pValue)} tone={weekdays.pValue !== null && weekdays.pValue < 0.05 ? OKABE.orange : OKABE.blue} />
                <Stat label="H including every day present" value={fmt(body.kruskalAllDays.h, 3)} hint={`${body.kruskalAllDays.groupCount} groups`} />
                <Stat label="p-value, every day" value={pText(body.kruskalAllDays.pValue)} />
              </div>
              <Finding>
                Mon-Fri: H = {fmt(weekdays.h, 3)}, p = {pText(weekdays.pValue)}: {verdict(weekdays)}. The largest weekday mean is {sci(Math.max(...rows.filter((r) => r.dayIndex >= 1 && r.dayIndex <= 5).map((r) => Math.abs(r.mean ?? 0))), 2)} of a return against a standard deviation near {sci(rows.find((r) => r.dayIndex === 2)?.standardDeviation, 2)}: the differences are a small fraction of one standard deviation per bar.
                {body.dayBasis === "calendar" ? " In the calendar basis Friday stops at 14:00 and Sunday holds the evening open, so counts differ by design, and the notebook left Sunday out; the second test adds it." : " In the session basis every bar sits in the session it belongs to, so there is no Sunday group."}
              </Finding>
              <div className="grid gap-3 xl:grid-cols-2">
                <div className="min-w-0 space-y-1">
                  <h4 className="text-xs font-semibold text-neutral-200">Mean return by weekday, basis points (1 bp = 0.01 %)</h4>
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={rows} margin={{ top: 18, right: 8, left: 0, bottom: 4 }}>
                      <CartesianGrid {...GRID} vertical={false} />
                      <XAxis dataKey="day" interval={0} {...AXIS} />
                      <YAxis {...AXIS} width={48} tickFormatter={(v: number) => fmt(v, 2)} />
                      <Tooltip {...TOOLTIP} formatter={(value: number) => [`${signed(value, 3)} bp`, "mean"]} />
                      <ReferenceLine y={0} stroke="#737373" />
                      <Bar dataKey="meanBasisPoints" isAnimationActive={false}>
                        {rows.map((row) => (
                          <Cell key={row.day} fill={(row.mean ?? 0) >= 0 ? OKABE.orange : OKABE.blue} />
                        ))}
                        <LabelList dataKey="glyph" position="top" fill="#e5e5e5" fontSize={11} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="min-w-0 space-y-1">
                  <h4 className="text-xs font-semibold text-neutral-200">Standard deviation of the return by weekday, percent</h4>
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={rows} margin={{ top: 18, right: 8, left: 0, bottom: 4 }}>
                      <CartesianGrid {...GRID} vertical={false} />
                      <XAxis dataKey="day" interval={0} {...AXIS} />
                      <YAxis {...AXIS} width={48} tickFormatter={(v: number) => fmt(v, 2)} />
                      <Tooltip {...TOOLTIP} formatter={(value: number) => [`${fmt(value, 4)} %`, "standard deviation"]} />
                      <Bar dataKey="standardDeviationPercent" fill={OKABE.sky} isAnimationActive={false}>
                        <LabelList dataKey="standardDeviationPercent" position="top" fill="#e5e5e5" fontSize={10} formatter={(v: number) => fmt(v, 3)} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="grid gap-3 xl:grid-cols-2">
                <div className="min-w-0 overflow-x-auto rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
                  <table className="w-full text-[11px] font-mono tnum">
                    <thead>
                      <tr className="text-left text-neutral-500">
                        <th className="font-normal">day</th>
                        <th className="text-right font-normal">mean</th>
                        <th className="text-right font-normal">std (sample)</th>
                        <th className="text-right font-normal">count</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.day} className="border-t border-neutral-900">
                          <td className="py-0.5 text-neutral-300">{row.day}</td>
                          <td className="text-right text-neutral-100">{row.glyph} {sci(row.mean, 4)}</td>
                          <td className="text-right">{sci(row.standardDeviation, 4)}</td>
                          <td className="text-right">{fmtInt(row.count)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <FormulaCard
                  tex={String.raw`H=\frac{1}{C}\left[\frac{12}{N(N+1)}\sum_{j=1}^{k}\frac{R_j^{2}}{n_j}-3(N+1)\right]`}
                  caption="Kruskal-Wallis on the ranks of the returns; H is compared with a chi-square distribution with k − 1 degrees of freedom. C corrects for tied values (prices move in quarter-point steps, so returns repeat)."
                  symbols={[
                    { tex: "k", name: "number of weekday groups", value: fmtInt(weekdays.groupCount) },
                    { tex: "N", name: "returns in all groups", value: fmtInt(weekdays.observationCount) },
                    { tex: "n_j", name: "returns in group j", value: rows.filter((r) => r.dayIndex >= 1 && r.dayIndex <= 5).map((r) => fmtInt(r.count)).join(", ") },
                    { tex: "R_j", name: "sum of the ranks in group j", value: "from the pooled ranking" },
                    { tex: "C", name: "tie correction, 1 − Σ(tᵢ³ − tᵢ) / (N³ − N)", value: "from the ties" },
                    { tex: "H", name: "the statistic", value: fmt(weekdays.h, 3) },
                  ]}
                />
              </div>
            </>
          )}
        </StudyState>
      </div>
    </Section>
  );
}

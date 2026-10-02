/**
 * Section 6: volatility clustering. Close price over rolling annualised realised volatility
 * (5-day and 21-day windows in the notebook). The notebook hardcoded 48 bars per day; MNQ
 * trades about 23 hours, so the page shows the measured number and lets the reader switch the
 * annualisation to it. The 75th-percentile "high volatility" line the notebook computed but
 * never drew is on the chart.
 */

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, ControlBar, Finding, FormulaCard, GRID, OKABE, Section, SegmentControl, SliderControl, Stat, StudyNotes, StudyState, TOOLTIP, fmt, fmtInt, fmtPercent, useStudyControls } from "@/studies/kit";
import type { VolatilityBody } from "@shared/studies/mnq-eda-30m";
import { yearMonth } from "./format";
import { useSection, type SeriesChoice } from "./use";

export function VolatilitySection({ choice }: { choice: SeriesChoice }) {
  const [controls, set, reset] = useStudyControls({
    shortWindowDays: 5, longWindowDays: 21, barsPerDayBasis: "nominal", annualisationDays: 252, highVolatilityPercentile: 0.75,
  });
  const { query, notes, body, unavailable } = useSection<VolatilityBody>("volatility", choice, controls);

  const rows = body
    ? body.series.time.map((time, index) => ({ time, close: body.series.close[index] as number, short: body.series.short[index] as number | null, long: body.series.long[index] as number | null }))
    : [];
  const highShare = body && body.barCount > 0 ? body.highVolatilityBarCount / body.barCount : null;

  return (
    <Section title="6 · Volatility clustering" question="Big moves cluster: how does realised volatility move through the history, and how often is it high?">
      <div className="space-y-3">
        <ControlBar onReset={reset}>
          <SliderControl label="Short window" value={controls.shortWindowDays} min={1} max={30} onChange={(v) => set("shortWindowDays", v)} format={(v) => `${v} days`} />
          <SliderControl label="Long window" value={controls.longWindowDays} min={2} max={120} onChange={(v) => set("longWindowDays", v)} format={(v) => `${v} days`} />
          <SegmentControl label="Bars per day" value={controls.barsPerDayBasis} options={[{ value: "nominal", label: "24 h ÷ bar (notebook)" }, { value: "measured", label: "measured" }]} onChange={(v) => set("barsPerDayBasis", v)} hint="The notebook hardcoded 48 bars at 30 minutes; the measured median is the number of bars actually stamped on a calendar day" />
          <SegmentControl label="Days a year" value={controls.annualisationDays} options={[{ value: 252, label: "252" }, { value: 260, label: "260" }, { value: 365, label: "365" }]} onChange={(v) => set("annualisationDays", v)} />
          <SliderControl label="High-volatility percentile" value={controls.highVolatilityPercentile} min={0.5} max={0.99} step={0.01} onChange={(v) => set("highVolatilityPercentile", v)} format={(v) => `${(v * 100).toFixed(0)}th`} />
        </ControlBar>
        <StudyState isLoading={query.isLoading} error={query.error}>
          <StudyNotes notes={notes} />
          {unavailable || !body ? (
            <p className="text-xs text-neutral-500">The bars are not in the lake for this selection.</p>
          ) : (
            <>
              <div className="grid gap-2 grid-cols-2 xl:grid-cols-4">
                <Stat label="Overall annualised volatility" value={`${fmt(body.overallAnnualisedPercent, 1)} %`} />
                <Stat label={`${(body.highVolatilityPercentile * 100).toFixed(0)}th percentile of the ${body.shortWindowDays}-day line`} value={`${fmt(body.highVolatilityThresholdPercent, 1)} %`} />
                <Stat label="Bars above it" value={`${fmtInt(body.highVolatilityBarCount)} of ${fmtInt(body.barCount)}`} hint={`${fmtPercent(highShare, 1)}; the unwarmed first ${body.shortWindowDays} days cannot count`} />
                <Stat label="Latest 5-day / 21-day" value={`${fmt(body.shortLastPercent, 1)} / ${fmt(body.longLastPercent, 1)} %`} hint="the short and long window at the newest bar" />
              </div>
              <Finding>
                The notebook annualised with {body.nominalBarsPerDay} bars a day; the bars are in fact stamped on {body.measuredBarsPerDay !== null ? fmt(body.measuredBarsPerDay, 0) : "—"} per calendar day at the median (MNQ trades about 23 hours). Using {body.barsPerDayUsed} moves every volatility by a factor of √({body.barsPerDayUsed} / {body.nominalBarsPerDay}) = {fmt(Math.sqrt(body.barsPerDayUsed / body.nominalBarsPerDay), 3)}. The short line spends {fmtPercent(highShare, 1)} of the history above its own {(body.highVolatilityPercentile * 100).toFixed(0)}th percentile, in runs rather than scattered: that is the clustering.
              </Finding>
              <div className="min-w-0 space-y-1">
                <h4 className="text-xs font-semibold text-neutral-200">Close price</h4>
                <ResponsiveContainer width="100%" height={170}>
                  <LineChart data={rows} syncId="mnq-volatility" margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid {...GRID} vertical={false} />
                    <XAxis dataKey="time" type="number" domain={["dataMin", "dataMax"]} tickFormatter={yearMonth} {...AXIS} hide />
                    <YAxis {...AXIS} width={48} domain={["auto", "auto"]} tickFormatter={(v: number) => fmt(v, 0)} />
                    <Tooltip {...TOOLTIP} labelFormatter={(time: number) => new Date(time * 1000).toISOString().slice(0, 16).replace("T", " ")} formatter={(value: number) => [fmt(value, 2), "close"]} />
                    <Line dataKey="close" stroke={OKABE.sky} strokeWidth={1.3} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
                <h4 className="text-xs font-semibold text-neutral-200">Rolling realised volatility, annualised percent</h4>
                <ResponsiveContainer width="100%" height={230}>
                  <LineChart data={rows} syncId="mnq-volatility" margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                    <CartesianGrid {...GRID} vertical={false} />
                    <XAxis dataKey="time" type="number" domain={["dataMin", "dataMax"]} tickFormatter={yearMonth} {...AXIS} />
                    <YAxis {...AXIS} width={48} tickFormatter={(v: number) => `${fmt(v, 0)}`} />
                    <Tooltip {...TOOLTIP} labelFormatter={(time: number) => new Date(time * 1000).toISOString().slice(0, 16).replace("T", " ")} formatter={(value: number, name: string) => [`${fmt(value, 2)} %`, name]} />
                    {body.highVolatilityThresholdPercent !== null && (
                      <ReferenceLine y={body.highVolatilityThresholdPercent} stroke={OKABE.yellow} strokeDasharray="4 3" label={{ value: `${(body.highVolatilityPercentile * 100).toFixed(0)}th percentile of the ${body.shortWindowDays}-day line`, fill: OKABE.yellow, fontSize: 9, position: "insideTopRight" }} />
                    )}
                    <Line dataKey="short" name={`${body.shortWindowDays}-day ─`} stroke={OKABE.orange} strokeWidth={1.6} dot={false} isAnimationActive={false} connectNulls={false} />
                    <Line dataKey="long" name={`${body.longWindowDays}-day - -`} stroke={OKABE.blue} strokeWidth={2} strokeDasharray="7 4" dot={false} isAnimationActive={false} connectNulls={false} />
                  </LineChart>
                </ResponsiveContainer>
                <p className="text-[11px] text-neutral-400">
                  Solid orange: {body.shortWindowDays}-day window ({body.shortWindowDays * body.barsPerDayUsed} bars). Dashed blue: {body.longWindowDays}-day window ({body.longWindowDays * body.barsPerDayUsed} bars). Every {body.stride}th bar is drawn; the statistics above use all of them.
                </p>
              </div>
              <FormulaCard
                tex={String.raw`\sigma_{\text{ann}}=100\,\sqrt{D\cdot B}\;\cdot\;\operatorname{sd}\!\left(r_{t-w+1},\dots,r_t\right),\qquad w=d\cdot B`}
                caption="Rolling realised volatility: the sample standard deviation of the last w log returns, scaled from one bar to a year."
                symbols={[
                  { tex: "D", name: "trading days in a year", value: fmtInt(body.annualisationDays) },
                  { tex: "B", name: "bars per day", value: `${body.barsPerDayUsed} (${body.barsPerDayBasis === "measured" ? "measured" : "24 h ÷ bar length"})` },
                  { tex: "d", name: "window in days (short, long)", value: `${body.shortWindowDays}, ${body.longWindowDays}` },
                  { tex: "w", name: "window in bars (short, long)", value: `${body.shortWindowDays * body.barsPerDayUsed}, ${body.longWindowDays * body.barsPerDayUsed}` },
                  { tex: String.raw`\sqrt{D\cdot B}`, name: "annualisation factor", value: fmt(body.annualisationFactor, 2) },
                ]}
              />
            </>
          )}
        </StudyState>
      </div>
    </Section>
  );
}

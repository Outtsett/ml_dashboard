/**
 * Section 5: the average path of the close from 15 bars before the pattern's
 * last candle to up to 30 after, beside every bar; the pattern minus the bars
 * where it did not fire; and the market state at the pattern's last candle.
 */

import { Area, CartesianGrid, ComposedChart, Legend as ChartLegend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, ColumnGrid, Empty, Finding, GRID, OKABE, Section, StudyNotes, StudyState, TOOLTIP, fmt, fmtInt, useStudyQuery } from "@/studies/kit";
import type { PathsBody } from "@shared/studies/candle-vectors";
import { IntervalPlot, Legend, PATTERN_STYLE, glyphPath, type IntervalItem } from "./charts";
import type { TabProps } from "./controls";

const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const pair = (low: unknown, high: unknown): [number, number] | null => {
  const a = num(low), b = num(high);
  return a === null || b === null ? null : [a, b];
};

export function PathsTab({ controls }: TabProps) {
  const query = useStudyQuery<PathsBody>("candle-vectors", { section: "paths", timeframe: controls.timeframe, pattern: controls.pattern });
  const body = query.data?.data;
  const rows = body?.paths ?? [];
  const label = PATTERN_STYLE[controls.pattern]?.label ?? controls.pattern;
  const steps = [...new Set(rows.map((row) => Number(row.bars_from_pattern)))].sort((a, b) => a - b);
  const of = (population: string, step: number) => rows.find((row) => row.population === population && Number(row.bars_from_pattern) === step);
  const merged = steps.map((step) => {
    const p = of(controls.pattern, step), e = of("every bar", step);
    return {
      step,
      patternMean: num(p?.mean), patternBand: pair(p?.mean_day_block_lower_95, p?.mean_day_block_upper_95), patternQuartiles: pair(p?.percentile_25, p?.percentile_75),
      everyMean: num(e?.mean), everyBand: pair(e?.mean_day_block_lower_95, e?.mean_day_block_upper_95), everyQuartiles: pair(e?.percentile_25, e?.percentile_75),
      patternMedian: num(p?.median), patternCount: num(p?.window_count),
      difference: num(p?.difference_from_other_bars), differenceBand: pair(p?.difference_day_block_lower_95, p?.difference_day_block_upper_95),
    };
  });
  const differences = merged.filter((row) => row.difference !== null);
  const excludes = (row: (typeof merged)[number]) => row.differenceBand !== null && (row.differenceBand[0] > 0 || row.differenceBand[1] < 0);
  const clearing = differences.filter(excludes).length;
  const contextRows = body?.context ?? [];
  const contextValues = contextRows.flatMap((row) => [num(row.location_shift_day_block_lower_95), num(row.location_shift_day_block_upper_95)]).filter((v): v is number => v !== null);
  const contextLimit = Math.max(5, ...contextValues.map(Math.abs));

  return (
    <StudyState isLoading={query.isLoading} error={query.error}>
      <StudyNotes notes={query.data?.notes ?? []} />
      <Section title="5 · What leads to it, and what comes after" question={`The close's average path around every ${label} 2021-2025 (${controls.timeframe}), in average ranges from its last close; grey is every bar. Dark band = 95% interval of the average from resampling whole trading days; light band = where the middle half of the individual paths ran.`}>
        {!body?.landed ? <Empty>The average paths are not in the lake.</Empty> : rows.length === 0 ? <Empty>No path for this pattern and timeframe.</Empty> : (
          <>
            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart data={merged} margin={{ top: 6, right: 8, left: 4, bottom: 16 }}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="step" type="number" domain={["dataMin", "dataMax"]} {...AXIS} label={{ value: "bars from the pattern's last candle", position: "insideBottom", offset: -8, fill: "#a3a3a3", fontSize: 10 }} />
                <YAxis {...AXIS} tickFormatter={(v: number) => fmt(v, 2)} label={{ value: "close minus last close (average ranges)", angle: -90, position: "insideLeft", fill: "#a3a3a3", fontSize: 10 }} />
                <Tooltip {...TOOLTIP} formatter={(value, name) => [Array.isArray(value) ? value.map((v) => fmt(Number(v), 3)).join(" to ") : fmt(Number(value), 3), String(name)]} />
                <ChartLegend wrapperStyle={{ fontSize: 11 }} />
                <Area dataKey="everyQuartiles" name="every bar, middle half" fill={OKABE.grey} fillOpacity={0.12} stroke="none" isAnimationActive={false} />
                <Area dataKey="patternQuartiles" name={`${label}, middle half`} fill={OKABE.orange} fillOpacity={0.12} stroke="none" isAnimationActive={false} />
                <Area dataKey="everyBand" name="every bar, 95% interval" fill={OKABE.grey} fillOpacity={0.35} stroke="none" isAnimationActive={false} />
                <Area dataKey="patternBand" name={`${label}, 95% interval`} fill={OKABE.orange} fillOpacity={0.35} stroke="none" isAnimationActive={false} />
                <ReferenceLine x={0} stroke="#e5e5e5" />
                <Line dataKey="everyMean" name="every bar (dashed)" stroke={OKABE.grey} strokeDasharray="6 3" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line dataKey="patternMean" name={`${label} (solid)`} stroke={OKABE.orange} strokeWidth={2.5} dot={{ r: 2 }} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>

            <div className="text-[11px] text-neutral-300">{label} minus the bars where it did not fire, 95% trading-day block interval</div>
            <Legend items={[{ key: "x", color: "#f5f5f5", glyph: "diamond", label: `interval excludes 0 (${clearing} of ${differences.length} steps)` }, { key: "i", color: OKABE.grey, glyph: "circle", label: "interval includes 0" }]} />
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={differences} margin={{ top: 6, right: 8, left: 4, bottom: 16 }}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="step" type="number" domain={["dataMin", "dataMax"]} {...AXIS} label={{ value: "bars from the pattern's last candle", position: "insideBottom", offset: -8, fill: "#a3a3a3", fontSize: 10 }} />
                <YAxis {...AXIS} tickFormatter={(v: number) => fmt(v, 3)} label={{ value: "pattern minus other bars (average ranges)", angle: -90, position: "insideLeft", fill: "#a3a3a3", fontSize: 10 }} />
                <Tooltip {...TOOLTIP} formatter={(value, name) => [Array.isArray(value) ? value.map((v) => fmt(Number(v), 4)).join(" to ") : fmt(Number(value), 4), String(name)]} />
                <ReferenceLine y={0} stroke="#e5e5e5" strokeDasharray="3 3" />
                <Area dataKey="differenceBand" name="95% interval" fill={OKABE.orange} fillOpacity={0.3} stroke="none" isAnimationActive={false} />
                <Line dataKey="difference" name="difference" stroke={OKABE.orange} strokeWidth={2} isAnimationActive={false}
                  dot={(props: { cx?: number; cy?: number; index?: number; payload?: (typeof merged)[number] }) => {
                    const { cx = 0, cy = 0, index = 0, payload } = props;
                    const clears = payload ? excludes(payload) : false;
                    return <path key={index} d={glyphPath(clears ? "diamond" : "circle", cx, cy, clears ? 4.5 : 3)} fill={clears ? "#f5f5f5" : OKABE.grey} stroke="#111" strokeWidth={0.5} />;
                  }} />
              </ComposedChart>
            </ResponsiveContainer>
            <Finding>
              Judge "what comes after" by this second chart. At one minute there is a difference, and it runs against the textbook: after a hammer
              the next bar closes about 0.015 average ranges lower than after other bars; after a bullish engulfing 0.01 lower over bars 2–4; after a
              bearish engulfing 0.01–0.02 higher over bars 2–11. A sliver of one ordinary bar's range: real with 100,000 firings behind it, far
              too small to trade before costs. At 1 hour nothing clears zero, and at 4 hours only a few scattered steps do, about as many as chance
              gives across 168 steps. The left half is partly forced by the rule itself (a hammer's body must sit near the previous low).
              {" "}On screen: {clearing} of {differences.length} steps exclude zero.
            </Finding>
          </>
        )}
      </Section>

      <Section title="The market state at the pattern's last candle" question="Average percentile rank minus 50 with its 95% trading-day interval: 0 = the same as any bar; a middle-half width of 50 = spread like any bar.">
        {contextRows.length === 0 ? <Empty>No market context for this pattern and timeframe.</Empty> : (
          <IntervalPlot
            rows={contextRows.map((row) => String(row.feature_name))} series={["shift"]} domain={[-contextLimit, contextLimit]} labelWidth={220}
            xLabel="average percentile rank minus 50 (95% interval)" reference={{ value: 0, color: "#e5e5e5", dash: "0" }}
            items={contextRows.map((row): IntervalItem => ({
              row: String(row.feature_name), series: "shift", value: num(row.location_shift_percentile_points),
              low: num(row.location_shift_day_block_lower_95), high: num(row.location_shift_day_block_upper_95),
              style: { color: OKABE.orange, glyph: "diamond", label: "shift" },
              tip: [String(row.feature_name), `shift ${fmt(num(row.location_shift_percentile_points), 2)} percentile points`,
                `middle-half width ${fmt(num(row.middle_half_width_percentile_points), 1)}`, `median ${fmt(num(row.median_feature_value), 3)} vs every bar ${fmt(num(row.every_bar_median_feature_value), 3)}`,
                `windows ${fmtInt(num(row.window_count))}`],
            }))}
          />
        )}
      </Section>
      {rows.length > 0 && <ColumnGrid rows={rows} title="Every column of the average paths shown" />}
    </StudyState>
  );
}

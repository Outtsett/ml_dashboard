/**
 * Panel D: the close-to-next-open gap on the 2025 holdout, against the quoted
 * bid-ask spread. Two axes are offered. "One mean range" is the notebook's:
 * every gap in average ranges rescaled by the single mean average range.
 * "Each bar's own range" multiplies each gap by its own bar's average range,
 * which is the gap in ticks that bar actually had.
 */

import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AXIS, ColumnGrid, ControlBar, Empty, GRID, OKABE, SegmentControl, SliderControl, Stat, SummaryTable, TOOLTIP, Finding,
  fmt, fmtInt, fmtPercent,
} from "@/studies/kit";
import { CITED_FIGURES, sampleRowsOf, type GapBody } from "@shared/studies/feature-ladder-what-to-encode";

export type GapAxis = "meanRange" | "perBar";

const NEAR_WHITE = "#f5f5f5";

export function GapSection({
  gap,
  bins,
  clip,
  axis,
  onBins,
  onClip,
  onAxis,
}: {
  gap: GapBody | null;
  bins: number;
  clip: number;
  axis: GapAxis;
  onBins: (value: number) => void;
  onClip: (value: number) => void;
  onAxis: (value: GapAxis) => void;
}) {
  if (!gap) return <Empty>The next-candle view is not landed, so the gap cannot be measured.</Empty>;

  const histogram = axis === "meanRange" ? gap.histogramAtMeanRange : gap.histogramPerBar;
  const kept = axis === "meanRange" ? gap.keptShareAtMeanRange : gap.keptSharePerBar;
  const meanRule = axis === "meanRange" ? gap.notebookMeanGapTicks : gap.perBarMeanGapTicks;
  const data = histogram.map((bin) => ({ middle: (bin.lower + bin.upper) / 2, lower: bin.lower, upper: bin.upper, count: bin.count }));
  const spread = CITED_FIGURES.quotedSpreadTicks;
  const notebookRatio = gap.notebookMeanGapTicks === null ? null : gap.notebookMeanGapTicks / spread;
  const perBarRatio = gap.perBarMeanGapTicks === null ? null : gap.perBarMeanGapTicks / spread;
  const edge = gap.sessionEdge;
  const sample = sampleRowsOf(gap.sampleColumns);

  return (
    <div className="space-y-3">
      <ControlBar>
        <SliderControl label="Bins" value={bins} min={20} max={120} step={10} onChange={onBins} />
        <SliderControl label="Clip the tail at (average ranges)" value={clip} min={0.05} max={0.6} step={0.05} onChange={onClip} format={(value) => value.toFixed(2)} hint={`Gaps above this are not drawn; it is ${fmt(gap.clipTicks, 1)} ticks at the mean range`} />
        <SegmentControl
          label="Tick axis"
          value={axis}
          options={[{ value: "meanRange", label: "one mean range (notebook)" }, { value: "perBar", label: "each bar's own range" }]}
          onChange={onAxis}
          hint="The notebook rescales every gap by the mean average range; the second axis multiplies each gap by its own bar's range"
        />
      </ControlBar>

      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        <Stat label="Mean gap, notebook axis" value={`${fmt(gap.notebookMeanGapTicks, 2)} ticks`} hint="mean |gap| in average ranges times the mean average range, over 0.25 points per tick" tone={OKABE.orange} />
        <Stat label="Mean gap, bar by bar" value={`${fmt(gap.perBarMeanGapTicks, 2)} ticks`} hint="each |gap| times its own bar's average range" tone={OKABE.sky} />
        <Stat label="Median gap, bar by bar" value={`${fmt(gap.perBarMedianGapTicks, 2)} ticks`} hint="one tick is the most common gap" />
        <Stat label="Quoted spread (cited)" value={`${fmt(spread, 2)} ticks`} hint="not recomputed here: no table or script in the lake produces it" tone={OKABE.vermillion} />
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <div className="min-w-0 space-y-2">
          <Finding>
            Solid white rule: the mean gap on this axis ({fmt(meanRule, 2)} ticks). Dashed vermillion rule: the quoted mean spread ({fmt(spread, 2)} ticks, cited). Showing {fmtPercent(kept, 2)} of {fmtInt(gap.gapBarCount)} holdout bars; drag the clip to see the tail.
          </Finding>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={data} margin={{ top: 22, right: 12, left: 0, bottom: 18 }} barCategoryGap={1}>
              <CartesianGrid {...GRID} vertical={false} />
              <XAxis
                dataKey="middle"
                type="number"
                domain={[0, gap.clipTicks]}
                tickFormatter={(value: number) => fmt(value, 1)}
                {...AXIS}
                label={{ value: axis === "meanRange" ? "close to next open, in ticks at the mean range" : "close to next open, in ticks, each bar's own range", position: "insideBottom", offset: -8, fill: "#a3a3a3", fontSize: 10 }}
              />
              <YAxis {...AXIS} width={48} label={{ value: "bars", angle: -90, position: "insideLeft", fill: "#a3a3a3", fontSize: 10 }} />
              <Tooltip
                {...TOOLTIP}
                formatter={(value: number) => [fmtInt(value), "bars"]}
                labelFormatter={(_, payload) => {
                  const row = payload?.[0]?.payload as { lower: number; upper: number } | undefined;
                  return row ? `${fmt(row.lower, 2)} to ${fmt(row.upper, 2)} ticks` : "";
                }}
              />
              {meanRule !== null && <ReferenceLine x={meanRule} stroke={NEAR_WHITE} strokeWidth={2} label={{ value: `mean ${fmt(meanRule, 2)}`, fill: NEAR_WHITE, fontSize: 10, position: "insideTopRight", offset: 6 }} />}
              <ReferenceLine x={spread} stroke={OKABE.vermillion} strokeWidth={3} strokeDasharray="6 4" label={{ value: `spread ${fmt(spread, 2)} (cited)`, fill: OKABE.vermillion, fontSize: 10, position: "top" }} />
              <Bar dataKey="count" fill={OKABE.orange} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="min-w-0 space-y-2">
          <Finding>
            The notebook's {fmt(gap.notebookMeanGapTicks, 2)} ticks is mean |gap| in average ranges ({fmt(gap.summaries[0]?.mean, 4)}) times the mean average range ({fmt(gap.meanRangePoints, 2)} points). Measured bar by bar, with each gap times its own bar's range, the mean is {fmt(gap.perBarMeanGapTicks, 2)} ticks and the median is {fmt(gap.perBarMedianGapTicks, 2)}: the usual gap is one tick.
            Against the cited spread that is a ratio of {fmt(notebookRatio, 3)} on the notebook's axis (the notebook's {fmt(CITED_FIGURES.notebookGapToSpreadRatio, 3)}) and {fmt(perBarRatio, 3)} bar by bar, so "the gap is the spread to within 2%" holds only on the first axis.
          </Finding>
          <SummaryTable columns={gap.summaries.map((summary) => ({ name: summary.column.replace(/_/g, " "), summary, decimals: 4 }))} />
          <p className="text-[10px] text-neutral-500">Computed in the lake over all {fmtInt(gap.gapBarCount)} holdout bars with a known next open (of {fmtInt(gap.holdoutBarCount)} holdout bars).</p>
        </div>
      </div>

      {edge && (
        <div className="space-y-2">
          <Finding>
            Not a session-boundary effect. Bars at a session edge (one bar or none before the break) are {fmtPercent(edge.edgeShare, 2)} of the holdout ({fmtInt(edge.edgeBarCount)} bars), their mean gap is {fmt(edge.edgeMultiple, 2)}× the rest, and they carry {fmtPercent(edge.squaredGapShare, 2)} of the total squared gap. The notebook quotes 0.38%, 1.1× and 0.5%.
          </Finding>
          <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
            <Stat label="Session-edge bars" value={fmtInt(edge.edgeBarCount)} />
            <Stat label="Share of holdout" value={fmtPercent(edge.edgeShare, 2)} />
            <Stat label="Edge gap against the rest" value={`${fmt(edge.edgeMultiple, 2)}×`} hint="mean |gap| in average ranges, edge bars over all others" />
            <Stat label="Share of squared gap" value={fmtPercent(edge.squaredGapShare, 2)} />
          </div>
        </div>
      )}

      <ColumnGrid
        rows={sample}
        title={`Every gap column (a deterministic one-in-${Math.round(1 / gap.sampleFraction)} sample of holdout bars: ${fmtInt(sample.length)} rows)`}
      />
    </div>
  );
}

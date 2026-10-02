/**
 * Section 1: how many points a panel should draw. Two line charts of every
 * measured series (faint) and their median (orange) against the budget, the
 * budget card, the canvas cost, and the distribution of shape error across
 * variables at the chosen budget.
 */

import { CartesianGrid, ComposedChart, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, Bar, BarChart, Cell } from "recharts";
import { DETAIL_POINT_BUDGET, RESIZE_SETTLE_MILLISECONDS, RESIZING_POINT_BUDGET, THUMBNAIL_POINT_BUDGET } from "@/market/regression/scales";
import {
  AXIS, Finding, GRID, Histogram, OKABE, SummaryTable, TOOLTIP, eightNumberSummary, fmt, fmtInt, fmtPercent, histogram,
} from "@/studies/kit";
import {
  FAITHFUL_SHAPE_ERROR, FRAME_MILLISECONDS, canvasMilliseconds, coverageRisesEveryStep, pivotByBudget, pivotCanvas, seriesDropOutBudgets, smallestFaithfulBudget,
  type BudgetSummary, type CanvasDrawRow, type RenderSeriesRow,
} from "@shared/studies/regression-tab-performance";
import { markDot } from "./marks";

const DASH: Record<string, string | undefined> = { MNQ_1m: undefined, MNQ_1h: "6 3", MNQ_1d: "2 3" };

function tickSubset(budgets: readonly number[]): number[] {
  const wanted = [250, 500, 1000, 2000, 5000, 10000];
  const inRange = wanted.filter((value) => budgets.includes(value));
  return inRange.length >= 3 ? inRange : [...budgets];
}

function budgetLabel(value: number): string {
  return value.toLocaleString("en-US");
}

interface MetricChartProps {
  rows: readonly RenderSeriesRow[];
  summaries: readonly BudgetSummary[];
  budgets: readonly number[];
  budget: number;
  metric: "coverage_fraction" | "histogram_total_variation";
  medianKey: "median_coverage_fraction" | "median_shape_error";
  yTitle: string;
  markerShape: "square" | "diamond";
  faithfulLine?: boolean;
}

function MetricChart({ rows, summaries, budgets, budget, metric, medianKey, yTitle, markerShape, faithfulLine }: MetricChartProps) {
  const pivot = pivotByBudget(rows, metric);
  const data: Array<Record<string, number | null>> = pivot.data.map((row) => {
    const summary = summaries.find((item) => item.requested_budget === row.requested_budget);
    return { ...row, median: summary?.[medianKey] ?? null, series_count: summary?.series_count ?? 0, median_points_drawn: summary?.median_points_drawn ?? null };
  });
  const barSeries = [...new Set(pivot.series.map((item) => item.barSeries))];
  const low = budgets[0] ?? 250;
  const high = budgets[budgets.length - 1] ?? 10000;
  return (
    <div className="min-w-0 space-y-1">
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 14 }}>
          <CartesianGrid {...GRID} />
          <XAxis type="number" scale="log" dataKey="requested_budget" domain={[low, high]} ticks={tickSubset(budgets)} tickFormatter={budgetLabel} {...AXIS} label={{ value: "points drawn per panel (log scale)", position: "insideBottom", offset: -8, fill: "#a3a3a3", fontSize: 10 }} />
          <YAxis domain={[0, "auto"]} {...AXIS} width={46} tickFormatter={(v: number) => fmt(v, 2)} label={{ value: yTitle, angle: -90, position: "insideLeft", fill: "#a3a3a3", fontSize: 10, dx: 6 }} />
          <Tooltip
            {...TOOLTIP}
            content={({ payload }) => {
              const row = payload?.[0]?.payload as Record<string, number | null> | undefined;
              if (!row) return null;
              const values = pivot.series.map((item) => row[item.key]).filter((value): value is number => typeof value === "number");
              return (
                <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
                  <div className="font-semibold">budget {budgetLabel(row.requested_budget as number)}</div>
                  <div>median {fmt(row.median ?? null, 4)} over {row.series_count} series</div>
                  <div>lowest {fmt(Math.min(...values), 4)} · highest {fmt(Math.max(...values), 4)}</div>
                  <div>median points actually drawn {fmtInt(row.median_points_drawn ?? null)}</div>
                </div>
              );
            }}
          />
          {pivot.series.map((item) => (
            <Line key={item.key} dataKey={item.key} stroke={OKABE.sky} strokeOpacity={0.3} strokeWidth={1} strokeDasharray={DASH[item.barSeries]} dot={false} activeDot={false} connectNulls isAnimationActive={false} />
          ))}
          <Line dataKey="median" name="median" stroke={OKABE.orange} strokeWidth={2.5} dot={markDot(markerShape, OKABE.orange)} connectNulls isAnimationActive={false} />
          <ReferenceLine x={budget} stroke={OKABE.blue} strokeDasharray="4 3" label={{ value: "budget", fill: OKABE.blue, fontSize: 10, position: "top" }} />
          {faithfulLine && <ReferenceLine y={FAITHFUL_SHAPE_ERROR} stroke={OKABE.purple} strokeDasharray="2 2" label={{ value: "0.05", fill: OKABE.purple, fontSize: 10, position: "right" }} />}
        </ComposedChart>
      </ResponsiveContainer>
      <p className="text-[11px] text-neutral-400">
        <span style={{ color: OKABE.orange }}>{markerShape === "square" ? "■" : "◆"} orange: median across series</span> · <span style={{ color: OKABE.sky }}>faint sky: one series each</span>
        {" "}({barSeries.map((name) => `${name} ${DASH[name] ? (DASH[name] === "6 3" ? "dashed" : "dotted") : "solid"}`).join(", ")})
      </p>
    </div>
  );
}

export function BudgetCharts({ rows, summaries, budgets, budget }: { rows: readonly RenderSeriesRow[]; summaries: readonly BudgetSummary[]; budgets: readonly number[]; budget: number }) {
  const rises = coverageRisesEveryStep(summaries);
  const dropOuts = seriesDropOutBudgets(summaries);
  const faithfulFrom = smallestFaithfulBudget(summaries);
  const first = [...summaries].sort((a, b) => a.requested_budget - b.requested_budget);
  const coverageFirst = first[0]?.median_coverage_fraction ?? null;
  const coverageLast = first[first.length - 1]?.median_coverage_fraction ?? null;
  const steps =
    dropOuts.length > 0 ? ` At ${dropOuts.map(budgetLabel).join(", ")} points the series count falls: a series shorter than the budget has nothing to thin and leaves the median, so that step compares a different set of series.` : "";
  const coverageSentence = rises
    ? `The median share of pixels painted rises at every budget, from ${fmt(coverageFirst, 3)} to ${fmt(coverageLast, 3)}: there is no early point where more dots stop showing.`
    : `The median share of pixels painted runs from ${fmt(coverageFirst, 3)} to ${fmt(coverageLast, 3)} but does not rise at every step.${steps}`;
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <div className="min-w-0 space-y-1">
        <h4 className="text-xs font-semibold text-neutral-200">Painted pixels against points drawn</h4>
        <MetricChart rows={rows} summaries={summaries} budgets={budgets} budget={budget} metric="coverage_fraction" medianKey="median_coverage_fraction" yTitle="share of the plot's pixels painted" markerShape="square" />
        <Finding>{coverageSentence}</Finding>
      </div>
      <div className="min-w-0 space-y-1">
        <h4 className="text-xs font-semibold text-neutral-200">Shape error against points drawn</h4>
        <MetricChart rows={rows} summaries={summaries} budgets={budgets} budget={budget} metric="histogram_total_variation" medianKey="median_shape_error" yTitle="shape error (total-variation distance)" markerShape="diamond" faithfulLine />
        <Finding>
          {faithfulFrom === null
            ? `The median shape error stays above ${FAITHFUL_SHAPE_ERROR} at every measured budget.`
            : `The cloud reads true (median shape error under ${FAITHFUL_SHAPE_ERROR}, the dashed pink line) from ${budgetLabel(faithfulFrom)} points a panel.`}
        </Finding>
      </div>
    </div>
  );
}

export function BudgetCard({ summary, budget, panels, microsecondsPerPoint }: { summary: BudgetSummary | undefined; budget: number; panels: number; microsecondsPerPoint: number | null }) {
  if (!summary) return <p className="text-xs text-neutral-400">No series is longer than {budgetLabel(budget)} points here, so there is nothing to thin.</p>;
  const cost = microsecondsPerPoint === null ? null : canvasMilliseconds(microsecondsPerPoint, budget, panels);
  const rows: Array<[string, string]> = [
    ["points actually drawn (median; thinning takes every k-th bar)", fmtInt(summary.median_points_drawn)],
    ["median shape error", fmt(summary.median_shape_error, 4)],
    ["90th-percentile shape error", fmt(summary.ninetieth_percentile_shape_error, 4)],
    [`variables whose shape error is under ${FAITHFUL_SHAPE_ERROR}`, `${fmtPercent(summary.share_of_variables_faithful, 0)} of ${summary.series_count}`],
    ["median share of pixels painted", fmt(summary.median_coverage_fraction, 3)],
    [`canvas time per thumbnail (about ${fmt(microsecondsPerPoint, 2)} µs a point)`, cost ? `${fmt(cost.panel, 1)} ms` : "n/a"],
    [`canvas time for ${panels} panels on screen`, cost ? `${fmt(cost.frame, 1)} ms: one screen frame is ${FRAME_MILLISECONDS} ms, ${cost.frame <= FRAME_MILLISECONDS ? "inside it ✓" : "over it ✗"}` : "n/a"],
  ];
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold text-neutral-200">A budget of {budgetLabel(budget)} points per panel</h4>
      <table className="w-full text-[11px]">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label} className="border-t border-neutral-900">
              <td className="py-1 pr-3 text-neutral-400">{label}</td>
              <td className="py-1 text-right font-mono tnum text-neutral-200">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Finding>
        The tab draws <b>{budgetLabel(THUMBNAIL_POINT_BUDGET)}</b> ordinary points per thumbnail at rest and <b>{budgetLabel(DETAIL_POINT_BUDGET)}</b> in the detail view, plus every flagged outlier; only panels on screen paint;
        and while a panel is being resized it draws <b>{budgetLabel(RESIZING_POINT_BUDGET)}</b> and fills in the rest {RESIZE_SETTLE_MILLISECONDS} ms after the width stops changing.
      </Finding>
    </div>
  );
}

const SURFACE_COLOR: Record<string, string> = { thumbnail: OKABE.blue, detail: OKABE.orange };
const RUN_SHAPE: Record<number, "triangle" | "circle" | "square"> = { 1: "triangle", 2: "circle", 3: "square" };
const RUN_DASH: Record<number, string | undefined> = { 1: "3 3", 2: undefined, 3: "8 3" };

export function CanvasChart({ rows, budget, steadyRange, steadyMicrosecondsPerPoint, includeBusyRun }: { rows: readonly CanvasDrawRow[]; budget: number; steadyRange: { minimum: number; maximum: number } | null; steadyMicrosecondsPerPoint: number | null; includeBusyRun: boolean }) {
  const shown = includeBusyRun ? rows : rows.filter((row) => row.run_index > 1);
  const pivot = pivotCanvas(shown);
  const points = shown.map((row) => row.points_drawn);
  const low = points.length ? Math.min(...points) : 700;
  const high = points.length ? Math.max(...points) : 20000;
  const busy = rows.filter((row) => row.run_index === 1);
  return (
    <div className="space-y-1">
      <ResponsiveContainer width="100%" height={250}>
        <LineChart data={pivot.data} margin={{ top: 8, right: 12, left: 0, bottom: 14 }}>
          <CartesianGrid {...GRID} />
          <XAxis type="number" scale="log" dataKey="points_drawn" domain={[low, high]} ticks={[700, 1000, 2000, 5000, 10000, 20000].filter((v) => v >= low && v <= high)} tickFormatter={budgetLabel} {...AXIS} label={{ value: "points drawn (log scale)", position: "insideBottom", offset: -8, fill: "#a3a3a3", fontSize: 10 }} />
          <YAxis domain={[0, "auto"]} {...AXIS} width={44} label={{ value: "canvas time, milliseconds", angle: -90, position: "insideLeft", fill: "#a3a3a3", fontSize: 10, dx: 6 }} />
          <Tooltip
            {...TOOLTIP}
            content={({ payload }) => {
              const row = payload?.[0]?.payload as Record<string, number | null> | undefined;
              if (!row) return null;
              return (
                <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
                  <div className="font-semibold">{budgetLabel(row.points_drawn as number)} points</div>
                  {pivot.keys.map((key) => (
                    <div key={key.key}>{key.key}: {row[key.key] === null || row[key.key] === undefined ? "not measured" : `${fmt(row[key.key], 1)} ms`}</div>
                  ))}
                  <div>one frame {FRAME_MILLISECONDS} ms</div>
                </div>
              );
            }}
          />
          {pivot.keys.map((key) => (
            <Line key={key.key} dataKey={key.key} stroke={SURFACE_COLOR[key.surface] ?? OKABE.grey} strokeDasharray={RUN_DASH[key.run]} strokeWidth={1.8} dot={markDot(RUN_SHAPE[key.run] ?? "circle", SURFACE_COLOR[key.surface] ?? OKABE.grey, 3.5)} connectNulls isAnimationActive={false} />
          ))}
          <ReferenceLine y={FRAME_MILLISECONDS} stroke={OKABE.purple} strokeDasharray="2 2" label={{ value: "one 60 Hz frame", fill: OKABE.purple, fontSize: 10, position: "insideTopLeft" }} />
          <ReferenceLine x={budget} stroke={OKABE.blue} strokeDasharray="4 3" label={{ value: "budget", fill: OKABE.blue, fontSize: 10, position: "top" }} />
        </LineChart>
      </ResponsiveContainer>
      <p className="text-[11px] text-neutral-400">
        <span style={{ color: OKABE.blue }}>blue thumbnail</span> · <span style={{ color: OKABE.orange }}>orange detail</span> · run 1 ▲ dotted, run 2 ● solid, run 3 ■ dashed
      </p>
      <Finding>
        Canvas cost is close to linear: about {fmt(steadyMicrosecondsPerPoint, 2)} µs a point in the steady thumbnail runs ({fmt(steadyRange?.minimum, 2)} to {fmt(steadyRange?.maximum, 2)} µs).
        {busy.length > 0 && ` Run 1 was taken while the page was busy with the regression grid and reads slower (up to ${fmt(Math.max(...busy.map((row) => row.microseconds_per_point)), 2)} µs a point); its detail readings at 10,000 and 20,000 points are equal, so treat it as an outlier.`}
      </Finding>
    </div>
  );
}

export function ShapeDistribution({ rows, budget }: { rows: readonly RenderSeriesRow[]; budget: number }) {
  const atBudget = rows.filter((row) => row.requested_budget === budget);
  const values = atBudget.map((row) => row.histogram_total_variation);
  const summary = eightNumberSummary(values);
  const bars = [...atBudget]
    .sort((a, b) => b.histogram_total_variation - a.histogram_total_variation)
    .map((row) => ({ label: row.series_label, value: row.histogram_total_variation, faithful: row.histogram_total_variation < FAITHFUL_SHAPE_ERROR }));
  if (atBudget.length === 0) return <p className="text-xs text-neutral-400">No selected series reaches a budget of {budgetLabel(budget)}.</p>;
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <div className="min-w-0 space-y-2">
        <SummaryTable columns={[{ name: "shape error (total variation)", summary, decimals: 4 }]} />
        <Histogram bins={histogram(values, 12)} unit="shape error" height={150} markers={[{ x: FAITHFUL_SHAPE_ERROR, label: "0.05", color: OKABE.purple }]} />
      </div>
      <div className="min-w-0">
        <ResponsiveContainer width="100%" height={Math.max(180, 14 * bars.length)}>
          <BarChart data={bars} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 4 }}>
            <CartesianGrid {...GRID} horizontal={false} />
            <XAxis type="number" {...AXIS} />
            <YAxis type="category" dataKey="label" width={150} {...AXIS} interval={0} tick={{ fontSize: 8, fill: "#a3a3a3" }} />
            <Tooltip {...TOOLTIP} formatter={(value) => fmt(Number(value), 4)} />
            <ReferenceLine x={FAITHFUL_SHAPE_ERROR} stroke={OKABE.purple} strokeDasharray="2 2" />
            <Bar dataKey="value" name="shape error" isAnimationActive={false}>
              {bars.map((bar) => (
                <Cell key={bar.label} fill={bar.faithful ? OKABE.blue : OKABE.orange} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <p className="text-[11px] text-neutral-400">
          <span style={{ color: OKABE.blue }}>■ under 0.05, reads true</span> · <span style={{ color: OKABE.orange }}>■ 0.05 or more, still visibly off</span> · every series at this budget
        </p>
      </div>
    </div>
  );
}

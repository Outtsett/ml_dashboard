/**
 * The study half's two charts: best metric per pattern with and without the
 * ten-bar context (grouped bars), and every model on every pattern (dots).
 * Blue = the candle alone, orange = with the trailing averages; model colours
 * and shapes are Okabe-Ito with a glyph per feature set, never red or green.
 */

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { AXIS, GRID, OKABE, TOOLTIP, fmt, fmtInt } from "@/studies/kit";
import {
  FEATURE_SET_LABEL, metricOf, type MetricKey, type PatternBest, type StudyRow,
} from "@shared/studies/single-candle-recognizer";

export const MODEL_COLORS = [OKABE.orange, OKABE.blue, OKABE.sky, OKABE.purple] as const;

export function GapChart({ data, metricLabel }: { data: PatternBest[]; metricLabel: string }) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] text-neutral-400">
        <span style={{ color: OKABE.blue }}>■ {FEATURE_SET_LABEL.single_bar_shape_only}</span>
        {" · "}
        <span style={{ color: OKABE.orange }}>■ {FEATURE_SET_LABEL.single_bar_plus_trailing_context}</span>
        {` · best ${metricLabel} over the selected models`}
      </p>
      <ResponsiveContainer width="100%" height={Math.max(280, 36 * data.length)}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }} barCategoryGap="20%">
          <CartesianGrid {...GRID} horizontal={false} />
          <XAxis type="number" domain={[0, 1]} {...AXIS} />
          <YAxis type="category" dataKey="pattern" width={118} interval={0} {...AXIS} />
          <Tooltip
            {...TOOLTIP}
            cursor={{ fill: "rgba(255,255,255,0.05)" }}
            content={({ payload }) => {
              const row = payload?.[0]?.payload as PatternBest | undefined;
              if (!row) return null;
              return (
                <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
                  <div className="font-semibold">{row.pattern}</div>
                  <div>{FEATURE_SET_LABEL.single_bar_shape_only}: {fmt(row.alone, 4)}</div>
                  <div>{FEATURE_SET_LABEL.single_bar_plus_trailing_context}: {fmt(row.context, 4)}</div>
                  <div>context is worth {row.gap === null ? "—" : `${row.gap >= 0 ? "+" : ""}${fmt(row.gap, 4)}`}</div>
                </div>
              );
            }}
          />
          <Bar dataKey="alone" name={FEATURE_SET_LABEL.single_bar_shape_only} fill={OKABE.blue} isAnimationActive={false} />
          <Bar dataKey="context" name={FEATURE_SET_LABEL.single_bar_plus_trailing_context} fill={OKABE.orange} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

interface DotPoint {
  x: number;
  y: number;
  pattern: string;
  model: string;
  modelIndex: number;
  featureSet: string;
  prevalence: number | null;
  positives: number | null;
  seconds: number | null;
}

function Marker({ cx = 0, cy = 0, payload }: { cx?: number; cy?: number; payload?: DotPoint }) {
  if (!payload) return null;
  const fill = MODEL_COLORS[payload.modelIndex % MODEL_COLORS.length];
  if (payload.featureSet === "single_bar_plus_trailing_context") {
    return <path d={`M${cx} ${cy - 6.5} L${cx + 6} ${cy + 5} L${cx - 6} ${cy + 5} Z`} fill={fill} fillOpacity={0.9} stroke="#0a0a0a" strokeWidth={0.6} />;
  }
  return <circle cx={cx} cy={cy} r={4.5} fill={fill} fillOpacity={0.85} stroke="#0a0a0a" strokeWidth={0.6} />;
}

export function ModelDotPlot({
  rows, models, patterns, metric, metricLabel, zoom,
}: {
  rows: StudyRow[]; models: string[]; patterns: string[]; metric: MetricKey; metricLabel: string; zoom: boolean;
}) {
  const points: DotPoint[] = [];
  for (const row of rows) {
    const value = metricOf(row, metric);
    const patternIndex = patterns.indexOf(row.pattern_name);
    const modelIndex = models.indexOf(row.model_name);
    if (value === null || patternIndex < 0 || modelIndex < 0) continue;
    // A small vertical offset per model keeps the four dots of one pattern from sitting on top of each other.
    points.push({
      x: value, y: patternIndex + (modelIndex - (models.length - 1) / 2) * 0.14, pattern: row.pattern_name, model: row.model_name, modelIndex,
      featureSet: row.feature_set, prevalence: row.prevalence, positives: row.positive_count, seconds: row.training_seconds,
    });
  }
  const lowest = points.length > 0 ? Math.min(...points.map((point) => point.x)) : 0;
  const floor = zoom ? Math.max(0, Math.floor(lowest * 20) / 20) : 0;
  return (
    <div className="space-y-1">
      <p className="flex flex-wrap gap-x-3 text-[11px] text-neutral-400">
        {models.map((model, index) => (
          <span key={model}><span style={{ color: MODEL_COLORS[index % MODEL_COLORS.length] }}>●</span> {model}</span>
        ))}
        <span>● {FEATURE_SET_LABEL.single_bar_shape_only}</span>
        <span>▲ {FEATURE_SET_LABEL.single_bar_plus_trailing_context}</span>
      </p>
      <ResponsiveContainer width="100%" height={Math.max(300, 30 * patterns.length)}>
        <ScatterChart margin={{ top: 6, right: 16, left: 8, bottom: 16 }}>
          <CartesianGrid {...GRID} />
          <XAxis type="number" dataKey="x" name={metricLabel} domain={[floor, 1]} {...AXIS} label={{ value: metricLabel, position: "insideBottom", offset: -8, fill: "#a3a3a3", fontSize: 10 }} />
          <YAxis
            type="number" dataKey="y" reversed domain={[-0.5, patterns.length - 0.5]} ticks={patterns.map((_, index) => index)}
            tickFormatter={(value: number) => patterns[value] ?? ""} interval={0} width={118} {...AXIS}
          />
          <ZAxis range={[60, 60]} />
          <Tooltip
            {...TOOLTIP}
            cursor={{ strokeDasharray: "3 3" }}
            content={({ payload }) => {
              const point = payload?.[0]?.payload as DotPoint | undefined;
              if (!point) return null;
              return (
                <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
                  <div className="font-semibold">{point.pattern} · {point.model}</div>
                  <div>{FEATURE_SET_LABEL[point.featureSet as keyof typeof FEATURE_SET_LABEL] ?? point.featureSet}</div>
                  <div>{metricLabel} {fmt(point.x, 4)}</div>
                  <div>prevalence {fmt(point.prevalence, 4)} · positives {fmtInt(point.positives)}</div>
                  <div>training {fmt(point.seconds, 2)} s</div>
                </div>
              );
            }}
          />
          <Scatter data={points} shape={(props: unknown) => <Marker {...(props as Parameters<typeof Marker>[0])} />} isAnimationActive={false} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

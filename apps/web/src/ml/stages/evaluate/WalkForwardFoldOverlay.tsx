/**
 * WalkForwardFoldOverlay — overlay equity / metric curves across selected
 * experiments with optional CI95 bands.
 *
 * Per W6.c spec:
 *   - One color per experiment (Wong 2011 CVD-safe palette).
 *   - LTTB-downsample every series to ~200 points when >5 experiments are
 *     overlaid simultaneously, to keep Recharts render fast.
 *   - CI95 band rendered via stacked `<Area>` (lower/upper) + a `<Line>` for
 *     the mean.
 *   - Always wrapped in `<ResponsiveContainer>` per project chart standards.
 *
 * Data model: each experiment supplies an array of `{ fold, mean, ciLower,
 * ciUpper }` aggregated equity / metric checkpoints (one row per fold). When
 * the trainer emits sub-fold curves the caller can pass a denser series and
 * the LTTB pass keeps the overlay readable.
 */

import { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "@/shared/utils/utils";
import { lttb, type Point } from "./lttb";
import { paletteColor } from "./palette";

export interface FoldPoint {
  fold: number;
  mean: number | null;
  ciLower?: number | null;
  ciUpper?: number | null;
}

export interface FoldOverlayExperiment {
  id: string;
  label: string;
  series: FoldPoint[];
}

export interface WalkForwardFoldOverlayProps {
  experiments: FoldOverlayExperiment[];
  /** Which metric is being plotted, used for axis label + tooltip name. */
  metricLabel?: string;
  /** Override the LTTB target. Defaults to 200 when N > 5 experiments. */
  downsampleTarget?: number;
  /** Whether to show CI95 stacked-area bands. Defaults to true. */
  showCi?: boolean;
  className?: string;
  height?: number;
}

interface PreparedSeries {
  id: string;
  label: string;
  color: string;
  data: Array<{ fold: number; mean: number | null; ciLower: number | null; ciUpper: number | null }>;
}

const DEFAULT_HEIGHT = 320;
const DOWNSAMPLE_THRESHOLD = 5;
const DEFAULT_TARGET = 200;

function downsampleFold(series: FoldPoint[], target: number): FoldPoint[] {
  if (series.length <= target) return series;
  const points: Point[] = series
    .filter((p) => p.mean != null && Number.isFinite(p.mean))
    .map((p) => ({ x: p.fold, y: p.mean as number }));
  const sampled = lttb(points, target);
  // Map back, preserving CI bounds for retained points where the original fold
  // matches.
  const byFold = new Map(series.map((s) => [s.fold, s] as const));
  return sampled
    .map(({ x }) => byFold.get(x))
    .filter((s): s is FoldPoint => s != null);
}

function tooltipFormatter(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return value.toFixed(3);
  return "—";
}

export function WalkForwardFoldOverlay({
  experiments,
  metricLabel = "Equity",
  downsampleTarget = DEFAULT_TARGET,
  showCi = true,
  className,
  height = DEFAULT_HEIGHT,
}: WalkForwardFoldOverlayProps) {
  const prepared = useMemo<PreparedSeries[]>(() => {
    const shouldDownsample = experiments.length > DOWNSAMPLE_THRESHOLD;
    return experiments.map((exp, idx) => {
      const downsampled = shouldDownsample
        ? downsampleFold(exp.series, downsampleTarget)
        : exp.series;
      return {
        id: exp.id,
        label: exp.label,
        color: paletteColor(idx),
        data: downsampled.map((p) => ({
          fold: p.fold,
          mean: p.mean,
          ciLower: p.ciLower ?? null,
          ciUpper: p.ciUpper ?? null,
        })),
      };
    });
  }, [experiments, downsampleTarget]);

  // Recharts works best with one merged dataset across overlaid series.
  const merged = useMemo(() => {
    const folds = new Set<number>();
    for (const s of prepared) for (const p of s.data) folds.add(p.fold);
    const sorted = [...folds].sort((a, b) => a - b);
    return sorted.map((fold) => {
      const row: Record<string, number | null> & { fold: number } = { fold };
      for (const s of prepared) {
        const point = s.data.find((p) => p.fold === fold);
        row[`${s.id}__mean`] = point?.mean ?? null;
        if (showCi) {
          row[`${s.id}__lower`] = point?.ciLower ?? null;
          row[`${s.id}__upper`] = point?.ciUpper ?? null;
          if (point?.ciLower != null && point.ciUpper != null) {
            row[`${s.id}__band`] = point.ciUpper - point.ciLower;
          } else {
            row[`${s.id}__band`] = null;
          }
        }
      }
      return row;
    });
  }, [prepared, showCi]);

  if (experiments.length === 0) {
    return (
      <div
        className={cn(
          "rounded-2xl border border-white/5 bg-white/[0.02] p-8 text-center",
          className,
        )}
        data-testid="walkforward-overlay-empty"
      >
        <p className="text-sm text-muted-foreground">
          Select experiments to overlay walk-forward folds.
        </p>
      </div>
    );
  }

  // ComposedChart renders both Area (CI bands as stacked lower/band) and Line
  // (mean trajectory). Disable animation for fast overlay updates.
  return (
    <div
      className={cn("rounded-2xl border border-white/5 bg-white/[0.02] p-3", className)}
      data-testid="walkforward-overlay"
    >
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={merged} margin={{ top: 12, right: 24, bottom: 12, left: 8 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />
          <XAxis
            dataKey="fold"
            type="number"
            domain={[ "dataMin", "dataMax" ]}
            tick={{ fontSize: 10, fill: "rgba(255,255,255,0.6)" }}
            label={{
              value: "Fold",
              position: "insideBottom",
              offset: -2,
              fill: "rgba(255,255,255,0.5)",
              fontSize: 11,
            }}
          />
          <YAxis
            tick={{ fontSize: 10, fill: "rgba(255,255,255,0.6)" }}
            label={{
              value: metricLabel,
              angle: -90,
              position: "insideLeft",
              fill: "rgba(255,255,255,0.5)",
              fontSize: 11,
            }}
            width={60}
          />
          <Tooltip
            contentStyle={{
              background: "rgba(0,0,0,0.85)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 8,
              fontSize: 11,
            }}
            formatter={(value, name) => [tooltipFormatter(value), String(name)]}
          />
          <Legend
            wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
            iconType="line"
          />

          {showCi &&
            prepared.map((s) => (
              <Area
                key={`${s.id}__band`}
                dataKey={`${s.id}__band`}
                stackId={`${s.id}__ci`}
                type="monotone"
                stroke="none"
                fill={s.color}
                fillOpacity={0}
                isAnimationActive={false}
                legendType="none"
              />
            ))}
          {showCi &&
            prepared.map((s) => (
              <Area
                key={`${s.id}__lower`}
                dataKey={`${s.id}__lower`}
                type="monotone"
                stroke="none"
                fill={s.color}
                fillOpacity={0.12}
                isAnimationActive={false}
                legendType="none"
              />
            ))}

          {prepared.map((s) => (
            <Line
              key={`${s.id}__mean`}
              dataKey={`${s.id}__mean`}
              name={s.label}
              type="monotone"
              stroke={s.color}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// Re-export helper so `EvaluateStage` can pre-flight `<AreaChart>` import for
// the lazy chunk if needed.
export { AreaChart };

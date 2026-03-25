/**
 * MetricPanel — Reusable chart + description for a single training metric.
 *
 * Renders a recharts line chart on the left with the current value annotated,
 * and a description panel on the right explaining what the metric measures,
 * how it affects the model, and what "healthy" looks like.
 *
 * Reads MetricDescription from useMetricDescriptions hook.
 * Adapts to any metric from any model type — fully config-driven.
 */

import { useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Area,
  AreaChart,
} from "recharts";
import { type MetricDescription, formatMetricValue } from "@/hooks/useMetricDescriptions";

interface MetricPanelProps {
  /** Metric key (e.g. "log_likelihood") */
  metricKey: string;
  /** Description from config */
  desc: MetricDescription;
  /** Time series data: [{iteration, value}] */
  data: Array<{ iteration: number; value: number }>;
  /** Whether training is actively running */
  isTraining: boolean;
  /** Show description sidebar (default true) */
  showDescription?: boolean;
  /** Compact mode — smaller chart, no description (for grid view) */
  compact?: boolean;
}

export function MetricPanel({
  metricKey,
  desc,
  data,
  isTraining,
  showDescription = true,
  compact = false,
}: MetricPanelProps) {
  const chartData = useMemo(() => {
    if (desc.format === "percent") {
      return data.map(d => ({ ...d, displayValue: d.value * 100 }));
    }
    if (desc.format === "millions") {
      return data.map(d => ({ ...d, displayValue: d.value / 1e6 }));
    }
    return data.map(d => ({ ...d, displayValue: d.value }));
  }, [data, desc.format]);

  const currentValue = data.length > 0 ? data[data.length - 1]!.value : null;
  const currentFormatted = currentValue != null ? formatMetricValue(currentValue, desc.format) : "--";

  const yLabel = desc.format === "percent"
    ? "%"
    : desc.format === "millions"
      ? "M"
      : desc.unit !== "raw" ? desc.unit : "";

  // Target reference line (e.g. 95% for assignment_stability)
  const targetValue = desc.target != null
    ? desc.format === "percent" ? desc.target : desc.target
    : null;

  if (compact) {
    return (
      <div className="h-full w-full flex flex-col">
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/5">
          <span className="text-[10px] font-mono font-medium" style={{ color: desc.color }}>
            {desc.title}
          </span>
          <span className="text-xs font-mono font-bold" style={{ color: desc.color }}>
            {currentFormatted}
          </span>
        </div>
        <div className="flex-1 min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
              <defs>
                <linearGradient id={`fill-${metricKey}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={desc.color} stopOpacity={0.15} />
                  <stop offset="95%" stopColor={desc.color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="iteration" tick={{ fontSize: 8, fill: "#6e7681" }} tickLine={false} />
              <YAxis tick={{ fontSize: 8, fill: "#6e7681" }} tickLine={false} width={45} />
              {targetValue != null && (
                <ReferenceLine
                  y={targetValue}
                  stroke="#ef4444"
                  strokeDasharray="4 4"
                  strokeOpacity={0.5}
                />
              )}
              <Area
                type="monotone"
                dataKey="displayValue"
                stroke={desc.color}
                fill={`url(#fill-${metricKey})`}
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex">
      {/* Chart section */}
      <div className={showDescription ? "w-3/5" : "w-full"} style={{ minWidth: 0 }}>
        <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
          <span className="text-xs font-mono font-semibold" style={{ color: desc.color }}>
            {desc.title}
          </span>
          <div className="flex items-center gap-2">
            {isTraining && (
              <span className="text-[9px] font-mono text-muted-foreground/50">
                {data.length} iter
              </span>
            )}
            <span className="text-sm font-mono font-bold" style={{ color: desc.color }}>
              {currentFormatted}
            </span>
          </div>
        </div>
        <div className="h-[calc(100%-36px)]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
              <defs>
                <linearGradient id={`fill-full-${metricKey}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={desc.color} stopOpacity={0.12} />
                  <stop offset="95%" stopColor={desc.color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis
                dataKey="iteration"
                tick={{ fontSize: 9, fill: "#6e7681" }}
                tickLine={false}
                label={{ value: "Iteration", position: "insideBottom", offset: -2, fontSize: 9, fill: "#4b5563" }}
              />
              <YAxis
                tick={{ fontSize: 9, fill: "#6e7681" }}
                tickLine={false}
                width={55}
                label={yLabel ? { value: yLabel, angle: -90, position: "insideLeft", fontSize: 9, fill: "#4b5563" } : undefined}
              />
              <Tooltip
                contentStyle={{
                  background: "#0d1117",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 8,
                  fontSize: 11,
                  padding: "6px 10px",
                }}
                formatter={(value: number) => {
                  if (desc.format === "percent") return [`${value.toFixed(1)}%`, desc.title];
                  if (desc.format === "millions") return [`${value.toFixed(2)}M`, desc.title];
                  return [value.toFixed(3), desc.title];
                }}
              />
              {targetValue != null && (
                <ReferenceLine
                  y={targetValue}
                  stroke="#ef4444"
                  strokeDasharray="4 4"
                  strokeOpacity={0.5}
                  label={{
                    value: `${targetValue}% target`,
                    fill: "#ef4444",
                    fontSize: 9,
                    position: "right",
                  }}
                />
              )}
              <Area
                type="monotone"
                dataKey="displayValue"
                stroke={isTraining ? desc.color : "#22c55e"}
                fill={`url(#fill-full-${metricKey})`}
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Description sidebar */}
      {showDescription && (
        <div className="w-2/5 border-l border-white/5 p-3 flex flex-col justify-center overflow-y-auto">
          <p className="text-[11px] text-muted-foreground/80 leading-relaxed mb-3">
            {desc.description}
          </p>
          <div className="space-y-2">
            <div>
              <span className="text-[9px] font-mono text-amber-400/70 uppercase tracking-wider">
                Model Effect
              </span>
              <p className="text-[10px] text-muted-foreground/60 leading-relaxed mt-0.5">
                {desc.effect}
              </p>
            </div>
            <div>
              <span className="text-[9px] font-mono text-emerald-400/70 uppercase tracking-wider">
                Healthy
              </span>
              <p className="text-[10px] text-muted-foreground/60 leading-relaxed mt-0.5">
                {desc.healthy}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

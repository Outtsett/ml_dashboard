import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Eye } from "lucide-react";
import {
  ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine, Legend
} from "recharts";
import type { ChartPoint, ForecastData } from "@/ml/components/forecast-visualizer/types";

interface ForecastChartProps {
  chartData: ChartPoint[];
  wallIndex: number;
  forecastData: ForecastData;
}

export function ForecastChart({ chartData, wallIndex, forecastData }: ForecastChartProps) {
  return (
    <Card className="glass rounded-xl border border-border/50">
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-sm flex items-center gap-2">
          <Eye className="h-4 w-4 text-blue-400" />
          {forecastData.metadata.symbol} {forecastData.metadata.timeframe_label} — Chronos {forecastData.metadata.model_size} Forecast
        </CardTitle>
      </CardHeader>
      <CardContent className="p-2">
        <ResponsiveContainer width="100%" height={400}>
          <ComposedChart data={chartData} margin={{ top: 10, right: 20, bottom: 20, left: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis
              dataKey="ts"
              tick={{ fontSize: 10, fill: "#888" }}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={["auto", "auto"]}
              tick={{ fontSize: 10, fill: "#888" }}
              tickFormatter={(v: number) => v.toFixed(forecastData.metadata.symbol.includes("JPY") ? 2 : 4)}
            />
            <Tooltip
              contentStyle={{
                background: "rgba(0,0,0,0.85)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 12,
                fontSize: 11,
              }}
              formatter={(value: number | string | Array<number | string>, name: string) => {
                const precision = forecastData.metadata.symbol.includes("JPY") ? 3 : 5;
                const fmt = (v: number | string | undefined) =>
                  typeof v === "number" ? v.toFixed(precision) : v;
                if (Array.isArray(value)) {
                  return [`${fmt(value[0])} – ${fmt(value[1])}`, name];
                }
                return [fmt(value), name];
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />

            {/* THE WALL — vertical line dividing context from forecast */}
            <ReferenceLine
              x={chartData[wallIndex - 1]?.ts}
              stroke="#f59e0b"
              strokeWidth={2}
              strokeDasharray="6 3"
              label={{
                value: "◄ MODEL SEES | PREDICTS ►",
                position: "top",
                style: { fontSize: 10, fill: "#f59e0b", fontWeight: 600 },
              }}
            />

            {/* 90% confidence band */}
            <Area dataKey="band90" stroke="none" fill="rgba(59, 130, 246, 0.10)" name="90% Confidence" legendType="none" isAnimationActive={false} />

            {/* 50% confidence band */}
            <Area dataKey="band50" stroke="none" fill="rgba(59, 130, 246, 0.20)" name="50% Confidence" legendType="none" isAnimationActive={false} />

            {/* Context (actual past price) */}
            <Line dataKey="close" stroke="#94a3b8" strokeWidth={2} dot={false} name="Price (Context)" connectNulls={false} />

            {/* Actual future price */}
            <Line dataKey="actual" stroke="#E69F00" strokeWidth={2.5} dot={{ r: 2, fill: "#E69F00" }} name="Actual (Hidden from Model)" connectNulls={false} />

            {/* Model prediction */}
            <Line dataKey="predicted" stroke="#3b82f6" strokeWidth={2.5} strokeDasharray="6 3" dot={{ r: 2, fill: "#3b82f6" }} name="Chronos Prediction" connectNulls={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

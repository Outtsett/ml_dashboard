import React from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { EntityMetricsData } from "./useEntityProfile";
import { Activity } from "lucide-react";

interface EntityMetricsProps {
  metrics: EntityMetricsData[];
}

export function EntityMetrics({ metrics }: EntityMetricsProps) {
  if (!metrics || metrics.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-neutral-500 border border-neutral-800 rounded-lg bg-neutral-900/50">
        <Activity className="h-8 w-8 mb-3 opacity-20" />
        <p>No metrics available for this entity.</p>
      </div>
    );
  }

  // Extract all metric keys except timestamp
  const metricKeys = Array.from(
    new Set(metrics.flatMap((m) => Object.keys(m).filter((k) => k !== "timestamp")))
  );

  const colors = ["#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6"];

  return (
    <div className="h-[400px] w-full border border-neutral-800 rounded-lg bg-neutral-900/50 p-4">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={metrics} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#262626" vertical={false} />
          <XAxis 
            dataKey="timestamp" 
            stroke="#525252" 
            tickFormatter={(tick) => new Date(tick).toLocaleDateString()}
            tick={{ fontSize: 12 }}
            minTickGap={30}
          />
          <YAxis stroke="#525252" tick={{ fontSize: 12 }} />
          <Tooltip 
            contentStyle={{ backgroundColor: '#171717', borderColor: '#262626', color: '#f5f5f5' }}
            labelFormatter={(label) => new Date(label).toLocaleString()}
          />
          <Legend wrapperStyle={{ fontSize: '12px' }} />
          {metricKeys.map((key, index) => (
            <Line
              key={key}
              type="monotone"
              dataKey={key}
              stroke={colors[index % colors.length]}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

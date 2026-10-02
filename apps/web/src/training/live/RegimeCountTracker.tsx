/**
 * RegimeCountTracker — Shows how many regimes discovered over iterations.
 *
 * Visualizes the model exploring (count fluctuates) then settling (stabilizes).
 */
import { useMemo } from "react";
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid } from "recharts";

interface RegimeCountTrackerProps {
  iterationHistory: Array<{ iteration: number; metrics: Record<string, number> }>;
  isTraining: boolean;
}

export function RegimeCountTracker({ iterationHistory, isTraining: _isTraining }: RegimeCountTrackerProps) {
  const data = useMemo(() =>
    iterationHistory
      .filter(h => h.metrics?.activeStates != null)
      .map(h => ({
        iteration: h.iteration,
        regimes: Math.round(h.metrics.activeStates ?? 0),
      })),
    [iterationHistory],
  );

  const latest = data.length > 0 ? data[data.length - 1]!.regimes : 0;

  if (data.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground/40">
        <p className="text-xs font-mono">Waiting for regime discovery...</p>
      </div>
    );
  }

  return (
    <div className="h-full w-full">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/5">
        <span className="text-[10px] font-mono text-purple-400 font-medium">Active Regimes</span>
        <span className="text-[11px] font-mono text-purple-300 font-bold ml-auto">{latest}</span>
      </div>
      <ResponsiveContainer width="100%" height="85%">
        <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="iteration" tick={{ fontSize: 9, fill: '#6e7681' }} tickLine={false} />
          <YAxis
            tick={{ fontSize: 9, fill: '#6e7681' }}
            tickLine={false}
            width={28}
            domain={[0, 'auto']}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)', fontSize: 11 }}
          />
          <defs>
            <linearGradient id="regimeGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#a855f7" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#a855f7" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <Area
            type="stepAfter"
            dataKey="regimes"
            stroke="#a855f7"
            fill="url(#regimeGrad)"
            strokeWidth={1.5}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

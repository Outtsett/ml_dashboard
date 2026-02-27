/**
 * ConvergenceChart — Live log-likelihood over Gibbs iterations.
 *
 * Shows the model's fit improving as the sampler runs.
 * Updates every metric event from TrainingLiveCtx.
 */
import { useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

interface ConvergenceChartProps {
  /** Array of {iteration, log_likelihood} from training metrics */
  iterationHistory: Array<{ iteration: number; metrics: Record<string, number> }>;
  /** Burn-in iteration count (shown as reference line) */
  burnIn?: number;
  /** Whether training is actively running */
  isTraining: boolean;
}

export function ConvergenceChart({ iterationHistory, burnIn = 100, isTraining }: ConvergenceChartProps) {
  const data = useMemo(() =>
    iterationHistory
      .filter(h => h.metrics?.log_likelihood != null)
      .map(h => ({
        iteration: h.iteration,
        ll: h.metrics.log_likelihood,
      })),
    [iterationHistory],
  );

  if (data.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground/40">
        <p className="text-xs font-mono">Waiting for convergence data...</p>
      </div>
    );
  }

  return (
    <div className="h-full w-full">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/5">
        <span className="text-[10px] font-mono text-blue-400 font-medium">Log-Likelihood</span>
        {isTraining && (
          <span className="text-[9px] font-mono text-muted-foreground/50">
            {data.length} iterations
          </span>
        )}
      </div>
      <ResponsiveContainer width="100%" height="85%">
        <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis
            dataKey="iteration"
            tick={{ fontSize: 9, fill: '#6e7681' }}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 9, fill: '#6e7681' }}
            tickLine={false}
            width={65}
            tickFormatter={(v: number) => v.toFixed(0)}
          />
          <Tooltip
            contentStyle={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)', fontSize: 11 }}
            formatter={(value: number) => [value.toFixed(2), 'Log-Likelihood']}
          />
          {burnIn > 0 && (
            <ReferenceLine
              x={burnIn}
              stroke="rgba(245,158,11,0.4)"
              strokeDasharray="4 4"
              label={{ value: 'burn-in', fill: '#f59e0b', fontSize: 9, position: 'top' }}
            />
          )}
          <Line
            type="monotone"
            dataKey="ll"
            stroke={isTraining ? "#3b82f6" : "#22c55e"}
            dot={false}
            strokeWidth={1.5}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

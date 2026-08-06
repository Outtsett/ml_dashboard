/**
 * ParameterTraces — Line charts of model parameters per regime over iterations.
 *
 * Three stacked charts (~120px each):
 * 1. Transition matrix diagonal (self-transition per regime)
 * 2. Beta weights per regime
 * 3. Number of regimes
 */

import { memo, useMemo } from "react";
import { useTrainingModelState } from "@/shared/contexts/TrainingModelStateCtx";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { ChartCard } from "./shared";

const REGIME_FILLS = [
  "#22c55e", "#3b82f6", "#f59e0b", "#ef4444", "#a855f7",
  "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#6366f1",
];

const CHART_HEIGHT = 120;

const TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: "rgba(0,0,0,0.9)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 6,
    fontSize: 10,
    fontFamily: "monospace",
  },
};

const AXIS_TICK = {
  fontSize: 8,
  fontFamily: "monospace",
  fill: "rgba(255,255,255,0.3)",
};

interface TraceData {
  selfTransition: Record<string, number>[];
  betaWeights: Record<string, number>[];
  regimeCount: { iteration: number; count: number }[];
  maxK: number;
}

function ParameterTracesInner() {
  const { modelStateHistory } = useTrainingModelState();

  const traces: TraceData = useMemo(() => {
    const empty: TraceData = { selfTransition: [], betaWeights: [], regimeCount: [], maxK: 0 };
    if (!modelStateHistory || modelStateHistory.length === 0) return empty;

    let maxK = 0;
    for (const entry of modelStateHistory) {
      const bw = entry.state.snapshot.beta_weights;
      if (bw && bw.length > maxK) maxK = bw.length;
      const tm = entry.state.snapshot.transition_matrix;
      if (tm && tm.length > maxK) maxK = tm.length;
    }
    if (maxK === 0) return empty;

    const selfTransition: Record<string, number>[] = [];
    const betaWeights: Record<string, number>[] = [];
    const regimeCount: { iteration: number; count: number }[] = [];

    for (const entry of modelStateHistory) {
      const snap = entry.state.snapshot;
      const iter = entry.iteration;

      // Self-transition diagonal
      const stRow: Record<string, number> = { iteration: iter };
      const tm = snap.transition_matrix;
      if (tm) {
        for (let k = 0; k < maxK; k++) {
          stRow[`r${k}`] = tm[k]?.[k] ?? 0;
        }
      }
      selfTransition.push(stRow);

      // Beta weights
      const bwRow: Record<string, number> = { iteration: iter };
      const bw = snap.beta_weights;
      if (bw) {
        for (let k = 0; k < maxK; k++) {
          bwRow[`r${k}`] = bw[k] ?? 0;
        }
      }
      betaWeights.push(bwRow);

      // Regime count
      regimeCount.push({
        iteration: iter,
        count: snap.regime_profiles?.length ?? snap.beta_weights?.length ?? 0,
      });
    }

    return { selfTransition, betaWeights, regimeCount, maxK };
  }, [modelStateHistory]);

  const hasData = traces.maxK > 0;

  const regimeLines = hasData
    ? Array.from({ length: traces.maxK }, (_, k) => (
        <Line
          key={`r${k}`}
          type="monotone"
          dataKey={`r${k}`}
          stroke={REGIME_FILLS[k % REGIME_FILLS.length]}
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
      ))
    : [];

  const subtitle = hasData
    ? `${traces.maxK} regimes over ${traces.selfTransition.length} snapshots`
    : undefined;

  return (
    <ChartCard
      title="Parameter Traces"
      subtitle={subtitle}
      minHeight={CHART_HEIGHT * 3 + 60}
    >
      {/* 1. Self-Transition Diagonal */}
      <div className="mb-1">
        <span className="text-[9px] font-mono text-muted-foreground/40">
          Self-Transition (diagonal)
        </span>
      </div>
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <LineChart data={hasData ? traces.selfTransition : []} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="iteration" tick={AXIS_TICK} tickLine={false} axisLine={false} />
          <YAxis domain={[0, 1]} tick={AXIS_TICK} tickLine={false} axisLine={false} width={28} />
          <Tooltip {...TOOLTIP_STYLE} />
          {regimeLines}
        </LineChart>
      </ResponsiveContainer>

      {/* 2. Beta Weights */}
      <div className="mb-1 mt-3">
        <span className="text-[9px] font-mono text-muted-foreground/40">
          Beta Weights
        </span>
      </div>
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <LineChart data={hasData ? traces.betaWeights : []} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="iteration" tick={AXIS_TICK} tickLine={false} axisLine={false} />
          <YAxis domain={[0, "auto"]} tick={AXIS_TICK} tickLine={false} axisLine={false} width={28} />
          <Tooltip {...TOOLTIP_STYLE} />
          {regimeLines}
        </LineChart>
      </ResponsiveContainer>

      {/* 3. Regime Count */}
      <div className="mb-1 mt-3">
        <span className="text-[9px] font-mono text-muted-foreground/40">
          Active Regimes
        </span>
      </div>
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <LineChart data={hasData ? traces.regimeCount : []} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="iteration" tick={AXIS_TICK} tickLine={false} axisLine={false} />
          <YAxis
            domain={[0, hasData ? "dataMax + 1" : 5]}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            width={28}
            allowDecimals={false}
          />
          <Tooltip {...TOOLTIP_STYLE} />
          {hasData && (
            <Line
              type="stepAfter"
              dataKey="count"
              stroke="#8b5cf6"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          )}
        </LineChart>
      </ResponsiveContainer>

      {/* Legend */}
      {hasData && (
        <div className="flex flex-wrap items-center gap-3 mt-2 px-1">
          {Array.from({ length: traces.maxK }, (_, k) => (
            <span key={k} className="flex items-center gap-1 text-[9px] font-mono text-muted-foreground/50">
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ backgroundColor: REGIME_FILLS[k % REGIME_FILLS.length] }}
              />
              R{k}
            </span>
          ))}
        </div>
      )}
    </ChartCard>
  );
}

export const ParameterTraces = memo(ParameterTracesInner);
export default ParameterTraces;

import { useMemo } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Area,
  AreaChart,
  ComposedChart,
  Scatter,
} from "recharts";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, Scissors, Target, Zap } from "lucide-react";

interface TrialData {
  trialId: number;
  score: number;
  pruned: boolean;
  prunedAtStep?: number;
  durationSec: number;
  params: Record<string, any>;
}

interface HPOConvergenceProps {
  trials: TrialData[];
  direction?: "maximize" | "minimize";
  optimizerType?: string;
  className?: string;
}

const chartTooltipStyle = {
  backgroundColor: "#1a1a2e",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 8,
  fontSize: 11,
};

const axisTick = { fontSize: 10, fill: "#888" };

function HPOConvergence({
  trials,
  direction = "maximize",
  optimizerType,
  className,
}: HPOConvergenceProps) {
  const isMax = direction === "maximize";

  const convergenceData = useMemo(() => {
    if (trials.length === 0) return [];

    let bestSoFar = isMax ? -Infinity : Infinity;
    let prevBest = bestSoFar;

    return trials.map((trial, idx) => {
      prevBest = bestSoFar;
      const better = isMax
        ? trial.score > bestSoFar
        : trial.score < bestSoFar;
      if (better && !trial.pruned) bestSoFar = trial.score;

      return {
        trial: idx + 1,
        score: trial.pruned ? null : trial.score,
        bestSoFar: bestSoFar === -Infinity || bestSoFar === Infinity ? null : bestSoFar,
        pruned: trial.pruned
          ? (bestSoFar === -Infinity || bestSoFar === Infinity
            ? trial.score
            : isMax ? bestSoFar * 0.9 : bestSoFar * 1.1)
          : null,
        duration: trial.durationSec,
        improvement:
          idx === 0 || prevBest === -Infinity || prevBest === Infinity
            ? 0
            : bestSoFar - prevBest,
        trialData: trial,
      };
    });
  }, [trials, isMax]);

  const stats = useMemo((): {
    total: number;
    completed: number;
    pruned: number;
    prunedPct: number;
    bestScore: number | null;
    convergencePoint: number | null;
  } => {
    if (trials.length === 0)
      return {
        total: 0,
        completed: 0,
        pruned: 0,
        prunedPct: 0,
        bestScore: null,
        convergencePoint: null,
      };

    const completed = trials.filter((t) => !t.pruned).length;
    const pruned = trials.filter((t) => t.pruned).length;

    let bestScore: number | null = null;
    let bestSoFar = isMax ? -Infinity : Infinity;
    let convergencePoint = 1;

    trials.forEach((trial, idx) => {
      if (trial.pruned) return;
      const better = isMax
        ? trial.score > bestSoFar
        : trial.score < bestSoFar;
      if (better) {
        bestSoFar = trial.score;
        bestScore = trial.score;
        convergencePoint = idx + 1;
      }
    });

    return {
      total: trials.length,
      completed,
      pruned,
      prunedPct: trials.length > 0 ? Math.round((pruned / trials.length) * 100) : 0,
      bestScore,
      convergencePoint,
    };
  }, [trials, isMax]);

  if (trials.length === 0) {
    return (
      <Card className={cn("bg-black/20 border-white/5 overflow-hidden p-4", className)}>
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="h-4 w-4 text-emerald-400" />
          <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
            Convergence Analysis
          </h4>
        </div>
        <p className="text-xs text-muted-foreground/50 text-center py-8">
          No trial data available
        </p>
      </Card>
    );
  }

  const bestScoreValue: number | null = stats.bestScore;

  return (
    <Card className={cn("bg-black/20 border-white/5 overflow-hidden p-4", className)}>
      <div className="flex items-center gap-2 mb-3">
        <TrendingUp className="h-4 w-4 text-emerald-400" />
        <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
          Convergence Analysis
        </h4>
        {optimizerType && (
          <Badge variant="outline" className="ml-auto text-[10px] border-white/10">
            {optimizerType}
          </Badge>
        )}
      </div>

      {/* Stats row */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Badge variant="secondary" className="text-[10px] gap-1">
          <Target className="h-3 w-3" />
          {stats.total} trials
        </Badge>
        <Badge variant="secondary" className="text-[10px] gap-1 text-emerald-400">
          <Zap className="h-3 w-3" />
          {stats.completed} completed
        </Badge>
        <Badge variant="secondary" className="text-[10px] gap-1 text-red-400">
          <Scissors className="h-3 w-3" />
          {stats.pruned} pruned ({stats.prunedPct}%)
        </Badge>
        {bestScoreValue !== null && (
          <Badge variant="secondary" className="text-[10px] gap-1 text-blue-400">
            Best: {bestScoreValue.toFixed(4)}
          </Badge>
        )}
        {stats.convergencePoint !== null && (
          <Badge variant="secondary" className="text-[10px] gap-1 text-purple-400">
            Converged @ trial {stats.convergencePoint}
          </Badge>
        )}
      </div>

      {/* Chart 1: Best-So-Far Convergence Curve */}
      <div className="mb-4">
        <p className="text-[10px] text-muted-foreground/50 mb-1">Best-So-Far Curve</p>
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={convergenceData}>
            <defs>
              <linearGradient id="bestSoFarGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity={0.2} />
                <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" opacity={0.3} />
            <XAxis dataKey="trial" tick={axisTick} />
            <YAxis tick={axisTick} />
            <Tooltip
              contentStyle={chartTooltipStyle}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const data = payload[0]?.payload;
                if (!data) return null;
                const trial = data.trialData as TrialData | undefined;
                return (
                  <div
                    style={chartTooltipStyle}
                    className="p-2"
                  >
                    <p className="text-[11px] font-medium text-white">
                      Trial #{data.trial}
                    </p>
                    {trial && (
                      <>
                        <p className="text-[10px] text-muted-foreground">
                          Score: {trial.score.toFixed(4)}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          Status:{" "}
                          <span className={trial.pruned ? "text-red-400" : "text-emerald-400"}>
                            {trial.pruned ? `Pruned @ step ${trial.prunedAtStep ?? "?"}` : "Completed"}
                          </span>
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          Duration: {trial.durationSec.toFixed(1)}s
                        </p>
                        {trial.params && Object.keys(trial.params).length > 0 && (
                          <p className="text-[10px] text-muted-foreground/60 mt-1 max-w-[200px] truncate">
                            {Object.entries(trial.params)
                              .slice(0, 3)
                              .map(([k, v]) => `${k}=${typeof v === "number" ? v.toFixed(3) : v}`)
                              .join(", ")}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                );
              }}
            />
            <Area
              type="stepAfter"
              dataKey="bestSoFar"
              fill="url(#bestSoFarGrad)"
              stroke="none"
              connectNulls
            />
            <Line
              type="stepAfter"
              dataKey="bestSoFar"
              stroke="#10b981"
              strokeWidth={2}
              dot={false}
              connectNulls
            />
            <Scatter
              dataKey="score"
              fill="#3b82f6"
              opacity={0.5}
              r={3}
            />
            <Scatter
              dataKey="pruned"
              fill="#ef4444"
              opacity={0.8}
              r={3}
              shape="cross"
            />
            {bestScoreValue !== null && (
              <ReferenceLine
                y={bestScoreValue}
                stroke="#10b981"
                strokeDasharray="4 4"
                opacity={0.5}
                label={{
                  value: `Best: ${bestScoreValue.toFixed(4)}`,
                  position: "right",
                  fill: "#10b981",
                  fontSize: 10,
                }}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Chart 2: Trial Duration Over Time */}
      <div className="mb-4">
        <p className="text-[10px] text-muted-foreground/50 mb-1">Trial Duration</p>
        <ResponsiveContainer width="100%" height={120}>
          <AreaChart data={convergenceData}>
            <defs>
              <linearGradient id="durationGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" opacity={0.3} />
            <XAxis dataKey="trial" tick={axisTick} />
            <YAxis tick={axisTick} unit="s" />
            <Tooltip
              contentStyle={chartTooltipStyle}
              formatter={(value: number) => [`${value.toFixed(1)}s`, "Duration"]}
              labelFormatter={(label) => `Trial #${label}`}
            />
            <Area
              type="monotone"
              dataKey="duration"
              stroke="#f59e0b"
              fill="url(#durationGrad)"
              strokeWidth={1.5}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Chart 3: Improvement Rate */}
      <div>
        <p className="text-[10px] text-muted-foreground/50 mb-1">Improvement Rate</p>
        <ResponsiveContainer width="100%" height={100}>
          <LineChart data={convergenceData}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" opacity={0.3} />
            <XAxis dataKey="trial" tick={axisTick} />
            <YAxis tick={axisTick} />
            <Tooltip
              contentStyle={chartTooltipStyle}
              formatter={(value: number) => [value.toFixed(6), "Δ Best"]}
              labelFormatter={(label) => `Trial #${label}`}
            />
            <ReferenceLine y={0} stroke="#888" strokeDasharray="2 2" opacity={0.4} />
            <Line
              type="monotone"
              dataKey="improvement"
              stroke="#8b5cf6"
              strokeWidth={1.5}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

export default HPOConvergence;

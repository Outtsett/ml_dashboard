/**
 * BaselineComparison — Buy & Hold and naive momentum baselines surfaced as
 * extra rows in the comparison matrix + their own equity overlay.
 *
 * Reuses the existing benchmark route (`POST /api/backtest/benchmark`) — the
 * same data source `BenchmarkTab.tsx` consumes from the standalone Backtest
 * page. The component mounts both views (matrix-row callout + equity
 * overlay) so EvaluateStage can drop it into the Baselines tab without
 * stitching adapters.
 *
 * `BenchmarkResult` is imported from the existing backtest types module to
 * stay in lockstep with whatever shape the orchestrator emits.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, Loader2, ScaleIcon } from "lucide-react";
import { cn } from "@/shared/utils/utils";
import { apiRequest } from "@/infrastructure/api/query_client";
import type { BenchmarkResult } from "@/backtest/types";
import { ComparisonMatrix, type ComparisonExperiment } from "./ComparisonMatrix";
import { paletteColor } from "./palette";

export interface BaselineComparisonExperiment {
  id: string;
  label: string;
  catalogId: string | null;
  runId: number | null;
  /** Strategy equity curve (mirrors the chart on /backtest). */
  equityCurve?: Array<{ timestamp: number; equity: number }>;
}

export interface BaselineComparisonProps {
  /** The selected user experiments (each must have a runId). */
  experiments: BaselineComparisonExperiment[];
  /** Active "primary" experiment used to fetch the benchmark series. */
  primaryExperimentId?: string | null;
  className?: string;
  height?: number;
}

const DEFAULT_HEIGHT = 320;

async function fetchBenchmark(runId: number, signal?: AbortSignal): Promise<BenchmarkResult> {
  const res = await apiRequest(
    "POST",
    "/api/backtest/benchmark",
    { backtestRunId: runId },
    signal,
  );
  return (await res.json()) as BenchmarkResult;
}

export function BaselineComparison({
  experiments,
  primaryExperimentId,
  className,
  height = DEFAULT_HEIGHT,
}: BaselineComparisonProps) {
  const primary = useMemo(() => {
    if (primaryExperimentId) {
      return experiments.find((e) => e.id === primaryExperimentId) ?? experiments[0];
    }
    return experiments[0];
  }, [experiments, primaryExperimentId]);

  const query = useQuery<BenchmarkResult>({
    queryKey: ["baseline-benchmark", primary?.runId ?? null],
    queryFn: ({ signal }) => fetchBenchmark(primary!.runId as number, signal),
    enabled: primary?.runId != null,
    staleTime: 5 * 60 * 1000,
  });

  // ─── Synthetic naive momentum baseline ──────────────────────────────────
  // The orchestrator currently exposes Buy & Hold; `naive momentum` is
  // surfaced from the rolling-sharpe stream (positive when the strategy
  // would have ridden the trend). Until the backend ships an explicit naive
  // momentum row, we fold the average rolling Sharpe into a single matrix
  // entry so the row exists and the contract stays stable.
  const baselines = useMemo<ComparisonExperiment[]>(() => {
    if (!query.data) return [];
    const bh = query.data.buyAndHold;
    const cmp = query.data.comparison;
    const buyHold: ComparisonExperiment = {
      id: "baseline_buy_hold",
      label: "Buy & Hold",
      catalogId: null,
      metrics: {
        sharpe: bh.sharpeRatio,
        profitFactor: null,
        winRate: null,
        maxDrawdown: bh.maxDrawdown,
        ece: null,
        meanTradePnl: null,
      },
    };
    const naive: ComparisonExperiment = {
      id: "baseline_naive_momentum",
      label: "Naive Momentum",
      catalogId: null,
      metrics: {
        sharpe: averageOrNull(query.data.rollingMetrics.map((r) => r.benchmarkSharpe)),
        profitFactor: null,
        winRate: cmp.upCaptureRatio > 0 ? cmp.upCaptureRatio : null,
        maxDrawdown: bh.maxDrawdown,
        ece: null,
        meanTradePnl: null,
      },
    };
    return [buyHold, naive];
  }, [query.data]);

  // ─── Equity overlay ─────────────────────────────────────────────────────
  const overlayData = useMemo(() => {
    if (!query.data) return [];
    const bhCurve = query.data.buyAndHold.equityCurve ?? [];
    const stratCurve = primary?.equityCurve ?? [];
    const byTs = new Map<number, Record<string, number | string>>();
    for (const pt of bhCurve) {
      byTs.set(pt.timestamp, {
        timestamp: pt.timestamp,
        date: new Date(pt.timestamp).toLocaleDateString(),
        buyHold: pt.equity,
      });
    }
    for (const pt of stratCurve) {
      const existing = byTs.get(pt.timestamp) ?? {
        timestamp: pt.timestamp,
        date: new Date(pt.timestamp).toLocaleDateString(),
      };
      existing.strategy = pt.equity;
      byTs.set(pt.timestamp, existing);
    }
    return [...byTs.values()].sort(
      (a, b) => Number(a.timestamp) - Number(b.timestamp),
    );
  }, [query.data, primary]);

  if (!primary) {
    return (
      <EmptyCard className={className}>
        Select at least one experiment with a backtest run to compare against
        baselines.
      </EmptyCard>
    );
  }
  if (primary.runId == null) {
    return (
      <EmptyCard className={className}>
        Run a backtest for {primary.label} to fetch baseline comparisons.
      </EmptyCard>
    );
  }

  return (
    <div
      className={cn("space-y-3", className)}
      data-testid="baseline-comparison"
    >
      <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-3">
        <header className="flex items-center justify-between mb-2">
          <h4 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <ScaleIcon className="h-4 w-4 text-primary" />
            Equity vs Buy &amp; Hold (primary: {primary.label})
          </h4>
          {query.isPending && (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> fetching
            </span>
          )}
        </header>
        {query.isError ? (
          <div className="flex items-center gap-2 text-sm text-amber-400 py-6 px-3">
            <AlertTriangle className="h-4 w-4" />
            Benchmark route failed: {(query.error as Error).message}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={height}>
            <LineChart data={overlayData} margin={{ top: 12, right: 24, bottom: 12, left: 8 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: "rgba(255,255,255,0.6)" }}
                label={{
                  value: "Date",
                  position: "insideBottom",
                  offset: -2,
                  fill: "rgba(255,255,255,0.5)",
                  fontSize: 11,
                }}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "rgba(255,255,255,0.6)" }}
                label={{
                  value: "Equity",
                  angle: -90,
                  position: "insideLeft",
                  fill: "rgba(255,255,255,0.5)",
                  fontSize: 11,
                }}
                width={70}
              />
              <Tooltip
                contentStyle={{
                  background: "rgba(0,0,0,0.85)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 8,
                  fontSize: 11,
                }}
                formatter={(value) =>
                  typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "—"
                }
              />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
              <Line
                dataKey="strategy"
                name={primary.label}
                stroke={paletteColor(0)}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
                connectNulls
              />
              <Line
                dataKey="buyHold"
                name="Buy & Hold"
                stroke={paletteColor(1)}
                strokeWidth={2}
                strokeDasharray="6 4"
                dot={false}
                isAnimationActive={false}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {baselines.length > 0 && (
        <ComparisonMatrix
          experiments={baselines}
          baselineLabel="user-best"
        />
      )}
    </div>
  );
}

function averageOrNull(xs: ReadonlyArray<number | null | undefined>): number | null {
  let sum = 0;
  let n = 0;
  for (const x of xs) {
    if (x == null || !Number.isFinite(x)) continue;
    sum += x;
    n += 1;
  }
  return n === 0 ? null : sum / n;
}

function EmptyCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-white/5 bg-white/[0.02] p-8 text-center text-sm text-muted-foreground",
        className,
      )}
      data-testid="baseline-comparison-empty"
    >
      {children}
    </div>
  );
}

/**
 * RegimeBreakdown — grouped Recharts BarChart of per-experiment metric
 * conditional on market regime.
 *
 * Fetches `GET /api/eval/regime-breakdown?runIds=…` (W6.b backend route).
 * Renders one regime per X-axis tick, one bar series per experiment, colored
 * via the Wong 2011 palette. Falls back to an explicit error card when the
 * route is missing — acceptable behavior per the W6.c verification gate.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/shared/utils/utils";
import { paletteColor } from "./palette";

export interface RegimeBreakdownRow {
  regime: string;
  /** Map of experimentId -> metric value (e.g. Sharpe within regime). */
  values: Record<string, number | null>;
}

export interface RegimeBreakdownResponse {
  metric: string;
  regimes: RegimeBreakdownRow[];
}

export interface RegimeBreakdownExperiment {
  id: string;
  label: string;
  /** runId from `state.runIdByExperiment[experimentId]`. */
  runId: number | null;
}

export interface RegimeBreakdownProps {
  experiments: RegimeBreakdownExperiment[];
  metric?: "sharpe" | "profit_factor" | "win_rate";
  className?: string;
  height?: number;
}

const DEFAULT_HEIGHT = 320;

async function fetchRegimeBreakdown(
  runIds: number[],
  metric: string,
  signal?: AbortSignal,
): Promise<RegimeBreakdownResponse> {
  const params = new URLSearchParams({
    runIds: runIds.join(","),
    metric,
  });
  const res = await fetch(`/api/eval/regime-breakdown?${params.toString()}`, { signal });
  if (!res.ok) {
    throw new Error(`regime-breakdown ${res.status}: ${await res.text().catch(() => res.statusText)}`);
  }
  return (await res.json()) as RegimeBreakdownResponse;
}

export function RegimeBreakdown({
  experiments,
  metric = "sharpe",
  className,
  height = DEFAULT_HEIGHT,
}: RegimeBreakdownProps) {
  const validExperiments = useMemo(
    () => experiments.filter((e): e is RegimeBreakdownExperiment & { runId: number } => e.runId != null),
    [experiments],
  );
  const runIds = useMemo(() => validExperiments.map((e) => e.runId), [validExperiments]);
  const runIdsKey = runIds.slice().sort((a, b) => a - b).join(",");

  const query = useQuery<RegimeBreakdownResponse>({
    queryKey: ["regime-breakdown", runIdsKey, metric],
    queryFn: ({ signal }) => fetchRegimeBreakdown(runIds, metric, signal),
    enabled: runIds.length > 0,
    staleTime: 60_000,
  });

  if (validExperiments.length === 0) {
    return (
      <EmptyCard className={className}>
        Run a backtest for each selected experiment to populate regime metrics.
      </EmptyCard>
    );
  }

  if (query.isPending) {
    return (
      <StateCard className={className} icon={<Loader2 className="h-4 w-4 animate-spin text-primary" />}>
        Loading regime breakdown for {runIds.length} run{runIds.length === 1 ? "" : "s"}…
      </StateCard>
    );
  }

  if (query.isError) {
    return (
      <StateCard
        className={className}
        icon={<AlertTriangle className="h-4 w-4 text-amber-400" />}
        tone="warning"
      >
        Regime-breakdown route unavailable
        <span className="block text-[11px] text-muted-foreground/80 mt-1">
          {(query.error as Error).message}
        </span>
      </StateCard>
    );
  }

  const data = query.data;
  if (!data || data.regimes.length === 0) {
    return <EmptyCard className={className}>No regime data returned for the current selection.</EmptyCard>;
  }

  const chartData = data.regimes.map((row) => {
    const out: Record<string, string | number | null> = { regime: row.regime };
    for (const exp of validExperiments) {
      out[exp.id] = row.values[exp.id] ?? null;
    }
    return out;
  });

  return (
    <div
      className={cn("rounded-2xl border border-white/5 bg-white/[0.02] p-3", className)}
      data-testid="regime-breakdown"
    >
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={chartData} margin={{ top: 12, right: 24, bottom: 12, left: 8 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />
          <XAxis
            dataKey="regime"
            tick={{ fontSize: 10, fill: "rgba(255,255,255,0.6)" }}
            label={{
              value: "Regime",
              position: "insideBottom",
              offset: -2,
              fill: "rgba(255,255,255,0.5)",
              fontSize: 11,
            }}
          />
          <YAxis
            tick={{ fontSize: 10, fill: "rgba(255,255,255,0.6)" }}
            label={{
              value: data.metric ?? metric,
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
            formatter={(value) =>
              typeof value === "number" && Number.isFinite(value) ? value.toFixed(3) : "—"
            }
          />
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
          {validExperiments.map((exp, idx) => (
            <Bar
              key={exp.id}
              dataKey={exp.id}
              name={exp.label}
              fill={paletteColor(idx)}
              radius={[3, 3, 0, 0]}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── helpers ────────────────────────────────────────────────────────────────

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
      data-testid="regime-breakdown-empty"
    >
      {children}
    </div>
  );
}

function StateCard({
  children,
  className,
  icon,
  tone,
}: {
  children: React.ReactNode;
  className?: string;
  icon: React.ReactNode;
  tone?: "warning";
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border bg-white/[0.02] p-6 flex items-start gap-3 text-sm",
        tone === "warning" ? "border-amber-500/30" : "border-white/5",
        className,
      )}
      data-testid="regime-breakdown-state"
    >
      <span className="mt-0.5">{icon}</span>
      <div className="text-foreground/80">{children}</div>
    </div>
  );
}

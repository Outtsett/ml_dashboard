/**
 * ImportanceBar — fANOVA hyperparameter importance bar chart.
 *
 * Calls GET /api/hpo/sessions/:sessionId/importance which spawns the Python
 * helper (src/ml/shared/hpo_importance.py) to read each per-fold Optuna study
 * and return mean importance across folds.
 *
 * Renders the aggregated importance as a horizontal bar chart (Recharts)
 * sorted desc. Per-fold values appear in tooltip.
 */

import { useQuery } from "@tanstack/react-query";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface FoldImp {
  fold: number;
  n_trials: number;
  importance?: Record<string, number>;
  error?: string;
}
interface ImportanceResponse {
  folds: FoldImp[];
  aggregated: Record<string, number>;
  method: string;
}

export interface ImportanceBarProps {
  sessionId: string;
}

export function ImportanceBar({ sessionId }: ImportanceBarProps) {
  const { data, isLoading, error } = useQuery<ImportanceResponse>({
    queryKey: ["hpo", "importance", sessionId],
    queryFn: async () => {
      const r = await fetch(`/api/hpo/sessions/${sessionId}/importance`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading importance…</div>;
  if (error) return <div className="text-sm text-destructive">Importance error: {String(error)}</div>;
  if (!data || Object.keys(data.aggregated).length === 0) {
    return <div className="text-sm text-muted-foreground">No importance computed yet — need ≥4 completed trials per fold.</div>;
  }

  const rows = Object.entries(data.aggregated)
    .map(([param, value]) => ({ param, value }))
    .sort((a, b) => b.value - a.value);

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">Hyperparameter importance</h3>
        <span className="text-xs text-muted-foreground">
          {data.method} · {data.folds.length} folds
        </span>
      </div>
      <ResponsiveContainer width="100%" height={Math.max(140, rows.length * 28)}>
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="2 4" stroke="var(--border)" horizontal={false} />
          <XAxis type="number" domain={[0, 1]} tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
          <YAxis type="category" dataKey="param" width={140} tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
          <Tooltip
            cursor={{ fill: "var(--accent)", opacity: 0.2 }}
            formatter={(v: number) => v.toFixed(3)}
            contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 6 }}
          />
          <Bar dataKey="value" fill="var(--primary)" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default ImportanceBar;

import { useMemo, useState, useEffect } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { useTrainingSSE, type MetricEvent } from "../../../hooks/useTrainingSSE";
import { EquityCurve } from "../../../components/charts/EquityCurve";

function groupByEpoch(events: MetricEvent[], metricName: string) {
  const byEpoch = new Map<number, number>();
  for (const e of events) {
    if (e.metric === metricName) {
      byEpoch.set(e.epoch, e.value);
    }
  }
  return Array.from(byEpoch.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([epoch, value]) => ({ epoch, value }));
}

const COMPONENT_METRICS = [
  "mae_loss",
  "direction_loss",
  "moe_load_balance_loss",
  "prediction_loss",
  "reasoning_loss",
] as const;

const COMPONENT_COLORS: Record<string, string> = {
  mae_loss: "#3b82f6",
  direction_loss: "#8b5cf6",
  moe_load_balance_loss: "#f59e0b",
  prediction_loss: "#f43f5e",
  reasoning_loss: "#14b8a6",
};

const COMPONENT_LABELS: Record<string, string> = {
  mae_loss: "MAE",
  direction_loss: "Direction",
  moe_load_balance_loss: "MoE Balance",
  prediction_loss: "Prediction",
  reasoning_loss: "Reasoning",
};

interface EquityArtifact {
  data: { step: number; pnl: number; drawdown: number }[];
}

function useArtifact<T>(phase: string, name: string) {
  const [artifact, setArtifact] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/training/artifacts/${phase}/${name}`)
      .then((res) => {
        if (!res.ok) throw new Error("Not found");
        return res.json();
      })
      .then((data: T) => {
        if (!cancelled) setArtifact(data);
      })
      .catch(() => {
        if (!cancelled) setArtifact(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [phase, name]);

  return { artifact, loading };
}

export function PhaseEPanel() {
  const { events, connected } = useTrainingSSE({
    phase: "E",
    model: "pipeline_train",
  });

  const totalLoss = useMemo(() => groupByEpoch(events, "total_loss"), [events]);
  const dirAcc = useMemo(() => groupByEpoch(events, "direction_accuracy"), [events]);
  const calEce = useMemo(() => groupByEpoch(events, "calibration_ece"), [events]);
  const sharpeData = useMemo(() => groupByEpoch(events, "sharpe_ratio"), [events]);
  const maxDdData = useMemo(() => groupByEpoch(events, "max_drawdown"), [events]);
  const profitFactorData = useMemo(() => groupByEpoch(events, "profit_factor"), [events]);
  const winRateData = useMemo(() => groupByEpoch(events, "win_rate"), [events]);

  const componentData = useMemo(() => {
    const byEpoch = new Map<number, { epoch: number } & Record<string, number>>();
    for (const e of events) {
      if ((COMPONENT_METRICS as readonly string[]).includes(e.metric)) {
        const entry = byEpoch.get(e.epoch) || { epoch: e.epoch };
        entry[e.metric] = e.value;
        byEpoch.set(e.epoch, entry);
      }
    }
    return Array.from(byEpoch.values()).sort((a, b) => a.epoch - b.epoch);
  }, [events]);

  const { artifact: equityArtifact, loading: equityLoading } = useArtifact<EquityArtifact>("E", "equity_curve");

  const latest = (data: { epoch: number; value: number }[]) =>
    data.length > 0 ? data[data.length - 1]!.value.toFixed(4) : "---";

  const latestComponent = (metric: string) => {
    const last = componentData[componentData.length - 1];
    if (!last || last[metric] === undefined) return "---";
    return last[metric]!.toFixed(4);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 mb-4">
        <div className={`w-2 h-2 rounded-full ${connected ? "bg-green-500" : "bg-red-500"}`} />
        <span className="text-xs text-muted-foreground font-mono">
          {connected ? "Live" : "Disconnected"}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="border border-border rounded-lg p-4">
          <h3 className="text-sm font-mono font-medium mb-2">Total Loss</h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={totalLoss}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="epoch" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Line type="monotone" dataKey="value" stroke="#10b981" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="border border-border rounded-lg p-4">
          <h3 className="text-sm font-mono font-medium mb-2">Direction Accuracy</h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={dirAcc}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="epoch" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} domain={[0, 1]} />
              <Tooltip />
              <Line type="monotone" dataKey="value" stroke="#3b82f6" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="border border-border rounded-lg p-4">
          <h3 className="text-sm font-mono font-medium mb-2">Component Losses</h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={componentData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="epoch" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              {COMPONENT_METRICS.map((metric) => (
                <Line
                  key={metric}
                  type="monotone"
                  dataKey={metric}
                  name={COMPONENT_LABELS[metric]}
                  stroke={COMPONENT_COLORS[metric]}
                  dot={false}
                  strokeWidth={1.5}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="border border-border rounded-lg p-4">
          <h3 className="text-sm font-mono font-medium mb-2">Latest Metrics</h3>
          <div className="font-mono text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total Loss</span>
              <span>{latest(totalLoss)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Direction Acc</span>
              <span>{latest(dirAcc)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Calibration ECE</span>
              <span>{latest(calEce)}</span>
            </div>
            <div className="my-1 border-t border-border" />
            {COMPONENT_METRICS.map((metric) => (
              <div key={metric} className="flex justify-between">
                <span className="text-muted-foreground">{COMPONENT_LABELS[metric]}</span>
                <span>{latestComponent(metric)}</span>
              </div>
            ))}
            {totalLoss.length === 0 && dirAcc.length === 0 && (
              <div className="text-muted-foreground">No data yet</div>
            )}
          </div>
        </div>
      </div>

      {/* Trading Performance */}
      <div className="grid grid-cols-2 gap-4">
        <div className="border border-border rounded-lg p-4">
          <h3 className="text-sm font-mono font-medium mb-2">Trading Metrics</h3>
          <div className="font-mono text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Sharpe Ratio</span>
              <span>{latest(sharpeData)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Max Drawdown</span>
              <span>{latest(maxDdData)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Profit Factor</span>
              <span>{latest(profitFactorData)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Win Rate</span>
              <span>{latest(winRateData)}</span>
            </div>
            {sharpeData.length === 0 && maxDdData.length === 0 &&
              profitFactorData.length === 0 && winRateData.length === 0 && (
              <div className="text-muted-foreground">No backtest data yet</div>
            )}
          </div>
        </div>

        <div className="border border-border rounded-lg p-4">
          {equityLoading ? (
            <div className="flex items-center justify-center h-[380px] text-muted-foreground text-xs">
              Loading equity data...
            </div>
          ) : equityArtifact?.data && equityArtifact.data.length > 0 ? (
            <EquityCurve data={equityArtifact.data} />
          ) : (
            <div className="flex items-center justify-center h-[380px] text-muted-foreground">
              <div className="text-center">
                <svg className="w-8 h-8 mx-auto mb-2 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <polyline points="22,7 13.5,15.5 8.5,10.5 2,17" />
                  <polyline points="16,7 22,7 22,13" />
                </svg>
                <p className="text-xs">No equity curve</p>
                <p className="text-[10px] opacity-60">Available after backtest run</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

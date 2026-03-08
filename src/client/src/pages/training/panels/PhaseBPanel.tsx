import { useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useTrainingSSE, type MetricEvent } from "../../../hooks/useTrainingSSE";

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

export function PhaseBPanel() {
  const { events, connected } = useTrainingSSE({
    phase: "B",
    model: "pipeline_train",
  });

  const moeLoss = useMemo(() => groupByEpoch(events, "moe_load_balance_loss"), [events]);
  const regimeCount = useMemo(() => groupByEpoch(events, "regime_count_stable"), [events]);
  const slotEntropy = useMemo(() => groupByEpoch(events, "slot_entropy"), [events]);
  const totalLoss = useMemo(() => groupByEpoch(events, "total_loss"), [events]);

  const latest = (data: { epoch: number; value: number }[]) =>
    data.length > 0 ? data[data.length - 1]!.value.toFixed(4) : "---";

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
          <h3 className="text-sm font-mono font-medium mb-2">MoE Load Balance Loss</h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={moeLoss}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="epoch" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Line type="monotone" dataKey="value" stroke="#3b82f6" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="border border-border rounded-lg p-4">
          <h3 className="text-sm font-mono font-medium mb-2">Active Regime Count</h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={regimeCount}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="epoch" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Line type="monotone" dataKey="value" stroke="#8b5cf6" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="border border-border rounded-lg p-4">
          <h3 className="text-sm font-mono font-medium mb-2">Slot Entropy</h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={slotEntropy}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="epoch" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Line type="monotone" dataKey="value" stroke="#f59e0b" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="border border-border rounded-lg p-4">
          <h3 className="text-sm font-mono font-medium mb-2">Latest Metrics</h3>
          <div className="font-mono text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">MoE Loss</span>
              <span>{latest(moeLoss)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Regime Count</span>
              <span>{latest(regimeCount)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Slot Entropy</span>
              <span>{latest(slotEntropy)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total Loss</span>
              <span>{latest(totalLoss)}</span>
            </div>
            {moeLoss.length === 0 && regimeCount.length === 0 && (
              <div className="text-muted-foreground">No data yet</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

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
import { useMetricStream, type MetricEvent } from "@/training/lib/useTrainingSSE";

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

export function PhaseAPanel() {
  const { events, connected } = useMetricStream({
    phase: "A",
    model: "pipeline_train",
  });

  const maeLoss = useMemo(() => groupByEpoch(events, "mae_loss"), [events]);
  const dirLoss = useMemo(() => groupByEpoch(events, "direction_loss"), [events]);
  const totalLoss = useMemo(() => groupByEpoch(events, "total_loss"), [events]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 mb-4">
        <div className={`w-2 h-2 rounded-full ${connected ? "bg-[hsl(var(--data-pos))]" : "bg-[hsl(var(--data-neg))]"}`} />
        <span className="text-xs text-muted-foreground font-mono">
          {connected ? "Live" : "Disconnected"}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="border border-border rounded-lg p-4">
          <h3 className="text-sm font-mono font-medium mb-2">MAE Reconstruction Loss</h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={maeLoss}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="epoch" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Line type="monotone" dataKey="value" stroke="#3b82f6" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="border border-border rounded-lg p-4">
          <h3 className="text-sm font-mono font-medium mb-2">Direction Contrastive Loss</h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={dirLoss}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="epoch" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Line type="monotone" dataKey="value" stroke="#8b5cf6" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="border border-border rounded-lg p-4">
          <h3 className="text-sm font-mono font-medium mb-2">Total Phase A Loss</h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={totalLoss}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="epoch" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Line type="monotone" dataKey="value" stroke="#E69F00" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="border border-border rounded-lg p-4">
          <h3 className="text-sm font-mono font-medium mb-2">Latest Metrics</h3>
          <div className="font-mono text-xs space-y-1">
            {maeLoss.length > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">MAE Loss</span>
                <span>{maeLoss[maeLoss.length - 1]!.value.toFixed(4)}</span>
              </div>
            )}
            {dirLoss.length > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Direction Loss</span>
                <span>{dirLoss[dirLoss.length - 1]!.value.toFixed(4)}</span>
              </div>
            )}
            {totalLoss.length > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total Loss</span>
                <span>{totalLoss[totalLoss.length - 1]!.value.toFixed(4)}</span>
              </div>
            )}
            {maeLoss.length === 0 && dirLoss.length === 0 && (
              <div className="text-muted-foreground">No data yet</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

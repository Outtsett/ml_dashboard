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

export function PhaseCPanel() {
  const { events, connected } = useMetricStream({
    phase: "C",
    model: "pipeline_train",
  });

  const supervisedLoss = useMemo(() => groupByEpoch(events, "supervised_loss"), [events]);
  const consistencyLoss = useMemo(() => groupByEpoch(events, "consistency_loss"), [events]);
  const consistencyWeight = useMemo(() => groupByEpoch(events, "consistency_weight"), [events]);
  const totalLoss = useMemo(() => groupByEpoch(events, "total_loss"), [events]);

  const latest = (data: { epoch: number; value: number }[]) =>
    data.length > 0 ? data[data.length - 1]!.value.toFixed(4) : "---";

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
          <h3 className="text-sm font-mono font-medium mb-2">Supervised Loss</h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={supervisedLoss}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="epoch" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Line type="monotone" dataKey="value" stroke="#3b82f6" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="border border-border rounded-lg p-4">
          <h3 className="text-sm font-mono font-medium mb-2">Consistency Loss</h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={consistencyLoss}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="epoch" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Line type="monotone" dataKey="value" stroke="#8b5cf6" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="border border-border rounded-lg p-4">
          <h3 className="text-sm font-mono font-medium mb-2">Consistency Weight</h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={consistencyWeight}>
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
              <span className="text-muted-foreground">Supervised Loss</span>
              <span>{latest(supervisedLoss)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Consistency Loss</span>
              <span>{latest(consistencyLoss)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Consistency Weight</span>
              <span>{latest(consistencyWeight)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total Loss</span>
              <span>{latest(totalLoss)}</span>
            </div>
            {supervisedLoss.length === 0 && consistencyLoss.length === 0 && (
              <div className="text-muted-foreground">No data yet</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

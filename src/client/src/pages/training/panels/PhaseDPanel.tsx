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

export function PhaseDPanel() {
  const { events, connected } = useTrainingSSE({
    phase: "D",
    model: "pipeline_train",
  });

  const dirLoss = useMemo(() => groupByEpoch(events, "direction_loss"), [events]);
  const predLoss = useMemo(() => groupByEpoch(events, "prediction_loss"), [events]);
  const reasonLoss = useMemo(() => groupByEpoch(events, "reasoning_loss"), [events]);
  const dirAcc = useMemo(() => groupByEpoch(events, "direction_accuracy"), [events]);
  const calEce = useMemo(() => groupByEpoch(events, "calibration_ece"), [events]);
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

      <div className="grid grid-cols-3 gap-4">
        <div className="border border-border rounded-lg p-4">
          <h3 className="text-sm font-mono font-medium mb-2">Direction Loss</h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={dirLoss}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="epoch" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Line type="monotone" dataKey="value" stroke="#3b82f6" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="border border-border rounded-lg p-4">
          <h3 className="text-sm font-mono font-medium mb-2">Prediction Loss</h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={predLoss}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="epoch" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Line type="monotone" dataKey="value" stroke="#8b5cf6" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="border border-border rounded-lg p-4">
          <h3 className="text-sm font-mono font-medium mb-2">Reasoning Loss</h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={reasonLoss}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="epoch" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Line type="monotone" dataKey="value" stroke="#f59e0b" dot={false} strokeWidth={2} />
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
              <Line type="monotone" dataKey="value" stroke="#10b981" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="border border-border rounded-lg p-4">
          <h3 className="text-sm font-mono font-medium mb-2">Calibration ECE</h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={calEce}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="epoch" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Line type="monotone" dataKey="value" stroke="#ef4444" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="border border-border rounded-lg p-4">
          <h3 className="text-sm font-mono font-medium mb-2">Latest Metrics</h3>
          <div className="font-mono text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Direction Loss</span>
              <span>{latest(dirLoss)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Prediction Loss</span>
              <span>{latest(predLoss)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Reasoning Loss</span>
              <span>{latest(reasonLoss)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Direction Acc</span>
              <span>{latest(dirAcc)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Calibration ECE</span>
              <span>{latest(calEce)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total Loss</span>
              <span>{latest(totalLoss)}</span>
            </div>
            {dirLoss.length === 0 && predLoss.length === 0 && (
              <div className="text-muted-foreground">No data yet</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

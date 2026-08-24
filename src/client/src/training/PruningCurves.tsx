/**
 * PruningCurves — one line per trial showing intermediate values reported
 * during boosting, fed by the `hpo-trial-intermediate` SSE events.
 *
 * Trials that were pruned end early (visible drop in line length); they're
 * also colored desaturated red. Live trials keep extending while the run is
 * in flight. Hover any line to see trial id + final score.
 */

import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";

interface IntermediatePoint {
  step: number;
  value: number;
}
interface TrialSnapshot {
  trialId: number;
  fold?: number;
  status: "running" | "completed" | "pruned" | "killed" | "failed";
  intermediates: IntermediatePoint[];
  finalScore?: number;
}

export interface PruningCurvesProps {
  sessionId: string;
  /** Optional fold filter for nested HPO; undefined shows all folds combined. */
  fold?: number;
}

interface SseEnvelope { type: string; data: any; ts: number }

export function PruningCurves({ sessionId, fold }: PruningCurvesProps) {
  const [trials, setTrials] = useState<Map<number, TrialSnapshot>>(new Map());

  useEffect(() => {
    const es = new EventSource(`/api/hpo/stream/${sessionId}`);

    const pickIntermediate = (msg: MessageEvent) => {
      try {
        const data = JSON.parse(msg.data);
        const tid = data.trialId as number;
        const f = data.fold as number | undefined;
        if (fold !== undefined && f !== fold) return;
        setTrials(prev => {
          const next = new Map(prev);
          const cur = next.get(tid) ?? {
            trialId: tid, fold: f, status: "running", intermediates: [],
          };
          cur.intermediates = [...cur.intermediates, { step: data.step, value: data.value }];
          next.set(tid, cur);
          return next;
        });
      } catch { /* ignore */ }
    };

    const setStatus = (status: TrialSnapshot["status"]) => (msg: MessageEvent) => {
      try {
        const data = JSON.parse(msg.data);
        const tid = data.trialId as number;
        const f = data.fold as number | undefined;
        if (fold !== undefined && f !== fold) return;
        setTrials(prev => {
          const next = new Map(prev);
          const cur = next.get(tid) ?? {
            trialId: tid, fold: f, status: "running", intermediates: [],
          };
          cur.status = status;
          if (status === "completed" && typeof data.score === "number") cur.finalScore = data.score;
          next.set(tid, cur);
          return next;
        });
      } catch { /* ignore */ }
    };

    es.addEventListener("hpo-trial-intermediate", pickIntermediate as any);
    es.addEventListener("hpo-trial-done", setStatus("completed") as any);
    es.addEventListener("hpo-trial-pruned", setStatus("pruned") as any);
    es.addEventListener("hpo-trial-killed", setStatus("killed") as any);

    return () => es.close();
  }, [sessionId, fold]);

  const colorFor = (status: TrialSnapshot["status"]) => ({
    running: "var(--primary)",
    completed: "var(--chart-2)",
    pruned: "var(--destructive)",
    killed: "var(--destructive)",
    failed: "var(--muted-foreground)",
  }[status]);

  // Build a single Recharts dataset by step with one column per trial.
  const { rows, lines } = useMemo(() => {
    const arr = Array.from(trials.values()).sort((a, b) => a.trialId - b.trialId);
    const stepSet = new Set<number>();
    for (const t of arr) for (const p of t.intermediates) stepSet.add(p.step);
    const steps = Array.from(stepSet).sort((a, b) => a - b);
    const lookup: Record<number, Record<number, number>> = {};
    for (const t of arr) {
      lookup[t.trialId] = {};
      for (const p of t.intermediates) lookup[t.trialId]![p.step] = p.value;
    }
    const rows = steps.map(s => {
      const row: Record<string, number> = { step: s };
      for (const t of arr) {
        const v = lookup[t.trialId]?.[s];
        if (v !== undefined) row[`t${t.trialId}`] = v;
      }
      return row;
    });
    const lines = arr.map(t => ({
      key: `t${t.trialId}`, label: `#${t.trialId}`,
      stroke: colorFor(t.status), opacity: t.status === "running" ? 1 : 0.7,
      dashed: t.status === "pruned" || t.status === "killed",
    }));
    return { rows, lines };
  }, [trials]);

  if (lines.length === 0) {
    return <div className="text-sm text-muted-foreground">No intermediate values yet — pruner needs ≥50 boost rounds before reporting.</div>;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">Pruning curves {fold !== undefined ? `(fold ${fold})` : ""}</h3>
        <span className="text-xs text-muted-foreground">{lines.length} trials</span>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={rows} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="2 4" stroke="var(--border)" />
          <XAxis dataKey="step" type="number" domain={["auto", "auto"]} tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
          <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
          <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 11 }} />
          {lines.map(l => (
            <Line key={l.key} type="monotone" dataKey={l.key} name={l.label}
                  stroke={l.stroke} strokeOpacity={l.opacity}
                  strokeDasharray={l.dashed ? "4 4" : undefined}
                  dot={false} isAnimationActive={false} strokeWidth={1.2} />
          ))}
          <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default PruningCurves;

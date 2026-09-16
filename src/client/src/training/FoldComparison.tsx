/**
 * FoldComparison — per-fold best-params + score table for nested HPO.
 *
 * Subscribes to `hpo-fold-best` and `hpo-fold-final` SSE events. Renders a
 * sortable table with one row per fold and a delta-vs-mean indicator on the
 * primary score. Highlights regime-drift if any fold's score is >1σ off.
 */

import { useEffect, useMemo, useState } from "react";

interface FoldRow {
  fold: number;
  bestParams?: Record<string, number | string | boolean>;
  bestScore?: number;
  modelId?: string;
  metrics?: Record<string, number>;
}

export interface FoldComparisonProps {
  sessionId: string;
}

export function FoldComparison({ sessionId }: FoldComparisonProps) {
  const [folds, setFolds] = useState<Map<number, FoldRow>>(new Map());

  useEffect(() => {
    const es = new EventSource(`/api/hpo/stream/${sessionId}`);

    const onBest = (msg: MessageEvent) => {
      try {
        const data = JSON.parse(msg.data);
        setFolds(prev => {
          const next = new Map(prev);
          const cur: FoldRow = next.get(data.fold) ?? { fold: data.fold };
          cur.bestParams = data.bestParams;
          cur.bestScore = data.bestScore;
          next.set(data.fold, cur);
          return next;
        });
      } catch { /* ignore */ }
    };
    const onFinal = (msg: MessageEvent) => {
      try {
        const data = JSON.parse(msg.data);
        setFolds(prev => {
          const next = new Map(prev);
          const cur: FoldRow = next.get(data.fold) ?? { fold: data.fold };
          cur.modelId = data.modelId;
          cur.metrics = data.metrics;
          next.set(data.fold, cur);
          return next;
        });
      } catch { /* ignore */ }
    };

    es.addEventListener("hpo-fold-best", onBest as EventListener);
    es.addEventListener("hpo-fold-final", onFinal as EventListener);
    return () => es.close();
  }, [sessionId]);

  const rows = useMemo(() => Array.from(folds.values()).sort((a, b) => a.fold - b.fold), [folds]);

  const stats = useMemo(() => {
    const xs = rows.map(r => r.bestScore).filter((x): x is number => typeof x === "number" && !Number.isNaN(x));
    if (xs.length === 0) return { mean: NaN, std: NaN };
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, xs.length - 1);
    return { mean, std: Math.sqrt(variance) };
  }, [rows]);

  const allParamKeys = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) if (r.bestParams) for (const k of Object.keys(r.bestParams)) s.add(k);
    return Array.from(s).sort();
  }, [rows]);

  if (rows.length === 0) {
    return <div className="text-sm text-muted-foreground">Waiting for the first fold to complete…</div>;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">Per-fold best params</h3>
        <span className="text-xs text-muted-foreground">
          mean = {Number.isFinite(stats.mean) ? stats.mean.toFixed(4) : "—"} ·
          σ = {Number.isFinite(stats.std) ? stats.std.toFixed(4) : "—"}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="text-left border-b border-border">
              <th className="py-1 pr-3">Fold</th>
              <th className="py-1 pr-3">Best score</th>
              <th className="py-1 pr-3">Δ vs mean</th>
              {allParamKeys.map(k => <th key={k} className="py-1 pr-3 font-mono">{k}</th>)}
              <th className="py-1 pr-3">Model id</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const delta = (typeof r.bestScore === "number" && Number.isFinite(stats.mean))
                ? r.bestScore - stats.mean : NaN;
              const deltaSigmas = Number.isFinite(stats.std) && stats.std > 0
                ? delta / stats.std : NaN;
              const deltaClass = !Number.isFinite(deltaSigmas)
                ? "text-muted-foreground"
                : Math.abs(deltaSigmas) >= 1.5
                  ? "text-destructive"
                  : "text-foreground";
              return (
                <tr key={r.fold} className="border-b border-border/60 hover:bg-accent/30">
                  <td className="py-1 pr-3 font-mono">{r.fold}</td>
                  <td className="py-1 pr-3 font-mono">
                    {typeof r.bestScore === "number" ? r.bestScore.toFixed(4) : "—"}
                  </td>
                  <td className={`py-1 pr-3 font-mono ${deltaClass}`}>
                    {Number.isFinite(delta) ? `${delta >= 0 ? "+" : ""}${delta.toFixed(4)}` : "—"}
                    {Number.isFinite(deltaSigmas) ? ` (${deltaSigmas.toFixed(1)}σ)` : ""}
                  </td>
                  {allParamKeys.map(k => (
                    <td key={k} className="py-1 pr-3 font-mono">
                      {r.bestParams?.[k] !== undefined
                        ? typeof r.bestParams[k] === "number"
                          ? (r.bestParams[k] as number).toFixed(4)
                          : String(r.bestParams[k])
                        : "—"}
                    </td>
                  ))}
                  <td className="py-1 pr-3 truncate max-w-[200px] text-muted-foreground">{r.modelId ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default FoldComparison;

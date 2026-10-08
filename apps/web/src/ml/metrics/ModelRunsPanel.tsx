/**
 * The measured results of one catalog model: its real runs, read from the run
 * API, or a plain statement that it has none. A model that has never run has no
 * number to show; nothing here is estimated, simulated or filled in.
 *
 * A run belongs to the specification through the runnable model that links to
 * it (`registryModelKey` on the specification's metrics record). Runs of the
 * same model on the same series are its versions; they are compared on the run
 * page's Versions view, never against another model.
 */
import { useLocation } from "wouter";

import { useSpecificationMetrics } from "@/ml/metrics/api";
import { useRunList } from "@/runs/api";
import { formatStarted, STATUS_STYLE } from "@/runs/format";
import { howComputed } from "@/runs/howComputed";

export function ModelRunsPanel({ specificationId, name }: { specificationId: string; name: string }) {
  const [, navigate] = useLocation();
  const metrics = useSpecificationMetrics(specificationId);
  const runs = useRunList();
  const modelKey = metrics.data?.record.registryModelKey ?? null;

  if (metrics.isLoading || runs.isLoading) {
    return <div className="rounded-md border border-border bg-card/60 p-3 text-[11px] text-muted-foreground">Reading this model's runs.</div>;
  }
  if (modelKey === null) {
    return (
      <div className="rounded-md border border-border bg-card/60 p-3 text-[12px] leading-snug text-muted-foreground" data-testid="model-runs-not-runnable">
        {name} is not run by the Model Cycle, so no measured number exists for it. Its Metrics panel says what it would be judged on.
      </div>
    );
  }
  const own = (runs.data ?? []).filter((run) => run.modelType === `${modelKey}+walk_forward_cycle`);
  if (own.length === 0) {
    return (
      <div className="space-y-2 rounded-md border border-border bg-card/60 p-3" data-testid="model-runs-empty">
        <div className="text-[12px] leading-snug text-foreground">
          {name} has not been run, so no measured number exists for it yet. It runs in the Model Cycle as <code className="font-mono">{modelKey}</code>.
        </div>
        <button
          type="button"
          onClick={() => navigate(`/training?model=${encodeURIComponent(modelKey)}`)}
          className="cursor-pointer rounded border border-[#E69F00]/60 bg-[#E69F00]/10 px-2 py-1 font-mono text-[11px] text-[#E69F00] hover:bg-[#E69F00]/20"
        >
          Open {modelKey} in AI Studio to launch its first run
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-2" data-testid="model-runs">
      <div className="text-[11px] leading-snug text-muted-foreground">
        The {own.length} recorded {own.length === 1 ? "run" : "runs"} of {name} (Model Cycle model <code className="font-mono">{modelKey}</code>), newest first. Each row opens the run with every chart and number. Runs of the
        same model on the same series are its versions; compare them on the run page's Versions view.
      </div>
      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left font-mono text-[10px] uppercase text-muted-foreground">
              <th className="px-3 py-1.5">Run</th>
              <th className="px-3 py-1.5">Started</th>
              <th className="px-3 py-1.5">Series</th>
              <th className="px-3 py-1.5">Status</th>
              <th className="cursor-help px-3 py-1.5 text-right" title={howComputed("sharpe_ratio", "Sharpe ratio")}>
                Sharpe ratio
              </th>
              <th className="cursor-help px-3 py-1.5 text-right" title={howComputed("trade_count", "Closed trades")}>
                Closed trades
              </th>
            </tr>
          </thead>
          <tbody>
            {own.map((run) => (
              <tr key={run.id} onClick={() => navigate(`/training?run=${encodeURIComponent(run.id)}`)} className="cursor-pointer border-b border-border/50 last:border-0 hover:bg-muted/20" data-testid={`model-run-${run.id}`}>
                <td className="px-3 py-1.5 font-mono text-foreground">
                  {run.name} <span className="text-muted-foreground">v{run.version}</span>
                </td>
                <td className="px-3 py-1.5 font-mono text-muted-foreground">{formatStarted(run.startedAt)}</td>
                <td className="px-3 py-1.5 font-mono text-muted-foreground">
                  {run.symbol ?? "unknown"} {run.timeframe ?? ""}
                </td>
                <td className="px-3 py-1.5 font-mono" style={{ color: STATUS_STYLE[run.status].color }}>
                  {STATUS_STYLE[run.status].glyph} {STATUS_STYLE[run.status].label}
                </td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums text-foreground">{run.sharpeRatio === null ? "not defined" : run.sharpeRatio.toFixed(2)}</td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums text-foreground">{run.tradeCount.toLocaleString("en-US")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

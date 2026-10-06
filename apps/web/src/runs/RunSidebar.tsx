/**
 * The left rail: launch a run, and every run there is (live first, then the
 * recorded ones, newest first). One click opens a run; nothing else lives here.
 */
import { useState } from "react";
import { Play } from "lucide-react";

import { useSymbolContext } from "@/shared/contexts/SymbolContext";
import { useRunnableModels, useStartRun } from "@/runs/api";
import { formatStarted, shortModelType, STATUS_STYLE } from "@/runs/format";
import type { RunListItem, StartRunResponse } from "@shared/runs/types";

const TIMEFRAMES = [
  { label: "1m", minutes: 1 },
  { label: "5m", minutes: 5 },
  { label: "15m", minutes: 15 },
  { label: "30m", minutes: 30 },
  { label: "1h", minutes: 60 },
];

const FIELD = "h-7 w-full rounded border border-border bg-transparent px-2 font-mono text-[12px] text-foreground outline-none focus:border-foreground/50";

function Launcher({ onStarted }: { onStarted: (response: StartRunResponse) => void }) {
  const selection = useSymbolContext();
  const models = useRunnableModels();
  const start = useStartRun(onStarted);
  const [model, setModel] = useState("xgboost");
  const [symbol, setSymbol] = useState(selection.symbol || "MNQ");
  const [timeframe, setTimeframe] = useState(TIMEFRAMES.find((entry) => entry.minutes === selection.timeframeMinutes)?.label ?? "5m");
  const [trials, setTrials] = useState(20);
  const [folds, setFolds] = useState(3);
  const [showCall, setShowCall] = useState(false);

  const known = models.data?.find((entry) => entry.key === model || entry.displayName === model);
  const body = {
    model: known?.key ?? model,
    symbol: symbol.toUpperCase(),
    timeframe,
    parameters: { tuning_budget_trials: trials, fold_limit: folds },
  };
  const call = `curl -X POST http://127.0.0.1:5000/api/runs -H "content-type: application/json" -d '${JSON.stringify(body)}'`;

  return (
    <div className="space-y-1.5 border-b border-border p-2">
      <div className="font-mono text-[11px] font-bold uppercase text-foreground">New run</div>
      <input
        list="runnable-models"
        value={model}
        onChange={(event) => setModel(event.target.value)}
        placeholder={models.isLoading ? "Loading models" : "Model"}
        className={FIELD}
        data-testid="launch-model"
      />
      <datalist id="runnable-models">
        {(models.data ?? []).map((entry) => (
          <option key={entry.key} value={entry.key}>
            {entry.displayName} · {entry.category}
          </option>
        ))}
      </datalist>
      <div className="font-mono text-[10px] leading-tight text-muted-foreground">
        {known ? `${known.displayName} · ${known.kind} · ${known.estimatedTrainingTime ?? known.speed ?? ""}` : `${models.data?.length ?? 0} models can run. Type to search.`}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <input value={symbol} onChange={(event) => setSymbol(event.target.value)} className={FIELD} aria-label="Symbol" />
        <select value={timeframe} onChange={(event) => setTimeframe(event.target.value)} className={FIELD} aria-label="Timeframe">
          {TIMEFRAMES.map((entry) => (
            <option key={entry.label} value={entry.label} className="bg-background">
              {entry.label}
            </option>
          ))}
        </select>
        <label className="font-mono text-[10px] text-muted-foreground">
          Search trials per fold
          <input type="number" min={0} max={500} value={trials} onChange={(event) => setTrials(Number(event.target.value))} className={FIELD} />
        </label>
        <label className="font-mono text-[10px] text-muted-foreground">
          Folds
          <input type="number" min={1} max={50} value={folds} onChange={(event) => setFolds(Number(event.target.value))} className={FIELD} />
        </label>
      </div>
      <button
        type="button"
        disabled={start.isPending || model.trim() === ""}
        onClick={() => start.mutate(body)}
        className="flex h-8 w-full cursor-pointer items-center justify-center gap-1.5 rounded bg-[#E69F00] font-mono text-[12px] font-bold text-black disabled:cursor-not-allowed disabled:opacity-50"
        data-testid="launch-run"
      >
        <Play className="h-3.5 w-3.5" />
        {start.isPending ? "Starting" : "Run"}
      </button>
      <button type="button" onClick={() => setShowCall(!showCall)} className="cursor-pointer font-mono text-[10px] text-muted-foreground underline-offset-2 hover:underline">
        {showCall ? "Hide" : "Show"} the call Claude makes for this
      </button>
      {showCall && <pre className="whitespace-pre-wrap break-all rounded border border-border bg-black/40 p-2 font-mono text-[10px] text-muted-foreground">{call}</pre>}
    </div>
  );
}

function RunRow({ run, selected, onSelect }: { run: RunListItem; selected: boolean; onSelect: () => void }) {
  const status = STATUS_STYLE[run.status];
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`block w-full cursor-pointer border-b border-border/50 px-2 py-1.5 text-left ${selected ? "bg-foreground/10" : "hover:bg-foreground/5"}`}
      data-testid="run-row"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-mono text-[12px] font-semibold text-foreground">{shortModelType(run.modelType)}</span>
        <span className="shrink-0 font-mono text-[10px] font-bold" style={{ color: status.color }}>
          {status.glyph} {status.label}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2 font-mono text-[10px] text-muted-foreground">
        <span>
          {run.symbol ?? "?"} {run.timeframe ?? ""} · {formatStarted(run.startedAt)}
        </span>
        <span>{run.sharpeRatio === null ? "" : `Sharpe ${run.sharpeRatio.toFixed(2)}`}</span>
      </div>
    </button>
  );
}

export function RunSidebar({
  runs,
  selectedId,
  onSelect,
  onStarted,
}: {
  runs: RunListItem[];
  selectedId: string | null;
  onSelect: (runId: string) => void;
  onStarted: (response: StartRunResponse) => void;
}) {
  const [search, setSearch] = useState("");
  const needle = search.trim().toLowerCase();
  const shown = needle === "" ? runs : runs.filter((run) => `${run.modelType} ${run.symbol} ${run.timeframe} ${run.status}`.toLowerCase().includes(needle));
  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-border bg-card/40">
      <Launcher onStarted={onStarted} />
      <div className="flex items-center gap-2 border-b border-border px-2 py-1.5">
        <span className="font-mono text-[11px] font-bold uppercase text-foreground">Runs</span>
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter" className={`${FIELD} h-6`} />
        <span className="font-mono text-[10px] text-muted-foreground">{shown.length}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {shown.map((run) => (
          <RunRow key={run.id} run={run} selected={run.id === selectedId} onSelect={() => onSelect(run.id)} />
        ))}
        {shown.length === 0 && <div className="p-3 font-mono text-[11px] text-muted-foreground">No runs yet. Launch one above.</div>}
      </div>
    </aside>
  );
}

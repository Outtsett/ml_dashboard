/**
 * The left rail: launch a run, and every run there is (live first, then the
 * recorded ones, newest first). One click opens a run; nothing else lives here.
 */
import { useState } from "react";
import { Play } from "lucide-react";

import { useSymbolContext } from "@/shared/contexts/SymbolContext";
import { usePreflight, useRunnableModels, useStartRun } from "@/runs/api";
import { formatStarted, shortModelType, STATUS_STYLE } from "@/runs/format";
import type { RunListItem, StartRunResponse } from "@shared/runs/types";

const TIMEFRAMES = [
  { label: "1m", minutes: 1 },
  { label: "5m", minutes: 5 },
  { label: "15m", minutes: 15 },
  { label: "30m", minutes: 30 },
  { label: "1h", minutes: 60 },
];

interface LaunchPreferences {
  followChart: boolean;
  symbol: string;
  timeframe: string;
  target: "direction" | "reversal";
}

const LAUNCH_PREFERENCES_KEY = "run-launch-v1";
// MNQ on 5-minute bars, detecting reversals: the series and the target the work is on until changed here
const DEFAULT_LAUNCH: LaunchPreferences = { followChart: false, symbol: "MNQ", timeframe: "5m", target: "reversal" };

function readLaunchPreferences(): LaunchPreferences {
  try {
    const raw = window.localStorage.getItem(LAUNCH_PREFERENCES_KEY);
    if (!raw) return DEFAULT_LAUNCH;
    const parsed = JSON.parse(raw) as Partial<LaunchPreferences>;
    return {
      followChart: parsed.followChart === true,
      symbol: typeof parsed.symbol === "string" && parsed.symbol ? parsed.symbol : DEFAULT_LAUNCH.symbol,
      timeframe: typeof parsed.timeframe === "string" && parsed.timeframe ? parsed.timeframe : DEFAULT_LAUNCH.timeframe,
      target: parsed.target === "direction" ? "direction" : "reversal",
    };
  } catch {
    return DEFAULT_LAUNCH;
  }
}

function writeLaunchPreferences(next: LaunchPreferences): void {
  try {
    window.localStorage.setItem(LAUNCH_PREFERENCES_KEY, JSON.stringify(next));
  } catch {
    // storage can be unavailable; the form still works for the session
  }
}

const FIELD = "h-7 w-full rounded border border-border bg-transparent px-2 font-mono text-[12px] text-foreground outline-none focus:border-foreground/50";

function Launcher({ onStarted }: { onStarted: (response: StartRunResponse) => void }) {
  const selection = useSymbolContext();
  const models = useRunnableModels();
  const start = useStartRun(onStarted);
  // the catalog's "Train" lands here with ?model=<key>
  const [model, setModel] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get("model") ?? "";
    } catch {
      return "";
    }
  });
  // the launcher keeps its own series (MNQ 5m until changed here); "Follow chart" makes it
  // track the Market chart's selection instead. Remembered in localStorage.
  const remembered = readLaunchPreferences();
  const [followChart, setFollowChartState] = useState(remembered.followChart);
  const [symbol, setSymbolState] = useState(remembered.symbol);
  const [timeframe, setTimeframeState] = useState(remembered.timeframe);
  const [target, setTargetState] = useState<"direction" | "reversal">(remembered.target);
  const [trials, setTrials] = useState(20);
  const [folds, setFolds] = useState(3);
  const chartTimeframe = TIMEFRAMES.find((entry) => entry.minutes === selection.timeframeMinutes)?.label ?? timeframe;
  const effectiveSymbol = followChart ? selection.symbol || symbol : symbol;
  const effectiveTimeframe = followChart ? chartTimeframe : timeframe;
  function remember(next: Partial<LaunchPreferences>) {
    writeLaunchPreferences({ followChart, symbol, timeframe, target, ...next });
  }
  const setSymbol = (value: string) => { setSymbolState(value); remember({ symbol: value }); };
  const setTimeframe = (value: string) => { setTimeframeState(value); remember({ timeframe: value }); };
  const setTarget = (value: "direction" | "reversal") => { setTargetState(value); remember({ target: value }); };
  const setFollowChart = (value: boolean) => { setFollowChartState(value); remember({ followChart: value }); };

  const known = models.data?.find((entry) => entry.key === model || entry.displayName === model);
  const body = {
    model: known?.key ?? model,
    symbol: effectiveSymbol.toUpperCase(),
    timeframe: effectiveTimeframe,
    parameters: { tuning_budget_trials: trials, fold_limit: folds, label_kind: target },
  };
  const preflight = usePreflight({ model: body.model, symbol: body.symbol, timeframe: effectiveTimeframe });
  const blocked = preflight.data ? !preflight.data.ready : false;

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
      <div className="grid grid-cols-2 gap-1.5">
        <input value={effectiveSymbol} disabled={followChart} onChange={(event) => setSymbol(event.target.value)} className={`${FIELD} disabled:opacity-60`} aria-label="Symbol" />
        <select value={effectiveTimeframe} disabled={followChart} onChange={(event) => setTimeframe(event.target.value)} className={`${FIELD} disabled:opacity-60`} aria-label="Timeframe">
          {TIMEFRAMES.map((entry) => (
            <option key={entry.label} value={entry.label} className="bg-background">
              {entry.label}
            </option>
          ))}
        </select>
        <label className="col-span-2 flex cursor-pointer items-center gap-1.5 font-mono text-[10px] text-muted-foreground" title="On: the symbol and timeframe follow the Market chart's selection. Off: the launcher keeps its own (MNQ 5m until changed here).">
          <input type="checkbox" checked={followChart} onChange={(event) => setFollowChart(event.target.checked)} data-testid="launch-follow-chart" />
          Follow the Market chart's symbol and timeframe
        </label>
        <label className="col-span-2 font-mono text-[10px] text-muted-foreground" title="Direction: will the close N bars ahead be above or below this bar's close. Reversal: will the next N bars turn against the previous N bars.">
          What the model predicts
          <select value={target} onChange={(event) => setTarget(event.target.value as "direction" | "reversal")} className={FIELD} aria-label="Target" data-testid="launch-target">
            <option value="direction" className="bg-background">Direction: up or down over the horizon</option>
            <option value="reversal" className="bg-background">Reversal: the next bars turn against the previous bars</option>
          </select>
        </label>
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
        disabled={start.isPending || model.trim() === "" || blocked}
        title={blocked ? preflight.data?.checks.filter((check) => !check.ok).map((check) => check.detail).join("; ") : undefined}
        onClick={() => start.mutate(body)}
        className="flex h-8 w-full cursor-pointer items-center justify-center gap-1.5 rounded bg-[#E69F00] font-mono text-[12px] font-bold text-black disabled:cursor-not-allowed disabled:opacity-50"
        data-testid="launch-run"
      >
        <Play className="h-3.5 w-3.5" />
        {start.isPending ? "Starting" : blocked ? "Not ready" : "Run"}
      </button>
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
        <span className="truncate font-mono text-[12px] font-semibold text-foreground">{run.name}</span>
        <span className="shrink-0 font-mono text-[10px] font-bold" style={{ color: status.color }}>
          {status.glyph} {status.label}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2 font-mono text-[10px] text-muted-foreground">
        <span>
          {shortModelType(run.modelType)} v{run.version} · {run.symbol ?? "?"} {run.timeframe ?? ""} · {formatStarted(run.startedAt)}
        </span>
        <span>{run.sharpeRatio === null ? "" : `Sharpe ${run.sharpeRatio.toFixed(2)}`}</span>
      </div>
    </button>
  );
}

/** One model on one series: every run of `xgboost` on MNQ 5m sits under one header, newest first. */
interface RunGroupItem {
  key: string;
  modelType: string;
  symbol: string | null;
  timeframe: string | null;
  runs: RunListItem[];
}

function groupRuns(runs: RunListItem[]): RunGroupItem[] {
  const groups = new Map<string, RunGroupItem>();
  for (const run of runs) {
    const key = `${run.modelType}|${run.symbol ?? ""}|${run.timeframe ?? ""}`;
    const group = groups.get(key) ?? { key, modelType: run.modelType, symbol: run.symbol, timeframe: run.timeframe, runs: [] };
    group.runs.push(run);
    groups.set(key, group);
  }
  // the list arrives newest first, so a group's first run is its newest; groups order by their newest run
  return [...groups.values()].sort((a, b) => b.runs[0]!.startedAt - a.runs[0]!.startedAt);
}

function RunGroup({
  group,
  open,
  onToggle,
  selectedId,
  onSelect,
}: {
  group: RunGroupItem;
  open: boolean;
  onToggle: () => void;
  selectedId: string | null;
  onSelect: (runId: string) => void;
}) {
  const newest = group.runs[0]!;
  const live = group.runs.filter((run) => run.status === "running").length;
  return (
    <div className="border-b border-border/70">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full cursor-pointer items-center gap-1.5 bg-foreground/[0.04] px-2 py-1 text-left hover:bg-foreground/[0.08]"
        data-testid="run-group"
      >
        <span className="font-mono text-[10px] text-muted-foreground">{open ? "▾" : "▸"}</span>
        <span className="truncate font-mono text-[11px] font-bold text-foreground">
          {shortModelType(group.modelType)} · {group.symbol ?? "?"} {group.timeframe ?? ""}
        </span>
        <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
          {live > 0 ? `${live} live · ` : ""}
          {group.runs.length} run{group.runs.length === 1 ? "" : "s"}
        </span>
      </button>
      {open ? (
        group.runs.map((run) => <RunRow key={run.id} run={run} selected={run.id === selectedId} onSelect={() => onSelect(run.id)} />)
      ) : (
        <RunRow run={newest} selected={newest.id === selectedId} onSelect={() => onSelect(newest.id)} />
      )}
    </div>
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
  const [opened, setOpened] = useState<Set<string>>(() => new Set());
  const needle = search.trim().toLowerCase();
  function toggle(key: string) {
    setOpened((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  const shown = needle === "" ? runs : runs.filter((run) => `${run.name} ${run.modelType} v${run.version} ${run.symbol} ${run.timeframe} ${run.status} ${run.purpose}`.toLowerCase().includes(needle));
  const groups = groupRuns(shown);
  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-border bg-card/40">
      <Launcher onStarted={onStarted} />
      <div className="flex items-center gap-2 border-b border-border px-2 py-1.5">
        <span className="font-mono text-[11px] font-bold uppercase text-foreground">Runs</span>
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter" className={`${FIELD} h-6`} />
        <span className="font-mono text-[10px] text-muted-foreground">{shown.length} in {groups.length}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {groups.map((group) => (
          <RunGroup
            key={group.key}
            group={group}
            open={needle !== "" || opened.has(group.key) || group.runs.some((run) => run.id === selectedId)}
            onToggle={() => toggle(group.key)}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        ))}
        {shown.length === 0 && <div className="p-3 font-mono text-[11px] text-muted-foreground">No runs yet. Launch one above.</div>}
      </div>
    </aside>
  );
}

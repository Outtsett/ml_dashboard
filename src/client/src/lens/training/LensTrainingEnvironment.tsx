/**
 * The Lens training environment.
 *
 * Press play, watch a bar become a prediction. Ten stages, each showing the real
 * tensor at that point in the forward pass, plus the run history and the log of
 * every event the run wrote.
 *
 * Polling, not SSE, on purpose: the run writes an append-only file, so a page
 * opened mid-run and a page opened a week later take the same path, and closing
 * the tab cannot orphan a stream. The poll asks only for events past the last
 * index it holds.
 */
import { useEffect, useMemo, useState } from "react";
import { Play, RefreshCw, Activity } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { LensFrame } from "../Frame";
import {
  eventsOfType, useStartTraining, useTrainingRuns, useTrainingStream,
  type BatchEvent, type EpochEvent, type LayersEvent, type StartRunRequest,
} from "./api";
import {
  AttentionStage, EmbedStage, LossGradientStage, PositionStage, PredictStage,
  RawBarsStage, VectorizeStage,
} from "./stages";
import {
  LAYOUTS, LayoutPicker, StageLayout, type LayoutId, type StagePanel,
} from "./layouts";

const LAYOUT_STORAGE_KEY = "lens-training-layout";

const DEFAULTS: StartRunRequest = {
  symbol: "MNQ",
  // 1h, not 1m: this workspace has measured direction at 1m as a coin flip
  // across six independent methods, and 1h/4h as the one place a positive-
  // expectancy primary exists. A default that trains where nothing is learnable
  // teaches the wrong lesson on the first run.
  timeframe: "1h",
  maxBars: 40_000,
  epochs: 15,
  horizon: 12,
  // 25 points against a 1.40-point round-trip break-even — a correct call clears
  // cost many times over, so the label is about direction rather than about
  // whether the barrier was reachable at all.
  barrierPoints: 25,
  window: 32,
};

function NumberField({ label, value, onChange, step = 1, hint }: {
  label: string; value: number; onChange: (value: number) => void;
  step?: number; hint?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</Label>
      <Input type="number" value={value} step={step}
             onChange={event => onChange(Number(event.target.value))}
             className="h-7 font-mono text-xs" />
      {hint && <div className="text-[9px] text-zinc-600">{hint}</div>}
    </div>
  );
}

export function LensTrainingEnvironment() {
  const [request, setRequest] = useState<StartRunRequest>(DEFAULTS);
  const [run, setRun] = useState<string | null>(null);
  const [epoch, setEpoch] = useState<number>(0);
  const [block, setBlock] = useState<string | null>(null);
  const [live, setLive] = useState(true);
  // Remembered per browser: which arrangement suits the work is a preference,
  // and re-picking it on every visit is the kind of friction that makes a person
  // stop using the switcher at all.
  const [layout, setLayoutRaw] = useState<LayoutId>(() => {
    try {
      // Validated, not cast: the layout set has changed once already, and a
      // stored id that no longer exists leaves the picker with nothing lit.
      const stored = localStorage.getItem(LAYOUT_STORAGE_KEY);
      return LAYOUTS.some(l => l.id === stored) ? (stored as LayoutId) : "theatre";
    } catch {
      return "theatre";
    }
  });
  const setLayout = (next: LayoutId) => {
    setLayoutRaw(next);
    try { localStorage.setItem(LAYOUT_STORAGE_KEY, next); } catch { /* private mode */ }
  };

  const runs = useTrainingRuns(live ? 3_000 : 0);
  const start = useStartTraining();

  // Default to the most recently written run, once.
  useEffect(() => {
    if (run === null && runs.data?.runs.length) setRun(runs.data.runs[0]!.run);
  }, [run, runs.data]);

  const summary = runs.data?.runs.find(r => r.run === run) ?? null;
  const isRunning = summary?.status === "running" || summary?.status === "starting";
  const stream = useTrainingStream(run, live && isRunning ? 2_000 : 0);
  const events = stream.data?.events ?? [];

  const epochs = eventsOfType<EpochEvent>(events, "epoch");
  const batches = eventsOfType<BatchEvent>(events, "batch");
  const layerEvents = eventsOfType<LayersEvent>(events, "layers");
  const latestEpoch = epochs.length > 0 ? epochs[epochs.length - 1]!.epoch : 0;

  // Follow the front of a live run; hold position once it finishes so a scrub
  // is not yanked forward by the next poll.
  useEffect(() => {
    if (isRunning || epoch === 0) setEpoch(latestEpoch);
  }, [latestEpoch, isRunning, epoch]);

  const capturedEpochs = useMemo(
    () => layerEvents.map(l => l.epoch).sort((a, b) => a - b), [layerEvents]);
  const shownEpoch = capturedEpochs.includes(epoch)
    ? epoch : capturedEpochs[capturedEpochs.length - 1] ?? latestEpoch;

  return (
    <div className="space-y-3">
      {/* ── Run controls ───────────────────────────────────────────────── */}
      <LensFrame
        title="Run"
        question="Press play. Everything below fills in as it trains."
        basis={runs.data ? `${runs.data.runs.length} run(s) on disk` : undefined}
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setLive(v => !v)}
                    className="h-7 gap-1.5 text-xs">
              <Activity className={`h-3 w-3 ${live ? "text-[#E69F00]" : "text-zinc-500"}`} />
              {live ? "Live" : "Paused"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => void runs.refetch()}
                    className="h-7 gap-1.5 text-xs">
              <RefreshCw className="h-3 w-3" /> Refresh
            </Button>
            <LayoutPicker value={layout} onChange={setLayout} />
          </div>
        }
        resizeKey="lens-train-run" defaultHeight={200}
      >
        <div className="grid grid-cols-7 gap-3">
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wider text-zinc-500">Symbol</Label>
            <Input value={request.symbol} className="h-7 font-mono text-xs"
                   onChange={e => setRequest(r => ({ ...r, symbol: e.target.value.toUpperCase() }))} />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wider text-zinc-500">Timeframe</Label>
            <Input value={request.timeframe} className="h-7 font-mono text-xs"
                   onChange={e => setRequest(r => ({ ...r, timeframe: e.target.value }))} />
          </div>
          <NumberField label="Bars" value={request.maxBars} step={1000}
                       onChange={v => setRequest(r => ({ ...r, maxBars: v }))} />
          <NumberField label="Epochs" value={request.epochs}
                       onChange={v => setRequest(r => ({ ...r, epochs: v }))} />
          <NumberField label="Window" value={request.window} hint="bars per sample"
                       onChange={v => setRequest(r => ({ ...r, window: v }))} />
          <NumberField label="Horizon" value={request.horizon} hint="bars ahead"
                       onChange={v => setRequest(r => ({ ...r, horizon: v }))} />
          <NumberField label="Barrier" value={request.barrierPoints} step={0.25}
                       hint="points; break-even 1.40"
                       onChange={v => setRequest(r => ({ ...r, barrierPoints: v }))} />
        </div>

        <div className="mt-3 flex items-center gap-3">
          <Button size="sm" disabled={start.isPending}
                  onClick={() => start.mutate(request, {
                    onSuccess: result => { setRun(result.run); setEpoch(0); setLive(true); },
                  })}
                  className="h-8 gap-1.5 bg-[#E69F00] text-black hover:bg-[#E69F00]/85">
            <Play className="h-3.5 w-3.5" />
            {start.isPending ? "Starting…" : "Train"}
          </Button>
          {summary && (
            <span className="font-mono text-[11px] text-zinc-400">
              {summary.run} · {summary.status}
              {summary.epochs > 0 && ` · epoch ${summary.epoch}/${summary.epochs}`}
            </span>
          )}
          {start.isError && (
            <span className="font-mono text-[11px] text-[#D55E00]">
              {(start.error as Error).message}
            </span>
          )}
          {start.isSuccess && !start.isPending && (
            <span className="font-mono text-[10px] text-zinc-600">
              pid {start.data.pid ?? "—"}
            </span>
          )}
        </div>
      </LensFrame>

      {/* ── Run history ────────────────────────────────────────────────── */}
      <LensFrame
        title="Runs"
        question="Every sweep this machine has trained, newest first."
        resizeKey="lens-train-history" defaultHeight={180}
      >
        {(runs.data?.runs.length ?? 0) === 0 ? (
          <div className="text-[11px] text-zinc-500">
            No runs yet. Press Train above to record one.
          </div>
        ) : (
          <div className="space-y-[2px]">
            {runs.data!.runs.map(entry => {
              const skill = entry.finalMetrics?.skill ?? entry.metrics.skill;
              return (
                <button key={entry.run} onClick={() => { setRun(entry.run); setEpoch(0); }}
                        className={`flex w-full items-center gap-3 rounded px-2 py-1 text-left transition-colors ${
                          entry.run === run ? "bg-white/[0.06]" : "hover:bg-white/[0.03]"}`}>
                  <span className="w-56 shrink-0 truncate font-mono text-[11px] text-zinc-200">
                    {entry.run}
                  </span>
                  <span className={`w-16 shrink-0 font-mono text-[10px] ${
                    entry.status === "running" ? "text-[#E69F00]" : "text-zinc-500"}`}>
                    {entry.status}
                  </span>
                  <span className="w-24 shrink-0 font-mono text-[10px] text-zinc-500">
                    {entry.epoch}/{entry.epochs} epochs
                  </span>
                  <span className="w-32 shrink-0 font-mono text-[10px] text-zinc-400">
                    {typeof skill === "number"
                      ? `skill ${skill >= 0 ? "+" : ""}${skill.toFixed(4)}` : "—"}
                  </span>
                  <span className="flex-1 truncate font-mono text-[10px] text-zinc-600">
                    {String(entry.config.symbol ?? "")} {String(entry.config.timeframe ?? "")}
                    {entry.config.barrier_points ? ` · ±${entry.config.barrier_points}pt` : ""}
                    {entry.config.horizon ? ` · h${entry.config.horizon}` : ""}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-zinc-600">
                    {new Date(entry.modifiedAt).toLocaleString()}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </LensFrame>

      {run && (
        <>
          {/* ── Epoch scrub ──────────────────────────────────────────────── */}
          {capturedEpochs.length > 0 && (
            <div className="flex items-center gap-3 px-1">
              <span className="text-[10px] uppercase tracking-wider text-zinc-500">Epoch</span>
              <input type="range" min={capturedEpochs[0]} max={capturedEpochs[capturedEpochs.length - 1]}
                     value={shownEpoch} step={1} className="flex-1 accent-[#E69F00]"
                     onChange={event => setEpoch(Number(event.target.value))} />
              <span className="w-24 font-mono text-[11px] text-zinc-300">
                {shownEpoch} / {capturedEpochs[capturedEpochs.length - 1]}
              </span>
            </div>
          )}

          <StageLayout layout={layout} stages={([
            { id: "bars", label: "1 · Raw bars", side: "input",
              node: <RawBarsStage run={run} events={events} /> },
            { id: "vectorize", label: "2/3 · Vectorize", side: "input",
              node: <VectorizeStage run={run} events={events}
                                    block={block} onBlockChange={setBlock} /> },
            { id: "embed", label: "4/5 · Embed", side: "input",
              node: <EmbedStage events={events} epoch={shownEpoch} /> },
            { id: "position", label: "6 · Position", side: "network",
              node: <PositionStage run={run} events={events} epoch={shownEpoch} /> },
            { id: "attention", label: "7/8 · Attention", side: "network",
              node: <AttentionStage events={events} epoch={shownEpoch} /> },
            { id: "predict", label: "9 · Predict", side: "network",
              node: <PredictStage events={events} epoch={shownEpoch} /> },
            { id: "loss", label: "10 · Loss & gradient", side: "network",
              node: <LossGradientStage events={events} epoch={shownEpoch} /> },
          ] satisfies StagePanel[])} />

          {/* ── The log ──────────────────────────────────────────────────── */}
          <LensFrame
            title="Log"
            question="Every event this run wrote, in order."
            basis={`${events.length} events · ${batches.length} batch ticks`}
            resizeKey="lens-train-log" defaultHeight={220}
          >
            <div className="space-y-[1px] font-mono text-[10px]">
              {events.slice().reverse().slice(0, 200).map((event, index) => (
                <div key={index} className="flex gap-3 text-zinc-500">
                  <span className="w-16 shrink-0 text-right text-zinc-600">
                    {typeof event.elapsed_seconds === "number"
                      ? `${(event.elapsed_seconds as number).toFixed(1)}s` : ""}
                  </span>
                  <span className="w-28 shrink-0 text-zinc-300">{event.type}</span>
                  <span className="truncate">
                    {Object.entries(event)
                      .filter(([key]) => !["type", "elapsed_seconds", "config", "fields",
                                           "readings", "gradient_norms"].includes(key))
                      .map(([key, value]) =>
                        `${key}=${typeof value === "object" ? JSON.stringify(value) : String(value)}`)
                      .join("  ")}
                  </span>
                </div>
              ))}
            </div>
          </LensFrame>
        </>
      )}

      {!run && (runs.data?.runs.length ?? 0) === 0 && (
        <LensFrame title="Nothing trained yet"
                   question="The ten stages fill in the moment a run starts.">
          <div className="text-[11px] text-zinc-500">
            Press <span className="text-zinc-300">Train</span> above. The defaults train MNQ at
            1-hour bars with a ±25-point barrier twelve bars ahead — the one horizon this
            workspace has measured a positive-expectancy signal at.
          </div>
        </LensFrame>
      )}
    </div>
  );
}

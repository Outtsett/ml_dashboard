/**
 * Training — HDP-HMM focused training dashboard.
 *
 * Thin shell: top bar (model selector, symbol/timeframe, start/stop, stats)
 * plus <TrainingTabs /> for all content below.
 *
 * Three states flow through tabs:
 *   1. Pre-training:  metric reference cards (Convergence tab)
 *   2. Live training: streaming convergence charts (Convergence tab, auto-selected)
 *   3. Post-training: diagnostics across all tabs (Overview, Performance, SHAP, etc.)
 */

import { useState, useCallback, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play, Square, ChevronDown, FolderTree, Loader2,
  Activity, Clock, Gauge, Timer,
} from "lucide-react";
import { useDashboard } from "@/contexts/UnifiedDashboardContext";
import { useTrainingControl, useTrainingLive } from "@/contexts/TrainingContext";
import { useMetricDescriptions } from "@/hooks/useMetricDescriptions";
import { useQuery } from "@tanstack/react-query";
import { ModelBrowser } from "@/components/training/ModelBrowser";
import { TrainingTabs } from "@/components/training/tabs/TrainingTabs";
import type { TrainingRequest } from "@shared/trainingTypes";

export default function Training() {
  const dashboard = useDashboard();
  const {
    isTraining, isPending, phase, progress, error,
    startTraining, stopTraining,
    availableModels, selectedModelType, setSelectedModelType,
    completedModelId, timeframeLabel,
  } = useTrainingControl();
  const { iterationHistory, diagnostics, elapsedSec } = useTrainingLive();
  const { metricOrder } = useMetricDescriptions(selectedModelType || "hdp-hmm");

  const [showModels, setShowModels] = useState(false);
  const [symbol, setSymbol] = useState(dashboard.symbol || "EURUSD");
  const [timeframe, setTimeframe] = useState(timeframeLabel || "1m");

  // ── Load existing trained models so the page always has data ──
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);

  const { data: trainedModels } = useQuery<any[]>({
    queryKey: ["/api/training/models"],
    queryFn: async () => {
      const r = await fetch("/api/training/models");
      if (!r.ok) return [];
      const d = await r.json();
      return d?.models ?? d ?? [];
    },
    staleTime: 30_000,
  });

  // Auto-select latest model on first load
  useEffect(() => {
    if (!selectedModelId && !completedModelId && trainedModels?.length) {
      setSelectedModelId(trainedModels[0].id);
    }
  }, [trainedModels, selectedModelId, completedModelId]);

  // Active model = just-completed OR selected from list
  const activeModelId = completedModelId || selectedModelId;

  // Fetch diagnostics for the active model (from disk, not SSE)
  const { data: savedDiagnostics } = useQuery<Record<string, any>>({
    queryKey: ["/api/training/models", activeModelId, "diagnostics"],
    queryFn: async () => {
      const r = await fetch(`/api/training/models/${activeModelId}/diagnostics`);
      if (!r.ok) return null;
      return r.json();
    },
    enabled: !!activeModelId,
    staleTime: 60_000,
  });

  // Fetch convergence data for the active model
  const { data: convergenceData } = useQuery<any[]>({
    queryKey: ["/api/training/models", activeModelId, "convergence"],
    queryFn: async () => {
      const r = await fetch(`/api/training/models/${activeModelId}/convergence`);
      if (!r.ok) return [];
      const d = await r.json();
      return d?.gibbs ?? d ?? [];
    },
    enabled: !!activeModelId,
    staleTime: 60_000,
  });

  // Use SSE diagnostics during live session, saved diagnostics otherwise
  const diag = (diagnostics as Record<string, any> | null) ?? savedDiagnostics ?? null;

  // Compute live metric presence for state detection
  const metricSeries = useMemo(() => {
    const series: Record<string, Array<{ iteration: number; value: number }>> = {};
    for (const key of metricOrder) series[key] = [];
    for (const entry of (iterationHistory ?? [])) {
      for (const key of metricOrder) {
        const val = entry.metrics[key] ?? entry.metrics[snake(key)];
        if (val != null) series[key]?.push({ iteration: entry.iteration, value: val });
      }
    }
    return series;
  }, [iterationHistory, metricOrder]);

  const activeMetrics = metricOrder.filter(k => (metricSeries[k]?.length ?? 0) > 0);

  // Stats bar
  const stats = useMemo(() => {
    if (!iterationHistory?.length) return null;
    const latest = iterationHistory[iterationHistory.length - 1]!;
    const iter = latest.iteration;
    const speed = (elapsedSec ?? 0) > 0 ? iter / elapsedSec! : 0;
    const pct = Math.max(progress ?? 0, 0.5);
    const eta = speed > 0 && pct < 100 ? (elapsedSec ?? 0) * ((100 - pct) / pct) : 0;
    return { iter, speed, eta, elapsed: elapsedSec ?? 0 };
  }, [iterationHistory, elapsedSec, progress]);

  const handleStart = useCallback(() => {
    const hp: Record<string, number | string | boolean> = {};
    const def = availableModels[selectedModelType]?.defaultHyperparameters;
    if (def) for (const [k, v] of Object.entries(def)) hp[k] = v.value;
    startTraining({ modelType: selectedModelType, symbol, timeframe, hyperparameters: hp } as TrainingRequest);
  }, [selectedModelType, symbol, timeframe, availableModels, startTraining]);

  const fmt = (s: number) => s < 60 ? `${Math.round(s)}s` : s < 3600 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;

  // Determine state
  const hasLiveData = activeMetrics.length > 0;
  const hasCompleted = !!diag && (!!completedModelId || !!selectedModelId);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* ── Top bar ──────────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-white/5">
        <Sel value={selectedModelType} onChange={setSelectedModelType} disabled={isTraining}
          options={Object.entries(availableModels).map(([k, v]) => ({ value: k, label: v.name }))} />
        <input value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())} disabled={isTraining}
          className="w-24 px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs font-mono text-foreground focus:outline-none focus:border-blue-500/50 disabled:opacity-40" />
        <Sel value={timeframe} onChange={setTimeframe} disabled={isTraining}
          options={["1m", "5m", "15m", "30m", "1h", "4h", "1d"].map(t => ({ value: t, label: t }))} />
        {/* Trained model selector */}
        {trainedModels && trainedModels.length > 0 && !isTraining && (
          <Sel value={activeModelId ?? ""} onChange={(v) => setSelectedModelId(v)} disabled={isTraining}
            options={trainedModels.map((m: any) => ({ value: m.id, label: `${m.symbol} ${m.timeframe} (${m.evaluation_grade ?? "?"})` }))} />
        )}
        <div className="flex-1" />
        {isTraining && stats && (
          <div className="flex items-center gap-4 text-[10px] font-mono text-muted-foreground/60">
            <span><Activity className="h-3 w-3 inline text-blue-400" /> {stats.iter}</span>
            <span><Gauge className="h-3 w-3 inline text-cyan-400" /> {stats.speed.toFixed(1)} it/s</span>
            <span><Clock className="h-3 w-3 inline text-indigo-400" /> {fmt(stats.elapsed)}</span>
            <span><Timer className="h-3 w-3 inline text-violet-400" /> {stats.eta > 0 ? fmt(stats.eta) : "--"}</span>
          </div>
        )}
        {isTraining && (
          <div className="w-24 h-1.5 rounded-full bg-white/5 overflow-hidden">
            <motion.div className="h-full rounded-full bg-blue-500" animate={{ width: `${progress ?? 0}%` }} transition={{ duration: 0.3 }} />
          </div>
        )}
        <button onClick={() => setShowModels(p => !p)} title="Model Browser"
          className={`p-1.5 rounded-md transition-colors ${showModels ? "bg-white/10 text-blue-400" : "text-muted-foreground/40 hover:bg-white/5"}`}>
          <FolderTree className="h-4 w-4" />
        </button>
        <AnimatePresence mode="wait">
          {isTraining ? (
            <motion.button key="stop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={stopTraining}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-red-500/20 text-red-400 text-xs font-mono hover:bg-red-500/30 border border-red-500/20">
              <Square className="h-3 w-3" /> Stop
            </motion.button>
          ) : (
            <motion.button key="start" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={handleStart} disabled={isPending || !selectedModelType}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 text-xs font-mono hover:bg-emerald-500/30 border border-emerald-500/20 disabled:opacity-40">
              {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
              {isPending ? "Starting..." : "Train"}
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {error && (
        <div className="shrink-0 mx-5 mt-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs font-mono text-red-400">{error}</div>
      )}

      {/* ── Main ─────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        <div className="flex-1 min-w-0">
          <TrainingTabs
            isTraining={isTraining}
            diagnostics={diag}
            activeModelId={activeModelId ?? null}
            convergenceData={convergenceData}
            hasCompleted={hasCompleted}
            hasLiveData={hasLiveData}
            symbol={symbol}
            timeframe={timeframe}
          />
        </div>

        {/* Right: Model Browser */}
        {showModels && (
          <aside className="w-80 shrink-0 border-l border-white/5 bg-card/20">
            <ModelBrowser filterModelType={selectedModelType || undefined} />
          </aside>
        )}
      </div>
    </div>
  );
}

function Sel({ value, onChange, options, disabled }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; disabled?: boolean }) {
  return (
    <div className="relative">
      <select value={value} onChange={e => onChange(e.target.value)} disabled={disabled}
        className="appearance-none px-2.5 py-1.5 pr-7 rounded-lg bg-white/5 border border-white/10 text-xs font-mono text-foreground focus:outline-none focus:border-blue-500/50 disabled:opacity-40 cursor-pointer">
        {options.map(o => <option key={o.value} value={o.value} className="bg-[#1a1a2e]">{o.label}</option>)}
      </select>
      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/40 pointer-events-none" />
    </div>
  );
}

function snake(s: string): string { return s.replace(/[A-Z]/g, m => `_${m.toLowerCase()}`); }

/**
 * Training — HDP-HMM focused training dashboard.
 *
 * Three states:
 *   1. Pre-training:  metric reference cards + model browser
 *   2. Live training: convergence line charts + iteration stats
 *   3. Post-training: full diagnostics — regime profiles, SHAP, transitions,
 *                     evaluation scorecard, convergence curves, walk-forward
 */

import { useState, useCallback, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play, Square, ChevronDown, FolderTree, Loader2,
  Activity, Clock, Gauge, Timer,
} from "lucide-react";
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar, Cell,
  ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, PieChart, Pie, RadarChart, Radar, PolarGrid,
  PolarAngleAxis, PolarRadiusAxis, Legend,
} from "recharts";
import { useDashboard } from "@/contexts/UnifiedDashboardContext";
import { useTrainingControl, useTrainingLive, useTrainingLogs } from "@/contexts/TrainingContext";
import { useMetricDescriptions, formatMetricValue, type MetricDescription } from "@/hooks/useMetricDescriptions";
import { useQuery } from "@tanstack/react-query";
import { ModelBrowser } from "@/components/training/ModelBrowser";
import { TransitionMatrixHeatmap } from "@/components/training/live/TransitionMatrixHeatmap";
import type { TrainingRequest } from "@shared/trainingTypes";

// ── Colors ──────────────────────────────────────────────────────────────────
const REGIME_FILLS = ["#22c55e", "#3b82f6", "#f59e0b", "#ef4444", "#a855f7", "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#6366f1"];
const GRADE_COLOR: Record<string, string> = {
  "A+": "#22c55e", A: "#22c55e", "A-": "#22c55e",
  "B+": "#3b82f6", B: "#3b82f6", "B-": "#3b82f6",
  "C+": "#eab308", C: "#eab308", "C-": "#eab308",
  "D+": "#f97316", D: "#f97316", "D-": "#f97316",
  F: "#ef4444", "N/A": "#6b7280",
};

export default function Training() {
  const dashboard = useDashboard();
  const {
    isTraining, isPending, phase, progress, error,
    startTraining, stopTraining,
    availableModels, selectedModelType, setSelectedModelType,
    completedModelId, timeframeLabel,
  } = useTrainingControl();
  const { iterationHistory, overlayData, diagnostics, elapsedSec } = useTrainingLive();
  const { logs } = useTrainingLogs();
  const { descriptions, metricOrder } = useMetricDescriptions(selectedModelType || "hdp-hmm");

  const [showModels, setShowModels] = useState(false);
  const [symbol, setSymbol] = useState(dashboard.symbol || "EURUSD");
  const [timeframe, setTimeframe] = useState(timeframeLabel || "1m");

  const modelName = availableModels[selectedModelType]?.name ?? selectedModelType;

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
  const overlay = overlayData?.payload as Record<string, any> | undefined;

  // Live metric series from iterationHistory
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

  // Stats
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

  const fmt = (s: number) => s < 60 ? `${Math.round(s)}s` : s < 3600 ? `${Math.floor(s/60)}m ${Math.round(s%60)}s` : `${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m`;

  // Determine state
  const hasLiveData = activeMetrics.length > 0;
  const hasCompleted = !!diag && (!!completedModelId || !!selectedModelId);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* ── Top bar ──────────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-white/5">
        <Sel value={selectedModelType} onChange={setSelectedModelType} disabled={isTraining}
          options={Object.entries(availableModels).map(([k,v]) => ({value:k, label:v.name}))} />
        <input value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())} disabled={isTraining}
          className="w-24 px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs font-mono text-foreground focus:outline-none focus:border-blue-500/50 disabled:opacity-40" />
        <Sel value={timeframe} onChange={setTimeframe} disabled={isTraining}
          options={["1m","5m","15m","30m","1h","4h","1d"].map(t => ({value:t,label:t}))} />
        {/* Trained model selector */}
        {trainedModels && trainedModels.length > 0 && !isTraining && (
          <Sel value={activeModelId ?? ""} onChange={(v) => setSelectedModelId(v)} disabled={isTraining}
            options={trainedModels.map((m: any) => ({value: m.id, label: `${m.symbol} ${m.timeframe} (${m.evaluation_grade ?? "?"})`}))} />
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
            <motion.div className="h-full rounded-full bg-blue-500" animate={{width:`${progress??0}%`}} transition={{duration:0.3}} />
          </div>
        )}
        <button onClick={() => setShowModels(p => !p)} title="Model Browser"
          className={`p-1.5 rounded-md transition-colors ${showModels ? "bg-white/10 text-blue-400" : "text-muted-foreground/40 hover:bg-white/5"}`}>
          <FolderTree className="h-4 w-4" />
        </button>
        <AnimatePresence mode="wait">
          {isTraining ? (
            <motion.button key="stop" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
              onClick={stopTraining}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-red-500/20 text-red-400 text-xs font-mono hover:bg-red-500/30 border border-red-500/20">
              <Square className="h-3 w-3" /> Stop
            </motion.button>
          ) : (
            <motion.button key="start" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
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
        <div className="flex-1 min-w-0 overflow-y-auto p-5 space-y-4">

          {/* ── POST-TRAINING: Full diagnostics ──────────────────── */}
          {hasCompleted && (
            <>
              {/* Grade + Summary row */}
              <div className="flex items-start gap-4">
                <div className="shrink-0 w-20 h-20 rounded-2xl border-2 flex items-center justify-center text-2xl font-mono font-black"
                  style={{ borderColor: GRADE_COLOR[diag.evaluation?.grade] ?? "#6b7280", color: GRADE_COLOR[diag.evaluation?.grade] ?? "#6b7280", background: `${GRADE_COLOR[diag.evaluation?.grade] ?? "#6b7280"}15` }}>
                  {diag.evaluation?.grade ?? "?"}
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-sm font-mono font-semibold text-foreground/80">{diag.symbol} {diag.timeframe} — {diag.n_regimes} regimes</h2>
                  <p className="text-[10px] font-mono text-muted-foreground/40 mt-0.5">
                    {diag.n_bars_total?.toLocaleString()} bars | {diag.n_features} features | {Math.round(diag.training_time_sec)}s training | Quality: {diag.quality_score}
                  </p>
                  <div className="flex gap-2 mt-2 flex-wrap">
                    {Object.entries(diag.evaluation ?? {}).filter(([k]) => k.startsWith("stage")).map(([stage, tests]: [string, any]) => {
                      const passed = Object.values(tests).filter((t: any) => t.passed).length;
                      const total = Object.keys(tests).length;
                      if (total === 0) return null;
                      return (
                        <span key={stage} className={`text-[9px] font-mono px-2 py-0.5 rounded border ${passed === total ? "text-emerald-400 border-emerald-500/20 bg-emerald-500/10" : passed > 0 ? "text-amber-400 border-amber-500/20 bg-amber-500/10" : "text-red-400 border-red-500/20 bg-red-500/10"}`}>
                          {stage}: {passed}/{total}
                        </span>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Regime profiles */}
              {diag.regime_stats?.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {diag.regime_stats.map((r: any, i: number) => (
                    <div key={r.regime_id} className="rounded-xl border border-white/5 bg-black/20 p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-3 h-3 rounded-full" style={{ background: REGIME_FILLS[i % REGIME_FILLS.length] }} />
                        <span className="text-xs font-mono font-semibold" style={{ color: REGIME_FILLS[i % REGIME_FILLS.length] }}>{r.label}</span>
                        <span className="text-[9px] font-mono text-muted-foreground/30 ml-auto">{r.pct.toFixed(1)}%</span>
                      </div>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] font-mono">
                        <div><span className="text-muted-foreground/40">Return:</span> <span className={r.avg_return >= 0 ? "text-emerald-400" : "text-red-400"}>{(r.avg_return*100).toFixed(2)}%</span></div>
                        <div><span className="text-muted-foreground/40">Volatility:</span> <span className="text-foreground/60">{(r.avg_volatility*100).toFixed(2)}%</span></div>
                        <div><span className="text-muted-foreground/40">Avg Hold:</span> <span className="text-foreground/60">{r.avg_duration} bars</span></div>
                        <div><span className="text-muted-foreground/40">Max Hold:</span> <span className="text-foreground/60">{r.max_duration} bars</span></div>
                        <div><span className="text-muted-foreground/40">Count:</span> <span className="text-foreground/60">{r.count.toLocaleString()}</span></div>
                        <div><span className="text-muted-foreground/40">Type:</span> <span className="text-foreground/60">{r.category}</span></div>
                      </div>
                      {/* Top SHAP features for this regime */}
                      {diag.shap_summary?.find((s: any) => s.regime_id === r.regime_id)?.top_features?.slice(0, 5).map((f: any) => (
                        <div key={f.feature} className="flex items-center gap-1 mt-1">
                          <div className="h-1.5 rounded-full" style={{ width: `${Math.min(100, Math.abs(f.mean_shap) / (diag.shap_summary.find((s: any) => s.regime_id === r.regime_id)?.top_features[0]?.mean_abs_shap || 1) * 100)}%`, background: f.mean_shap >= 0 ? "#22c55e" : "#ef4444", minWidth: 2 }} />
                          <span className="text-[8px] font-mono text-muted-foreground/30 truncate">{f.feature}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}

              {/* Convergence curves (from server convergence.json) + Transition matrix side by side */}
              <div className="grid grid-cols-2 gap-3">
                {/* Convergence */}
                <div className="rounded-xl border border-white/5 bg-black/20 p-3 h-64">
                  <span className="text-[10px] font-mono text-blue-400 font-medium">Convergence</span>
                  {convergenceData && convergenceData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="90%">
                      <LineChart data={convergenceData} margin={{top:8,right:8,left:0,bottom:4}}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                        <XAxis dataKey="iter" tick={{fontSize:8,fill:'#6e7681'}} tickLine={false} />
                        <YAxis yAxisId="ll" tick={{fontSize:8,fill:'#6e7681'}} tickLine={false} width={50} tickFormatter={(v: number) => `${(v/1e6).toFixed(1)}M`} />
                        <YAxis yAxisId="k" orientation="right" tick={{fontSize:8,fill:'#6e7681'}} tickLine={false} width={25} />
                        <Tooltip contentStyle={{background:'#0d1117',border:'1px solid rgba(255,255,255,0.1)',fontSize:10}} />
                        <Line yAxisId="ll" dataKey="log_likelihood" stroke="#3b82f6" dot={false} strokeWidth={1.5} isAnimationActive={false} name="Log-Lik" />
                        <Line yAxisId="k" dataKey="n_active_states" stroke="#ef4444" dot={false} strokeWidth={1.5} isAnimationActive={false} name="Regimes" />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : <div className="h-full flex items-center justify-center text-[10px] text-muted-foreground/30 font-mono">Loading...</div>}
                </div>

                {/* Transition matrix */}
                <div className="rounded-xl border border-white/5 bg-black/20 overflow-hidden h-64">
                  <TransitionMatrixHeatmap
                    matrix={diag.transition_matrix ?? null}
                    nRegimes={diag.n_regimes ?? 0}
                  />
                </div>
              </div>

              {/* Regime distribution pie + Walk-forward bar */}
              <div className="grid grid-cols-2 gap-3">
                {/* Pie chart */}
                <div className="rounded-xl border border-white/5 bg-black/20 p-3 h-56">
                  <span className="text-[10px] font-mono text-purple-400 font-medium">Regime Distribution</span>
                  {diag.regime_stats && (
                    <ResponsiveContainer width="100%" height="85%">
                      <PieChart>
                        <Pie data={diag.regime_stats.map((r: any, i: number) => ({ name: r.label, value: r.count, fill: REGIME_FILLS[i % REGIME_FILLS.length] }))}
                          dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius="70%" innerRadius="40%"
                          stroke="none" isAnimationActive={false}>
                          {diag.regime_stats.map((_: any, i: number) => <Cell key={i} fill={REGIME_FILLS[i % REGIME_FILLS.length]} />)}
                        </Pie>
                        <Tooltip contentStyle={{background:'#0d1117',border:'1px solid rgba(255,255,255,0.1)',fontSize:10}} />
                        <Legend wrapperStyle={{fontSize:9}} />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </div>

                {/* Walk-forward */}
                {diag.walk_forward?.window_results?.length > 0 && (
                  <div className="rounded-xl border border-white/5 bg-black/20 p-3 h-56">
                    <span className="text-[10px] font-mono text-amber-400 font-medium">Walk-Forward Confidence</span>
                    <ResponsiveContainer width="100%" height="85%">
                      <BarChart data={diag.walk_forward.window_results.map((w: any) => ({
                        window: `W${w.window}`, confidence: w.avg_confidence, switchRate: w.switch_rate
                      }))} margin={{top:8,right:8,left:0,bottom:4}}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                        <XAxis dataKey="window" tick={{fontSize:9,fill:'#6e7681'}} />
                        <YAxis tick={{fontSize:9,fill:'#6e7681'}} domain={[0, 1]} />
                        <Tooltip contentStyle={{background:'#0d1117',border:'1px solid rgba(255,255,255,0.1)',fontSize:10}} />
                        <Bar dataKey="confidence" fill="#f59e0b" radius={[4,4,0,0]} name="Confidence" />
                        <Bar dataKey="switchRate" fill="#6366f1" radius={[4,4,0,0]} name="Switch Rate" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              {/* OOS scatter: train vs test distributions */}
              {diag.out_of_sample && (
                <div className="rounded-xl border border-white/5 bg-black/20 p-3 h-48">
                  <div className="flex items-center gap-3 mb-1">
                    <span className="text-[10px] font-mono text-cyan-400 font-medium">Out-of-Sample</span>
                    <span className="text-[9px] font-mono text-muted-foreground/30">
                      Similarity: {(diag.out_of_sample.distribution_similarity * 100).toFixed(1)}% |
                      Profile Corr: {(diag.out_of_sample.avg_profile_correlation * 100).toFixed(1)}%
                    </span>
                  </div>
                  <ResponsiveContainer width="100%" height="80%">
                    <BarChart data={diag.regime_stats.map((r: any, i: number) => ({
                      name: r.label,
                      train: diag.out_of_sample.train_distribution[i] * 100,
                      test: diag.out_of_sample.test_distribution[i] * 100,
                    }))} margin={{top:4,right:8,left:0,bottom:4}}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                      <XAxis dataKey="name" tick={{fontSize:8,fill:'#6e7681'}} />
                      <YAxis tick={{fontSize:8,fill:'#6e7681'}} tickFormatter={(v: number) => `${v.toFixed(0)}%`} />
                      <Tooltip contentStyle={{background:'#0d1117',border:'1px solid rgba(255,255,255,0.1)',fontSize:10}} />
                      <Bar dataKey="train" fill="#3b82f6" name="Train" radius={[3,3,0,0]} />
                      <Bar dataKey="test" fill="#22c55e" name="Test" radius={[3,3,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Evaluation scorecard */}
              {diag.evaluation && (
                <div className="rounded-xl border border-white/5 bg-black/20 p-3">
                  <span className="text-[10px] font-mono text-emerald-400 font-medium">Evaluation Tests</span>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-2">
                    {Object.entries(diag.evaluation).filter(([k]) => k.startsWith("stage")).flatMap(([stage, tests]: [string, any]) =>
                      Object.entries(tests).map(([name, t]: [string, any]) => (
                        <div key={`${stage}-${name}`} className={`text-[10px] font-mono px-2 py-1.5 rounded border ${t.passed ? "border-emerald-500/15 bg-emerald-500/5" : "border-red-500/15 bg-red-500/5"}`}>
                          <div className="flex items-center gap-1.5">
                            <span className={`w-1.5 h-1.5 rounded-full ${t.passed ? "bg-emerald-400" : "bg-red-400"}`} />
                            <span className="text-muted-foreground/60 truncate">{name.replace(/_/g, " ")}</span>
                          </div>
                          <span className={`font-bold ${t.passed ? "text-emerald-400" : "text-red-400"}`}>
                            {typeof t.value === "number" ? t.value.toFixed(4) : String(t.value)}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── LIVE TRAINING: streaming metric charts ────────────── */}
          {!hasCompleted && hasLiveData && (
            <>
              {activeMetrics.map(key => {
                const desc = descriptions[key];
                if (!desc) return null;
                const data = metricSeries[key] ?? [];
                const cur = data.length > 0 ? data[data.length-1]!.value : null;
                const displayData = desc.format === "percent" ? data.map(d => ({...d, v: d.value*100}))
                  : desc.format === "millions" ? data.map(d => ({...d, v: d.value/1e6}))
                  : data.map(d => ({...d, v: d.value}));
                return (
                  <div key={key} className="rounded-xl border border-white/5 bg-black/20 overflow-hidden flex h-36">
                    <div className="flex-1 min-w-0 flex flex-col">
                      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/5">
                        <span className="text-[10px] font-mono font-semibold" style={{color:desc.color}}>{desc.title}</span>
                        <span className="text-xs font-mono font-bold" style={{color:desc.color}}>
                          {cur != null ? formatMetricValue(cur, desc.format) : "--"}
                        </span>
                      </div>
                      <div className="flex-1 min-h-0">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={displayData} margin={{top:4,right:8,left:0,bottom:4}}>
                            <defs>
                              <linearGradient id={`g-${key}`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={desc.color} stopOpacity={0.15} />
                                <stop offset="95%" stopColor={desc.color} stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                            <XAxis dataKey="iteration" tick={{fontSize:8,fill:'#6e7681'}} tickLine={false} />
                            <YAxis tick={{fontSize:8,fill:'#6e7681'}} tickLine={false} width={45} />
                            {desc.target != null && <ReferenceLine y={desc.target} stroke="#ef4444" strokeDasharray="4 4" strokeOpacity={0.5} />}
                            <Tooltip contentStyle={{background:'#0d1117',border:'1px solid rgba(255,255,255,0.1)',fontSize:10}} />
                            <Area type="monotone" dataKey="v" stroke={desc.color} fill={`url(#g-${key})`} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                    <div className="w-56 shrink-0 border-l border-white/5 p-2.5 flex flex-col justify-center overflow-y-auto">
                      <p className="text-[10px] text-muted-foreground/60 leading-relaxed mb-1.5">{desc.description}</p>
                      <p className="text-[9px] text-amber-400/50 leading-relaxed"><b>Effect:</b> {desc.effect}</p>
                      <p className="text-[9px] text-emerald-400/50 leading-relaxed mt-0.5"><b>Healthy:</b> {desc.healthy}</p>
                    </div>
                  </div>
                );
              })}
              {logs.length > 0 && (
                <div className="rounded-xl border border-white/5 bg-black/20 max-h-28 overflow-y-auto p-2">
                  {logs.slice(-15).map((l,i) => <div key={i} className="text-[9px] font-mono text-muted-foreground/30 truncate">{l}</div>)}
                </div>
              )}
            </>
          )}

          {/* ── PRE-TRAINING: metric reference cards ─────────────── */}
          {!hasCompleted && !hasLiveData && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 mb-1">
                <h2 className="text-xs font-mono font-medium text-muted-foreground/60 uppercase tracking-wider">{modelName} — Metrics Reference</h2>
                <span className="text-[10px] font-mono text-muted-foreground/30">{symbol} {timeframe}</span>
              </div>
              {metricOrder.map(key => {
                const d = descriptions[key]; if (!d) return null;
                return (
                  <div key={key} className="rounded-xl border border-white/5 bg-black/20 p-4 flex gap-4">
                    <div className="w-1 rounded-full shrink-0" style={{background:d.color}} />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-mono font-semibold" style={{color:d.color}}>{d.title}</span>
                        <span className="text-[9px] font-mono text-muted-foreground/30 px-1.5 py-0.5 rounded bg-white/3 border border-white/5">{d.unit}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground/70 leading-relaxed mb-3">{d.description}</p>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                        <DescBox label="Detects" color="text-cyan-400/60" text={d.detects} />
                        <DescBox label="Purpose" color="text-blue-400/60" text={d.purpose} />
                        <DescBox label="How to Read" color="text-amber-400/60" text={d.usage} />
                        <DescBox label="Healthy" color="text-emerald-400/60" text={d.healthy} />
                        {d.crossMetrics && (
                          <div className="col-span-2">
                            <DescBox label="Cross-Metric Relationships" color="text-purple-400/60" text={d.crossMetrics} />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
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

function Sel({value,onChange,options,disabled}:{value:string;onChange:(v:string)=>void;options:{value:string;label:string}[];disabled?:boolean}) {
  return (
    <div className="relative">
      <select value={value} onChange={e=>onChange(e.target.value)} disabled={disabled}
        className="appearance-none px-2.5 py-1.5 pr-7 rounded-lg bg-white/5 border border-white/10 text-xs font-mono text-foreground focus:outline-none focus:border-blue-500/50 disabled:opacity-40 cursor-pointer">
        {options.map(o => <option key={o.value} value={o.value} className="bg-[#1a1a2e]">{o.label}</option>)}
      </select>
      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/40 pointer-events-none" />
    </div>
  );
}

function DescBox({ label, color, text }: { label: string; color: string; text: string }) {
  if (!text) return null;
  return (
    <div>
      <span className={`text-[9px] font-mono ${color} uppercase tracking-wider`}>{label}</span>
      <p className="text-[10px] text-muted-foreground/50 leading-relaxed mt-0.5">{text}</p>
    </div>
  );
}

function snake(s: string): string { return s.replace(/[A-Z]/g, m => `_${m.toLowerCase()}`); }

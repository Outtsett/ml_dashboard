/**
 * RegimeAnalytics — Visual training analytics for HDP-HMM regime detection.
 *
 * Think of it as: a control panel for a "market mood ring" detector. You pick
 * a symbol, hit Train, and watch it discover distinct market personalities
 * (trending, choppy, volatile, quiet). Then you see the results as color-coded
 * bars, probability ribbons, and a transition map showing how the market
 * switches between moods.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Play, Square, Layers, ChevronDown, ChevronRight,
  Trash2, Settings2, BarChart3, Shield, Target, Activity, Zap,
} from "lucide-react";
import { QUERY_KEYS } from "@/lib/types";
import { useDashboard } from "@/contexts/UnifiedDashboardContext";

import type { RegimeModel, Diagnostics, TrainingProgress } from "./types";
import { getRegimeColor, getRegimeIcon, getQualityColor, getQualityLabel } from "./types";
import { QualityScoreRing } from "./mini-charts";
import { ConvergenceCurve } from "./mini-charts";
import { WalkForwardDisplay } from "./WalkForwardDisplay";
import { OOSDisplay } from "./OOSDisplay";
import { TransitionMatrix } from "./TransitionMatrix";
import { RegimeTimeline } from "./RegimeTimeline";
import { Section } from "./Section";

// ─── Main Component ──────────────────────────────────────────────────────────

interface RegimeAnalyticsProps {
  compact?: boolean;
}

export default function RegimeAnalytics({ compact = true }: RegimeAnalyticsProps) {
  const dashboard = useDashboard();
  const queryClient = useQueryClient();

  // Training state
  const [isTraining, setIsTraining] = useState(false);
  const [progress, setProgress] = useState<TrainingProgress | null>(null);
  const [trainLogs, setTrainLogs] = useState<string[]>([]);
  const [trainError, setTrainError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Config state
  const [selectedSymbol, setSelectedSymbol] = useState(dashboard.symbol || "ES");
  const [selectedTimeframe, setSelectedTimeframe] = useState("30m");
  const [gibbsIter, setGibbsIter] = useState(100);
  const [burnIn, setBurnIn] = useState(30);
  const [testSplit, setTestSplit] = useState(0.15);
  const [wfWindows, setWfWindows] = useState(5);
  const [alpha, setAlpha] = useState(1.0);
  const [gamma, setGamma] = useState(5.0);
  const [kappa, setKappa] = useState(50.0);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Results state
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  // Sync symbol from dashboard context
  useEffect(() => {
    if (dashboard.symbol) setSelectedSymbol(dashboard.symbol);
  }, [dashboard.symbol]);

  // ── Queries ──────────────────────────────────────────────────────────────

  const { data: modelsData, refetch: refetchModels } = useQuery({
    queryKey: QUERY_KEYS.regimeModels,
    queryFn: async () => {
      const res = await fetch("/api/regime/models");
      if (!res.ok) throw new Error("Failed to load regime models");
      return res.json() as Promise<{ models: RegimeModel[] }>;
    },
    refetchInterval: isTraining ? 5000 : false,
  });

  const models = modelsData?.models || [];

  const { data: diagnostics } = useQuery({
    queryKey: QUERY_KEYS.regimeDiagnostics(selectedModel || ""),
    queryFn: async () => {
      const res = await fetch(`/api/regime/diagnostics/${selectedModel}`);
      if (!res.ok) throw new Error("Failed to load diagnostics");
      return res.json() as Promise<Diagnostics>;
    },
    enabled: !!selectedModel,
  });

  const { data: convergenceData } = useQuery({
    queryKey: [...QUERY_KEYS.regimeDiagnostics(selectedModel || ""), "convergence"],
    queryFn: async () => {
      const res = await fetch(`/api/regime/convergence/${selectedModel}`);
      if (!res.ok) return null;
      return res.json() as Promise<Record<string, Array<{ iter: number; log_likelihood: number; delta: number }>>>;
    },
    enabled: !!selectedModel,
  });

  const { data: assignmentsData } = useQuery({
    queryKey: QUERY_KEYS.regimeAssignments(selectedModel || ""),
    queryFn: async () => {
      const res = await fetch(`/api/regime/assignments/${selectedModel}?limit=50000`);
      if (!res.ok) throw new Error("Failed to load assignments");
      return res.json() as Promise<{ rows: Array<{ ts: string; close: number; regime: number; regime_label: string; split?: string; [key: string]: unknown }>; total: number }>;
    },
    enabled: !!selectedModel,
  });

  // ── Training ─────────────────────────────────────────────────────────────

  const startTraining = useCallback(async () => {
    setIsTraining(true);
    setProgress(null);
    setTrainLogs([]);
    setTrainError(null);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const startRes = await fetch("/api/regime/train", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: selectedSymbol,
          timeframe: selectedTimeframe,
          gibbsIter,
          burnIn,
          testSplit,
          wfWindows,
          alpha,
          gamma,
          kappa,
        }),
        signal: abort.signal,
      });

      if (!startRes.ok) {
        const errBody = await startRes.json().catch(() => ({ error: `HTTP ${startRes.status}` }));
        throw new Error(errBody.error || "Failed to start training");
      }

      const { modelId } = await startRes.json();

      const streamRes = await fetch(`/api/regime/train/stream/${modelId}`, {
        signal: abort.signal,
      });

      if (!streamRes.ok || !streamRes.body) {
        throw new Error("Failed to connect to training stream");
      }

      const reader = streamRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let eventName = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventName = line.slice(7).trim();
          } else if (line.startsWith("data: ") && eventName) {
            try {
              const data = JSON.parse(line.slice(6));
              switch (eventName) {
                case "progress":
                  setProgress(data as TrainingProgress);
                  break;
                case "status":
                case "log":
                case "regime_line":
                  setTrainLogs(prev => [...prev.slice(-50), data.message || data.text || data.phase]);
                  break;
                case "done":
                  setSelectedModel(data.modelId);
                  refetchModels();
                  break;
                case "error":
                  setTrainError(data.message);
                  break;
              }
            } catch {
              // Skip malformed JSON
            }
            eventName = "";
          }
        }
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        setTrainError(err.message);
      }
    } finally {
      setIsTraining(false);
      abortRef.current = null;
    }
  }, [selectedSymbol, selectedTimeframe, gibbsIter, burnIn, testSplit, wfWindows, alpha, gamma, kappa, refetchModels]);

  const stopTraining = useCallback(() => {
    abortRef.current?.abort();
    fetch("/api/regime/train/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: selectedSymbol, timeframe: selectedTimeframe }),
    });
    setIsTraining(false);
  }, [selectedSymbol, selectedTimeframe]);

  const deleteModel = useCallback(async (id: string) => {
    await fetch(`/api/regime/models/${id}`, { method: "DELETE" });
    if (selectedModel === id) setSelectedModel(null);
    refetchModels();
  }, [selectedModel, refetchModels]);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <ScrollArea className="h-full">
      <div className="p-3 space-y-3">
        {/* ── Train Controls ────────────────────────────── */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Layers className="h-3.5 w-3.5 text-orange-400" />
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              HDP-HMM
            </span>
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            <div>
              <label className="text-[9px] text-muted-foreground">Symbol</label>
              <Input
                value={selectedSymbol}
                onChange={e => setSelectedSymbol(e.target.value.toUpperCase())}
                className="h-6 text-[10px] bg-black/30 border-white/10 px-2"
                disabled={isTraining}
              />
            </div>
            <div>
              <label className="text-[9px] text-muted-foreground">Timeframe</label>
              <Select value={selectedTimeframe} onValueChange={setSelectedTimeframe} disabled={isTraining}>
                <SelectTrigger className="h-6 text-[10px] bg-black/30 border-white/10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["1m", "5m", "15m", "30m", "1h", "4h", "1d"].map(tf => (
                    <SelectItem key={tf} value={tf} className="text-xs">{tf}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[9px] text-muted-foreground">Gibbs Iter</label>
              <Input
                type="number"
                value={gibbsIter}
                onChange={e => setGibbsIter(Math.max(30, Math.min(500, parseInt(e.target.value) || 100)))}
                className="h-6 text-[10px] bg-black/30 border-white/10 px-2"
                min={30} max={500}
                disabled={isTraining}
              />
            </div>
          </div>

          {/* Advanced config toggle */}
          <button
            className="flex items-center gap-1 text-[8px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            <Settings2 className="h-2.5 w-2.5" />
            <span>{showAdvanced ? "Hide" : "Show"} Validation Settings</span>
            {showAdvanced ? <ChevronDown className="h-2.5 w-2.5" /> : <ChevronRight className="h-2.5 w-2.5" />}
          </button>

          {showAdvanced && (
            <div className="space-y-1.5 p-2 rounded-lg bg-black/20 border border-white/5">
              <div className="grid grid-cols-3 gap-1.5">
                <div>
                  <label className="text-[8px] text-muted-foreground">Burn-In</label>
                  <Input
                    type="number"
                    value={burnIn}
                    onChange={e => setBurnIn(Math.max(10, Math.min(200, parseInt(e.target.value) || 30)))}
                    className="h-5 text-[9px] bg-black/30 border-white/10 px-1.5"
                    min={10} max={200}
                    disabled={isTraining}
                  />
                </div>
                <div>
                  <label className="text-[8px] text-muted-foreground">Test Split</label>
                  <Input
                    type="number"
                    value={testSplit}
                    onChange={e => setTestSplit(Math.max(0.05, Math.min(0.5, parseFloat(e.target.value) || 0.15)))}
                    className="h-5 text-[9px] bg-black/30 border-white/10 px-1.5"
                    step={0.05}
                    min={0.05} max={0.5}
                    disabled={isTraining}
                  />
                </div>
                <div>
                  <label className="text-[8px] text-muted-foreground">WF Windows</label>
                  <Input
                    type="number"
                    value={wfWindows}
                    onChange={e => setWfWindows(Math.max(2, Math.min(10, parseInt(e.target.value) || 5)))}
                    className="h-5 text-[9px] bg-black/30 border-white/10 px-1.5"
                    min={2} max={10}
                    disabled={isTraining}
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                <div>
                  <label className="text-[8px] text-muted-foreground" title="Transition concentration - higher = more regime diversity">Alpha</label>
                  <Input
                    type="number"
                    value={alpha}
                    onChange={e => setAlpha(Math.max(0.1, Math.min(50, parseFloat(e.target.value) || 1.0)))}
                    className="h-5 text-[9px] bg-black/30 border-white/10 px-1.5"
                    step={0.5}
                    min={0.1} max={50}
                    disabled={isTraining}
                  />
                </div>
                <div>
                  <label className="text-[8px] text-muted-foreground" title="DP concentration - higher = more new regimes">Gamma</label>
                  <Input
                    type="number"
                    value={gamma}
                    onChange={e => setGamma(Math.max(0.1, Math.min(50, parseFloat(e.target.value) || 5.0)))}
                    className="h-5 text-[9px] bg-black/30 border-white/10 px-1.5"
                    step={1}
                    min={0.1} max={50}
                    disabled={isTraining}
                  />
                </div>
                <div>
                  <label className="text-[8px] text-muted-foreground" title="Stickiness - higher = longer regime durations">Kappa</label>
                  <Input
                    type="number"
                    value={kappa}
                    onChange={e => setKappa(Math.max(1, Math.min(500, parseFloat(e.target.value) || 50)))}
                    className="h-5 text-[9px] bg-black/30 border-white/10 px-1.5"
                    step={10}
                    min={1} max={500}
                    disabled={isTraining}
                  />
                </div>
              </div>
              <p className="text-[7px] text-muted-foreground/40 mt-1">Gamma = regime creation willingness | Kappa = regime persistence (stickiness)</p>
            </div>
          )}

          {/* Train / Stop button */}
          <Button
            size="sm"
            className={`w-full h-7 text-[10px] gap-1.5 ${isTraining
              ? "bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 border border-rose-500/30"
              : "bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 border border-orange-500/30"
            }`}
            variant="ghost"
            onClick={isTraining ? stopTraining : startTraining}
          >
            {isTraining ? (
              <><Square className="h-3 w-3" /> Stop Training</>
            ) : (
              <><Play className="h-3 w-3" /> Train HDP-HMM</>
            )}
          </Button>

          {/* Progress bar */}
          {isTraining && progress && (
            <div className="space-y-1">
              <div className="flex justify-between items-center">
                <span className="text-[9px] text-muted-foreground">{progress.message}</span>
                <span className="text-[9px] font-mono text-orange-400">{progress.pct}%</span>
              </div>
              <Progress value={progress.pct} className="h-1.5" />
            </div>
          )}

          {/* Training logs (last 3 lines) */}
          {trainLogs.length > 0 && (
            <div className="p-1.5 rounded bg-black/30 border border-white/5 max-h-[48px] overflow-hidden">
              {trainLogs.slice(-3).map((line, i) => (
                <p key={i} className="text-[8px] font-mono text-muted-foreground/70 truncate">{line}</p>
              ))}
            </div>
          )}

          {/* Error */}
          {trainError && (
            <div className="p-2 rounded bg-rose-500/10 border border-rose-500/20">
              <p className="text-[9px] text-rose-400">{trainError}</p>
            </div>
          )}
        </div>

        {/* ── Trained Models List ────────────────────────── */}
        {models.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[9px] text-muted-foreground font-medium uppercase tracking-wider">
              Trained Models ({models.length})
            </p>
            {models.map(m => (
              <div
                key={m.id}
                className={`flex items-center gap-2 p-1.5 rounded-lg cursor-pointer transition-colors ${
                  selectedModel === m.id
                    ? "bg-orange-500/15 border border-orange-500/25"
                    : "bg-white/5 border border-transparent hover:bg-white/8"
                }`}
                onClick={() => {
                  setSelectedModel(m.id);
                  setShowDiagnostics(true);
                }}
              >
                {/* Quality score mini ring */}
                {m.quality_score != null && (
                  <QualityScoreRing score={m.quality_score} />
                )}

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-mono font-medium text-foreground">{m.symbol}</span>
                    <Badge variant="outline" className="text-[7px] px-1 py-0 rounded-full">{m.timeframe}</Badge>
                    <Badge variant="outline" className="text-[7px] px-1 py-0 rounded-full border-orange-500/30 text-orange-400">
                      {m.n_regimes} regimes
                    </Badge>
                  </div>
                  <p className="text-[8px] text-muted-foreground/60 font-mono">
                    {(m.n_bars_total || m.n_bars || 0).toLocaleString()} bars
                    {m.n_bars_train_val ? ` (${m.n_bars_train_val.toLocaleString()} train)` : ""}
                    {" · "}{m.training_time_sec.toFixed(0)}s
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-5 w-5 p-0 text-muted-foreground/40 hover:text-rose-400"
                  onClick={(e) => { e.stopPropagation(); deleteModel(m.id); }}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* ── Diagnostics Panel ─────────────────────────── */}
        {diagnostics && showDiagnostics && (
          <div className="space-y-3 pt-1">
            {/* Header with quality score */}
            <div className="flex items-center justify-between">
              <button
                className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setShowDiagnostics(!showDiagnostics)}
              >
                <ChevronDown className="h-3 w-3" />
                <span className="font-medium uppercase tracking-wider">Training Analytics</span>
                <Badge variant="outline" className="text-[7px] px-1 py-0 ml-1 rounded-full border-orange-500/30 text-orange-400">
                  {diagnostics.symbol} {diagnostics.timeframe}
                </Badge>
              </button>
              {diagnostics.quality_score != null && (
                <div className="flex items-center gap-1">
                  <QualityScoreRing score={diagnostics.quality_score} />
                  <span className={`text-[8px] font-medium ${getQualityColor(diagnostics.quality_score)}`}>
                    {getQualityLabel(diagnostics.quality_score)}
                  </span>
                </div>
              )}
            </div>

            {/* Data split summary */}
            {diagnostics.n_bars_train_val != null && (
              <div className="p-2 rounded-lg bg-black/20 border border-white/5">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[8px] text-muted-foreground">Data Split</span>
                  <span className="text-[8px] font-mono text-foreground/70">
                    {(diagnostics.n_bars_total || 0).toLocaleString()} total bars
                  </span>
                </div>
                <div className="w-full h-2 rounded-full overflow-hidden flex bg-white/5">
                  <div className="h-full bg-blue-500/60"
                    style={{ width: `${((diagnostics.n_bars_train_val || 0) / (diagnostics.n_bars_total || 1)) * 100}%` }}
                  />
                  <div className="h-full bg-amber-500/60"
                    style={{ width: `${((diagnostics.n_bars_test || 0) / (diagnostics.n_bars_total || 1)) * 100}%` }}
                  />
                </div>
                <div className="flex justify-between mt-0.5">
                  <span className="text-[7px] text-blue-400">Train+Val: {(diagnostics.n_bars_train_val || 0).toLocaleString()}</span>
                  <span className="text-[7px] text-amber-400">Test: {(diagnostics.n_bars_test || 0).toLocaleString()}</span>
                </div>
              </div>
            )}

            {/* HDP-HMM Discovery Info */}
            <Section title="Regime Discovery" icon={<BarChart3 className="h-3 w-3 text-cyan-400" />} defaultOpen>
              <div className="p-1.5 rounded-lg bg-black/30 border border-white/5 space-y-1.5">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[8px] px-1.5 py-0.5 rounded-full border-emerald-500/30 text-emerald-400">
                    {diagnostics.n_regimes} regimes discovered
                  </Badge>
                  <span className="text-[7px] text-muted-foreground font-mono">
                    auto (no cap)
                  </span>
                </div>
                {diagnostics.hyperparams && (
                  <div className="flex gap-1.5 flex-wrap">
                    <Badge variant="outline" className="text-[7px] px-1 py-0 rounded-full border-cyan-500/30 text-cyan-400">
                      alpha={diagnostics.hyperparams.alpha}
                    </Badge>
                    <Badge variant="outline" className="text-[7px] px-1 py-0 rounded-full border-violet-500/30 text-violet-400">
                      gamma={diagnostics.hyperparams.gamma}
                    </Badge>
                    <Badge variant="outline" className="text-[7px] px-1 py-0 rounded-full border-orange-500/30 text-orange-400">
                      kappa={diagnostics.hyperparams.kappa}
                    </Badge>
                  </div>
                )}
              </div>
              {/* Convergence info */}
              {diagnostics.convergence_summary && (
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[7px] text-muted-foreground font-mono">
                    {diagnostics.convergence_summary.n_iterations} Gibbs iters
                  </span>
                  <span className="text-[7px] text-muted-foreground font-mono">
                    final states: {diagnostics.convergence_summary.final_active_states || diagnostics.n_regimes}
                  </span>
                </div>
              )}
            </Section>

            {/* Walk-Forward Results */}
            {diagnostics.walk_forward && diagnostics.walk_forward.n_windows > 0 && (
              <Section title="Walk-Forward Stability" icon={<Target className="h-3 w-3 text-emerald-400" />} defaultOpen>
                <div className="p-1.5 rounded bg-black/20 border border-white/5">
                  <WalkForwardDisplay wf={diagnostics.walk_forward} />
                </div>
              </Section>
            )}

            {/* Out-of-Sample Assessment */}
            {diagnostics.out_of_sample && (
              <Section title="Out-of-Sample Assessment" icon={<Shield className="h-3 w-3 text-blue-400" />} defaultOpen>
                <div className="p-1.5 rounded bg-black/20 border border-white/5">
                  <OOSDisplay oos={diagnostics.out_of_sample} n_regimes={diagnostics.n_regimes} />
                </div>
              </Section>
            )}

            {/* Gibbs Convergence Curves */}
            {convergenceData && Object.keys(convergenceData).length > 0 && (
              <Section title="Gibbs Convergence" icon={<Activity className="h-3 w-3 text-violet-400" />}>
                <div className="p-1.5 rounded bg-black/20 border border-white/5 space-y-2">
                  {Object.entries(convergenceData).map(([key, history]) => (
                    <ConvergenceCurve key={key} data={history} label={key === "gibbs" ? "Gibbs Sampler" : key} />
                  ))}
                </div>
              </Section>
            )}

            {/* Regime Stats */}
            <Section title="Regime Breakdown" icon={<Layers className="h-3 w-3 text-orange-400" />} defaultOpen>
              {diagnostics.regime_stats.map((r) => {
                const color = getRegimeColor(r.regime_id);
                return (
                  <div key={r.regime_id} className={`p-2 rounded-lg ${color.bg} border ${color.border} mb-1.5`}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5">
                        <span className={`${color.text}`}>{getRegimeIcon(r.label)}</span>
                        <span className={`text-[10px] font-medium ${color.text}`}>
                          R{r.regime_id}: {r.nickname || r.label.replace(/_/g, " ")}
                        </span>
                      </div>
                      <Badge variant="outline" className={`text-[7px] px-1 py-0 ${color.border} ${color.text}`}>
                        {r.pct.toFixed(1)}%
                      </Badge>
                    </div>
                    <div className="grid grid-cols-4 gap-x-2 gap-y-0.5">
                      <div>
                        <span className="text-[7px] text-muted-foreground">Bars</span>
                        <p className="text-[9px] font-mono">{r.count.toLocaleString()}</p>
                      </div>
                      <div>
                        <span className="text-[7px] text-muted-foreground">Ret/Bar</span>
                        <p className={`text-[9px] font-mono ${(r.avg_return_pct ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                          {(r.avg_return_pct ?? 0) >= 0 ? '+' : ''}{(r.avg_return_pct ?? 0).toFixed(3)}%
                        </p>
                      </div>
                      <div>
                        <span className="text-[7px] text-muted-foreground">Volatility</span>
                        <p className="text-[9px] font-mono">{(r.avg_volatility * 100).toFixed(3)}%</p>
                      </div>
                      <div>
                        <span className="text-[7px] text-muted-foreground">Avg Dur</span>
                        <p className="text-[9px] font-mono">{r.avg_duration.toFixed(0)} bars</p>
                      </div>
                    </div>
                    {/* Proportion bar */}
                    <div className="mt-1 h-1 rounded-full bg-white/5 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${r.pct}%`, backgroundColor: color.hex, opacity: 0.6 }} />
                    </div>
                  </div>
                );
              })}
            </Section>

            {/* Transition Matrix */}
            {diagnostics.transition_matrix.length > 0 && (
              <Section title="Transition Probabilities" icon={<Activity className="h-3 w-3 text-cyan-400" />}>
                <div className="p-2 rounded-lg bg-black/30 border border-white/5 flex justify-center">
                  <TransitionMatrix
                    matrix={diagnostics.transition_matrix}
                    labels={diagnostics.regime_stats.map(r => r.nickname || r.label)}
                  />
                </div>
                <p className="text-[7px] text-muted-foreground/50 text-center mt-1">
                  Row → Col · Green = self-stay · Cyan = switch
                </p>
              </Section>
            )}

            {/* Regime Timeline */}
            {assignmentsData?.rows && assignmentsData.rows.length > 0 && (
              <Section title={`Regime Timeline (${assignmentsData.total.toLocaleString()} bars)`} icon={<BarChart3 className="h-3 w-3 text-amber-400" />} defaultOpen>
                <RegimeTimeline
                  assignments={assignmentsData.rows.map(r => ({ regime: r.regime }))}
                  n_regimes={diagnostics.n_regimes}
                />
                {/* Legend */}
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {diagnostics.regime_stats.map(r => {
                    const color = getRegimeColor(r.regime_id);
                    return (
                      <div key={r.regime_id} className="flex items-center gap-1">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color.hex }} />
                        <span className="text-[7px] text-muted-foreground">{(r.nickname || r.label).replace(/_/g, " ")}</span>
                      </div>
                    );
                  })}
                </div>
              </Section>
            )}

            {/* Feature list */}
            <Section title={`Features (${diagnostics.n_features})`} icon={<Zap className="h-3 w-3 text-amber-400" />}>
              <div className="flex flex-wrap gap-1">
                {diagnostics.feature_names.map(f => (
                  <Badge key={f} variant="outline" className="text-[7px] px-1.5 py-0 rounded-full border-white/10">
                    {f}
                  </Badge>
                ))}
              </div>
            </Section>

            {/* Training config summary */}
            {diagnostics.training_config && (
              <Section title="Training Config" icon={<Settings2 className="h-3 w-3 text-muted-foreground" />}>
                <div className="grid grid-cols-3 gap-1 p-1.5 rounded bg-black/20 border border-white/5">
                  {Object.entries(diagnostics.training_config).map(([k, v]) => (
                    <div key={k}>
                      <span className="text-[7px] text-muted-foreground/50">{k.replace(/_/g, " ")}</span>
                      <p className="text-[8px] font-mono text-foreground/70">{String(v)}</p>
                    </div>
                  ))}
                </div>
              </Section>
            )}
          </div>
        )}

        {/* Empty state */}
        {models.length === 0 && !isTraining && (
          <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
            <Layers className="h-8 w-8 mb-2 opacity-20" />
            <p className="text-xs">No regime models yet</p>
            <p className="text-[10px] text-muted-foreground/60">Train one to detect market personalities</p>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

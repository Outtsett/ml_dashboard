/**
 * useRegimeTraining — Custom hook for HDP-HMM Training State
 *
 * Encapsulates all training state, React Query hooks, SSE streaming logic,
 * and derived metrics computation. Returns a single TrainingState object
 * consumed by all Training sub-components.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDashboard } from "@/contexts/UnifiedDashboardContext";
import { QUERY_KEYS } from "@/lib/types";
import type {
  TrainingProgress, LiveMetrics, RegimeModel, Diagnostics,
  ConvergencePoint, TrainingState,
} from "./types";
import { INITIAL_LIVE_METRICS } from "./types";

export function useRegimeTraining(): TrainingState {
  const queryClient = useQueryClient();
  const dashboard = useDashboard();

  // ── Symbol sync with unified dashboard context ─────────────────────────────
  const [selectedSymbol, setSelectedSymbolLocal] = useState(dashboard.symbol || 'ES');
  const setSelectedSymbol = (sym: string) => {
    setSelectedSymbolLocal(sym);
    dashboard.setSymbol(sym);
  };
  useEffect(() => {
    if (dashboard.symbol && dashboard.symbol !== selectedSymbol) {
      setSelectedSymbolLocal(dashboard.symbol);
    }
  }, [dashboard.symbol]);

  // ── HDP-HMM Config State ──────────────────────────────────────────────────
  // Sync timeframe from dashboard context so training uses what the chart shows
  const tfMinutesToLabel = (m: number): string => {
    const map: Record<number, string> = { 1: '1m', 5: '5m', 15: '15m', 30: '30m', 60: '1h', 240: '4h', 1440: '1d', 10080: '1w' };
    return map[m] ?? `${m}m`;
  };
  const [selectedTimeframe, setSelectedTimeframe] = useState(() => tfMinutesToLabel(dashboard.timeframeMinutes));
  const [gibbsIter, setGibbsIter] = useState(100);
  const [burnIn, setBurnIn] = useState(30);
  const [testSplit, setTestSplit] = useState(0.15);
  const [wfWindows, setWfWindows] = useState(5);
  const [alpha, setAlpha] = useState(1.0);
  const [gamma, setGamma] = useState(5.0);
  const [kappa, setKappa] = useState(50.0);
  const [showConfig, setShowConfig] = useState(false);

  // ── Training State ─────────────────────────────────────────────────────────
  const [isTraining, setIsTraining] = useState(false);

  // Sync timeframe from dashboard (don't change during active training)
  useEffect(() => {
    const label = tfMinutesToLabel(dashboard.timeframeMinutes);
    if (label !== selectedTimeframe && !isTraining) {
      setSelectedTimeframe(label);
    }
  }, [dashboard.timeframeMinutes, isTraining]);
  const [progress, setProgress] = useState<TrainingProgress | null>(null);
  const [trainLogs, setTrainLogs] = useState<string[]>([]);
  const [trainError, setTrainError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  // ── Live Training Metrics ──────────────────────────────────────────────────
  const [liveMetrics, setLiveMetrics] = useState<LiveMetrics | null>(null);
  const [liveConvergence, setLiveConvergence] = useState<ConvergencePoint[]>([]);
  const trainingStartRef = useRef<number>(0);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Results State ──────────────────────────────────────────────────────────
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [showTerminal, setShowTerminal] = useState(false);

  // ── Live Regime Assignments (for chart coloring during training) ────────
  const [liveRegimeTimestamps, setLiveRegimeTimestamps] = useState<number[]>([]);
  const [liveRegimeAssignments, setLiveRegimeAssignments] = useState<number[]>([]);

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: instruments = [] } = useQuery({
    queryKey: ['instruments'],
    queryFn: async () => {
      const res = await fetch('/api/instruments');
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
  });

  const { data: modelsData, refetch: refetchModels } = useQuery({
    queryKey: QUERY_KEYS.regimeModels,
    queryFn: async () => {
      const res = await fetch('/api/regime/models');
      if (!res.ok) throw new Error('Failed to load regime models');
      return res.json() as Promise<{ models: RegimeModel[] }>;
    },
    refetchInterval: isTraining ? 5000 : false,
  });
  const models = modelsData?.models || [];

  const { data: diagnostics } = useQuery({
    queryKey: QUERY_KEYS.regimeDiagnostics(selectedModel || ''),
    queryFn: async () => {
      const res = await fetch(`/api/regime/diagnostics/${selectedModel}`);
      if (!res.ok) throw new Error('Failed to load diagnostics');
      return res.json() as Promise<Diagnostics>;
    },
    enabled: !!selectedModel,
  });

  const { data: convergenceData } = useQuery({
    queryKey: [...QUERY_KEYS.regimeDiagnostics(selectedModel || ''), 'convergence'],
    queryFn: async () => {
      const res = await fetch(`/api/regime/convergence/${selectedModel}`);
      if (!res.ok) return null;
      return res.json() as Promise<Record<string, ConvergencePoint[]>>;
    },
    enabled: !!selectedModel,
  });

  const { data: trainingStatus } = useQuery({
    queryKey: ['regimeTrainingStatus'],
    queryFn: async () => {
      const res = await fetch('/api/regime/train/status');
      if (!res.ok) return null;
      return res.json();
    },
    refetchInterval: isTraining ? 3000 : false,
  });

  // ── Effects ────────────────────────────────────────────────────────────────

  // Sync training state from status endpoint (e.g. reconnect after page reload)
  useEffect(() => {
    const hasActiveJob = trainingStatus?.active?.some((j: { finished: boolean }) => !j.finished);
    if (hasActiveJob) {
      setIsTraining(true);
    }
  }, [trainingStatus]);

  // Auto-select most recent model (skip during training so cleared state stays cleared)
  useEffect(() => {
    if (!selectedModel && !isTraining && models.length > 0) {
      const sorted = [...models].sort((a, b) =>
        new Date(b.trained_at).getTime() - new Date(a.trained_at).getTime()
      );
      setSelectedModel(sorted[0]!.id);
    }
  }, [models, selectedModel, isTraining]);

  // Auto-scroll terminal
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [trainLogs]);

  // ── SSE Training ───────────────────────────────────────────────────────────

  const startTraining = useCallback(async () => {
    setIsTraining(true);
    setProgress(null);
    setTrainLogs([]);
    setTrainError(null);
    setSelectedModel(null);
    setShowTerminal(true);
    setLiveMetrics({ ...INITIAL_LIVE_METRICS, gibbsTotal: gibbsIter });
    setLiveConvergence([]);
    setLiveRegimeTimestamps([]);
    setLiveRegimeAssignments([]);
    trainingStartRef.current = Date.now();

    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    elapsedTimerRef.current = setInterval(() => {
      setLiveMetrics(prev => prev ? { ...prev, elapsed: (Date.now() - trainingStartRef.current) / 1000 } : prev);
    }, 1000);

    const abort = new AbortController();
    abortRef.current = abort;

    const ts = () => {
      const d = new Date();
      return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
    };

    const addLog = (msg: string) => {
      setTrainLogs(prev => [...prev.slice(-200), `${ts()} ${msg}`]);
    };

    addLog(`$ python train-hdp-hmm.py --symbol ${selectedSymbol} --timeframe ${selectedTimeframe} --gibbs-iter ${gibbsIter}`);

    try {
      // Step 1: POST to start training
      const startRes = await fetch('/api/regime/train', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: selectedSymbol,
          timeframe: selectedTimeframe,
          gibbsIter, burnIn, testSplit, wfWindows, alpha, gamma, kappa,
        }),
        signal: abort.signal,
      });

      if (!startRes.ok) {
        const errBody = await startRes.json().catch(() => ({ error: `HTTP ${startRes.status}` }));
        throw new Error(errBody.error || `Failed to start training`);
      }

      const { modelId } = await startRes.json();
      addLog(`Training job started: ${modelId}`);

      // Step 2: Connect to SSE stream
      const streamRes = await fetch(`/api/regime/train/stream/${modelId}`, {
        signal: abort.signal,
      });

      if (!streamRes.ok || !streamRes.body) {
        throw new Error(`Failed to connect to training stream`);
      }

      const reader = streamRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let eventName = '';
      let capturedNBarsTotal = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventName = line.slice(7).trim();
          } else if (line.startsWith('data: ') && eventName) {
            try {
              const data = JSON.parse(line.slice(6));
              switch (eventName) {
                case 'progress':
                  setProgress(data as TrainingProgress);
                  addLog(`[${data.step}/${data.totalSteps}] ${data.message}`);
                  break;
                case 'gibbs_progress': {
                  setLiveMetrics(prev => prev ? {
                    ...prev,
                    gibbsIter: data.iteration,
                    gibbsTotal: data.totalIterations,
                    logLikelihood: data.logLikelihood,
                    activeStates: data.activeStates,
                    delta: data.delta,
                    fitPerBar: data.fitPerBar ?? (capturedNBarsTotal > 0 ? data.logLikelihood / capturedNBarsTotal : 0),
                    entropy: data.entropy ?? 0,
                    switchRate: data.switchRate ?? 0,
                    selfTransition: data.selfTransition ?? 0,
                    maxRegimePct: data.maxRegimePct ?? 0,
                    avgDwell: data.avgDwell ?? 0,
                  } : prev);
                  setLiveConvergence(prev => [...prev, {
                    iter: data.iteration,
                    log_likelihood: data.logLikelihood,
                    n_active_states: data.activeStates,
                    delta: data.delta,
                    entropy: data.entropy ?? 0,
                    switch_rate: data.switchRate ?? 0,
                    self_transition: data.selfTransition ?? 0,
                    max_regime_pct: data.maxRegimePct ?? 0,
                    avg_dwell: data.avgDwell ?? 0,
                  }]);
                  const fitVal = data.fitPerBar ?? (capturedNBarsTotal > 0 ? data.logLikelihood / capturedNBarsTotal : 0);
                  const fitCol = fitVal !== 0 ? `Fit=${fitVal.toFixed(2)}/bar  ` : '';
                  addLog(`  iter ${String(data.iteration).padStart(4)}/${data.totalIterations}  Regimes=${data.activeStates}  ${fitCol}LL=${data.logLikelihood.toLocaleString(undefined, { maximumFractionDigits: 0 })}  Δ=${data.delta.toFixed(1)}  H=${(data.entropy ?? 0).toFixed(2)}  Sw=${(data.switchRate ?? 0).toFixed(3)}  Dw=${(data.avgDwell ?? 0).toFixed(1)}`);
                  break;
                }
                case 'metric':
                  if (data.type === 'regimes_discovered') {
                    setLiveMetrics(prev => prev ? { ...prev, regimesDiscovered: data.value } : prev);
                    addLog(`  ✓ Discovered ${data.value} regimes`);
                  } else if (data.type === 'stability') {
                    setLiveMetrics(prev => prev ? { ...prev, stability: data.value } : prev);
                    addLog(`  ✓ Walk-Forward Stability: ${(data.value * 100).toFixed(1)}%`);
                  } else if (data.type === 'oos_similarity') {
                    setLiveMetrics(prev => prev ? { ...prev, oosSimilarity: data.value } : prev);
                    addLog(`  ✓ OOS Distribution Similarity: ${(data.value * 100).toFixed(1)}%`);
                  } else if (data.type === 'oos_correlation') {
                    setLiveMetrics(prev => prev ? { ...prev, oosCorrelation: data.value } : prev);
                    addLog(`  ✓ OOS Profile Correlation: ${data.value.toFixed(3)}`);
                  } else if (data.type === 'quality_score') {
                    setLiveMetrics(prev => prev ? { ...prev, qualityScore: data.value } : prev);
                    addLog(`  ✓ Quality Score: ${data.value.toFixed(1)}/100`);
                  } else if (data.type === 'data_size') {
                    capturedNBarsTotal = data.value;
                    setLiveMetrics(prev => prev ? { ...prev, nBarsTotal: data.value } : prev);
                  }
                  break;
                case 'status':
                  addLog(`${data.message || data.phase}`);
                  break;
                case 'log':
                  addLog(`${data.message}`);
                  break;
                case 'regime_line':
                  addLog(`  ${data.text}`);
                  break;
                case 'caught_up':
                  break;
                case 'regime_timestamps':
                  // Receive bar timestamps once at training start (epoch seconds)
                  setLiveRegimeTimestamps(data.timestamps);
                  break;
                case 'regime_snapshot':
                  // Receive regime assignments per Gibbs iteration
                  setLiveRegimeAssignments(data.assignments);
                  break;
                case 'done': {
                  setSelectedModel(data.modelId);
                  addLog(`✓ Model saved: ${data.modelId} (${data.elapsed}s)`);

                  // Log summary matching every hero card value
                  if (data.diagnostics) {
                    const d = data.diagnostics;
                    const nBars = d.n_bars_total || 1;
                    const ll = d.convergence_summary?.final_log_likelihood || 0;
                    const llBar = ll !== 0 ? (ll / nBars).toFixed(2) : '--';
                    const elapsed = d.training_time_sec || parseFloat(data.elapsed) || 0;
                    const timeStr = elapsed >= 60
                      ? `${Math.floor(elapsed / 60)}m ${Math.round(elapsed % 60)}s`
                      : `${elapsed.toFixed(0)}s`;

                    addLog(`────────── Training Report ──────────`);
                    addLog(`  Regimes       ${d.n_regimes}`);
                    addLog(`  Walk-Forward  ${d.walk_forward ? `${(d.walk_forward.stability_score * 100).toFixed(0)}%` : '--'}`);
                    addLog(`  Quality       ${d.quality_score != null ? `${d.quality_score.toFixed(0)}/100` : '--'}`);
                    addLog(`  OOS Match     ${d.out_of_sample ? `${(d.out_of_sample.distribution_similarity * 100).toFixed(0)}%` : '--'}`);
                    addLog(`  Profile Corr  ${d.out_of_sample ? d.out_of_sample.avg_profile_correlation.toFixed(2) : '--'}`);
                    addLog(`  Switch Ratio  ${d.out_of_sample ? `${d.out_of_sample.switch_rate_ratio.toFixed(2)}×` : '--'}`);
                    addLog(`  Model Fit     ${llBar}/bar  (${ll.toLocaleString(undefined, { maximumFractionDigits: 0 })} total · ${nBars.toLocaleString()} bars)`);
                    addLog(`  Time          ${timeStr}`);
                    addLog(`─────────────────────────────────────`);
                  }

                  addLog(`Training complete.`);
                  refetchModels();
                  queryClient.invalidateQueries({
                    queryKey: QUERY_KEYS.regimeDiagnostics(data.modelId),
                  });
                  break;
                }
                case 'error':
                  setTrainError(data.message);
                  addLog(`✗ ERROR: ${data.message}`);
                  if (data.details) addLog(`  ${data.details.slice(0, 300)}`);
                  break;
                case 'warning':
                  addLog(`⚠ ${data.message}`);
                  break;
              }
            } catch {
              // Skip malformed JSON
            }
            eventName = '';
          }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setTrainError(err.message);
        addLog(`✗ ERROR: ${err.message}`);
      }
    } finally {
      setIsTraining(false);
      abortRef.current = null;
      if (elapsedTimerRef.current) {
        clearInterval(elapsedTimerRef.current);
        elapsedTimerRef.current = null;
      }
    }
  }, [selectedSymbol, selectedTimeframe, gibbsIter, burnIn, testSplit, wfWindows, alpha, gamma, kappa, refetchModels, queryClient]);

  const stopTraining = useCallback(() => {
    abortRef.current?.abort();
    fetch('/api/regime/train/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: selectedSymbol, timeframe: selectedTimeframe }),
    });
    setIsTraining(false);
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
    setTrainLogs(prev => [...prev, `${new Date().toLocaleTimeString()} Training stopped by user`]);
  }, [selectedSymbol, selectedTimeframe]);

  const deleteModel = useCallback(async (id: string) => {
    await fetch(`/api/regime/models/${id}`, { method: 'DELETE' });
    if (selectedModel === id) setSelectedModel(null);
    refetchModels();
  }, [selectedModel, refetchModels]);

  // ── Derived Metrics ────────────────────────────────────────────────────────
  // During training: use live metrics only (never fall back to stale diagnostics)
  // Idle with selected model: use diagnostics from that model
  // No model selected: all zeros
  const metrics = isTraining && liveMetrics != null ? {
    quality:      liveMetrics.qualityScore,
    regimes:      liveMetrics.regimesDiscovered || liveMetrics.activeStates,
    stability:    liveMetrics.stability,
    oos:          liveMetrics.oosSimilarity,
    profileCorr:  liveMetrics.oosCorrelation,
    ll:           liveMetrics.logLikelihood,
    activeStates: liveMetrics.activeStates,
    elapsedSec:   liveMetrics.elapsed,
  } : !isTraining && diagnostics ? {
    quality:      diagnostics.quality_score ?? 0,
    regimes:      diagnostics.n_regimes ?? 0,
    stability:    diagnostics.walk_forward?.stability_score ?? 0,
    oos:          diagnostics.out_of_sample?.distribution_similarity ?? 0,
    profileCorr:  diagnostics.out_of_sample?.avg_profile_correlation ?? 0,
    ll:           diagnostics.convergence_summary?.final_log_likelihood ?? 0,
    activeStates: diagnostics.convergence_summary?.final_active_states ?? 0,
    elapsedSec:   diagnostics.training_time_sec ?? 0,
  } : {
    quality: 0, regimes: 0, stability: 0, oos: 0,
    profileCorr: 0, ll: 0, activeStates: 0, elapsedSec: 0,
  };

  const nBarsForLL = (isTraining && liveMetrics?.nBarsTotal) ? liveMetrics.nBarsTotal
    : diagnostics?.n_bars_total || 1;
  const llPerBar = metrics.ll !== 0 ? metrics.ll / nBarsForLL : 0;

  const gibbsPhase = progress?.phase || '';
  const isGibbsSampling = isTraining && gibbsPhase === 'gibbs_sampling';
  const isPostGibbs = isTraining && ['walk_forward', 'oos_evaluation', 'analyzing', 'saving'].includes(gibbsPhase);

  const convergencePoints: ConvergencePoint[] =
    liveConvergence.length > 0 && !convergenceData ? liveConvergence : (convergenceData?.gibbs || []);

  const wfWindResults = diagnostics?.walk_forward?.window_results || [];
  const oos = diagnostics?.out_of_sample;
  const futuresSymbols = instruments.filter((i: any) => i.assetType === 'futures').map((i: any) => i.symbol);

  return {
    selectedSymbol, setSelectedSymbol,
    selectedTimeframe, setSelectedTimeframe,
    gibbsIter, setGibbsIter,
    burnIn, setBurnIn,
    testSplit, setTestSplit,
    wfWindows, setWfWindows,
    alpha, setAlpha,
    gamma, setGamma,
    kappa, setKappa,
    isTraining, progress, trainLogs, trainError,
    liveMetrics, liveConvergence, logEndRef,
    liveRegimeTimestamps, liveRegimeAssignments,
    startTraining, stopTraining, deleteModel,
    selectedModel, setSelectedModel,
    showTerminal, setShowTerminal,
    showConfig, setShowConfig,
    instruments, models, diagnostics, convergenceData,
    metrics, nBarsForLL, llPerBar,
    gibbsPhase, isGibbsSampling, isPostGibbs,
    convergencePoints, wfWindResults, oos, futuresSymbols,
  };
}

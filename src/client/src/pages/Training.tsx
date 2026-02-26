/**
 * Training Center — Model-agnostic training dashboard.
 *
 * Think of it as: the analytics room where you review model results.
 * The Train button works like VS Code's Run button — it doesn't care
 * what model you're training. You select a model, press Train, and go.
 *
 * Data flows:
 *   useTrainingContext()        → Train button, SSE, progress (model-agnostic)
 *   useRegimeModels/Diagnostics → Saved model list, per-model metrics (data hooks)
 */

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Activity, Flame } from "lucide-react";

import { useTrainingContext } from "@/contexts/TrainingContext";
import { useDashboard } from "@/contexts/UnifiedDashboardContext";
import { useRegimeModels, useRegimeDiagnostics, useRegimeConvergence } from "@/hooks/useRegimeData";
import { regimeApi } from "@/lib/apiService";
import { getQualityLabel } from "@/components/training/types";
import type { TrainingProgress, LiveMetrics, ConvergencePoint } from "@/components/training/types";
import { INITIAL_LIVE_METRICS } from "@/components/training/types";
import { getAdapter } from "@/components/training/modelAdapters";
import DataPipelineFlow from "@/components/training/DataPipelineFlow";
import HeroStrip from "@/components/training/HeroStrip";
import ModelTabs from "@/components/training/ModelTabs";
import ModelPicker from "@/components/training/ModelPicker";

export default function Training() {
  const training = useTrainingContext();
  const dashboard = useDashboard();
  const [hyperOverrides, setHyperOverrides] = useState<Record<string, number | string | boolean>>({});

  // ── Model CRUD state (direct hooks, not coupled to training button) ──
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const { models, refetch: refetchModels } = useRegimeModels(training.isTraining);
  const { data: diagnostics } = useRegimeDiagnostics(selectedModel);
  const { data: convergenceData } = useRegimeConvergence(selectedModel);

  // Auto-select most recent model when idle
  useEffect(() => {
    if (!selectedModel && !training.isTraining && models.length > 0) {
      const sorted = [...models].sort((a, b) =>
        new Date(b.trained_at).getTime() - new Date(a.trained_at).getTime()
      );
      setSelectedModel(sorted[0]!.id);
    }
  }, [models, selectedModel, training.isTraining]);

  // Select newly completed model
  useEffect(() => {
    if (training.completedModelId) {
      setSelectedModel(String(training.completedModelId));
      refetchModels();
    }
  }, [training.completedModelId, refetchModels]);

  const deleteModel = async (id: string) => {
    await regimeApi.deleteModel(Number(id));
    if (selectedModel === id) setSelectedModel(null);
    refetchModels();
  };

  // ── Training actions ──
  const selectedSymbol = dashboard.symbol || 'ES';

  const handleTrain = () => {
    training.startTraining({
      modelType: training.selectedModelType,
      symbol: selectedSymbol,
      timeframe: training.timeframeLabel,
      hyperparameters: hyperOverrides,
    });
  };

  const handleHyperChange = (key: string, value: number | string | boolean) => {
    setHyperOverrides(prev => ({ ...prev, [key]: value }));
  };

  // ── Derive training metrics from state + diagnostics ──
  const isTraining = training.isTraining;
  const gibbsIter = (training.config?.hyperparameters as Record<string, number>)?.gibbsIter ?? 200;

  // Build LiveMetrics from universal metrics (Record<string, number>)
  const liveMetrics: LiveMetrics | null = isTraining ? {
    ...INITIAL_LIVE_METRICS,
    gibbsIter: training.iterationHistory.at(-1)?.iteration ?? 0,
    gibbsTotal: (training.iterationHistory.at(-1)?.metrics?.totalIterations as number) ?? gibbsIter,
    logLikelihood: training.metrics.logLikelihood ?? 0,
    activeStates: training.metrics.activeStates ?? 0,
    delta: training.metrics.delta ?? 0,
    fitPerBar: training.metrics.fitPerBar ?? 0,
    entropy: training.metrics.entropy ?? 0,
    switchRate: training.metrics.switchRate ?? 0,
    selfTransition: training.metrics.selfTransition ?? 0,
    maxRegimePct: training.metrics.maxRegimePct ?? 0,
    avgDwell: training.metrics.avgDwell ?? 0,
    nBarsTotal: training.totalBars ?? 0,
    regimesDiscovered: training.metrics.regimes_discovered ?? 0,
    stability: training.metrics.stability ?? 0,
    oosSimilarity: training.metrics.oos_similarity ?? 0,
    oosCorrelation: training.metrics.oos_correlation ?? 0,
    qualityScore: training.metrics.quality_score ?? 0,
    elapsed: training.elapsedSec,
  } : null;

  const liveConvergence: ConvergencePoint[] = training.iterationHistory.map(h => ({
    iter: h.iteration,
    log_likelihood: h.metrics.logLikelihood ?? 0,
    n_active_states: h.metrics.activeStates,
    delta: h.metrics.delta,
    entropy: h.metrics.entropy,
    switch_rate: h.metrics.switchRate,
    self_transition: h.metrics.selfTransition,
    max_regime_pct: h.metrics.maxRegimePct,
    avg_dwell: h.metrics.avgDwell,
  }));

  // Build progress from universal state
  const progress: TrainingProgress | null = isTraining ? {
    step: Math.round(training.progress),
    totalSteps: 100,
    phase: training.phase,
    message: training.logs.at(-1) ?? '',
    pct: training.progress,
  } : null;

  // Phase detection
  const gibbsPhase = training.phase || '';
  const isGibbsSampling = isTraining && gibbsPhase === 'gibbs_sampling';
  const isPostGibbs = isTraining && ['walk_forward', 'oos_evaluation', 'analyzing', 'saving'].includes(gibbsPhase);

  // Derived metrics (live during training, from diagnostics when idle)
  const metrics = useMemo(() => {
    if (isTraining && liveMetrics != null) return {
      quality: liveMetrics.qualityScore,
      regimes: liveMetrics.regimesDiscovered || liveMetrics.activeStates,
      stability: liveMetrics.stability,
      oos: liveMetrics.oosSimilarity,
      profileCorr: liveMetrics.oosCorrelation,
      ll: liveMetrics.logLikelihood,
      activeStates: liveMetrics.activeStates,
      elapsedSec: liveMetrics.elapsed,
    };
    if (!isTraining && diagnostics) return {
      quality: diagnostics.quality_score ?? 0,
      regimes: diagnostics.n_regimes ?? 0,
      stability: diagnostics.walk_forward?.stability_score ?? 0,
      oos: diagnostics.out_of_sample?.distribution_similarity ?? 0,
      profileCorr: diagnostics.out_of_sample?.avg_profile_correlation ?? 0,
      ll: diagnostics.convergence_summary?.final_log_likelihood ?? 0,
      activeStates: diagnostics.convergence_summary?.final_active_states ?? 0,
      elapsedSec: diagnostics.training_time_sec ?? 0,
    };
    return { quality: 0, regimes: 0, stability: 0, oos: 0, profileCorr: 0, ll: 0, activeStates: 0, elapsedSec: 0 };
  }, [isTraining, liveMetrics, diagnostics]);

  const nBarsForLL = (isTraining && liveMetrics?.nBarsTotal) ? liveMetrics.nBarsTotal : diagnostics?.n_bars_total || 1;
  const llPerBar = metrics.ll !== 0 ? metrics.ll / nBarsForLL : 0;
  const convergencePoints: ConvergencePoint[] = liveConvergence.length > 0 && !convergenceData ? liveConvergence : (convergenceData?.gibbs || []);
  const wfWindResults = diagnostics?.walk_forward?.window_results || [];
  const oos = diagnostics?.out_of_sample;

  const modelType = training.selectedModelType;
  const adapter = getAdapter(modelType);
  const qualityScore = metrics.quality;
  const pipelinePhase = progress?.phase || (isTraining ? 'starting' : diagnostics ? 'complete' : '');
  const nRegimes = metrics.regimes;
  const selectedTimeframe = training.timeframeLabel;

  return (
    <ScrollArea className="h-full">
    <div className="space-y-4 p-1">

      {/* ─── Header ─── */}
      <div className="flex flex-wrap justify-between items-center gap-3 shrink-0">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Flame className={`h-5 w-5 ${isTraining ? 'text-orange-400 pulse-slow' : 'text-muted-foreground'}`} />
            <span className={`text-sm font-medium ${isTraining ? 'text-orange-400' : 'text-muted-foreground'}`}>
              {isTraining ? adapter.activeLabel : adapter.idleLabel}
            </span>
            {training.error && (
              <Badge variant="outline" className="border-rose-500/50 text-rose-400 bg-rose-500/10 gap-1 text-xs">
                Error
              </Badge>
            )}
            {qualityScore > 0 && !isTraining && (
              <Badge variant="outline" className={`text-xs ${
                qualityScore >= 80 ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10' :
                qualityScore >= 60 ? 'border-amber-500/30 text-amber-400 bg-amber-500/10' :
                'border-orange-500/30 text-orange-400 bg-orange-500/10'
              }`}>
                Quality: {qualityScore.toFixed(0)} · {getQualityLabel(qualityScore)}
              </Badge>
            )}
          </div>
          <h1 className="text-3xl font-display font-bold text-foreground">Training Center</h1>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <Badge variant="outline" className="h-9 px-3 font-mono gap-1.5 text-xs rounded-full border-white/10">
            {selectedSymbol} · {selectedTimeframe}
          </Badge>
          <Badge variant="outline" className={`h-9 px-3 font-mono gap-1.5 text-xs rounded-full ${
            isTraining ? 'border-orange-500/30 text-orange-400 bg-orange-500/10' : 'border-muted-foreground/30 text-muted-foreground'
          }`}>
            <Flame className={`h-3.5 w-3.5 ${isTraining ? 'pulse-slow' : ''}`} />
            {progress ? `${progress.pct.toFixed(0)}%` : 'Ready'}
          </Badge>
        </div>
      </div>

      {/* ─── Universal Model Picker + Train Button ─── */}
      <Card className="glass rounded-2xl gradient-border">
        <CardHeader className="border-b border-white/5 py-2 px-4">
          <CardTitle className="text-xs font-medium text-muted-foreground">
            Universal Training
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3">
          <ModelPicker
            models={training.availableModels}
            selectedModel={training.selectedModelType}
            onSelectModel={training.setSelectedModelType}
            hyperparameterOverrides={hyperOverrides}
            onHyperparameterChange={handleHyperChange}
            isTraining={training.isTraining}
            onTrain={handleTrain}
            onStop={training.stopTraining}
            symbol={selectedSymbol}
            timeframe={training.timeframeLabel}
            progress={training.progress}
            phase={training.phase}
          />
        </CardContent>
      </Card>

      {/* ─── Section 1: Data Pipeline Flow ─── */}
      <Card className="glass rounded-2xl gradient-border">
        <CardHeader className="border-b border-white/5 py-2 px-4">
          <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
            <Activity className="h-3 w-3 text-cyan-400" /> Data Pipeline
            <span className="text-[10px] opacity-50 ml-auto font-normal">
              Think of it as: {adapter.pipelineDescription}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3">
          <DataPipelineFlow
            modelType={modelType}
            symbol={selectedSymbol}
            timeframe={selectedTimeframe}
            numBars={diagnostics?.n_bars_total}
            numFeatures={diagnostics?.n_features || 10}
            trainSize={diagnostics?.n_bars_train_val}
            testSize={diagnostics?.n_bars_test}
            isTraining={isTraining}
            gibbsIter={gibbsIter}
            currentStep={progress?.step}
            totalSteps={progress?.totalSteps}
            phase={pipelinePhase}
            nRegimes={nRegimes}
          />
        </CardContent>
      </Card>

      {/* ─── Section 2: Hero Strip (live training metrics) ─── */}
      <HeroStrip
        isTraining={isTraining}
        progress={progress}
        gibbsIter={gibbsIter}
        gibbsPhase={gibbsPhase}
        isGibbsSampling={isGibbsSampling}
        isPostGibbs={isPostGibbs}
        liveMetrics={liveMetrics}
        liveConvergence={liveConvergence}
        diagnostics={diagnostics}
        metrics={metrics}
        nBarsForLL={nBarsForLL}
        llPerBar={llPerBar}
        convergencePoints={convergencePoints}
        wfWindResults={wfWindResults}
        oos={oos}
      />

      {/* ─── Section 3: Model Tabs — each model gets its own tab with metric sub-tabs ─── */}
      <ModelTabs
        models={models || []}
        selectedModel={selectedModel}
        setSelectedModel={setSelectedModel}
        deleteModel={deleteModel}
      />
    </div>
    </ScrollArea>
  );
}

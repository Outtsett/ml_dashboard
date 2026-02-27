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

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Activity, Flame } from "lucide-react";

import { useTrainingContext } from "@/contexts/TrainingContext";
import { useDashboard } from "@/contexts/UnifiedDashboardContext";
import { useRegimeModels, useRegimeDiagnostics, useRegimeConvergence } from "@/hooks/useRegimeData";
import { useTrainingMetrics } from "@/hooks/useTrainingMetrics";
import { regimeApi } from "@/lib/apiService";
import { getQualityLabel } from "@/components/training/types";
import { getAdapter } from "@/components/training/modelAdapters";
import DataPipelineFlow from "@/components/training/DataPipelineFlow";
import HeroStrip from "@/components/training/HeroStrip";
import ModelTabs from "@/components/training/ModelTabs";
import ModelPicker from "@/components/training/ModelPicker";
import { LiveTrainingDashboard } from "@/components/training/live";

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
    await regimeApi.deleteModel(id);
    if (selectedModel === id) setSelectedModel(null);
    refetchModels();
  };

  // ── Training actions ──
  const selectedSymbol = dashboard.symbol;

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

  // ── Derive training metrics from state + diagnostics (extracted to hook — SRP) ──
  const {
    isTraining, liveMetrics, liveConvergence, progress,
    gibbsPhase, isGibbsSampling, isPostGibbs,
    metrics, nBarsForLL, llPerBar, convergencePoints,
    wfWindResults, oos, gibbsIter,
  } = useTrainingMetrics(training, diagnostics, convergenceData);

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
            isPending={training.isPending}
            onTrain={handleTrain}
            onStop={training.stopTraining}
            symbol={selectedSymbol}
            timeframe={training.timeframeLabel}
            progress={training.progress}
            phase={training.phase}
            error={training.error}
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

      {/* ─── Section 2b: Live Training Analytics (visible during/after training) ─── */}
      <LiveTrainingDashboard />

      {/* ─── Section 3: Model Tabs — each model gets its own tab with metric sub-tabs + training log ─── */}
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

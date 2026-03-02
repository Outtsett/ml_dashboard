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
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { Activity, Flame } from "lucide-react";

import { useTrainingContext } from "@/contexts/TrainingContext";
import { useDashboard } from "@/contexts/UnifiedDashboardContext";
import { useRegimeModels, useRegimeDiagnostics, useRegimeConvergence } from "@/hooks/useRegimeData";
import { useTrainingMetrics } from "@/hooks/useTrainingMetrics";
import { regimeApi } from "@/lib/apiService";
import { getQualityLabel } from "@/components/training/types";
import { getAdapter } from "@/components/training/modelAdapters";
import DataPipelineFlow from "@/components/training/DataPipelineFlow";
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

  // Clear selected model when model type changes — prevents stale cross-model data
  useEffect(() => {
    setSelectedModel(null);
  }, [training.selectedModelType]);

  // Auto-select most recent model of the current type when idle
  useEffect(() => {
    if (!selectedModel && !training.isTraining && models.length > 0) {
      const mt = training.selectedModelType;
      const matching = models.filter(m => m.modelType === mt);
      if (matching.length > 0) {
        const sorted = [...matching].sort((a, b) =>
          new Date(b.trained_at).getTime() - new Date(a.trained_at).getTime()
        );
        setSelectedModel(sorted[0]!.id);
      }
    }
  }, [models, selectedModel, training.isTraining, training.selectedModelType]);

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
    const maxBars = hyperOverrides.maxBars != null ? Number(hyperOverrides.maxBars) : undefined;
    training.startTraining({
      modelType: training.selectedModelType,
      symbol: selectedSymbol,
      timeframe: training.timeframeLabel,
      hyperparameters: hyperOverrides,
      maxBars,
    });
  };

  const handleHyperChange = (key: string, value: number | string | boolean) => {
    setHyperOverrides(prev => ({ ...prev, [key]: value }));
  };

  // ── Derive training metrics from state + diagnostics (extracted to hook — SRP) ──
  const {
    isTraining, progress,
    trainingPhase, metrics, convergencePoints, iterationCount,
  } = useTrainingMetrics(training, diagnostics, convergenceData);

  const modelType = training.selectedModelType;
  const adapter = getAdapter(modelType);

  // Filter saved models to only show the current model type
  const filteredModels = useMemo(() => {
    if (!models?.length) return [];
    return models.filter(m => m.modelType === modelType);
  }, [models, modelType]);
  const modelEntry = training.availableModels[modelType];
  const modelDisplayName = modelEntry?.name ?? adapter.name;
  const qualityScore = metrics.quality;
  const pipelinePhase = progress?.phase || (isTraining ? 'starting' : diagnostics ? 'complete' : '');
  const nRegimes = metrics.regimes;
  const selectedTimeframe = training.timeframeLabel;

  return (
    <div className="flex flex-col h-full p-1 gap-2">
      {/* ─── Header (fixed, not resizable) ─── */}
      <div className="shrink-0 space-y-3">
        <div className="flex flex-wrap justify-between items-center gap-3">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <Flame className={`h-5 w-5 ${isTraining ? 'text-orange-400 pulse-slow' : 'text-muted-foreground'}`} />
              <span className={`text-sm font-medium ${isTraining ? 'text-orange-400' : 'text-muted-foreground'}`}>
                {isTraining ? `Training ${modelDisplayName}` : modelDisplayName}
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
              {adapter.name} · {selectedSymbol} · {selectedTimeframe}
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
              {modelDisplayName}
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
      </div>

      {/* ─── Resizable Content Sections (2 panels) ─── */}
      <ResizablePanelGroup direction="vertical" autoSaveId="training-layout-v2" className="flex-1 min-h-0">
        {/* Top: Pipeline + Live (collapsible) */}
        <ResizablePanel defaultSize={isTraining ? 30 : 8} minSize={5} collapsible>
          <div className="h-full flex flex-col gap-2 min-h-0">
            <Card className="glass rounded-2xl gradient-border shrink-0">
              <CardHeader className="border-b border-white/5 py-2 px-4">
                <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
                  <Activity className="h-3 w-3 text-cyan-400" /> Data Pipeline
                  <span className="text-[10px] opacity-50 ml-auto font-normal">
                    {adapter.pipelineDescription}
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
                  iterationCount={iterationCount}
                  currentStep={progress?.step}
                  totalSteps={progress?.totalSteps}
                  phase={pipelinePhase}
                  nRegimes={nRegimes}
                />
              </CardContent>
            </Card>
            {(isTraining || training.completedModelId) && (
              <div className="flex-1 min-h-0">
                <LiveTrainingDashboard />
              </div>
            )}
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle className="my-1 bg-white/4 hover:bg-white/10 transition-colors" />

        {/* Bottom: ModelTabs (THE HERO — fills remaining space) */}
        <ResizablePanel defaultSize={isTraining ? 70 : 92} minSize={30}>
          <div className="h-full min-h-0">
            <ModelTabs
              models={filteredModels}
              selectedModel={selectedModel}
              setSelectedModel={setSelectedModel}
              deleteModel={deleteModel}
            />
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

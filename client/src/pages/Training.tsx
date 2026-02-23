/**
 * Training Center — HDP-HMM Regime Metrics Dashboard
 *
 * Think of it as: the analytics room where you review model results.
 * Training is launched from Market Data, configured in ML Tools,
 * and this page is where you deep-dive into the metrics:
 * pipeline flow, hero metrics, per-model tabs with charts.
 */

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Activity, Flame } from "lucide-react";

import { useRegimeTrainingContext } from "@/contexts/RegimeTrainingContext";
import { useTrainingContext } from "@/contexts/TrainingContext";
import { getQualityLabel } from "@/components/training/types";
import DataPipelineFlow from "@/components/training/DataPipelineFlow";
import HeroStrip from "@/components/training/HeroStrip";
import ModelTabs from "@/components/training/ModelTabs";
import ModelPicker from "@/components/training/ModelPicker";

export default function Training() {
  const state = useRegimeTrainingContext();
  const training = useTrainingContext();
  const [hyperOverrides, setHyperOverrides] = useState<Record<string, number | string | boolean>>({});

  const handleTrain = () => {
    training.startTraining({
      modelType: training.selectedModelType,
      symbol: state.selectedSymbol,
      timeframe: training.timeframeLabel,
      hyperparameters: hyperOverrides,
    });
  };

  const handleHyperChange = (key: string, value: number | string | boolean) => {
    setHyperOverrides(prev => ({ ...prev, [key]: value }));
  };

  const {
    selectedSymbol,
    selectedTimeframe,
    gibbsIter,
    isTraining, progress, trainError,
    diagnostics,
    metrics,
  } = state;

  const qualityScore = metrics.quality;
  const pipelinePhase = progress?.phase || (isTraining ? 'starting' : diagnostics ? 'complete' : '');
  const nRegimes = metrics.regimes;

  return (
    <ScrollArea className="h-full">
    <div className="space-y-4 p-1">

      {/* ─── Header ─── */}
      <div className="flex flex-wrap justify-between items-center gap-3 shrink-0">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Flame className={`h-5 w-5 ${isTraining ? 'text-orange-400 pulse-slow' : 'text-muted-foreground'}`} />
            <span className={`text-sm font-medium ${isTraining ? 'text-orange-400' : 'text-muted-foreground'}`}>
              {isTraining ? 'HDP-HMM Gibbs Sampler Active' : 'HDP-HMM Idle'}
            </span>
            {trainError && (
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
              Think of it as: OHLCV bars → regime features → Gibbs sampler → discovered moods
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3">
          <DataPipelineFlow
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
      <HeroStrip state={state} />

      {/* ─── Section 3: Model Tabs — each model gets its own tab with metric sub-tabs ─── */}
      <ModelTabs
        models={state.models || []}
        selectedModel={state.selectedModel}
        setSelectedModel={state.setSelectedModel}
        deleteModel={state.deleteModel}
      />
    </div>
    </ScrollArea>
  );
}

import { useState, useEffect, Fragment, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  BookOpen,
  Settings2,
  Activity,
  Trophy,
  ArrowLeft,
  Play,
  RotateCcw,
  Sparkles,
} from "lucide-react";

import ModelCatalogPicker from "@/components/training/ModelCatalogPicker";
import TrainingModeSelector, {
  type TrainingMode,
} from "@/components/training/TrainingModeSelector";
import HyperparameterForm from "@/components/training/HyperparameterForm";
import HPOConfigPanel from "@/components/training/HPOConfigPanel";
import {
  HPODashboard,
  HPOConvergence,
  TrialComparison,
} from "@/components/training/hpo";

import { useDashboard } from "@/contexts/UnifiedDashboardContext";
import { minutesToLabel } from "@/lib/timeframes";

import type { ModelRegistryEntry } from "@shared/trainingTypes";
import type {
  OptimizerType,
  SearchSpaceDef,
  HPOSession,
} from "@shared/hpoTypes";

/* ------------------------------------------------------------------ */
/*  Step definitions                                                   */
/* ------------------------------------------------------------------ */

type WorkflowStep = "select-model" | "configure" | "running" | "results";

const STEPS = [
  { key: "select-model" as const, label: "Select Model", icon: BookOpen },
  { key: "configure" as const, label: "Configure", icon: Settings2 },
  { key: "running" as const, label: "Optimizing", icon: Activity },
  { key: "results" as const, label: "Results", icon: Trophy },
];

/* ------------------------------------------------------------------ */
/*  HPOWorkflow                                                        */
/* ------------------------------------------------------------------ */

export function HPOWorkflow() {
  /* ---- step state ---- */
  const [step, setStep] = useState<WorkflowStep>("select-model");

  /* ---- model selection ---- */
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] =
    useState<ModelRegistryEntry | null>(null);

  /* ---- mode ---- */
  const [mode, setMode] = useState<TrainingMode>("hpo");

  /* ---- hyperparameter values ---- */
  const [hyperparamValues, setHyperparamValues] = useState<
    Record<string, number | string | boolean>
  >({});

  /* ---- HPO configuration ---- */
  const [optimizerType, setOptimizerType] =
    useState<OptimizerType>("optuna");
  const [optimizerConfig, setOptimizerConfig] = useState<
    Record<string, any>
  >({});
  const [searchSpace, setSearchSpace] = useState<SearchSpaceDef>({});

  /* ---- running / results ---- */
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionData, setSessionData] = useState<HPOSession | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  /* ---- context ---- */
  const { symbol, timeframeMinutes } = useDashboard();

  const stepIdx = STEPS.findIndex((s) => s.key === step);

  /* ================================================================ */
  /*  Handlers                                                         */
  /* ================================================================ */

  const handleSelectModel = useCallback(
    (modelId: string, model: ModelRegistryEntry) => {
      setSelectedModelId(modelId);
      setSelectedModel(model);

      // Populate defaults from the model's hyperparameter definitions
      const defaults: Record<string, number | string | boolean> = {};
      if (model.defaultHyperparameters) {
        for (const [key, def] of Object.entries(
          model.defaultHyperparameters,
        )) {
          defaults[key] = def.default;
        }
      }
      setHyperparamValues(defaults);
      setStep("configure");
    },
    [],
  );

  const handleHyperparamChange = useCallback(
    (key: string, value: number | string | boolean) => {
      setHyperparamValues((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const handleResetHyperparams = useCallback(() => {
    if (!selectedModel?.defaultHyperparameters) return;
    const defaults: Record<string, number | string | boolean> = {};
    for (const [key, def] of Object.entries(
      selectedModel.defaultHyperparameters,
    )) {
      defaults[key] = def.default;
    }
    setHyperparamValues(defaults);
  }, [selectedModel]);

  /* ---- fetch session when entering results step ---- */
  useEffect(() => {
    if (step !== "results" || !sessionId) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`/api/hpo/sessions/${sessionId}`);
        if (res.ok && !cancelled) {
          setSessionData(await res.json());
        }
      } catch {
        /* user can retry via "New Optimization" */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [step, sessionId]);

  /* ---- error state ---- */
  const [startError, setStartError] = useState<string | null>(null);

  /* ---- start training / HPO ---- */
  const handleStart = async () => {
    if (!selectedModel || !selectedModelId) return;
    setIsStarting(true);
    setStartError(null);

    try {
      if (mode === "manual") {
        const res = await fetch("/api/training/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            modelType: selectedModelId,
            symbol,
            timeframe: minutesToLabel(timeframeMinutes),
            hyperparameters: hyperparamValues,
          }),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(errData.error || `Server error ${res.status}`);
        }
        const data = await res.json();
        if (data.sessionId) {
          setSessionId(data.sessionId);
          setStep("running");
        }
      } else {
        // HPO or W&B sweep
        const res = await fetch("/api/hpo/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            modelType: selectedModelId,
            symbol,
            timeframe: minutesToLabel(timeframeMinutes),
            optimizerType,
            optimizerConfig,
            searchSpace,
            objectiveMetric: "score",
            direction: optimizerConfig.direction ?? "minimize",
            nTrials: optimizerConfig.nTrials || 50,
            fixedHyperparameters: hyperparamValues,
          }),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(errData.error || `Server error ${res.status}`);
        }
        const data = await res.json();
        if (data.sessionId) {
          setSessionId(data.sessionId);
          setStep("running");
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setStartError(message);
    } finally {
      setIsStarting(false);
    }
  };

  const handleHPOClose = useCallback(() => {
    setStep("results");
  }, []);

  const handleApplyBestParams = useCallback(
    (params: Record<string, any>) => {
      setHyperparamValues(
        params as Record<string, number | string | boolean>,
      );
      setMode("manual");
      setStep("configure");
    },
    [],
  );

  const handleReset = useCallback(() => {
    setStep("select-model");
    setSelectedModelId(null);
    setSelectedModel(null);
    setMode("hpo");
    setHyperparamValues({});
    setOptimizerType("optuna");
    setOptimizerConfig({});
    setSearchSpace({});
    setSessionId(null);
    setSessionData(null);
  }, []);

  /* ================================================================ */
  /*  Derived data for the results panels                              */
  /* ================================================================ */

  const trials = sessionData?.trials ?? [];

  const trialDataForConvergence = trials.map((t) => ({
    trialId: t.trialId,
    score: t.score,
    pruned: t.pruned,
    durationSec: t.durationSec,
    params: t.params,
  }));

  const trialDataForComparison = trials.map((t) => ({
    trialId: t.trialId,
    score: t.score,
    pruned: t.pruned,
    durationSec: t.durationSec,
    params: t.params,
    metrics: t.metrics,
    status: t.error ? "failed" : t.pruned ? "pruned" : "completed",
  }));

  const searchDimensions = Object.entries(searchSpace).map(
    ([name, dim]) => ({
      name,
      type: dim.type ?? "float",
      min: dim.low,
      max: dim.high,
    }),
  );

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* ---- Step indicator ---- */}
      <div className="flex items-center gap-2">
        {STEPS.map((s, i) => (
          <Fragment key={s.key}>
            {i > 0 && (
              <div
                className={cn(
                  "h-px flex-1",
                  stepIdx >= i ? "bg-emerald-500" : "bg-border",
                )}
              />
            )}
            <div
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
                step === s.key
                  ? "bg-primary/10 text-primary"
                  : stepIdx > i
                    ? "text-emerald-400"
                    : "text-muted-foreground",
              )}
            >
              <s.icon className="h-3.5 w-3.5" />
              {s.label}
            </div>
          </Fragment>
        ))}
      </div>

      {/* ---- Step 1: Select Model ---- */}
      {step === "select-model" && (
        <ModelCatalogPicker
          selectedModelId={selectedModelId}
          onSelectModel={handleSelectModel}
        />
      )}

      {/* ---- Step 2: Configure ---- */}
      {step === "configure" && selectedModel && (
        <div className="flex flex-col gap-6">
          {/* Selected model header */}
          <Card className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Badge variant="outline">{selectedModel.category}</Badge>
              <span className="font-semibold">{selectedModel.name}</span>
              {selectedModel.family && (
                <Badge variant="secondary" className="text-xs">
                  {selectedModel.family}
                </Badge>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setStep("select-model")}
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Change
            </Button>
          </Card>

          {/* Mode selector */}
          <TrainingModeSelector mode={mode} onModeChange={setMode} />

          {/* Configuration panels based on mode */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {(mode === "manual" || mode === "hpo") && (
              <HyperparameterForm
                hyperparameters={selectedModel.defaultHyperparameters}
                values={hyperparamValues}
                onChange={handleHyperparamChange}
                onReset={handleResetHyperparams}
                showSearchSpace={mode === "hpo"}
              />
            )}

            {mode === "hpo" && (
              <HPOConfigPanel
                optimizerType={optimizerType}
                onOptimizerTypeChange={setOptimizerType}
                optimizerConfig={optimizerConfig}
                onOptimizerConfigChange={setOptimizerConfig}
                searchSpace={searchSpace}
                onSearchSpaceChange={setSearchSpace}
                hyperparameters={selectedModel.defaultHyperparameters}
              />
            )}
          </div>

          {/* Symbol / timeframe + Start button */}
          <Card className="p-4 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <Badge variant="outline">{symbol}</Badge>
                <Badge variant="outline">
                  {minutesToLabel(timeframeMinutes)}
                </Badge>
              </div>
              <Button
                onClick={handleStart}
                disabled={isStarting}
                className="gap-2"
              >
                {isStarting ? (
                  <>
                    <Activity className="h-4 w-4 animate-spin" />
                    Starting…
                  </>
                ) : (
                  <>
                  <Play className="h-4 w-4" />
                  {mode === "manual"
                    ? "Start Training"
                    : "Start Optimization"}
                </>
              )}
            </Button>
            </div>
            {startError && (
              <p className="text-sm text-destructive">{startError}</p>
            )}
          </Card>
        </div>
      )}

      {/* ---- Step 3: Running ---- */}
      {step === "running" && sessionId && (
        <HPODashboard
          sessionId={sessionId}
          onClose={handleHPOClose}
          onApplyParams={handleApplyBestParams}
        />
      )}

      {/* ---- Step 4: Results ---- */}
      {step === "results" && (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <HPOConvergence
              trials={trialDataForConvergence}
              direction={(optimizerConfig.direction as "minimize" | "maximize") ?? "minimize"}
              optimizerType={sessionData?.optimizerType}
            />
            <TrialComparison
              trials={trialDataForComparison}
              direction={(optimizerConfig.direction as "minimize" | "maximize") ?? "minimize"}
              searchDimensions={searchDimensions}
              onApplyParams={handleApplyBestParams}
            />
          </div>

          <div className="flex items-center justify-center gap-4">
            <Button
              variant="outline"
              onClick={handleReset}
              className="gap-2"
            >
              <RotateCcw className="h-4 w-4" />
              New Optimization
            </Button>
            {sessionData?.bestParams && (
              <Button
                onClick={() =>
                  handleApplyBestParams(sessionData.bestParams!)
                }
                className="gap-2"
              >
                <Sparkles className="h-4 w-4" />
                Apply Best &amp; Train
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

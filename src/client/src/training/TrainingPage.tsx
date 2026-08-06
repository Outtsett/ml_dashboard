/**
 * Training — Phase-aware adaptive command center.
 *
 * Layout adapts to training state:
 *   LIVE (isTraining):
 *     ConfigStrip → LiveTrainingView (split: metrics + log + awaiting pills)
 *   POST (diagnostics available):
 *     ConfigStrip → GroupTabs → MetricGrid (filtered to active group)
 *   IDLE (no data):
 *     ConfigStrip → ModelBrowser
 *
 * Fully model-agnostic: tabs and metrics auto-generate from
 * metric_declarations / SelfDescribingDiagnostics. No hardcoded per-model UI.
 */

import { useState, useEffect, lazy, Suspense } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useTrainingControl, useTrainingLive } from "@/training/lib/TrainingContext";
import { useQuery } from "@tanstack/react-query";
import ConfigStrip from "@/training/ConfigStrip";
import { MetricGrid, METRIC_GROUP_ORDER } from "@/ml/components/MetricGrid";
import { GroupTabs } from "@/training/GroupTabs";
import { LiveTrainingView } from "@/training/LiveTrainingView";
import { ModelBrowser } from "@/training/ModelBrowser";
import { TooltipProvider } from "@/shared/ui/tooltip";
import { QUERY_KEYS } from "@/shared/utils/types";
import type { SelfDescribingDiagnostics } from "@/ml/lib/diagnostics-schema";

const TrainingLogTab = lazy(() =>
  import("@/system/components/TrainingLogTab").then(m => ({ default: m.TrainingLogTab }))
);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns true if the object looks like SelfDescribingDiagnostics. */
function isSelfDescribing(d: unknown): d is SelfDescribingDiagnostics {
  if (!d || typeof d !== "object") return false;
  const obj = d as Record<string, unknown>;
  if (!obj.metrics || typeof obj.metrics !== "object") return false;
  const metrics = obj.metrics as Record<string, unknown>;
  const firstKey = Object.keys(metrics)[0];
  if (!firstKey) return false;
  const first = metrics[firstKey] as Record<string, unknown>;
  return typeof first.renderer === "string" && typeof first.mission === "string";
}

/** Extract the first group name from diagnostics for default tab selection. */
function getFirstGroup(diag: SelfDescribingDiagnostics): string {
  const groups = new Set<string>();
  for (const m of Object.values(diag.metrics)) {
    groups.add(m.group ?? "general");
  }
  // Use GROUP_ORDER priority
  return Array.from(groups).sort((a, b) =>
    (METRIC_GROUP_ORDER[a] ?? 50) - (METRIC_GROUP_ORDER[b] ?? 50)
  )[0] ?? "general";
}

// ─── Training ─────────────────────────────────────────────────────────────────

export interface TrainingProps {
  /**
   * When true (set by ML Studio's TrainStage), suppress the internal
   * <ConfigStrip>. Stage 4 already mounts <ModelCatalogPicker> +
   * <ArchitectureComposer> + <WalkForwardPanel> so duplicating ConfigStrip
   * would split the source of truth for the model/HP/symbol/timeframe form.
   *
   * Standalone `/training` route does not set this prop, preserving the
   * legacy full-UX shell.
   */
  embedded?: boolean;
}

export default function Training({ embedded = false }: TrainingProps = {}) {
  const {
    isTraining,
    isPending,
    progress,
    error,
    sseError,
    startTraining,
    stopTraining,
    availableModels,
    selectedModelType,
    setSelectedModelType,
    completedModelId,
  } = useTrainingControl();

  const { diagnostics, elapsedSec, logs } = useTrainingLive();

  // ── Local state ─────────────────────────────────────────────────────────────
  const [symbol, setSymbol] = useState("MNQ");
  const [timeframe, setTimeframe] = useState("1m");
  const [hyperparameters, setHyperparameters] = useState<Record<string, number | string | boolean>>({});
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [modelBrowserOpen, setModelBrowserOpen] = useState(false);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);

  // ── Sync hyperparameters from model defaults when model type changes ─────────
  useEffect(() => {
    const modelDef = availableModels[selectedModelType];
    if (!modelDef) return;
    const defaults: Record<string, number | string | boolean> = {};
    for (const [key, def] of Object.entries(modelDef.defaultHyperparameters)) {
      defaults[key] = def.default;
    }
    setHyperparameters(defaults);
  }, [selectedModelType, availableModels]);

  // ── Fetch trained models ─────────────────────────────────────────────────────
  const { data: trainedModels } = useQuery<any[]>({
    queryKey: QUERY_KEYS.regimeModels,
    queryFn: async () => {
      const res = await fetch("/api/training/models");
      if (!res.ok) return [];
      const d = await res.json();
      return d?.models ?? d ?? [];
    },
    staleTime: 30_000,
  });

  const trainedModelCount = trainedModels?.length ?? 0;

  // ── Active model ID ─────────────────────────────────────────────────────────
  const activeModelId = completedModelId ?? selectedModelId;

  // ── Fetch saved diagnostics for selected model ───────────────────────────────
  const { data: savedDiagnostics } = useQuery<unknown>({
    queryKey: QUERY_KEYS.regimeDiagnostics(activeModelId!),
    queryFn: async () => {
      const res = await fetch(`/api/training/models/${activeModelId}/diagnostics`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!activeModelId,
    staleTime: 60_000,
  });

  // ── Diagnostics: real data only (live SSE or saved model) ──────────────────
  const activeDiagnostics: SelfDescribingDiagnostics | null = (() => {
    if (isSelfDescribing(diagnostics)) return diagnostics;
    if (isSelfDescribing(savedDiagnostics)) return savedDiagnostics;
    return null;
  })();

  // ── Auto-set active group when diagnostics change ─────────────────────────
  useEffect(() => {
    if (activeDiagnostics && !isTraining) {
      setActiveGroup(prev => {
        // Keep current group if it exists in the new diagnostics
        if (prev) {
          const groups = new Set(
            Object.values(activeDiagnostics.metrics).map(m => m.group ?? 'general')
          );
          if (groups.has(prev)) return prev;
        }
        return getFirstGroup(activeDiagnostics);
      });
    }
  }, [activeDiagnostics, isTraining]);

  // ── Phase detection ─────────────────────────────────────────────────────────
  const phase: 'live' | 'post' | 'idle' = isTraining
    ? 'live'
    : activeDiagnostics
      ? 'post'
      : 'idle';

  // ── Hyperparameter callbacks ─────────────────────────────────────────────────
  function handleHyperparameterChange(key: string, value: number | string | boolean) {
    setHyperparameters((prev) => ({ ...prev, [key]: value }));
  }

  function handleResetHyperparameters() {
    const modelDef = availableModels[selectedModelType];
    if (!modelDef) return;
    const defaults: Record<string, number | string | boolean> = {};
    for (const [key, def] of Object.entries(modelDef.defaultHyperparameters)) {
      defaults[key] = def.default;
    }
    setHyperparameters(defaults);
  }

  // ── Start callback ───────────────────────────────────────────────────────────
  function handleStart() {
    startTraining({ modelType: selectedModelType, symbol, timeframe, hyperparameters });
  }

  // ── Model selection from browser ─────────────────────────────────────────────
  function handleSelectModel(modelId: string) {
    setSelectedModelId(modelId);
  }

  // ─── Render ───────────────────────────────────────────────────────────────────
  return (
    <TooltipProvider>
      <div className="flex flex-col">
        {/* ── ConfigStrip (hidden when embedded inside ML Studio TrainStage) ── */}
        {!embedded && (
          <ConfigStrip
            selectedModelType={selectedModelType}
            availableModels={availableModels}
            onModelTypeChange={setSelectedModelType}
            symbol={symbol}
            onSymbolChange={setSymbol}
            timeframe={timeframe}
            onTimeframeChange={setTimeframe}
            hyperparameters={hyperparameters}
            onHyperparameterChange={handleHyperparameterChange}
            onResetHyperparameters={handleResetHyperparameters}
            isTraining={isTraining}
            isPending={isPending}
            progress={progress}
            elapsedSec={elapsedSec}
            onStart={handleStart}
            onStop={stopTraining}
          />
        )}

        {/* ── Error banner ────────────────────────────────────────────────────── */}
        {error && (
          <div className="mx-6 mt-4 px-4 py-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm">
            {error}
          </div>
        )}

        {/* ── SSE connection error banner ──────────────────────────────────────── */}
        {sseError && (
          <div className="mx-6 mt-4 px-4 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm">
            SSE: {sseError}
          </div>
        )}

        {/* ── LIVE PHASE: Split view with streaming metrics ──────────────────── */}
        {phase === 'live' && (
          <div className="px-6 py-4">
            <LiveTrainingView />
          </div>
        )}

        {/* ── POST PHASE: Group tabs + filtered MetricGrid ───────────────────── */}
        {phase === 'post' && activeDiagnostics && (
          <>
            <GroupTabs
              metrics={activeDiagnostics.metrics}
              activeGroup={activeGroup ?? getFirstGroup(activeDiagnostics)}
              onGroupChange={setActiveGroup}
            />
            <div className="px-6 py-6">
              <MetricGrid
                diagnostics={activeDiagnostics}
                filter={activeGroup ? [activeGroup] : undefined}
              />
            </div>
          </>
        )}

        {/* ── IDLE PHASE: Show log if available from recent training ──────────── */}
        {phase === 'idle' && (logs.length > 0 || error) && (
          <div className="mx-6 mt-4 h-64 rounded-lg overflow-hidden border border-white/5">
            <Suspense fallback={<div className="h-full bg-black/40 animate-pulse" />}>
              <TrainingLogTab visible />
            </Suspense>
          </div>
        )}

        {/* ── ModelBrowser (collapsible) ──────────────────────────────────────── */}
        <div className="border-t border-white/5">
          <button
            onClick={() => setModelBrowserOpen((v) => !v)}
            className="flex items-center justify-between w-full px-6 py-3 text-left hover:bg-white/[0.03] transition-colors"
          >
            <span className="text-xs font-medium text-muted-foreground/60 uppercase tracking-widest">
              Trained Models ({trainedModelCount})
            </span>
            {modelBrowserOpen ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground/40" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground/40" />
            )}
          </button>

          {modelBrowserOpen && (
            <div className="px-6 pb-6">
              <ModelBrowser onSelectModel={handleSelectModel} />
            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}

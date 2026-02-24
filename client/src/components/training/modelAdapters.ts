/**
 * Model Adapters — per-model rendering metadata for Training UI.
 *
 * Each adapter defines labels, pipeline steps, and hero card configs
 * so Training.tsx, DataPipelineFlow, and HeroStrip can render
 * model-appropriate UI without hardcoding model names.
 */

import type { LucideIcon } from "lucide-react";
import { Database, Sigma, Scissors, Flame, Layers, Brain, Target } from "lucide-react";

// ── Types ──

export interface PipelineStep {
  icon: LucideIcon;
  label: string;
  /** Key used to resolve dynamic value at render time */
  valueKey: string;
  detailKey: string;
  borderColor: string;
  textColor: string;
}

export interface HeroCardDef {
  key: string;
  label: string;
  color: string;         // tailwind text color class
  format: "percent" | "number" | "float";
}

export interface ModelAdapter {
  name: string;
  activeLabel: string;
  idleLabel: string;
  pipelineDescription: string;
  pipelineSteps: PipelineStep[];
  heroCards: HeroCardDef[];
}

// ── HDP-HMM Pipeline Steps ──

const hdpHmmSteps: PipelineStep[] = [
  { icon: Database, label: "Source", valueKey: "source", detailKey: "sourceDetail", borderColor: "border-cyan-500/30", textColor: "text-cyan-400" },
  { icon: Sigma, label: "Features", valueKey: "features", detailKey: "featuresDetail", borderColor: "border-violet-500/30", textColor: "text-violet-400" },
  { icon: Scissors, label: "Split", valueKey: "split", detailKey: "splitDetail", borderColor: "border-emerald-500/30", textColor: "text-emerald-400" },
  { icon: Flame, label: "Gibbs", valueKey: "engine", detailKey: "engineDetail", borderColor: "border-orange-500/30", textColor: "text-orange-400" },
  { icon: Layers, label: "Regimes", valueKey: "output", detailKey: "outputDetail", borderColor: "border-rose-500/30", textColor: "text-rose-400" },
];

// ── CNN Pipeline Steps ──

const cnnSteps: PipelineStep[] = [
  { icon: Database, label: "Source", valueKey: "source", detailKey: "sourceDetail", borderColor: "border-cyan-500/30", textColor: "text-cyan-400" },
  { icon: Sigma, label: "Features", valueKey: "features", detailKey: "featuresDetail", borderColor: "border-violet-500/30", textColor: "text-violet-400" },
  { icon: Scissors, label: "Split", valueKey: "split", detailKey: "splitDetail", borderColor: "border-emerald-500/30", textColor: "text-emerald-400" },
  { icon: Brain, label: "CNN", valueKey: "engine", detailKey: "engineDetail", borderColor: "border-orange-500/30", textColor: "text-orange-400" },
  { icon: Target, label: "Predictions", valueKey: "output", detailKey: "outputDetail", borderColor: "border-rose-500/30", textColor: "text-rose-400" },
];

// ── Adapter Registry ──

export const MODEL_ADAPTERS: Record<string, ModelAdapter> = {
  "hdp-hmm": {
    name: "HDP-HMM",
    activeLabel: "HDP-HMM Gibbs Sampler Active",
    idleLabel: "HDP-HMM Idle",
    pipelineDescription: "OHLCV bars \u2192 regime features \u2192 Gibbs sampler \u2192 discovered moods",
    pipelineSteps: hdpHmmSteps,
    heroCards: [
      { key: "regimes", label: "Regimes", color: "text-orange-400", format: "number" },
      { key: "stability", label: "Walk-Forward", color: "text-emerald-400", format: "percent" },
      { key: "quality", label: "Quality", color: "text-amber-400", format: "number" },
      { key: "oos", label: "OOS Match", color: "text-cyan-400", format: "percent" },
      { key: "ll", label: "Model Fit", color: "text-violet-400", format: "float" },
    ],
  },
  "cnn-universal": {
    name: "CNN Universal",
    activeLabel: "CNN Training Active",
    idleLabel: "CNN Idle",
    pipelineDescription: "OHLCV bars \u2192 30 universal features \u2192 CNN-1D \u2192 direction predictions",
    pipelineSteps: cnnSteps,
    heroCards: [
      { key: "valAccuracy", label: "Val Accuracy", color: "text-emerald-400", format: "percent" },
      { key: "valLoss", label: "Val Loss", color: "text-rose-400", format: "float" },
      { key: "quality", label: "Quality", color: "text-amber-400", format: "number" },
      { key: "bestEpoch", label: "Best Epoch", color: "text-cyan-400", format: "number" },
      { key: "accuracy", label: "Train Acc", color: "text-violet-400", format: "percent" },
    ],
  },
};

export function getAdapter(modelType: string): ModelAdapter {
  return MODEL_ADAPTERS[modelType] ?? MODEL_ADAPTERS["hdp-hmm"]!;
}

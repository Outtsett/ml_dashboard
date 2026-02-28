/**
 * Model Adapters — per-model rendering metadata for Training UI.
 *
 * Each adapter defines labels and pipeline steps so Training.tsx
 * and DataPipelineFlow can render model-appropriate UI without
 * hardcoding model names.
 *
 * To add a new model: add one entry to MODEL_ADAPTERS. No other files change (OCP).
 */

import type { LucideIcon } from "lucide-react";

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

export interface ModelAdapter {
  name: string;
  activeLabel: string;
  idleLabel: string;
  pipelineDescription: string;
  /** Label for the training algorithm step (e.g. "Gibbs", "EM Training") */
  trainingStepLabel: string;
  /** Label for the output step (e.g. "Regimes", "Bull/Bear") */
  outputStepLabel: string;
  /** Default output description before training (e.g. "auto-K", "K=2") */
  outputDefault: string;
  /** Output detail when training complete (e.g. "discovered", "classified") */
  outputComplete: string;
  /** Training phases that correspond to the main sampling/training loop */
  activePhases: string[];
  pipelineSteps: PipelineStep[];
}

// ── Adapter Registry ──

export const MODEL_ADAPTERS: Record<string, ModelAdapter> = {
  "hdp-hmm": {
    name: "HDP-HMM",
    activeLabel: "HDP-HMM Sampling",
    idleLabel: "Ready to Train",
    pipelineDescription: "a Bayesian sampler that discovers market regimes automatically",
    trainingStepLabel: "Gibbs",
    outputStepLabel: "Regimes",
    outputDefault: "auto-K",
    outputComplete: "discovered",
    activePhases: ["gibbs_sampling"],
    pipelineSteps: [],
  },
  "2-state-hmm": {
    name: "2-State HMM",
    activeLabel: "Baum-Welch EM Training",
    idleLabel: "Ready to Train",
    pipelineDescription: "a classic HMM that classifies bars into bullish and bearish regimes",
    trainingStepLabel: "EM Training",
    outputStepLabel: "Bull/Bear",
    outputDefault: "K=2",
    outputComplete: "classified",
    activePhases: ["em_training"],
    pipelineSteps: [],
  },
};

const FALLBACK_ADAPTER: ModelAdapter = {
  name: "Unknown",
  activeLabel: "Training Active",
  idleLabel: "Idle",
  pipelineDescription: "a model learning patterns from market data",
  trainingStepLabel: "Training",
  outputStepLabel: "Output",
  outputDefault: "pending",
  outputComplete: "complete",
  activePhases: ["training"],
  pipelineSteps: [],
};

export function getAdapter(modelType: string): ModelAdapter {
  return MODEL_ADAPTERS[modelType] ?? FALLBACK_ADAPTER;
}

/**
 * Model Adapters — per-model rendering metadata for Training UI.
 *
 * Each adapter defines labels, pipeline steps, and hero card configs
 * so Training.tsx, DataPipelineFlow, and HeroStrip can render
 * model-appropriate UI without hardcoding model names.
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

// ── Adapter Registry ──

export const MODEL_ADAPTERS: Record<string, ModelAdapter> = {
  "hdp-hmm": {
    name: "HDP-HMM",
    activeLabel: "HDP-HMM Sampling",
    idleLabel: "Ready to Train",
    pipelineDescription: "a Bayesian sampler that discovers market regimes automatically",
    pipelineSteps: [],
    heroCards: [],
  },
};

const FALLBACK_ADAPTER: ModelAdapter = {
  name: "Unknown",
  activeLabel: "Training Active",
  idleLabel: "Idle",
  pipelineDescription: "",
  pipelineSteps: [],
  heroCards: [],
};

export function getAdapter(modelType: string): ModelAdapter {
  return MODEL_ADAPTERS[modelType] ?? FALLBACK_ADAPTER;
}

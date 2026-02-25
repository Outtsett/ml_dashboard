/**
 * RegimeAnalytics — Shared types, interfaces, constants, and helpers.
 */

import type { ReactNode } from "react";
import { TrendingUp, TrendingDown, Activity, Zap, Minus } from "lucide-react";
import { createElement } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RegimeModel {
  id: string;
  symbol: string;
  timeframe: string;
  n_regimes: number;
  n_bars: number;
  n_bars_total?: number;
  n_bars_train_val?: number;
  n_bars_test?: number;
  quality_score?: number;
  date_range: { start: string; end: string; train_end?: string; test_start?: string };
  training_config?: {
    gibbs_iter: number;
    burn_in: number;
    test_split: number;
    walk_forward_windows: number;
    alpha: number;
    gamma: number;
    kappa: number;
  };
  training_time_sec: number;
  trained_at: string;
}

export interface RegimeStat {
  regime_id: number;
  count: number;
  pct: number;
  avg_return: number;
  avg_return_pct?: number;
  avg_volatility: number;
  avg_range: number;
  avg_atr_ratio: number;
  avg_vol_ratio_5_20: number;
  avg_duration: number;
  max_duration: number;
  median_duration: number;
  label: string;
  nickname?: string;
  volatility_state?: string;
  bar_character?: string;
  characteristics: Record<string, number>;
}

export interface Transition {
  from: number;
  to: number;
  probability: number;
}

export interface ModelSelection {
  n_components: number;
  bic: number;
  aic: number;
  log_likelihood: number;
  converged: boolean;
  n_iterations?: number;
}

export interface FoldResult {
  fold: number;
  train_size: number;
  val_size: number;
  train_ll: number | null;
  val_ll: number | null;
  train_ll_per_sample: number | null;
  val_ll_per_sample: number | null;
  converged: boolean;
  failed: boolean;
}

export interface CVResult {
  n_components: number;
  fold_results: FoldResult[];
  mean_train_ll_per_sample: number | null;
  mean_val_ll_per_sample: number | null;
  std_val_ll_per_sample: number | null;
  gap: number | null;
  all_failed: boolean;
}

export interface WalkForwardWindow {
  window: number;
  start_idx: number;
  end_idx: number;
  train_size: number;
  test_size: number;
  train_ll_per_sample?: number;
  test_ll_per_sample?: number;
  regime_distribution?: number[];
  switch_rate?: number;
  avg_confidence?: number;
  failed: boolean;
}

export interface WalkForwardResult {
  n_components: number;
  n_windows: number;
  window_results: WalkForwardWindow[];
  stability_score: number;
  avg_oos_confidence: number;
  avg_switch_rate: number;
}

export interface OOSResult {
  distribution_similarity: number;
  train_distribution: number[];
  test_distribution: number[];
  profile_consistency: Array<{
    regime: number;
    correlation: number | null;
    train_count?: number;
    test_count?: number;
    insufficient_data: boolean;
  }>;
  avg_profile_correlation: number;
  avg_test_confidence: number;
  train_switch_rate: number;
  test_switch_rate: number;
  switch_rate_ratio: number;
}

export interface Diagnostics {
  symbol: string;
  timeframe: string;
  n_regimes: number;
  n_bars_total?: number;
  n_bars_train_val?: number;
  n_bars_test?: number;
  n_bars?: number;
  n_features: number;
  feature_names: string[];
  date_range: { start: string; end: string; train_end?: string; test_start?: string };
  quality_score?: number;
  model_selection?: ModelSelection[];
  bic_best_k?: number;
  cv_best_k?: number;
  cross_validation?: Record<string, CVResult>;
  walk_forward?: WalkForwardResult;
  out_of_sample?: OOSResult;
  convergence_summary?: {
    converged?: boolean;
    n_iterations: number;
    final_log_likelihood: number;
    final_active_states?: number;
  };
  n_regimes_discovered?: number;
  gibbs_iterations?: number;
  burn_in?: number;
  hyperparams?: {
    alpha: number;
    gamma: number;
    kappa: number;
  };
  regime_stats: RegimeStat[];
  transitions: Transition[];
  transition_matrix: number[][];
  training_config?: {
    gibbs_iter: number;
    burn_in: number;
    test_split: number;
    walk_forward_windows: number;
    alpha: number;
    gamma: number;
    kappa: number;
  };
  training_time_sec: number;
  trained_at: string;
}

export interface TrainingProgress {
  step: number;
  totalSteps: number;
  phase: string;
  message: string;
  pct: number;
}

// ─── Regime color palette ────────────────────────────────────────────────────

export const REGIME_COLORS = [
  { bg: "bg-rose-500/20", text: "text-rose-400", border: "border-rose-500/30", fill: "#f43f5e", hex: "#f43f5e" },
  { bg: "bg-orange-500/20", text: "text-orange-400", border: "border-orange-500/30", fill: "#f97316", hex: "#f97316" },
  { bg: "bg-amber-500/20", text: "text-amber-400", border: "border-amber-500/30", fill: "#f59e0b", hex: "#f59e0b" },
  { bg: "bg-emerald-500/20", text: "text-emerald-400", border: "border-emerald-500/30", fill: "#10b981", hex: "#10b981" },
  { bg: "bg-cyan-500/20", text: "text-cyan-400", border: "border-cyan-500/30", fill: "#06b6d4", hex: "#06b6d4" },
  { bg: "bg-blue-500/20", text: "text-blue-400", border: "border-blue-500/30", fill: "#3b82f6", hex: "#3b82f6" },
  { bg: "bg-violet-500/20", text: "text-violet-400", border: "border-violet-500/30", fill: "#8b5cf6", hex: "#8b5cf6" },
  { bg: "bg-pink-500/20", text: "text-pink-400", border: "border-pink-500/30", fill: "#ec4899", hex: "#ec4899" },
];

export function getRegimeColor(idx: number) {
  return REGIME_COLORS[idx % REGIME_COLORS.length]!;
}

export function getRegimeIcon(label: string): ReactNode {
  if (label.includes("up")) return createElement(TrendingUp, { className: "h-3 w-3" });
  if (label.includes("down")) return createElement(TrendingDown, { className: "h-3 w-3" });
  if (label.includes("volatile") || label.includes("choppy")) return createElement(Zap, { className: "h-3 w-3" });
  if (label.includes("quiet")) return createElement(Minus, { className: "h-3 w-3" });
  return createElement(Activity, { className: "h-3 w-3" });
}

export function getQualityColor(score: number): string {
  if (score >= 80) return "text-emerald-400";
  if (score >= 60) return "text-amber-400";
  if (score >= 40) return "text-orange-400";
  return "text-rose-400";
}

export function getQualityLabel(score: number): string {
  if (score >= 80) return "Excellent";
  if (score >= 60) return "Good";
  if (score >= 40) return "Fair";
  return "Weak";
}

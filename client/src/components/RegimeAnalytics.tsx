/**
 * RegimeAnalytics — Visual training analytics for HDP-HMM regime detection.
 *
 * Think of it as: a control panel for a "market mood ring" detector. You pick
 * a symbol, hit Train, and watch it discover distinct market personalities
 * (trending, choppy, volatile, quiet). Then you see the results as color-coded
 * bars, probability ribbons, and a transition map showing how the market
 * switches between moods.
 *
 * Visual sections:
 *   1. Train controls (symbol/timeframe/params + advanced: folds, test split)
 *   2. Quality Score badge (0-100 composite)
 *   3. BIC model selection chart (how it picked # of regimes)
 *   4. Cross-validation fold results table (train/val LL per fold)
 *   5. Walk-forward stability (window-by-window regime consistency)
 *   6. Out-of-sample assessment (distribution similarity, confidence)
 *   7. EM Convergence curves (log-likelihood per iteration)
 *   8. Regime stats table (bars, %, return, volatility, duration — color-coded)
 *   9. Transition matrix heatmap (which regime follows which)
 *  10. Regime timeline (color bars showing regime over time)
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Play, Square, Loader2, Layers, ChevronDown, ChevronRight,
  Trash2, Check, TrendingUp, TrendingDown, Activity, Zap, Minus,
  Settings2, BarChart3, Shield, Target,
} from "lucide-react";
import { QUERY_KEYS } from "@/lib/types";
import { useDashboard } from "@/contexts/UnifiedDashboardContext";

// ─── Types ───────────────────────────────────────────────────────────────────

interface RegimeModel {
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
    n_folds: number;
    n_restarts: number;
    max_iter: number;
    test_split: number;
    walk_forward_windows: number;
  };
  training_time_sec: number;
  trained_at: string;
}

interface RegimeStat {
  regime_id: number;
  count: number;
  pct: number;
  avg_return: number;
  avg_volatility: number;
  avg_range: number;
  avg_atr_ratio: number;
  avg_vol_ratio_5_20: number;
  avg_duration: number;
  max_duration: number;
  median_duration: number;
  label: string;
  characteristics: Record<string, number>;
}

interface Transition {
  from: number;
  to: number;
  probability: number;
}

interface ModelSelection {
  n_components: number;
  bic: number;
  aic: number;
  log_likelihood: number;
  converged: boolean;
  n_iterations?: number;
}

interface FoldResult {
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

interface CVResult {
  n_components: number;
  fold_results: FoldResult[];
  mean_train_ll_per_sample: number | null;
  mean_val_ll_per_sample: number | null;
  std_val_ll_per_sample: number | null;
  gap: number | null;
  all_failed: boolean;
}

interface WalkForwardWindow {
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

interface WalkForwardResult {
  n_components: number;
  n_windows: number;
  window_results: WalkForwardWindow[];
  stability_score: number;
  avg_oos_confidence: number;
  avg_switch_rate: number;
}

interface OOSResult {
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

interface Diagnostics {
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
  model_selection: ModelSelection[];
  bic_best_k?: number;
  cv_best_k?: number;
  cross_validation?: Record<string, CVResult>;
  walk_forward?: WalkForwardResult;
  out_of_sample?: OOSResult;
  convergence_summary?: {
    converged: boolean;
    n_iterations: number;
    final_log_likelihood: number;
  };
  regime_stats: RegimeStat[];
  transitions: Transition[];
  transition_matrix: number[][];
  training_config?: {
    min_regimes: number;
    max_regimes: number;
    n_folds: number;
    n_restarts: number;
    max_iter: number;
    test_split: number;
    walk_forward_windows: number;
  };
  training_time_sec: number;
  trained_at: string;
}

interface TrainingProgress {
  step: number;
  totalSteps: number;
  phase: string;
  message: string;
  pct: number;
}

// ─── Regime color palette ────────────────────────────────────────────────────

const REGIME_COLORS = [
  { bg: "bg-rose-500/20", text: "text-rose-400", border: "border-rose-500/30", fill: "#f43f5e", hex: "#f43f5e" },
  { bg: "bg-orange-500/20", text: "text-orange-400", border: "border-orange-500/30", fill: "#f97316", hex: "#f97316" },
  { bg: "bg-amber-500/20", text: "text-amber-400", border: "border-amber-500/30", fill: "#f59e0b", hex: "#f59e0b" },
  { bg: "bg-emerald-500/20", text: "text-emerald-400", border: "border-emerald-500/30", fill: "#10b981", hex: "#10b981" },
  { bg: "bg-cyan-500/20", text: "text-cyan-400", border: "border-cyan-500/30", fill: "#06b6d4", hex: "#06b6d4" },
  { bg: "bg-blue-500/20", text: "text-blue-400", border: "border-blue-500/30", fill: "#3b82f6", hex: "#3b82f6" },
  { bg: "bg-violet-500/20", text: "text-violet-400", border: "border-violet-500/30", fill: "#8b5cf6", hex: "#8b5cf6" },
  { bg: "bg-pink-500/20", text: "text-pink-400", border: "border-pink-500/30", fill: "#ec4899", hex: "#ec4899" },
];

function getRegimeColor(idx: number) {
  return REGIME_COLORS[idx % REGIME_COLORS.length];
}

function getRegimeIcon(label: string) {
  if (label.includes("up")) return <TrendingUp className="h-3 w-3" />;
  if (label.includes("down")) return <TrendingDown className="h-3 w-3" />;
  if (label.includes("volatile") || label.includes("choppy")) return <Zap className="h-3 w-3" />;
  if (label.includes("quiet")) return <Minus className="h-3 w-3" />;
  return <Activity className="h-3 w-3" />;
}

function getQualityColor(score: number): string {
  if (score >= 80) return "text-emerald-400";
  if (score >= 60) return "text-amber-400";
  if (score >= 40) return "text-orange-400";
  return "text-rose-400";
}

function getQualityLabel(score: number): string {
  if (score >= 80) return "Excellent";
  if (score >= 60) return "Good";
  if (score >= 40) return "Fair";
  return "Weak";
}

// ─── Quality Score Ring ──────────────────────────────────────────────────────

function QualityScoreRing({ score }: { score: number }) {
  const r = 18;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 80 ? "#10b981" : score >= 60 ? "#f59e0b" : score >= 40 ? "#f97316" : "#f43f5e";

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={48} height={48} viewBox="0 0 48 48">
        <circle cx={24} cy={24} r={r} fill="none" stroke="white" strokeOpacity={0.05} strokeWidth={3} />
        <circle
          cx={24} cy={24} r={r}
          fill="none" stroke={color} strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform="rotate(-90 24 24)"
        />
        <text x={24} y={24} textAnchor="middle" dominantBaseline="central"
          fill={color} fontSize={11} fontWeight="bold" fontFamily="monospace">
          {Math.round(score)}
        </text>
      </svg>
    </div>
  );
}

// ─── Mini BIC Chart (SVG) ────────────────────────────────────────────────────

function BICChart({ data, bestN, bicBestK, cvBestK }: {
  data: ModelSelection[];
  bestN: number;
  bicBestK?: number;
  cvBestK?: number;
}) {
  if (!data || data.length === 0) return null;

  const w = 240, h = 70, pad = { t: 8, r: 12, b: 18, l: 38 };
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;

  const bics = data.map(d => d.bic);
  const minBIC = Math.min(...bics);
  const maxBIC = Math.max(...bics);
  const range = maxBIC - minBIC || 1;

  const points = data.map((d, i) => ({
    x: pad.l + (i / Math.max(data.length - 1, 1)) * iw,
    y: pad.t + ((d.bic - minBIC) / range) * ih,
    n: d.n_components,
    bic: d.bic,
    isBest: d.n_components === bestN,
    isBicBest: d.n_components === bicBestK,
    isCvBest: d.n_components === cvBestK,
  }));

  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-[70px]">
      {/* Grid lines */}
      {[0, 0.5, 1].map(f => (
        <line key={f} x1={pad.l} y1={pad.t + f * ih} x2={pad.l + iw} y2={pad.t + f * ih}
          stroke="white" strokeOpacity={0.05} />
      ))}

      {/* BIC line */}
      <path d={pathD} fill="none" stroke="#06b6d4" strokeWidth={1.5} />

      {/* Points */}
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={p.isBest ? 4 : 2.5}
            fill={p.isBest ? "#10b981" : p.isBicBest ? "#f59e0b" : "#06b6d4"}
            stroke={p.isBest ? "#10b981" : "none"}
            strokeWidth={p.isBest ? 1 : 0}
            opacity={p.isBest ? 1 : 0.7}
          />
          {/* N label */}
          <text x={p.x} y={h - 3} textAnchor="middle" fill="white" fillOpacity={0.4} fontSize={8}>
            {p.n}
          </text>
        </g>
      ))}

      {/* Best label */}
      {points.filter(p => p.isBest).map(p => (
        <text key="best" x={p.x} y={p.y - 7} textAnchor="middle" fill="#10b981" fontSize={7} fontWeight="bold">
          Final
        </text>
      ))}
      {points.filter(p => p.isBicBest && !p.isBest).map(p => (
        <text key="bic" x={p.x} y={p.y - 7} textAnchor="middle" fill="#f59e0b" fontSize={6}>
          BIC
        </text>
      ))}

      {/* Y-axis labels */}
      <text x={pad.l - 3} y={pad.t + 4} textAnchor="end" fill="white" fillOpacity={0.3} fontSize={7}>
        {(maxBIC / 1000).toFixed(0)}k
      </text>
      <text x={pad.l - 3} y={pad.t + ih + 3} textAnchor="end" fill="white" fillOpacity={0.3} fontSize={7}>
        {(minBIC / 1000).toFixed(0)}k
      </text>

      <text x={pad.l + iw / 2} y={h - 0} textAnchor="middle" fill="white" fillOpacity={0.25} fontSize={7}>
        # Regimes
      </text>
    </svg>
  );
}

// ─── Convergence Curve Chart ─────────────────────────────────────────────────

function ConvergenceCurve({ data, label }: { data: Array<{ iter: number; log_likelihood: number; delta: number }>; label: string }) {
  if (!data || data.length < 2) return null;

  const w = 240, h = 55, pad = { t: 6, r: 8, b: 14, l: 38 };
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;

  const lls = data.map(d => d.log_likelihood);
  const minLL = Math.min(...lls);
  const maxLL = Math.max(...lls);
  const range = maxLL - minLL || 1;

  const points = data.map((d, i) => ({
    x: pad.l + (i / Math.max(data.length - 1, 1)) * iw,
    y: pad.t + ih - ((d.log_likelihood - minLL) / range) * ih,
  }));

  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");

  return (
    <div className="space-y-0.5">
      <p className="text-[8px] text-muted-foreground/70 font-mono">{label} ({data.length} iters)</p>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-[55px]">
        <path d={pathD} fill="none" stroke="#8b5cf6" strokeWidth={1.2} />
        <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r={2} fill="#8b5cf6" />
        <text x={pad.l - 3} y={pad.t + 5} textAnchor="end" fill="white" fillOpacity={0.25} fontSize={6}>
          {(maxLL / 1000).toFixed(0)}k
        </text>
        <text x={pad.l - 3} y={pad.t + ih + 3} textAnchor="end" fill="white" fillOpacity={0.25} fontSize={6}>
          {(minLL / 1000).toFixed(0)}k
        </text>
        <text x={pad.l + iw / 2} y={h - 1} textAnchor="middle" fill="white" fillOpacity={0.2} fontSize={6}>
          EM Iteration
        </text>
      </svg>
    </div>
  );
}

// ─── Cross-Validation Fold Table ─────────────────────────────────────────────

function CVFoldTable({ cv }: { cv: CVResult }) {
  if (!cv || cv.all_failed) return <p className="text-[8px] text-rose-400">All CV folds failed</p>;

  return (
    <div className="space-y-1">
      <div className="grid grid-cols-4 gap-1 text-[7px] text-muted-foreground/50 font-mono px-1">
        <span>Fold</span>
        <span>Train LL/s</span>
        <span>Val LL/s</span>
        <span>Bars</span>
      </div>
      {cv.fold_results.map(f => (
        <div key={f.fold}
          className={`grid grid-cols-4 gap-1 text-[8px] font-mono px-1 py-0.5 rounded ${
            f.failed ? "text-rose-400/50" : "text-foreground/80"
          }`}
        >
          <span>F{f.fold}</span>
          <span>{f.failed ? "--" : f.train_ll_per_sample?.toFixed(3)}</span>
          <span className={!f.failed && f.val_ll_per_sample != null ? (
            f.val_ll_per_sample > (f.train_ll_per_sample ?? 0) * 0.95 ? "text-emerald-400" : "text-amber-400"
          ) : ""}>
            {f.failed ? "--" : f.val_ll_per_sample?.toFixed(3)}
          </span>
          <span className="text-muted-foreground/60">
            {f.failed ? "--" : `${(f.train_size / 1000).toFixed(1)}k/${(f.val_size / 1000).toFixed(1)}k`}
          </span>
        </div>
      ))}
      {cv.gap != null && (
        <div className="flex items-center justify-between px-1 pt-1 border-t border-white/5">
          <span className="text-[8px] text-muted-foreground">Overfit Gap</span>
          <span className={`text-[9px] font-mono font-medium ${
            Math.abs(cv.gap) < 0.1 ? "text-emerald-400" : Math.abs(cv.gap) < 0.5 ? "text-amber-400" : "text-rose-400"
          }`}>
            {cv.gap.toFixed(4)}
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Walk-Forward Results ────────────────────────────────────────────────────

function WalkForwardDisplay({ wf }: { wf: WalkForwardResult }) {
  if (!wf || wf.n_windows === 0) return null;

  const stabilityColor = wf.stability_score >= 0.8 ? "#10b981" : wf.stability_score >= 0.6 ? "#f59e0b" : "#f43f5e";

  return (
    <div className="space-y-1.5">
      {/* Summary badges */}
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="outline" className="text-[7px] px-1.5 py-0 rounded-full"
          style={{ borderColor: stabilityColor, color: stabilityColor }}>
          Stability: {(wf.stability_score * 100).toFixed(0)}%
        </Badge>
        <Badge variant="outline" className="text-[7px] px-1.5 py-0 rounded-full border-white/10">
          Confidence: {(wf.avg_oos_confidence * 100).toFixed(0)}%
        </Badge>
        <Badge variant="outline" className="text-[7px] px-1.5 py-0 rounded-full border-white/10">
          Switch Rate: {(wf.avg_switch_rate * 100).toFixed(1)}%
        </Badge>
      </div>

      {/* Per-window regime distributions as stacked bars */}
      {wf.window_results.filter(w => !w.failed && w.regime_distribution).map(w => (
        <div key={w.window} className="space-y-0.5">
          <div className="flex items-center gap-1">
            <span className="text-[7px] text-muted-foreground/50 font-mono w-6">W{w.window}</span>
            <div className="flex-1 h-2.5 rounded-full overflow-hidden flex">
              {w.regime_distribution!.map((pct, ri) => (
                <div key={ri}
                  style={{
                    width: `${pct * 100}%`,
                    backgroundColor: getRegimeColor(ri).hex,
                    opacity: 0.7,
                  }}
                />
              ))}
            </div>
            <span className="text-[7px] font-mono text-muted-foreground/50 w-8 text-right">
              {w.avg_confidence ? `${(w.avg_confidence * 100).toFixed(0)}%` : ""}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Out-of-Sample Assessment ────────────────────────────────────────────────

function OOSDisplay({ oos, n_regimes }: { oos: OOSResult; n_regimes: number }) {
  return (
    <div className="space-y-1.5">
      {/* Distribution comparison: train vs test side by side */}
      <div className="space-y-1">
        <div className="flex items-center gap-1">
          <span className="text-[7px] text-muted-foreground/50 w-8">Train</span>
          <div className="flex-1 h-2.5 rounded-full overflow-hidden flex">
            {oos.train_distribution.map((pct, ri) => (
              <div key={ri}
                style={{ width: `${pct * 100}%`, backgroundColor: getRegimeColor(ri).hex, opacity: 0.7 }}
              />
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[7px] text-muted-foreground/50 w-8">Test</span>
          <div className="flex-1 h-2.5 rounded-full overflow-hidden flex">
            {oos.test_distribution.map((pct, ri) => (
              <div key={ri}
                style={{ width: `${pct * 100}%`, backgroundColor: getRegimeColor(ri).hex, opacity: 0.7 }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Metric badges */}
      <div className="grid grid-cols-2 gap-1">
        <div className="p-1.5 rounded bg-black/20 border border-white/5">
          <span className="text-[7px] text-muted-foreground block">Dist. Similarity</span>
          <span className={`text-[10px] font-mono font-medium ${
            oos.distribution_similarity >= 0.8 ? "text-emerald-400" : oos.distribution_similarity >= 0.6 ? "text-amber-400" : "text-rose-400"
          }`}>
            {(oos.distribution_similarity * 100).toFixed(0)}%
          </span>
        </div>
        <div className="p-1.5 rounded bg-black/20 border border-white/5">
          <span className="text-[7px] text-muted-foreground block">Profile Corr.</span>
          <span className={`text-[10px] font-mono font-medium ${
            oos.avg_profile_correlation >= 0.8 ? "text-emerald-400" : oos.avg_profile_correlation >= 0.5 ? "text-amber-400" : "text-rose-400"
          }`}>
            {oos.avg_profile_correlation.toFixed(3)}
          </span>
        </div>
        <div className="p-1.5 rounded bg-black/20 border border-white/5">
          <span className="text-[7px] text-muted-foreground block">Test Confidence</span>
          <span className="text-[10px] font-mono font-medium text-foreground/80">
            {(oos.avg_test_confidence * 100).toFixed(0)}%
          </span>
        </div>
        <div className="p-1.5 rounded bg-black/20 border border-white/5">
          <span className="text-[7px] text-muted-foreground block">Switch Ratio</span>
          <span className={`text-[10px] font-mono font-medium ${
            Math.abs(oos.switch_rate_ratio - 1) < 0.3 ? "text-emerald-400" : "text-amber-400"
          }`}>
            {oos.switch_rate_ratio.toFixed(2)}x
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Mini Transition Matrix ──────────────────────────────────────────────────

function TransitionMatrix({ matrix, labels }: { matrix: number[][]; labels: string[] }) {
  if (!matrix || matrix.length === 0) return null;

  const n = matrix.length;
  const cellSize = Math.min(28, Math.floor(200 / n));

  return (
    <TooltipProvider delayDuration={100}>
      <div className="flex gap-1">
        {/* Row labels */}
        <div className="flex flex-col" style={{ paddingTop: cellSize + 2 }}>
          {labels.map((l, i) => (
            <div key={i} className="flex items-center justify-end pr-1"
              style={{ height: cellSize, minWidth: 16 }}>
              <span className="text-[7px] text-muted-foreground truncate max-w-[50px]" title={l}>
                {i}
              </span>
            </div>
          ))}
        </div>

        <div>
          {/* Column labels */}
          <div className="flex" style={{ height: cellSize }}>
            {labels.map((l, j) => (
              <div key={j} className="flex items-end justify-center"
                style={{ width: cellSize }}>
                <span className="text-[7px] text-muted-foreground">{j}</span>
              </div>
            ))}
          </div>

          {/* Matrix cells */}
          {matrix.map((row, i) => (
            <div key={i} className="flex">
              {row.map((val, j) => {
                const opacity = Math.max(0.05, val);
                const isSelf = i === j;
                return (
                  <Tooltip key={j}>
                    <TooltipTrigger asChild>
                      <div
                        className="border border-white/5 rounded-sm cursor-default"
                        style={{
                          width: cellSize,
                          height: cellSize,
                          backgroundColor: isSelf
                            ? `rgba(16, 185, 129, ${opacity})`
                            : `rgba(6, 182, 212, ${opacity})`,
                        }}
                      >
                        {val > 0.15 && (
                          <span className="text-[7px] font-mono text-white/70 flex items-center justify-center h-full">
                            {(val * 100).toFixed(0)}
                          </span>
                        )}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-[10px]">
                      <span className="font-mono">{labels[i]} → {labels[j]}: {(val * 100).toFixed(1)}%</span>
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </TooltipProvider>
  );
}

// ─── Regime Timeline Strip ───────────────────────────────────────────────────

function RegimeTimeline({ assignments, n_regimes }: { assignments: Array<{ regime: number }>; n_regimes: number }) {
  if (!assignments || assignments.length === 0) return null;

  // Downsample to max ~300 segments for rendering
  const maxSegments = 300;
  const step = Math.max(1, Math.floor(assignments.length / maxSegments));
  const segments: Array<{ regime: number; count: number }> = [];

  for (let i = 0; i < assignments.length; i += step) {
    const regime = assignments[i].regime;
    if (segments.length > 0 && segments[segments.length - 1].regime === regime) {
      segments[segments.length - 1].count += 1;
    } else {
      segments.push({ regime, count: 1 });
    }
  }

  const totalCount = segments.reduce((s, seg) => s + seg.count, 0);

  return (
    <div className="w-full h-3 rounded-full overflow-hidden flex">
      {segments.map((seg, i) => (
        <div
          key={i}
          style={{
            width: `${(seg.count / totalCount) * 100}%`,
            backgroundColor: getRegimeColor(seg.regime).hex,
            opacity: 0.7,
          }}
        />
      ))}
    </div>
  );
}

// ─── Collapsible Section ─────────────────────────────────────────────────────

function Section({ title, icon, children, defaultOpen = false }: {
  title: string; icon: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="space-y-1">
      <button
        className="flex items-center gap-1.5 text-[9px] text-muted-foreground hover:text-foreground transition-colors w-full"
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {icon}
        <span className="font-medium uppercase tracking-wider">{title}</span>
      </button>
      {open && <div className="pl-1">{children}</div>}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

interface RegimeAnalyticsProps {
  compact?: boolean;
}

export default function RegimeAnalytics({ compact = true }: RegimeAnalyticsProps) {
  const dashboard = useDashboard();
  const queryClient = useQueryClient();

  // Training state
  const [isTraining, setIsTraining] = useState(false);
  const [progress, setProgress] = useState<TrainingProgress | null>(null);
  const [trainLogs, setTrainLogs] = useState<string[]>([]);
  const [trainError, setTrainError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Config state
  const [selectedSymbol, setSelectedSymbol] = useState(dashboard.symbol || "ES");
  const [selectedTimeframe, setSelectedTimeframe] = useState("30m");
  const [maxRegimes, setMaxRegimes] = useState(8);
  const [nFolds, setNFolds] = useState(5);
  const [testSplit, setTestSplit] = useState(0.15);
  const [wfWindows, setWfWindows] = useState(5);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Results state
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  // Sync symbol from dashboard context
  useEffect(() => {
    if (dashboard.symbol) setSelectedSymbol(dashboard.symbol);
  }, [dashboard.symbol]);

  // ── Queries ──────────────────────────────────────────────────────────────

  const { data: modelsData, refetch: refetchModels } = useQuery({
    queryKey: QUERY_KEYS.regimeModels,
    queryFn: async () => {
      const res = await fetch("/api/regime/models");
      if (!res.ok) throw new Error("Failed to load regime models");
      return res.json() as Promise<{ models: RegimeModel[] }>;
    },
    refetchInterval: isTraining ? 5000 : false,
  });

  const models = modelsData?.models || [];

  const { data: diagnostics } = useQuery({
    queryKey: QUERY_KEYS.regimeDiagnostics(selectedModel || ""),
    queryFn: async () => {
      const res = await fetch(`/api/regime/diagnostics/${selectedModel}`);
      if (!res.ok) throw new Error("Failed to load diagnostics");
      return res.json() as Promise<Diagnostics>;
    },
    enabled: !!selectedModel,
  });

  const { data: convergenceData } = useQuery({
    queryKey: [...QUERY_KEYS.regimeDiagnostics(selectedModel || ""), "convergence"],
    queryFn: async () => {
      const res = await fetch(`/api/regime/convergence/${selectedModel}`);
      if (!res.ok) return null;
      return res.json() as Promise<Record<string, Array<{ iter: number; log_likelihood: number; delta: number }>>>;
    },
    enabled: !!selectedModel,
  });

  const { data: assignmentsData } = useQuery({
    queryKey: QUERY_KEYS.regimeAssignments(selectedModel || ""),
    queryFn: async () => {
      const res = await fetch(`/api/regime/assignments/${selectedModel}?limit=50000`);
      if (!res.ok) throw new Error("Failed to load assignments");
      return res.json() as Promise<{ rows: Array<{ ts: string; close: number; regime: number; regime_label: string; split?: string; [key: string]: unknown }>; total: number }>;
    },
    enabled: !!selectedModel,
  });

  // ── Training ─────────────────────────────────────────────────────────────

  const startTraining = useCallback(async () => {
    setIsTraining(true);
    setProgress(null);
    setTrainLogs([]);
    setTrainError(null);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const res = await fetch("/api/regime/train", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: selectedSymbol,
          timeframe: selectedTimeframe,
          maxRegimes,
          nFolds,
          testSplit,
          wfWindows,
        }),
        signal: abort.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error("Failed to start training");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        let eventName = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventName = line.slice(7).trim();
          } else if (line.startsWith("data: ") && eventName) {
            try {
              const data = JSON.parse(line.slice(6));
              switch (eventName) {
                case "progress":
                  setProgress(data as TrainingProgress);
                  break;
                case "status":
                case "log":
                case "regime_line":
                  setTrainLogs(prev => [...prev.slice(-50), data.message || data.text || data.phase]);
                  break;
                case "done":
                  setSelectedModel(data.modelId);
                  refetchModels();
                  break;
                case "error":
                  setTrainError(data.message);
                  break;
              }
            } catch {
              // Skip malformed JSON
            }
            eventName = "";
          }
        }
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        setTrainError(err.message);
      }
    } finally {
      setIsTraining(false);
      abortRef.current = null;
    }
  }, [selectedSymbol, selectedTimeframe, maxRegimes, nFolds, testSplit, wfWindows, refetchModels]);

  const stopTraining = useCallback(() => {
    abortRef.current?.abort();
    fetch("/api/regime/train/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: selectedSymbol, timeframe: selectedTimeframe }),
    });
    setIsTraining(false);
  }, [selectedSymbol, selectedTimeframe]);

  const deleteModel = useCallback(async (id: string) => {
    await fetch(`/api/regime/models/${id}`, { method: "DELETE" });
    if (selectedModel === id) setSelectedModel(null);
    refetchModels();
  }, [selectedModel, refetchModels]);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <ScrollArea className="h-full">
      <div className="p-3 space-y-3">
        {/* ── Train Controls ────────────────────────────── */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Layers className="h-3.5 w-3.5 text-orange-400" />
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              HDP-HMM Regime Detector
            </span>
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            <div>
              <label className="text-[9px] text-muted-foreground">Symbol</label>
              <Input
                value={selectedSymbol}
                onChange={e => setSelectedSymbol(e.target.value.toUpperCase())}
                className="h-6 text-[10px] bg-black/30 border-white/10 px-2"
                disabled={isTraining}
              />
            </div>
            <div>
              <label className="text-[9px] text-muted-foreground">Timeframe</label>
              <Select value={selectedTimeframe} onValueChange={setSelectedTimeframe} disabled={isTraining}>
                <SelectTrigger className="h-6 text-[10px] bg-black/30 border-white/10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["1m", "5m", "15m", "30m", "1h", "4h", "1d"].map(tf => (
                    <SelectItem key={tf} value={tf} className="text-xs">{tf}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[9px] text-muted-foreground">Max Regimes</label>
              <Input
                type="number"
                value={maxRegimes}
                onChange={e => setMaxRegimes(Math.max(3, Math.min(12, parseInt(e.target.value) || 8)))}
                className="h-6 text-[10px] bg-black/30 border-white/10 px-2"
                min={3} max={12}
                disabled={isTraining}
              />
            </div>
          </div>

          {/* Advanced config toggle */}
          <button
            className="flex items-center gap-1 text-[8px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            <Settings2 className="h-2.5 w-2.5" />
            <span>{showAdvanced ? "Hide" : "Show"} Validation Settings</span>
            {showAdvanced ? <ChevronDown className="h-2.5 w-2.5" /> : <ChevronRight className="h-2.5 w-2.5" />}
          </button>

          {showAdvanced && (
            <div className="grid grid-cols-3 gap-1.5 p-2 rounded-lg bg-black/20 border border-white/5">
              <div>
                <label className="text-[8px] text-muted-foreground">CV Folds</label>
                <Input
                  type="number"
                  value={nFolds}
                  onChange={e => setNFolds(Math.max(2, Math.min(10, parseInt(e.target.value) || 5)))}
                  className="h-5 text-[9px] bg-black/30 border-white/10 px-1.5"
                  min={2} max={10}
                  disabled={isTraining}
                />
              </div>
              <div>
                <label className="text-[8px] text-muted-foreground">Test Split</label>
                <Input
                  type="number"
                  value={testSplit}
                  onChange={e => setTestSplit(Math.max(0.05, Math.min(0.5, parseFloat(e.target.value) || 0.15)))}
                  className="h-5 text-[9px] bg-black/30 border-white/10 px-1.5"
                  step={0.05}
                  min={0.05} max={0.5}
                  disabled={isTraining}
                />
              </div>
              <div>
                <label className="text-[8px] text-muted-foreground">WF Windows</label>
                <Input
                  type="number"
                  value={wfWindows}
                  onChange={e => setWfWindows(Math.max(2, Math.min(10, parseInt(e.target.value) || 5)))}
                  className="h-5 text-[9px] bg-black/30 border-white/10 px-1.5"
                  min={2} max={10}
                  disabled={isTraining}
                />
              </div>
            </div>
          )}

          {/* Train / Stop button */}
          <Button
            size="sm"
            className={`w-full h-7 text-[10px] gap-1.5 ${isTraining
              ? "bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 border border-rose-500/30"
              : "bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 border border-orange-500/30"
            }`}
            variant="ghost"
            onClick={isTraining ? stopTraining : startTraining}
          >
            {isTraining ? (
              <><Square className="h-3 w-3" /> Stop Training</>
            ) : (
              <><Play className="h-3 w-3" /> Train Regime Detector</>
            )}
          </Button>

          {/* Progress bar */}
          {isTraining && progress && (
            <div className="space-y-1">
              <div className="flex justify-between items-center">
                <span className="text-[9px] text-muted-foreground">{progress.message}</span>
                <span className="text-[9px] font-mono text-orange-400">{progress.pct}%</span>
              </div>
              <Progress value={progress.pct} className="h-1.5" />
            </div>
          )}

          {/* Training logs (last 3 lines) */}
          {trainLogs.length > 0 && (
            <div className="p-1.5 rounded bg-black/30 border border-white/5 max-h-[48px] overflow-hidden">
              {trainLogs.slice(-3).map((line, i) => (
                <p key={i} className="text-[8px] font-mono text-muted-foreground/70 truncate">{line}</p>
              ))}
            </div>
          )}

          {/* Error */}
          {trainError && (
            <div className="p-2 rounded bg-rose-500/10 border border-rose-500/20">
              <p className="text-[9px] text-rose-400">{trainError}</p>
            </div>
          )}
        </div>

        {/* ── Trained Models List ────────────────────────── */}
        {models.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[9px] text-muted-foreground font-medium uppercase tracking-wider">
              Trained Models ({models.length})
            </p>
            {models.map(m => (
              <div
                key={m.id}
                className={`flex items-center gap-2 p-1.5 rounded-lg cursor-pointer transition-colors ${
                  selectedModel === m.id
                    ? "bg-orange-500/15 border border-orange-500/25"
                    : "bg-white/5 border border-transparent hover:bg-white/8"
                }`}
                onClick={() => {
                  setSelectedModel(m.id);
                  setShowDiagnostics(true);
                }}
              >
                {/* Quality score mini ring */}
                {m.quality_score != null && (
                  <QualityScoreRing score={m.quality_score} />
                )}

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-mono font-medium text-foreground">{m.symbol}</span>
                    <Badge variant="outline" className="text-[7px] px-1 py-0 rounded-full">{m.timeframe}</Badge>
                    <Badge variant="outline" className="text-[7px] px-1 py-0 rounded-full border-orange-500/30 text-orange-400">
                      {m.n_regimes} regimes
                    </Badge>
                  </div>
                  <p className="text-[8px] text-muted-foreground/60 font-mono">
                    {(m.n_bars_total || m.n_bars || 0).toLocaleString()} bars
                    {m.n_bars_train_val ? ` (${m.n_bars_train_val.toLocaleString()} train)` : ""}
                    {" · "}{m.training_time_sec.toFixed(0)}s
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-5 w-5 p-0 text-muted-foreground/40 hover:text-rose-400"
                  onClick={(e) => { e.stopPropagation(); deleteModel(m.id); }}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* ── Diagnostics Panel ─────────────────────────── */}
        {diagnostics && showDiagnostics && (
          <div className="space-y-3 pt-1">
            {/* Header with quality score */}
            <div className="flex items-center justify-between">
              <button
                className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setShowDiagnostics(!showDiagnostics)}
              >
                <ChevronDown className="h-3 w-3" />
                <span className="font-medium uppercase tracking-wider">Training Analytics</span>
                <Badge variant="outline" className="text-[7px] px-1 py-0 ml-1 rounded-full border-orange-500/30 text-orange-400">
                  {diagnostics.symbol} {diagnostics.timeframe}
                </Badge>
              </button>
              {diagnostics.quality_score != null && (
                <div className="flex items-center gap-1">
                  <QualityScoreRing score={diagnostics.quality_score} />
                  <span className={`text-[8px] font-medium ${getQualityColor(diagnostics.quality_score)}`}>
                    {getQualityLabel(diagnostics.quality_score)}
                  </span>
                </div>
              )}
            </div>

            {/* Data split summary */}
            {diagnostics.n_bars_train_val != null && (
              <div className="p-2 rounded-lg bg-black/20 border border-white/5">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[8px] text-muted-foreground">Data Split</span>
                  <span className="text-[8px] font-mono text-foreground/70">
                    {(diagnostics.n_bars_total || 0).toLocaleString()} total bars
                  </span>
                </div>
                <div className="w-full h-2 rounded-full overflow-hidden flex bg-white/5">
                  <div className="h-full bg-blue-500/60"
                    style={{ width: `${((diagnostics.n_bars_train_val || 0) / (diagnostics.n_bars_total || 1)) * 100}%` }}
                  />
                  <div className="h-full bg-amber-500/60"
                    style={{ width: `${((diagnostics.n_bars_test || 0) / (diagnostics.n_bars_total || 1)) * 100}%` }}
                  />
                </div>
                <div className="flex justify-between mt-0.5">
                  <span className="text-[7px] text-blue-400">Train+Val: {(diagnostics.n_bars_train_val || 0).toLocaleString()}</span>
                  <span className="text-[7px] text-amber-400">Test: {(diagnostics.n_bars_test || 0).toLocaleString()}</span>
                </div>
              </div>
            )}

            {/* BIC Model Selection */}
            <Section title="Model Selection (BIC)" icon={<BarChart3 className="h-3 w-3 text-cyan-400" />} defaultOpen>
              <div className="p-1.5 rounded-lg bg-black/30 border border-white/5">
                <BICChart
                  data={diagnostics.model_selection}
                  bestN={diagnostics.n_regimes}
                  bicBestK={diagnostics.bic_best_k}
                  cvBestK={diagnostics.cv_best_k}
                />
              </div>
              {diagnostics.bic_best_k != null && diagnostics.cv_best_k != null && (
                <div className="flex gap-2 mt-1">
                  <Badge variant="outline" className="text-[7px] px-1 py-0 rounded-full border-amber-500/30 text-amber-400">
                    BIC: k={diagnostics.bic_best_k}
                  </Badge>
                  <Badge variant="outline" className="text-[7px] px-1 py-0 rounded-full border-emerald-500/30 text-emerald-400">
                    CV: k={diagnostics.cv_best_k}
                  </Badge>
                  <Badge variant="outline" className="text-[7px] px-1 py-0 rounded-full border-blue-500/30 text-blue-400">
                    Final: k={diagnostics.n_regimes}
                  </Badge>
                </div>
              )}
              {/* Convergence info */}
              {diagnostics.convergence_summary && (
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="outline" className={`text-[7px] px-1 py-0 rounded-full ${
                    diagnostics.convergence_summary.converged ? "border-emerald-500/30 text-emerald-400" : "border-rose-500/30 text-rose-400"
                  }`}>
                    {diagnostics.convergence_summary.converged ? "Converged" : "Not Converged"}
                  </Badge>
                  <span className="text-[7px] text-muted-foreground font-mono">
                    {diagnostics.convergence_summary.n_iterations} iters
                  </span>
                </div>
              )}
            </Section>

            {/* Cross-Validation Results */}
            {diagnostics.cross_validation && Object.keys(diagnostics.cross_validation).length > 0 && (
              <Section title="Cross-Validation" icon={<Shield className="h-3 w-3 text-violet-400" />} defaultOpen>
                {Object.entries(diagnostics.cross_validation).map(([k, cv]) => (
                  <div key={k} className="space-y-1 mb-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[8px] font-mono text-muted-foreground">k={cv.n_components}</span>
                      {cv.mean_val_ll_per_sample != null && (
                        <span className="text-[8px] font-mono text-violet-400">
                          val={cv.mean_val_ll_per_sample.toFixed(3)} +/- {cv.std_val_ll_per_sample?.toFixed(3)}
                        </span>
                      )}
                    </div>
                    <div className="p-1.5 rounded bg-black/20 border border-white/5">
                      <CVFoldTable cv={cv} />
                    </div>
                  </div>
                ))}
              </Section>
            )}

            {/* Walk-Forward Results */}
            {diagnostics.walk_forward && diagnostics.walk_forward.n_windows > 0 && (
              <Section title="Walk-Forward Stability" icon={<Target className="h-3 w-3 text-emerald-400" />} defaultOpen>
                <div className="p-1.5 rounded bg-black/20 border border-white/5">
                  <WalkForwardDisplay wf={diagnostics.walk_forward} />
                </div>
              </Section>
            )}

            {/* Out-of-Sample Assessment */}
            {diagnostics.out_of_sample && (
              <Section title="Out-of-Sample Assessment" icon={<Shield className="h-3 w-3 text-blue-400" />} defaultOpen>
                <div className="p-1.5 rounded bg-black/20 border border-white/5">
                  <OOSDisplay oos={diagnostics.out_of_sample} n_regimes={diagnostics.n_regimes} />
                </div>
              </Section>
            )}

            {/* EM Convergence Curves */}
            {convergenceData && Object.keys(convergenceData).length > 0 && (
              <Section title="EM Convergence" icon={<Activity className="h-3 w-3 text-violet-400" />}>
                <div className="p-1.5 rounded bg-black/20 border border-white/5 space-y-2">
                  {Object.entries(convergenceData).map(([key, history]) => (
                    <ConvergenceCurve key={key} data={history} label={key.startsWith("final") ? `Final Model (${key})` : `k=${key}`} />
                  ))}
                </div>
              </Section>
            )}

            {/* Regime Stats */}
            <Section title="Regime Breakdown" icon={<Layers className="h-3 w-3 text-orange-400" />} defaultOpen>
              {diagnostics.regime_stats.map((r) => {
                const color = getRegimeColor(r.regime_id);
                return (
                  <div key={r.regime_id} className={`p-2 rounded-lg ${color.bg} border ${color.border} mb-1.5`}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5">
                        <span className={`${color.text}`}>{getRegimeIcon(r.label)}</span>
                        <span className={`text-[10px] font-medium ${color.text}`}>
                          R{r.regime_id}: {r.label.replace(/_/g, " ")}
                        </span>
                      </div>
                      <Badge variant="outline" className={`text-[7px] px-1 py-0 ${color.border} ${color.text}`}>
                        {r.pct.toFixed(1)}%
                      </Badge>
                    </div>
                    <div className="grid grid-cols-4 gap-x-2 gap-y-0.5">
                      <div>
                        <span className="text-[7px] text-muted-foreground">Bars</span>
                        <p className="text-[9px] font-mono">{r.count.toLocaleString()}</p>
                      </div>
                      <div>
                        <span className="text-[7px] text-muted-foreground">Avg Ret</span>
                        <p className={`text-[9px] font-mono ${r.avg_return >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                          {(r.avg_return * 100).toFixed(3)}%
                        </p>
                      </div>
                      <div>
                        <span className="text-[7px] text-muted-foreground">Volatility</span>
                        <p className="text-[9px] font-mono">{(r.avg_volatility * 100).toFixed(3)}%</p>
                      </div>
                      <div>
                        <span className="text-[7px] text-muted-foreground">Avg Dur</span>
                        <p className="text-[9px] font-mono">{r.avg_duration.toFixed(0)} bars</p>
                      </div>
                    </div>
                    {/* Proportion bar */}
                    <div className="mt-1 h-1 rounded-full bg-white/5 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${r.pct}%`, backgroundColor: color.hex, opacity: 0.6 }} />
                    </div>
                  </div>
                );
              })}
            </Section>

            {/* Transition Matrix */}
            {diagnostics.transition_matrix.length > 0 && (
              <Section title="Transition Probabilities" icon={<Activity className="h-3 w-3 text-cyan-400" />}>
                <div className="p-2 rounded-lg bg-black/30 border border-white/5 flex justify-center">
                  <TransitionMatrix
                    matrix={diagnostics.transition_matrix}
                    labels={diagnostics.regime_stats.map(r => r.label)}
                  />
                </div>
                <p className="text-[7px] text-muted-foreground/50 text-center mt-1">
                  Row → Col · Green = self-stay · Cyan = switch
                </p>
              </Section>
            )}

            {/* Regime Timeline */}
            {assignmentsData?.rows && assignmentsData.rows.length > 0 && (
              <Section title={`Regime Timeline (${assignmentsData.total.toLocaleString()} bars)`} icon={<BarChart3 className="h-3 w-3 text-amber-400" />} defaultOpen>
                <RegimeTimeline
                  assignments={assignmentsData.rows.map(r => ({ regime: r.regime }))}
                  n_regimes={diagnostics.n_regimes}
                />
                {/* Legend */}
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {diagnostics.regime_stats.map(r => {
                    const color = getRegimeColor(r.regime_id);
                    return (
                      <div key={r.regime_id} className="flex items-center gap-1">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color.hex }} />
                        <span className="text-[7px] text-muted-foreground">{r.label.replace(/_/g, " ")}</span>
                      </div>
                    );
                  })}
                </div>
              </Section>
            )}

            {/* Feature list */}
            <Section title={`Features (${diagnostics.n_features})`} icon={<Zap className="h-3 w-3 text-amber-400" />}>
              <div className="flex flex-wrap gap-1">
                {diagnostics.feature_names.map(f => (
                  <Badge key={f} variant="outline" className="text-[7px] px-1.5 py-0 rounded-full border-white/10">
                    {f}
                  </Badge>
                ))}
              </div>
            </Section>

            {/* Training config summary */}
            {diagnostics.training_config && (
              <Section title="Training Config" icon={<Settings2 className="h-3 w-3 text-muted-foreground" />}>
                <div className="grid grid-cols-3 gap-1 p-1.5 rounded bg-black/20 border border-white/5">
                  {Object.entries(diagnostics.training_config).map(([k, v]) => (
                    <div key={k}>
                      <span className="text-[7px] text-muted-foreground/50">{k.replace(/_/g, " ")}</span>
                      <p className="text-[8px] font-mono text-foreground/70">{String(v)}</p>
                    </div>
                  ))}
                </div>
              </Section>
            )}
          </div>
        )}

        {/* Empty state */}
        {models.length === 0 && !isTraining && (
          <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
            <Layers className="h-8 w-8 mb-2 opacity-20" />
            <p className="text-xs">No regime models yet</p>
            <p className="text-[10px] text-muted-foreground/60">Train one to detect market personalities</p>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

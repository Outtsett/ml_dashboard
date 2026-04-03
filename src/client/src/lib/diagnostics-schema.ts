/**
 * Self-Describing Diagnostics Schema
 *
 * Models declare their own metrics with renderer hints, mission context,
 * and display thresholds. The dashboard renders whatever the model emits.
 * No model-type-specific UI code needed.
 *
 * Usage (Python side):
 *   diagnostics["metrics"]["profit_factor"] = {
 *     "value": 1.85,
 *     "renderer": "gauge",
 *     "mission": "Is this model profitable after costs?",
 *     "context": { "breakeven": 1.0, "good": 1.5, "great": 2.0 }
 *   }
 *
 * Usage (Dashboard side):
 *   metrics.map(m => <MetricCard key={m.key} metric={m} />)
 *   // MetricCard resolves renderer by name, renders value with context
 */

import type React from 'react';

// ── Renderer Types ──────────────────────────────────────────────────────────

/** All available renderer types. Adding a new renderer = one React component. */
export type RendererType =
  | 'gauge'              // Circular gauge with colored zones (good/bad/great)
  | 'number'             // Large formatted number with label
  | 'percent'            // Percentage bar fill (0-1 or 0-100)
  | 'bars'               // Horizontal or vertical bar chart
  | 'precision_bars'     // Grouped precision/recall bars with baseline
  | 'confusion_matrix'   // NxN classification heatmap
  | 'fold_bars'          // Per-fold metric bars (walk-forward)
  | 'chart_overlay'      // Predictions overlaid on candlestick chart
  | 'time_series'        // Line chart over epochs/iterations
  | 'heatmap'            // 2D numeric grid with color scale
  | 'distribution'       // Histogram / distribution chart
  | 'table'              // Key-value or tabular data
  | 'ring'               // Donut/ring chart (class distribution, etc.)
  | 'text'               // Plain text with optional severity coloring
  | 'surface_3d';        // 3D loss surface / trajectory (Three.js/R3F)

// ── Metric Context ──────────────────────────────────────────────────────────

/** Thresholds that define what good/bad/neutral looks like for this metric. */
export interface MetricContext {
  /** Minimum possible value (for gauge scaling) */
  min?: number;
  /** Maximum possible value (for gauge scaling) */
  max?: number;
  /** Value at which the metric transitions from bad to neutral */
  bad?: number;
  /** Value at which the metric transitions from neutral to good */
  good?: number;
  /** Value at which the metric is excellent */
  great?: number;
  /** Reference line value (e.g., breakeven = 1.0 for profit factor) */
  breakeven?: number;
  /** Baseline for comparison (e.g., random = 0.33 for 3-class) */
  baseline?: number;
  /** Unit label (e.g., "$", "%", "ticks", "bars") */
  unit?: string;
  /** Number format: how many decimal places */
  decimals?: number;
  /** Whether higher is better (true) or lower is better (false) */
  higher_is_better?: boolean;
  /** Labels for categorical values (e.g., class names for confusion matrix) */
  labels?: string[];
  /** Data source identifier for renderers that fetch external data (e.g., chart_overlay) */
  data_source?: string;
}

// ── Metric Declaration ──────────────────────────────────────────────────────

/** A single self-describing metric emitted by a trained model. */
export interface MetricDeclaration {
  /** The metric value. Null = declaration-only (awaiting training).
   *  Scalar for gauge/number/percent, array for bars/distribution,
   *  2D array for heatmap/confusion_matrix, object for surface_3d/complex renderers. */
  value?: number | Record<string, number> | number[] | number[][] | Record<string, unknown> | null;
  /** Which renderer component to use */
  renderer: RendererType;
  /** The question this metric answers — displayed as the card title */
  mission: string;
  /** Thresholds, scaling, and display context */
  context: MetricContext;
  /** Optional grouping key for layout (e.g., "performance", "quality", "data") */
  group?: string;
  /** Display order within group (lower = first). Default: 0 */
  order?: number;
}

// ── Diagnostics Container ───────────────────────────────────────────────────

/** Self-describing diagnostics emitted by any trained model. */
export interface SelfDescribingDiagnostics {
  /** Model architecture identifier (e.g., "cnn-transformer", "primitives-discovery", "xgboost") */
  model_type: string;
  /** Human-readable model label */
  model_label?: string;
  /** Symbol trained on */
  symbol: string;
  /** Timeframe */
  timeframe: string;
  /** Self-describing metrics — the dashboard renders whatever is here */
  metrics: Record<string, MetricDeclaration>;
  /** Training metadata */
  training: {
    duration_sec: number;
    trained_at: string;
    n_bars_train?: number;
    n_bars_val?: number;
    epochs?: number;
    best_epoch?: number;
  };
  /** Model architecture info (for display, not rendering) */
  architecture?: {
    type: string;
    param_count?: number;
    [key: string]: unknown;
  };
  /** Raw convergence data for time_series renderers */
  convergence?: {
    epochs: number[];
    [metric_name: string]: number[];
  };
  /** Any additional model-specific data that doesn't fit metrics schema */
  extra?: Record<string, unknown>;
}

// ── Renderer Props ──────────────────────────────────────────────────────────

/** Props passed to every renderer component. */
export interface RendererProps {
  /** The metric key (e.g., "profit_factor") */
  metricKey: string;
  /** The full metric declaration */
  metric: MetricDeclaration;
  /** Optional: compact mode for grid layouts */
  compact?: boolean;
}

// ── Renderer Registry ───────────────────────────────────────────────────────

/** Map of renderer type to React component. Components self-register. */
export type RendererRegistry = Record<RendererType, React.ComponentType<RendererProps>>;

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Get severity color based on value and context thresholds. */
export function getMetricSeverity(
  value: number,
  context: MetricContext,
): 'great' | 'good' | 'neutral' | 'bad' {
  const hib = context.higher_is_better ?? true;
  if (context.great != null && (hib ? value >= context.great : value <= context.great)) return 'great';
  if (context.good != null && (hib ? value >= context.good : value <= context.good)) return 'good';
  if (context.bad != null && (hib ? value <= context.bad : value >= context.bad)) return 'bad';
  return 'neutral';
}

/** Format a metric value for display. Abbreviates large numbers. */
export function formatMetricValue(value: number, context: MetricContext): string {
  const decimals = context.decimals ?? 2;
  const unit = context.unit ?? '';
  if (unit === '%') return `${(value * 100).toFixed(decimals)}%`;
  // Abbreviate large numbers
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B${unit ? ' ' + unit : ''}`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M${unit ? ' ' + unit : ''}`;
  if (abs >= 10_000) return `${(value / 1_000).toFixed(1)}K${unit ? ' ' + unit : ''}`;
  return `${value.toFixed(decimals)}${unit ? ' ' + unit : ''}`;
}

/** Severity → tailwind color mapping. */
export const SEVERITY_COLORS = {
  great: 'text-emerald-400',
  good: 'text-cyan-400',
  neutral: 'text-zinc-400',
  bad: 'text-red-400',
} as const;

export const SEVERITY_BG = {
  great: 'bg-emerald-500/10 border-emerald-500/20',
  good: 'bg-cyan-500/10 border-cyan-500/20',
  neutral: 'bg-zinc-500/10 border-zinc-500/20',
  bad: 'bg-red-500/10 border-red-500/20',
} as const;

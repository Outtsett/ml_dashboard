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

// ── Multi-Run Overlay (§2.6) ────────────────────────────────────────────────

/**
 * One run's contribution to an overlaid metric chart. Assembled by
 * `MetricGrid`, which also owns stable per-run color assignment (Wong-2011
 * colorblind-safe palette — see `@/ml/stages/evaluate/palette`).
 */
export interface MetricSeriesEntry {
  /** Stable identifier for the run. */
  runId: string;
  /** Display label for the run (shown in legends / chips). */
  label: string;
  /** Stable per-run color assigned by `MetricGrid`. Never the sole encoding
   *  of run identity — always paired with `label` in legends/chips/tooltips
   *  (deuteranopia-safe: color reinforces, text carries the meaning). */
  color: string;
  /** This run's declaration for the metric being rendered. */
  metric: MetricDeclaration;
}

// ── Renderer Props ──────────────────────────────────────────────────────────

/** Props passed to every renderer component. */
export interface RendererProps {
  /** The metric key (e.g., "profit_factor") */
  metricKey: string;
  /**
   * The full metric declaration — ALWAYS the primary run, regardless of
   * whether `series` is present. Every renderer that only reads `metric`
   * (i.e. does not opt into overlay rendering) compiles and behaves
   * identically to before this field existed.
   */
  metric: MetricDeclaration;
  /**
   * Present only when >1 run is selected for comparison (§2.6 multi-run
   * overlay). Invariant: when present, `series[0].metric === metric` — the
   * primary run is always `series[0]`, by construction in `MetricGrid`.
   * Renderer capability is declared once via `OVERLAY_CAPABLE` in
   * `components/index.ts`; only renderers in that set read this prop.
   */
  series?: MetricSeriesEntry[];
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

/**
 * Severity → tailwind color mapping.
 *
 * Runs blue → grey → orange → yellow, not red → grey → cyan → emerald. The old
 * scale put its two ends (bad, great) on the red/green axis, which is a single
 * hue for a deuteranope — meaning the most important distinction the scale
 * makes was the one it could not communicate. The replacement is monotonic in
 * warmth and reads correctly in grayscale.
 *
 * Severity is never the only channel: renderers pair these with a numeric
 * readout, and gauges additionally with needle position.
 */
export const SEVERITY_COLORS = {
  great: 'text-[hsl(var(--data-warn))]', // yellow  — brightest, "best"
  good: 'text-[hsl(var(--data-pos))]',   // orange
  neutral: 'text-[hsl(var(--data-neutral))]',
  bad: 'text-[hsl(var(--data-neg))]',    // blue
} as const;

export const SEVERITY_BG = {
  great: 'bg-[hsl(var(--data-warn)/0.1)] border-[hsl(var(--data-warn)/0.2)]',
  good: 'bg-[hsl(var(--data-pos)/0.1)] border-[hsl(var(--data-pos)/0.2)]',
  neutral: 'bg-[hsl(var(--data-neutral)/0.1)] border-[hsl(var(--data-neutral)/0.2)]',
  bad: 'bg-[hsl(var(--data-neg)/0.1)] border-[hsl(var(--data-neg)/0.2)]',
} as const;

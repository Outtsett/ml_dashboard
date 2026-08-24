/**
 * Shared threshold-tier color rules for Stage 5 Evaluate components.
 *
 * Mirrors the per-metric tier logic baked into `DashboardTab.tsx` so the
 * comparison matrix and forest plot stay color-consistent with the
 * checkpoint dashboard. DO NOT re-derive these in each component — import
 * `metricColorClass()` here.
 */

export type MetricKey =
  | "sharpe"
  | "profitFactor"
  | "winRate"
  | "maxDrawdown"
  | "ece"
  | "meanTradePnl"
  | "tradeFrequency"
  | "sharpeLowVol"
  | "sharpeHighVol"
  | "sharpeTrend"
  | "sharpeChop";

export interface MetricSpec {
  key: MetricKey;
  label: string;
  /** Higher-is-better, lower-is-better, or neutral (no tier coloring). */
  better: "higher" | "lower" | "neutral";
  format: (v: number | null) => string;
}

function fmt(digits: number) {
  return (v: number | null) => (v == null || !Number.isFinite(v) ? "—" : v.toFixed(digits));
}

function fmtPct(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function fmtPctPositive(v: number | null): string {
  // Max-drawdown / ECE display as positive percent — color rules use raw value.
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(Math.abs(v) * 100).toFixed(1)}%`;
}

export const METRICS: MetricSpec[] = [
  { key: "sharpe", label: "Sharpe (after costs)", better: "higher", format: fmt(2) },
  { key: "profitFactor", label: "Profit Factor", better: "higher", format: fmt(2) },
  { key: "winRate", label: "Win Rate", better: "higher", format: fmtPct },
  { key: "maxDrawdown", label: "Max Drawdown", better: "lower", format: fmtPctPositive },
  { key: "ece", label: "ECE", better: "lower", format: fmt(3) },
  { key: "meanTradePnl", label: "Mean Trade PnL", better: "higher", format: fmt(2) },
  { key: "tradeFrequency", label: "Trade Frequency", better: "neutral", format: fmt(2) },
  { key: "sharpeLowVol", label: "Sharpe (low-vol regime)", better: "higher", format: fmt(2) },
  { key: "sharpeHighVol", label: "Sharpe (high-vol regime)", better: "higher", format: fmt(2) },
  { key: "sharpeTrend", label: "Sharpe (trend regime)", better: "higher", format: fmt(2) },
  { key: "sharpeChop", label: "Sharpe (chop regime)", better: "higher", format: fmt(2) },
];

const NEUTRAL = "text-muted-foreground";

function pfColor(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return NEUTRAL;
  if (v >= 2.0) return "text-emerald-400";
  if (v >= 1.5) return "text-emerald-400/80";
  if (v >= 1.0) return "text-amber-400";
  return "text-rose-400";
}

function sharpeColor(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return NEUTRAL;
  if (v >= 2.0) return "text-emerald-400";
  if (v >= 1.0) return "text-emerald-400/80";
  if (v >= 0) return "text-amber-400";
  return "text-rose-400";
}

function winRateColor(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return NEUTRAL;
  if (v >= 0.55) return "text-emerald-400";
  if (v >= 0.5) return "text-amber-400";
  return "text-rose-400";
}

function drawdownColor(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return NEUTRAL;
  const mag = Math.abs(v);
  if (mag <= 0.05) return "text-emerald-400";
  if (mag <= 0.1) return "text-amber-400";
  return "text-rose-400";
}

function eceColor(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return NEUTRAL;
  if (v <= 0.05) return "text-emerald-400";
  if (v <= 0.1) return "text-amber-400";
  return "text-rose-400";
}

function pnlColor(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return NEUTRAL;
  if (v > 0) return "text-emerald-400";
  if (v < 0) return "text-rose-400";
  return "text-amber-400";
}

export function metricColorClass(key: MetricKey, v: number | null): string {
  switch (key) {
    case "profitFactor":
      return pfColor(v);
    case "sharpe":
    case "sharpeLowVol":
    case "sharpeHighVol":
    case "sharpeTrend":
    case "sharpeChop":
      return sharpeColor(v);
    case "winRate":
      return winRateColor(v);
    case "maxDrawdown":
      return drawdownColor(v);
    case "ece":
      return eceColor(v);
    case "meanTradePnl":
      return pnlColor(v);
    case "tradeFrequency":
      return "text-foreground";
  }
}

/**
 * Pluck a metric value from an `ExperimentSummary` plus optional regime
 * extras (regime-conditional Sharpe lives in the summary or in the per-fold
 * metrics depending on the trainer; consumers pass a flat `extras` map for
 * the regime-specific entries).
 */
export interface MetricLookup {
  sharpe: number | null;
  profitFactor: number | null;
  winRate: number | null;
  maxDrawdown: number | null;
  ece: number | null;
  meanTradePnl: number | null;
  tradeFrequency?: number | null;
  sharpeLowVol?: number | null;
  sharpeHighVol?: number | null;
  sharpeTrend?: number | null;
  sharpeChop?: number | null;
}

export function readMetric(lookup: MetricLookup, key: MetricKey): number | null {
  switch (key) {
    case "sharpe":
      return lookup.sharpe;
    case "profitFactor":
      return lookup.profitFactor;
    case "winRate":
      return lookup.winRate;
    case "maxDrawdown":
      return lookup.maxDrawdown;
    case "ece":
      return lookup.ece;
    case "meanTradePnl":
      return lookup.meanTradePnl;
    case "tradeFrequency":
      return lookup.tradeFrequency ?? null;
    case "sharpeLowVol":
      return lookup.sharpeLowVol ?? null;
    case "sharpeHighVol":
      return lookup.sharpeHighVol ?? null;
    case "sharpeTrend":
      return lookup.sharpeTrend ?? null;
    case "sharpeChop":
      return lookup.sharpeChop ?? null;
  }
}

/**
 * Best column = highest value for higher-is-better, lowest for lower-is-better,
 * undefined for neutral metrics. Ties resolve to the first index.
 */
export function bestExperimentIndex(
  spec: MetricSpec,
  values: ReadonlyArray<number | null>,
): number | null {
  if (spec.better === "neutral") return null;
  let bestIdx: number | null = null;
  let bestVal: number | null = null;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    if (v == null || !Number.isFinite(v)) continue;
    if (bestVal == null) {
      bestVal = v;
      bestIdx = i;
      continue;
    }
    if (spec.better === "higher" ? v > bestVal : v < bestVal) {
      bestVal = v;
      bestIdx = i;
    }
  }
  return bestIdx;
}

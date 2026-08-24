/**
 * Candle geometry — the per-bar scale-free embedding, ported from
 * scripts/candle_geometry.py so the browser sees exactly the features the
 * Python pipeline produces. The port is asserted against Python-generated
 * values in tests/client/mechanism/candleGeometry.test.ts.
 *
 * In-candle SHAPE (divided by range, so scale-free):
 *   open_norm  = (open  - low) / range              in [0,1]
 *   close_norm = (close - low) / range              in [0,1]
 *   body_norm  = (close - open) / range             in [-1,1]  signed
 *   upper_norm = (high - max(open,close)) / range   in [0,1]
 *   lower_norm = (min(open,close) - low) / range    in [0,1]
 * A zero-range bar takes the neutral value (0.5 / 0), never a divide.
 *
 * Across-time DISTRIBUTION — causal trailing rolling z-score, window W,
 * min_periods = W, population std (ddof=0), clipped +/- Z_CLIP:
 *   range_z, body_z, wick_z, return_z, volume_z
 * Warmup rows are null, not zero — an unknown is never rendered as a value.
 *
 * No raw price level or tick count is ever produced, per the
 * price-normalization rule.
 */

import type { OHLCVBar } from '@shared/ohlcv';

export const Z_CLIP = 5.0;
export const DEFAULT_Z_WINDOW = 100;

export const FEATURE_NAMES = [
  'body_norm',
  'upper_norm',
  'lower_norm',
  'range_z',
  'return_z',
  'volume_z',
] as const;
export type FeatureName = (typeof FEATURE_NAMES)[number];

export interface CandleGeometryRow {
  timestamp: number;
  open_norm: number;
  close_norm: number;
  body_norm: number;
  upper_norm: number;
  lower_norm: number;
  range_z: number | null;
  body_z: number | null;
  wick_z: number | null;
  return_z: number | null;
  volume_z: number | null;
}

/**
 * Causal trailing rolling z-score. The window ENDS at the current bar and
 * includes it, so no future information enters. Returns null for warmup rows
 * and for windows with zero variance (the Python's 0/0 -> NaN).
 */
function causalZ(
  x: readonly (number | null)[],
  window: number,
): (number | null)[] {
  const out: (number | null)[] = new Array(x.length).fill(null);
  if (window < 1) return out;

  for (let i = window - 1; i < x.length; i++) {
    let sum = 0;
    let sumSq = 0;
    let complete = true;
    for (let k = i - window + 1; k <= i; k++) {
      const v = x[k];
      if (v == null || !Number.isFinite(v)) {
        complete = false;
        break;
      }
      sum += v;
      sumSq += v * v;
    }
    if (!complete) continue;

    const cur = x[i]!;
    const mean = sum / window;
    // Population variance (ddof=0), floored at 0 against fp drift.
    const variance = Math.max(sumSq / window - mean * mean, 0);
    const sd = Math.sqrt(variance);
    if (sd === 0) continue; // 0/0 — genuinely undefined, stays null.

    const z = (cur - mean) / sd;
    out[i] = Math.max(-Z_CLIP, Math.min(Z_CLIP, z));
  }
  return out;
}

export function computeCandleGeometry(
  bars: readonly OHLCVBar[],
  window: number = DEFAULT_Z_WINDOW,
): CandleGeometryRow[] {
  const sorted = [...bars].sort((a, b) => a.timestamp - b.timestamp);
  const n = sorted.length;
  if (n === 0) return [];

  const openNorm = new Array<number>(n);
  const closeNorm = new Array<number>(n);
  const bodyNorm = new Array<number>(n);
  const upperNorm = new Array<number>(n);
  const lowerNorm = new Array<number>(n);
  const wickAsym = new Array<number>(n);
  const ranges = new Array<number>(n);

  for (let i = 0; i < n; i++) {
    const b = sorted[i]!;
    const rng = b.high - b.low;
    ranges[i] = rng;
    if (rng > 0) {
      openNorm[i] = (b.open - b.low) / rng;
      closeNorm[i] = (b.close - b.low) / rng;
      bodyNorm[i] = (b.close - b.open) / rng;
      upperNorm[i] = (b.high - Math.max(b.open, b.close)) / rng;
      lowerNorm[i] = (Math.min(b.open, b.close) - b.low) / rng;
    } else {
      openNorm[i] = 0.5;
      closeNorm[i] = 0.5;
      bodyNorm[i] = 0;
      upperNorm[i] = 0;
      lowerNorm[i] = 0;
    }
    wickAsym[i] = upperNorm[i]! - lowerNorm[i]!;
  }

  // Floor range and volume at their smallest positive value (the instrument
  // tick / one lot) so log is always defined — the Python's eps_r.
  let epsRange = Infinity;
  for (const r of ranges) if (r > 0 && r < epsRange) epsRange = r;
  if (!Number.isFinite(epsRange)) epsRange = 1;

  const logRange = ranges.map((r) => Math.log(Math.max(r, epsRange)));
  const logVol = sorted.map((b) => Math.log(Math.max(b.volume ?? 1, 1)));
  const ret: (number | null)[] = sorted.map((b, i) =>
    i === 0 ? null : Math.log(b.close / sorted[i - 1]!.close),
  );

  const rangeZ = causalZ(logRange, window);
  const bodyZ = causalZ(bodyNorm, window);
  const wickZ = causalZ(wickAsym, window);
  const returnZ = causalZ(ret, window);
  const volumeZ = causalZ(logVol, window);

  return sorted.map((b, i) => ({
    timestamp: b.timestamp,
    open_norm: openNorm[i]!,
    close_norm: closeNorm[i]!,
    body_norm: bodyNorm[i]!,
    upper_norm: upperNorm[i]!,
    lower_norm: lowerNorm[i]!,
    range_z: rangeZ[i]!,
    body_z: bodyZ[i]!,
    wick_z: wickZ[i]!,
    return_z: returnZ[i]!,
    volume_z: volumeZ[i]!,
  }));
}

export interface FeatureRow {
  timestamp: number;
  values: number[];
}

export interface FeatureMatrix {
  columns: readonly string[];
  rows: FeatureRow[];
  /** Bars dropped because a feature was still in warmup. Disclosed in the UI. */
  warmup: number;
}

/**
 * Dense matrix of complete rows only. A row with any null feature is DROPPED,
 * never zero-filled — imputing a zero would put a fabricated point into a real
 * clustering. `warmup` is surfaced so the UI can say how many bars were held back.
 */
export function toFeatureMatrix(
  rows: readonly CandleGeometryRow[],
  columns: readonly string[] = FEATURE_NAMES,
): FeatureMatrix {
  const out: FeatureRow[] = [];
  for (const r of rows) {
    const rec = r as unknown as Record<string, number | null>;
    const values = columns.map((c) => rec[c]);
    if (values.some((v) => v == null || !Number.isFinite(v))) continue;
    out.push({ timestamp: r.timestamp, values: values as number[] });
  }
  return { columns, rows: out, warmup: rows.length - out.length };
}

/**
 * Trailing-window stability: does the model still work in the second half of
 * the record, or was the headline number earned in one early stretch?
 *
 * Both windows are strictly trailing and require a FULL window — a point at row
 * t uses rows (t - window, t] and nothing else, and rows before the first full
 * window carry no point at all rather than a point computed on fewer rows.
 *
 * The null band is what a coin flip would produce: with overlapping labels the
 * window of W rows only holds floor(W / horizon) independent outcomes, so the
 * band is 0.5 +/- 1.96 * sqrt(0.25 / that number). A rolling hit rate that
 * never leaves the band is a model that never distinguished itself from chance.
 */

import { bucketLastIndices } from "./downsample";
import { pageHinkleyDrift } from "./drift";
import { NORMAL_95, clipProbability } from "./stats";
import type { LensRowRange } from "./series";
import { readLabel } from "./series";
import type {
  LensEvaluationParams,
  LensRolling,
  LensRollingPoint,
  LensRollingTradePoint,
  LensSeries,
  LensTrade,
} from "./types";

export const LENS_MAX_ROLLING_POINTS = 2000;

export function computeRolling(
  series: LensSeries,
  params: LensEvaluationParams,
  range: LensRowRange,
  trades: LensTrade[],
): LensRolling {
  const count = Math.max(0, range.barCount);
  // min_periods == window: a window longer than the record produces no point at
  // all, rather than a point quietly computed on fewer rows than it claims.
  const window = Math.max(1, Math.floor(params.rollingWindowBars));
  const horizon = Math.max(1, series.horizonBars);

  // Prefix sums so every window is O(1).
  const labelledPrefix = new Float64Array(count + 1);
  const hitPrefix = new Float64Array(count + 1);
  const brierPrefix = new Float64Array(count + 1);
  const logLossPrefix = new Float64Array(count + 1);
  for (let offset = 0; offset < count; offset += 1) {
    const row = range.firstRowIndex + offset;
    const label = readLabel(series, row);
    let labelled = 0;
    let hit = 0;
    let brier = 0;
    let logLoss = 0;
    if (label !== null) {
      const probability = series.probabilityUp[row] as number;
      labelled = 1;
      hit = (probability >= 0.5) === (label === 1) ? 1 : 0;
      const error = probability - label;
      brier = error * error;
      const clipped = clipProbability(probability);
      logLoss = label === 1 ? -Math.log(clipped) : -Math.log(1 - clipped);
    }
    labelledPrefix[offset + 1] = (labelledPrefix[offset] as number) + labelled;
    hitPrefix[offset + 1] = (hitPrefix[offset] as number) + hit;
    brierPrefix[offset + 1] = (brierPrefix[offset] as number) + brier;
    logLossPrefix[offset + 1] = (logLossPrefix[offset] as number) + logLoss;
  }

  const firstOffset = window - 1;
  const rawPointCount = count >= window ? count - firstOffset : 0;
  const keep = bucketLastIndices(rawPointCount, LENS_MAX_ROLLING_POINTS);
  const points: LensRollingPoint[] = [];
  for (let k = 0; k < keep.length; k += 1) {
    const offset = firstOffset + (keep[k] as number);
    const row = range.firstRowIndex + offset;
    const start = offset - window + 1;
    const labelled = (labelledPrefix[offset + 1] as number) - (labelledPrefix[start] as number);
    points.push({
      timestampSeconds: series.timestampSeconds[row] as number,
      rowIndex: row,
      hitRate: labelled > 0 ? ((hitPrefix[offset + 1] as number) - (hitPrefix[start] as number)) / labelled : null,
      brierScore: labelled > 0 ? ((brierPrefix[offset + 1] as number) - (brierPrefix[start] as number)) / labelled : null,
      logLoss: labelled > 0 ? ((logLossPrefix[offset + 1] as number) - (logLossPrefix[start] as number)) / labelled : null,
      labelledCount: labelled,
    });
  }

  // The coin-flip band is sized on the LABELLED rows a window holds, not its
  // bar count: unlabelled bars (session gaps, the horizon's tail) score nothing,
  // and a band drawn on the bar count is narrower than the noise it claims to show.
  const labelledCounts = points.map((point) => point.labelledCount).sort((a, b) => a - b);
  const typicalLabelled = labelledCounts.length > 0 ? (labelledCounts[Math.floor(labelledCounts.length / 2)] as number) : window;
  const effectiveSampleSizePerWindow = typicalLabelled / horizon;
  const independentOutcomes = Math.max(1, Math.floor(effectiveSampleSizePerWindow));
  const half = NORMAL_95 * Math.sqrt(0.25 / independentOutcomes);

  const tradePoints = computeTradePoints(trades, params.rollingWindowTrades);

  return {
    windowBars: window,
    windowTrades: params.rollingWindowTrades,
    effectiveSampleSizePerWindow,
    nullBand: { lower: 0.5 - half, upper: 0.5 + half },
    points,
    tradePoints,
    drift: pageHinkleyDrift(trades),
    downsampled: keep.length < rawPointCount,
  };
}

function computeTradePoints(trades: LensTrade[], windowTrades: number): LensRollingTradePoint[] {
  const count = trades.length;
  const window = Math.max(1, Math.floor(windowTrades));
  if (count < window) return [];

  const netPrefix = new Float64Array(count + 1);
  const squarePrefix = new Float64Array(count + 1);
  const winPrefix = new Float64Array(count + 1);
  for (let i = 0; i < count; i += 1) {
    const net = (trades[i] as LensTrade).netUsd;
    netPrefix[i + 1] = (netPrefix[i] as number) + net;
    squarePrefix[i + 1] = (squarePrefix[i] as number) + net * net;
    winPrefix[i + 1] = (winPrefix[i] as number) + (net > 0 ? 1 : 0);
  }

  const rawPointCount = count - window + 1;
  const keep = bucketLastIndices(rawPointCount, LENS_MAX_ROLLING_POINTS);
  const points: LensRollingTradePoint[] = [];
  for (let k = 0; k < keep.length; k += 1) {
    const index = window - 1 + (keep[k] as number);
    const start = index - window + 1;
    const sum = (netPrefix[index + 1] as number) - (netPrefix[start] as number);
    const sumSquares = (squarePrefix[index + 1] as number) - (squarePrefix[start] as number);
    const wins = (winPrefix[index + 1] as number) - (winPrefix[start] as number);
    const average = sum / window;
    const variance = window > 1 ? Math.max(0, (sumSquares - window * average * average) / (window - 1)) : 0;
    const deviation = Math.sqrt(variance);
    points.push({
      timestampSeconds: (trades[index] as LensTrade).exitTimestampSeconds,
      tradeIndex: index,
      meanNetUsd: average,
      winRate: wins / window,
      sharpe: deviation > 0 ? average / deviation : null,
    });
  }
  return points;
}

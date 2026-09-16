/**
 * Trade simulation — the exact semantics of the model's own evaluator
 * (src/ml/xgb_classifier/eval.py :: simulate_pnl, lines 157-266).
 *
 * Walking the evaluated range one row at a time:
 *   - a row inside an open trade is skipped (`i < lastExit`), so trades never
 *     overlap. The exit row itself is NOT skipped: a new trade may open on the
 *     bar the previous one closes;
 *   - direction is +1 when probability_up >= threshold, -1 when it is
 *     <= 1 - threshold, and no trade otherwise;
 *   - entry is the close of row i, exit the close of row i + horizon, both in
 *     the model's own row order (H rows later, not H wall-clock bars);
 *   - the full round trip is charged once, at entry.
 *
 * Trades carry no regime here — regime.ts stamps the entry regime afterwards,
 * so this stays a pure function of prices, probabilities and cost.
 */

import type { LensRowRange } from "./series";
import type { LensEvaluationParams, LensSeries, LensTrade } from "./types";

export interface LensSimulation {
  trades: LensTrade[];
  longCount: number;
  shortCount: number;
}

export function tradeCostUsd(series: LensSeries, params: LensEvaluationParams): number {
  const roundTripPoints = Math.max(0, series.cost.roundTripPoints);
  return roundTripPoints * series.cost.pointValueUsd * params.costMultiplier;
}

export function simulateTrades(
  series: LensSeries,
  params: LensEvaluationParams,
  range: LensRowRange,
): LensSimulation {
  const trades: LensTrade[] = [];
  let longCount = 0;
  let shortCount = 0;
  const horizon = series.horizonBars;
  if (range.barCount <= horizon || horizon <= 0) return { trades, longCount, shortCount };

  const close = series.close;
  const probability = series.probabilityUp;
  const timestamps = series.timestampSeconds;
  const pointValue = series.cost.pointValueUsd;
  const cost = tradeCostUsd(series, params);
  const threshold = params.threshold;
  const shortThreshold = 1 - threshold;

  let lastExit = -1;
  let cumulative = 0;
  const lastEntryOffset = range.barCount - horizon; // exclusive

  for (let offset = 0; offset < lastEntryOffset; offset += 1) {
    if (offset < lastExit) continue;
    const entryRowIndex = range.firstRowIndex + offset;
    const probabilityUp = probability[entryRowIndex] as number;
    let direction: 1 | -1;
    if (probabilityUp >= threshold) direction = 1;
    else if (probabilityUp <= shortThreshold) direction = -1;
    else continue;

    const exitRowIndex = entryRowIndex + horizon;
    const entryPrice = close[entryRowIndex] as number;
    const exitPrice = close[exitRowIndex] as number;
    const grossUsd = (exitPrice - entryPrice) * direction * pointValue;
    const netUsd = grossUsd - cost;
    cumulative += netUsd;

    trades.push({
      entryRowIndex,
      exitRowIndex,
      entryTimestampSeconds: timestamps[entryRowIndex] as number,
      exitTimestampSeconds: timestamps[exitRowIndex] as number,
      direction,
      entryPrice,
      exitPrice,
      probabilityUp,
      grossUsd,
      netUsd,
      cumulativeNetUsd: cumulative,
      regime: null,
    });
    if (direction === 1) longCount += 1;
    else shortCount += 1;
    lastExit = offset + horizon;
  }

  return { trades, longCount, shortCount };
}

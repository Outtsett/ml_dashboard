/**
 * Causal bull / bear / sideways classification.
 *
 * At row t the rule looks back exactly N rows and nothing else:
 *   move       r   = ln(close[t] / close[t-N])
 *   volatility v   = sample standard deviation of the N one-row log returns
 *                    ln(close[s] / close[s-1]) for s in (t-N, t]
 *   bull  when r >  k * v * sqrt(N)
 *   bear  when r < -k * v * sqrt(N)
 *   sideways otherwise
 * The sqrt(N) scales a one-row volatility up to the N-row horizon the move is
 * measured over, so k is read in units of "trailing sigma over the lookback".
 * Rows before t = N have no lookback and stay null — never sideways by default.
 */

import { blockBootstrap, BOOTSTRAP_RESAMPLE_COUNT } from "./bootstrap";
import { emptyEstimate, mean, proportionEstimate } from "./stats";
import type { LensRowRange } from "./series";
import { readLabel } from "./series";
import {
  type LensRegime,
  type LensRegimePerformance,
  type LensRegimeSegment,
  type LensSeries,
  type LensTrade,
} from "./types";

export const LENS_REGIME_ORDER: readonly LensRegime[] = ["bull", "bear", "sideways"];

export function regimeDefinition(lookbackBars: number, threshold: number): string {
  return (
    `At each row the classifier looks back ${lookbackBars} rows: it measures the log move ` +
    `ln(close now / close ${lookbackBars} rows ago) and the sample standard deviation of the ` +
    `${lookbackBars} one-row log returns inside that window. The row is bull when the move is ` +
    `greater than ${threshold} times that volatility scaled by the square root of ${lookbackBars}, ` +
    `bear when it is below minus the same amount, and sideways in between. The first ` +
    `${lookbackBars} rows have no lookback and carry no regime.`
  );
}

/**
 * One regime per row (null during warmup). `close` is the whole record, so a
 * windowed evaluation still sees the rows before its own start.
 */
export function classifyRegimes(
  close: Float64Array,
  lookbackBars: number,
  threshold: number,
): Array<LensRegime | null> {
  const length = close.length;
  const regimes: Array<LensRegime | null> = new Array<LensRegime | null>(length).fill(null);
  const lookback = Math.max(1, Math.floor(lookbackBars));
  if (length <= lookback) return regimes;

  // Rolling sum and sum-of-squares of the one-row log returns.
  const logReturn = new Float64Array(length);
  for (let i = 1; i < length; i += 1) {
    const previous = close[i - 1] as number;
    const current = close[i] as number;
    logReturn[i] = previous > 0 && current > 0 ? Math.log(current / previous) : 0;
  }

  let sum = 0;
  let sumSquares = 0;
  for (let i = 1; i <= lookback; i += 1) {
    const value = logReturn[i] as number;
    sum += value;
    sumSquares += value * value;
  }

  const scale = Math.sqrt(lookback);
  for (let t = lookback; t < length; t += 1) {
    if (t > lookback) {
      const entering = logReturn[t] as number;
      const leaving = logReturn[t - lookback] as number;
      sum += entering - leaving;
      sumSquares += entering * entering - leaving * leaving;
    }
    const average = sum / lookback;
    const variance = lookback > 1 ? Math.max(0, (sumSquares - lookback * average * average) / (lookback - 1)) : 0;
    const volatility = Math.sqrt(variance);
    const start = close[t - lookback] as number;
    const end = close[t] as number;
    const move = start > 0 && end > 0 ? Math.log(end / start) : 0;
    const band = threshold * volatility * scale;
    if (move > band) regimes[t] = "bull";
    else if (move < -band) regimes[t] = "bear";
    else regimes[t] = "sideways";
  }
  return regimes;
}

/** Run-length encoding of the regime array over an inclusive row range. */
export function regimeSegments(
  series: LensSeries,
  regimes: Array<LensRegime | null>,
  range: LensRowRange,
): LensRegimeSegment[] {
  const segments: LensRegimeSegment[] = [];
  if (range.barCount <= 0) return segments;
  let startRowIndex = range.firstRowIndex;
  let current = regimes[range.firstRowIndex] ?? null;
  for (let row = range.firstRowIndex + 1; row <= range.lastRowIndex; row += 1) {
    const value = regimes[row] ?? null;
    if (value !== current) {
      segments.push({
        startRowIndex,
        endRowIndex: row - 1,
        startTimestampSeconds: series.timestampSeconds[startRowIndex] as number,
        endTimestampSeconds: series.timestampSeconds[row - 1] as number,
        regime: current,
      });
      startRowIndex = row;
      current = value;
    }
  }
  segments.push({
    startRowIndex,
    endRowIndex: range.lastRowIndex,
    startTimestampSeconds: series.timestampSeconds[startRowIndex] as number,
    endTimestampSeconds: series.timestampSeconds[range.lastRowIndex] as number,
    regime: current,
  });
  return coarsenSegments(segments);
}

/** True when this record has more runs than one response lists. */
export function regimeRunsWereCoarsened(
  series: LensSeries,
  regimes: Array<LensRegime | null>,
  range: LensRowRange,
): boolean {
  let runs = range.barCount > 0 ? 1 : 0;
  for (let row = range.firstRowIndex + 1; row <= range.lastRowIndex; row += 1) {
    if ((regimes[row] ?? null) !== (regimes[row - 1] ?? null)) runs += 1;
  }
  return runs > MAX_REGIME_SEGMENTS;
}

/** Most segments any one response carries; beyond this the list is coarsened. */
export const MAX_REGIME_SEGMENTS = 2000;

/**
 * Fold the shortest runs into their predecessor until the list fits.
 *
 * A 1-minute record of half a million bars produces tens of thousands of runs
 * (5 MB of JSON, most of them a handful of bars long). The price chart paints
 * its ribbon from each bar's own regime, and the share and per-regime
 * performance are computed over every row, so nothing downstream needs the
 * complete run list — only a legible overview of where the regimes sat.
 */
function coarsenSegments(segments: LensRegimeSegment[]): LensRegimeSegment[] {
  if (segments.length <= MAX_REGIME_SEGMENTS) return segments;
  // The cut is the length of the (n - cap)th shortest run: every run at least
  // that long survives, which is at most `cap` of them.
  const lengths = segments.map((s) => s.endRowIndex - s.startRowIndex + 1).sort((a, b) => a - b);
  const minimumRun = Math.max(2, lengths[lengths.length - MAX_REGIME_SEGMENTS] ?? 2);
  const coarse: LensRegimeSegment[] = [];
  for (const segment of segments) {
    const length = segment.endRowIndex - segment.startRowIndex + 1;
    const previous = coarse[coarse.length - 1];
    if (previous && (length < minimumRun || segment.regime === previous.regime)) {
      previous.endRowIndex = segment.endRowIndex;
      previous.endTimestampSeconds = segment.endTimestampSeconds;
      continue;
    }
    coarse.push({ ...segment });
  }
  return coarse;
}

/** Share of rows in the range carrying each regime. Warmup rows lower all three. */
export function regimeShare(regimes: Array<LensRegime | null>, range: LensRowRange): Record<LensRegime, number> {
  const share: Record<LensRegime, number> = { bull: 0, bear: 0, sideways: 0 };
  if (range.barCount <= 0) return share;
  for (let row = range.firstRowIndex; row <= range.lastRowIndex; row += 1) {
    const value = regimes[row];
    if (value) share[value] += 1;
  }
  for (const regime of LENS_REGIME_ORDER) share[regime] /= range.barCount;
  return share;
}

/** Performance per regime: prediction rows by their own regime, trades by their ENTRY regime. */
export function regimePerformance(
  series: LensSeries,
  regimes: Array<LensRegime | null>,
  range: LensRowRange,
  trades: LensTrade[],
): LensRegimePerformance[] {
  const horizon = series.horizonBars;
  return LENS_REGIME_ORDER.map((regime) => {
    let barCount = 0;
    let labelled = 0;
    let hits = 0;
    for (let row = range.firstRowIndex; row <= range.lastRowIndex; row += 1) {
      if (regimes[row] !== regime) continue;
      barCount += 1;
      const label = readLabel(series, row);
      if (label === null) continue;
      labelled += 1;
      const predictedUp = (series.probabilityUp[row] as number) >= 0.5;
      if (predictedUp === (label === 1)) hits += 1;
    }

    const netValues: number[] = [];
    for (const trade of trades) {
      if (trade.regime === regime) netValues.push(trade.netUsd);
    }
    let winSum = 0;
    let lossSum = 0;
    let total = 0;
    for (const net of netValues) {
      total += net;
      if (net > 0) winSum += net;
      else if (net < 0) lossSum += -net;
    }

    // Same moving-block bootstrap as the headline, over this regime's trades
    // only — a regime with eleven trades must say so through a wide interval,
    // not through a confident-looking point estimate.
    const bootstrap = blockBootstrap(netValues.length, {
      meanNetUsd: (indices) => {
        let sum = 0;
        for (let i = 0; i < indices.length; i += 1) sum += netValues[indices[i] as number] as number;
        return sum / indices.length;
      },
    });
    const meanTradeNetUsd =
      netValues.length === 0
        ? emptyEstimate("no trade was entered in this regime")
        : {
            value: mean(netValues),
            ciLow: bootstrap.statistics.meanNetUsd?.ciLow ?? null,
            ciHigh: bootstrap.statistics.meanNetUsd?.ciHigh ?? null,
            n: netValues.length,
            method: `moving-block bootstrap, ${BOOTSTRAP_RESAMPLE_COUNT} resamples, block length ${bootstrap.blockLength} trades`,
          };

    return {
      regime,
      barCount,
      tradeCount: netValues.length,
      hitRate: proportionEstimate(hits, labelled, horizon),
      meanTradeNetUsd,
      profitFactor: lossSum > 0 ? winSum / lossSum : null,
      totalNetUsd: total,
    };
  });
}

/** Stamp each trade with the regime that held at its entry row. */
export function stampTradeRegimes(trades: LensTrade[], regimes: Array<LensRegime | null>): void {
  for (const trade of trades) {
    trade.regime = regimes[trade.entryRowIndex] ?? null;
  }
}

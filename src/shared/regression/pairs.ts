/**
 * Turn a bar series and one variable into the (x, y) pairs a panel regresses.
 *
 * A pair is dropped — never filled — when either side is missing or not a
 * finite number, so an indicator's warm-up bars and a lake column's gaps
 * simply are not in the fit. Pairs stay in bar (time) order, which the
 * autocorrelation statistics in fit.ts depend on.
 *
 * Given bar timestamps, a pair that spans k bars is kept only when those bars
 * cover at most k bar-lengths plus GAP_ALLOWANCE_MILLISECONDS of clock time:
 * enough for a weekend and a holiday, not for a hole in the data (MNQ one-minute
 * bars stop on 2025-12-30 and resume on 2026-03-02).
 */

import type { PairOptions, RegressionPairs } from "./types";

/** Basis points per unit of log return. */
export const BASIS_POINTS = 10_000;

/** Clock time a span may exceed its bar count by: a long weekend plus a holiday. */
export const GAP_ALLOWANCE_MILLISECONDS = 4 * 24 * 60 * 60 * 1000;

export function buildPairs(
  close: ArrayLike<number>,
  variable: ArrayLike<number | null>,
  options: PairOptions,
): RegressionPairs {
  const count = Math.min(close.length, variable.length);
  const x: number[] = [];
  const y: number[] = [];
  const barIndex: number[] = [];

  const usable = (value: number | null | undefined): value is number =>
    value !== null && value !== undefined && Number.isFinite(value);

  const times = options.timestampsMilliseconds;
  const barLength = options.barMilliseconds;
  let skippedAcrossGaps = 0;
  const contiguous = (from: number, to: number): boolean => {
    if (!times || !barLength) return true;
    const elapsed = (times[to] as number) - (times[from] as number);
    if (elapsed <= (to - from) * barLength + GAP_ALLOWANCE_MILLISECONDS) return true;
    skippedAcrossGaps += 1;
    return false;
  };

  if (options.mode === "level") {
    for (let index = 0; index < count; index += 1) {
      const response = close[index];
      const predictor = variable[index];
      if (!usable(response) || !usable(predictor)) continue;
      x.push(predictor);
      y.push(response);
      barIndex.push(index);
    }
  } else if (options.mode === "difference") {
    for (let index = 1; index < count; index += 1) {
      const response = close[index];
      const previousResponse = close[index - 1];
      const predictor = variable[index];
      const previousPredictor = variable[index - 1];
      if (!usable(response) || !usable(previousResponse) || !usable(predictor) || !usable(previousPredictor)) continue;
      if (!contiguous(index - 1, index)) continue;
      x.push(predictor - previousPredictor);
      y.push(response - previousResponse);
      barIndex.push(index);
    }
  } else {
    const horizon = Math.max(1, Math.floor(options.horizonBars));
    for (let index = 0; index + horizon < count; index += 1) {
      const now = close[index];
      const later = close[index + horizon];
      const predictor = variable[index];
      if (!usable(now) || !usable(later) || !usable(predictor) || !(now > 0) || !(later > 0)) continue;
      if (!contiguous(index, index + horizon)) continue;
      x.push(predictor);
      y.push(BASIS_POINTS * Math.log(later / now));
      barIndex.push(index);
    }
  }

  return {
    x: Float64Array.from(x),
    y: Float64Array.from(y),
    barIndex: Int32Array.from(barIndex),
    skippedAcrossGaps,
  };
}

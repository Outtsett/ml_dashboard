/**
 * Page-Hinkley test on the trade-by-trade net PnL, tuned to detect
 * DETERIORATION — a downward shift in the mean.
 *
 *   m_T = sum over trades of (x_i - runningMean_i + delta)
 *   M_T = the largest m seen so far
 *   PH_T = M_T - m_T          (how far below its own high-water mark the
 *                              cumulative sum has fallen)
 * An alarm fires when PH_T exceeds lambda, and the detector then resets, so a
 * long losing run raises repeated alarms instead of one permanent flag.
 *
 * delta and lambda are scaled by the standard deviation of the trade PnL, so
 * the same settings work for a $2 scalper and a $2,000 swing model:
 *   delta  = 0.005 * sigma   (the shift size treated as noise)
 *   lambda = 50    * sigma   (the evidence required before calling it)
 *
 * The alarm is stamped with the trade's EXIT timestamp, because that is when
 * its PnL first became known.
 */

import { standardDeviation } from "./stats";
import type { LensDriftAlarm, LensTrade } from "./types";

export const PAGE_HINKLEY_DELTA_MULTIPLE = 0.005;
export const PAGE_HINKLEY_LAMBDA_MULTIPLE = 50;

export interface LensDrift {
  method: string;
  delta: number;
  lambda: number;
  alarms: LensDriftAlarm[];
}

export function pageHinkleyDrift(trades: LensTrade[]): LensDrift {
  const values = trades.map((trade) => trade.netUsd);
  const sigma = standardDeviation(values);
  const method =
    "Page-Hinkley on trade net profit and loss, detecting deterioration; " +
    `delta = ${PAGE_HINKLEY_DELTA_MULTIPLE} and lambda = ${PAGE_HINKLEY_LAMBDA_MULTIPLE} ` +
    "times the standard deviation of trade net profit and loss, reset after each alarm";

  if (sigma === null || sigma <= 0 || values.length < 2) {
    return { method, delta: 0, lambda: 0, alarms: [] };
  }
  const delta = PAGE_HINKLEY_DELTA_MULTIPLE * sigma;
  const lambda = PAGE_HINKLEY_LAMBDA_MULTIPLE * sigma;
  const alarms: LensDriftAlarm[] = [];

  let count = 0;
  let runningMean = 0;
  let cumulative = 0;
  let highWaterMark = 0;

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] as number;
    count += 1;
    runningMean += (value - runningMean) / count;
    cumulative += value - runningMean + delta;
    if (cumulative > highWaterMark) highWaterMark = cumulative;
    const statistic = highWaterMark - cumulative;
    if (statistic > lambda) {
      const trade = trades[index] as LensTrade;
      alarms.push({
        timestampSeconds: trade.exitTimestampSeconds,
        tradeIndex: index,
        statistic,
        direction: "deterioration",
      });
      count = 0;
      runningMean = 0;
      cumulative = 0;
      highWaterMark = 0;
    }
  }
  return { method, delta, lambda, alarms };
}

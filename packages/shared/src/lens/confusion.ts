/**
 * Direction confusion, on two different row sets, plus the sentence that
 * explains why the win rate is a smaller number than the precision.
 *
 *   allRows   — every labelled row, called up when probability_up >= 0.5.
 *               This is what "the model is right 54% of the time" means.
 *   gatedRows — only the rows whose conviction cleared the threshold
 *               (up when probability_up >= t, down when <= 1 - t). These are
 *               the rows the strategy would have acted on.
 *
 * Neither is the win rate. Precision counts agreement with the LABEL on every
 * qualifying row, overlapping rows included and costs ignored. The win rate
 * counts net-of-cost dollars on the non-overlapping trades actually taken, one
 * at a time, each held a fixed horizon. A model can be right more often than it
 * is wrong and still lose money, because the round trip is charged on every
 * trade and the wins do not have to be as large as the losses.
 */

import { proportionEstimate } from "./stats";
import type { LensRowRange } from "./series";
import { readLabel } from "./series";
import type {
  LensConfusion,
  LensConfusionBlock,
  LensEstimate,
  LensEvaluationParams,
  LensSeries,
} from "./types";

function emptyBlock(): LensConfusionBlock {
  return {
    counts: { truePositive: 0, falsePositive: 0, trueNegative: 0, falseNegative: 0 },
    n: 0,
    precisionUp: null,
    recallUp: null,
    precisionDown: null,
    recallDown: null,
    accuracy: { value: null, ciLow: null, ciHigh: null, n: 0, method: "no labelled rows" },
  };
}

function finishBlock(
  truePositive: number,
  falsePositive: number,
  trueNegative: number,
  falseNegative: number,
  horizonBars: number,
): LensConfusionBlock {
  const n = truePositive + falsePositive + trueNegative + falseNegative;
  if (n === 0) return emptyBlock();
  const predictedUp = truePositive + falsePositive;
  const predictedDown = trueNegative + falseNegative;
  const actualUp = truePositive + falseNegative;
  const actualDown = trueNegative + falsePositive;
  return {
    counts: { truePositive, falsePositive, trueNegative, falseNegative },
    n,
    precisionUp: predictedUp > 0 ? truePositive / predictedUp : null,
    recallUp: actualUp > 0 ? truePositive / actualUp : null,
    precisionDown: predictedDown > 0 ? trueNegative / predictedDown : null,
    recallDown: actualDown > 0 ? trueNegative / actualDown : null,
    accuracy: proportionEstimate(truePositive + trueNegative, n, horizonBars),
  };
}

export function computeConfusion(
  series: LensSeries,
  params: LensEvaluationParams,
  range: LensRowRange,
  winRate: LensEstimate,
  tradeCount: number,
  totalNetUsd: number,
): LensConfusion {
  const horizon = series.horizonBars;
  const threshold = params.threshold;
  const shortThreshold = 1 - threshold;

  let allTruePositive = 0;
  let allFalsePositive = 0;
  let allTrueNegative = 0;
  let allFalseNegative = 0;
  let gatedTruePositive = 0;
  let gatedFalsePositive = 0;
  let gatedTrueNegative = 0;
  let gatedFalseNegative = 0;

  for (let row = range.firstRowIndex; row <= range.lastRowIndex; row += 1) {
    const label = readLabel(series, row);
    if (label === null) continue;
    const probability = series.probabilityUp[row] as number;
    const up = probability >= 0.5;
    if (up && label === 1) allTruePositive += 1;
    else if (up && label === 0) allFalsePositive += 1;
    else if (!up && label === 0) allTrueNegative += 1;
    else allFalseNegative += 1;

    if (probability >= threshold) {
      if (label === 1) gatedTruePositive += 1;
      else gatedFalsePositive += 1;
    } else if (probability <= shortThreshold) {
      if (label === 0) gatedTrueNegative += 1;
      else gatedFalseNegative += 1;
    }
  }

  const allRows = finishBlock(allTruePositive, allFalsePositive, allTrueNegative, allFalseNegative, horizon);
  const gatedRows = finishBlock(gatedTruePositive, gatedFalsePositive, gatedTrueNegative, gatedFalseNegative, horizon);

  return {
    allRows,
    gatedRows,
    winRate,
    explanation: buildExplanation(series, params, allRows, gatedRows, winRate, tradeCount, totalNetUsd),
  };
}

function formatShare(value: number | null): string {
  return value === null ? "not available" : `${(value * 100).toFixed(1)}%`;
}

function formatUsd(value: number): string {
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

function buildExplanation(
  series: LensSeries,
  params: LensEvaluationParams,
  allRows: LensConfusionBlock,
  gatedRows: LensConfusionBlock,
  winRate: LensEstimate,
  tradeCount: number,
  totalNetUsd: number,
): string {
  const costPerTrade = series.cost.roundTripPoints * series.cost.pointValueUsd * params.costMultiplier;
  return (
    `Precision and win rate count different things, which is why they disagree here. ` +
    `Across all ${allRows.n.toLocaleString()} labelled rows the model calls up whenever probability_up is at ` +
    `least 0.50, and those up calls are right ${formatShare(allRows.precisionUp)} of the time while its down ` +
    `calls are right ${formatShare(allRows.precisionDown)} of the time. Gating to the ` +
    `${gatedRows.n.toLocaleString()} rows whose conviction clears ${params.threshold.toFixed(3)} moves that to ` +
    `${formatShare(gatedRows.precisionUp)} on up calls and ${formatShare(gatedRows.precisionDown)} on down calls. ` +
    `Those numbers score the label on every qualifying row, and consecutive rows share most of the same ` +
    `${series.horizonBars}-row price move, so they overlap heavily and no cost is charged against them. ` +
    `The win rate scores something else: the ${tradeCount.toLocaleString()} trades the one-at-a-time rule actually ` +
    `took, each held exactly ${series.horizonBars} rows, none overlapping, each charged ` +
    `${formatUsd(costPerTrade)} for the round trip. A trade counts as a win only when its net dollars are above ` +
    `zero, so ${formatShare(winRate.value)} of them won, and the record finished at ${formatUsd(totalNetUsd)}. ` +
    `Being right more often than wrong and still losing money is exactly what that gap looks like.`
  );
}

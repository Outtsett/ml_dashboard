/**
 * evaluateLens — the whole record, read once, turned into every view.
 *
 * Nothing here reaches outside the arrays it is handed: no file system, no
 * network, no clock, no DOM. The same LensSeries and the same params always
 * produce the same LensEvaluation, bootstrap intervals included, because the
 * resampler is seeded with a constant.
 *
 * Order matters and is deliberate: regimes are classified over the WHOLE record
 * (so a windowed evaluation still has its lookback), trades are simulated over
 * the evaluated range only, and every trade is then stamped with the regime
 * that held at its entry row.
 */

import { computeAttribution, unavailableAttribution } from "./attribution";
import { blockBootstrap, bootstrapBlockLength, BOOTSTRAP_RESAMPLE_COUNT } from "./bootstrap";
import { computeConfusion } from "./confusion";
import { computeDistribution } from "./distribution";
import { extremeIndices } from "./downsample";
import { isDefaultLensParams } from "./params";
import {
  classifyRegimes,
  regimeDefinition,
  regimePerformance,
  regimeSegments,
  regimeRunsWereCoarsened,
  MAX_REGIME_SEGMENTS,
  regimeShare,
  stampTradeRegimes,
} from "./regime";
import { computeRolling } from "./rolling";
import { computeScatter } from "./scatter";
import { readLabel, resolveRange, type LensRowRange } from "./series";
import { simulateTrades } from "./simulate";
import { computeBarState } from "./state";
import { areaUnderCurve, clipProbability, emptyEstimate, proportionEstimate } from "./stats";
import type {
  LensAttributionSeries,
  LensEquityPoint,
  LensEstimate,
  LensEvaluation,
  LensEvaluationParams,
  LensHeadline,
  LensManifest,
  LensSeries,
  LensTrade,
  LensVerificationCheck,
  LensViewKey,
} from "./types";

export const LENS_MAX_TRADES = 5000;
export const LENS_MAX_EQUITY_POINTS = 3000;

export function evaluateLens(
  series: LensSeries,
  attribution: LensAttributionSeries | null,
  manifest: LensManifest,
  params: LensEvaluationParams,
): LensEvaluation {
  const range = resolveRange(series, params);
  const regimes = classifyRegimes(series.close, params.regimeLookbackBars, params.regimeThreshold);
  const simulation = simulateTrades(series, params, range);
  stampTradeRegimes(simulation.trades, regimes);
  const state = computeBarState(series, params, range, simulation.trades);

  const trades = simulation.trades;
  const tradeCount = trades.length;
  const netValues = new Float64Array(tradeCount);
  let winCount = 0;
  let winSum = 0;
  let lossSum = 0;
  let totalNetUsd = 0;
  for (let i = 0; i < tradeCount; i += 1) {
    const net = (trades[i] as LensTrade).netUsd;
    netValues[i] = net;
    totalNetUsd += net;
    if (net > 0) {
      winCount += 1;
      winSum += net;
    } else if (net < 0) {
      lossSum += -net;
    }
  }

  // All three trade statistics come out of ONE pass over each resample.
  // blockBootstrap evaluates the statistics in insertion order for every
  // resample, so the first entry does the work and the other two read what it
  // left behind — 23,000 trades times 1,000 resamples is not a loop to walk
  // three times.
  let resampleWinShare = 0;
  let resampleProfitFactor: number | null = null;
  let resampleMeanNetUsd = 0;
  const scanResample = (indices: Int32Array): void => {
    let wins = 0;
    let winTotal = 0;
    let lossTotal = 0;
    let total = 0;
    for (let i = 0; i < indices.length; i += 1) {
      const net = netValues[indices[i] as number] as number;
      total += net;
      if (net > 0) {
        wins += 1;
        winTotal += net;
      } else if (net < 0) {
        lossTotal -= net;
      }
    }
    resampleWinShare = wins / indices.length;
    resampleMeanNetUsd = total / indices.length;
    resampleProfitFactor = lossTotal > 0 ? winTotal / lossTotal : null;
  };
  const bootstrap = blockBootstrap(tradeCount, {
    winRate: (indices) => {
      scanResample(indices);
      return resampleWinShare;
    },
    profitFactor: () => resampleProfitFactor,
    meanNetUsd: () => resampleMeanNetUsd,
  });
  const blockLength = tradeCount > 0 ? bootstrap.blockLength : bootstrapBlockLength(0);
  const bootstrapMethod =
    `moving-block bootstrap, ${BOOTSTRAP_RESAMPLE_COUNT} resamples, block length ${blockLength} trades`;

  const winRate: LensEstimate =
    tradeCount === 0
      ? emptyEstimate("no trades taken at this threshold")
      : {
          value: winCount / tradeCount,
          ciLow: bootstrap.statistics.winRate?.ciLow ?? null,
          ciHigh: bootstrap.statistics.winRate?.ciHigh ?? null,
          n: tradeCount,
          method: bootstrapMethod,
        };

  const profitFactorSkipped = bootstrap.statistics.profitFactor?.skippedResamples ?? 0;
  const profitFactor: LensEstimate =
    tradeCount === 0
      ? emptyEstimate("no trades taken at this threshold")
      : {
          value: lossSum > 0 ? winSum / lossSum : null,
          ciLow: bootstrap.statistics.profitFactor?.ciLow ?? null,
          ciHigh: bootstrap.statistics.profitFactor?.ciHigh ?? null,
          n: tradeCount,
          method:
            profitFactorSkipped > 0
              ? `${bootstrapMethod}; ${profitFactorSkipped} resamples contained no losing trade and were excluded`
              : bootstrapMethod,
        };

  const meanTradeNetUsd: LensEstimate =
    tradeCount === 0
      ? emptyEstimate("no trades taken at this threshold")
      : {
          value: totalNetUsd / tradeCount,
          ciLow: bootstrap.statistics.meanNetUsd?.ciLow ?? null,
          ciHigh: bootstrap.statistics.meanNetUsd?.ciHigh ?? null,
          n: tradeCount,
          method: bootstrapMethod,
        };

  const scored = scoreProbabilities(series, range);
  const hitRate = proportionEstimate(
    scored.hits,
    scored.labelled,
    series.horizonBars,
    "normal approximation, effective sample size = labelled rows / horizon (labels overlap)",
  );

  const buyHoldNetUsd =
    state.buyHoldCumulativeUsd && range.barCount > 0
      ? (state.buyHoldCumulativeUsd[range.barCount - 1] as number)
      : null;

  const headline: LensHeadline = {
    barCount: range.barCount,
    effectiveSampleSize: range.barCount / Math.max(1, series.horizonBars),
    tradeCount,
    longCount: simulation.longCount,
    shortCount: simulation.shortCount,
    hitRate,
    winRate,
    profitFactor,
    meanTradeNetUsd,
    totalNetUsd,
    buyHoldNetUsd,
    maxDrawdownUsd: state.maxDrawdownUsd,
    areaUnderCurve: scored.areaUnderCurve,
    brierScore: scored.brierScore,
    exposureShare: state.exposureShare,
    verdict: "",
  };
  headline.verdict = buildVerdict(headline, params);

  const equity = buildEquity(series, range, state);
  const rolling = computeRolling(series, params, range, trades);
  const scatter = computeScatter(series, range);
  const confusion = computeConfusion(series, params, range, winRate, tradeCount, totalNetUsd);
  const distribution = computeDistribution(series, params, range);
  const attributionView = manifest.attribution.available
    ? computeAttribution(series, attribution, manifest, range)
    : unavailableAttribution(manifest.attribution.reason ?? "no attribution artifact for this model");

  const segments = regimeSegments(series, regimes, range);
  const regimesView = {
    lookbackBars: params.regimeLookbackBars,
    threshold: params.regimeThreshold,
    definition:
      regimeDefinition(params.regimeLookbackBars, params.regimeThreshold) +
      (regimeRunsWereCoarsened(series, regimes, range)
        ? ` This record has more runs than the ${MAX_REGIME_SEGMENTS.toLocaleString()} listed here, so the shortest runs are folded into the run before them; the ribbon on the price chart still colours every bar by its own regime, and the shares and per-regime results below count every row.`
        : ""),
    segments,
    share: regimeShare(regimes, range),
    performance: regimePerformance(series, regimes, range, trades),
  };

  const tradesTruncated = tradeCount > LENS_MAX_TRADES;
  const transportedTrades = tradesTruncated
    ? trades.slice(0, LENS_MAX_TRADES / 2).concat(trades.slice(tradeCount - LENS_MAX_TRADES / 2))
    : trades;

  return {
    modelId: series.modelId,
    params,
    range: {
      firstRowIndex: range.firstRowIndex,
      lastRowIndex: range.lastRowIndex,
      firstTimestampSeconds: range.firstTimestampSeconds,
      lastTimestampSeconds: range.lastTimestampSeconds,
      barCount: range.barCount,
    },
    headline,
    trades: transportedTrades,
    tradesTruncated,
    equity: equity.points,
    equityDownsampled: equity.downsampled,
    rolling,
    scatter,
    confusion,
    regimes: regimesView,
    distribution,
    attribution: attributionView,
    availability: buildAvailability({
      manifest,
      range,
      tradeCount,
      rollingPointCount: rolling.points.length,
      scatterPointCount: scatter.points.length,
      labelledRowCount: confusion.allRows.n,
      classifiedRegimeSegmentCount: segments.filter((segment) => segment.regime !== null).length,
      equityPointCount: equity.points.length,
      realizedCount: distribution.realized.count,
      attributionAvailable: attributionView.available,
      attributionReason: attributionView.reason,
    }),
    verification: buildVerification(manifest, params, headline),
  };
}

function scoreProbabilities(
  series: LensSeries,
  range: LensRowRange,
): { labelled: number; hits: number; brierScore: number | null; areaUnderCurve: number | null } {
  let labelled = 0;
  let hits = 0;
  let brierTotal = 0;
  for (let row = range.firstRowIndex; row <= range.lastRowIndex; row += 1) {
    if (readLabel(series, row) !== null) labelled += 1;
  }
  if (labelled === 0) return { labelled: 0, hits: 0, brierScore: null, areaUnderCurve: null };

  const scores = new Float64Array(labelled);
  const positives = new Float64Array(labelled);
  let index = 0;
  for (let row = range.firstRowIndex; row <= range.lastRowIndex; row += 1) {
    const label = readLabel(series, row);
    if (label === null) continue;
    const probability = series.probabilityUp[row] as number;
    scores[index] = probability;
    positives[index] = label;
    index += 1;
    if ((probability >= 0.5) === (label === 1)) hits += 1;
    const error = probability - label;
    brierTotal += error * error;
  }
  return {
    labelled,
    hits,
    brierScore: brierTotal / labelled,
    areaUnderCurve: areaUnderCurve(scores, positives),
  };
}

/** Mean negative log likelihood over labelled rows, probabilities clipped. */
export function logLossOverRange(series: LensSeries, range: LensRowRange): number | null {
  let labelled = 0;
  let total = 0;
  for (let row = range.firstRowIndex; row <= range.lastRowIndex; row += 1) {
    const label = readLabel(series, row);
    if (label === null) continue;
    labelled += 1;
    const clipped = clipProbability(series.probabilityUp[row] as number);
    total += label === 1 ? -Math.log(clipped) : -Math.log(1 - clipped);
  }
  return labelled > 0 ? total / labelled : null;
}

function buildEquity(
  series: LensSeries,
  range: LensRowRange,
  state: ReturnType<typeof computeBarState>,
): { points: LensEquityPoint[]; downsampled: boolean } {
  const count = range.barCount;
  if (count <= 0) return { points: [], downsampled: false };
  const keep = extremeIndices(state.cumulativeNetUsd, LENS_MAX_EQUITY_POINTS);
  const points: LensEquityPoint[] = [];
  for (let k = 0; k < keep.length; k += 1) {
    const offset = keep[k] as number;
    const row = range.firstRowIndex + offset;
    const position = state.position[offset] as number;
    points.push({
      timestampSeconds: series.timestampSeconds[row] as number,
      rowIndex: row,
      modelCumulativeUsd: state.cumulativeNetUsd[offset] as number,
      buyHoldCumulativeUsd: state.buyHoldCumulativeUsd ? (state.buyHoldCumulativeUsd[offset] as number) : null,
      modelDrawdownUsd: state.drawdownUsd[offset] as number,
      position: position === 1 ? 1 : position === -1 ? -1 : 0,
    });
  }
  return { points, downsampled: keep.length < count };
}

function formatUsd(value: number | null): string {
  if (value === null) return "not available";
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

function buildVerdict(headline: LensHeadline, params: LensEvaluationParams): string {
  if (headline.barCount === 0) return "The selected window holds no rows of this model's record.";
  if (headline.tradeCount === 0) {
    return (
      `No row of the ${headline.barCount.toLocaleString()}-bar record reached the ` +
      `${params.threshold.toFixed(3)} conviction threshold, so the strategy never traded.`
    );
  }
  const direction = headline.totalNetUsd > 0 ? "made" : headline.totalNetUsd < 0 ? "lost" : "broke even at";
  const low = headline.meanTradeNetUsd.ciLow;
  const high = headline.meanTradeNetUsd.ciHigh;
  const interval = low === null || high === null ? null : `[${formatUsd(low)}, ${formatUsd(high)}]`;
  const excludesZero = low !== null && high !== null && (low > 0 || high < 0);
  const tail =
    interval === null
      ? "no interval could be formed on the mean profit and loss per trade."
      : excludesZero
        ? `the 95% interval on mean profit and loss per trade ${interval} excludes zero.`
        : `the 95% interval on mean profit and loss per trade ${interval} includes zero, so this record cannot ` +
          "separate the model from no edge at all.";
  return (
    `Over ${headline.tradeCount.toLocaleString()} trades the model ${direction} ` +
    `${formatUsd(Math.abs(headline.totalNetUsd))} net of costs; ${tail}`
  );
}

function buildAvailability(input: {
  manifest: LensManifest;
  range: LensRowRange;
  tradeCount: number;
  rollingPointCount: number;
  scatterPointCount: number;
  labelledRowCount: number;
  classifiedRegimeSegmentCount: number;
  equityPointCount: number;
  realizedCount: number;
  attributionAvailable: boolean;
  attributionReason?: string;
}): Record<LensViewKey, { available: boolean; reason?: string }> {
  const yes = { available: true };
  const no = (reason: string) => ({ available: false, reason });
  return {
    prediction:
      input.manifest.interval.coveredBarCount > 0
        ? yes
        : no("the builder produced no calibrated interval for this model, so there is nothing to draw on price"),
    trades:
      input.tradeCount > 0
        ? yes
        : no("no row cleared the conviction threshold in this window, so no trade was simulated"),
    rolling:
      input.rollingPointCount > 0
        ? yes
        : no("the window is shorter than one full rolling window, so no trailing point can be computed"),
    scatter:
      input.scatterPointCount > 0
        ? yes
        : no("no row in this window has a realised forward return yet"),
    confusion: input.labelledRowCount > 0 ? yes : no("no row in this window carries a direction label"),
    attribution: input.attributionAvailable
      ? yes
      : no(input.attributionReason ?? "no attribution artifact for this model"),
    regime:
      input.classifiedRegimeSegmentCount > 0
        ? yes
        : no("every row in this window is still inside the regime lookback warmup"),
    equity: input.equityPointCount > 0 ? yes : no("the window holds no rows"),
    distribution:
      input.realizedCount > 0 ? yes : no("no row in this window has a realised forward return yet"),
    playback: input.range.barCount > 0 ? yes : no("the window holds no rows"),
  };
}

function buildVerification(
  manifest: LensManifest,
  params: LensEvaluationParams,
  headline: LensHeadline,
): LensVerificationCheck[] {
  if (!isDefaultLensParams(params, manifest)) return [];
  const checks: LensVerificationCheck[] = [];
  const reference = manifest.reference;

  const exact = (name: string, measured: number, expected: number | null, label: string) => {
    if (expected === null) return;
    checks.push({
      name,
      passed: measured === expected,
      measured: `${label} ${measured}`,
      expected: `exactly ${expected} (from the model's own diagnostics.json)`,
    });
  };
  exact("trade_count_matches_model_diagnostics", headline.tradeCount, reference.tradeCount, "simulated");
  exact("long_trade_count_matches_model_diagnostics", headline.longCount, reference.longCount, "simulated");
  exact("short_trade_count_matches_model_diagnostics", headline.shortCount, reference.shortCount, "simulated");

  if (reference.cumulativeNetUsd !== null) {
    const difference = Math.abs(headline.totalNetUsd - reference.cumulativeNetUsd);
    checks.push({
      name: "cumulative_net_usd_matches_model_diagnostics",
      passed: difference <= 0.01,
      measured: `difference ${difference.toFixed(4)} US dollars (simulated ${headline.totalNetUsd.toFixed(2)})`,
      expected: `within 0.01 US dollars of ${reference.cumulativeNetUsd.toFixed(2)}`,
    });
  }
  if (reference.hitRateAtHalf !== null && headline.hitRate.value !== null) {
    const difference = Math.abs(headline.hitRate.value - reference.hitRateAtHalf);
    checks.push({
      name: "hit_rate_at_half_matches_model_diagnostics",
      passed: difference <= 1e-4,
      measured: `difference ${difference.toExponential(2)} (simulated ${headline.hitRate.value.toFixed(6)})`,
      expected: `within 1e-4 of ${reference.hitRateAtHalf.toFixed(6)}`,
    });
  }
  if (reference.areaUnderCurve !== null && headline.areaUnderCurve !== null) {
    const difference = Math.abs(headline.areaUnderCurve - reference.areaUnderCurve);
    checks.push({
      name: "area_under_curve_matches_model_diagnostics",
      passed: difference <= 1e-4,
      measured: `difference ${difference.toExponential(2)} (computed ${headline.areaUnderCurve.toFixed(6)})`,
      expected: `within 1e-4 of ${reference.areaUnderCurve.toFixed(6)}`,
    });
  }
  return checks;
}

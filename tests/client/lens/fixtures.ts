/**
 * Minimal, type-complete Model Lens fixtures for client tests. Every field is
 * present so a fixture never masks a missing-field bug the real server would
 * expose.
 */

import type {
  LensBar,
  LensBarWindow,
  LensEquityPoint,
  LensEstimate,
  LensEvaluationParams,
  LensHeadline,
  LensManifest,
  LensRegimes,
  LensTrade,
} from "@shared/lens/types";

export function makeParams(overrides: Partial<LensEvaluationParams> = {}): LensEvaluationParams {
  return {
    threshold: 0.55,
    costMultiplier: 1,
    rollingWindowBars: 100,
    rollingWindowTrades: 30,
    regimeLookbackBars: 50,
    regimeThreshold: 1,
    intervalCoverage: 0.9,
    ...overrides,
  };
}

export function makeManifest(overrides: Partial<LensManifest> = {}): LensManifest {
  return {
    modelId: "xgb_baseline_post",
    builderVersion: 1,
    builtAtIso: "2026-09-15T00:00:00.000Z",
    sourceSchema: "probability_parquet",
    sourceFiles: [],
    symbol: "MNQ",
    timeframe: "1m",
    barSeconds: 60,
    horizonBars: 5,
    horizonSource: "checkpoint.json params.label_horizon_bars",
    labelDefinition: "close[t+5] > close[t]",
    defaultThreshold: 0.55,
    cost: { roundTripPoints: 1.4, pointValueUsd: 2, tickSize: 0.25, source: "src/config/cost_model.json MNQ" },
    barCount: 2565,
    firstTimestampSeconds: 1558465140,
    lastTimestampSeconds: 1558947540,
    interval: {
      method: "causal conformal",
      binCount: 10,
      recalibrationStepBars: 200,
      historyBars: 500,
      minimumBinObservations: 30,
      quantiles: [0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95],
      coveredBarCount: 2000,
    },
    attribution: { available: true, method: "SHAP", featureCount: 29, families: [] },
    reference: { tradeCount: 264, cumulativeNetUsd: -549.7, longCount: 34, shortCount: 230, hitRateAtHalf: 0.5423, areaUnderCurve: 0.529 },
    verification: [],
    notes: [],
    ...overrides,
  };
}

export function makeBar(overrides: Partial<LensBar> = {}): LensBar {
  return {
    rowIndex: 0,
    timestampSeconds: 1558465140,
    open: 7500,
    high: 7505,
    low: 7495,
    close: 7502,
    volume: 100,
    probabilityUp: 0.5,
    label: 1,
    realizedReturnBasisPoints: 2,
    predictedQuantilesBasisPoints: [-10, -6, -2, 1, 4, 8, 12],
    intervalLowerPrice: 7492,
    intervalUpperPrice: 7512,
    intervalMedianPrice: 7503,
    regime: "sideways",
    decision: "flat",
    position: 0,
    barPnlUsd: 0,
    cumulativeNetUsd: 0,
    ...overrides,
  };
}

export function makeBarSeries(count: number, startRowIndex = 0): LensBar[] {
  return Array.from({ length: count }, (_, i) =>
    makeBar({
      rowIndex: startRowIndex + i,
      timestampSeconds: 1558465140 + i * 60,
      open: 7500 + i,
      high: 7505 + i,
      low: 7495 + i,
      close: 7502 + i,
      probabilityUp: 0.4 + (i % 5) * 0.05,
    }),
  );
}

export function makeBarWindow(overrides: Partial<LensBarWindow> = {}, bars?: LensBar[]): LensBarWindow {
  const resolvedBars = bars ?? makeBarSeries(10);
  return {
    modelId: "xgb_baseline_post",
    params: makeParams(),
    rowWindow: { startRowIndex: resolvedBars[0]?.rowIndex ?? 0, endRowIndex: resolvedBars[resolvedBars.length - 1]?.rowIndex ?? 0 },
    bars: resolvedBars,
    totalBarsInRange: resolvedBars.length,
    truncated: false,
    features: null,
    ...overrides,
  };
}

export function makeEstimate(value: number, overrides: Partial<LensEstimate> = {}): LensEstimate {
  return { value, ciLow: value - 0.01, ciHigh: value + 0.01, n: 100, method: "normal approx", ...overrides };
}

export function makeHeadline(overrides: Partial<LensHeadline> = {}): LensHeadline {
  return {
    barCount: 2565,
    effectiveSampleSize: 513,
    tradeCount: 264,
    longCount: 34,
    shortCount: 230,
    hitRate: makeEstimate(0.5423),
    winRate: makeEstimate(0.4129),
    profitFactor: makeEstimate(0.6097),
    meanTradeNetUsd: makeEstimate(-2.08),
    totalNetUsd: -549.7,
    buyHoldNetUsd: 120.5,
    maxDrawdownUsd: 812.3,
    areaUnderCurve: 0.529,
    brierScore: 0.248,
    exposureShare: 0.31,
    verdict: "The model's hit rate does not clear a coin flip at 95% confidence.",
    ...overrides,
  };
}

export function makeEquity(count: number): LensEquityPoint[] {
  return Array.from({ length: count }, (_, i) => ({
    timestampSeconds: 1558465140 + i * 60,
    rowIndex: i,
    modelCumulativeUsd: -i * 2,
    buyHoldCumulativeUsd: i * 0.5,
    modelDrawdownUsd: -Math.abs(Math.sin(i)) * 50,
    position: (i % 3) - 1 as 1 | 0 | -1,
  }));
}

export function makeTrade(overrides: Partial<LensTrade> = {}): LensTrade {
  return {
    entryRowIndex: 0,
    exitRowIndex: 5,
    entryTimestampSeconds: 1558465140,
    exitTimestampSeconds: 1558465440,
    direction: 1,
    entryPrice: 7500,
    exitPrice: 7510,
    probabilityUp: 0.6,
    grossUsd: 5,
    netUsd: 3.6,
    cumulativeNetUsd: 3.6,
    regime: "bull",
    ...overrides,
  };
}

export function makeRegimes(overrides: Partial<LensRegimes> = {}): LensRegimes {
  return {
    lookbackBars: 50,
    threshold: 1,
    definition: "trailing return over 50 bars exceeds 1 trailing-volatility unit",
    segments: [],
    share: { bull: 0.3, bear: 0.3, sideways: 0.4 },
    performance: [],
    ...overrides,
  };
}

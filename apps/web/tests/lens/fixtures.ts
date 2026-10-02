/**
 * Minimal, type-complete Model Lens fixtures for client tests. Every field is
 * present so a fixture never masks a missing-field bug the real server would
 * expose.
 *
 * The identity and the headline numbers are the committed fixture model's own
 * (tests/fixtures/lens/mnq_1d_xgboost_direction_classifier: its lens manifest
 * and the diagnostics.json its trainer wrote), read here rather than typed, so
 * the rendered strings the panel tests look for are that model's real numbers.
 * The bars, equity and trades stay synthetic: those tests exercise rendering.
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
import fixtureManifestJson from "../../../../tests/fixtures/lens/mnq_1d_xgboost_direction_classifier/lens/manifest.json";
import fixtureDiagnosticsJson from "../../../../tests/fixtures/lens/mnq_1d_xgboost_direction_classifier/diagnostics.json";

const fixtureManifest = fixtureManifestJson as unknown as LensManifest;
const fixtureDiagnostics = fixtureDiagnosticsJson as unknown as {
  metrics: Record<string, { value: number }>;
  pnl_curve: { trade_pnl_dollars: number[]; n_long: number; n_short: number };
};

const fixtureTradeNetUsd = fixtureDiagnostics.pnl_curve.trade_pnl_dollars;

/** The fixture model's own recorded numbers (its trainer's diagnostics.json). */
export const FIXTURE_MODEL = {
  modelId: fixtureManifest.modelId,
  barCount: fixtureManifest.barCount,
  horizonBars: fixtureManifest.horizonBars,
  tradeCount: fixtureTradeNetUsd.length,
  longCount: fixtureDiagnostics.pnl_curve.n_long,
  shortCount: fixtureDiagnostics.pnl_curve.n_short,
  totalNetUsd: fixtureDiagnostics.metrics["cum_pnl_dollars"]?.value as number,
  hitRateAtHalf: fixtureDiagnostics.metrics["hit_rate_50"]?.value as number,
  winRate: fixtureTradeNetUsd.filter((net) => net > 0).length / fixtureTradeNetUsd.length,
  profitFactor: fixtureDiagnostics.metrics["profit_factor"]?.value as number,
  areaUnderCurve: fixtureDiagnostics.metrics["auc"]?.value as number,
  brierScore: fixtureDiagnostics.metrics["brier_score"]?.value as number,
  firstTimestampSeconds: fixtureManifest.firstTimestampSeconds,
  lastTimestampSeconds: fixtureManifest.lastTimestampSeconds,
} as const;

export function makeParams(overrides: Partial<LensEvaluationParams> = {}): LensEvaluationParams {
  return {
    threshold: fixtureManifest.defaultThreshold,
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
    modelId: fixtureManifest.modelId,
    builderVersion: fixtureManifest.builderVersion,
    builtAtIso: fixtureManifest.builtAtIso,
    sourceSchema: fixtureManifest.sourceSchema,
    sourceFiles: [],
    symbol: fixtureManifest.symbol,
    timeframe: fixtureManifest.timeframe,
    barSeconds: fixtureManifest.barSeconds,
    horizonBars: fixtureManifest.horizonBars,
    horizonSource: fixtureManifest.horizonSource,
    labelDefinition: fixtureManifest.labelDefinition,
    defaultThreshold: fixtureManifest.defaultThreshold,
    cost: fixtureManifest.cost,
    barCount: fixtureManifest.barCount,
    firstTimestampSeconds: fixtureManifest.firstTimestampSeconds,
    lastTimestampSeconds: fixtureManifest.lastTimestampSeconds,
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
    reference: fixtureManifest.reference,
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
    modelId: FIXTURE_MODEL.modelId,
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
    barCount: FIXTURE_MODEL.barCount,
    effectiveSampleSize: FIXTURE_MODEL.barCount / FIXTURE_MODEL.horizonBars,
    tradeCount: FIXTURE_MODEL.tradeCount,
    longCount: FIXTURE_MODEL.longCount,
    shortCount: FIXTURE_MODEL.shortCount,
    hitRate: makeEstimate(FIXTURE_MODEL.hitRateAtHalf),
    winRate: makeEstimate(FIXTURE_MODEL.winRate),
    profitFactor: makeEstimate(FIXTURE_MODEL.profitFactor),
    meanTradeNetUsd: makeEstimate(FIXTURE_MODEL.totalNetUsd / FIXTURE_MODEL.tradeCount),
    totalNetUsd: FIXTURE_MODEL.totalNetUsd,
    buyHoldNetUsd: 120.5,
    maxDrawdownUsd: 812.3,
    areaUnderCurve: FIXTURE_MODEL.areaUnderCurve,
    brierScore: FIXTURE_MODEL.brierScore,
    exposureShare: (FIXTURE_MODEL.tradeCount * FIXTURE_MODEL.horizonBars) / FIXTURE_MODEL.barCount,
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

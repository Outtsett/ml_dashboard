// @vitest-environment jsdom
/**
 * Render tests for the eight Model Lens panels (src/client/src/lens/panels).
 *
 * Each panel is a pure function of props — no network, no React Query — so
 * these render directly against small, type-complete fixtures and assert the
 * key numbers/labels a person reading the page would see, plus the
 * "unavailable" states (no attribution artifact, no conformal fit, thin
 * regimes) render their plain-words explanation instead of a chart.
 */

import "../setup";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type {
  LensAttribution,
  LensConfusion,
  LensDistribution,
  LensRolling,
  LensScatter,
  LensVerificationCheck,
} from "@shared/lens/types";
import { FIXTURE_MODEL, makeEstimate, makeHeadline, makeManifest, makeRegimes } from "./fixtures";
import { HeadlineStrip } from "@/lens/panels/HeadlineStrip";
import { RollingPanel } from "@/lens/panels/RollingPanel";
import { ScatterPanel } from "@/lens/panels/ScatterPanel";
import { ConfusionPanel } from "@/lens/panels/ConfusionPanel";
import { AttributionPanel } from "@/lens/panels/AttributionPanel";
import { RegimePanel } from "@/lens/panels/RegimePanel";
import { DistributionPanel } from "@/lens/panels/DistributionPanel";
import { VerificationList } from "@/lens/panels/VerificationList";

afterEach(() => cleanup());

// ─── local fixtures for the views fixtures.ts does not already cover ────────

function makeRolling(overrides: Partial<LensRolling> = {}): LensRolling {
  return {
    windowBars: 100,
    windowTrades: 30,
    effectiveSampleSizePerWindow: 20,
    nullBand: { lower: 0.42, upper: 0.58 },
    points: Array.from({ length: 6 }, (_, i) => ({
      timestampSeconds: 1558465140 + i * 60,
      rowIndex: i,
      hitRate: 0.5 + i * 0.01,
      brierScore: 0.25 - i * 0.001,
      logLoss: 0.69,
      labelledCount: 90,
    })),
    tradePoints: Array.from({ length: 4 }, (_, i) => ({
      timestampSeconds: 1558465140 + i * 300,
      tradeIndex: i,
      meanNetUsd: -2 + i,
      winRate: 0.4 + i * 0.02,
      sharpe: -0.1,
    })),
    drift: {
      method: "Page-Hinkley",
      delta: 0.005,
      lambda: 50,
      alarms: [{ timestampSeconds: 1558465500, tradeIndex: 12, statistic: 62.4, direction: "deterioration" }],
    },
    downsampled: false,
    ...overrides,
  };
}

function makeScatter(overrides: Partial<LensScatter> = {}): LensScatter {
  return {
    points: Array.from({ length: 5 }, (_, i) => ({
      rowIndex: i,
      probabilityUp: 0.4 + i * 0.1,
      predictedReturnBasisPoints: -4 + i * 2,
      realizedReturnBasisPoints: -3 + i * 2.2,
    })),
    sampled: false,
    deciles: Array.from({ length: 3 }, (_, i) => ({
      decile: i + 1,
      probabilityLow: i / 3,
      probabilityHigh: (i + 1) / 3,
      count: 40,
      upRate: 0.4 + i * 0.1,
      meanRealizedBasisPoints: makeEstimate(1.2 * (i + 1), { n: 40 }),
      meanPredictedBasisPoints: 1.0 * (i + 1),
    })),
    fit: {
      n: 120,
      bias: makeEstimate(0.8, { n: 120 }),
      slope: 0.62,
      intercept: 0.1,
      residualStandardDeviationBasisPoints: 5.4,
      rSquared: 0.081,
    },
    reliability: Array.from({ length: 4 }, (_, i) => ({
      binLow: i / 4,
      binHigh: (i + 1) / 4,
      count: 30,
      meanProbability: (i + 0.5) / 4,
      observedUpRate: (i + 0.5) / 4 + 0.02,
    })),
    ...overrides,
  };
}

function makeConfusion(overrides: Partial<LensConfusion> = {}): LensConfusion {
  const block = {
    counts: { truePositive: 120, falsePositive: 80, trueNegative: 100, falseNegative: 90 },
    n: 390,
    precisionUp: 0.6,
    recallUp: 0.5714,
    precisionDown: 0.526,
    recallDown: 0.5556,
    accuracy: makeEstimate(0.5641, { n: 390 }),
  };
  return {
    allRows: block,
    gatedRows: {
      ...block,
      n: FIXTURE_MODEL.tradeCount,
      counts: {
        truePositive: FIXTURE_MODEL.longCount,
        falsePositive: 0,
        trueNegative: FIXTURE_MODEL.shortCount,
        falseNegative: 0,
      },
    },
    winRate: makeEstimate(FIXTURE_MODEL.winRate, { n: FIXTURE_MODEL.tradeCount }),
    explanation: "Precision counts every gated call; win rate also nets out the cost of a round trip.",
    ...overrides,
  };
}

function makeAttribution(overrides: Partial<LensAttribution> = {}): LensAttribution {
  return {
    available: true,
    families: [
      { family: "momentum", label: "Momentum", featureCount: 8, meanAbsoluteShap: 0.42, share: 0.4, features: ["rsi_14", "roc_10"] },
      { family: "volatility", label: "Volatility", featureCount: 5, meanAbsoluteShap: 0.21, share: 0.2, features: ["atr_14"] },
      { family: "volume", label: "Volume", featureCount: 3, meanAbsoluteShap: 0.15, share: 0.14, features: ["obv"] },
      { family: "price_structure", label: "Price structure", featureCount: 6, meanAbsoluteShap: 0.27, share: 0.26, features: ["body_zscore"] },
      { family: "macro", label: "Macro", featureCount: 0, meanAbsoluteShap: 0, share: 0, features: [] },
    ],
    features: [
      { name: "rsi_14", family: "momentum", meanAbsoluteShap: 0.31, rank: 1 },
      { name: "atr_14", family: "volatility", meanAbsoluteShap: 0.21, rank: 2 },
    ],
    timeline: Array.from({ length: 5 }, (_, i) => ({
      timestampSeconds: 1558465140 + i * 300,
      contributions: { momentum: 0.1 * i, volatility: -0.05 * i, volume: 0.02, price_structure: -0.01, macro: 0 },
    })),
    beeswarm: [
      {
        feature: "rsi_14",
        family: "momentum",
        points: Array.from({ length: 10 }, (_, i) => ({ shap: -0.2 + i * 0.04, featureValue: i * 5 })),
      },
    ],
    ...overrides,
  };
}

function makeDistribution(overrides: Partial<LensDistribution> = {}): LensDistribution {
  return {
    realized: {
      count: 2400,
      mean: 0.3,
      median: 0.1,
      standardDeviation: 9.2,
      skewness: 0.4,
      kurtosis: 3.1,
      percentile25: -5.1,
      percentile75: 5.6,
      minimum: -60.2,
      maximum: 58.4,
    },
    predicted: {
      count: 2000,
      mean: 0.2,
      median: 0.15,
      standardDeviation: 3.1,
      skewness: 0.1,
      kurtosis: null,
      percentile25: -2.1,
      percentile75: 2.4,
      minimum: -12.2,
      maximum: 11.4,
    },
    histogram: {
      edgesBasisPoints: [-20, -10, 0, 10, 20],
      realizedCounts: [200, 800, 900, 400],
      predictedCounts: [50, 900, 950, 100],
    },
    tailCoverage: { coverage: 0.9, nominalOutsideShare: 0.1, observedOutsideShare: 0.132, belowLowerShare: 0.07, aboveUpperShare: 0.062, n: 2000 },
    intervalWidthByDecile: Array.from({ length: 5 }, (_, i) => ({ decile: i + 1, meanWidthBasisPoints: 14.2, count: 200 })),
    ...overrides,
  };
}

function makeVerification(): LensVerificationCheck[] {
  return [
    { name: "rescore_probability_max_absolute_difference", passed: true, measured: "3.1e-7", expected: "<= 1e-5" },
    { name: "close_reproduces_realized_return", passed: false, measured: "2.4e-2 bp", expected: "<= 1e-3 bp" },
  ];
}

// ─── HeadlineStrip ────────────────────────────────────────────────────────

describe("HeadlineStrip", () => {
  it("renders the verdict and the headline numbers with their CIs", () => {
    render(<HeadlineStrip headline={makeHeadline()} manifest={makeManifest()} />);
    expect(screen.getByTestId("lens-headline-verdict").textContent).toMatch(/coin flip/);
    // The fixture model's own recorded numbers (tests/fixtures/lens/.../diagnostics.json).
    const totalMagnitude = Math.abs(FIXTURE_MODEL.totalNetUsd).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    expect(screen.getByTestId("lens-headline-hit-rate").textContent).toContain(`${(FIXTURE_MODEL.hitRateAtHalf * 100).toFixed(1)}%`);
    expect(screen.getByTestId("lens-headline-profit-factor").textContent).toContain(FIXTURE_MODEL.profitFactor.toFixed(3));
    expect(screen.getByTestId("lens-headline-total-net").textContent).toContain(`$${totalMagnitude}`);
    expect(screen.getByTestId("lens-headline-total-net").textContent).toContain("buy & hold");
  });

  it("shows buy & hold as unavailable when the manifest carries none", () => {
    render(<HeadlineStrip headline={makeHeadline({ buyHoldNetUsd: null })} manifest={makeManifest()} />);
    expect(screen.getByTestId("lens-headline-total-net").textContent).toMatch(/unavailable/);
  });
});

// ─── RollingPanel ─────────────────────────────────────────────────────────

describe("RollingPanel", () => {
  it("renders the drift alarm count and the null band in the basis line", () => {
    render(<RollingPanel rolling={makeRolling()} horizonBars={5} />);
    expect(screen.getByText(/1 drift alarm/)).toBeTruthy();
    expect(screen.getByText(/deterioration/)).toBeTruthy();
    expect(screen.getByTestId("lens-rolling").textContent).toContain("horizon");
  });
});

// ─── ScatterPanel ─────────────────────────────────────────────────────────

describe("ScatterPanel", () => {
  it("renders bias, slope and R² when a fit exists", () => {
    render(<ScatterPanel scatter={makeScatter()} />);
    expect(screen.getByText("Bias")).toBeTruthy();
    expect(screen.getByText("0.620")).toBeTruthy();
    expect(screen.getByText("0.081")).toBeTruthy();
  });

  it("explains fit statistics are unavailable when there is no conformal interval", () => {
    render(<ScatterPanel scatter={makeScatter({ fit: null })} />);
    expect(screen.getByText(/No conformal interval is available/)).toBeTruthy();
  });
});

// ─── ConfusionPanel ───────────────────────────────────────────────────────

describe("ConfusionPanel", () => {
  it("defaults to gated rows and shows the explanation", () => {
    render(<ConfusionPanel confusion={makeConfusion()} threshold={0.55} />);
    // The gated true-positive cell: the fixture model's long trades.
    expect(screen.getByText(String(FIXTURE_MODEL.longCount))).toBeTruthy();
    expect(screen.getByText(/nets out the cost/)).toBeTruthy();
  });

  it("switches to all rows on toggle", () => {
    render(<ConfusionPanel confusion={makeConfusion()} threshold={0.55} />);
    fireEvent.click(screen.getByTestId("lens-confusion-all"));
    expect(screen.getByText("120")).toBeTruthy();
  });
});

// ─── AttributionPanel ─────────────────────────────────────────────────────

describe("AttributionPanel", () => {
  it("names macro as 0 features rather than hiding it", () => {
    render(<AttributionPanel attribution={makeAttribution()} />);
    expect(screen.getByText(/Macro: 0 features in this model/)).toBeTruthy();
    expect(screen.getAllByText("Momentum").length).toBeGreaterThan(0);
  });

  it("renders the unavailable reason instead of charts when there is no SHAP artifact", () => {
    render(<AttributionPanel attribution={{ available: false, reason: "no SHAP artifact for this model", families: [], features: [], timeline: [], beeswarm: [] }} />);
    expect(screen.getByTestId("lens-attribution-unavailable").textContent).toContain("no SHAP artifact for this model");
  });
});

// ─── RegimePanel ──────────────────────────────────────────────────────────

describe("RegimePanel", () => {
  it("shows a caution when a regime has fewer than 30 trades", () => {
    render(
      <RegimePanel
        regimes={makeRegimes({
          performance: [
            { regime: "bull", barCount: 800, tradeCount: 12, hitRate: makeEstimate(0.5, { n: 12 }), meanTradeNetUsd: makeEstimate(1.2, { n: 12 }), profitFactor: 1.1, totalNetUsd: 14.4 },
            { regime: "bear", barCount: 900, tradeCount: 180, hitRate: makeEstimate(0.55, { n: 180 }), meanTradeNetUsd: makeEstimate(-1.1, { n: 180 }), profitFactor: 0.9, totalNetUsd: -198 },
          ],
        })}
      />,
    );
    expect(screen.getByTestId("lens-regime-caution").textContent).toMatch(/Bull \(12 trades\)/);
    expect(screen.getByTestId("lens-regime-row-bear").textContent).toContain("180");
  });
});

// ─── DistributionPanel ────────────────────────────────────────────────────

describe("DistributionPanel", () => {
  it("renders both eight-number summaries and tail coverage", () => {
    render(<DistributionPanel distribution={makeDistribution()} />);
    expect(screen.getByText("2,400")).toBeTruthy();
    expect(screen.getByText(/observed 13\.2%/)).toBeTruthy();
  });

  it("explains tail coverage is unavailable with no interval", () => {
    render(<DistributionPanel distribution={makeDistribution({ tailCoverage: null, predicted: null })} />);
    expect(screen.getByText(/cannot be checked/)).toBeTruthy();
  });
});

// ─── VerificationList ─────────────────────────────────────────────────────

describe("VerificationList", () => {
  it("renders a glyph and measured/expected for every check", () => {
    render(<VerificationList checks={makeVerification()} />);
    const pass = screen.getAllByTestId("lens-verification-pass");
    const fail = screen.getAllByTestId("lens-verification-fail");
    expect(pass).toHaveLength(1);
    expect(fail).toHaveLength(1);
    expect(fail[0]!.textContent).toContain("close_reproduces_realized_return");
  });

  it("states plainly when there are no checks", () => {
    render(<VerificationList checks={[]} />);
    expect(screen.getByText(/No verification checks were reported/)).toBeTruthy();
  });
});

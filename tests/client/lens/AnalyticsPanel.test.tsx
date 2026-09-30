// @vitest-environment jsdom
/**
 * Render test for the Model Lens analytics panel against a REAL evaluation:
 * the committed daily XGBoost fixture (tests/fixtures/lens/
 * mnq_1d_xgboost_direction_classifier) is read from its lens/bars.parquet,
 * evaluated by the shared compute at default parameters and laid out as the
 * bars GET /bars serves. Each tab's key sentences are asserted as a reader
 * sees them, with that model's own numbers (78 trades, +$15,972.60).
 */

import "../setup";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { OverlaySetSchema } from "@shared/chartLink";
import { buildBarWindow, clampLensParams, evaluateLens, type LensBar, type LensEvaluation, type LensManifest } from "@shared/lens/index";
import type { LensChartOverlaySet } from "@shared/lens/analytics";
import { AnalyticsPanel } from "@/lens/panels/AnalyticsPanel";
import { DAILY_CLASSIFIER_FIXTURE, loadLensManifest, loadLensSeries } from "../../shared/lens/load";

afterEach(() => cleanup());

/** 2026-09-29 00:00 UTC: the record's last prediction (2025-12-18) is 285 days old. */
const NOW_SECONDS = Date.UTC(2026, 8, 29) / 1000;

let manifest: LensManifest;
let evaluation: LensEvaluation;
let bars: LensBar[];

beforeAll(async () => {
  manifest = loadLensManifest(DAILY_CLASSIFIER_FIXTURE);
  const series = await loadLensSeries(DAILY_CLASSIFIER_FIXTURE, manifest);
  const params = clampLensParams({}, manifest);
  evaluation = evaluateLens(series, null, manifest, params);
  bars = buildBarWindow(series, null, manifest, params, { startRowIndex: 0, endRowIndex: manifest.barCount - 1 }, 5000).bars;
});

function openTab(name: "happened" | "why" | "next" | "todo") {
  const trigger = screen.getByTestId(`lens-analytics-tab-${name}`);
  fireEvent.mouseDown(trigger, { button: 0, ctrlKey: false });
}

describe("AnalyticsPanel on the committed daily XGBoost record", () => {
  it("What happened: the generated summary, the eight numbers, the sides and the drawdown", () => {
    render(<AnalyticsPanel evaluation={evaluation} manifest={manifest} bars={bars} nowSeconds={NOW_SECONDS} />);
    expect(screen.getByTestId("lens-analytics-summary").textContent).toBe(
      "Over 427 test bars the model took 78 trades and made $15,972.60 after costs; it was right 53.8% of the time, " +
        "which after costs of 5.6 ticks per round trip is above the 42.9% it needed to break even.",
    );
    const summary = screen.getByTestId("lens-analytics-trade-summary");
    expect(within(summary).getByText("Count").nextSibling?.textContent).toBe("78");
    expect(within(summary).getByText("Excess kurtosis")).toBeTruthy();
    const sides = screen.getByTestId("lens-analytics-sides");
    expect(within(sides).getByText("Long").closest("tr")?.textContent).toContain("47");
    expect(within(sides).getByText("Short").closest("tr")?.textContent).toContain("31");
    expect(screen.getByTestId("lens-analytics-equity").textContent).toBe(
      "The model ended +$15,972.60 after costs against +$13,510.20 for buying and holding one contract over the same 427 bars, a difference of +$2,462.40.",
    );
    expect(screen.getByTestId("lens-analytics-drawdown").textContent).toBe(
      "The deepest drawdown was -$4,138.40, from a peak on 2024-12-17 to a trough on 2024-12-31, and recovered on 2025-02-27.",
    );
  });

  it("Why: the three largest measured causes of loss, deciles, regimes and calibration", () => {
    render(<AnalyticsPanel evaluation={evaluation} manifest={manifest} bars={bars} nowSeconds={NOW_SECONDS} />);
    openTab("why");
    const causes = screen.getByTestId("lens-analytics-loss-causes");
    const items = within(causes).getAllByRole("listitem").map((item) => item.textContent?.replace(/^▼/, ""));
    expect(items).toEqual([
      "Trades entered in a bull regime lost $4,978.30 over 21 trades (mean -$237.06 per trade).",
      "Trades entered with conviction 0.60 to 0.65 lost $1,059.30 over 21 trades (mean -$50.44 per trade).",
      "Costs: the 78 trades paid $218.40 in commission and slippage ($2.80 per round trip); before costs the same trades made $16,191.00.",
    ]);
    expect(screen.getByText("each bar is a whole day, so the hour of the session does not apply", { exact: false })).toBeTruthy();
    expect(within(screen.getByTestId("lens-analytics-deciles")).getAllByRole("row")).toHaveLength(11);
    expect(within(screen.getByTestId("lens-analytics-regimes")).getAllByText(/not shown: only \d+ trades?; at least 20 are needed/).length).toBeGreaterThan(0);
    expect(screen.getByTestId("lens-analytics-calibration").textContent).toMatch(
      /^Expected calibration error is \d+\.\d\d percentage points: on average a stated probability of up is \d+\.\d\d points away from how often the bars in its bin actually went up \(350 labelled bars in \d+ of 10 equal-width bins\)\.$/,
    );
  });

  it("What comes next: the latest prediction is labelled old, with its date, age and interval", () => {
    render(<AnalyticsPanel evaluation={evaluation} manifest={manifest} bars={bars} nowSeconds={NOW_SECONDS} />);
    openTab("next");
    expect(screen.getByTestId("lens-analytics-old-prediction").textContent).toMatch(/Old prediction: made 2025-12-18 00:00 UTC, 28\d days ago\./);
    const sentences = screen.getByTestId("lens-analytics-next-sentences").textContent ?? "";
    expect(sentences).toMatch(
      /The most recent prediction is from 2025-12-18 \(28\d days ago; the record already holds the bar 5 bars later, so that forecast has resolved\): /,
    );
    expect(sentences).toContain("probability of up 0.446, so the model leaned down, and that clears the 0.550 entry threshold for a short.");
    expect(sentences).toMatch(/Its 90% conformal interval for the move over the next 5 bars runs from -?\+?\d+\.\d to \+?-?\d+\.\d basis points/);
    expect(sentences).toContain("The Page-Hinkley drift alarm is off: it never fired over 78 trades.");
    expect(screen.getByTestId("lens-analytics-drift").textContent).toContain("Drift alarm: off");
  });

  it("What to do: the threshold search with its warning, break-even, Kelly and the recommendation", () => {
    render(<AnalyticsPanel evaluation={evaluation} manifest={manifest} bars={bars} nowSeconds={NOW_SECONDS} />);
    openTab("todo");
    expect(screen.getByTestId("lens-analytics-threshold").textContent).toBe(
      "Of 46 entry thresholds from 0.50 to 0.95, 0.65 gave the highest expected net result per trade after costs: $397.49 [$153.42, $750.53] over 60 trades; " +
        "the current threshold 0.550 gives $204.78 [-$3.85, $516.39] over 78 trades.",
    );
    expect(screen.getByTestId("lens-analytics-threshold-warning").textContent).toContain("Chosen on the same rows it is scored on");
    expect(screen.getByTestId("lens-analytics-break-even").textContent).toBe(
      "A trade that moved the right way averaged $1,068.70 before costs and one that did not lost $797.07; with $2.80 of cost per round trip the model must be right 42.9% of the time to break even, and it was right 53.8% [42.9%, 64.5%] over 78 trades.",
    );
    expect(screen.getByTestId("lens-analytics-kelly").textContent).toBe(
      "Full Kelly = p − (1 − p) ÷ b = 0.538 − 0.462 ÷ 1.333 = 0.192; half of it, capped at 25%, suggests risking 9.6% of risk capital per trade.",
    );
    expect(screen.getByTestId("lens-analytics-recommendation-sentence").textContent).toBe(
      "Gather more data: the 95% interval on mean net result per trade, [-$3.85, $516.39] over 78 trades, includes zero, so the record cannot tell this model from no edge.",
    );
    const rules = within(screen.getByTestId("lens-analytics-rules")).getAllByRole("listitem");
    expect(rules).toHaveLength(8);
    expect(rules[3]?.textContent).toContain("← decides");
  });

  it("Show on the Market chart sends the model's own overlay set; Clear removes its source", () => {
    const onShow = vi.fn<(set: LensChartOverlaySet) => void>();
    const onClear = vi.fn<(source: string) => void>();
    render(
      <AnalyticsPanel
        evaluation={evaluation}
        manifest={manifest}
        bars={bars}
        nowSeconds={NOW_SECONDS}
        chart={{ onShow, onClear, busy: false, message: "Drawn on the Market chart (MNQ 1d)." }}
      />,
    );
    fireEvent.click(screen.getByTestId("lens-analytics-show-on-chart"));
    expect(onShow).toHaveBeenCalledTimes(1);
    const set = onShow.mock.calls[0]?.[0] as LensChartOverlaySet;
    expect(OverlaySetSchema.safeParse(set).success).toBe(true);
    expect(set.source).toBe("model_lens:MNQ_1d_xgboost+direction_classifier_20260923T014724");
    expect([set.symbol, set.timeframe]).toEqual(["MNQ", "1d"]);
    fireEvent.click(screen.getByTestId("lens-analytics-clear-chart"));
    expect(onClear).toHaveBeenCalledWith("model_lens:MNQ_1d_xgboost+direction_classifier_20260923T014724");
    expect(screen.getByTestId("lens-analytics-chart-message").textContent).toBe("Drawn on the Market chart (MNQ 1d).");
  });

  it("before the bars load, the row-level views state why instead of a value", () => {
    render(<AnalyticsPanel evaluation={evaluation} manifest={manifest} bars={null} barsReason="loading every bar of the record…" nowSeconds={NOW_SECONDS} />);
    // The trade-level sentence needs no bars.
    expect(screen.getByTestId("lens-analytics-summary").textContent).toContain("the model took 78 trades and made $15,972.60 after costs");
    openTab("next");
    expect(screen.getByTestId("lens-analytics-next-sentences").textContent).toContain("The latest prediction is not stated: loading every bar of the record….");
    openTab("todo");
    expect(screen.getByTestId("lens-analytics-recommendation-sentence").textContent).toBe(
      "Gather more data: the record's bars are not loaded (loading every bar of the record…).",
    );
  });
});

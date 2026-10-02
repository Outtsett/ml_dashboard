/**
 * The page's controls (mirrored into the URL by useStudyControls) and the
 * candle the calculator is currently showing, built from them.
 */

import type { useStudyControls } from "@/studies/kit";
import {
  MNQ_TICK_POINTS, buildCandle, buildTrailingBars, evaluateSingleCandlePatterns, notebookApproximation,
  type CalculatorSpec, type CandleBar, type CandleEvaluation, type RealCandle, type SingleCandlePattern,
} from "@shared/studies/single-candle-recognizer";

export const CONTROL_DEFAULTS = {
  // the study half
  metric: "balanced_accuracy",
  models: "",
  sortByGap: true,
  zoomDots: false,
  // the calculator
  source: "sliders",
  bodyFraction: 0.04,
  upperFraction: 0.45,
  candleRangeTicks: 40,
  trailingRangeTicks: 40,
  tieTrailingBody: true,
  trailingBodyFraction: 0.3,
  candlePattern: "doji",
  candleTimeframe: "5m",
  candleIndex: 0,
  // the rule
  setting: "BodyDoji",
  // the column grid
  binCount: 18,
};

type ControlsTuple = ReturnType<typeof useStudyControls<typeof CONTROL_DEFAULTS>>;
export type Controls = ControlsTuple[0];
export type SetControl = ControlsTuple[1];

export interface CandleView {
  /** Eleven bars, oldest first, in price (ticks for the sliders, MNQ index points for a real firing). */
  bars: CandleBar[];
  /** Price per tick: 1 for the sliders, the MNQ tick for a real firing. */
  unit: number;
  evaluation: CandleEvaluation;
  /** The notebook's shortcut for the same sliders; null for a real firing. */
  shortcut: SingleCandlePattern[] | null;
  spec: CalculatorSpec;
  realShown: boolean;
}

export function calculatorSpec(controls: Controls): CalculatorSpec {
  return {
    bodyFraction: controls.bodyFraction,
    upperFraction: controls.upperFraction,
    candleRangeTicks: controls.candleRangeTicks,
    trailingRangeTicks: controls.trailingRangeTicks,
    trailingBodyFraction: controls.tieTrailingBody ? null : controls.trailingBodyFraction,
  };
}

/** The candle on screen: the real firing when that source is chosen and loaded, else the sliders' candle. */
export function candleView(controls: Controls, real: RealCandle | null): CandleView {
  const spec = calculatorSpec(controls);
  if (controls.source === "real" && real) {
    const bars = real.bars.map((bar) => ({ open: bar.open, high: bar.high, low: bar.low, close: bar.close }));
    return { bars, unit: MNQ_TICK_POINTS, evaluation: evaluateSingleCandlePatterns(bars) as CandleEvaluation, shortcut: null, spec, realShown: true };
  }
  const bars = [...buildTrailingBars(spec), buildCandle(spec)];
  return { bars, unit: 1, evaluation: evaluateSingleCandlePatterns(bars) as CandleEvaluation, shortcut: notebookApproximation(spec), spec, realShown: false };
}

/**
 * Every control on the indicator-study page, with its default. All of them
 * live in the URL (useStudyControls), so any view is a link.
 */

import { useStudyControls } from "@/studies/kit";
import { DEFAULT_OVERLAYS, DEFAULT_PANELS, DEFAULT_PATTERN_KINDS, type IndicatorStudyTimeframe } from "@shared/studies/indicator-study";

export const CONTROL_DEFAULTS = {
  tab: "chart",
  timeframe: "1h",
  horizon: 1,
  // 1 · chart
  windowEnd: -1,
  windowLength: 0,
  overlays: DEFAULT_OVERLAYS.join(","),
  panels: DEFAULT_PANELS.join(","),
  kinds: DEFAULT_PATTERN_KINDS.join(","),
  hiddenPatterns: "",
  // 2 · inspector
  inspectorPattern: "candlestick_engulfing",
  context: 15,
  occurrence: 1,
  // 3 · correlation
  correlationVariant: "transformed",
  method: "spearman",
  order: "cluster",
  correlationHiddenGroups: "Pattern Recognition",
  floor: 0,
  pairA: "",
  pairB: "",
  // 5 · predictability
  predictabilityVariant: "transformed",
  statistic: "information_coefficient",
  predictabilityHiddenGroups: "",
  top: 45,
  explain: "rsi_14",
  // 6 · patterns as calls
  reportableOnly: false,
  // 8 · distributions
  distributionGroup: "Momentum Indicators",
  distributionVariant: "transformed",
  logCounts: false,
  // 10 · pattern conditions
  formationPattern: "candlestick_hammer|positive",
  view: "rank",
  bins: 20,
  legendFeature: "prior_trend_zscore_20_bars",
  firing: 0,
  band: 0.1,
  mapStatistic: "middle_half_width_percentile_points",
  minimumFirings: 20,
  trendDefinition: "return_zscore_20_bars_beyond_1",
  interval: "day_block",
  firingsPage: 1,
};

export function useIndicatorControls() {
  return useStudyControls(CONTROL_DEFAULTS);
}

export type IndicatorControls = ReturnType<typeof useIndicatorControls>[0];
export type SetIndicatorControl = ReturnType<typeof useIndicatorControls>[1];

export function timeframeOf(controls: IndicatorControls): IndicatorStudyTimeframe {
  return controls.timeframe === "4h" || controls.timeframe === "1m" ? controls.timeframe : "1h";
}

export const TIMEFRAME_LABEL: Record<IndicatorStudyTimeframe, string> = { "1h": "1 hour", "4h": "4 hours", "1m": "1 minute (windowed)" };

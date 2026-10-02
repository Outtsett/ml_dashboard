/**
 * Every control of the page, with the notebook's defaults. All of them live in the URL (useStudyControls), so a
 * view of any tab is a link. Empty strings mean "the latest" (round, configuration, session day), resolved when
 * the data arrives.
 */

import type { useStudyControls } from "@/studies/kit";
import { BUILD_FAMILIES, type OverviewBody } from "@shared/studies/ta-strategy-600-ticks";

export const DEFAULTS = {
  tab: "goal",
  bins: 30,
  // 1 · the goal
  goalTrades: 20,
  goalRisk: 80,
  goalReward: 1,
  goalContracts: 1,
  goalTicks: 600,
  goalStep: 20,
  // 2-8 · the model battery
  batteryRound: "",
  sortBy: "net_ticks_per_session_day_mean",
  batteryTimeframes: "15m,1h,4h,5m,30m",
  configuration: "",
  dayStep: 20,
  // 9 · rules
  ruleRound: "",
  period: "all_years",
  ruleTimeframes: "1m,5m,15m,30m,1h",
  minimumTrades: 100,
  keptStrategy: "",
  stopTicks: 40,
  // 10 · levels, zones, conditional templates
  conditionalRound: "",
  qualitySource: "round",
  qualityFamily: "",
  levelSession: -1,
  levelFamilies: "prior_session,overnight,opening_range,fractal_1h,fractal_4h",
  template: "",
  goalOnAxis: true,
  // 11 · frequency
  frequencyMarket: "MNQ",
  window: "whole_day",
  cap: 0,
  barSize: "15m",
  strictness: "frozen",
  frequencyTrades: 10,
  // 12 · time of day
  seasonMarket: "MNQ",
  seasonYear: "all",
  weekday: "all",
  measure: "relative_volatility_to_session_average",
  events: "london_open,us_data_0830_with_release,us_data_0830_without_release,rth_open",
  eventScale: "relative_to_pre_event_hour",
  moveStart: 900,
  moveHorizon: 60,
  moveLevel: 1,
  // 13 · cascade
  cascadeMarket: "MNQ",
  sessionPart: "all",
  horizon: 60,
  volumeMeasure: "relative_volume",
  cascadeDay: "",
  cascadeTimeframes: "5m,15m,30m",
  cascadeTemplate: "cascade_trend",
  // 14 · zones at the touch
  zoneMarket: "MNQ",
  condition: "strength_bucket",
  outcome: "bounce",
  netPerTrade: 10,
  zoneDay: "",
  zoneTemplate: "zone_bounce",
  // 15 · how a zone is built
  buildMarket: "MNQ",
  buildDay: "2025-12-29",
  buildTimeframe: "5m",
  width: 0.25,
  reach: 6,
  buildFamilies: BUILD_FAMILIES.join(","),
  buildBar: 90,
};

type Tuple = ReturnType<typeof useStudyControls<typeof DEFAULTS>>;
export type Controls = Tuple[0];
export type SetControl = Tuple[1];

export interface TabProps {
  controls: Controls;
  set: SetControl;
  overview: OverviewBody;
}

export const FALLBACK_OVERVIEW: OverviewBody = {
  goalTicks: 600, costTicks: 5.56, tickValueUsd: 0.5, tickSizePoints: 0.25, costPerSideUsd: 1.39, costSource: "packages/config/cost_model.json",
};

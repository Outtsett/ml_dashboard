/**
 * The page's control defaults (mirrored into the URL by useStudyControls).
 * The first block is sent to the server (it filters the 5,400-row screen);
 * the rest re-cut tables the page already holds, so moving them does not refetch.
 */

export const SERVER_DEFAULTS = {
  pair: "all",
  timeframe: "all",
  family: "all",
  target: "both",
  criterion: "family_wise",
  topCount: 25,
  redundancyThreshold: 0.95,
  heatmapTimeframe: "1h",
  heatmapTarget: "forward_log_range",
};

export const DEFAULTS = {
  ...SERVER_DEFAULTS,
  spreadUnit: "basis_points",
  hourPair: "all",
  spikeHour: 21,
  ordinaryBelow: 20,
  ladderMetric: "spread_over_average_true_range",
  ladderSort: "1d",
  ladderHighlight: "none",
  ladderLog: true,
  formulaPair: "EURUSD",
  formulaTimeframe: "1h",
  correlationTimeframe: "1d",
  correlationMeasure: "correlation_raw_pearson",
  mechanicalTimeframe: "1d",
  mechanicalCount: 12,
  eigenTimeframe: "1d",
  eigenMatrix: "raw",
  eigenStep: 18,
  nullRank: 1,
  showRedundancyMatrix: false,
  profileFrame: "structure_screen",
};

type Widen<C> = { [K in keyof C]: C[K] extends string ? string : C[K] extends number ? number : C[K] extends boolean ? boolean : C[K] };
export type Controls = Widen<typeof DEFAULTS>;
export type SetControl = <K extends keyof Controls>(key: K, value: Controls[K]) => void;

export function serverControls(controls: Controls): Record<keyof typeof SERVER_DEFAULTS, string | number> {
  return {
    pair: controls.pair,
    timeframe: controls.timeframe,
    family: controls.family,
    target: controls.target,
    criterion: controls.criterion,
    topCount: controls.topCount,
    redundancyThreshold: controls.redundancyThreshold,
    heatmapTimeframe: controls.heatmapTimeframe,
    heatmapTarget: controls.heatmapTarget,
  };
}

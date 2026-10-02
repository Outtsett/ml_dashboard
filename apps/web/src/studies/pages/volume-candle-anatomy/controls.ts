/** The page's control values (kept in the URL by useStudyControls) and their shared types. */

export const DEFAULTS = {
  timeframe: "5m",
  population: "closes_inside_range",
  hideTautology: true,
  decileEncoding: "volume_rank_trailing",
  showBand: true,
  windowStart: 400,
  windowLength: 70,
  nats: 0.0616,
};

export type Controls = { [K in keyof typeof DEFAULTS]: (typeof DEFAULTS)[K] extends boolean ? boolean : (typeof DEFAULTS)[K] extends number ? number : string };
export type SetControl = <K extends keyof Controls>(key: K, value: Controls[K]) => void;

export const POPULATION_LABEL: Record<string, string> = {
  closes_inside_range: "bars closing inside their range (the control)",
  all_bars: "all bars",
  rising_candles_inside_range: "rising candles only",
  falling_candles_inside_range: "falling candles only",
};

/** Short, readable names for chart legends and tooltips. */
export function shortName(name: string): string {
  return name.replace(/_/g, " ");
}

export const SHORT_ENCODING: Record<string, string> = {
  volume_contracts: "raw contracts",
  volume_bar_height_in_window: "bar height",
  volume_zscore_trailing: "z-score",
  volume_rank_trailing: "rank",
  volume_signed_by_candle_direction: "signed",
};

export const SHORT_MEASURE: Record<string, string> = {
  upper_wick_in_average_ranges: "upper wick",
  lower_wick_in_average_ranges: "lower wick",
  body_absolute_in_average_ranges: "body size",
  body_signed_in_average_ranges: "signed body",
  total_range_in_average_ranges: "total range",
  body_fraction_of_range: "body share of range",
  total_wick_fraction_of_range: "wick share of range",
  wick_asymmetry_upper_minus_lower: "wick asymmetry (upper - lower)",
};

/** Categorical colours (Okabe-Ito) for the five volume readings; every chart that uses them adds a shape as well. */
export const ENCODING_STYLE: Record<string, { color: string; shape: "circle" | "square" | "diamond" | "triangle" | "star" }> = {
  volume_contracts: { color: "#56B4E9", shape: "circle" },
  volume_bar_height_in_window: { color: "#E69F00", shape: "square" },
  volume_zscore_trailing: { color: "#009E73", shape: "diamond" },
  volume_rank_trailing: { color: "#F0E442", shape: "triangle" },
  volume_signed_by_candle_direction: { color: "#CC79A7", shape: "star" },
};

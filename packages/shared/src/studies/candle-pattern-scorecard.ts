/** The body of GET /api/studies/candle-pattern-scorecard, shared by the handler and the page. */

export interface ScorecardRow {
  timeframe: string;
  pattern_name: string;
  pattern_side: string;
  forward_candle_count: number;
  firing_count_holdout: number;
  forward_move_difference_in_average_ranges: number | null;
  forward_move_difference_interval_low: number | null;
  forward_move_difference_interval_high: number | null;
  forward_move_difference_bootstrap_p_value: number | null;
  up_rate_when_fired: number | null;
  up_rate_baseline: number | null;
  edge_in_direction_pattern_claimed_usd_per_contract: number | null;
  round_trip_cost_usd: number | null;
  covers_round_trip_cost: boolean | null;
  interval_excludes_zero: boolean | null;
  average_range_points: number | null;
  survives_multiple_testing_correction: boolean | null;
  recognition_area_under_curve: number | null;
  recognition_average_precision: number | null;
  recognition_prevalence: number | null;
  recognition_positive_window_count: number | null;
  [column: string]: unknown;
}

export interface ScorecardBody {
  rows: ScorecardRow[];
  pointValueUsd: number;
}

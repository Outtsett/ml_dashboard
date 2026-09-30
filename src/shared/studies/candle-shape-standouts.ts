/**
 * Candle shape standouts: MNQ 1-minute candles whose body / wick proportions or whose size stand
 * out against the bars before them, and when they happen. Landed by
 * src/ml/studies/candle_shape_standouts/build.py as derived_study_candle_shape_standouts_<table>.
 */

export const STANDOUT_VIEWS = {
  standouts: "derived_study_candle_shape_standouts_standouts",
  catalog: "derived_study_candle_shape_standouts_shape_catalog",
  rules: "derived_study_candle_shape_standouts_rules",
} as const;

export const STANDOUT_REASONS = ["rare_shape", "long_range", "long_body", "long_upper_wick", "long_lower_wick"] as const;
export type StandoutReason = (typeof STANDOUT_REASONS)[number];

export const REASON_LABELS: Record<StandoutReason, string> = {
  rare_shape: "Rare shape",
  long_range: "Long range",
  long_body: "Long body",
  long_upper_wick: "Long upper wick",
  long_lower_wick: "Long lower wick",
};

/** Columns the table can be sorted by, largest first (rarity sorts smallest first). */
export const SORT_COLUMNS = [
  "range_to_trailing_mean_range_ratio",
  "body_to_trailing_mean_range_ratio",
  "upper_wick_to_trailing_mean_range_ratio",
  "lower_wick_to_trailing_mean_range_ratio",
  "range_ticks",
  "trailing_shape_share_percent",
  "upper_to_lower_wick_ratio",
  "body_to_total_wick_ratio",
] as const;
export type SortColumn = (typeof SORT_COLUMNS)[number];

export const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday"] as const;
export const MONTHS = [
  "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
] as const;

export interface StandoutRow {
  timestamp: number;
  new_york_time: number;
  trading_day: string;
  trading_day_of_week: string;
  new_york_day_of_week: string;
  month: string;
  month_number: number;
  year: number;
  new_york_hour: number;
  minute_of_session: number;
  bars_since_session_break: number;
  contract_symbol: string;
  absolute_open_price: number;
  absolute_high_price: number;
  absolute_low_price: number;
  absolute_close_price: number;
  volume: number;
  direction: "rising" | "falling" | "flat";
  range_ticks: number;
  body_ticks: number;
  upper_wick_ticks: number;
  lower_wick_ticks: number;
  body_fraction_of_range: number | null;
  upper_wick_fraction_of_range: number | null;
  lower_wick_fraction_of_range: number | null;
  upper_to_lower_wick_ratio: number | null;
  body_to_total_wick_ratio: number | null;
  trailing_mean_range_ticks: number | null;
  range_to_trailing_mean_range_ratio: number | null;
  body_to_trailing_mean_range_ratio: number | null;
  upper_wick_to_trailing_mean_range_ratio: number | null;
  lower_wick_to_trailing_mean_range_ratio: number | null;
  shape_cell: string;
  trailing_shape_share_percent: number | null;
  first_occurrence_of_shape: boolean;
  rare_shape: boolean;
  long_range: boolean;
  long_body: boolean;
  long_upper_wick: boolean;
  long_lower_wick: boolean;
  reason_count: number;
  reasons: string;
}

export interface ShapeCatalogRow {
  shape_cell: string;
  direction: string;
  body_tenth_of_range: number | null;
  upper_wick_tenth_of_range: number | null;
  lower_wick_tenth_of_range: number | null;
  bar_count: number;
  standout_count: number;
  share_percent: number;
  first_seen: number;
  last_seen: number;
  [count: `${string}_count`]: number;
}

export interface RuleRow {
  reason: StandoutReason;
  column: string;
  comparison: string;
  threshold: number;
  bar_count: number;
  share_of_bars_percent: number;
  shape_window_bars: number;
  range_window_bars: number;
  bars_examined: number;
  first_bar: number;
  last_bar: number;
}

/** Standouts counted by one calendar key pair, for the selected reason. */
export interface CalendarCell {
  row_key: string;
  column_key: string | number;
  standout_count: number;
}

export interface StandoutsBody {
  rules: RuleRow[];
  catalog: ShapeCatalogRow[];
  /** trading day of the week x month */
  weekdayByMonth: CalendarCell[];
  /** trading day of the week x New York hour */
  weekdayByHour: CalendarCell[];
  /** the selected reason's standouts, sorted, capped at `limit` */
  rows: StandoutRow[];
  /** a fixed sample of the selected reason's standouts for the every-column grid */
  sample: StandoutRow[];
  matching: number;
}
